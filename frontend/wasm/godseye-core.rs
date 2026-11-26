use std::alloc::{alloc, dealloc, Layout};
use std::cmp::Ordering;
use std::f64::consts::{FRAC_PI_2, PI};
use std::mem::size_of;

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
///
/// This legacy export is retained for compatibility with the original core. New incident
/// viewport work uses the resident `IncidentStore` API below, which avoids repacking rows
/// on every camera update.
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

// -------------------------------------------------------------------------------------------------
// Resident incident spatial index
// -------------------------------------------------------------------------------------------------
//
// The host packs one f64 input row per incident:
//   0 lat_degrees
//   1 lng_degrees
//   2 intensity
//   3 occurred_at_epoch_ms
//   4 category_group_bitmask (as an integral f64)
//   5 category_code (as an integral f64)
//   6 severity_rank (as an integral f64)
//   7 priority_rank (a unique integral f64 in 0..len)
//
// The store copies those fields into columnar Vecs once. Those Vecs, the KD-tree nodes, the
// priority permutation, scratch marks, and the fixed output arena all live in WASM linear memory
// for the lifetime of the store. Camera queries then write only a compact u32 header plus
// source-row indices into that reusable arena.
const INCIDENT_INPUT_STRIDE: usize = 8;
const MAX_INCIDENTS: usize = 1_000_000;
// [definite_spatial, uncertain_spatial, definite_filtered, written, len, abi_version]
const OUTPUT_HEADER_U32S: usize = 6;
const OUTPUT_ABI_VERSION: u32 = 2;
const OUTPUT_BOUNDARY_FLAG: u32 = 0x8000_0000;
const OUTPUT_FILTER_PASS_FLAG: u32 = 0x4000_0000;
// Rust and JavaScript cosine can differ by one ulp. One nano-degree is orders of magnitude
// above that numerical noise yet only about a metre at cartographic scale; rows inside the
// uncertainty band are flagged and adjudicated by the host's canonical JavaScript distance.
const BOUNDARY_TOLERANCE_DEGREES: f64 = 1e-8;

#[derive(Clone, Copy)]
struct KdNode {
    row_index: u32,
    left: i32,
    right: i32,
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
}

pub struct IncidentStore {
    len: usize,
    // Columnar incident fields. intensity/category/time are resident even though the current
    // adaptive viewport query primarily uses coordinates and priority; category-mask and
    // time-window query parameters below exercise the packed columns without row serialization.
    lat: Vec<f64>,
    lng: Vec<f64>,
    normalized_lng: Vec<f64>,
    intensity: Vec<f64>,
    occurred_at: Vec<f64>,
    category_mask: Vec<u32>,
    category_code: Vec<u32>,
    severity_rank: Vec<u32>,
    priority_rank: Vec<u32>,
    priority_order: Vec<u32>,
    kd_nodes: Vec<KdNode>,
    kd_root: i32,
    overflow_rows: Vec<u32>,
    scratch_rows: Vec<u32>,
    kd_stack: Vec<u32>,
    candidate_marks: Vec<u32>,
    mark_generation: u32,
    output: Vec<u32>,
    memory_bytes: usize,
}

fn vec_memory_bytes<T>(values: &Vec<T>) -> usize {
    values.capacity().saturating_mul(size_of::<T>())
}

fn incident_vec_memory_bytes(store: &IncidentStore) -> usize {
    size_of::<IncidentStore>()
        .saturating_add(vec_memory_bytes(&store.lat))
        .saturating_add(vec_memory_bytes(&store.lng))
        .saturating_add(vec_memory_bytes(&store.normalized_lng))
        .saturating_add(vec_memory_bytes(&store.intensity))
        .saturating_add(vec_memory_bytes(&store.occurred_at))
        .saturating_add(vec_memory_bytes(&store.category_mask))
        .saturating_add(vec_memory_bytes(&store.category_code))
        .saturating_add(vec_memory_bytes(&store.severity_rank))
        .saturating_add(vec_memory_bytes(&store.priority_rank))
        .saturating_add(vec_memory_bytes(&store.priority_order))
        .saturating_add(vec_memory_bytes(&store.kd_nodes))
        .saturating_add(vec_memory_bytes(&store.overflow_rows))
        .saturating_add(vec_memory_bytes(&store.scratch_rows))
        .saturating_add(vec_memory_bytes(&store.kd_stack))
        .saturating_add(vec_memory_bytes(&store.candidate_marks))
        .saturating_add(vec_memory_bytes(&store.output))
}

