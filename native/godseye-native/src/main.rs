use macroquad::prelude::*;
mod data;

use data::{load_embedded, Aircraft, GpsInterferenceCell, Incident};
use std::str::FromStr;

const EARTH_RADIUS: f32 = 2.0;
fn severity_color(severity: &str) -> Color {
    match severity {
        "c" => Color::new(1.0, 0.08, 0.22, 1.0),
        "h" => Color::new(1.0, 0.48, 0.0, 1.0),
        "m" => Color::new(1.0, 0.78, 0.28, 1.0),
        _ => Color::new(0.2, 0.82, 0.52, 1.0),
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

fn track_end(lat: f32, lng: f32, track: f32, speed: f32) -> (f32, f32) {
    let distance_nm = (speed * 0.28).min(260.0);
    let angular = distance_nm / 3440.065;
    let bearing = track.to_radians();
    let lat1 = lat.to_radians();
    let lng1 = lng.to_radians();
    let lat2 = (lat1.sin() * angular.cos() + lat1.cos() * angular.sin() * bearing.cos()).asin();
    let lng2 = lng1
        + (bearing.sin() * angular.sin() * lat1.cos())
            .atan2(angular.cos() - lat1.sin() * lat2.sin());
    (
        lat2.to_degrees(),
        (lng2.to_degrees() + 540.0) % 360.0 - 180.0,
    )
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

fn build_aircraft_track_meshes(aircraft: &[Aircraft]) -> Vec<Mesh> {
    let mut builder = RibbonBuilder::new();
    let color = Color::new(0.7, 0.78, 0.52, 0.34);
    for item in aircraft.iter().take(240) {
        let (Some(track), Some(speed)) = (item.track, item.speed) else {
            continue;
        };
        if speed <= 70.0 {
            continue;
        }
        let (end_lat, end_lng) = track_end(item.lat, item.lng, track, speed);
        let start = lat_lng_to_vec3(item.lat, item.lng, 1.0).normalize_or_zero();
        let end = lat_lng_to_vec3(end_lat, end_lng, 1.0).normalize_or_zero();
        if start.length_squared() < 0.5 || end.length_squared() < 0.5 {
            continue;
        }
        let mut previous = start * EARTH_RADIUS * 1.035;
        for step in 1..=7 {
            let current = slerp_unit(start, end, step as f32 / 7.0) * EARTH_RADIUS * 1.035;
            builder.push_segment(previous, current, 0.0022, color);
            previous = current;
        }
    }
    builder.finish()
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

fn build_event_meshes(events: &[Incident]) -> Vec<Mesh> {
    const EVENTS_PER_MESH: usize = 320;
    events
        .iter()
        .take(900)
        .collect::<Vec<_>>()
        .chunks(EVENTS_PER_MESH)
        .map(|chunk| {
            let mut vertices = Vec::with_capacity(chunk.len() * 6);
            let mut indices = Vec::with_capacity(chunk.len() * 24);
            for event in chunk {
                let color = severity_color(&event.severity);
                let radius = match event.severity.as_str() {
                    "c" => 0.024,
                    "h" => 0.018,
                    "m" => 0.013,
                    _ => 0.009,
                };
                append_octahedron(
                    &mut vertices,
                    &mut indices,
                    lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006),
                    radius,
                    color,
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
fn build_aircraft_mesh(aircraft: &[Aircraft]) -> Mesh {
    let mut vertices = Vec::with_capacity(aircraft.len().min(220) * 6);
    let mut indices = Vec::with_capacity(aircraft.len().min(220) * 24);
    for item in aircraft.iter().take(220) {
        append_octahedron(
            &mut vertices,
            &mut indices,
            lat_lng_to_vec3(item.lat, item.lng, EARTH_RADIUS * 1.035),
            0.01,
            Color::new(0.7, 0.78, 0.52, 1.0),
        );
    }
    Mesh {
        vertices,
        indices,
        texture: None,
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut output: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    output.push('…');
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

fn relative_time(ts: f64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as f64)
        .unwrap_or(ts);
    let delta = now - ts;
    if delta < -3600.0 {
        format!("T+{:.0}H", -delta / 3600.0)
    } else if delta < 3600.0 {
        format!("{:.0}M AGO", (delta.max(0.0)) / 60.0)
    } else if delta < 86400.0 {
        format!("{:.1}H AGO", delta / 3600.0)
    } else {
        format!("{:.0}D AGO", delta / 86400.0)
    }
}

fn build_natural_mesh(events: &[data::NaturalEvent]) -> Mesh {
    let mut vertices = Vec::with_capacity(events.len().min(100) * 6);
    let mut indices = Vec::with_capacity(events.len().min(100) * 24);
    for event in events.iter().take(100) {
        append_octahedron(
            &mut vertices,
            &mut indices,
            lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.012),
            0.011,
            Color::new(0.18, 0.82, 0.38, 1.0),
        );
    }
    Mesh {
        vertices,
        indices,
        texture: None,
    }
}

fn draw_panel(x: f32, y: f32, w: f32, h: f32) {
    draw_rectangle(x, y, w, h, Color::new(0.015, 0.022, 0.018, 0.88));
    draw_rectangle_lines(x, y, w, h, 1.0, Color::new(0.68, 0.57, 0.3, 0.28));
}

fn draw_text_mono(text: &str, x: f32, y: f32, size: f32, color: Color) {
    draw_text(text, x, y, size, color);
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

#[macroquad::main(window_conf)]
async fn main() {
    gl_set_drawcall_buffer_capacity(24000, 24000);

    let (incidents, osint) = load_embedded();
    let earth_bytes = include_bytes!("../../../frontend/public/textures/earth-blue-marble.jpg");
    let earth = Texture2D::from_file_with_format(earth_bytes, Some(ImageFormat::Jpeg));
    earth.set_filter(FilterMode::Linear);
    let cloud_bytes = include_bytes!("../../../frontend/public/textures/clouds.png");
    let clouds = Texture2D::from_file_with_format(cloud_bytes, Some(ImageFormat::Png));
    clouds.set_filter(FilterMode::Linear);
    let event_meshes = build_event_meshes(&incidents);
    let aircraft_mesh = build_aircraft_mesh(&osint.aircraft);
    let aircraft_track_meshes = build_aircraft_track_meshes(&osint.aircraft);
    let natural_mesh = build_natural_mesh(&osint.natural_events);
    let priority_incidents: Vec<Incident> = incidents
        .iter()
        .filter(|event| matches!(event.severity.as_str(), "c" | "h"))
        .cloned()
        .collect();
    let priority_event_meshes = build_event_meshes(&priority_incidents);
    let mut aircraft_by_speed: Vec<&Aircraft> = osint.aircraft.iter().collect();
    aircraft_by_speed.sort_by(|a, b| {
        b.speed
            .unwrap_or(0.0)
            .partial_cmp(&a.speed.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let border_meshes = build_border_meshes();
    let gps_meshes = build_gps_meshes(&osint.gps_interference);

    let mut yaw = -1.35f32;
    let mut pitch = 0.32f32;
    let mut distance = 5.8f32;
    let mut drifting = true;
    let mut show_aircraft = true;
    let mut show_environment = false;
    let mut show_borders = true;
    let mut show_gps = true;
    let mut tour_mode = false;
    let mut tour_index = 0usize;
    let mut last_tour_advance = 0.0f64;
    let mut camera_target: Option<(f32, f32, f32)> = None;
    let mut dragging = false;
    let mut drag_distance = 0.0f32;
    let mut selected_incident: Option<usize> = None;
    let critical_count = incidents
        .iter()
        .filter(|event| event.severity == "c")
        .count();

    loop {
        let dt = get_frame_time();
        if is_key_pressed(KeyCode::Space) {
            drifting = !drifting;
        }
        if is_key_pressed(KeyCode::A) {
            show_aircraft = !show_aircraft;
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
        if is_key_pressed(KeyCode::T) {
            tour_mode = !tour_mode;
            last_tour_advance = 0.0;
        }
        if is_key_pressed(KeyCode::F) {
            if let Some(event) = selected_incident.and_then(|index| incidents.get(index)) {
                camera_target = Some((event.lng.to_radians(), event.lat.to_radians(), 3.35));
            }
        }
        if is_key_pressed(KeyCode::Escape) {
            selected_incident = None;
        }
        if drifting {
            yaw += dt * 0.055;
        }

        if tour_mode {
            let now = get_time();
            if now - last_tour_advance > 8.0 {
                let targets: Vec<&Incident> = incidents
                    .iter()
                    .filter(|event| matches!(event.severity.as_str(), "c" | "h"))
                    .take(80)
                    .collect();
                if !targets.is_empty() {
                    let event = targets[tour_index % targets.len()];
                    tour_index += 1;
                    selected_incident = incidents.iter().position(|item| std::ptr::eq(item, event));
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
                let camera_dir = camera.position.normalize();
                selected_incident = incidents
                    .iter()
                    .enumerate()
                    .filter_map(|(index, event)| {
                        let world = lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006);
                        if world.normalize().dot(camera_dir) < 0.04 {
                            return None;
                        }
                        let screen = project_point(&camera, world)?;
                        let delta = screen - mouse;
                        (delta.length() < 18.0).then_some((index, delta.length()))
                    })
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|(index, _)| index);
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
            for mesh in &border_meshes {
                draw_mesh(mesh);
            }
        }
        if show_gps {
            for mesh in &gps_meshes {
                draw_mesh(mesh);
            }
        }

        let visible_event_meshes = if distance > 5.3 {
            &priority_event_meshes
        } else {
            &event_meshes
        };
        for mesh in visible_event_meshes {
            draw_mesh(mesh);
        }

        if show_aircraft {
            draw_mesh(&aircraft_mesh);
            for mesh in &aircraft_track_meshes {
                draw_mesh(mesh);
            }
        }

        if show_environment {
            draw_mesh(&natural_mesh);
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
            "RUST NATIVE GLOBAL CONFLICT SURVEILLANCE",
            178.0,
            32.0,
            14.0,
            Color::new(0.72, 0.6, 0.34, 0.78),
        );
        let stats = format!(
            "{} INCIDENTS   {} CRITICAL   {} AIRCRAFT",
            incidents.len(),
            critical_count,
            osint.aircraft.len()
        );
        draw_text_mono(
            &stats,
            width - stats.len() as f32 * 8.2 - 22.0,
            32.0,
            14.0,
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
        for (index, event) in incidents.iter().take(18).enumerate() {
            let y = 132.0 + index as f32 * 30.0;
            if y > height - 105.0 {
                break;
            }
            let color = severity_color(&event.severity);
            draw_rectangle(31.0, y - 11.0, 3.0, 19.0, color);
            let title = event.title.as_str();
            let truncated = truncate_chars(title, 39);
            draw_text_mono(&truncated, 42.0, y, 13.0, Color::new(0.88, 0.87, 0.82, 0.9));
            let category = event.category.replace('_', " ");
            let meta = format!("{} · {}", event.country, category);
            draw_text_mono(
                &meta,
                42.0,
                y + 13.0,
                10.5,
                Color::new(0.52, 0.52, 0.48, 0.7),
            );
        }

        if selected_incident
            .and_then(|index| incidents.get(index))
            .is_some()
        {
            let index = selected_incident.unwrap();
            let event = &incidents[index];
            let world = lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.006);
            if let Some(screen) = project_point(&camera, world) {
                if world.normalize().dot(camera.position.normalize()) > 0.04 {
                    let color = severity_color(&event.severity);
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

            let panel_w = 350.0f32.min(width - 640.0);
            if panel_w > 270.0 {
                let x = width - panel_w - 18.0;
                draw_panel(x, 78.0, panel_w, 284.0);
                let severity = match event.severity.as_str() {
                    "c" => "CRITICAL",
                    "h" => "HIGH",
                    "m" => "MEDIUM",
                    _ => "LOW",
                };
                draw_text_mono(
                    &format!("TARGET LOCK · {}", severity),
                    x + 15.0,
                    104.0,
                    14.0,
                    severity_color(&event.severity),
                );
                for (line_index, line) in wrap_text(&event.title, 43, 3).iter().enumerate() {
                    draw_text_mono(
                        line,
                        x + 15.0,
                        130.0 + line_index as f32 * 17.0,
                        15.0,
                        Color::new(0.91, 0.9, 0.84, 0.96),
                    );
                }
                let category = event.category.replace('_', " ");
                let rows = [
                    format!("CONFLICT   {}", truncate_chars(&event.conflict, 28)),
                    format!("REGION     {}", event.country),
                    format!("CATEGORY   {}", category),
                    format!("CASUALTIES {:.0}", event.casualties),
                    format!("POSITION   {:.3} / {:.3}", event.lat, event.lng),
                    format!("REPORTED   {}", relative_time(event.occurred_at)),
                ];
                for (row_index, row) in rows.iter().enumerate() {
                    draw_text_mono(
                        row,
                        x + 15.0,
                        192.0 + row_index as f32 * 21.0,
                        12.0,
                        Color::new(0.63, 0.62, 0.55, 0.82),
                    );
                }
            }
        } else if width > 1180.0 {
            let x = width - 350.0;
            draw_panel(x, 78.0, 332.0, 174.0);
            draw_text_mono(
                "AIR PICTURE",
                x + 15.0,
                104.0,
                14.0,
                Color::new(0.72, 0.6, 0.34, 0.85),
            );
            for (index, item) in aircraft_by_speed.iter().take(5).enumerate() {
                let y = 130.0 + index as f32 * 22.0;
                let identity = item
                    .callsign
                    .as_deref()
                    .filter(|value| *value != "MILITARY")
                    .or(item.registration.as_deref())
                    .unwrap_or("UNKNOWN");
                let details = format!(
                    "{}  {}  FL{:.0}  {:.0}KT",
                    truncate_chars(identity, 10),
                    item.aircraft_type.as_deref().unwrap_or("MIL"),
                    item.altitude.unwrap_or(0.0) / 100.0,
                    item.speed.unwrap_or(0.0)
                );
                draw_text_mono(
                    &details,
                    x + 15.0,
                    y,
                    11.5,
                    Color::new(0.72, 0.75, 0.62, 0.86),
                );
            }
        }

        if show_environment && width > 1180.0 && selected_incident.is_none() {
            let x = width - 350.0;
            draw_panel(x, 268.0, 332.0, 142.0);
            draw_text_mono(
                "ENVIRONMENTAL WATCH",
                x + 15.0,
                294.0,
                14.0,
                Color::new(0.34, 0.72, 0.48, 0.85),
            );
            for (index, item) in osint.natural_events.iter().take(4).enumerate() {
                let y = 320.0 + index as f32 * 21.0;
                let line = format!("{} · {}", truncate_chars(&item.title, 28), item.category);
                draw_text_mono(&line, x + 15.0, y, 10.8, Color::new(0.52, 0.68, 0.56, 0.82));
            }
        }

        draw_panel(18.0, height - 70.0, 820.0, 48.0);
        draw_text_mono(
            "CLICK select  ·  F focus  ·  T tour  ·  SPACE drift  ·  A air  ·  E env  ·  B borders  ·  G GPS",
            34.0,
            height - 41.0,
            13.0,
            Color::new(0.72, 0.66, 0.5, 0.82),
        );

        next_frame().await;
    }
}
