use macroquad::prelude::*;
mod data;
mod refresh;
mod satellite;

use data::{
    build_gdelt_location_markers, build_internet_outage_markers, load_embedded, parse_rfc3339_unix,
    rebuild_incidents, snapshot_revision, unix_time_now, GdeltLocationMarker, GpsInterferenceCell,
    Incident, InternetOutageMarker, NativeDataPackage, OsintSnapshot,
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
use std::time::Duration;

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

fn incident_markers(incidents: &[Incident], cap: usize) -> Vec<RenderMarker> {
    incidents
        .iter()
        .take(cap)
        .map(|event| RenderMarker {
            center: lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006),
            radius: incident_radius(&event.severity),
            color: severity_color(&event.severity),
        })
        .collect()
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
    incident_near: Vec<Mesh>,
    incident_far_priority: Vec<Mesh>,
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

fn build_scene_meshes(
    incidents: &[Incident],
    osint: &OsintSnapshot,
    outage_markers: &[InternetOutageMarker],
    gdelt_markers: &[GdeltLocationMarker],
) -> SceneMeshes {
    let priority_incidents: Vec<Incident> = incidents
        .iter()
        .filter(|event| matches!(event.severity.as_str(), "critical" | "high" | "c" | "h"))
        .cloned()
        .collect();
    let incident_near = build_marker_meshes(&incident_markers(incidents, INCIDENT_CAP));
    let incident_far_priority = build_marker_meshes(&incident_markers(&priority_incidents, 420));

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
        incident_near,
        incident_far_priority,
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
    incidents: Vec<Incident>,
    fallback_incidents: Vec<Incident>,
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
            incidents,
            fallback_incidents,
            osint,
            conflict_generated_at,
            conflict_source,
            conflict_license,
            load_errors,
        } = load_embedded();
        let outage_markers = build_internet_outage_markers(&osint.internet_outages);
        let gdelt_markers = build_gdelt_location_markers(&osint.gdelt_geo_news);
        let revision = snapshot_revision(&osint);
        Self {
            incidents,
            fallback_incidents,
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
            active_loaded_unix: unix_time_now(),
        }
    }

    fn apply_runtime_snapshot(&mut self, active: ActiveSnapshot) {
        self.osint = active.snapshot;
        self.incidents = rebuild_incidents(&self.fallback_incidents, &self.osint);
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
) -> Option<Selection> {
    let mut best = None;
    let level = detail_level(distance);
    if level == 0 {
        for (index, event) in data
            .incidents
            .iter()
            .enumerate()
            .filter(|(_, event)| matches!(event.severity.as_str(), "critical" | "high"))
            .take(420)
        {
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
        for (index, event) in data.incidents.iter().take(INCIDENT_CAP).enumerate() {
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
    satellite_positions: &[SatellitePosition],
    x: f32,
    y: f32,
    width: f32,
    max_height: f32,
) {
    let panel_height = max_height.min(570.0);
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
            cursor_y = draw_rows(&rows, text_x, cursor_y, width_chars);
            cursor_y += 8.0;
            draw_wrapped_lines(
                "Normalized conflict evidence. No cross-source correlation, causality, intent, or casualty certainty is implied; optional fields that were absent remain explicitly unavailable.",
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

fn draw_source_status_panel(
    data: &AppData,
    status: &RuntimeStatus,
    satellite_errors: &[String],
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
    let mut scene = build_scene_meshes(
        &data.incidents,
        &data.osint,
        &data.outage_markers,
        &data.gdelt_markers,
    );
    let mut satellite_state = SatelliteState::new(&data.osint);

    let refresh_config = config_from_env_and_args();
    let refresh_worker = spawn_refresh_worker(refresh_config.clone());
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

    loop {
        let dt = get_frame_time();

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
                        scene = build_scene_meshes(
                            &data.incidents,
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

        satellite_state.update_if_due();

        if is_key_pressed(KeyCode::Space) {
            drifting = !drifting;
        }
        if is_key_pressed(KeyCode::A) {
            show_military = !show_military;
        }
        if is_key_pressed(KeyCode::C) {
            show_civil = !show_civil;
        }
        if is_key_pressed(KeyCode::M) {
            show_maritime = !show_maritime;
        }
        if is_key_pressed(KeyCode::E) {
            show_environment = !show_environment;
        }
        if is_key_pressed(KeyCode::B) {
            show_borders = !show_borders;
        }
        if is_key_pressed(KeyCode::G) {
            show_gps = !show_gps;
        }
        if is_key_pressed(KeyCode::O) {
            show_orbital = !show_orbital;
        }
        if is_key_pressed(KeyCode::I) {
            show_outages = !show_outages;
        }
        if is_key_pressed(KeyCode::N) {
            show_gdelt = !show_gdelt;
        }
        if is_key_pressed(KeyCode::S) {
            show_sources = !show_sources;
        }
        if is_key_pressed(KeyCode::R) {
            if let Some(sender) = &refresh_tx {
                let _ = sender.send(RefreshCommand::Now);
                runtime_status.refresh_in_progress = true;
            }
        }
        if is_key_pressed(KeyCode::T) {
            tour_mode = !tour_mode;
            last_tour_advance = 0.0;
        }
        if is_key_pressed(KeyCode::F) {
            if let Some((lat, lng, _)) = selection.and_then(|selected| {
                selection_position(selected, &data, &satellite_state.positions)
            }) {
                camera_target = Some((lng.to_radians(), lat.to_radians(), 3.35));
            }
        }
        if is_key_pressed(KeyCode::Escape) {
            selection = None;
        }
        if drifting {
            yaw += dt * 0.055;
        }

        if tour_mode {
            let now = get_time();
            if now - last_tour_advance > 8.0 {
                let target_count = data
                    .incidents
                    .iter()
                    .filter(|event| matches!(event.severity.as_str(), "critical" | "high"))
                    .take(80)
                    .count();
                let target = (target_count > 0)
                    .then(|| {
                        data.incidents
                            .iter()
                            .enumerate()
                            .filter(|(_, event)| {
                                matches!(event.severity.as_str(), "critical" | "high")
                            })
                            .take(80)
                            .nth(tour_index % target_count)
                    })
                    .flatten();
                if let Some((index, event)) = target {
                    tour_index += 1;
                    selection = Some(Selection::Incident(index));
                    camera_target = Some((event.lng.to_radians(), event.lat.to_radians(), 3.4));
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
        if is_mouse_button_pressed(MouseButton::Left) {
            camera_target = None;
            dragging = true;
            drag_distance = 0.0;
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
            if was_click {
                let mouse = vec2(mouse_position().0, mouse_position().1);
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
                );
            }
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
            draw_meshes(&scene.incident_far_priority);
        } else {
            draw_meshes(&scene.incident_near);
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
        let width = screen_width();
        let height = screen_height();
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
        let critical_count = data
            .incidents
            .iter()
            .filter(|event| event.severity == "critical")
            .count();
        let stats = format!(
            "{} INCIDENTS  {} CRIT  {} MIL  {} CIV  {} AIS  {} SAT",
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

        draw_panel(18.0, 78.0, 292.0, height - 168.0);
        draw_text_mono(
            "PRIORITY INCIDENTS",
            34.0,
            104.0,
            15.0,
            Color::new(0.77, 0.64, 0.36, 0.85),
        );
        let mut list_index = 0usize;
        for event in data
            .incidents
            .iter()
            .filter(|event| matches!(event.severity.as_str(), "critical" | "high"))
        {
            let y = 132.0 + list_index as f32 * 30.0;
            if y > height - 105.0 || list_index >= 18 {
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

        if width > 980.0 {
            let panel_w = 374.0f32.min(width - 340.0);
            let x = width - panel_w - 18.0;
            if let Some(selected) = selection {
                draw_inspector_panel(
                    selected,
                    &data,
                    &satellite_state.positions,
                    x,
                    78.0,
                    panel_w,
                    height - 170.0,
                );
            } else if show_sources {
                draw_source_status_panel(
                    &data,
                    &runtime_status,
                    &satellite_state.errors,
                    x,
                    78.0,
                    panel_w,
                    height - 170.0,
                );
            } else {
                draw_panel(x, 78.0, panel_w, 214.0);
                draw_text_mono(
                    "DOMAIN PICTURE",
                    x + 15.0,
                    104.0,
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
                        132.0 + index as f32 * 21.0,
                        11.0,
                        Color::new(0.68, 0.69, 0.61, 0.84),
                    );
                }
            }
        }

        draw_panel(18.0, height - 78.0, 1040.0, 58.0);
        draw_text_mono(
            "CLICK inspect  ·  F focus  ·  T tour  ·  SPACE drift  ·  R refresh  ·  S sources",
            34.0,
            height - 52.0,
            12.5,
            Color::new(0.72, 0.66, 0.5, 0.84),
        );
        draw_text_mono(
            "A military  C civil  M maritime  O orbital  E env  I outages  N media  G GPS  B borders  ESC close",
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

        next_frame().await;
    }
}