fn normalized_lng(lng: f64) -> f64 {
    // Normalize exactly onto [-180, 180). Both -180 and +180 map to -180, matching the
    // periodicity of the viewport distance formula.
    let mut shifted = (lng + 180.0) % 360.0;
    if shifted < 0.0 { shifted += 360.0; }
    shifted - 180.0
}

fn indexable_coordinate(lat: f64, lng: f64) -> bool {
    lat.is_finite()
        && lng.is_finite()
        && lat >= -90.0
        && lat <= 90.0
        && lng >= -180.0
        && lng <= 180.0
}

fn integral_u32(value: f64) -> Option<u32> {
    if !value.is_finite() || value < 0.0 || value > u32::MAX as f64 || value.fract() != 0.0 {
        return None;
    }
    Some(value as u32)
}

fn axis_value(lat: &[f64], normalized_lng: &[f64], row_index: u32, axis: usize) -> f64 {
    if axis == 0 { lat[row_index as usize] } else { normalized_lng[row_index as usize] }
}

fn compare_kd_rows(
    lat: &[f64],
    normalized_lng: &[f64],
    a: u32,
    b: u32,
    axis: usize,
) -> Ordering {
    let av = axis_value(lat, normalized_lng, a, axis);
    let bv = axis_value(lat, normalized_lng, b, axis);
    av.partial_cmp(&bv).unwrap_or(Ordering::Equal)
        .then_with(|| {
            let other_axis = axis ^ 1;
            let ao = axis_value(lat, normalized_lng, a, other_axis);
            let bo = axis_value(lat, normalized_lng, b, other_axis);
            ao.partial_cmp(&bo).unwrap_or(Ordering::Equal)
        })
        .then_with(|| a.cmp(&b))
}

fn point_node(lat: &[f64], normalized_lng: &[f64], row_index: u32) -> KdNode {
    let lat_value = lat[row_index as usize];
    let lng_value = normalized_lng[row_index as usize];
    KdNode {
        row_index,
        left: -1,
        right: -1,
        min_lat: lat_value,
        max_lat: lat_value,
        min_lng: lng_value,
        max_lng: lng_value,
    }
}

fn expand_node_bounds(nodes: &mut [KdNode], node_id: usize, child_id: i32) {
    if child_id < 0 { return; }
    let child = nodes[child_id as usize];
    let node = &mut nodes[node_id];
    node.min_lat = node.min_lat.min(child.min_lat);
    node.max_lat = node.max_lat.max(child.max_lat);
    node.min_lng = node.min_lng.min(child.min_lng);
    node.max_lng = node.max_lng.max(child.max_lng);
}

fn build_kd_node(
    rows: &mut [u32],
    depth: usize,
    lat: &[f64],
    normalized_lng: &[f64],
    nodes: &mut Vec<KdNode>,
) -> i32 {
    if rows.is_empty() { return -1; }
    let axis = depth & 1;
    let median = rows.len() / 2;
    rows.select_nth_unstable_by(median, |a, b| compare_kd_rows(lat, normalized_lng, *a, *b, axis));
    let row_index = rows[median];
    let node_id = nodes.len();
    nodes.push(point_node(lat, normalized_lng, row_index));

    // Split around the median after nth-element selection. Rows are not sorted inside either
    // partition, but the median of each deterministic total ordering is independent of that
    // initial permutation, so the resulting balanced tree shape is deterministic.
    let (left_rows, right_rows) = rows.split_at_mut(median);
    let right_rows = &mut right_rows[1..];
    let left = build_kd_node(left_rows, depth + 1, lat, normalized_lng, nodes);
    let right = build_kd_node(right_rows, depth + 1, lat, normalized_lng, nodes);
    nodes[node_id].left = left;
    nodes[node_id].right = right;
    expand_node_bounds(nodes, node_id, left);
    expand_node_bounds(nodes, node_id, right);
    node_id as i32
}

