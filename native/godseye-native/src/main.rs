use macroquad::prelude::*;
mod correlation;
mod data;
mod filter;
mod playback;
mod refresh;
mod satellite;

use correlation::{correlate_incidents, IncidentCorrelationStats};
use data::{
    build_gdelt_location_markers, build_internet_outage_markers, load_embedded, parse_rfc3339_unix,
    resolve_incident_occurrence_window, snapshot_revision, unix_time_now, GdeltLocationMarker,
    GpsInterferenceCell, Incident, IncidentEvidenceCluster, InternetOutageMarker,
    NativeDataPackage, OsintSnapshot,
};
use filter::{
    build_search_haystacks, incident_matches, scan_corpus, spawn_filter_analysis_worker,
    time_window_cutoff, CategoryGroup, FilterAnalysisJob, FilterAnalysisOutcome, FilterPass,
    IncidentFilterSpec, ScopeOption, TimeWindowKey, SEVERITY_KEYS,
};
use playback::{
    detect_reduced_motion, format_duration_seconds, format_utc_exact, summarize_playback_events,
    unresolved_window_intersects_playback_frame, IncidentPlaybackAnalyses,
    IncidentPlaybackController, PlaybackEventSummary, PlaybackExtraction, PlaybackMode,
};
use refresh::{
    config_from_env_and_args, spawn_refresh_worker, ActiveSnapshot, RefreshCommand, RefreshMessage,
    SnapshotSourceKind, SourceAttempt,
};
use satellite::{
    build_satellite_propagators, propagate_satellites, SatellitePosition, SatellitePropagator,
};
use std::borrow::Cow;
use std::str::FromStr;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

const EARTH_RADIUS: f32 = 2.0;
const INCIDENT_CAP: usize = 900;
const NATURAL_CAP: usize = 70;
const LAUNCH_CAP: usize = 24;
const OUTAGE_CAP: usize = 220;
const GDELT_CAP: usize = 240;
const MARKER_CHUNK: usize = 800;

fn severity_color(severity: &str) -> Color {
    match severity {
        "critical" | "c" => Color::new(1.0, 0.08, 0.22, 1.0),
        "high" | "h" => Color::new(1.0, 0.48, 0.0, 1.0),
        "medium" | "m" => Color::new(1.0, 0.78, 0.28, 1.0),
        _ => Color::new(0.2, 0.82, 0.52, 1.0),
    }
}

fn rgb(hex: u32, alpha: f32) -> Color {
    Color::new(
        ((hex >> 16) & 0xff) as f32 / 255.0,
        ((hex >> 8) & 0xff) as f32 / 255.0,
        (hex & 0xff) as f32 / 255.0,
        alpha,
    )
}

fn classify_aircraft_role(aircraft_type: Option<&str>) -> (&'static str, Color) {
    let kind = aircraft_type.unwrap_or("").to_ascii_uppercase();
    if kind.starts_with("KC")
        || kind.starts_with("K35")
        || kind.starts_with("K46")
        || kind.starts_with("K10")
        || kind.starts_with("A330")
        || kind.starts_with("A3M")
        || kind.starts_with("MMRT")
    {
        ("Tanker", rgb(0xe2b75e, 1.0))
    } else if kind.starts_with("E2")
        || kind.starts_with("E3")
        || kind.starts_with("E7")
        || kind.starts_with("E11")
        || kind.starts_with("RC")
        || kind.starts_with("R135")
        || kind.starts_with("U2")
        || kind.starts_with("P8")
        || kind.starts_with("RQ")
        || kind.starts_with("MQ")
        || kind.starts_with("GLEX")
        || kind.starts_with("JSTARS")
    {
        ("ISR / surveillance", rgb(0x8fb8d8, 1.0))
    } else if kind.starts_with("B1")
        || kind.starts_with("B2")
        || kind.starts_with("B52")
        || kind.starts_with("TU95")
        || kind.starts_with("TU160")
    {
        ("Strategic bomber", rgb(0xff6b6b, 1.0))
    } else if kind.starts_with("F15")
        || kind.starts_with("F16")
        || kind.starts_with("F18")
        || kind.starts_with("FA18")
        || kind.starts_with("F22")
        || kind.starts_with("F35")
        || kind.starts_with("EF")
        || kind.starts_with("MIG")
        || kind.starts_with("SU")
        || kind.starts_with("J10")
        || kind.starts_with("J20")
    {
        ("Combat aircraft", rgb(0xf2f0df, 1.0))
    } else if kind.starts_with("C5")
        || kind.starts_with("C17")
        || kind.starts_with("C130")
        || kind.starts_with("C30J")
        || kind.starts_with("A400")
        || kind.starts_with("AN124")
        || kind.starts_with("IL76")
        || kind.starts_with("C2")
        || kind.starts_with("C12")
        || kind.starts_with("C32")
        || kind.starts_with("C37")
        || kind.starts_with("C40")
    {
        ("Transport / logistics", rgb(0xb8c29a, 1.0))
    } else if kind.starts_with("H60")
        || kind.starts_with("UH")
        || kind.starts_with("HH")
        || kind.starts_with("CH")
        || kind.starts_with("AH")
        || kind.starts_with("H64")
        || kind.starts_with("V22")
    {
        ("Rotary / tiltrotor", rgb(0x9ec78f, 1.0))
    } else {
        ("Military aviation", rgb(0xb8c29a, 1.0))
    }
}

fn natural_event_color(category: &str, kind: &str) -> Color {
    let category = category.to_ascii_lowercase();
    let kind = kind.to_ascii_lowercase();
    if category.contains("red") {
        rgb(0xff5c5c, 1.0)
    } else if category.contains("orange") {
        rgb(0xff9f2e, 1.0)
    } else if kind.contains("tc") || category.contains("cyclone") {
        rgb(0x9d7bea, 1.0)
    } else if kind.contains("fl") || category.contains("flood") {
        rgb(0x5aa7ff, 1.0)
    } else if kind.contains("dr") || category.contains("drought") {
        rgb(0xe2b75e, 1.0)
    } else if kind.contains("wf") || category.contains("wildfire") {
        rgb(0xff6b45, 1.0)
    } else if kind.contains("vo") || category.contains("volcano") {
        rgb(0xff7a59, 1.0)
    } else if kind.contains("eq") || category.contains("earthquake") {
        rgb(0xff9f2e, 1.0)
    } else {
        rgb(0x30d158, 1.0)
    }
}

fn lat_lng_to_vec3(lat: f32, lng: f32, radius: f32) -> Vec3 {
    let lat = lat.to_radians();
    let lng = lng.to_radians();
    vec3(
        radius * lat.cos() * lng.cos(),
        radius * lat.sin(),
        radius * lat.cos() * lng.sin(),
    )
}

fn camera_position(yaw: f32, pitch: f32, distance: f32) -> Vec3 {
    vec3(
        distance * pitch.cos() * yaw.cos(),
        distance * pitch.sin(),
        distance * pitch.cos() * yaw.sin(),
    )
}

fn angle_delta(target: f32, current: f32) -> f32 {
    let mut delta = target - current;
    while delta > std::f32::consts::PI {
        delta -= std::f32::consts::TAU;
    }
    while delta < -std::f32::consts::PI {
        delta += std::f32::consts::TAU;
    }
    delta
}

fn track_end(lat: f32, lng: f32, track: f32, speed: f32, horizon_hours: f32) -> (f32, f32) {
    let distance_nm = (speed * horizon_hours).min(260.0);
    let angular = distance_nm / 3440.065;
    let bearing = track.to_radians();
    let lat1 = lat.to_radians();
    let lng1 = lng.to_radians();
    let lat2 = (lat1.sin() * angular.cos() + lat1.cos() * angular.sin() * bearing.cos()).asin();
    let lng2 = lng1
        + (bearing.sin() * angular.sin() * lat1.cos())
            .atan2(angular.cos() - lat1.sin() * lat2.sin());
    let mut end_lng = (lng2.to_degrees() + 540.0) % 360.0 - 180.0;
    if (end_lng - lng).abs() > 180.0 {
        end_lng = lng;
    }
    (lat2.to_degrees(), end_lng)
}

fn slerp_unit(a: Vec3, b: Vec3, t: f32) -> Vec3 {
    let dot = a.dot(b).clamp(-1.0, 1.0);
    if dot > 0.9995 {
        return (a + (b - a) * t).normalize_or_zero();
    }
    let theta = dot.acos();
    let sin_theta = theta.sin();
    (a * ((1.0 - t) * theta).sin() + b * (t * theta).sin()) / sin_theta
}

fn append_octahedron(
    vertices: &mut Vec<Vertex>,
    indices: &mut Vec<u16>,
    center: Vec3,
    radius: f32,
    color: Color,
) {
    let base = vertices.len() as u16;
    let offsets = [
        vec3(radius, 0.0, 0.0),
        vec3(-radius, 0.0, 0.0),
        vec3(0.0, radius, 0.0),
        vec3(0.0, -radius, 0.0),
        vec3(0.0, 0.0, radius),
        vec3(0.0, 0.0, -radius),
    ];
    for offset in offsets {
        vertices.push(Vertex::new2(center + offset, vec2(0.0, 0.0), color));
    }
    let faces = [
        (0, 2, 4),
        (4, 2, 1),
        (1, 2, 5),
        (5, 2, 0),
        (4, 3, 0),
        (1, 3, 4),
        (5, 3, 1),
        (0, 3, 5),
    ];
    for (a, b, c) in faces {
        indices.extend_from_slice(&[base + a, base + b, base + c]);
    }
}

struct RibbonBuilder {
    vertices: Vec<Vertex>,
    indices: Vec<u16>,
    meshes: Vec<Mesh>,
}

impl RibbonBuilder {
    fn new() -> Self {
        Self {
            vertices: Vec::new(),
            indices: Vec::new(),
            meshes: Vec::new(),
        }
    }

    fn flush(&mut self) {
        if !self.vertices.is_empty() {
            self.meshes.push(Mesh {
                vertices: std::mem::take(&mut self.vertices),
                indices: std::mem::take(&mut self.indices),
                texture: None,
            });
        }
    }

    fn push_segment(&mut self, a: Vec3, b: Vec3, width: f32, color: Color) {
        if self.vertices.len() + 4 > 15000 || self.indices.len() + 6 > 22000 {
            self.flush();
        }
        let direction = (b - a).normalize_or_zero();
        if direction.length_squared() < 0.000001 {
            return;
        }
        let radial = ((a + b) * 0.5).normalize_or_zero();
        let side = direction.cross(radial).normalize_or_zero() * width * 0.5;
        if side.length_squared() < 0.000001 {
            return;
        }
        let base = self.vertices.len() as u16;
        for point in [a - side, a + side, b + side, b - side] {
            self.vertices
                .push(Vertex::new2(point, vec2(0.0, 0.0), color));
        }
        self.indices
            .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }

    fn finish(mut self) -> Vec<Mesh> {
        self.flush();
        self.meshes
    }
}

fn append_surface_polyline(
    builder: &mut RibbonBuilder,
    points: &[(f32, f32)],
    radius: f32,
    width: f32,
    color: Color,
    closed: bool,
) {
    if points.len() < 2 {
        return;
    }
    let world: Vec<Vec3> = points
        .iter()
        .map(|(lat, lng)| lat_lng_to_vec3(*lat, *lng, radius))
        .collect();
    let segment_count = if closed {
        world.len()
    } else {
        world.len().saturating_sub(1)
    };
    for index in 0..segment_count {
        let next = (index + 1) % world.len();
        let a = world[index];
        let b = world[next];
        if a.distance(b) > radius * 0.8 {
            continue;
        }
        builder.push_segment(a, b, width, color);
    }
}

fn build_border_meshes() -> Vec<Mesh> {
    let mut builder = RibbonBuilder::new();
    let Ok(geojson) =
        include_str!("../../../frontend/public/data/ne_110m_admin_0_countries.geojson")
            .parse::<geojson::GeoJson>()
    else {
        return Vec::new();
    };
    let geojson::GeoJson::FeatureCollection(collection) = geojson else {
        return Vec::new();
    };
    let color = Color::new(0.48, 0.43, 0.3, 0.28);
    for feature in collection.features {
        let Some(geometry) = feature.geometry else {
            continue;
        };
        match geometry.value {
            geojson::GeometryValue::Polygon {
                coordinates: polygon,
            } => {
                for ring in polygon {
                    let points: Vec<(f32, f32)> = ring
                        .iter()
                        .filter_map(|point| {
                            (point.len() >= 2).then_some((point[1] as f32, point[0] as f32))
                        })
                        .collect();
                    append_surface_polyline(
                        &mut builder,
                        &points,
                        EARTH_RADIUS * 1.004,
                        0.0024,
                        color,
                        true,
                    );
                }
            }
            geojson::GeometryValue::MultiPolygon {
                coordinates: multipolygon,
            } => {
                for polygon in multipolygon {
                    for ring in polygon {
                        let points: Vec<(f32, f32)> = ring
                            .iter()
                            .filter_map(|point| {
                                (point.len() >= 2).then_some((point[1] as f32, point[0] as f32))
                            })
                            .collect();
                        append_surface_polyline(
                            &mut builder,
                            &points,
                            EARTH_RADIUS * 1.004,
                            0.0024,
                            color,
                            true,
                        );
                    }
                }
            }
            _ => {}
        }
    }
    builder.finish()
}

#[derive(Clone, Copy)]
struct RenderMarker {
    center: Vec3,
    radius: f32,
    color: Color,
}

fn build_marker_meshes(markers: &[RenderMarker]) -> Vec<Mesh> {
    markers
        .chunks(MARKER_CHUNK)
        .map(|chunk| {
            let mut vertices = Vec::with_capacity(chunk.len() * 6);
            let mut indices = Vec::with_capacity(chunk.len() * 24);
            for marker in chunk {
                append_octahedron(
                    &mut vertices,
                    &mut indices,
                    marker.center,
                    marker.radius,
                    marker.color,
                );
            }
            Mesh {
                vertices,
                indices,
                texture: None,
            }
        })
        .collect()
}

fn build_point_meshes<T, Position, ColorFn, RadiusFn>(
    items: &[T],
    cap: usize,
    altitude_scale: f32,
    position: Position,
    color_fn: ColorFn,
    radius_fn: RadiusFn,
) -> Vec<Mesh>
where
    Position: Fn(&T) -> (f32, f32),
    ColorFn: Fn(&T) -> Color,
    RadiusFn: Fn(&T) -> f32,
{
    let mut markers = Vec::with_capacity(items.len().min(cap));
    for item in items.iter().take(cap) {
        let (lat, lng) = position(item);
        if !lat.is_finite() || !lng.is_finite() {
            continue;
        }
        markers.push(RenderMarker {
            center: lat_lng_to_vec3(lat, lng, EARTH_RADIUS * altitude_scale),
            radius: radius_fn(item),
            color: color_fn(item),
        });
    }
    build_marker_meshes(&markers)
}

struct DetailMeshes {
    far: Vec<Mesh>,
    medium: Vec<Mesh>,
    near: Vec<Mesh>,
}

impl DetailMeshes {
    fn for_level(&self, level: usize) -> &[Mesh] {
        match level {
            2 => &self.near,
            1 => &self.medium,
            _ => &self.far,
        }
    }
}

fn build_detail_meshes<T, Position, ColorFn, RadiusFn>(
    items: &[T],
    altitude_scale: f32,
    position: Position,
    color_fn: ColorFn,
    radius_fn: RadiusFn,
    caps: (usize, usize, usize),
) -> DetailMeshes
where
    Position: Fn(&T) -> (f32, f32),
    ColorFn: Fn(&T) -> Color,
    RadiusFn: Fn(&T) -> f32,
{
    DetailMeshes {
        far: build_point_meshes(
            items,
            caps.0,
            altitude_scale,
            &position,
            &color_fn,
            &radius_fn,
        ),
        medium: build_point_meshes(
            items,
            caps.1,
            altitude_scale,
            &position,
            &color_fn,
            &radius_fn,
        ),
        near: build_point_meshes(
            items,
            caps.2,
            altitude_scale,
            &position,
            &color_fn,
            &radius_fn,
        ),
    }
}

#[derive(Clone, Copy)]
struct TrackInput {
    lat: f32,
    lng: f32,
    track: Option<f32>,
    speed: Option<f32>,
}

fn build_track_meshes(
    inputs: &[TrackInput],
    cap: usize,
    minimum_speed: f32,
    horizon_hours: f32,
    altitude_scale: f32,
    width: f32,
    color: Color,
) -> Vec<Mesh> {
    let mut builder = RibbonBuilder::new();
    let mut used = 0usize;
    for item in inputs {
        if used >= cap {
            break;
        }
        let (Some(track), Some(speed)) = (item.track, item.speed) else {
            continue;
        };
        if speed <= minimum_speed {
            continue;
        }
        used += 1;
        let (end_lat, end_lng) = track_end(item.lat, item.lng, track, speed, horizon_hours);
        let start = lat_lng_to_vec3(item.lat, item.lng, 1.0).normalize_or_zero();
        let end = lat_lng_to_vec3(end_lat, end_lng, 1.0).normalize_or_zero();
        if start.length_squared() < 0.5 || end.length_squared() < 0.5 {
            continue;
        }
        let mut previous = start * EARTH_RADIUS * altitude_scale;
        for step in 1..=7 {
            let current = slerp_unit(start, end, step as f32 / 7.0) * EARTH_RADIUS * altitude_scale;
            builder.push_segment(previous, current, width, color);
            previous = current;
        }
    }
    builder.finish()
}

fn gps_cell_center(hex: &str) -> Option<(f32, f32)> {
    let index = h3o::CellIndex::from_str(hex).ok()?;
    let center = h3o::LatLng::from(index);
    Some((center.lat() as f32, center.lng() as f32))
}

fn build_gps_meshes(cells: &[GpsInterferenceCell]) -> Vec<Mesh> {
    let mut builder = RibbonBuilder::new();
    for cell in cells.iter().take(500) {
        let Ok(index) = h3o::CellIndex::from_str(&cell.hex) else {
            continue;
        };
        let mut points: Vec<(f32, f32)> = index
            .boundary()
            .iter()
            .map(|point| (point.lat() as f32, point.lng() as f32))
            .collect();
        if points.len() < 3 {
            continue;
        }
        if let Some(first) = points.first().copied() {
            points.push(first);
        }
        let color = match cell.level.as_str() {
            "high" => Color::new(1.0, 0.18, 0.16, 0.52),
            "medium" => Color::new(1.0, 0.55, 0.12, 0.44),
            _ => Color::new(1.0, 0.78, 0.25, 0.32),
        };
        let width = (if cell.level == "high" { 0.0025 } else { 0.0017 })
            + cell.affected_share.clamp(0.0, 1.0) * 0.0014;
        append_surface_polyline(
            &mut builder,
            &points,
            EARTH_RADIUS * 1.009,
            width,
            color,
            false,
        );
    }
    builder.finish()
}

fn build_outage_reticle_meshes(markers: &[InternetOutageMarker]) -> Vec<Mesh> {
    let mut builder = RibbonBuilder::new();
    for marker in markers.iter().take(OUTAGE_CAP) {
        let radius_degrees = if marker.entity_type == "country" {
            0.72
        } else {
            0.46
        };
        let longitude_radius =
            (radius_degrees / marker.lat.to_radians().cos().abs().max(0.28)).min(1.8);
        let points = [
            (marker.lat + radius_degrees, marker.lng),
            (marker.lat, marker.lng + longitude_radius),
            (marker.lat - radius_degrees, marker.lng),
            (marker.lat, marker.lng - longitude_radius),
        ];
        let color = if marker.entity_type == "country" {
            rgb(0x75bdd1, 0.46)
        } else {
            rgb(0x548498, 0.38)
        };
        append_surface_polyline(
            &mut builder,
            &points,
            EARTH_RADIUS * 1.012,
            0.0016,
            color,
            true,
        );
    }
    builder.finish()
}

fn incident_radius(severity: &str) -> f32 {
    match severity {
        "critical" | "c" => 0.024,
        "high" | "h" => 0.018,
        "medium" | "m" => 0.013,
        _ => 0.009,
    }
}

fn playback_incident_markers<'a>(
    incidents: &'a [Incident],
    corpus_indices: &'a [usize],
    cap: usize,
    extraction: &PlaybackExtraction,
) -> Vec<RenderMarker> {
    corpus_indices
        .iter()
        .filter_map(|index| incidents.get(*index))
        .take(cap)
        .map(|event| {
            let unresolved =
                unresolved_window_intersects_playback_frame(event, Some(&extraction.frame));
            let mut color = severity_color(&event.severity);
            if unresolved {
                color.a *= 0.48;
            }
            RenderMarker {
                center: lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006),
                radius: incident_radius(&event.severity),
                color,
            }
        })
        .collect()
}

fn build_playback_incident_meshes(
    incidents: &[Incident],
    corpus_indices: &[usize],
    extraction: &PlaybackExtraction,
) -> (Vec<Mesh>, Vec<Mesh>) {
    let near = build_marker_meshes(&playback_incident_markers(
        incidents,
        corpus_indices,
        INCIDENT_CAP,
        extraction,
    ));
    let priority_indices: Vec<usize> = corpus_indices
        .iter()
        .copied()
        .filter(|index| {
            incidents.get(*index).is_some_and(|event| {
                matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
            })
        })
        .take(420)
        .collect();
    let far = build_marker_meshes(&playback_incident_markers(
        incidents,
        &priority_indices,
        420,
        extraction,
    ));
    (near, far)
}

