use std::alloc::{alloc, dealloc, Layout};
use std::cmp::Ordering;

#[no_mangle]
pub extern "C" fn wasm_alloc(size: usize) -> *mut u8 {
    if size == 0 { return std::ptr::null_mut(); }
    unsafe { alloc(Layout::from_size_align_unchecked(size, 8)) }
}

#[no_mangle]
pub unsafe extern "C" fn wasm_dealloc(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        dealloc(ptr, Layout::from_size_align_unchecked(size, 8));
    }
}

fn cmp_rows(a: (usize, f64, f64), b: (usize, f64, f64)) -> Ordering {
    b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal)
        .then_with(|| b.2.partial_cmp(&a.2).unwrap_or(Ordering::Equal))
        .then_with(|| a.0.cmp(&b.0))
}

/// Input rows: lat, lng, intensity, occurred_at_ms, severity_rank.
/// Writes selected event indices as u32 and returns their count.
#[no_mangle]
pub unsafe extern "C" fn select_regional_events(
    input: *const f64,
    len: usize,
    focus_lat: f64,
    focus_lng: f64,
    altitude: f64,
    output: *mut u32,
    output_cap: usize,
) -> usize {
    let detail = if altitude < 0.62 { 2 } else if altitude < 1.35 { 1 } else { 0 };
    let max_events = if detail == 2 { 430 } else if detail == 1 { 320 } else { 190 }.min(output_cap);
    let radius = if detail == 2 { 30.0 } else { 58.0 };
    let mut rows = Vec::with_capacity(len.min(4096));
    for index in 0..len {
        let base = input.add(index * 5);
        let lat = *base;
        let lng = *base.add(1);
        let intensity = *base.add(2);
        let occurred = *base.add(3);
        if detail > 0 {
            let mean_lat = ((lat + focus_lat) * 0.5).to_radians();
            let d_lat = lat - focus_lat;
            let d_lng = (lng - focus_lng) * mean_lat.cos();
            if (d_lat * d_lat + d_lng * d_lng).sqrt() > radius { continue; }
        }
        rows.push((index, intensity, occurred));
    }
    rows.sort_by(|a, b| cmp_rows(*a, *b));
    let count = rows.len().min(max_events);
    for (out_index, row) in rows.iter().take(count).enumerate() {
        *output.add(out_index) = row.0 as u32;
    }
    count
}

/// Input rows: lat, lng, track_degrees, speed_knots.
/// Output stride 25: source index followed by eight lat/lng/altitude samples.
#[no_mangle]
pub unsafe extern "C" fn aircraft_tracks(input: *const f64, len: usize, output: *mut f64) -> usize {
    let mut written = 0usize;
    for index in 0..len.min(240) {
        let base = input.add(index * 4);
        let lat = *base;
        let lng = *base.add(1);
        let track = *base.add(2);
        let speed = *base.add(3);
        if !(speed > 70.0 && track.is_finite()) { continue; }
        let distance_nm = (speed * 0.28).min(260.0);
        let angular_distance = distance_nm / 3440.065;
        let bearing = track.to_radians();
        let lat1 = lat.to_radians();
        let lng1 = lng.to_radians();
        let lat2 = (lat1.sin() * angular_distance.cos()
            + lat1.cos() * angular_distance.sin() * bearing.cos()).asin();
        let lng2 = lng1 + (bearing.sin() * angular_distance.sin() * lat1.cos()).atan2(
            angular_distance.cos() - lat1.sin() * lat2.sin()
        );
        let end_lat = lat2.to_degrees();
        let mut end_lng = (lng2.to_degrees() + 540.0) % 360.0 - 180.0;
        if (end_lng - lng).abs() > 180.0 { end_lng = lng; }
        let out = output.add(written * 25);
        *out = index as f64;
        for step in 0..8usize {
            let t = step as f64 / 7.0;
            *out.add(1 + step * 3) = lat + (end_lat - lat) * t;
            *out.add(2 + step * 3) = lng + (end_lng - lng) * t;
            *out.add(3 + step * 3) = 0.018 + t * 0.004;
        }
        written += 1;
    }
    written
}