/// The exact historical equirectangular viewport metric, including its longitude wrap.
/// Arithmetic is deliberately written in the same left-to-right shape as the JavaScript
/// implementation rather than using `to_radians`, whose multiply-by-precomputed-constant can
/// differ by one ulp near query boundaries.
fn viewport_distance_degrees(a_lat: f64, a_lng: f64, b_lat: f64, b_lng: f64) -> f64 {
    let mean_lat = ((a_lat + b_lat) / 2.0) * PI / 180.0;
    let d_lat = a_lat - b_lat;
    let wrapped_lng_diff = ((a_lng - b_lng + 540.0) % 360.0) - 180.0;
    let d_lng = wrapped_lng_diff * mean_lat.cos();
    (d_lat * d_lat + d_lng * d_lng).sqrt()
}

fn wrap_lng_difference(diff: f64) -> f64 {
    ((diff + 540.0) % 360.0) - 180.0
}

fn min_latitude_difference(focus_lat: f64, min_lat: f64, max_lat: f64) -> f64 {
    if focus_lat < min_lat { min_lat - focus_lat }
    else if focus_lat > max_lat { focus_lat - max_lat }
    else { 0.0 }
}

fn min_wrapped_lng_difference(focus_lng: f64, min_lng: f64, max_lng: f64) -> f64 {
    if max_lng - min_lng >= 360.0 { return 0.0; }
    if focus_lng >= min_lng && focus_lng <= max_lng { return 0.0; }
    let to_min = wrap_lng_difference(focus_lng - min_lng).abs();
    let to_max = wrap_lng_difference(focus_lng - max_lng).abs();
    to_min.min(to_max)
}

/// Conservative lower-scaling factor for longitude over a node latitude interval. If the mean
/// latitude interval reaches a pole-crossing cosine zero, no longitude pruning is possible;
/// otherwise the minimum endpoint magnitude is deflated slightly so floating-point/libm rounding
/// can only make pruning more conservative, never falsely exclusive.
fn min_abs_cos_mean_latitude(min_lat: f64, max_lat: f64, focus_lat: f64) -> f64 {
    let mut start = ((min_lat + focus_lat) / 2.0) * PI / 180.0;
    let mut end = ((max_lat + focus_lat) / 2.0) * PI / 180.0;
    if start > end { std::mem::swap(&mut start, &mut end); }

    // Expand the interval by a tiny angle before looking for zeros. This padding is intentionally
    // much larger than a ulp at cartographic angles but far below the 1e-9-degree slack used in
    // the pruning comparison.
    start -= 1e-11;
    end += 1e-11;
    if end - start >= PI { return 0.0; }
    let first_zero = FRAC_PI_2 + ((start - FRAC_PI_2) / PI).ceil() * PI;
    if first_zero <= end { return 0.0; }
    let endpoint_min = start.cos().abs().min(end.cos().abs());
    (endpoint_min * (1.0 - 1e-12) - 1e-15).max(0.0)
}

fn node_definitely_outside(node: &KdNode, focus_lat: f64, focus_lng: f64, radius: f64) -> bool {
    let lat_diff = min_latitude_difference(focus_lat, node.min_lat, node.max_lat);
    let lng_diff = min_wrapped_lng_difference(focus_lng, node.min_lng, node.max_lng);
    let cos_scale = min_abs_cos_mean_latitude(node.min_lat, node.max_lat, focus_lat);
    let scaled_lng = lng_diff * cos_scale;
    let lower_squared = lat_diff * lat_diff + scaled_lng * scaled_lng;
    let radius_squared = radius * radius;
    // Deflate pruning confidence near exact boundaries. Boundary rows are collected and resolved
    // by the exact row test instead of trusting a possibly one-ulp-different bounding calculation.
    let slack = radius_squared * 1e-12 + 1e-12;
    lower_squared > radius_squared + slack
}

fn collect_kd_candidates(
    nodes: &[KdNode],
    root: i32,
    focus_lat: f64,
    focus_lng: f64,
    radius: f64,
    scratch_rows: &mut Vec<u32>,
    kd_stack: &mut Vec<u32>,
) {
    if root < 0 { return; }
    kd_stack.clear();
    kd_stack.push(root as u32);
    while let Some(node_id) = kd_stack.pop() {
        let node = nodes[node_id as usize];
        if node_definitely_outside(&node, focus_lat, focus_lng, radius) { continue; }
        scratch_rows.push(node.row_index);
        if node.left >= 0 { kd_stack.push(node.left as u32); }
        if node.right >= 0 { kd_stack.push(node.right as u32); }
    }
}