struct PlaybackVisualCache {
    extraction_version: u64,
    near: Vec<Mesh>,
    far_priority: Vec<Mesh>,
    /// Corpus-position visibility: which canonical incidents the current extraction renders.
    visible_mask: Vec<bool>,
    /// Extraction rows remapped into canonical corpus positions, preserving extraction order.
    /// Picking, priority lists, and selection visibility tests all operate in corpus space.
    corpus_indices: Vec<usize>,
    summary: PlaybackEventSummary,
    rebuild_ms: f64,
}

fn playback_index_visible_at_detail(
    incidents: &[Incident],
    corpus_indices: &[usize],
    incident_index: usize,
    level: usize,
) -> bool {
    if level == 0 {
        corpus_indices
            .iter()
            .copied()
            .filter(|index| {
                incidents.get(*index).is_some_and(|event| {
                    matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
                })
            })
            .take(420)
            .any(|index| index == incident_index)
    } else {
        corpus_indices
            .iter()
            .copied()
            .take(INCIDENT_CAP)
            .any(|index| index == incident_index)
    }
}

/// Remap extraction rows (positions inside the filtered analysis input) into canonical corpus
/// positions through the scan index vector. Rows beyond the index vector are dropped rather
/// than silently misattributed; the drop count is disclosed through the length difference.
fn remap_extraction_indices(extraction: &PlaybackExtraction, scope_indices: &[u32]) -> Vec<usize> {
    extraction
        .event_indices
        .iter()
        .filter_map(|position| scope_indices.get(*position).map(|index| *index as usize))
        .collect()
}

fn build_playback_visual_cache(
    incidents: &[Incident],
    scope_indices: &[u32],
    extraction: &PlaybackExtraction,
    extraction_version: u64,
) -> PlaybackVisualCache {
    let started = Instant::now();
    let corpus_indices = remap_extraction_indices(extraction, scope_indices);
    let (near, far_priority) =
        build_playback_incident_meshes(incidents, &corpus_indices, extraction);
    let mut visible_mask = vec![false; incidents.len()];
    for index in &corpus_indices {
        if let Some(slot) = visible_mask.get_mut(*index) {
            *slot = true;
        }
    }
    let summary = summarize_playback_events(
        corpus_indices
            .iter()
            .filter_map(|index| incidents.get(*index)),
    );
    PlaybackVisualCache {
        extraction_version,
        near,
        far_priority,
        visible_mask,
        corpus_indices,
        summary,
        rebuild_ms: started.elapsed().as_secs_f64() * 1000.0,
    }
}

fn build_satellite_mesh(positions: &[SatellitePosition]) -> Vec<Mesh> {
    let markers: Vec<RenderMarker> = positions
        .iter()
        .map(|position| {
            let normalized_altitude = (0.035 + position.altitude_km / 22000.0).min(0.22);
            RenderMarker {
                center: lat_lng_to_vec3(
                    position.lat,
                    position.lng,
                    EARTH_RADIUS * (1.0 + normalized_altitude),
                ),
                radius: 0.012,
                color: rgb(0xd8c77f, 1.0),
            }
        })
        .collect();
    build_marker_meshes(&markers)
}

struct SceneMeshes {
    military: DetailMeshes,
    civil: DetailMeshes,
    vessels: DetailMeshes,
    military_tracks: Vec<Mesh>,
    civil_tracks: Vec<Mesh>,
    vessel_tracks: Vec<Mesh>,
    natural: Vec<Mesh>,
    launches: Vec<Mesh>,
    outages: Vec<Mesh>,
    outage_reticles: Vec<Mesh>,
    gdelt: Vec<Mesh>,
}

/// Static incident marker meshes for the current filter scope, in extraction-free corpus order.
/// Rebuilt only when the scope output or the corpus itself changes — never per frame.
struct IncidentMeshes {
    near: Vec<Mesh>,
    far_priority: Vec<Mesh>,
    build_ms: f64,
}

fn scoped_incident_markers<'a>(
    incidents: &'a [Incident],
    scope_indices: &'a [u32],
    cap: usize,
) -> Vec<RenderMarker> {
    scope_indices
        .iter()
        .filter_map(|index| incidents.get(*index as usize))
        .take(cap)
        .map(|event| RenderMarker {
            center: lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006),
            radius: incident_radius(&event.severity),
            color: severity_color(&event.severity),
        })
        .collect()
}

fn build_incident_meshes(incidents: &[Incident], scope_indices: &[u32]) -> IncidentMeshes {
    let started = Instant::now();
    let near = build_marker_meshes(&scoped_incident_markers(
        incidents,
        scope_indices,
        INCIDENT_CAP,
    ));
    let priority_indices: Vec<u32> = scope_indices
        .iter()
        .copied()
        .filter(|index| {
            incidents.get(*index as usize).is_some_and(|event| {
                matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
            })
        })
        .take(420)
        .collect();
    let far_priority =
        build_marker_meshes(&scoped_incident_markers(incidents, &priority_indices, 420));
    IncidentMeshes {
        near,
        far_priority,
        build_ms: started.elapsed().as_secs_f64() * 1000.0,
    }
}

fn build_scene_meshes(
    osint: &OsintSnapshot,
    outage_markers: &[InternetOutageMarker],
    gdelt_markers: &[GdeltLocationMarker],
) -> SceneMeshes {
    let military = build_detail_meshes(
        &osint.military_aircraft,
        1.035,
        |item| (item.lat, item.lng),
        |item| classify_aircraft_role(item.aircraft_type.as_deref()).1,
        |_| 0.012,
        (120, 190, 240),
    );
    let civil = build_detail_meshes(
        &osint.aircraft,
        1.032,
        |item| (item.lat, item.lng),
        |item| {
            if item.operator_class.contains("cargo") {
                rgb(0xf0a84f, 1.0)
            } else {
                rgb(0x9fb7a8, 1.0)
            }
        },
        |_| 0.0085,
        (260, 480, 700),
    );
    let vessels = build_detail_meshes(
        &osint.vessels,
        1.014,
        |item| (item.lat, item.lng),
        |item| match item.vessel_class.as_str() {
            "Tanker" => rgb(0xd59b6a, 1.0),
            "Cargo" => rgb(0x7da6a1, 1.0),
            _ => rgb(0x8f9b7d, 1.0),
        },
        |_| 0.009,
        (380, 650, 900),
    );

    let military_inputs: Vec<TrackInput> = osint
        .military_aircraft
        .iter()
        .map(|item| TrackInput {
            lat: item.lat,
            lng: item.lng,
            track: item.track,
            speed: item.speed,
        })
        .collect();
    let civil_inputs: Vec<TrackInput> = osint
        .aircraft
        .iter()
        .map(|item| TrackInput {
            lat: item.lat,
            lng: item.lng,
            track: item.track,
            speed: item.speed,
        })
        .collect();
    let vessel_inputs: Vec<TrackInput> = osint
        .vessels
        .iter()
        .map(|item| TrackInput {
            lat: item.lat,
            lng: item.lng,
            track: item.course,
            speed: item.speed,
        })
        .collect();

    SceneMeshes {
        military,
        civil,
        vessels,
        military_tracks: build_track_meshes(
            &military_inputs,
            180,
            70.0,
            0.28,
            1.035,
            0.0022,
            rgb(0xb8c29a, 0.34),
        ),
        civil_tracks: build_track_meshes(
            &civil_inputs,
            150,
            90.0,
            0.2,
            1.032,
            0.0016,
            rgb(0x9fb7a8, 0.25),
        ),
        vessel_tracks: build_track_meshes(
            &vessel_inputs,
            180,
            3.0,
            3.5,
            1.014,
            0.0018,
            rgb(0x7da6a1, 0.30),
        ),
        natural: build_point_meshes(
            &osint.natural_events,
            NATURAL_CAP,
            1.014,
            |item| (item.lat, item.lng),
            |item| natural_event_color(&item.category, &item.kind),
            |_| 0.013,
        ),
        launches: build_point_meshes(
            &osint.launches,
            LAUNCH_CAP,
            1.015,
            |item| (item.lat, item.lng),
            |_| rgb(0xbf5af2, 1.0),
            |_| 0.016,
        ),
        outages: build_point_meshes(
            outage_markers,
            OUTAGE_CAP,
            1.017,
            |item| (item.lat, item.lng),
            |item| {
                if item.entity_type == "country" {
                    rgb(0x75bdd1, 1.0)
                } else {
                    rgb(0x548498, 1.0)
                }
            },
            |item| {
                if item.entity_type == "country" {
                    0.014
                } else {
                    0.010
                }
            },
        ),
        outage_reticles: build_outage_reticle_meshes(outage_markers),
        gdelt: build_point_meshes(
            gdelt_markers,
            GDELT_CAP,
            1.013,
            |item| (item.lat, item.lng),
            |item| {
                if matches!(
                    item.coordinate_precision.as_str(),
                    "us-city-or-landmark" | "world-city-or-landmark"
                ) {
                    rgb(0x9fb0c9, 1.0)
                } else {
                    rgb(0x6d7a91, 1.0)
                }
            },
            |item| (0.007 + (item.article_indices.len() as f32).ln_1p() * 0.003).min(0.016),
        ),
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output: String = value.chars().take(max_chars.saturating_sub(3)).collect();
    output.push_str("...");
    output
}

fn wrap_text(value: &str, max_chars: usize, max_lines: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in value.split_whitespace() {
        if current.chars().count() + word.chars().count() + usize::from(!current.is_empty())
            > max_chars
        {
            lines.push(current);
            current = String::new();
            if lines.len() >= max_lines {
                break;
            }
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if lines.len() < max_lines && !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn project_point(camera: &Camera3D, point: Vec3) -> Option<Vec2> {
    let clip = camera.matrix() * point.extend(1.0);
    if clip.w <= 0.0 {
        return None;
    }
    let ndc = clip.truncate() / clip.w;
    if ndc.z < -1.0 || ndc.z > 1.0 {
        return None;
    }
    Some(vec2(
        (ndc.x + 1.0) * 0.5 * screen_width(),
        (1.0 - ndc.y) * 0.5 * screen_height(),
    ))
}

fn format_relative_unix(ts: Option<f64>) -> String {
    let Some(ts) = ts else {
        return "not supplied".to_string();
    };
    let now = unix_time_now();
    let delta = now - ts;
    if delta < -3600.0 {
        format!("in {:.1}h", -delta / 3600.0)
    } else if delta < -60.0 {
        format!("in {:.0}m", -delta / 60.0)
    } else if delta < 60.0 {
        "just now".to_string()
    } else if delta < 3600.0 {
        format!("{:.0}m ago", delta / 60.0)
    } else if delta < 86400.0 {
        format!("{:.1}h ago", delta / 3600.0)
    } else {
        format!("{:.0}d ago", delta / 86400.0)
    }
}

fn format_relative_iso(value: Option<&str>) -> String {
    value
        .and_then(parse_rfc3339_unix)
        .map(|timestamp| format_relative_unix(Some(timestamp)))
        .unwrap_or_else(|| "not supplied".to_string())
}

fn format_optional_number(value: Option<f32>, suffix: &str) -> String {
    value
        .map(|number| format!("{}{}", number, suffix))
        .unwrap_or_else(|| "not supplied".to_string())
}

fn draw_panel(x: f32, y: f32, w: f32, h: f32) {
    draw_rectangle(x, y, w, h, Color::new(0.015, 0.022, 0.018, 0.88));
    draw_rectangle_lines(x, y, w, h, 1.0, Color::new(0.68, 0.57, 0.3, 0.28));
}

fn display_text(text: &str) -> Cow<'_, str> {
    if text.is_ascii() {
        return Cow::Borrowed(text);
    }
    Cow::Owned(
        text.chars()
            .map(|character| match character {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201c}' | '\u{201d}' => '"',
                '\u{2013}' | '\u{2014}' => '-',
                '\u{2026}' => '.',
                '\u{00b7}' => '.',
                value if value.is_ascii() => value,
                _ => '?',
            })
            .collect(),
    )
}

fn draw_text_mono(text: &str, x: f32, y: f32, size: f32, color: Color) {
    draw_text(display_text(text).as_ref(), x, y, size, color);
}

fn window_conf() -> Conf {
    Conf {
        window_title: "GOD'S EYE — Rust Native".to_string(),
        window_width: 1600,
        window_height: 1000,
        high_dpi: true,
        ..Default::default()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Selection {
    Incident(usize),
    MilitaryAircraft(usize),
    CivilAircraft(usize),
    Vessel(usize),
    NaturalEvent(usize),
    Launch(usize),
    InternetOutage(usize),
    GdeltNews(usize),
    GpsInterference(usize),
    Satellite(usize),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ActiveDataSource {
    Embedded,
    LocalFile,
    RemoteUrl,
}

impl ActiveDataSource {
    fn label(self) -> &'static str {
        match self {
            Self::Embedded => "embedded compile-time snapshot",
            Self::LocalFile => "local snapshot file",
            Self::RemoteUrl => "deployed remote snapshot",
        }
    }
}

struct AppData {
    /// Canonical correlated incident corpus. Filtering never mutates or reorders it; the `Arc`
    /// lets the background analysis builder read the identical immutable corpus off-thread.
    incidents: Arc<Vec<Incident>>,
    /// Lowercase search haystacks parallel to `incidents`, precomputed once per corpus load so
    /// per-keystroke rescans never rebuild strings on the render thread.
    incident_haystacks: Arc<Vec<String>>,
    fallback_incidents: Vec<Incident>,
    correlation_stats: IncidentCorrelationStats,
    osint: OsintSnapshot,
    outage_markers: Vec<InternetOutageMarker>,
    gdelt_markers: Vec<GdeltLocationMarker>,
    conflict_generated_at: Option<f64>,
    conflict_source: Option<String>,
    conflict_license: Option<String>,
    load_errors: Vec<String>,
    revision: String,
    active_source: ActiveDataSource,
    active_detail: String,
    active_loaded_unix: f64,
}

impl AppData {
    fn embedded() -> Self {
        let NativeDataPackage {
            normalized_incidents,
            fallback_incidents,
            osint,
            conflict_generated_at,
            conflict_source,
            conflict_license,
            load_errors,
        } = load_embedded();
        let loaded_unix = unix_time_now();
        let correlated = correlate_incidents(normalized_incidents, loaded_unix);
        let outage_markers = build_internet_outage_markers(&osint.internet_outages);
        let gdelt_markers = build_gdelt_location_markers(&osint.gdelt_geo_news);
        let revision = snapshot_revision(&osint);
        let incident_haystacks = Arc::new(build_search_haystacks(&correlated.incidents));
        Self {
            incidents: Arc::new(correlated.incidents),
            incident_haystacks,
            fallback_incidents,
            correlation_stats: correlated.stats,
            osint,
            outage_markers,
            gdelt_markers,
            conflict_generated_at,
            conflict_source,
            conflict_license,
            load_errors,
            revision,
            active_source: ActiveDataSource::Embedded,
            active_detail: "frontend/public/data embedded at compile time".to_string(),
            active_loaded_unix: loaded_unix,
        }
    }

    fn apply_runtime_snapshot(&mut self, active: ActiveSnapshot) {
        self.osint = active.snapshot;
        self.incident_haystacks = Arc::new(build_search_haystacks(&active.incidents));
        self.incidents = Arc::new(active.incidents);
        self.correlation_stats = active.correlation_stats;
        self.outage_markers = build_internet_outage_markers(&self.osint.internet_outages);
        self.gdelt_markers = build_gdelt_location_markers(&self.osint.gdelt_geo_news);
        self.revision = active.revision;
        self.update_runtime_provenance(active.source, active.detail, active.received_unix);
    }

    fn update_runtime_provenance(
        &mut self,
        source: SnapshotSourceKind,
        detail: String,
        received_unix: f64,
    ) {
        self.active_source = match source {
            SnapshotSourceKind::LocalFile => ActiveDataSource::LocalFile,
            SnapshotSourceKind::RemoteUrl => ActiveDataSource::RemoteUrl,
        };
        self.active_detail = detail;
        self.active_loaded_unix = received_unix;
    }

    fn correlated_evidence<'a>(&'a self, event: &Incident) -> Option<&'a IncidentEvidenceCluster> {
        let membership = event.incident.as_ref()?;
        self.incidents.iter().find_map(|candidate| {
            let cluster = candidate.evidence.as_ref()?;
            (cluster.canonical_event_id == membership.canonical_event_id).then_some(cluster)
        })
    }
}

struct RuntimeStatus {
    refresh_in_progress: bool,
    refresh_interval: Duration,
    attempts: Vec<SourceAttempt>,
    last_completed_unix: Option<f64>,
    last_cycle: Option<u64>,
    worker_enabled: bool,
    config_warnings: Vec<String>,
}

/// Filter scope pipeline state. The scan itself runs synchronously on the render thread (it is
/// measured around a millisecond in debug builds over the real corpus, far less in release);
/// only the multi-millisecond temporal grid prebuild is delegated to the background worker with
/// latest-wins generation coalescing, so fast typing never queues obsolete grids.
struct FilterPipeline {
    spec: IncidentFilterSpec,
    pass: FilterPass,
    /// Monotonic generation of the accepted scan. Playback analyses are valid only when
    /// `applied_generation == generation`; anything else means the grid is stale or in flight.
    generation: u64,
    applied_generation: u64,
    job_tx: Option<Sender<FilterAnalysisJob>>,
    outcome_rx: Option<Receiver<FilterAnalysisOutcome>>,
    worker_available: bool,
    last_build_ms: f64,
    last_build_filtered_count: usize,
    /// Synchronously-built grid awaiting application when the worker is unavailable. Kept in
    /// the same generationed outcome flow as worker results so there is exactly one apply path.
    pending_sync: Option<(u64, IncidentPlaybackAnalyses, usize, f64)>,
    /// Static incident marker meshes must be rebuilt when the scope output changed. The rebuild
    /// is performed once per frame at most, regardless of how many keystrokes landed in it.
    incident_meshes_dirty: bool,
    last_mesh_build_ms: f64,
}

impl FilterPipeline {
    /// Synchronous initial scope: startup builds the first grid inline so the first painted
    /// frame is already consistent — no waiting on the worker for initial state.
    fn initial(
        corpus: &Arc<Vec<Incident>>,
        haystacks: &[String],
        worker: Option<(Sender<FilterAnalysisJob>, Receiver<FilterAnalysisOutcome>)>,
    ) -> (Self, IncidentPlaybackAnalyses) {
        let spec = IncidentFilterSpec::default();
        let pass = scan_corpus(corpus, haystacks, &spec, unix_time_now());
        let (analyses, build_ms) = filter::build_analyses_for_indices(corpus, &pass.indices);
        let (job_tx, outcome_rx, worker_available) = match worker {
            Some((tx, rx)) => (Some(tx), Some(rx), true),
            None => (None, None, false),
        };
        let filtered_count = analyses.coverage.input_event_count;
        (
            Self {
                spec,
                pass,
                generation: 0,
                applied_generation: 0,
                job_tx,
                outcome_rx,
                worker_available,
                last_build_ms: build_ms,
                last_build_filtered_count: filtered_count,
                pending_sync: None,
                incident_meshes_dirty: true,
                last_mesh_build_ms: 0.0,
            },
            analyses,
        )
    }

    /// Rescan the corpus for the current spec. Sends a rebuild job only when the scope output
    /// actually changed (or `force` is set for corpus replacement); unchanged outputs keep the
    /// existing temporal grid valid byte-for-byte, so keystrokes that do not alter membership
    /// cost only the scan itself.
    fn rescan(&mut self, corpus: &Arc<Vec<Incident>>, haystacks: &[String], force: bool) {
        let pass = scan_corpus(corpus, haystacks, &self.spec, unix_time_now());
        let output_changed = pass.indices != self.pass.indices || force;
        self.pass = pass;
        if !output_changed {
            return;
        }
        self.generation = self.generation.wrapping_add(1);
        self.incident_meshes_dirty = true;
        let job = FilterAnalysisJob {
            generation: self.generation,
            corpus: corpus.clone(),
            indices: self.pass.indices.clone(),
        };
        if let Some(tx) = &self.job_tx {
            if tx.send(job).is_err() {
                // A dead worker is disclosed once through the worker_available flag; subsequent
                // rebuilds fall back to the synchronous path rather than dropping the scope.
                self.worker_available = false;
                self.job_tx = None;
                self.outcome_rx = None;
            }
        }
        if self.job_tx.is_none() {
            // Synchronous fallback: correct before fast. The cost is bounded by the existing
            // playback prebuild envelope and is disclosed in the panel through build timing.
            let (analyses, build_ms) =
                filter::build_analyses_for_indices(corpus, &self.pass.indices);
            let count = analyses.coverage.input_event_count;
            self.pending_sync = Some((self.generation, analyses, count, build_ms));
        }
    }

    /// The most recent worker/fallback outcome generation applied to the controller.
    fn playback_current(&self) -> bool {
        self.generation == self.applied_generation
    }
}

#[derive(Clone, Copy, PartialEq)]
enum PlaybackClickAction {
    ToggleActive,
    SeekFraction(f32),
    JumpStart,
    StepBack,
    TogglePlay,
    StepForward,
    JumpEnd,
    Reset,
    CycleMode,
    SpeedDown,
    SpeedUp,
    CycleResolution,
    CycleTrail,
}

fn playback_panel_rect(height: f32) -> (f32, f32, f32, f32) {
    (18.0, (height - 282.0).max(86.0), 292.0, 192.0)
}

fn point_in_rect(point: Vec2, x: f32, y: f32, w: f32, h: f32) -> bool {
    point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h
}

fn playback_histogram_geometry(height: f32) -> (f32, f32, f32, f32) {
    let (x, y, w, _) = playback_panel_rect(height);
    (x + 10.0, y + 52.0, w - 20.0, 32.0)
}

fn playback_histogram_fraction(mouse_x: f32, height: f32) -> Option<f32> {
    let (x, _, w, _) = playback_histogram_geometry(height);
    (w > 0.0).then_some(((mouse_x - x) / w).clamp(0.0, 1.0))
}

fn playback_point_in_panel(mouse: Vec2, height: f32) -> bool {
    let (x, y, w, h) = playback_panel_rect(height);
    point_in_rect(mouse, x, y, w, h)
}

fn playback_hit_action(mouse: Vec2, height: f32) -> Option<PlaybackClickAction> {
    let (x, y, w, h) = playback_panel_rect(height);
    if !point_in_rect(mouse, x, y, w, h) {
        return None;
    }
    if point_in_rect(mouse, x + 10.0, y + 8.0, 58.0, 18.0) {
        return Some(PlaybackClickAction::ToggleActive);
    }
    let (hx, hy, hw, hh) = playback_histogram_geometry(height);
    if point_in_rect(mouse, hx, hy, hw, hh) {
        return playback_histogram_fraction(mouse.x, height).map(PlaybackClickAction::SeekFraction);
    }
    let row1 = y + 94.0;
    let button_h = 24.0;
    let buttons = [
        (x + 10.0, 28.0, PlaybackClickAction::JumpStart),
        (x + 40.0, 28.0, PlaybackClickAction::StepBack),
        (x + 70.0, 32.0, PlaybackClickAction::TogglePlay),
        (x + 104.0, 28.0, PlaybackClickAction::StepForward),
        (x + 136.0, 28.0, PlaybackClickAction::JumpEnd),
        (x + 166.0, 28.0, PlaybackClickAction::Reset),
        (x + 202.0, 80.0, PlaybackClickAction::CycleMode),
    ];
    for (bx, bw, action) in buttons {
        if point_in_rect(mouse, bx, row1, bw, button_h) {
            return Some(action);
        }
    }
    let row2 = y + 126.0;
    if point_in_rect(mouse, x + 10.0, row2, 28.0, button_h) {
        return Some(PlaybackClickAction::SpeedDown);
    }
    if point_in_rect(mouse, x + 40.0, row2, 28.0, button_h) {
        return Some(PlaybackClickAction::SpeedUp);
    }
    if point_in_rect(mouse, x + 120.0, row2, 76.0, button_h) {
        return Some(PlaybackClickAction::CycleResolution);
    }
    if point_in_rect(mouse, x + 204.0, row2, 78.0, button_h) {
        return Some(PlaybackClickAction::CycleTrail);
    }
    None
}

fn apply_playback_click_action(
    controller: &mut IncidentPlaybackController,
    action: PlaybackClickAction,
) {
    // Mouse transport is intentionally discoverable rather than hidden-stateful: using transport
    // while the lens is off first turns the lens on, then performs the requested interaction.
    let transport = matches!(
        action,
        PlaybackClickAction::SeekFraction(_)
            | PlaybackClickAction::JumpStart
            | PlaybackClickAction::StepBack
            | PlaybackClickAction::TogglePlay
            | PlaybackClickAction::StepForward
            | PlaybackClickAction::JumpEnd
            | PlaybackClickAction::Reset
    );
    if transport && !controller.active() {
        controller.toggle_active();
    }
    match action {
        PlaybackClickAction::ToggleActive => controller.toggle_active(),
        PlaybackClickAction::SeekFraction(fraction) => controller.seek_fraction(fraction as f64),
        PlaybackClickAction::JumpStart => controller.jump_to_start(),
        PlaybackClickAction::StepBack => controller.step_frames(-1),
        PlaybackClickAction::TogglePlay => controller.toggle_playing(),
        PlaybackClickAction::StepForward => controller.step_frames(1),
        PlaybackClickAction::JumpEnd => controller.jump_to_end(),
        PlaybackClickAction::Reset => controller.reset(),
        PlaybackClickAction::CycleMode => controller.cycle_mode(),
        PlaybackClickAction::SpeedDown => controller.cycle_speed(-1),
        PlaybackClickAction::SpeedUp => controller.cycle_speed(1),
        PlaybackClickAction::CycleResolution => controller.cycle_resolution(),
        PlaybackClickAction::CycleTrail => controller.cycle_trail(),
    }
}

struct SatelliteState {
    propagators: Vec<SatellitePropagator>,
    errors: Vec<String>,
    positions: Vec<SatellitePosition>,
    meshes: Vec<Mesh>,
    last_update_unix: f64,
}

impl SatelliteState {
    fn new(osint: &OsintSnapshot) -> Self {
        let (propagators, errors) = build_satellite_propagators(&osint.satellites);
        let now = unix_time_now();
        let positions = propagate_satellites(&propagators, now);
        let meshes = build_satellite_mesh(&positions);
        Self {
            propagators,
            errors,
            positions,
            meshes,
            last_update_unix: now,
        }
    }

    fn rebuild(&mut self, osint: &OsintSnapshot) {
        *self = Self::new(osint);
    }

    fn update_if_due(&mut self) {
        let now = unix_time_now();
        if now - self.last_update_unix < 10.0 {
            return;
        }
        self.positions = propagate_satellites(&self.propagators, now);
        self.meshes = build_satellite_mesh(&self.positions);
        self.last_update_unix = now;
    }
}

fn detail_level(distance: f32) -> usize {
    if distance < 3.8 {
        2
    } else if distance < 5.8 {
        1
    } else {
        0
    }
}

fn draw_meshes(meshes: &[Mesh]) {
    for mesh in meshes {
        draw_mesh(mesh);
    }
}

#[allow(clippy::too_many_arguments)]
fn consider_entity(
    best: &mut Option<(Selection, f32)>,
    camera: &Camera3D,
    mouse: Vec2,
    lat: f32,
    lng: f32,
    radius_world: f32,
    selection: Selection,
    pick_pixels: f32,
) {
    let world = lat_lng_to_vec3(lat, lng, radius_world);
    if world
        .normalize_or_zero()
        .dot(camera.position.normalize_or_zero())
        < 0.04
    {
        return;
    }
    let Some(screen) = project_point(camera, world) else {
        return;
    };
    let delta = (screen - mouse).length();
    if delta > pick_pixels {
        return;
    }
    if best
        .as_ref()
        .map(|(_, best_delta)| delta < *best_delta)
        .unwrap_or(true)
    {
        *best = Some((selection, delta));
    }
}

#[allow(clippy::too_many_arguments)]
fn pick_entity(
    camera: &Camera3D,
    mouse: Vec2,
    data: &AppData,
    satellite_positions: &[SatellitePosition],
    distance: f32,
    show_military: bool,
    show_civil: bool,
    show_maritime: bool,
    show_environment: bool,
    show_orbital: bool,
    show_outages: bool,
    show_gdelt: bool,
    show_gps: bool,
    scope_indices: &[u32],
    playback_corpus_indices: Option<&[usize]>,
) -> Option<Selection> {
    let mut best = None;
    let level = detail_level(distance);
    if level == 0 {
        if let Some(corpus_indices) = playback_corpus_indices {
            // Far playback picking mirrors exactly the severity-filtered, extraction-ordered
            // priority mesh rather than scanning invisible incidents in canonical input order.
            for index in corpus_indices
                .iter()
                .copied()
                .filter(|index| {
                    data.incidents.get(*index).is_some_and(|event| {
                        matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
                    })
                })
                .take(420)
            {
                let event = &data.incidents[index];
                consider_entity(
                    &mut best,
                    camera,
                    mouse,
                    event.lat,
                    event.lng,
                    EARTH_RADIUS * 1.006,
                    Selection::Incident(index),
                    18.0,
                );
            }
        } else {
            // Static scope picking mirrors the far priority mesh: in-scope critical/high rows
            // in scan order. Filtered-out incidents are not clickable — no silent hit targets.
            for index in scope_indices
                .iter()
                .copied()
                .filter(|index| {
                    data.incidents.get(*index as usize).is_some_and(|event| {
                        matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
                    })
                })
                .take(420)
                .map(|index| index as usize)
            {
                let event = &data.incidents[index];
                consider_entity(
                    &mut best,
                    camera,
                    mouse,
                    event.lat,
                    event.lng,
                    EARTH_RADIUS * 1.006,
                    Selection::Incident(index),
                    18.0,
                );
            }
        }
    } else if let Some(corpus_indices) = playback_corpus_indices {
        // Near playback picking mirrors the first capped extraction rows used to construct the
        // incident mesh. Out-of-frame and beyond-cap incidents are therefore not clickable.
        for index in corpus_indices.iter().copied().take(INCIDENT_CAP) {
            let Some(event) = data.incidents.get(index) else {
                continue;
            };
            consider_entity(
                &mut best,
                camera,
                mouse,
                event.lat,
                event.lng,
                EARTH_RADIUS * 1.006,
                Selection::Incident(index),
                18.0,
            );
        }
    } else {
        for index in scope_indices
            .iter()
            .copied()
            .take(INCIDENT_CAP)
            .map(|index| index as usize)
        {
            let Some(event) = data.incidents.get(index) else {
                continue;
            };
            consider_entity(
                &mut best,
                camera,
                mouse,
                event.lat,
                event.lng,
                EARTH_RADIUS * 1.006,
                Selection::Incident(index),
                18.0,
            );
        }
    }

    if show_military {
        let cap = [120usize, 190, 240][level];
        for (index, item) in data.osint.military_aircraft.iter().take(cap).enumerate() {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.035,
                Selection::MilitaryAircraft(index),
                12.0,
            );
        }
    }
    if show_civil {
        let cap = [260usize, 480, 700][level];
        for (index, item) in data.osint.aircraft.iter().take(cap).enumerate() {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.032,
                Selection::CivilAircraft(index),
                10.0,
            );
        }
    }
    if show_maritime {
        let cap = [380usize, 650, 900][level];
        for (index, item) in data.osint.vessels.iter().take(cap).enumerate() {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.014,
                Selection::Vessel(index),
                10.0,
            );
        }
    }
    if show_environment {
        for (index, item) in data
            .osint
            .natural_events
            .iter()
            .take(NATURAL_CAP)
            .enumerate()
        {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.014,
                Selection::NaturalEvent(index),
                12.0,
            );
        }
    }
    if show_orbital {
        for (index, item) in data.osint.launches.iter().take(LAUNCH_CAP).enumerate() {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.015,
                Selection::Launch(index),
                13.0,
            );
        }
        for position in satellite_positions.iter() {
            let normalized_altitude = (0.035 + position.altitude_km / 22000.0).min(0.22);
            consider_entity(
                &mut best,
                camera,
                mouse,
                position.lat,
                position.lng,
                EARTH_RADIUS * (1.0 + normalized_altitude),
                Selection::Satellite(position.source_index),
                12.0,
            );
        }
    }
    if show_outages {
        for (index, item) in data.outage_markers.iter().take(OUTAGE_CAP).enumerate() {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.017,
                Selection::InternetOutage(index),
                13.0,
            );
        }
    }
    if show_gps {
        for (index, item) in data.osint.gps_interference.iter().take(500).enumerate() {
            let Some((lat, lng)) = gps_cell_center(&item.hex) else {
                continue;
            };
            consider_entity(
                &mut best,
                camera,
                mouse,
                lat,
                lng,
                EARTH_RADIUS * 1.009,
                Selection::GpsInterference(index),
                12.0,
            );
        }
    }
    if show_gdelt {
        for (index, item) in data.gdelt_markers.iter().take(GDELT_CAP).enumerate() {
            consider_entity(
                &mut best,
                camera,
                mouse,
                item.lat,
                item.lng,
                EARTH_RADIUS * 1.013,
                Selection::GdeltNews(index),
                11.0,
            );
        }
    }
    best.map(|(selection, _)| selection)
}

