use macroquad::prelude::*;
use serde::Deserialize;

const EARTH_RADIUS: f32 = 2.0;

#[derive(Debug, Deserialize)]
struct ConflictFallback {
    events: Vec<WarEvent>,
}

#[derive(Debug, Deserialize)]
struct WarEvent {
    #[serde(rename = "la")]
    lat: f32,
    #[serde(rename = "lo")]
    lng: f32,
    #[serde(rename = "s")]
    #[serde(default)]
    severity: Option<String>,
    #[serde(rename = "c")]
    #[serde(default)]
    category: Option<String>,
    #[serde(rename = "ti")]
    #[serde(default)]
    title: Option<String>,
    #[serde(rename = "n")]
    #[serde(default)]
    country: Option<String>,
    #[serde(rename = "cf")]
    #[serde(default)]
    conflict: Option<String>,
    #[serde(rename = "x")]
    #[serde(default)]
    casualties: Option<f32>,
    #[serde(rename = "et")]
    #[serde(default)]
    occurred_at: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct OsintSnapshot {
    #[serde(rename = "militaryAircraft", default)]
    aircraft: Vec<Aircraft>,
    #[serde(rename = "naturalEvents", default)]
    natural_events: Vec<NaturalEvent>,
}

#[derive(Debug, Deserialize)]
struct Aircraft {
    lat: f32,
    lng: f32,
    #[serde(default)]
    callsign: Option<String>,
    #[serde(default)]
    track: Option<f32>,
    #[serde(default)]
    speed: Option<f32>,
    #[serde(default)]
    altitude: Option<f32>,
}

#[derive(Debug, Deserialize)]
struct NaturalEvent {
    lat: f32,
    lng: f32,
    title: String,
    category: String,
}

fn severity_color(severity: Option<&str>) -> Color {
    match severity {
        Some("c") => Color::new(1.0, 0.08, 0.22, 1.0),
        Some("h") => Color::new(1.0, 0.48, 0.0, 1.0),
        Some("m") => Color::new(1.0, 0.78, 0.28, 1.0),
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

fn build_event_meshes(events: &[WarEvent]) -> Vec<Mesh> {
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
                let color = severity_color(event.severity.as_deref());
                let radius = match event.severity.as_deref() {
                    Some("c") => 0.024,
                    Some("h") => 0.018,
                    Some("m") => 0.013,
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

    let conflict: ConflictFallback = serde_json::from_str(include_str!(
        "../../../frontend/public/data/conflict-fallback.json"
    ))
    .expect("valid conflict fallback snapshot");
    let osint: OsintSnapshot = serde_json::from_str(include_str!(
        "../../../frontend/public/data/osint-snapshot.json"
    ))
    .expect("valid osint snapshot");
    let earth_bytes = include_bytes!("../../../frontend/public/textures/earth-blue-marble.jpg");
    let earth = Texture2D::from_file_with_format(earth_bytes, Some(ImageFormat::Jpeg));
    earth.set_filter(FilterMode::Linear);
    let event_meshes = build_event_meshes(&conflict.events);
    let aircraft_mesh = build_aircraft_mesh(&osint.aircraft);

    let mut yaw = -1.35f32;
    let mut pitch = 0.32f32;
    let mut distance = 5.8f32;
    let mut drifting = true;
    let mut show_aircraft = true;
    let mut show_environment = false;
    let mut dragging = false;
    let critical_count = conflict
        .events
        .iter()
        .filter(|event| event.severity.as_deref() == Some("c"))
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
        if drifting {
            yaw += dt * 0.055;
        }

        let wheel = mouse_wheel().1;
        if wheel.abs() > 0.01 {
            distance = (distance - wheel * 0.42).clamp(2.8, 9.5);
        }
        if is_mouse_button_pressed(MouseButton::Left) {
            dragging = true;
        }
        if is_mouse_button_released(MouseButton::Left) {
            dragging = false;
        }
        if dragging {
            let delta = mouse_delta_position();
            yaw += delta.x * 0.006;
            pitch = (pitch - delta.y * 0.006).clamp(-1.25, 1.25);
        }

        clear_background(Color::new(0.001, 0.004, 0.009, 1.0));
        set_camera(&Camera3D {
            position: camera_position(yaw, pitch, distance),
            target: vec3(0.0, 0.0, 0.0),
            up: vec3(0.0, 1.0, 0.0),
            fovy: 45f32.to_radians(),
            ..Default::default()
        });

        draw_sphere(vec3(0.0, 0.0, 0.0), EARTH_RADIUS, Some(&earth), WHITE);

        for mesh in &event_meshes {
            draw_mesh(mesh);
        }

        if show_aircraft {
            draw_mesh(&aircraft_mesh);
            for aircraft in osint.aircraft.iter().take(220) {
                let start = lat_lng_to_vec3(aircraft.lat, aircraft.lng, EARTH_RADIUS * 1.035);
                if let (Some(track), Some(speed)) = (aircraft.track, aircraft.speed) {
                    if speed > 70.0 {
                        let (end_lat, end_lng) =
                            track_end(aircraft.lat, aircraft.lng, track, speed);
                        let end = lat_lng_to_vec3(end_lat, end_lng, EARTH_RADIUS * 1.035);
                        draw_line_3d(start, end, Color::new(0.7, 0.78, 0.52, 0.34));
                    }
                }
            }
        }

        if show_environment {
            for event in osint.natural_events.iter().take(80) {
                draw_sphere(
                    lat_lng_to_vec3(event.lat, event.lng, EARTH_RADIUS * 1.012),
                    0.011,
                    None,
                    Color::new(0.18, 0.82, 0.38, 1.0),
                );
            }
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
            conflict.events.len(),
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
        let mut recent: Vec<&WarEvent> = conflict.events.iter().collect();
        recent.sort_by(|a, b| {
            b.occurred_at
                .partial_cmp(&a.occurred_at)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (index, event) in recent.iter().take(18).enumerate() {
            let y = 132.0 + index as f32 * 30.0;
            if y > height - 105.0 {
                break;
            }
            let color = severity_color(event.severity.as_deref());
            draw_rectangle(31.0, y - 11.0, 3.0, 19.0, color);
            let title = event.title.as_deref().unwrap_or("Untitled incident");
            let truncated = truncate_chars(title, 39);
            draw_text_mono(&truncated, 42.0, y, 13.0, Color::new(0.88, 0.87, 0.82, 0.9));
            let category = event
                .category
                .as_deref()
                .unwrap_or("other")
                .replace('_', " ");
            let meta = format!(
                "{} · {}",
                event.country.as_deref().unwrap_or("Unknown"),
                category
            );
            draw_text_mono(
                &meta,
                42.0,
                y + 13.0,
                10.5,
                Color::new(0.52, 0.52, 0.48, 0.7),
            );
        }

        draw_panel(18.0, height - 70.0, 560.0, 48.0);
        draw_text_mono(
            "DRAG orbit  ·  WHEEL zoom  ·  SPACE drift  ·  A aircraft  ·  E environment",
            34.0,
            height - 41.0,
            13.0,
            Color::new(0.72, 0.66, 0.5, 0.82),
        );

        next_frame().await;
    }
}