fn category_time_passes(
    occurred_at: f64,
    row_category_mask: u32,
    query_category_mask: u32,
    time_start: f64,
    time_end_exclusive: f64,
) -> bool {
    if query_category_mask != 0 && (row_category_mask & query_category_mask) == 0 { return false; }
    if !time_start.is_nan() && !(occurred_at >= time_start) { return false; }
    if !time_end_exclusive.is_nan() && !(occurred_at < time_end_exclusive) { return false; }
    true
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SpatialClass {
    Outside,
    Boundary,
    Inside,
}

/// Classify a normal in-range row against the Rust approximation. Only rows at least
/// BOUNDARY_TOLERANCE_DEGREES away from the decision surface are trusted as definite; everything
/// near the surface is emitted as an uncertainty marker for exact host-side adjudication.
fn classify_indexed_row_spatial(
    lat: f64,
    lng: f64,
    focus_lat: f64,
    focus_lng: f64,
    radius: f64,
) -> SpatialClass {
    if !lat.is_finite() || !lng.is_finite() {
        // Any NaN/infinite coordinate makes the JavaScript distance NaN (or infinite), so the
        // `<= radius` comparison is definitely false. This is independent of libm precision.
        return SpatialClass::Outside;
    }
    if !indexable_coordinate(lat, lng) {
        // Finite but far-out-of-range coordinates can require large-angle argument reduction.
        // They are rare/adversarial; treating them as uncertain preserves exactness without
        // weakening the normal indexed path.
        return SpatialClass::Boundary;
    }
    let distance = viewport_distance_degrees(lat, lng, focus_lat, focus_lng);
    if distance <= radius - BOUNDARY_TOLERANCE_DEGREES { return SpatialClass::Inside; }
    if distance <= radius + BOUNDARY_TOLERANCE_DEGREES { return SpatialClass::Boundary; }
    SpatialClass::Outside
}

/// Conservative classification for hostile focus/radius combinations where argument reduction or
/// infinities make cross-runtime numerical assumptions inappropriate. Finite rows become boundary
/// rows and are resolved exactly by JavaScript; nonfinite rows remain definite exclusions.
fn classify_conservative_row_spatial(lat: f64, lng: f64) -> SpatialClass {
    if !lat.is_finite() || !lng.is_finite() { SpatialClass::Outside } else { SpatialClass::Boundary }
}

fn encode_output_row(row_index: u32, class: SpatialClass, filter_passes: bool) -> u32 {
    let mut encoded = row_index;
    if class == SpatialClass::Boundary { encoded |= OUTPUT_BOUNDARY_FLAG; }
    // Definite rows are emitted only after passing the filter, so they remain raw zero-copy
    // source indices. The filter bit is needed only on always-emitted boundary rows.
    if class == SpatialClass::Boundary && filter_passes { encoded |= OUTPUT_FILTER_PASS_FLAG; }
    encoded
}

fn usable_kd_query(focus_lat: f64, focus_lng: f64, radius: f64) -> bool {
    radius.is_finite()
        && radius >= 0.0
        && focus_lat.is_finite()
        && focus_lng.is_finite()
        && focus_lat >= -90.0
        && focus_lat <= 90.0
        && focus_lng >= -180.0
        && focus_lng <= 180.0
}

fn bounded_query_definitely_empty(focus_lat: f64, focus_lng: f64, radius: f64) -> bool {
    // NaN focus coordinates poison every distance computation, and a negative finite radius cannot
    // contain a nonnegative distance. In both cases the JavaScript comparison is exactly false for
    // every row, including invalid rows. Positive infinity is not in this fast path because NaN
    // distances still fail while finite distances pass.
    (radius.is_finite() && radius < 0.0) || focus_lat.is_nan() || focus_lng.is_nan()
}

#[allow(clippy::too_many_arguments)]
fn process_incident_row(
    store: &mut IncidentStore,
    row_index: u32,
    class: SpatialClass,
    query_category_mask: u32,
    time_start: f64,
    time_end_exclusive: f64,
    cap: usize,
    definite_spatial: &mut usize,
    uncertain_spatial: &mut usize,
    definite_filtered: &mut usize,
    definite_written: &mut usize,
    written: &mut usize,
) {
    if class == SpatialClass::Outside { return; }
    if class == SpatialClass::Boundary { *uncertain_spatial += 1; } else { *definite_spatial += 1; }

    let index = row_index as usize;
    let filter_passes = category_time_passes(
        store.occurred_at[index],
        store.category_mask[index],
        query_category_mask,
        time_start,
        time_end_exclusive,
    );

    if class == SpatialClass::Inside {
        if filter_passes {
            *definite_filtered += 1;
            if *definite_written < cap {
                store.output[OUTPUT_HEADER_U32S + *written] = encode_output_row(row_index, class, true);
                *written += 1;
                *definite_written += 1;
            }
        }
    } else {
        // Every uncertain spatial row is emitted regardless of category/time status. The host needs
        // the complete uncertainty set to convert conservative spatial counters into exact fallback
        // counters; filter-pass flags prevent rows from being serialized as structured objects.
        store.output[OUTPUT_HEADER_U32S + *written] = encode_output_row(row_index, class, filter_passes);
        *written += 1;
    }
}

fn query_incident_store(
    store: &mut IncidentStore,
    focus_lat: f64,
    focus_lng: f64,
    radius_degrees: f64,
    cap: usize,
    query_category_mask: u32,
    time_start: f64,
    time_end_exclusive: f64,
) -> usize {
    let len = store.len;
    let cap = cap.min(len);
    let unbounded = radius_degrees.is_nan();
    for word in store.output.iter_mut().take(OUTPUT_HEADER_U32S) { *word = 0; }

    let mut definite_spatial = 0usize;
    let mut uncertain_spatial = 0usize;
    let mut definite_filtered = 0usize;
    let mut definite_written = 0usize;
    let mut written = 0usize;

    if !unbounded && bounded_query_definitely_empty(focus_lat, focus_lng, radius_degrees) {
        store.output[4] = len as u32;
        store.output[5] = OUTPUT_ABI_VERSION;
        return 0;
    }

    if unbounded {
        // A null viewport in the JavaScript contract includes every row, even rows with invalid
        // coordinates. There is therefore no numerical uncertainty boundary at all.
        for position in 0..len {
            let row_index = store.priority_order[position];
            process_incident_row(
                store,
                row_index,
                SpatialClass::Inside,
                query_category_mask,
                time_start,
                time_end_exclusive,
                cap,
                &mut definite_spatial,
                &mut uncertain_spatial,
                &mut definite_filtered,
                &mut definite_written,
                &mut written,
            );
        }
    } else if usable_kd_query(focus_lat, focus_lng, radius_degrees) {
        let normalized_focus_lng = normalized_lng(focus_lng);
        store.scratch_rows.clear();
        // Inflate only the index broad-phase. Rows in the tolerance skin are still emitted as
        // uncertainty markers rather than being trusted as exact inclusions or exclusions.
        collect_kd_candidates(
            &store.kd_nodes,
            store.kd_root,
            focus_lat,
            normalized_focus_lng,
            radius_degrees + BOUNDARY_TOLERANCE_DEGREES,
            &mut store.scratch_rows,
            &mut store.kd_stack,
        );
        store.scratch_rows.extend(store.overflow_rows.iter().copied());

        // Small candidate pages are cheapest when sorted directly by priority rank. Dense or
        // adversarial clustered pages instead mark candidates and scan the resident priority
        // permutation, avoiding an O(candidates log candidates) worst-case sort while still
        // never testing coordinates for rows outside the KD candidate set.
        let priority_scan_threshold = cap.saturating_mul(4).saturating_add(32);
        let use_priority_scan = store.scratch_rows.len() > priority_scan_threshold;
        if use_priority_scan {
            store.mark_generation = store.mark_generation.wrapping_add(1);
            if store.mark_generation == 0 {
                store.candidate_marks.fill(0);
                store.mark_generation = 1;
            }
            let generation = store.mark_generation;
            for offset in 0..store.scratch_rows.len() {
                let row_index = store.scratch_rows[offset] as usize;
                store.candidate_marks[row_index] = generation;
            }
            for position in 0..len {
                let row_index = store.priority_order[position];
                if store.candidate_marks[row_index as usize] != generation { continue; }
                let index = row_index as usize;
                let class = classify_indexed_row_spatial(
                    store.lat[index],
                    store.lng[index],
                    focus_lat,
                    focus_lng,
                    radius_degrees,
                );
                process_incident_row(
                    store,
                    row_index,
                    class,
                    query_category_mask,
                    time_start,
                    time_end_exclusive,
                    cap,
                    &mut definite_spatial,
                    &mut uncertain_spatial,
                    &mut definite_filtered,
                    &mut definite_written,
                    &mut written,
                );
            }
        } else {
            let ranks = &store.priority_rank;
            store.scratch_rows.sort_unstable_by(|a, b| {
                ranks[*a as usize].cmp(&ranks[*b as usize]).then_with(|| a.cmp(b))
            });
            for position in 0..store.scratch_rows.len() {
                let row_index = store.scratch_rows[position];
                let index = row_index as usize;
                let class = classify_indexed_row_spatial(
                    store.lat[index],
                    store.lng[index],
                    focus_lat,
                    focus_lng,
                    radius_degrees,
                );
                process_incident_row(
                    store,
                    row_index,
                    class,
                    query_category_mask,
                    time_start,
                    time_end_exclusive,
                    cap,
                    &mut definite_spatial,
                    &mut uncertain_spatial,
                    &mut definite_filtered,
                    &mut definite_written,
                    &mut written,
                );
            }
        }
    } else {
        // Non-finite/out-of-range focus or radius values are hostile/adversarial inputs, not a
        // normal camera path. Emit the finite rows as uncertainty markers in canonical priority
        // order so the host can apply the exact JavaScript metric without any index assumptions.
        for position in 0..len {
            let row_index = store.priority_order[position];
            let index = row_index as usize;
            let class = classify_conservative_row_spatial(store.lat[index], store.lng[index]);
            process_incident_row(
                store,
                row_index,
                class,
                query_category_mask,
                time_start,
                time_end_exclusive,
                cap,
                &mut definite_spatial,
                &mut uncertain_spatial,
                &mut definite_filtered,
                &mut definite_written,
                &mut written,
            );
        }
    }

    store.output[0] = definite_spatial as u32;
    store.output[1] = uncertain_spatial as u32;
    store.output[2] = definite_filtered as u32;
    store.output[3] = written as u32;
    store.output[4] = len as u32;
    store.output[5] = OUTPUT_ABI_VERSION;
    written
}

/// Creates a resident incident store. Returns null for invalid dimensions or a priority
/// permutation that is not a permutation; callers then use the canonical JavaScript fallback.
#[no_mangle]
pub unsafe extern "C" fn incident_store_create(input: *const f64, len: usize) -> *mut IncidentStore {
    if len > MAX_INCIDENTS || len > u32::MAX as usize { return std::ptr::null_mut(); }
    if len > 0 && input.is_null() { return std::ptr::null_mut(); }

    let mut lat = Vec::with_capacity(len);
    let mut lng = Vec::with_capacity(len);
    let mut normalized_lng_values = Vec::with_capacity(len);
    let mut intensity = Vec::with_capacity(len);
    let mut occurred_at = Vec::with_capacity(len);
    let mut category_mask = Vec::with_capacity(len);
    let mut category_code = Vec::with_capacity(len);
    let mut severity_rank = Vec::with_capacity(len);
    let mut priority_rank = vec![0u32; len];
    let mut priority_order = vec![0u32; len];
    let mut seen_priority = vec![0u8; len];
    let mut indexable_rows = Vec::with_capacity(len);
    let mut overflow_rows = Vec::with_capacity(len);

    for index in 0..len {
        let base = input.add(index * INCIDENT_INPUT_STRIDE);
        let row_lat = *base;
        let row_lng = *base.add(1);
        let row_intensity = *base.add(2);
        let row_occurred = *base.add(3);
        let row_category_mask = integral_u32(*base.add(4)).unwrap_or(0);
        let row_category_code = integral_u32(*base.add(5)).unwrap_or(0);
        let row_severity = integral_u32(*base.add(6)).unwrap_or(0);
        let Some(row_priority) = integral_u32(*base.add(7)) else { return std::ptr::null_mut(); };
        if row_priority as usize >= len || seen_priority[row_priority as usize] != 0 { return std::ptr::null_mut(); }
        seen_priority[row_priority as usize] = 1;
        priority_rank[index] = row_priority;
        priority_order[row_priority as usize] = index as u32;

        lat.push(row_lat);
        lng.push(row_lng);
        normalized_lng_values.push(if indexable_coordinate(row_lat, row_lng) { normalized_lng(row_lng) } else { f64::NAN });
        intensity.push(row_intensity);
        occurred_at.push(row_occurred);
        category_mask.push(row_category_mask);
        category_code.push(row_category_code);
        severity_rank.push(row_severity);
        if indexable_coordinate(row_lat, row_lng) {
            indexable_rows.push(index as u32);
        } else {
            overflow_rows.push(index as u32);
        }
    }

    let mut kd_nodes = Vec::with_capacity(indexable_rows.len());
    let kd_root = build_kd_node(
        &mut indexable_rows,
        0,
        &lat,
        &normalized_lng_values,
        &mut kd_nodes,
    );
    let kd_stack_capacity = kd_nodes.len();
    let mut output = Vec::with_capacity(len.saturating_add(OUTPUT_HEADER_U32S));
    output.resize(len.saturating_add(OUTPUT_HEADER_U32S), 0);

    let mut store = IncidentStore {
        len,
        lat,
        lng,
        normalized_lng: normalized_lng_values,
        intensity,
        occurred_at,
        category_mask,
        category_code,
        severity_rank,
        priority_rank,
        priority_order,
        kd_nodes,
        kd_root,
        overflow_rows,
        scratch_rows: Vec::with_capacity(len),
        kd_stack: Vec::with_capacity(kd_stack_capacity),
        candidate_marks: vec![0u32; len],
        mark_generation: 0,
        output,
        memory_bytes: 0,
    };
    store.memory_bytes = incident_vec_memory_bytes(&store);
    Box::into_raw(Box::new(store))
}

#[no_mangle]
pub unsafe extern "C" fn incident_store_destroy(store: *mut IncidentStore) {
    if !store.is_null() {
        drop(Box::from_raw(store));
    }
}

/// Runs a viewport/radius/priority query. `radius_degrees=NaN` is the explicit unbounded
/// viewport sentinel (the JavaScript `null` radius). Optional category masks use intersection
/// semantics; NaN time bounds disable the corresponding temporal comparison. The returned count
/// is the number of encoded u32 entries after the six-word output header.
#[no_mangle]
pub unsafe extern "C" fn incident_store_query_viewport(
    store: *mut IncidentStore,
    focus_lat: f64,
    focus_lng: f64,
    radius_degrees: f64,
    cap: usize,
    query_category_mask: u32,
    time_start: f64,
    time_end_exclusive: f64,
) -> usize {
    if store.is_null() { return 0; }
    query_incident_store(
        &mut *store,
        focus_lat,
        focus_lng,
        radius_degrees,
        cap,
        query_category_mask,
        time_start,
        time_end_exclusive,
    )
}

/// Output layout: [definite_spatial, uncertain_spatial, definite_filtered, written, len, abi,
/// ...encoded_indices]. Boundary entries carry high-bit flags consumed by the host exactness
/// shim; definite entries are raw source indices. The arena is fixed at store construction time
/// and reused by every query rather than reserializing incident rows.
#[no_mangle]
pub unsafe extern "C" fn incident_store_output_ptr(store: *mut IncidentStore) -> *const u32 {
    if store.is_null() { return std::ptr::null(); }
    (*store).output.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn incident_store_len(store: *mut IncidentStore) -> usize {
    if store.is_null() { 0 } else { (*store).len }
}

#[no_mangle]
pub unsafe extern "C" fn incident_store_memory_bytes(store: *mut IncidentStore) -> usize {
    if store.is_null() { 0 } else { (*store).memory_bytes }
}