fn selection_position(
    selection: Selection,
    data: &AppData,
    satellite_positions: &[SatellitePosition],
) -> Option<(f32, f32, f32)> {
    match selection {
        Selection::Incident(index) => data
            .incidents
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.006)),
        Selection::MilitaryAircraft(index) => data
            .osint
            .military_aircraft
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.035)),
        Selection::CivilAircraft(index) => data
            .osint
            .aircraft
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.032)),
        Selection::Vessel(index) => data
            .osint
            .vessels
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.014)),
        Selection::NaturalEvent(index) => data
            .osint
            .natural_events
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.014)),
        Selection::Launch(index) => data
            .osint
            .launches
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.015)),
        Selection::InternetOutage(index) => data
            .outage_markers
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.017)),
        Selection::GdeltNews(index) => data
            .gdelt_markers
            .get(index)
            .map(|item| (item.lat, item.lng, EARTH_RADIUS * 1.013)),
        Selection::GpsInterference(index) => data
            .osint
            .gps_interference
            .get(index)
            .and_then(|item| gps_cell_center(&item.hex))
            .map(|(lat, lng)| (lat, lng, EARTH_RADIUS * 1.009)),
        Selection::Satellite(index) => satellite_positions
            .iter()
            .find(|position| position.source_index == index)
            .map(|position| {
                let normalized_altitude = (0.035 + position.altitude_km / 22000.0).min(0.22);
                (
                    position.lat,
                    position.lng,
                    EARTH_RADIUS * (1.0 + normalized_altitude),
                )
            }),
    }
}

fn draw_wrapped_lines(
    text: &str,
    x: f32,
    y: &mut f32,
    max_chars: usize,
    max_lines: usize,
    color: Color,
) {
    for line in wrap_text(text, max_chars, max_lines) {
        draw_text_mono(&line, x, *y, 11.0, color);
        *y += 14.0;
    }
}

fn draw_rows(rows: &[(&str, String)], x: f32, mut y: f32, width_chars: usize) -> f32 {
    for (label, value) in rows {
        draw_text_mono(label, x, y, 9.5, Color::new(0.46, 0.45, 0.39, 0.72));
        let value_lines = wrap_text(value, width_chars, 2);
        for (line_index, line) in value_lines.iter().enumerate() {
            draw_text_mono(
                line,
                x + 92.0,
                y + line_index as f32 * 12.0,
                10.5,
                Color::new(0.73, 0.72, 0.65, 0.86),
            );
        }
        y += 15.0 + (value_lines.len().saturating_sub(1) as f32 * 11.0);
    }
    y
}

fn format_unix_window(from: f64, until: f64) -> String {
    format!(
        "{} → {}",
        format_relative_unix(Some(from)),
        format_relative_unix(Some(until))
    )
}

#[allow(clippy::too_many_arguments)]
fn draw_inspector_panel(
    selection: Selection,
    data: &AppData,
    playback_extraction: Option<&PlaybackExtraction>,
    satellite_positions: &[SatellitePosition],
    filter_pipeline: &FilterPipeline,
    x: f32,
    y: f32,
    width: f32,
    max_height: f32,
) {
    let panel_height = max_height.min(760.0);
    draw_panel(x, y, width, panel_height);
    let text_x = x + 15.0;
    let mut cursor_y = y + 26.0;
    let title_color = Color::new(0.91, 0.9, 0.84, 0.96);
    let caveat_color = Color::new(0.53, 0.54, 0.49, 0.76);
    let width_chars = ((width - 124.0) / 6.2).max(18.0) as usize;

    match selection {
        Selection::Incident(index) => {
            let Some(event) = data.incidents.get(index) else {
                return;
            };
            draw_text_mono(
                &format!("TARGET LOCK · {}", event.severity.to_uppercase()),
                text_x,
                cursor_y,
                13.0,
                severity_color(&event.severity),
            );
            cursor_y += 25.0;
            for line in wrap_text(&event.title, 44, 3) {
                draw_text_mono(&line, text_x, cursor_y, 14.5, title_color);
                cursor_y += 17.0;
            }
            cursor_y += 5.0;
            // Scope honesty: a retained selection outside the current filter is disclosed in
            // place rather than silently dropped or silently treated as visible. The incident
            // is not rendered in the scoped scene; this inspector is evidence drill-down only.
            let selection_in_scope = filter_pipeline
                .pass
                .in_scope
                .get(index)
                .copied()
                .unwrap_or(false);
            if !selection_in_scope {
                draw_wrapped_lines(
                    "OUTSIDE CURRENT FILTER SCOPE: retained for evidence inspection; not rendered in the scoped scene or playback grid.",
                    text_x,
                    &mut cursor_y,
                    48,
                    2,
                    Color::new(1.0, 0.62, 0.3, 0.92),
                );
                cursor_y += 4.0;
            }
            let mut rows = vec![
                ("CONFLICT", event.conflict.clone()),
                (
                    "REGION",
                    format!(
                        "{} / {}",
                        event.country,
                        event.region.as_deref().unwrap_or("region not supplied")
                    ),
                ),
                ("CATEGORY", event.category.replace('_', " ")),
                ("CASUALTIES", format_optional_number(event.casualties, "")),
                ("KILLED", format_optional_number(event.killed, "")),
                ("DISPLACED", format_optional_number(event.displaced, "")),
                ("REPORTED", format_relative_unix(event.occurred_at)),
                ("UPDATED", format_relative_unix(event.updated_at)),
                ("POSITION", format!("{:.4} / {:.4}", event.lat, event.lng)),
                (
                    "PRECISION",
                    event
                        .precision
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "VERIFIED",
                    if event.verified {
                        "publisher/source asserts verified".to_string()
                    } else {
                        "not verified".to_string()
                    },
                ),
                (
                    "SOURCE",
                    format!(
                        "{} · {}",
                        event.source_family,
                        event
                            .source_name
                            .as_deref()
                            .unwrap_or("source not supplied")
                    ),
                ),
                ("THEATER", event.theater.clone()),
                (
                    "SRC URL",
                    event
                        .source_url
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "LINKS",
                    format!("{} retained source links", event.sources.len()),
                ),
            ];
            if let Some(detail) = &event.detail {
                rows.push(("DETAIL", truncate_chars(detail, 110)));
            }
            if let Some(ucdp) = &event.ucdp {
                rows.push((
                    "UCDP DYAD",
                    ucdp.dyad_name
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ));
                rows.push((
                    "UCDP SIDES",
                    format!(
                        "{} vs {}",
                        ucdp.side_a.as_deref().unwrap_or("not supplied"),
                        ucdp.side_b.as_deref().unwrap_or("not supplied")
                    ),
                ));
                rows.push((
                    "UCDP FATAL",
                    format!(
                        "low {} · best {} · high {}",
                        format_optional_number(ucdp.low, ""),
                        format_optional_number(ucdp.best, ""),
                        format_optional_number(ucdp.high, "")
                    ),
                ));
                rows.push((
                    "UCDP DATES",
                    format!(
                        "{} → {} · precision {}",
                        ucdp.date_start.as_deref().unwrap_or("not supplied"),
                        ucdp.date_end.as_deref().unwrap_or("not supplied"),
                        ucdp.date_prec
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "not supplied".to_string())
                    ),
                ));
            }
            if let Some(occurrence) = resolve_incident_occurrence_window(event) {
                rows.push((
                    "OCCURRENCE",
                    format!(
                        "{} · {:?} · {}",
                        occurrence.label,
                        occurrence.basis,
                        occurrence.precision.as_str()
                    ),
                ));
                rows.push((
                    "TIME WINDOW",
                    format!(
                        "[{}, {}) · {}",
                        format_utc_exact(occurrence.start),
                        format_utc_exact(occurrence.end_exclusive),
                        format_duration_seconds(occurrence.end_exclusive - occurrence.start)
                    ),
                ));
            }
            if let Some(extraction) = playback_extraction {
                rows.push((
                    "PLAYBACK",
                    format!(
                        "{} frame {} · effective [{}, {}){}",
                        extraction.mode.label().to_lowercase(),
                        extraction.frame_index + 1,
                        format_utc_exact(extraction.effective_start),
                        format_utc_exact(extraction.effective_end_exclusive),
                        if extraction.frame_quantized {
                            " · frame-quantized"
                        } else {
                            ""
                        }
                    ),
                ));
                if unresolved_window_intersects_playback_frame(event, Some(&extraction.frame)) {
                    rows.push((
                        "TIME UNCERT",
                        "unresolved interval intersects this frame; marker is dimmed, not made exact".to_string(),
                    ));
                }
            }
            if let Some(membership) = &event.incident {
                rows.push((
                    "CORRELATION",
                    format!(
                        "{} · {} member{} · {} independent {}",
                        membership.confidence.as_str(),
                        membership.member_count,
                        if membership.member_count == 1 {
                            ""
                        } else {
                            "s"
                        },
                        membership.independent_family_count,
                        if membership.independent_family_count == 1 {
                            "family"
                        } else {
                            "families"
                        }
                    ),
                ));
                rows.push((
                    "CLUSTER ROLE",
                    if membership.is_canonical {
                        "canonical representative".to_string()
                    } else {
                        format!(
                            "linked evidence for canonical {}",
                            truncate_chars(&membership.canonical_event_id, 24)
                        )
                    },
                ));
                rows.push(("CLUSTER", truncate_chars(&membership.cluster_id, 44)));
                rows.push((
                    "MATCH SCORE",
                    if membership.is_canonical {
                        "canonical".to_string()
                    } else {
                        format!("{:.2}", membership.correlation_score)
                    },
                ));
            }
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            if let Some(membership) = &event.incident {
                if !membership.rationale.is_empty() {
                    draw_wrapped_lines(
                        &format!("membership: {}", membership.rationale.join("; ")),
                        text_x,
                        &mut cursor_y,
                        48,
                        2,
                        caveat_color,
                    );
                    cursor_y += 3.0;
                }
            }
            if let Some(evidence) = data.correlated_evidence(event) {
                draw_text_mono(
                    &format!(
                        "CORRELATED EVIDENCE · {} · {} MEMBERS",
                        evidence.confidence.as_str().to_uppercase(),
                        evidence.member_count
                    ),
                    text_x,
                    cursor_y,
                    12.5,
                    severity_color(&event.severity),
                );
                cursor_y += 18.0;
                draw_wrapped_lines(
                    &format!(
                        "{}. Families: {} ({} independent). Cluster {} · {}. Correlation is evidence linkage, not verification.",
                        evidence.confidence_reason,
                        evidence.source_families.join(", "),
                        evidence.independent_family_count,
                        evidence.cluster_id,
                        evidence.algorithm_version
                    ),
                    text_x,
                    &mut cursor_y,
                    48,
                    3,
                    caveat_color,
                );
                for contradiction in evidence.contradictions.iter().take(3) {
                    draw_wrapped_lines(
                        &format!(
                            "Contradiction: {} [records: {}]",
                            contradiction.summary,
                            truncate_chars(&contradiction.member_event_ids.join(", "), 72)
                        ),
                        text_x,
                        &mut cursor_y,
                        48,
                        2,
                        Color::new(1.0, 0.62, 0.34, 0.88),
                    );
                }
                let member_scope_cutoff = time_window_cutoff(
                    filter_pipeline.spec.time_window,
                    filter_pipeline.pass.stats.now,
                );
                let member_scope_query = filter_pipeline.spec.normalized_query();
                let member_in_scope = |member_event: &Incident| -> bool {
                    let haystack = filter::build_search_haystack(member_event);
                    incident_matches(
                        member_event,
                        &haystack,
                        &filter_pipeline.spec,
                        member_scope_cutoff,
                        &member_scope_query,
                    )
                };
                let out_of_scope_members = evidence
                    .members
                    .iter()
                    .filter(|member| !member_in_scope(&member.event))
                    .count();
                if out_of_scope_members > 0 {
                    draw_wrapped_lines(
                        &format!(
                            "{} of {} retained evidence members lie outside the current filter scope; membership itself is never rewritten by filtering.",
                            out_of_scope_members,
                            evidence.members.len()
                        ),
                        text_x,
                        &mut cursor_y,
                        48,
                        2,
                        Color::new(1.0, 0.62, 0.3, 0.85),
                    );
                }
                for member in evidence.members.iter().take(4) {
                    let member_scoped = member_in_scope(&member.event);
                    draw_wrapped_lines(
                        &format!(
                            "+ {} · {} · score {:.2} · {}{}",
                            member.event.id,
                            member.source_family,
                            member.correlation_score,
                            truncate_chars(&member.event.title, 42),
                            if member_scoped {
                                ""
                            } else {
                                " · outside filter scope"
                            }
                        ),
                        text_x,
                        &mut cursor_y,
                        48,
                        2,
                        if member_scoped {
                            Color::new(0.72, 0.82, 0.72, 0.9)
                        } else {
                            Color::new(0.72, 0.62, 0.5, 0.72)
                        },
                    );
                    if !member.rationale.is_empty() {
                        draw_wrapped_lines(
                            &format!("why: {}", member.rationale.join("; ")),
                            text_x + 10.0,
                            &mut cursor_y,
                            46,
                            2,
                            caveat_color,
                        );
                    }
                }
                if evidence.members.len() > 4 {
                    draw_wrapped_lines(
                        &format!(
                            "+ {} additional retained evidence records",
                            evidence.members.len() - 4
                        ),
                        text_x,
                        &mut cursor_y,
                        48,
                        1,
                        caveat_color,
                    );
                }
                cursor_y += 5.0;
            }
            draw_wrapped_lines(
                "Normalized conflict evidence. Correlation indicates deterministic evidence linkage only; causality, intent, truth, and casualty certainty are not implied. Correlation confidence, member counts, and retained reports describe the full loaded evidence cluster; playback is a truthful display-time lens and never truncates or rewrites evidence retrospectively. Optional fields that were absent remain explicitly unavailable.",
                text_x,
                &mut cursor_y,
                48,
                3,
                caveat_color,
            );
        }
        Selection::MilitaryAircraft(index) => {
            let Some(item) = data.osint.military_aircraft.get(index) else {
                return;
            };
            let (role, role_color) = classify_aircraft_role(item.aircraft_type.as_deref());
            draw_text_mono(
                &format!("MILITARY AIRCRAFT · {}", role.to_uppercase()),
                text_x,
                cursor_y,
                13.0,
                role_color,
            );
            cursor_y += 25.0;
            draw_text_mono(
                &truncate_chars(&item.callsign, 32),
                text_x,
                cursor_y,
                17.0,
                title_color,
            );
            cursor_y += 28.0;
            let rows = [
                ("ICAO24", item.id.clone()),
                (
                    "TYPE",
                    item.aircraft_type
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "REGISTRATION",
                    item.registration
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                ("ALTITUDE", format_optional_number(item.altitude, " ft")),
                ("SPEED", format_optional_number(item.speed, " kt")),
                ("TRACK", format_optional_number(item.track, "°")),
                (
                    "SQUAWK",
                    item.squawk
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                ("POSITION", format!("{:.4} / {:.4}", item.lat, item.lng)),
            ];
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "ADSB.lol public snapshot. The projected vector is short-horizon dead reckoning, not a confirmed flight plan or operational intent.",
                text_x,
                &mut cursor_y,
                48,
                3,
                caveat_color,
            );
        }
        Selection::CivilAircraft(index) => {
            let Some(item) = data.osint.aircraft.get(index) else {
                return;
            };
            draw_text_mono(
                "CIVIL AVIATION STATE VECTOR",
                text_x,
                cursor_y,
                13.0,
                rgb(0x9fb7a8, 1.0),
            );
            cursor_y += 25.0;
            draw_text_mono(
                &truncate_chars(&item.callsign, 32),
                text_x,
                cursor_y,
                17.0,
                title_color,
            );
            cursor_y += 28.0;
            let rows = [
                ("ICAO24", item.id.clone()),
                (
                    "ORIGIN",
                    item.origin_country
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                ("CLASS", item.operator_class.clone()),
                ("ALTITUDE", format_optional_number(item.altitude, " ft")),
                ("SPEED", format_optional_number(item.speed, " kt")),
                ("TRACK", format_optional_number(item.track, "°")),
                (
                    "VERT RATE",
                    format_optional_number(item.vertical_rate, " ft/min"),
                ),
                (
                    "SQUAWK",
                    item.squawk
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                ("CONTACT", format_relative_iso(item.last_contact.as_deref())),
                ("POSITION", format!("{:.4} / {:.4}", item.lat, item.lng)),
            ];
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "OpenSky public state vector. Cargo/operator class is inferred from callsign and remains unconfirmed.",
                text_x,
                &mut cursor_y,
                48,
                3,
                caveat_color,
            );
        }
        Selection::Vessel(index) => {
            let Some(item) = data.osint.vessels.get(index) else {
                return;
            };
            draw_text_mono(
                &format!("AIS VESSEL · {}", item.vessel_class.to_uppercase()),
                text_x,
                cursor_y,
                13.0,
                rgb(0x7da6a1, 1.0),
            );
            cursor_y += 25.0;
            draw_text_mono(
                &truncate_chars(&item.name, 32),
                text_x,
                cursor_y,
                17.0,
                title_color,
            );
            cursor_y += 28.0;
            let rows = [
                ("ID", item.id.clone()),
                ("MMSI", item.mmsi.to_string()),
                (
                    "IMO",
                    item.imo
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "CALLSIGN",
                    item.call_sign
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "DEST",
                    item.destination
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "SHIP TYPE",
                    item.ship_type
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                ("STATUS", item.navigation_status.clone()),
                ("SPEED", format_optional_number(item.speed, " kt")),
                ("COURSE", format_optional_number(item.course, "°")),
                ("HEADING", format_optional_number(item.heading, "°")),
                ("REPORTED", format_relative_iso(item.timestamp.as_deref())),
                ("POSITION", format!("{:.4} / {:.4}", item.lat, item.lng)),
                ("SOURCE", item.source.clone()),
            ];
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "Fintraffic Digitraffic AIS coverage is regional to Finnish/Baltic waters; absence elsewhere is not evidence of no vessel traffic.",
                text_x,
                &mut cursor_y,
                48,
                3,
                caveat_color,
            );
        }
        Selection::NaturalEvent(index) => {
            let Some(item) = data.osint.natural_events.get(index) else {
                return;
            };
            draw_text_mono(
                &format!("NATURAL EVENT · {}", item.category.to_uppercase()),
                text_x,
                cursor_y,
                13.0,
                natural_event_color(&item.category, &item.kind),
            );
            cursor_y += 25.0;
            for line in wrap_text(&item.title, 42, 3) {
                draw_text_mono(&line, text_x, cursor_y, 14.0, title_color);
                cursor_y += 17.0;
            }
            cursor_y += 5.0;
            let rows = [
                ("ID", item.id.clone()),
                ("KIND", item.kind.clone()),
                (
                    "MAGNITUDE",
                    match (item.magnitude, item.magnitude_unit.as_deref()) {
                        (Some(value), Some(unit)) => format!("{}{}", value, unit),
                        (Some(value), None) => value.to_string(),
                        _ => "not supplied".to_string(),
                    },
                ),
                ("OCCURRED", format_relative_iso(item.occurred_at.as_deref())),
                ("POSITION", format!("{:.4} / {:.4}", item.lat, item.lng)),
                (
                    "URL",
                    item.url
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
            ];
            draw_rows(&rows, text_x, cursor_y, width_chars);
        }
        Selection::Launch(index) => {
            let Some(item) = data.osint.launches.get(index) else {
                return;
            };
            draw_text_mono(
                "UPCOMING LAUNCH",
                text_x,
                cursor_y,
                13.0,
                rgb(0xbf5af2, 1.0),
            );
            cursor_y += 25.0;
            for line in wrap_text(&item.name, 42, 3) {
                draw_text_mono(&line, text_x, cursor_y, 14.0, title_color);
                cursor_y += 17.0;
            }
            cursor_y += 5.0;
            let rows = [
                ("ID", item.id.clone()),
                (
                    "PROVIDER",
                    item.provider
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                (
                    "LOCATION",
                    item.location
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
                ("NET", format_relative_iso(item.net.as_deref())),
                ("POSITION", format!("{:.4} / {:.4}", item.lat, item.lng)),
                (
                    "URL",
                    item.url
                        .clone()
                        .unwrap_or_else(|| "not supplied".to_string()),
                ),
            ];
            draw_rows(&rows, text_x, cursor_y, width_chars);
        }
        Selection::InternetOutage(index) => {
            let Some(marker) = data.outage_markers.get(index) else {
                return;
            };
            draw_text_mono(
                &format!(
                    "IODA {} CONNECTIVITY EVIDENCE",
                    marker.entity_type.to_uppercase()
                ),
                text_x,
                cursor_y,
                13.0,
                rgb(0x75bdd1, 1.0),
            );
            cursor_y += 25.0;
            let title = if marker.entity_type == "region" {
                format!(
                    "{}, {}",
                    marker.entity_name,
                    marker
                        .country_name
                        .as_deref()
                        .unwrap_or("country unavailable")
                )
            } else {
                marker.entity_name.clone()
            };
            draw_text_mono(
                &truncate_chars(&title, 38),
                text_x,
                cursor_y,
                16.0,
                title_color,
            );
            cursor_y += 27.0;
            let mut rows = vec![
                ("KEY", marker.key.clone()),
                (
                    "ENTITY",
                    format!(
                        "{} · country {}",
                        marker.entity_code,
                        marker.country_code.as_deref().unwrap_or("not supplied")
                    ),
                ),
                (
                    "RECORDS",
                    format!(
                        "{} detection records grouped only for display",
                        marker.event_indices.len()
                    ),
                ),
                ("METHODS", marker.datasource_methods.join(" · ")),
                ("POSITION", format!("{:.4} / {:.4}", marker.lat, marker.lng)),
                ("COORD REF", marker.coordinate_precision.clone()),
            ];
            for (event_offset, event_index) in marker.event_indices.iter().take(3).enumerate() {
                if let Some(event) = data.osint.internet_outages.get(*event_index) {
                    rows.push((
                        if event_offset == 0 {
                            "WINDOW"
                        } else {
                            "WINDOW+"
                        },
                        format!(
                            "{} · score {:.1}",
                            format_unix_window(event.from, event.until),
                            event.score
                        ),
                    ));
                    rows.push((
                        if event_offset == 0 { "FLAGS" } else { "FLAGS+" },
                        format!(
                            "start before window: {} · end equals horizon: {}",
                            event.from_before_query_window, event.until_equals_query_horizon
                        ),
                    ));
                    if event_offset == 0 {
                        rows.push((
                            "NAT GEO ID",
                            event
                                .natural_earth_region_id
                                .clone()
                                .unwrap_or_else(|| "not supplied".to_string()),
                        ));
                    }
                }
            }
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                &format!("{} IODA detections describe macroscopic connectivity change, not cause, intent, shutdown attribution, or per-user impact. Scores are source-specific, not cross-source severity.", marker.coordinate_note),
                text_x,
                &mut cursor_y,
                48,
                5,
                caveat_color,
            );
        }
        Selection::GdeltNews(index) => {
            let Some(marker) = data.gdelt_markers.get(index) else {
                return;
            };
            draw_text_mono(
                "GDELT MEDIA ATTENTION",
                text_x,
                cursor_y,
                13.0,
                rgb(0x9fb0c9, 1.0),
            );
            cursor_y += 25.0;
            draw_text_mono(
                &truncate_chars(&marker.location_name, 38),
                text_x,
                cursor_y,
                16.0,
                title_color,
            );
            cursor_y += 27.0;
            let first_article = marker
                .article_indices
                .first()
                .and_then(|item| data.osint.gdelt_geo_news.get(*item));
            let mut rows = vec![
                ("KEY", marker.key.clone()),
                (
                    "MENTIONS",
                    format!(
                        "{} mentions · {} unique articles",
                        marker.mention_indices.len(),
                        marker.article_indices.len()
                    ),
                ),
                ("PRECISION", marker.coordinate_precision.clone()),
                ("LOC TYPE", marker.location_type.to_string()),
                ("THEMES", marker.themes.join(", ")),
                (
                    "SLOT",
                    format_relative_iso(Some(marker.latest_slot_time.as_str())),
                ),
            ];
            if let Some(article) = first_article {
                rows.push((
                    "ARTICLE",
                    article
                        .title
                        .clone()
                        .unwrap_or_else(|| "headline unavailable in GKG feed".to_string()),
                ));
                rows.push(("DOMAIN", article.domain.clone()));
                rows.push(("ARTICLE ID", article.id.clone()));
                rows.push(("FEED", article.collection.clone()));
                rows.push((
                    "GEO REF",
                    format!(
                        "country {} · adm1 {} · feature {}",
                        article.country_code.as_deref().unwrap_or("not supplied"),
                        article.adm1_code.as_deref().unwrap_or("not supplied"),
                        article.feature_id
                    ),
                ));
                rows.push((
                    "PROXIMITY",
                    format!(
                        "{} chars to nearest conflict theme",
                        article.proximity_chars
                    ),
                ));
                rows.push((
                    "TONE",
                    format!(
                        "{} · pos {} · neg {}",
                        format_optional_number(article.tone, ""),
                        format_optional_number(article.positive_score, ""),
                        format_optional_number(article.negative_score, "")
                    ),
                ));
                rows.push((
                    "WORDS",
                    article
                        .word_count
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "not supplied".to_string()),
                ));
                rows.push((
                    "SEEN",
                    article
                        .seen_at
                        .as_deref()
                        .map(|value| format_relative_iso(Some(value)))
                        .unwrap_or_else(|| "not supplied".to_string()),
                ));
                rows.push((
                    "IMAGE",
                    if article
                        .sharing_image
                        .as_deref()
                        .is_some_and(|value| !value.is_empty())
                    {
                        "sharing image supplied".to_string()
                    } else {
                        "not supplied".to_string()
                    },
                ));
                rows.push(("URL", truncate_chars(&article.url, 100)));
            }
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "A place mentioned in news text near automated GDELT conflict-theme tags. This is media attention and never a verified incident location; coarse admin centroids are symbolic placements.",
                text_x,
                &mut cursor_y,
                48,
                4,
                caveat_color,
            );
        }
        Selection::GpsInterference(index) => {
            let Some(item) = data.osint.gps_interference.get(index) else {
                return;
            };
            draw_text_mono(
                "GPS/GNSS INTERFERENCE CELL",
                text_x,
                cursor_y,
                13.0,
                rgb(0xff8a00, 1.0),
            );
            cursor_y += 25.0;
            draw_text_mono(
                &format!(
                    "{:.0}% affected aircraft",
                    item.affected_share.clamp(0.0, 1.0) * 100.0
                ),
                text_x,
                cursor_y,
                16.0,
                title_color,
            );
            cursor_y += 27.0;
            let center = gps_cell_center(&item.hex)
                .map(|(lat, lng)| format!("{:.4} / {:.4}", lat, lng))
                .unwrap_or_else(|| "invalid H3 index".to_string());
            let rows = [
                ("H3 CELL", item.hex.clone()),
                ("LEVEL", item.level.clone()),
                (
                    "AIRCRAFT",
                    format!(
                        "{} bad / {} total · {} good",
                        item.bad_aircraft, item.aircraft_count, item.good_aircraft
                    ),
                ),
                (
                    "SHARE",
                    format!("{:.1}%", item.affected_share.clamp(0.0, 1.0) * 100.0),
                ),
                ("CENTER", center),
            ];
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "gpsjam.org daily H3 interference derived from aircraft navigation-quality reports. It is interference evidence in the reporting airspace, not attribution of a jammer or proof that every aircraft is affected.",
                text_x,
                &mut cursor_y,
                48,
                4,
                caveat_color,
            );
        }
        Selection::Satellite(index) => {
            let Some(position) = satellite_positions
                .iter()
                .find(|position| position.source_index == index)
            else {
                return;
            };
            let Some(item) = data.osint.satellites.get(index) else {
                return;
            };
            draw_text_mono(
                "TRACKED ORBITAL OBJECT",
                text_x,
                cursor_y,
                13.0,
                rgb(0xd8c77f, 1.0),
            );
            cursor_y += 25.0;
            draw_text_mono(
                &truncate_chars(&item.name, 36),
                text_x,
                cursor_y,
                16.0,
                title_color,
            );
            cursor_y += 27.0;
            let rows = [
                ("ID", item.id.clone()),
                ("NORAD", item.catalog_number.to_string()),
                ("GROUP", item.group.clone()),
                ("ALTITUDE", format!("{:.0} km", position.altitude_km)),
                (
                    "POSITION",
                    format!("{:.4} / {:.4}", position.lat, position.lng),
                ),
                (
                    "TLE AGE",
                    format!(
                        "{:.1} min since epoch at propagation",
                        position.minutes_since_epoch
                    ),
                ),
                ("EPOCH", item.epoch.clone()),
            ];
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "CelesTrak TLE propagated client-side with SGP4 and an approximate Earth-rotation/WGS84 transform. Suitable for globe context, not conjunction assessment or precision pointing.",
                text_x,
                &mut cursor_y,
                48,
                4,
                caveat_color,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Operational filter scope UI
//
// Keyboard model: the panel is modal while open. Printable characters always edit the query
// live (search-first interaction); arrows/Home/End move the focus rectangle; Enter/Space
// activates the focused cell; Backspace edits the query; Delete clears it; Escape closes the
// panel. While the panel is closed, `/` opens it and V / Shift+V cycle the theater scope
// through the deterministic pre-scope option list. Every activation is a spec mutation
// followed by a rescan; nothing is ever hidden without an on-screen accounting line.
// ---------------------------------------------------------------------------

const FILTER_ROW_SEARCH: usize = 0;
const FILTER_ROW_SEVERITY: usize = 1;
const FILTER_ROW_CATEGORY: usize = 2;
const FILTER_ROW_TIME: usize = 3;
const FILTER_ROW_THEATER: usize = 4;
const FILTER_ROW_REGION: usize = 5;
const FILTER_ROW_COUNTRY: usize = 6;
const FILTER_ROW_ACTIONS: usize = 7;
const FILTER_ROW_COUNT: usize = 8;
/// Scope rows surface the strongest few options; the remainder is disclosed as a count rather
/// than silently truncated. Ordering is the deterministic scan ordering.
const FILTER_SCOPE_OPTION_CAP: usize = 6;

#[derive(Default)]
struct FilterUiState {
    open: bool,
    focus_row: usize,
    focus_col: usize,
}

#[derive(Clone, Debug, PartialEq)]
enum FilterAction {
    FocusSearch,
    ToggleSeverity(usize),
    ToggleCategoryGroup(usize),
    SelectTimeWindow(TimeWindowKey),
    SetTheater(Option<String>),
    SetRegion(Option<String>),
    SetCountry(Option<String>),
    ResetAll,
    ClearQuery,
    ClosePanel,
    OpenPanel,
    ClearSeverityDim,
    ClearCategoryDim,
    ClearTimeDim,
}

fn filter_panel_rect(width: f32) -> (f32, f32, f32, f32) {
    let w = 620.0f32.min(width - 40.0);
    ((width - w) * 0.5, 92.0, w, 436.0)
}

/// Compact human-readable description of the active lens dimensions, used in the source-status
/// accounting rows. Always enumerates every dimension — defaults included — so nothing about
/// the scope is implicit.
fn filter_pipeline_describe(pipeline: &FilterPipeline) -> String {
    let spec = &pipeline.spec;
    let severities: Vec<&str> = SEVERITY_KEYS
        .iter()
        .enumerate()
        .filter(|(index, _)| spec.severities[*index])
        .map(|(_, key)| *key)
        .collect();
    let groups: Vec<&str> = CategoryGroup::ALL
        .iter()
        .enumerate()
        .filter(|(index, _)| spec.category_groups[*index])
        .map(|(_, group)| group.as_str())
        .collect();
    format!(
        "window {} · sev [{}] · groups [{}] · theater {} · region {} · country {} · query {}",
        spec.time_window.as_str(),
        severities.join("+"),
        groups.join("+"),
        spec.theater.as_deref().unwrap_or("any"),
        spec.region.as_deref().unwrap_or("any"),
        spec.country.as_deref().unwrap_or("any"),
        if spec.query.is_empty() {
            "none".to_string()
        } else {
            format!("\"{}\"", spec.query)
        }
    )
}

fn filter_cell_column_count(row: usize, pass: &FilterPass) -> usize {
    match row {
        FILTER_ROW_SEARCH => 1,
        FILTER_ROW_SEVERITY => 4,
        FILTER_ROW_CATEGORY => 5,
        FILTER_ROW_TIME => 4,
        FILTER_ROW_THEATER => 1 + pass.options.theaters.len().min(FILTER_SCOPE_OPTION_CAP),
        FILTER_ROW_REGION => 1 + pass.options.regions.len().min(FILTER_SCOPE_OPTION_CAP),
        FILTER_ROW_COUNTRY => 1 + pass.options.countries.len().min(FILTER_SCOPE_OPTION_CAP),
        FILTER_ROW_ACTIONS => 2,
        _ => 1,
    }
}

fn scope_option_at(options: &[ScopeOption], col: usize) -> Option<Option<String>> {
    if col == 0 {
        return Some(None);
    }
    options.get(col - 1).map(|option| Some(option.key.clone()))
}

/// Keyboard/mouse activation of one focus cell, mirrored exactly by click hitboxes.
fn filter_action_for_cell(row: usize, col: usize, pass: &FilterPass) -> Option<FilterAction> {
    match row {
        FILTER_ROW_SEARCH => Some(FilterAction::FocusSearch),
        FILTER_ROW_SEVERITY => (col < 4).then_some(FilterAction::ToggleSeverity(col)),
        FILTER_ROW_CATEGORY => (col < 5).then_some(FilterAction::ToggleCategoryGroup(col)),
        FILTER_ROW_TIME => TimeWindowKey::ALL_KEYS
            .get(col)
            .map(|key| FilterAction::SelectTimeWindow(*key)),
        FILTER_ROW_THEATER => {
            scope_option_at(&pass.options.theaters, col).map(FilterAction::SetTheater)
        }
        FILTER_ROW_REGION => {
            scope_option_at(&pass.options.regions, col).map(FilterAction::SetRegion)
        }
        FILTER_ROW_COUNTRY => {
            scope_option_at(&pass.options.countries, col).map(FilterAction::SetCountry)
        }
        FILTER_ROW_ACTIONS => match col {
            0 => Some(FilterAction::ResetAll),
            _ => Some(FilterAction::ClearQuery),
        },
        _ => None,
    }
}

/// Apply one activation to the spec. Geographic scope cells toggle: activating the already
/// selected scope clears it again, mirroring the web theater-row toggle behavior.
fn apply_filter_action(spec: &mut IncidentFilterSpec, action: &FilterAction) {
    match action {
        FilterAction::FocusSearch | FilterAction::ClosePanel | FilterAction::OpenPanel => {}
        FilterAction::ToggleSeverity(index) => {
            spec.severities[*index] = !spec.severities[*index];
        }
        FilterAction::ToggleCategoryGroup(index) => {
            spec.category_groups[*index] = !spec.category_groups[*index];
        }
        FilterAction::SelectTimeWindow(key) => {
            spec.time_window = *key;
        }
        FilterAction::SetTheater(value) => {
            spec.theater = if spec.theater == *value {
                None
            } else {
                value.clone()
            };
        }
        FilterAction::SetRegion(value) => {
            spec.region = if spec.region == *value {
                None
            } else {
                value.clone()
            };
        }
        FilterAction::SetCountry(value) => {
            spec.country = if spec.country == *value {
                None
            } else {
                value.clone()
            };
        }
        FilterAction::ResetAll => {
            *spec = IncidentFilterSpec::default();
        }
        FilterAction::ClearQuery => {
            spec.query.clear();
        }
        FilterAction::ClearSeverityDim => {
            spec.severities = [true; 4];
        }
        FilterAction::ClearCategoryDim => {
            spec.category_groups = IncidentFilterSpec::default().category_groups;
        }
        FilterAction::ClearTimeDim => {
            spec.time_window = IncidentFilterSpec::default().time_window;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_filter_cell(
    label: &str,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    selected: bool,
    focused: bool,
    hitboxes: &mut Vec<(Rect, FilterAction)>,
    action: FilterAction,
) {
    let fill = if selected {
        Color::new(0.34, 0.25, 0.08, 0.85)
    } else {
        Color::new(0.03, 0.045, 0.04, 0.78)
    };
    let border = if focused {
        Color::new(0.55, 0.82, 0.95, 0.95)
    } else if selected {
        Color::new(0.9, 0.72, 0.32, 0.7)
    } else {
        Color::new(0.5, 0.48, 0.38, 0.35)
    };
    draw_rectangle(x, y, w, h, fill);
    draw_rectangle_lines(x, y, w, h, 1.0, border);
    let text_color = if selected {
        Color::new(0.95, 0.87, 0.62, 0.95)
    } else {
        Color::new(0.72, 0.72, 0.64, 0.85)
    };
    draw_text_mono(
        &truncate_chars(label, ((w - 10.0) / 5.6).max(6.0) as usize),
        x + 5.0,
        y + h - 6.0,
        9.5,
        text_color,
    );
    hitboxes.push((Rect::new(x, y, w, h), action));
}

#[allow(clippy::too_many_arguments)]
fn draw_filter_row_cells(
    labels: &[(String, bool)],
    row: usize,
    x: f32,
    y: f32,
    cell_h: f32,
    gap: f32,
    focus_row: usize,
    focus_col: usize,
    hitboxes: &mut Vec<(Rect, FilterAction)>,
    actions: &[FilterAction],
) {
    let mut cursor_x = x;
    for (col, ((label, selected), action)) in labels.iter().zip(actions.iter()).enumerate() {
        let w = (label.chars().count() as f32 * 5.8 + 14.0).clamp(34.0, 150.0);
        draw_filter_cell(
            label,
            cursor_x,
            y,
            w,
            cell_h,
            *selected,
            focus_row == row && focus_col == col,
            hitboxes,
            action.clone(),
        );
        cursor_x += w + gap;
    }
}

/// Draw the modal filter panel, returning the click hitboxes for next-frame mouse handling.
fn draw_filter_panel(
    pipeline: &FilterPipeline,
    ui: &FilterUiState,
    width: f32,
    hitboxes: &mut Vec<(Rect, FilterAction)>,
) {
    let (x, y, w, h) = filter_panel_rect(width);
    draw_rectangle(
        0.0,
        0.0,
        width,
        screen_height(),
        Color::new(0.0, 0.0, 0.0, 0.35),
    );
    draw_panel(x, y, w, h);
    let text_x = x + 16.0;
    let mut cursor_y = y + 24.0;
    let spec = &pipeline.spec;
    let pass = &pipeline.pass;

    draw_text_mono(
        "FILTER SCOPE · OPERATIONAL LENS",
        text_x,
        cursor_y,
        13.5,
        Color::new(0.77, 0.64, 0.36, 0.92),
    );
    draw_filter_cell(
        "X close",
        x + w - 74.0,
        y + 10.0,
        62.0,
        18.0,
        false,
        false,
        hitboxes,
        FilterAction::ClosePanel,
    );
    cursor_y += 16.0;
    let stats = &pass.stats;
    let accounting = format!(
        "{}/{} incidents in scope · scan {:.1}ms · grid {:.1}ms · mesh {:.1}ms{}",
        stats.output_count,
        stats.input_count,
        stats.scan_ms,
        pipeline.last_build_ms,
        pipeline.last_mesh_build_ms,
        if pipeline.playback_current() {
            ""
        } else {
            " · temporal grid rebuilding"
        }
    );
    draw_text_mono(
        &truncate_chars(&accounting, 88),
        text_x,
        cursor_y,
        9.0,
        Color::new(0.6, 0.62, 0.55, 0.82),
    );
    cursor_y += 8.0;
    if stats.output_count == 0 {
        draw_text_mono(
            "EMPTY SCOPE: no incidents match — broadening any dimension is explicit, never automatic",
            text_x,
            cursor_y + 8.0,
            9.0,
            Color::new(1.0, 0.62, 0.3, 0.9),
        );
        cursor_y += 10.0;
    }
    cursor_y += 12.0;

    let row_label_x = text_x;
    let cells_x = text_x + 78.0;
    let cell_h = 19.0;
    let row_gap = 27.0;
    let rows_top = cursor_y + 14.0;

    // Search row: always-live text input.
    draw_text_mono(
        "SEARCH",
        row_label_x,
        rows_top + 13.0,
        10.0,
        Color::new(0.55, 0.54, 0.47, 0.8),
    );
    let search_w = w - (cells_x - x) - 20.0;
    let search_focused = ui.focus_row == FILTER_ROW_SEARCH;
    draw_rectangle(
        cells_x,
        rows_top,
        search_w,
        cell_h + 2.0,
        Color::new(0.02, 0.03, 0.028, 0.9),
    );
    draw_rectangle_lines(
        cells_x,
        rows_top,
        search_w,
        cell_h + 2.0,
        1.0,
        if search_focused {
            Color::new(0.55, 0.82, 0.95, 0.95)
        } else {
            Color::new(0.5, 0.48, 0.38, 0.42)
        },
    );
    let query_display = if spec.query.is_empty() {
        "type to search title/place/actor/source…".to_string()
    } else {
        format!("{}_", spec.query)
    };
    draw_text_mono(
        &truncate_chars(&query_display, 72),
        cells_x + 6.0,
        rows_top + 14.0,
        10.5,
        if spec.query.is_empty() {
            Color::new(0.45, 0.46, 0.42, 0.55)
        } else {
            Color::new(0.9, 0.88, 0.76, 0.95)
        },
    );
    hitboxes.push((
        Rect::new(cells_x, rows_top, search_w, cell_h + 2.0),
        FilterAction::FocusSearch,
    ));

    // Severity row.
    let severity_y = rows_top + row_gap;
    draw_text_mono(
        "SEVERITY",
        row_label_x,
        severity_y + 13.0,
        10.0,
        Color::new(0.55, 0.54, 0.47, 0.8),
    );
    let severity_labels: Vec<(String, bool)> = SEVERITY_KEYS
        .iter()
        .enumerate()
        .map(|(index, key)| (key.to_string(), spec.severities[index]))
        .collect();
    let severity_actions: Vec<FilterAction> = (0..4).map(FilterAction::ToggleSeverity).collect();
    draw_filter_row_cells(
        &severity_labels,
        FILTER_ROW_SEVERITY,
        cells_x,
        severity_y,
        cell_h,
        5.0,
        ui.focus_row,
        ui.focus_col,
        hitboxes,
        &severity_actions,
    );

    // Category group row.
    let category_y = severity_y + row_gap;
    draw_text_mono(
        "GROUPS",
        row_label_x,
        category_y + 13.0,
        10.0,
        Color::new(0.55, 0.54, 0.47, 0.8),
    );
    let category_labels: Vec<(String, bool)> = CategoryGroup::ALL
        .iter()
        .enumerate()
        .map(|(index, group)| (group.label().to_string(), spec.category_groups[index]))
        .collect();
    let category_actions: Vec<FilterAction> =
        (0..5).map(FilterAction::ToggleCategoryGroup).collect();
    draw_filter_row_cells(
        &category_labels,
        FILTER_ROW_CATEGORY,
        cells_x,
        category_y,
        cell_h,
        5.0,
        ui.focus_row,
        ui.focus_col,
        hitboxes,
        &category_actions,
    );

    // Time window row.
    let time_y = category_y + row_gap;
    draw_text_mono(
        "WINDOW",
        row_label_x,
        time_y + 13.0,
        10.0,
        Color::new(0.55, 0.54, 0.47, 0.8),
    );
    if spec.time_window != TimeWindowKey::All {
        draw_text_mono(
            &truncate_chars(&format!("since {}", format_utc_exact(stats.cutoff)), 30),
            row_label_x,
            time_y + 25.0,
            7.5,
            Color::new(0.48, 0.5, 0.44, 0.62),
        );
    }
    let time_labels: Vec<(String, bool)> = TimeWindowKey::ALL_KEYS
        .iter()
        .map(|key| (key.as_str().to_string(), spec.time_window == *key))
        .collect();
    let time_actions: Vec<FilterAction> = TimeWindowKey::ALL_KEYS
        .iter()
        .map(|key| FilterAction::SelectTimeWindow(*key))
        .collect();
    draw_filter_row_cells(
        &time_labels,
        FILTER_ROW_TIME,
        cells_x,
        time_y,
        cell_h,
        5.0,
        ui.focus_row,
        ui.focus_col,
        hitboxes,
        &time_actions,
    );

    // Geographic scope rows share one renderer shape.
    let mut scope_y = time_y + row_gap;
    for (row, label, options, current) in [
        (
            FILTER_ROW_THEATER,
            "THEATER",
            &pass.options.theaters,
            &spec.theater,
        ),
        (
            FILTER_ROW_REGION,
            "REGION",
            &pass.options.regions,
            &spec.region,
        ),
        (
            FILTER_ROW_COUNTRY,
            "COUNTRY",
            &pass.options.countries,
            &spec.country,
        ),
    ] {
        draw_text_mono(
            label,
            row_label_x,
            scope_y + 13.0,
            10.0,
            Color::new(0.55, 0.54, 0.47, 0.8),
        );
        let mut labels: Vec<(String, bool)> = vec![("any".to_string(), current.is_none())];
        let mut actions: Vec<FilterAction> = Vec::new();
        actions.push(match row {
            FILTER_ROW_THEATER => FilterAction::SetTheater(None),
            FILTER_ROW_REGION => FilterAction::SetRegion(None),
            _ => FilterAction::SetCountry(None),
        });
        for option in options.iter().take(FILTER_SCOPE_OPTION_CAP) {
            let selected = current.as_ref() == Some(&option.key);
            labels.push((
                format!("{} ·{}", truncate_chars(&option.label, 16), option.count),
                selected,
            ));
            actions.push(match row {
                FILTER_ROW_THEATER => FilterAction::SetTheater(Some(option.key.clone())),
                FILTER_ROW_REGION => FilterAction::SetRegion(Some(option.key.clone())),
                _ => FilterAction::SetCountry(Some(option.key.clone())),
            });
        }
        draw_filter_row_cells(
            &labels,
            row,
            cells_x,
            scope_y,
            cell_h,
            5.0,
            ui.focus_row,
            ui.focus_col,
            hitboxes,
            &actions,
        );
        if options.len() > FILTER_SCOPE_OPTION_CAP {
            draw_text_mono(
                &format!(
                    "+{} more not shown",
                    options.len() - FILTER_SCOPE_OPTION_CAP
                ),
                x + w - 132.0,
                scope_y + 13.0,
                8.5,
                Color::new(0.5, 0.52, 0.46, 0.62),
            );
        }
        // A stale selection (option no longer present in the pre-scope corpus) is disclosed
        // rather than silently dropped: the scope still filters, and the row shows why nothing
        // may match.
        if let Some(value) = current {
            if !options.iter().any(|option| &option.key == value) {
                draw_text_mono(
                    &format!(
                        "selected '{}' has no pre-scope incidents",
                        truncate_chars(value, 24)
                    ),
                    cells_x,
                    scope_y + 25.0,
                    8.5,
                    Color::new(1.0, 0.62, 0.3, 0.85),
                );
            }
        }
        scope_y += row_gap;
    }

    // Actions row.
    let actions_y = scope_y;
    draw_text_mono(
        "ACTIONS",
        row_label_x,
        actions_y + 13.0,
        10.0,
        Color::new(0.55, 0.54, 0.47, 0.8),
    );
    let action_labels: Vec<(String, bool)> = vec![
        ("reset all filters".to_string(), false),
        ("clear query".to_string(), false),
    ];
    draw_filter_row_cells(
        &action_labels,
        FILTER_ROW_ACTIONS,
        cells_x,
        actions_y,
        cell_h,
        5.0,
        ui.focus_row,
        ui.focus_col,
        hitboxes,
        &[FilterAction::ResetAll, FilterAction::ClearQuery],
    );

    // Per-dimension exclusion accounting: overlapping independent counts, never summed.
    let excl = format!(
        "excluded overlapping: severity {} · group {} · time {} · query {} · theater {} · region {} · country {}",
        stats.excluded_severity,
        stats.excluded_category_group,
        stats.excluded_time_window,
        stats.excluded_query,
        stats.excluded_theater,
        stats.excluded_region,
        stats.excluded_country
    );
    draw_text_mono(
        &truncate_chars(&excl, 96),
        text_x,
        y + h - 34.0,
        8.5,
        Color::new(0.55, 0.56, 0.5, 0.72),
    );
    draw_text_mono(
        "arrows navigate · enter applies · type edits search live · backspace edit · del clear query · esc close",
        text_x,
        y + h - 20.0,
        8.5,
        Color::new(0.5, 0.52, 0.46, 0.66),
    );
}

/// Chip strip below the top bar: the persistent, always-visible scope accounting. Every active
/// dimension is a removable chip; clicking the strip's filter button opens the panel.
fn draw_filter_chips(
    pipeline: &FilterPipeline,
    width: f32,
    hitboxes: &mut Vec<(Rect, FilterAction)>,
) {
    let spec = &pipeline.spec;
    let stats = &pipeline.pass.stats;
    let y = 62.0;
    let h = 20.0;
    let mut cursor_x = 18.0;
    let gap = 6.0;

    let default = spec.is_default();
    let status = format!(
        "scope {}/{}{}",
        stats.output_count,
        stats.input_count,
        if default { " · default lens" } else { "" }
    );
    draw_filter_cell(
        "filter /",
        cursor_x,
        y,
        62.0,
        h,
        !default,
        false,
        hitboxes,
        FilterAction::OpenPanel,
    );
    cursor_x += 62.0 + gap;

    if spec.severities != [true; 4] {
        let enabled: Vec<&str> = SEVERITY_KEYS
            .iter()
            .enumerate()
            .filter(|(index, _)| spec.severities[*index])
            .map(|(_, key)| *key)
            .collect();
        let label = if enabled.is_empty() {
            "sev: none".to_string()
        } else {
            format!("sev: {}", enabled.join("+"))
        };
        let w = (label.chars().count() as f32 * 5.8 + 14.0).clamp(50.0, 170.0);
        draw_filter_cell(
            &label,
            cursor_x,
            y,
            w,
            h,
            true,
            false,
            hitboxes,
            FilterAction::ClearSeverityDim,
        );
        cursor_x += w + gap;
    }
    if spec.category_groups != IncidentFilterSpec::default().category_groups {
        let enabled: Vec<&str> = CategoryGroup::ALL
            .iter()
            .enumerate()
            .filter(|(index, _)| spec.category_groups[*index])
            .map(|(_, group)| group.label())
            .collect();
        let label = if enabled.is_empty() {
            "groups: none".to_string()
        } else {
            format!("groups: {}", enabled.join("+"))
        };
        let w = (label.chars().count() as f32 * 5.8 + 14.0).clamp(60.0, 230.0);
        draw_filter_cell(
            &label,
            cursor_x,
            y,
            w,
            h,
            true,
            false,
            hitboxes,
            FilterAction::ClearCategoryDim,
        );
        cursor_x += w + gap;
    }
    if spec.time_window != TimeWindowKey::Days30 {
        let label = format!("window: {}", spec.time_window.as_str());
        let w = (label.chars().count() as f32 * 5.8 + 14.0).clamp(60.0, 130.0);
        draw_filter_cell(
            &label,
            cursor_x,
            y,
            w,
            h,
            true,
            false,
            hitboxes,
            FilterAction::ClearTimeDim,
        );
        cursor_x += w + gap;
    }
    // Geographic scope chips show human labels where the pre-scope aggregation has one
    // (theater conflict names); slugs/verbatim values remain the fallback, never invisible.
    let theater_label = spec.theater.as_ref().map(|value| {
        pipeline
            .pass
            .options
            .theaters
            .iter()
            .find(|option| &option.key == value)
            .map(|option| option.label.clone())
            .unwrap_or_else(|| value.clone())
    });
    for (value, clear) in [
        (theater_label.as_ref(), FilterAction::SetTheater(None)),
        (spec.region.as_ref(), FilterAction::SetRegion(None)),
        (spec.country.as_ref(), FilterAction::SetCountry(None)),
    ] {
        if let Some(value) = value {
            let label = format!("{} x", truncate_chars(value, 22));
            let w = (label.chars().count() as f32 * 5.8 + 14.0).clamp(60.0, 180.0);
            draw_filter_cell(&label, cursor_x, y, w, h, true, false, hitboxes, clear);
            cursor_x += w + gap;
        }
    }
    if !spec.query.is_empty() {
        let label = format!("\"{}\" x", truncate_chars(&spec.query, 24));
        let w = (label.chars().count() as f32 * 5.8 + 14.0).clamp(60.0, 200.0);
        draw_filter_cell(
            &label,
            cursor_x,
            y,
            w,
            h,
            true,
            false,
            hitboxes,
            FilterAction::ClearQuery,
        );
        cursor_x += w + gap;
    }

    let status_color = if stats.output_count == 0 {
        Color::new(1.0, 0.55, 0.28, 0.95)
    } else {
        Color::new(0.66, 0.68, 0.58, 0.85)
    };
    draw_text_mono(&status, cursor_x + 4.0, y + 14.0, 10.5, status_color);
    if stats.output_count == 0 {
        draw_text_mono(
            "· EMPTY SCOPE — nothing hidden silently; open filter to broaden",
            cursor_x + 150.0,
            y + 14.0,
            9.5,
            Color::new(1.0, 0.55, 0.28, 0.85),
        );
    }
    let _ = width;
}

fn draw_playback_button(
    label: &str,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    enabled: bool,
    emphasized: bool,
) {
    let border = if emphasized {
        Color::new(0.9, 0.72, 0.32, 0.72)
    } else if enabled {
        Color::new(0.62, 0.56, 0.4, 0.42)
    } else {
        Color::new(0.42, 0.42, 0.38, 0.22)
    };
    let text = if enabled {
        Color::new(0.86, 0.82, 0.66, 0.92)
    } else {
        Color::new(0.48, 0.48, 0.44, 0.45)
    };
    draw_rectangle(
        x,
        y,
        w,
        h,
        if emphasized {
            Color::new(0.32, 0.22, 0.07, 0.72)
        } else {
            Color::new(0.04, 0.055, 0.045, 0.78)
        },
    );
    draw_rectangle_lines(x, y, w, h, 1.0, border);
    draw_text_mono(label, x + 6.0, y + h - 7.0, 10.5, text);
}

fn draw_playback_panel(
    controller: &IncidentPlaybackController,
    visual_cache: Option<&PlaybackVisualCache>,
    scope_current: bool,
    scoped_count: usize,
    corpus_count: usize,
    height: f32,
) {
    let (x, y, w, h) = playback_panel_rect(height);
    draw_panel(x, y, w, h);
    let analysis = controller.analysis();
    let choice = controller.resolution_choice();
    let active = controller.active();
    let has_frames = analysis.frame_count > 0;

    draw_playback_button(
        if active { "P ON" } else { "P OFF" },
        x + 10.0,
        y + 8.0,
        58.0,
        18.0,
        true,
        active,
    );
    draw_text_mono(
        "TEMPORAL PLAYBACK",
        x + 76.0,
        y + 21.0,
        10.5,
        Color::new(0.77, 0.64, 0.36, 0.9),
    );
    if controller.reduced_motion() {
        draw_text_mono(
            "reduced motion",
            x + 186.0,
            y + 21.0,
            8.5,
            Color::new(0.55, 0.75, 0.86, 0.78),
        );
    } else if active {
        if let Some(cache) = visual_cache {
            draw_text_mono(
                &format!("mesh {:.1}ms", cache.rebuild_ms),
                x + 220.0,
                y + 21.0,
                8.0,
                Color::new(0.43, 0.49, 0.43, 0.62),
            );
        }
    }

    if let (Some(frame), true) = (controller.frame(), has_frames) {
        let line = format!(
            "frame {}/{} · {} · {}",
            controller.frame_index() + 1,
            analysis.frame_count,
            analysis.resolution.short_label(),
            format_utc_exact(frame.start)
        );
        draw_text_mono(
            &truncate_chars(&line, 45),
            x + 10.0,
            y + 38.0,
            9.5,
            Color::new(0.78, 0.76, 0.66, 0.86),
        );
        draw_text_mono(
            &truncate_chars(
                &format!("→ {} end-exclusive", format_utc_exact(frame.end_exclusive)),
                45,
            ),
            x + 10.0,
            y + 49.0,
            7.8,
            Color::new(0.55, 0.59, 0.54, 0.72),
        );
    } else {
        draw_text_mono(
            "no source-valid incident times",
            x + 10.0,
            y + 40.0,
            9.5,
            Color::new(0.58, 0.56, 0.48, 0.78),
        );
    }

    let (hx, hy, hw, hh) = playback_histogram_geometry(height);
    draw_rectangle(hx, hy, hw, hh, Color::new(0.006, 0.01, 0.009, 0.72));
    if has_frames {
        let max_start = analysis.max_start_count.max(1) as f32;
        let bar_w = hw / analysis.frame_count as f32;
        for frame in &analysis.frames {
            let scaled = if frame.start_count > 0 {
                ((frame.start_count as f32 / max_start).sqrt() * 0.88).max(0.12)
            } else {
                0.035
            };
            let bar_h = hh * scaled;
            let bx = hx + frame.index as f32 * bar_w;
            let precise = frame
                .start_count
                .saturating_sub(frame.start_imprecise_count);
            let precise_share = if frame.start_count > 0 {
                precise as f32 / frame.start_count as f32
            } else {
                0.0
            };
            let precise_h = bar_h * precise_share;
            let imprecise_h = bar_h - precise_h;
            draw_rectangle(
                bx,
                hy + hh - precise_h,
                bar_w.max(1.0) - 0.35,
                precise_h,
                Color::new(0.86, 0.66, 0.22, 0.62),
            );
            draw_rectangle(
                bx,
                hy + hh - bar_h,
                bar_w.max(1.0) - 0.35,
                imprecise_h,
                Color::new(0.34, 0.67, 0.86, 0.52),
            );
            if frame.start_critical_count > 0 {
                draw_rectangle(
                    bx,
                    hy + hh - bar_h,
                    bar_w.max(1.0) - 0.35,
                    2.0,
                    Color::new(1.0, 0.18, 0.24, 0.9),
                );
            }
            if frame.index == controller.frame_index() {
                draw_rectangle_lines(
                    bx,
                    hy + hh - bar_h,
                    bar_w.max(1.0),
                    bar_h,
                    1.2,
                    Color::new(1.0, 0.86, 0.42, 0.92),
                );
            }
        }
    }
    draw_rectangle_lines(hx, hy, hw, hh, 1.0, Color::new(0.58, 0.52, 0.34, 0.28));

    let row1 = y + 94.0;
    let transport_enabled = active || has_frames;
    draw_playback_button("|<", x + 10.0, row1, 28.0, 24.0, transport_enabled, false);
    draw_playback_button("<", x + 40.0, row1, 28.0, 24.0, transport_enabled, false);
    draw_playback_button(
        if controller.playing() { "||" } else { ">" },
        x + 70.0,
        row1,
        32.0,
        24.0,
        transport_enabled,
        controller.playing(),
    );
    draw_playback_button(">", x + 104.0, row1, 28.0, 24.0, transport_enabled, false);
    draw_playback_button(">|", x + 136.0, row1, 28.0, 24.0, transport_enabled, false);
    draw_playback_button("0", x + 166.0, row1, 28.0, 24.0, transport_enabled, false);
    draw_playback_button(
        &format!("M {}", controller.mode().label()),
        x + 202.0,
        row1,
        80.0,
        24.0,
        true,
        false,
    );

    let row2 = y + 126.0;
    draw_playback_button("[", x + 10.0, row2, 28.0, 24.0, true, false);
    draw_playback_button("]", x + 40.0, row2, 28.0, 24.0, true, false);
    draw_text_mono(
        &format!("{}x", controller.speed_multiplier()),
        x + 72.0,
        row2 + 16.0,
        9.5,
        Color::new(0.76, 0.72, 0.58, 0.86),
    );
    draw_playback_button(
        &format!("R {}", controller.resolution_preference().as_str()),
        x + 120.0,
        row2,
        76.0,
        24.0,
        true,
        false,
    );
    draw_playback_button(
        &format!(
            "T {}",
            format_duration_seconds(controller.trailing_frames() as f64 * analysis.step_seconds)
        ),
        x + 204.0,
        row2,
        78.0,
        24.0,
        true,
        controller.mode() == PlaybackMode::Trailing,
    );

    let summary_line = if !scope_current {
        "temporal grid rebuilding for current filter scope…".to_string()
    } else if active {
        if let Some(cache) = visual_cache {
            format!(
                "{} inc in {} view · {} uncertain · {} cluster reports · {} corr",
                cache.summary.count,
                controller.mode().label().to_lowercase(),
                cache.summary.uncertain_time_count,
                cache.summary.retained_report_count,
                cache.summary.corroborated_count
            )
        } else {
            "preparing deterministic frame extraction".to_string()
        }
    } else {
        format!(
            "lens off · {}/{} scoped incidents visible",
            scoped_count, corpus_count
        )
    };
    draw_text_mono(
        &truncate_chars(&summary_line, 52),
        x + 10.0,
        y + 160.0,
        8.8,
        Color::new(0.62, 0.64, 0.56, 0.82),
    );
    let mouse = vec2(mouse_position().0, mouse_position().1);
    let histogram_detail = if has_frames && point_in_rect(mouse, hx, hy, hw, hh) {
        let bar_w = hw / analysis.frame_count as f32;
        let index = (((mouse.x - hx) / bar_w).floor() as isize)
            .clamp(0, analysis.frame_count as isize - 1) as usize;
        analysis.frames.get(index).map(|bucket| {
            format!(
                "{} start ({} uncertain) · {} active memberships · {} critical",
                bucket.start_count,
                bucket.start_imprecise_count,
                bucket.active_count,
                bucket.active_critical_count
            )
        })
    } else {
        None
    };
    let showing_histogram_detail = histogram_detail.is_some();
    let semantics = if !scope_current {
        "histogram describes the previous scope until the rebuild lands".to_string()
    } else if let Some(detail) = histogram_detail {
        detail
    } else if let Some(notice) = choice.notice.as_deref() {
        notice.to_string()
    } else {
        format!(
            "{} precise · {} uncertain · {} invalid excluded",
            analysis.coverage.precise_count,
            analysis.coverage.imprecise_count,
            analysis.coverage.invalid_time_count
        )
    };
    draw_text_mono(
        &truncate_chars(&semantics, 49),
        x + 10.0,
        y + 172.0,
        8.2,
        if !showing_histogram_detail && choice.notice.is_some() {
            Color::new(0.9, 0.68, 0.34, 0.82)
        } else {
            Color::new(0.48, 0.5, 0.44, 0.76)
        },
    );
    draw_text_mono(
        "bars count starts once; uncertainty can span frames",
        x + 10.0,
        y + 184.0,
        8.0,
        Color::new(0.43, 0.47, 0.44, 0.72),
    );
}

#[allow(clippy::too_many_arguments)]
fn draw_source_status_panel(
    data: &AppData,
    status: &RuntimeStatus,
    satellite_errors: &[String],
    filter_pipeline: &FilterPipeline,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
) {
    draw_panel(x, y, width, height);
    let text_x = x + 14.0;
    let mut cursor_y = y + 25.0;
    draw_text_mono(
        "SOURCE STATUS · PUBLIC INTELLIGENCE LATTICE",
        text_x,
        cursor_y,
        13.0,
        Color::new(0.77, 0.64, 0.36, 0.9),
    );
    cursor_y += 23.0;
    let width_chars = ((width - 118.0) / 6.0).max(18.0) as usize;
    let osint = &data.osint;
    let fetched_age = format_relative_iso(osint.fetched_at.as_deref());
    let refresh_state = if status.refresh_in_progress {
        "refresh in progress".to_string()
    } else if status.worker_enabled {
        format!("polling every {}s", status.refresh_interval.as_secs())
    } else {
        "runtime refresh disabled".to_string()
    };
    let rows = vec![
        ("RUNTIME", data.active_source.label().to_string()),
        ("ACTIVE", truncate_chars(&data.active_detail, 72)),
        (
            "SNAPSHOT",
            format!(
                "{} · {}",
                osint
                    .fetched_at
                    .as_deref()
                    .unwrap_or("timestamp unavailable"),
                fetched_age
            ),
        ),
        (
            "LOADED",
            format_relative_unix(Some(data.active_loaded_unix)),
        ),
        ("REFRESH", refresh_state),
        (
            "CONFLICT",
            format!(
                "{} · generated {} · {}",
                data.conflict_source
                    .as_deref()
                    .unwrap_or("source unavailable"),
                format_relative_unix(data.conflict_generated_at),
                data.conflict_license
                    .as_deref()
                    .unwrap_or("license unavailable")
            ),
        ),
        (
            "CORRELATION",
            format!(
                "{} incidents from {} records · {} evidence · {} clusters · {} pairs · {:.0} ms",
                data.correlation_stats.incident_count,
                data.correlation_stats.input_record_count,
                data.correlation_stats.correlated_evidence_record_count,
                data.correlation_stats.multi_member_cluster_count,
                data.correlation_stats.candidate_pair_count,
                data.correlation_stats.elapsed_ms
            ),
        ),
        (
            "CONFIDENCE",
            format!(
                "corroborated {} · contested {} · inferred {} · single-source {}",
                data.correlation_stats.corroborated_cluster_count,
                data.correlation_stats.contested_cluster_count,
                data.correlation_stats.inferred_cluster_count,
                data.correlation_stats.single_source_cluster_count
            ),
        ),
        (
            "CORR AUDIT",
            format!(
                "{} · eligible {} · ineligible {} · exact-id duplicates {} · evaluated {} pairs",
                data.correlation_stats.algorithm_version,
                data.correlation_stats.correlation_eligible_record_count,
                data.correlation_stats.ineligible_record_count,
                data.correlation_stats.exact_duplicate_record_count,
                data.correlation_stats.evaluated_pair_count
            ),
        ),
        (
            "FILTER",
            format!(
                "{}/{} incidents in scope · pre-scope {} · scan {:.1}ms",
                filter_pipeline.pass.stats.output_count,
                filter_pipeline.pass.stats.input_count,
                filter_pipeline.pass.stats.pre_scope_count,
                filter_pipeline.pass.stats.scan_ms
            ),
        ),
        (
            "FILTER LENS",
            truncate_chars(&filter_pipeline_describe(filter_pipeline), 110),
        ),
        (
            "FILTER EXCL",
            format!(
                "sev {} · group {} · time {} · query {} · theater {} · region {} · country {} (overlapping)",
                filter_pipeline.pass.stats.excluded_severity,
                filter_pipeline.pass.stats.excluded_category_group,
                filter_pipeline.pass.stats.excluded_time_window,
                filter_pipeline.pass.stats.excluded_query,
                filter_pipeline.pass.stats.excluded_theater,
                filter_pipeline.pass.stats.excluded_region,
                filter_pipeline.pass.stats.excluded_country
            ),
        ),
        (
            "PLAYBACK GRID",
            format!(
                "{} scoped incidents analyzed · build {:.1}ms · {}{}",
                filter_pipeline.last_build_filtered_count,
                filter_pipeline.last_build_ms,
                if filter_pipeline.playback_current() {
                    "grid matches scope"
                } else {
                    "grid rebuilding for scope"
                },
                if filter_pipeline.worker_available {
                    ""
                } else {
                    " · worker unavailable: synchronous build fallback"
                }
            ),
        ),
        ("MIL AIR", osint.military_aircraft.len().to_string()),
        ("CIVIL AIR", osint.aircraft.len().to_string()),
        ("AIS", osint.vessels.len().to_string()),
        (
            "SAT TLE",
            format!(
                "{} supplied · propagated positions update every 10s",
                osint.satellites.len()
            ),
        ),
        ("LAUNCH", osint.launches.len().to_string()),
        ("NATURAL", osint.natural_events.len().to_string()),
        ("GNSS", osint.gps_interference.len().to_string()),
        (
            "IODA",
            format!(
                "{} mapped · {}",
                osint.internet_outages.len(),
                osint
                    .internet_outage_meta
                    .as_ref()
                    .and_then(|meta| meta.status.as_deref())
                    .unwrap_or("metadata unavailable")
            ),
        ),
        (
            "GDELT",
            format!(
                "{} mentions · {}",
                osint.gdelt_geo_news.len(),
                osint
                    .gdelt_geo_meta
                    .as_ref()
                    .and_then(|meta| meta.status.as_deref())
                    .unwrap_or("metadata unavailable")
            ),
        ),
        (
            "UCDP",
            osint
                .ucdp_meta
                .as_ref()
                .and_then(|meta| meta.status.as_deref())
                .unwrap_or("metadata unavailable")
                .to_string(),
        ),
        ("MOW", osint.map_events.len().to_string()),
        (
            "NEWS",
            format!("{} articles (not plotted)", osint.news.len()),
        ),
        (
            "CYBER",
            format!(
                "{} records parsed opaquely; not visualized natively",
                osint.cyber_vulnerabilities.len()
            ),
        ),
        (
            "WEBCAMS",
            format!(
                "{} records parsed opaquely; not visualized natively",
                osint.webcams.len()
            ),
        ),
    ];
    cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
    cursor_y += 7.0;

    if !osint.sources.is_empty() {
        draw_text_mono(
            "SNAPSHOT SOURCE REGISTRY",
            text_x,
            cursor_y,
            9.5,
            Color::new(0.46, 0.45, 0.39, 0.72),
        );
        cursor_y += 14.0;
        for (key, description) in osint.sources.iter().take(5) {
            draw_wrapped_lines(
                &format!("{}: {}", key, description),
                text_x,
                &mut cursor_y,
                62,
                2,
                Color::new(0.56, 0.57, 0.5, 0.76),
            );
        }
        if osint.sources.len() > 5 {
            draw_text_mono(
                &format!(
                    "+{} additional source descriptions not shown",
                    osint.sources.len() - 5
                ),
                text_x,
                cursor_y,
                10.0,
                Color::new(0.56, 0.57, 0.5, 0.72),
            );
            cursor_y += 14.0;
        }
        cursor_y += 4.0;
    }

    if !status.attempts.is_empty() {
        draw_text_mono(
            "RUNTIME REFRESH ATTEMPTS",
            text_x,
            cursor_y,
            9.5,
            Color::new(0.46, 0.45, 0.39, 0.72),
        );
        cursor_y += 14.0;
        for attempt in status.attempts.iter().take(3) {
            let state = if attempt.ok {
                format!(
                    "ok{}{} · {}",
                    if attempt.selected { " · selected" } else { "" },
                    attempt
                        .bytes
                        .map(|bytes| format!(" · {:.1} MiB", bytes as f32 / 1_048_576.0))
                        .unwrap_or_default(),
                    attempt
                        .snapshot_fetched_at
                        .as_deref()
                        .unwrap_or("snapshot timestamp unavailable")
                )
            } else {
                format!(
                    "failed · {}",
                    attempt.error.as_deref().unwrap_or("unknown error")
                )
            };
            let line = format!(
                "{} [{}]: {}",
                attempt.kind.label(),
                truncate_chars(&attempt.detail, 42),
                state
            );
            draw_wrapped_lines(
                &line,
                text_x,
                &mut cursor_y,
                62,
                2,
                Color::new(0.58, 0.59, 0.52, 0.78),
            );
        }
        cursor_y += 4.0;
    }

    if let Some(article) = osint.news.first() {
        draw_text_mono(
            "NEWS CONTEXT · NOT PLOTTED",
            text_x,
            cursor_y,
            9.5,
            Color::new(0.46, 0.45, 0.39, 0.72),
        );
        cursor_y += 13.0;
        draw_wrapped_lines(
            &format!(
                "{} · {} · {} · {}",
                article.source,
                article
                    .published_at
                    .as_deref()
                    .unwrap_or("time unavailable"),
                article.title,
                truncate_chars(&article.url, 72)
            ),
            text_x,
            &mut cursor_y,
            62,
            2,
            Color::new(0.53, 0.54, 0.49, 0.72),
        );
    }

    if let Some(meta) = &osint.internet_outage_meta {
        draw_text_mono(
            "IODA CAVEAT",
            text_x,
            cursor_y,
            9.5,
            Color::new(0.46, 0.45, 0.39, 0.72),
        );
        cursor_y += 13.0;
        draw_wrapped_lines(
            meta.caveat.as_deref().unwrap_or("IODA caveat unavailable"),
            text_x,
            &mut cursor_y,
            62,
            3,
            Color::new(0.53, 0.54, 0.49, 0.72),
        );
    }
    if let Some(meta) = &osint.gdelt_geo_meta {
        draw_text_mono(
            "GDELT ACCOUNTING",
            text_x,
            cursor_y,
            9.5,
            Color::new(0.46, 0.45, 0.39, 0.72),
        );
        cursor_y += 13.0;
        let line = format!(
            "{} mapped/{} conflict rows · {} omitted · {} articles/{} locations. Mentions are media attention, never verified incidents.",
            meta.ingested_mention_count.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            meta.conflict_theme_row_count.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            meta.omitted_mention_count.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            meta.unique_article_count.map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            meta.unique_location_count.map(|v| v.to_string()).unwrap_or_else(|| "?".into())
        );
        draw_wrapped_lines(
            &line,
            text_x,
            &mut cursor_y,
            62,
            3,
            Color::new(0.53, 0.54, 0.49, 0.72),
        );
    }

    let mut errors: Vec<String> = Vec::new();
    errors.extend(data.load_errors.iter().cloned());
    errors.extend(
        status
            .config_warnings
            .iter()
            .map(|value| format!("config: {}", value)),
    );
    errors.extend(
        satellite_errors
            .iter()
            .take(2)
            .map(|value| format!("satellite: {}", value)),
    );
    for attempt in &status.attempts {
        if let Some(error) = &attempt.error {
            errors.push(format!("{} refresh: {}", attempt.kind.label(), error));
        }
    }
    errors.extend(osint.errors.iter().cloned());
    if errors.is_empty() {
        draw_text_mono(
            "PROVIDER/LOADER ERRORS · none reported",
            text_x,
            cursor_y,
            10.0,
            Color::new(0.38, 0.66, 0.45, 0.8),
        );
    } else {
        draw_text_mono(
            "PROVIDER/LOADER ERRORS",
            text_x,
            cursor_y,
            9.5,
            Color::new(1.0, 0.55, 0.24, 0.9),
        );
        cursor_y += 14.0;
        for error in errors.iter().take(7) {
            draw_wrapped_lines(
                error,
                text_x,
                &mut cursor_y,
                62,
                2,
                Color::new(0.86, 0.58, 0.38, 0.82),
            );
            cursor_y += 2.0;
            if cursor_y > y + height - 12.0 {
                break;
            }
        }
        if errors.len() > 7 {
            draw_text_mono(
                &format!("+{} additional errors not shown", errors.len() - 7),
                text_x,
                cursor_y,
                10.0,
                Color::new(0.86, 0.58, 0.38, 0.78),
            );
        }
    }
}

fn snapshot_compact_status(data: &AppData, status: &RuntimeStatus) -> String {
    let freshness = format_relative_iso(data.osint.fetched_at.as_deref());
    let refresh = if status.refresh_in_progress {
        "refreshing"
    } else if status.worker_enabled {
        "auto-refresh"
    } else {
        "refresh disabled"
    };
    format!(
        "{} · snapshot {} · {}",
        data.active_source.label(),
        freshness,
        refresh
    )
}

#[macroquad::main(window_conf)]
async fn main() {
    gl_set_drawcall_buffer_capacity(32000, 32000);

    let mut data = AppData::embedded();
    let earth_bytes = include_bytes!("../../../frontend/public/textures/earth-blue-marble.jpg");
    let earth = Texture2D::from_file_with_format(earth_bytes, Some(ImageFormat::Jpeg));
    earth.set_filter(FilterMode::Linear);
    let cloud_bytes = include_bytes!("../../../frontend/public/textures/clouds.png");
    let clouds = Texture2D::from_file_with_format(cloud_bytes, Some(ImageFormat::Png));
    clouds.set_filter(FilterMode::Linear);

    let border_meshes = build_border_meshes();
    let mut gps_meshes = build_gps_meshes(&data.osint.gps_interference);
    let mut scene = build_scene_meshes(&data.osint, &data.outage_markers, &data.gdelt_markers);
    let mut satellite_state = SatelliteState::new(&data.osint);

    // Operational filter scope pipeline: the initial scan and temporal grid build run inline so
    // the first frame is already consistent. Subsequent rebuilds are delegated to the worker.
    let filter_worker = spawn_filter_analysis_worker();
    let (mut filter_pipeline, initial_analyses) =
        FilterPipeline::initial(&data.incidents, &data.incident_haystacks, filter_worker);
    let mut incident_meshes = build_incident_meshes(&data.incidents, &filter_pipeline.pass.indices);
    filter_pipeline.last_mesh_build_ms = incident_meshes.build_ms;
    filter_pipeline.incident_meshes_dirty = false;

    let refresh_config = config_from_env_and_args();
    let refresh_worker =
        spawn_refresh_worker(refresh_config.clone(), data.fallback_incidents.clone());
    let (refresh_tx, refresh_rx): (
        Option<Sender<RefreshCommand>>,
        Option<Receiver<RefreshMessage>>,
    ) = match refresh_worker {
        Some((tx, rx)) => (Some(tx), Some(rx)),
        None => (None, None),
    };
    let mut runtime_status = RuntimeStatus {
        refresh_in_progress: refresh_rx.is_some(),
        refresh_interval: refresh_config.interval,
        attempts: Vec::new(),
        last_completed_unix: None,
        last_cycle: None,
        worker_enabled: refresh_rx.is_some(),
        config_warnings: refresh_config.warnings.clone(),
    };

    let mut yaw = -1.35f32;
    let mut pitch = 0.32f32;
    let mut distance = 5.8f32;
    let mut drifting = true;
    let mut show_military = true;
    let mut show_civil = true;
    let mut show_maritime = true;
    let mut show_environment = false;
    let mut show_borders = true;
    let mut show_gps = true;
    let mut show_orbital = false;
    let mut show_outages = true;
    let mut show_gdelt = true;
    let mut show_sources = false;
    let mut tour_mode = false;
    let mut tour_index = 0usize;
    let mut last_tour_advance = 0.0f64;
    let mut camera_target: Option<(f32, f32, f32)> = None;
    let mut dragging = false;
    let mut drag_distance = 0.0f32;
    let mut selection: Option<Selection> = None;
    let mut playback = IncidentPlaybackController::new(initial_analyses, detect_reduced_motion());
    let mut playback_visual_cache: Option<PlaybackVisualCache> = None;
    let mut playback_mouse_action: Option<PlaybackClickAction> = None;
    let mut filter_ui = FilterUiState::default();
    let mut filter_hitboxes: Vec<(Rect, FilterAction)> = Vec::new();
    let mut filter_mouse_action: Option<FilterAction> = None;
    let mut filter_mouse_inside_panel = false;

    loop {
        let dt = get_frame_time();
        let width = screen_width();
        let height = screen_height();

        if let Some(receiver) = &refresh_rx {
            let mut newest_report = None;
            let mut saw_started = false;
            while let Ok(message) = receiver.try_recv() {
                match message {
                    RefreshMessage::Started { cycle } => {
                        saw_started = true;
                        runtime_status.last_cycle = Some(cycle);
                    }
                    RefreshMessage::Completed(report) => {
                        newest_report = Some(report);
                    }
                }
            }
            if saw_started {
                runtime_status.refresh_in_progress = true;
            }
            if let Some(report) = newest_report {
                runtime_status.refresh_in_progress = false;
                runtime_status.last_cycle = Some(report.cycle);
                runtime_status.last_completed_unix = Some(report.completed_unix);
                runtime_status.attempts = report.attempts;
                if let Some(active) = report.active {
                    let changed = active.revision != data.revision;
                    if changed {
                        data.apply_runtime_snapshot(active);
                        // Corpus replacement always forces a rescan+rebuild: identical positions
                        // no longer imply identical incidents. The filter spec itself is
                        // deliberately preserved across refreshes, matching the web behavior of
                        // keeping the operator lens stable while data updates underneath it.
                        filter_pipeline.rescan(&data.incidents, &data.incident_haystacks, true);
                        scene = build_scene_meshes(
                            &data.osint,
                            &data.outage_markers,
                            &data.gdelt_markers,
                        );
                        gps_meshes = build_gps_meshes(&data.osint.gps_interference);
                        satellite_state.rebuild(&data.osint);
                        selection = None;
                    } else {
                        data.update_runtime_provenance(
                            active.source,
                            active.detail,
                            active.received_unix,
                        );
                    }
                }
            }
        }

        // Filter pipeline: apply the newest completed analysis build exactly once per frame.
        // Stale generations are dropped — the scope they describe has already been superseded.
        if let Some((generation, analyses, count, build_ms)) = filter_pipeline.pending_sync.take() {
            if generation == filter_pipeline.generation {
                playback.replace_analyses(analyses);
                filter_pipeline.applied_generation = generation;
                filter_pipeline.last_build_ms = build_ms;
                filter_pipeline.last_build_filtered_count = count;
            }
        }
        if let Some(rx) = &filter_pipeline.outcome_rx {
            let mut newest: Option<FilterAnalysisOutcome> = None;
            while let Ok(outcome) = rx.try_recv() {
                if newest
                    .as_ref()
                    .is_none_or(|current: &FilterAnalysisOutcome| {
                        outcome.generation >= current.generation
                    })
                {
                    newest = Some(outcome);
                }
            }
            if let Some(outcome) = newest {
                if outcome.generation == filter_pipeline.generation {
                    playback.replace_analyses(outcome.analyses);
                    filter_pipeline.applied_generation = outcome.generation;
                    filter_pipeline.last_build_ms = outcome.build_ms;
                    filter_pipeline.last_build_filtered_count = outcome.filtered_count;
                }
            }
        }
        satellite_state.update_if_due();

        // ------------------------------------------------------------------
        // Filter panel modal keyboard handling. While open, printable input edits the query
        // live and layer/transport letter keys are deliberately inert — keystrokes must never
        // silently toggle scene layers while the operator is typing a search.
        // ------------------------------------------------------------------
        let mut filter_rescan_needed = false;
        if filter_ui.open {
            while let Some(character) = get_char_pressed() {
                if character.is_control() {
                    continue;
                }
                filter_pipeline.spec.query.push(character);
                filter_rescan_needed = true;
            }
            if is_key_pressed(KeyCode::Backspace) && filter_pipeline.spec.query.pop().is_some() {
                filter_rescan_needed = true;
            }
            if is_key_pressed(KeyCode::Delete) && !filter_pipeline.spec.query.is_empty() {
                filter_pipeline.spec.query.clear();
                filter_rescan_needed = true;
            }
            let columns = filter_cell_column_count(filter_ui.focus_row, &filter_pipeline.pass);
            if is_key_pressed(KeyCode::Up) {
                filter_ui.focus_row = filter_ui.focus_row.saturating_sub(1);
                filter_ui.focus_col = filter_ui
                    .focus_col
                    .min(filter_cell_column_count(filter_ui.focus_row, &filter_pipeline.pass) - 1);
            }
            if is_key_pressed(KeyCode::Down) {
                filter_ui.focus_row = (filter_ui.focus_row + 1).min(FILTER_ROW_COUNT - 1);
                filter_ui.focus_col = filter_ui
                    .focus_col
                    .min(filter_cell_column_count(filter_ui.focus_row, &filter_pipeline.pass) - 1);
            }
            if is_key_pressed(KeyCode::Left) {
                filter_ui.focus_col = filter_ui.focus_col.saturating_sub(1);
            }
            if is_key_pressed(KeyCode::Right) {
                filter_ui.focus_col = (filter_ui.focus_col + 1).min(columns - 1);
            }
            if is_key_pressed(KeyCode::Home) {
                filter_ui.focus_col = 0;
            }
            if is_key_pressed(KeyCode::End) {
                filter_ui.focus_col = columns - 1;
            }
            if is_key_pressed(KeyCode::Enter) || is_key_pressed(KeyCode::KpEnter) {
                if let Some(action) = filter_action_for_cell(
                    filter_ui.focus_row,
                    filter_ui.focus_col,
                    &filter_pipeline.pass,
                ) {
                    apply_filter_action(&mut filter_pipeline.spec, &action);
                    filter_rescan_needed = true;
                }
            }
            // Space is deliberately not an activator: it is literal query text arriving through
            // get_char_pressed, and multi-word queries must stay typeable from any row. Only
            // Escape closes the panel — a typed '/' is legitimate query input while open.
            if is_key_pressed(KeyCode::Escape) {
                filter_ui.open = false;
            }
        } else {
            if is_key_pressed(KeyCode::Slash) {
                filter_ui.open = true;
                filter_ui.focus_row = FILTER_ROW_SEARCH;
                filter_ui.focus_col = 0;
                // The keystroke that opened the panel is chrome, not query text: drain the
                // character queue so the next frame never interprets it as input.
                while get_char_pressed().is_some() {}
            }
            // V cycles the theater scope through the deterministic pre-scope option list;
            // Shift+V cycles backward. The cleared position sits before the first option.
            if is_key_pressed(KeyCode::V) {
                let backward = is_key_down(KeyCode::LeftShift) || is_key_down(KeyCode::RightShift);
                let next = filter::cycle_scope_option(
                    &filter_pipeline.spec.theater,
                    &filter_pipeline.pass.options.theaters,
                    if backward { -1 } else { 1 },
                );
                filter_pipeline.spec.theater = next;
                filter_rescan_needed = true;
            }
        }
        if filter_rescan_needed {
            filter_pipeline.rescan(&data.incidents, &data.incident_haystacks, false);
            let max_col = filter_cell_column_count(filter_ui.focus_row, &filter_pipeline.pass) - 1;
            filter_ui.focus_col = filter_ui.focus_col.min(max_col);
        }
        // Layer, transport, and inspection keys are suspended while the modal filter panel
        // captures input; the panel footer discloses this mode explicitly.
        let scene_keys_enabled = !filter_ui.open;

        if !filter_ui.open && is_key_pressed(KeyCode::Space) {
            drifting = !drifting;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::A) {
            show_military = !show_military;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::C) {
            show_civil = !show_civil;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::M) {
            show_maritime = !show_maritime;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::E) {
            show_environment = !show_environment;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::B) {
            show_borders = !show_borders;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::G) {
            show_gps = !show_gps;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::O) {
            show_orbital = !show_orbital;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::I) {
            show_outages = !show_outages;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::N) {
            show_gdelt = !show_gdelt;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::S) {
            show_sources = !show_sources;
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::R) {
            if let Some(sender) = &refresh_tx {
                let _ = sender.send(RefreshCommand::Now);
                runtime_status.refresh_in_progress = true;
            }
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::T) {
            tour_mode = !tour_mode;
            last_tour_advance = 0.0;
        }
        let playback_modifier_chord = is_key_down(KeyCode::LeftControl)
            || is_key_down(KeyCode::RightControl)
            || is_key_down(KeyCode::LeftAlt)
            || is_key_down(KeyCode::RightAlt);
        if scene_keys_enabled && !playback_modifier_chord && is_key_pressed(KeyCode::P) {
            playback.toggle_active();
        }
        if scene_keys_enabled && playback.active() && !playback_modifier_chord {
            if is_key_pressed(KeyCode::K) || is_key_pressed(KeyCode::Enter) {
                playback.toggle_playing();
            }
            let frame_delta = if is_key_down(KeyCode::LeftShift) || is_key_down(KeyCode::RightShift)
            {
                10
            } else {
                1
            };
            if is_key_pressed(KeyCode::Left) {
                playback.step_frames(-frame_delta);
            }
            if is_key_pressed(KeyCode::Right) {
                playback.step_frames(frame_delta);
            }
            if is_key_pressed(KeyCode::Home) {
                playback.jump_to_start();
            }
            if is_key_pressed(KeyCode::End) {
                playback.jump_to_end();
            }
            if is_key_pressed(KeyCode::LeftBracket) {
                playback.cycle_speed(-1);
            }
            if is_key_pressed(KeyCode::RightBracket) {
                playback.cycle_speed(1);
            }
            if is_key_pressed(KeyCode::Key0) {
                playback.reset();
            }
            if is_key_pressed(KeyCode::Key1) {
                playback.set_mode(PlaybackMode::Step);
            }
            if is_key_pressed(KeyCode::Key2) {
                playback.set_mode(PlaybackMode::Trailing);
            }
            if is_key_pressed(KeyCode::Key3) {
                playback.set_mode(PlaybackMode::Cumulative);
            }
            if is_key_pressed(KeyCode::Z) {
                playback.cycle_mode();
            }
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::Y) {
            playback.cycle_resolution();
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::U) {
            playback.cycle_trail();
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::F) {
            if let Some((lat, lng, _)) = selection.and_then(|selected| {
                selection_position(selected, &data, &satellite_state.positions)
            }) {
                camera_target = Some((lng.to_radians(), lat.to_radians(), 3.35));
            }
        }
        if scene_keys_enabled && is_key_pressed(KeyCode::Escape) {
            selection = None;
        }
        if drifting {
            yaw += dt * 0.055;
        }

        if tour_mode {
            let now = get_time();
            if now - last_tour_advance > 8.0 {
                // The tour visits critical/high incidents inside the current filter scope only:
                // touring filtered-out evidence would silently contradict the operator lens.
                let in_scope_critical_high = |indices: &[u32]| -> Vec<usize> {
                    indices
                        .iter()
                        .map(|index| *index as usize)
                        .filter(|index| {
                            data.incidents.get(*index).is_some_and(|event| {
                                matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
                            })
                        })
                        .take(80)
                        .collect()
                };
                // Playback-active tours visit the visible frame; otherwise the static scope.
                let candidates = if let Some(cache) = playback_visual_cache.as_ref() {
                    in_scope_critical_high(
                        &cache
                            .corpus_indices
                            .iter()
                            .map(|index| *index as u32)
                            .collect::<Vec<u32>>(),
                    )
                } else {
                    in_scope_critical_high(&filter_pipeline.pass.indices)
                };
                if !candidates.is_empty() {
                    let index = candidates[tour_index % candidates.len()];
                    tour_index += 1;
                    if let Some(event) = data.incidents.get(index) {
                        selection = Some(Selection::Incident(index));
                        camera_target = Some((event.lng.to_radians(), event.lat.to_radians(), 3.4));
                    }
                }
                last_tour_advance = now;
            }
        }
        if let Some((target_yaw, target_pitch, target_distance)) = camera_target {
            let blend = (dt * 2.4).min(1.0);
            yaw += angle_delta(target_yaw, yaw) * blend;
            pitch += (target_pitch.clamp(-0.9, 0.9) - pitch) * blend;
            distance += (target_distance - distance) * blend;
            if angle_delta(target_yaw, yaw).abs() < 0.005
                && (target_pitch - pitch).abs() < 0.005
                && (target_distance - distance).abs() < 0.02
            {
                camera_target = None;
            }
        }

        let wheel = mouse_wheel().1;
        if wheel.abs() > 0.01 {
            camera_target = None;
            distance = (distance - wheel * 0.42).clamp(2.8, 9.5);
        }
        let mut pending_pick_mouse: Option<Vec2> = None;

        if is_mouse_button_pressed(MouseButton::Left) {
            camera_target = None;
            let mouse = vec2(mouse_position().0, mouse_position().1);
            playback_mouse_action = playback_hit_action(mouse, height);
            // Filter hitboxes describe last frame's drawn chip/panel geometry (standard
            // immediate-mode one-frame lag). The modal panel rect itself consumes clicks even
            // when they land between cells, so the globe behind it is never picked accidentally.
            filter_mouse_action = filter_hitboxes
                .iter()
                .find(|(rect, _)| rect.contains(mouse))
                .map(|(_, action)| action.clone());
            let (px, py, pw, ph) = filter_panel_rect(width);
            filter_mouse_inside_panel = filter_ui.open && point_in_rect(mouse, px, py, pw, ph);
            drag_distance = 0.0;
            if playback_mouse_action.is_none()
                && !playback_point_in_panel(mouse, height)
                && filter_mouse_action.is_none()
                && !filter_mouse_inside_panel
            {
                dragging = true;
            }
        }
        if dragging {
            let delta = mouse_delta_position();
            drag_distance += delta.length();
            yaw += delta.x * 0.006;
            pitch = (pitch - delta.y * 0.006).clamp(-1.25, 1.25);
        }
        if is_mouse_button_released(MouseButton::Left) {
            let was_click = drag_distance < 7.0;
            dragging = false;
            let mouse = vec2(mouse_position().0, mouse_position().1);
            if let Some(pressed_action) = playback_mouse_action.take() {
                if playback_hit_action(mouse, height) == Some(pressed_action) {
                    apply_playback_click_action(&mut playback, pressed_action);
                }
            } else if was_click && filter_mouse_action.is_some() {
                let released_action = filter_hitboxes
                    .iter()
                    .find(|(rect, _)| rect.contains(mouse))
                    .map(|(_, action)| action.clone());
                if let (Some(pressed), Some(released)) =
                    (filter_mouse_action.take(), released_action)
                {
                    if pressed == released {
                        match pressed {
                            FilterAction::OpenPanel => {
                                filter_ui.open = true;
                                filter_ui.focus_row = FILTER_ROW_SEARCH;
                                filter_ui.focus_col = 0;
                            }
                            FilterAction::ClosePanel => {
                                filter_ui.open = false;
                            }
                            action => {
                                apply_filter_action(&mut filter_pipeline.spec, &action);
                                filter_pipeline.rescan(
                                    &data.incidents,
                                    &data.incident_haystacks,
                                    false,
                                );
                            }
                        }
                    }
                }
                filter_mouse_action = None;
            } else if was_click && filter_mouse_inside_panel {
                // Clicks inside the modal panel but outside cells are consumed deliberately.
            } else if was_click && filter_ui.open {
                // A click outside the open panel closes it without picking the globe underneath;
                // the next click is the pick. No silent dual semantics.
                filter_ui.open = false;
            } else if was_click && !playback_point_in_panel(mouse, height) {
                pending_pick_mouse = Some(mouse);
            }
            filter_mouse_inside_panel = false;
        }

        // Static incident meshes rebuild after all input-triggered rescans of this frame, so
        // markers, picking, and the accounting strip never disagree within a frame. The dirty
        // flag still caps the cost at one rebuild per frame regardless of keystroke count.
        if filter_pipeline.incident_meshes_dirty {
            incident_meshes = build_incident_meshes(&data.incidents, &filter_pipeline.pass.indices);
            filter_pipeline.last_mesh_build_ms = incident_meshes.build_ms;
            filter_pipeline.incident_meshes_dirty = false;
        }

        playback.advance(dt as f64);
        playback.refresh_extraction();
        // The playback lens is scope-aligned only when the analyses inside the controller were
        // built for the current filter generation. During a rebuild the scene falls back to the
        // static scoped markers — never to stale grids whose indices would misalign.
        let playback_scope_current = filter_pipeline.playback_current();
        if playback.active() && playback_scope_current {
            let current_version = playback.extraction_version();
            let needs_rebuild = playback_visual_cache
                .as_ref()
                .is_none_or(|cache| cache.extraction_version != current_version);
            if needs_rebuild {
                playback_visual_cache = playback.extraction().map(|extraction| {
                    build_playback_visual_cache(
                        &data.incidents,
                        &filter_pipeline.pass.indices,
                        extraction,
                        current_version,
                    )
                });
            }
        } else {
            playback_visual_cache = None;
        }
        let playback_extraction_snapshot = if playback.active() && playback_scope_current {
            playback.extraction()
        } else {
            None
        };
        let playback_visible_mask = playback_visual_cache
            .as_ref()
            .map(|cache| cache.visible_mask.as_slice());
        // Selection is evidence inspection, not a playback exemption. When the deterministic lens
        // moves past an incident, stale out-of-window selection is cleared instead of implying
        // that the incident remains visible in the frame.
        if let (Some(_extraction), Some(Selection::Incident(index))) =
            (playback_extraction_snapshot, selection)
        {
            let visible = playback_visual_cache.as_ref().is_some_and(|cache| {
                playback_index_visible_at_detail(
                    &data.incidents,
                    &cache.corpus_indices,
                    index,
                    detail_level(distance),
                )
            });
            if !visible {
                selection = None;
            }
        }
        if let Some(mouse) = pending_pick_mouse {
            let camera = Camera3D {
                position: camera_position(yaw, pitch, distance),
                target: vec3(0.0, 0.0, 0.0),
                up: vec3(0.0, 1.0, 0.0),
                fovy: 45f32.to_radians(),
                ..Default::default()
            };
            selection = pick_entity(
                &camera,
                mouse,
                &data,
                &satellite_state.positions,
                distance,
                show_military,
                show_civil,
                show_maritime,
                show_environment,
                show_orbital,
                show_outages,
                show_gdelt,
                show_gps,
                &filter_pipeline.pass.indices,
                playback_visual_cache
                    .as_ref()
                    .map(|cache| cache.corpus_indices.as_slice()),
            );
        }

        clear_background(Color::new(0.001, 0.004, 0.009, 1.0));
        let camera = Camera3D {
            position: camera_position(yaw, pitch, distance),
            target: vec3(0.0, 0.0, 0.0),
            up: vec3(0.0, 1.0, 0.0),
            fovy: 45f32.to_radians(),
            ..Default::default()
        };
        set_camera(&camera);

        draw_sphere(vec3(0.0, 0.0, 0.0), EARTH_RADIUS, Some(&earth), WHITE);
        draw_sphere(
            vec3(0.0, 0.0, 0.0),
            EARTH_RADIUS * 1.009,
            Some(&clouds),
            Color::new(1.0, 1.0, 1.0, 0.26),
        );
        draw_sphere(
            vec3(0.0, 0.0, 0.0),
            EARTH_RADIUS * 1.045,
            None,
            Color::new(0.24, 0.46, 0.82, 0.055),
        );

        if show_borders {
            draw_meshes(&border_meshes);
        }
        if show_gps {
            draw_meshes(&gps_meshes);
        }

        let level = detail_level(distance);
        if level == 0 {
            if let Some(cache) = playback_visual_cache.as_ref() {
                draw_meshes(&cache.far_priority);
            } else {
                draw_meshes(&incident_meshes.far_priority);
            }
        } else if let Some(cache) = playback_visual_cache.as_ref() {
            draw_meshes(&cache.near);
        } else {
            draw_meshes(&incident_meshes.near);
        }

        if show_military {
            draw_meshes(scene.military.for_level(level));
            draw_meshes(&scene.military_tracks);
        }
        if show_civil {
            draw_meshes(scene.civil.for_level(level));
            draw_meshes(&scene.civil_tracks);
        }
        if show_maritime {
            draw_meshes(scene.vessels.for_level(level));
            draw_meshes(&scene.vessel_tracks);
        }
        if show_environment {
            draw_meshes(&scene.natural);
        }
        if show_orbital {
            draw_meshes(&scene.launches);
            draw_meshes(&satellite_state.meshes);
        }
        if show_outages {
            draw_meshes(&scene.outage_reticles);
            draw_meshes(&scene.outages);
        }
        if show_gdelt {
            draw_meshes(&scene.gdelt);
        }

        set_default_camera();
        draw_rectangle(0.0, 0.0, width, 58.0, Color::new(0.004, 0.008, 0.012, 0.92));
        draw_text_mono(
            "GOD'S EYE",
            22.0,
            34.0,
            27.0,
            Color::new(0.93, 0.9, 0.8, 1.0),
        );
        draw_text_mono(
            "RUST NATIVE MULTI-DOMAIN OSINT",
            178.0,
            32.0,
            14.0,
            Color::new(0.72, 0.6, 0.34, 0.78),
        );
        let critical_count = filter_pipeline
            .pass
            .indices
            .iter()
            .copied()
            .filter(|index| {
                data.incidents
                    .get(*index as usize)
                    .is_some_and(|event| event.severity == "critical")
            })
            .count();
        let stats = format!(
            "{}/{} INCIDENTS  {} CRIT  {} MIL  {} CIV  {} AIS  {} SAT",
            filter_pipeline.pass.stats.output_count,
            data.incidents.len(),
            critical_count,
            data.osint.military_aircraft.len(),
            data.osint.aircraft.len(),
            data.osint.vessels.len(),
            data.osint.satellites.len()
        );
        draw_text_mono(
            &stats,
            (width - stats.len() as f32 * 7.6 - 22.0).max(520.0),
            32.0,
            13.0,
            Color::new(0.86, 0.82, 0.66, 0.9),
        );

        // Persistent scope accounting strip: always drawn, even with the default lens, so the
        // filtered/total relationship is never invisible. Hitboxes are rebuilt per frame.
        filter_hitboxes.clear();
        draw_filter_chips(&filter_pipeline, width, &mut filter_hitboxes);

        // Scope accounting for the priority list is computed up front so the header can
        // disclose it in the same frame — no one-frame-late side effects.
        let hidden_by_scope = data
            .incidents
            .iter()
            .enumerate()
            .filter(|(index, event)| {
                !filter_pipeline
                    .pass
                    .in_scope
                    .get(*index)
                    .copied()
                    .unwrap_or(false)
                    && matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
            })
            .count();
        draw_panel(18.0, 92.0, 292.0, (height - 464.0).max(196.0));
        draw_text_mono(
            "PRIORITY INCIDENTS",
            34.0,
            118.0,
            15.0,
            Color::new(0.77, 0.64, 0.36, 0.85),
        );
        if hidden_by_scope > 0 {
            draw_text_mono(
                &format!("{} critical/high outside filter scope", hidden_by_scope),
                34.0,
                92.0 + 34.0,
                8.5,
                Color::new(0.62, 0.58, 0.42, 0.7),
            );
        }
        let mut list_index = 0usize;
        for event in data
            .incidents
            .iter()
            .enumerate()
            .filter(|(index, event)| {
                filter_pipeline
                    .pass
                    .in_scope
                    .get(*index)
                    .copied()
                    .unwrap_or(false)
                    && playback_visible_mask
                        .and_then(|mask| mask.get(*index).copied())
                        .unwrap_or(true)
                    && matches!(event.severity.as_str(), "critical" | "high" | "c" | "h")
            })
            .map(|(_, event)| event)
        {
            let y = 148.0 + list_index as f32 * 30.0;
            if y > 92.0 + (height - 464.0).max(196.0) - 28.0 || list_index >= 17 {
                break;
            }
            let color = severity_color(&event.severity);
            draw_rectangle(31.0, y - 11.0, 3.0, 19.0, color);
            let truncated = truncate_chars(&event.title, 39);
            draw_text_mono(&truncated, 42.0, y, 13.0, Color::new(0.88, 0.87, 0.82, 0.9));
            let meta = format!(
                "{} · {} · {}",
                event.country,
                event.category.replace('_', " "),
                format_relative_unix(event.occurred_at)
            );
            draw_text_mono(
                &truncate_chars(&meta, 47),
                42.0,
                y + 13.0,
                10.5,
                Color::new(0.52, 0.52, 0.48, 0.7),
            );
            list_index += 1;
        }
        if list_index == 0 {
            let empty_text = if filter_pipeline.pass.stats.output_count == 0 {
                "filter scope is empty — nothing hidden silently"
            } else if playback.active() {
                "no critical/high incidents inside the playback frame"
            } else {
                "no critical/high incidents inside the filter scope"
            };
            draw_text_mono(
                empty_text,
                34.0,
                152.0,
                9.5,
                Color::new(0.66, 0.6, 0.44, 0.78),
            );
        }

        if let Some((lat, lng, radius_world)) = selection
            .and_then(|selected| selection_position(selected, &data, &satellite_state.positions))
        {
            let world = lat_lng_to_vec3(lat, lng, radius_world);
            if let Some(screen) = project_point(&camera, world) {
                if world
                    .normalize_or_zero()
                    .dot(camera.position.normalize_or_zero())
                    > 0.04
                {
                    let color = Color::new(0.95, 0.82, 0.42, 1.0);
                    draw_circle_lines(screen.x, screen.y, 17.0, 1.4, color);
                    draw_circle_lines(
                        screen.x,
                        screen.y,
                        24.0,
                        0.8,
                        Color::new(color.r, color.g, color.b, 0.45),
                    );
                    draw_line(
                        screen.x - 31.0,
                        screen.y,
                        screen.x - 21.0,
                        screen.y,
                        1.0,
                        color,
                    );
                    draw_line(
                        screen.x + 21.0,
                        screen.y,
                        screen.x + 31.0,
                        screen.y,
                        1.0,
                        color,
                    );
                    draw_line(
                        screen.x,
                        screen.y - 31.0,
                        screen.x,
                        screen.y - 21.0,
                        1.0,
                        color,
                    );
                    draw_line(
                        screen.x,
                        screen.y + 21.0,
                        screen.x,
                        screen.y + 31.0,
                        1.0,
                        color,
                    );
                }
            }
        }

        draw_playback_panel(
            &playback,
            playback_visual_cache.as_ref(),
            playback_scope_current,
            filter_pipeline.pass.stats.output_count,
            data.incidents.len(),
            height,
        );

        if width > 980.0 {
            let panel_w = 374.0f32.min(width - 340.0);
            let x = width - panel_w - 18.0;
            if let Some(selected) = selection {
                draw_inspector_panel(
                    selected,
                    &data,
                    playback_extraction_snapshot,
                    &satellite_state.positions,
                    &filter_pipeline,
                    x,
                    92.0,
                    panel_w,
                    height - 184.0,
                );
            } else if show_sources {
                draw_source_status_panel(
                    &data,
                    &runtime_status,
                    &satellite_state.errors,
                    &filter_pipeline,
                    x,
                    92.0,
                    panel_w,
                    height - 184.0,
                );
            } else {
                draw_panel(x, 92.0, panel_w, 214.0);
                draw_text_mono(
                    "DOMAIN PICTURE",
                    x + 15.0,
                    118.0,
                    14.0,
                    Color::new(0.72, 0.6, 0.34, 0.85),
                );
                let lines = [
                    format!(
                        "MIL AIR  {} · tracks are dead reckoning",
                        data.osint.military_aircraft.len()
                    ),
                    format!(
                        "CIVIL    {} · OpenSky state vectors",
                        data.osint.aircraft.len()
                    ),
                    format!(
                        "AIS      {} · regional Baltic coverage",
                        data.osint.vessels.len()
                    ),
                    format!(
                        "ORBIT    {} TLE · {} propagated",
                        data.osint.satellites.len(),
                        satellite_state.positions.len()
                    ),
                    format!(
                        "IODA     {} outage detections",
                        data.osint.internet_outages.len()
                    ),
                    format!(
                        "GDELT    {} media mentions",
                        data.osint.gdelt_geo_news.len()
                    ),
                    format!(
                        "ERRORS   {} provider/ingestion messages",
                        data.osint.errors.len()
                    ),
                ];
                for (index, line) in lines.iter().enumerate() {
                    draw_text_mono(
                        line,
                        x + 15.0,
                        146.0 + index as f32 * 21.0,
                        11.0,
                        Color::new(0.68, 0.69, 0.61, 0.84),
                    );
                }
            }
        }

        draw_panel(18.0, height - 78.0, 1040.0, 58.0);
        draw_text_mono(
            "CLICK inspect  ·  / filter+search  ·  V theater  ·  F focus  ·  T tour  ·  SPACE drift  ·  R refresh  ·  S sources  ·  P playback  ·  K play",
            34.0,
            height - 52.0,
            12.5,
            Color::new(0.72, 0.66, 0.5, 0.84),
        );
        draw_text_mono(
            "←/→ frame (Shift ×10)  [/] speed  Z mode  Y resolution  U trail  ·  A C M O E I N G B layers  ESC close",
            34.0,
            height - 32.0,
            11.5,
            Color::new(0.54, 0.53, 0.46, 0.76),
        );
        let compact = snapshot_compact_status(&data, &runtime_status);
        draw_text_mono(
            &truncate_chars(&compact, 78),
            760.0,
            height - 52.0,
            10.5,
            if runtime_status.refresh_in_progress {
                Color::new(0.45, 0.78, 0.9, 0.9)
            } else {
                Color::new(0.62, 0.58, 0.43, 0.78)
            },
        );

        // The modal filter panel draws above every other surface.
        if filter_ui.open {
            draw_filter_panel(&filter_pipeline, &filter_ui, width, &mut filter_hitboxes);
        }

        next_frame().await;
    }
}

// ---------------------------------------------------------------------------
// Integration tests for the filter<->playback<->render index contract. These exercise the
// crate-root glue that pure module tests cannot: extraction-to-corpus remapping, visual-cache
// masks in corpus space, and scoped mesh construction order over the real embedded snapshot.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::playback::{collect_playback_events, PlaybackMode, TemporalResolutionPreference};

    const NOW: f64 = 1_795_176_000.0; // 2026-11-20T12:00:00Z, fixed for deterministic tests
    const DAY: f64 = 86_400.0;

    fn scoped_real_corpus() -> (Vec<Incident>, Vec<String>, FilterPass) {
        let package = load_embedded();
        assert!(package.load_errors.is_empty(), "{:?}", package.load_errors);
        let correlated = correlate_incidents(package.normalized_incidents, NOW + 6.0 * DAY);
        let haystacks = build_search_haystacks(&correlated.incidents);
        let pass = scan_corpus(
            &correlated.incidents,
            &haystacks,
            &IncidentFilterSpec::default(),
            NOW + 6.0 * DAY,
        );
        (correlated.incidents, haystacks, pass)
    }

    #[test]
    fn remap_extraction_indices_drops_out_of_range_positions_honestly() {
        let scope_indices: Vec<u32> = vec![5, 9, 11];
        let mut extraction = PlaybackExtraction {
            mode: PlaybackMode::Step,
            frame_index: 0,
            frame: crate::playback::TemporalFrameAggregate {
                index: 0,
                key: "test".to_string(),
                label: "test".to_string(),
                start: 0.0,
                end_exclusive: 1.0,
                start_count: 0,
                start_imprecise_count: 0,
                start_critical_count: 0,
                active_count: 0,
                active_imprecise_count: 0,
                active_critical_count: 0,
                active_corroborated_count: 0,
                active_contested_count: 0,
                active_evidence_report_count: 0,
            },
            effective_start: 0.0,
            effective_end_exclusive: 1.0,
            frame_quantized: false,
            event_indices: vec![0, 2, 7, 1],
        };
        let remapped = remap_extraction_indices(&extraction, &scope_indices);
        // Position 7 has no scope entry: dropped rather than misattributed. Order preserved.
        assert_eq!(remapped, vec![5, 11, 9]);
        extraction.event_indices = vec![];
        assert!(remap_extraction_indices(&extraction, &scope_indices).is_empty());
    }

    #[test]
    fn scoped_incident_markers_preserve_scan_order_and_respect_cap() {
        let (incidents, _haystacks, pass) = scoped_real_corpus();
        assert!(pass.indices.len() > 4);
        let markers = scoped_incident_markers(&incidents, &pass.indices, 3);
        assert_eq!(markers.len(), 3);
        // Markers follow scope order, and positions match the underlying incidents exactly.
        for (marker_position, index) in pass.indices.iter().take(3).enumerate() {
            let event = &incidents[*index as usize];
            let expected = lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006);
            let marker = markers[marker_position];
            assert!((marker.center - expected).length() < 1e-5);
        }
    }

    #[test]
    fn visual_cache_masks_are_corpus_positioned_for_filtered_scopes() {
        let (incidents, _haystacks, pass) = scoped_real_corpus();
        let (analyses, _) = filter::build_analyses_for_indices(&incidents, &pass.indices);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        assert!(analysis.frame_count > 0);
        let extraction = collect_playback_events(
            analysis,
            analysis.frame_count as isize - 1,
            PlaybackMode::Cumulative,
            1,
        )
        .expect("cumulative extraction over the real filtered scope");
        assert!(!extraction.event_indices.is_empty());

        let cache = build_playback_visual_cache(&incidents, &pass.indices, &extraction, 7);
        assert_eq!(cache.extraction_version, 7);
        // Every masked corpus position is in scope; no out-of-scope incident is ever rendered.
        assert_eq!(cache.visible_mask.len(), incidents.len());
        for (corpus_index, visible) in cache.visible_mask.iter().enumerate() {
            if *visible {
                assert!(
                    pass.in_scope[corpus_index],
                    "playback mask never escapes the filter scope"
                );
            }
        }
        // The corpus-order remap preserves the extraction's deterministic ordering and never
        // references filtered-out positions.
        assert_eq!(
            cache.corpus_indices.len(),
            extraction.event_indices.len(),
            "real scope indices are total: nothing is dropped"
        );
        for corpus_index in &cache.corpus_indices {
            assert!(pass.in_scope[*corpus_index]);
        }
        // Summary counts describe the same incidents the mask renders.
        assert_eq!(cache.summary.count, extraction.event_indices.len());
    }

    #[test]
    fn static_mesh_rebuild_over_real_scope_is_bounded() {
        let (incidents, _haystacks, pass) = scoped_real_corpus();
        let started = Instant::now();
        const ITERATIONS: usize = 40;
        let mut vertex_total = 0usize;
        for _ in 0..ITERATIONS {
            let meshes = build_incident_meshes(&incidents, &pass.indices);
            vertex_total += meshes
                .near
                .iter()
                .map(|mesh| mesh.vertices.len())
                .sum::<usize>();
            std::hint::black_box(&meshes);
        }
        let average_ms = started.elapsed().as_secs_f64() * 1000.0 / ITERATIONS as f64;
        println!(
            "scoped static mesh rebuild: {:.3} ms average over {} iterations · {} vertices",
            average_ms, ITERATIONS, vertex_total
        );
        assert!(
            average_ms < 8.0,
            "static scoped mesh rebuild averaged {average_ms:.3} ms in debug tests"
        );
    }

    #[test]
    fn empty_scope_mesh_and_cache_paths_do_not_panic() {
        let (incidents, haystacks, _pass) = scoped_real_corpus();
        let mut spec = IncidentFilterSpec::default();
        spec.query = "no incident anywhere matches this exact phrase".to_string();
        let pass = scan_corpus(&incidents, &haystacks, &spec, NOW + 6.0 * DAY);
        assert!(pass.indices.is_empty());
        let meshes = build_incident_meshes(&incidents, &pass.indices);
        assert!(meshes.near.is_empty());
        assert!(meshes.far_priority.is_empty());
        let (analyses, _) = filter::build_analyses_for_indices(&incidents, &pass.indices);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        assert!(collect_playback_events(analysis, 0, PlaybackMode::Step, 1).is_none());
    }

    #[test]
    fn playback_cumulative_extraction_events_never_reference_filtered_out_incidents() {
        let (incidents, haystacks, _pass) = scoped_real_corpus();
        // Narrow to a single theater and verify the end-to-end property on real data.
        let mut spec = IncidentFilterSpec::default();
        let first_pass = scan_corpus(&incidents, &haystacks, &spec, NOW + 6.0 * DAY);
        let theater = first_pass
            .options
            .theaters
            .first()
            .expect("real scope has theaters")
            .key
            .clone();
        spec.theater = Some(theater.clone());
        let pass = scan_corpus(&incidents, &haystacks, &spec, NOW + 6.0 * DAY);
        assert!(!pass.indices.is_empty());
        assert!(pass.indices.len() < first_pass.indices.len());
        for index in &pass.indices {
            assert_eq!(incidents[*index as usize].theater, theater);
        }
        let (analyses, _) = filter::build_analyses_for_indices(&incidents, &pass.indices);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        if analysis.frame_count == 0 {
            return;
        }
        let extraction = collect_playback_events(
            analysis,
            analysis.frame_count as isize - 1,
            PlaybackMode::Cumulative,
            1,
        )
        .expect("extraction");
        for position in &extraction.event_indices {
            let corpus_index = pass.indices[*position] as usize;
            assert_eq!(incidents[corpus_index].theater, theater);
        }
    }
}
