use crate::data::{
    resolve_incident_occurrence_window, Incident, IncidentCorrelationConfidence,
    IncidentOccurrenceWindow, IncidentTemporalPrecision,
};
use chrono::{Datelike, TimeZone, Timelike, Utc};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

#[allow(dead_code)]
pub const SECOND_SECONDS: f64 = 1.0;
pub const HOUR_SECONDS: f64 = 60.0 * 60.0;
pub const DAY_SECONDS: f64 = 24.0 * HOUR_SECONDS;
pub const WEEK_SECONDS: f64 = 7.0 * DAY_SECONDS;
const INCLUSIVE_WINDOW_EPSILON_SECONDS: f64 = 0.001;
const DEFAULT_TARGET_FRAMES: usize = 96;
const DEFAULT_MAX_MANUAL_FRAMES: usize = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TemporalResolutionKey {
    Hour,
    SixHour,
    Day,
    Week,
}

impl TemporalResolutionKey {
    pub const ALL: [Self; 4] = [Self::Hour, Self::SixHour, Self::Day, Self::Week];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hour => "hour",
            Self::SixHour => "sixHour",
            Self::Day => "day",
            Self::Week => "week",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Hour => "Hour",
            Self::SixHour => "Six hour",
            Self::Day => "Day",
            Self::Week => "Week",
        }
    }

    pub fn short_label(self) -> &'static str {
        match self {
            Self::Hour => "1h",
            Self::SixHour => "6h",
            Self::Day => "1d",
            Self::Week => "1w",
        }
    }

    pub fn step_seconds(self) -> f64 {
        match self {
            Self::Hour => HOUR_SECONDS,
            Self::SixHour => 6.0 * HOUR_SECONDS,
            Self::Day => DAY_SECONDS,
            Self::Week => WEEK_SECONDS,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TemporalResolutionPreference {
    Auto,
    Hour,
    SixHour,
    Day,
    Week,
}

impl TemporalResolutionPreference {
    pub const ALL: [Self; 5] = [Self::Auto, Self::Hour, Self::SixHour, Self::Day, Self::Week];

    pub fn fixed_key(self) -> Option<TemporalResolutionKey> {
        match self {
            Self::Auto => None,
            Self::Hour => Some(TemporalResolutionKey::Hour),
            Self::SixHour => Some(TemporalResolutionKey::SixHour),
            Self::Day => Some(TemporalResolutionKey::Day),
            Self::Week => Some(TemporalResolutionKey::Week),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Hour => "hour",
            Self::SixHour => "sixHour",
            Self::Day => "day",
            Self::Week => "week",
        }
    }

    pub fn next(self) -> Self {
        match self {
            Self::Auto => Self::Hour,
            Self::Hour => Self::SixHour,
            Self::SixHour => Self::Day,
            Self::Day => Self::Week,
            Self::Week => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PlaybackMode {
    Step,
    Trailing,
    Cumulative,
}

#[allow(dead_code)]
impl PlaybackMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Step => "step",
            Self::Trailing => "trailing",
            Self::Cumulative => "cumulative",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Step => "Frame",
            Self::Trailing => "Trailing",
            Self::Cumulative => "Cumulative",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Step => "only uncertainty windows intersecting the current frame",
            Self::Trailing => "sliding trailing window, quantized to visible frames",
            Self::Cumulative => {
                "all windows whose start has been reached through the current frame"
            }
        }
    }

    pub fn next(self) -> Self {
        match self {
            Self::Step => Self::Trailing,
            Self::Trailing => Self::Cumulative,
            Self::Cumulative => Self::Step,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
#[allow(dead_code)]
pub struct IncidentTemporalCoverage {
    pub input_event_count: usize,
    pub valid_event_count: usize,
    pub invalid_time_count: usize,
    pub precise_count: usize,
    pub day_count: usize,
    pub range_count: usize,
    pub imprecise_count: usize,
    pub retained_report_count: usize,
    pub start: f64,
    pub end_exclusive: f64,
    pub longest_uncertainty_seconds: f64,
}

fn empty_coverage(input_event_count: usize) -> IncidentTemporalCoverage {
    IncidentTemporalCoverage {
        input_event_count,
        valid_event_count: 0,
        invalid_time_count: input_event_count,
        precise_count: 0,
        day_count: 0,
        range_count: 0,
        imprecise_count: 0,
        retained_report_count: 0,
        start: 0.0,
        end_exclusive: 0.0,
        longest_uncertainty_seconds: 0.0,
    }
}

struct TemporalRecord {
    event_index: usize,
    window: IncidentOccurrenceWindow,
    first_frame: usize,
    last_frame: usize,
}

fn collect_temporal_records(
    events: &[Incident],
) -> (Vec<TemporalRecord>, IncidentTemporalCoverage) {
    let mut records = Vec::new();
    let mut precise_count = 0usize;
    let mut day_count = 0usize;
    let mut range_count = 0usize;
    let mut retained_report_count = 0usize;
    let mut start = f64::INFINITY;
    let mut end_exclusive = 0.0f64;
    let mut longest_uncertainty_seconds = 0.0f64;

    for (event_index, event) in events.iter().enumerate() {
        let window = resolve_incident_occurrence_window(event);
        retained_report_count += event
            .incident
            .as_ref()
            .map(|incident| incident.member_count.max(1))
            .unwrap_or(1);
        let Some(window) = window else {
            continue;
        };
        match window.precision {
            IncidentTemporalPrecision::Second => precise_count += 1,
            IncidentTemporalPrecision::Day => day_count += 1,
            IncidentTemporalPrecision::Range => range_count += 1,
        }
        start = start.min(window.start);
        end_exclusive = end_exclusive.max(window.end_exclusive);
        longest_uncertainty_seconds =
            longest_uncertainty_seconds.max(window.end_exclusive - window.start);
        records.push(TemporalRecord {
            event_index,
            window,
            first_frame: 0,
            last_frame: 0,
        });
    }

    if records.is_empty() {
        return (records, empty_coverage(events.len()));
    }

    let valid_event_count = records.len();
    (
        records,
        IncidentTemporalCoverage {
            input_event_count: events.len(),
            valid_event_count,
            invalid_time_count: events.len() - valid_event_count,
            precise_count,
            day_count,
            range_count,
            imprecise_count: day_count + range_count,
            retained_report_count,
            start,
            end_exclusive,
            longest_uncertainty_seconds,
        },
    )
}

pub fn measure_incident_temporal_coverage(events: &[Incident]) -> IncidentTemporalCoverage {
    collect_temporal_records(events).1
}

fn utc_datetime(timestamp: f64) -> Option<chrono::DateTime<Utc>> {
    if !timestamp.is_finite() {
        return None;
    }
    let milliseconds = (timestamp * 1000.0).round();
    if milliseconds < i64::MIN as f64 || milliseconds > i64::MAX as f64 {
        return None;
    }
    Utc.timestamp_millis_opt(milliseconds as i64).single()
}

fn floor_to_resolution(timestamp: f64, resolution: TemporalResolutionKey) -> f64 {
    let Some(datetime) = utc_datetime(timestamp) else {
        return timestamp.floor();
    };
    let date = datetime.date_naive();
    let Some(midnight) = date.and_hms_opt(0, 0, 0) else {
        return timestamp.floor();
    };
    let day_start = midnight.and_utc().timestamp() as f64;
    match resolution {
        TemporalResolutionKey::Week => {
            day_start - date.weekday().num_days_from_monday() as f64 * DAY_SECONDS
        }
        TemporalResolutionKey::Day => day_start,
        TemporalResolutionKey::SixHour => {
            day_start + (datetime.hour() / 6 * 6) as f64 * HOUR_SECONDS
        }
        TemporalResolutionKey::Hour => day_start + datetime.hour() as f64 * HOUR_SECONDS,
    }
}

fn ceil_to_resolution(timestamp: f64, resolution: TemporalResolutionKey) -> f64 {
    let floor = floor_to_resolution(timestamp, resolution);
    if floor == timestamp {
        return timestamp;
    }
    floor + resolution.step_seconds()
}

fn count_aligned_frames(
    domain_start: f64,
    domain_end_exclusive: f64,
    resolution: TemporalResolutionKey,
) -> usize {
    (((domain_end_exclusive - domain_start) / resolution.step_seconds()).ceil() as usize).max(1)
}

pub fn choose_automatic_resolution(
    span_seconds: f64,
    target_frames: usize,
) -> TemporalResolutionKey {
    for key in TemporalResolutionKey::ALL {
        if (span_seconds / key.step_seconds()).ceil() as usize <= target_frames {
            return key;
        }
    }
    TemporalResolutionKey::Week
}

#[derive(Debug, Clone, Copy)]
pub struct BuildTemporalAnalysisOptions {
    pub resolution: TemporalResolutionPreference,
    pub target_frames: usize,
    /// Manual resolutions that would produce more frames than this are coerced back to auto so
    /// the histogram remains legible, matching the web playback contract.
    pub max_manual_frames: usize,
}

impl Default for BuildTemporalAnalysisOptions {
    fn default() -> Self {
        Self {
            resolution: TemporalResolutionPreference::Auto,
            target_frames: DEFAULT_TARGET_FRAMES,
            max_manual_frames: DEFAULT_MAX_MANUAL_FRAMES,
        }
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct TemporalFrameAggregate {
    pub index: usize,
    pub key: String,
    pub label: String,
    pub start: f64,
    pub end_exclusive: f64,
    /// Unique incidents whose uncertainty window starts in this frame. Every valid incident is
    /// counted exactly once across the histogram.
    pub start_count: usize,
    pub start_imprecise_count: usize,
    pub start_critical_count: usize,
    /// Interval memberships intersecting this frame. Imprecise windows can contribute to multiple
    /// frames; this is exposure, not a unique-incident total.
    pub active_count: usize,
    pub active_imprecise_count: usize,
    pub active_critical_count: usize,
    pub active_corroborated_count: usize,
    pub active_contested_count: usize,
    pub active_evidence_report_count: usize,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct IncidentTemporalAnalysis {
    pub coverage: IncidentTemporalCoverage,
    pub requested_resolution: TemporalResolutionPreference,
    pub resolution: TemporalResolutionKey,
    pub resolution_coerced: bool,
    pub resolution_notice: Option<String>,
    pub step_seconds: f64,
    pub domain_start: f64,
    pub domain_end_exclusive: f64,
    pub frame_count: usize,
    pub frames: Vec<TemporalFrameAggregate>,
    /// Compressed sparse row membership matrix: row offsets per frame, event indices per
    /// intersecting uncertainty window.
    pub membership_offsets: Vec<u32>,
    pub membership_indices: Vec<u32>,
    pub by_start_indices: Vec<u32>,
    pub sorted_starts: Vec<f64>,
    pub start_rank_by_event_index: Vec<u32>,
    pub max_start_count: usize,
    pub total_membership_count: usize,
}

fn empty_analysis(
    input_event_count: usize,
    requested_resolution: TemporalResolutionPreference,
) -> IncidentTemporalAnalysis {
    IncidentTemporalAnalysis {
        coverage: empty_coverage(input_event_count),
        requested_resolution,
        resolution: TemporalResolutionKey::Day,
        resolution_coerced: false,
        resolution_notice: None,
        step_seconds: DAY_SECONDS,
        domain_start: 0.0,
        domain_end_exclusive: 0.0,
        frame_count: 0,
        frames: Vec::new(),
        membership_offsets: Vec::new(),
        membership_indices: Vec::new(),
        by_start_indices: Vec::new(),
        sorted_starts: Vec::new(),
        start_rank_by_event_index: Vec::new(),
        max_start_count: 0,
        total_membership_count: 0,
    }
}

fn frame_label(start: f64, resolution: TemporalResolutionKey) -> String {
    let Some(date) = utc_datetime(start) else {
        return "invalid UTC frame".to_string();
    };
    let month = date.month();
    let day = date.day();
    let hour = format!("{:02}", date.hour());
    match resolution {
        TemporalResolutionKey::Hour | TemporalResolutionKey::SixHour => {
            format!("{month}/{day} {hour}:00")
        }
        TemporalResolutionKey::Week => format!("week of {month}/{day}"),
        TemporalResolutionKey::Day => format!("{month}/{day}"),
    }
}

fn comma_number(value: usize) -> String {
    let digits = value.to_string();
    let mut output = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, character) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            output.push(',');
        }
        output.push(character);
    }
    output
}

/// Build the deterministic temporal index using the same truthful occurrence-window semantics as
/// `frontend/src/lib/incidentTime.ts`, scaled from web milliseconds to native Unix seconds.
///
/// Invalid and missing times are omitted. Exact-second windows are one-second intervals; date-only
/// and publisher ranges remain uncertainty intervals. No position or timestamp is interpolated.
pub fn build_incident_temporal_analysis(
    events: &[Incident],
    options: BuildTemporalAnalysisOptions,
) -> IncidentTemporalAnalysis {
    let requested_resolution = options.resolution;
    let (mut records, coverage) = collect_temporal_records(events);
    if records.is_empty() {
        return empty_analysis(events.len(), requested_resolution);
    }

    let target_frames = options.target_frames.max(16);
    let max_manual_frames = options.max_manual_frames.max(target_frames);
    let raw_span_seconds = (coverage.end_exclusive - coverage.start).max(1.0);
    let mut resolution = requested_resolution.fixed_key().map_or_else(
        || choose_automatic_resolution(raw_span_seconds, target_frames),
        |key| key,
    );
    let mut resolution_coerced = false;
    let mut resolution_notice = None;

    if let Some(requested_key) = requested_resolution.fixed_key() {
        let requested_frame_count =
            (raw_span_seconds / requested_key.step_seconds()).ceil() as usize;
        if requested_frame_count > max_manual_frames {
            resolution = choose_automatic_resolution(raw_span_seconds, target_frames);
            resolution_coerced = resolution != requested_key;
            resolution_notice = Some(format!(
                "{} resolution would create {} frames; using {} resolution so dense coverage remains legible",
                requested_key.label(),
                comma_number(requested_frame_count),
                resolution.label().to_lowercase()
            ));
        }
    }

    let step_seconds = resolution.step_seconds();
    let domain_start = floor_to_resolution(coverage.start, resolution);
    let mut domain_end_exclusive = ceil_to_resolution(coverage.end_exclusive, resolution);
    if domain_end_exclusive <= domain_start {
        domain_end_exclusive = domain_start + step_seconds;
    }
    let frame_count = count_aligned_frames(domain_start, domain_end_exclusive, resolution);

    records.sort_by(|a, b| {
        a.window
            .start
            .total_cmp(&b.window.start)
            .then_with(|| a.window.end_exclusive.total_cmp(&b.window.end_exclusive))
            .then_with(|| events[a.event_index].id.cmp(&events[b.event_index].id))
            .then_with(|| a.event_index.cmp(&b.event_index))
    });

    let mut membership_counts = vec![0usize; frame_count];
    let mut start_counts = vec![0usize; frame_count];
    let mut start_imprecise_counts = vec![0usize; frame_count];
    let mut start_critical_counts = vec![0usize; frame_count];
    let mut active_imprecise_counts = vec![0usize; frame_count];
    let mut active_critical_counts = vec![0usize; frame_count];
    let mut active_corroborated_counts = vec![0usize; frame_count];
    let mut active_contested_counts = vec![0usize; frame_count];
    let mut active_evidence_report_counts = vec![0usize; frame_count];
    let mut total_membership_count = 0usize;

    for record in &mut records {
        let first_frame = (((record.window.start - domain_start) / step_seconds).floor() as isize)
            .clamp(0, frame_count.saturating_sub(1) as isize) as usize;
        let last_frame =
            (((record.window.end_exclusive - INCLUSIVE_WINDOW_EPSILON_SECONDS - domain_start)
                / step_seconds)
                .floor() as isize)
                .clamp(0, frame_count.saturating_sub(1) as isize) as usize;
        record.first_frame = first_frame;
        record.last_frame = last_frame.max(first_frame);
        let frame_span = record.last_frame - first_frame + 1;
        total_membership_count += frame_span;

        let imprecise = usize::from(record.window.precision != IncidentTemporalPrecision::Second);
        let event = &events[record.event_index];
        let critical = usize::from(event.severity == "critical");
        let corroborated = usize::from(
            event.incident.as_ref().map(|incident| incident.confidence)
                == Some(IncidentCorrelationConfidence::Corroborated),
        );
        let contested = usize::from(
            event.incident.as_ref().map(|incident| incident.confidence)
                == Some(IncidentCorrelationConfidence::Contested),
        );
        let evidence_reports = event
            .incident
            .as_ref()
            .map(|incident| incident.member_count.max(1))
            .unwrap_or(1);

        start_counts[first_frame] += 1;
        start_imprecise_counts[first_frame] += imprecise;
        start_critical_counts[first_frame] += critical;

        for frame in first_frame..=record.last_frame {
            membership_counts[frame] += 1;
            active_imprecise_counts[frame] += imprecise;
            active_critical_counts[frame] += critical;
            active_corroborated_counts[frame] += corroborated;
            active_contested_counts[frame] += contested;
            active_evidence_report_counts[frame] += evidence_reports;
        }
    }

    let mut membership_offsets = vec![0u32; frame_count + 1];
    for frame in 0..frame_count {
        membership_offsets[frame + 1] = membership_offsets[frame]
            + u32::try_from(membership_counts[frame]).expect("frame membership exceeds u32 index");
    }
    assert!(
        u32::try_from(total_membership_count).is_ok(),
        "temporal membership matrix exceeds u32 index range"
    );
    let mut membership_indices = vec![0u32; total_membership_count];
    let mut fill_cursor = vec![0u32; frame_count];
    for record in &records {
        for frame in record.first_frame..=record.last_frame {
            let destination = membership_offsets[frame] + fill_cursor[frame];
            membership_indices[destination as usize] = record.event_index as u32;
            fill_cursor[frame] += 1;
        }
    }

    let mut by_start_indices = Vec::with_capacity(records.len());
    let mut sorted_starts = Vec::with_capacity(records.len());
    let mut start_rank_by_event_index = vec![0u32; events.len()];
    for (rank, record) in records.iter().enumerate() {
        by_start_indices.push(record.event_index as u32);
        sorted_starts.push(record.window.start);
        start_rank_by_event_index[record.event_index] = rank as u32;
    }

    let mut frames = Vec::with_capacity(frame_count);
    let mut max_start_count = 0usize;
    for frame in 0..frame_count {
        let start = domain_start + frame as f64 * step_seconds;
        max_start_count = max_start_count.max(start_counts[frame]);
        frames.push(TemporalFrameAggregate {
            index: frame,
            key: format!("{}-{start:.0}", resolution.as_str()),
            label: frame_label(start, resolution),
            start,
            end_exclusive: start + step_seconds,
            start_count: start_counts[frame],
            start_imprecise_count: start_imprecise_counts[frame],
            start_critical_count: start_critical_counts[frame],
            active_count: membership_counts[frame],
            active_imprecise_count: active_imprecise_counts[frame],
            active_critical_count: active_critical_counts[frame],
            active_corroborated_count: active_corroborated_counts[frame],
            active_contested_count: active_contested_counts[frame],
            active_evidence_report_count: active_evidence_report_counts[frame],
        });
    }

    IncidentTemporalAnalysis {
        coverage,
        requested_resolution,
        resolution,
        resolution_coerced,
        resolution_notice,
        step_seconds,
        domain_start,
        domain_end_exclusive,
        frame_count,
        frames,
        membership_offsets,
        membership_indices,
        by_start_indices,
        sorted_starts,
        start_rank_by_event_index,
        max_start_count,
        total_membership_count,
    }
}

fn lower_bound(sorted: &[f64], value: f64) -> usize {
    let mut low = 0usize;
    let mut high = sorted.len();
    while low < high {
        let middle = (low + high) / 2;
        if sorted[middle] < value {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct PlaybackExtraction {
    pub mode: PlaybackMode,
    pub frame_index: usize,
    pub frame: TemporalFrameAggregate,
    pub effective_start: f64,
    pub effective_end_exclusive: f64,
    pub frame_quantized: bool,
    /// Indices refer to the canonical incident slice from which the analysis was built. The order
    /// is deterministic and is part of the playback contract.
    pub event_indices: Vec<usize>,
}

pub fn collect_playback_events(
    analysis: &IncidentTemporalAnalysis,
    requested_frame_index: isize,
    mode: PlaybackMode,
    trailing_frames: usize,
) -> Option<PlaybackExtraction> {
    if analysis.frame_count == 0 {
        return None;
    }
    let frame_index = requested_frame_index.clamp(0, analysis.frame_count as isize - 1) as usize;
    let frame = analysis.frames.get(frame_index)?.clone();
    let mut first_frame = frame_index;
    let event_indices: Vec<usize>;

    match mode {
        PlaybackMode::Cumulative => {
            let started_count = lower_bound(&analysis.sorted_starts, frame.end_exclusive);
            event_indices = analysis.by_start_indices[..started_count]
                .iter()
                .map(|index| *index as usize)
                .collect();
        }
        PlaybackMode::Step => {
            let offset = analysis.membership_offsets[frame_index] as usize;
            let end = analysis.membership_offsets[frame_index + 1] as usize;
            event_indices = analysis.membership_indices[offset..end]
                .iter()
                .map(|index| *index as usize)
                .collect();
        }
        PlaybackMode::Trailing => {
            first_frame = frame_index.saturating_sub(trailing_frames.max(1) - 1);
            let mut seen = vec![0u8; analysis.coverage.input_event_count];
            let mut collected = Vec::new();
            for index in first_frame..=frame_index {
                let offset = analysis.membership_offsets[index] as usize;
                let end = analysis.membership_offsets[index + 1] as usize;
                for cursor in offset..end {
                    let event_index = analysis.membership_indices[cursor] as usize;
                    if seen[event_index] != 0 {
                        continue;
                    }
                    seen[event_index] = 1;
                    collected.push(event_index);
                }
            }
            collected.sort_by_key(|event_index| {
                analysis.start_rank_by_event_index[*event_index] as usize
            });
            event_indices = collected;
        }
    }

    Some(PlaybackExtraction {
        mode,
        frame_index,
        frame: frame.clone(),
        effective_start: if mode == PlaybackMode::Cumulative {
            analysis.coverage.start
        } else {
            analysis.frames[first_frame].start
        },
        effective_end_exclusive: frame.end_exclusive,
        frame_quantized: mode == PlaybackMode::Trailing,
        event_indices,
    })
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PlaybackEventSummary {
    pub count: usize,
    pub critical_count: usize,
    pub high_count: usize,
    pub uncertain_time_count: usize,
    pub corroborated_count: usize,
    pub contested_count: usize,
    pub inferred_count: usize,
    pub single_source_count: usize,
    pub retained_report_count: usize,
}

pub fn summarize_playback_events<'a>(
    events: impl IntoIterator<Item = &'a Incident>,
) -> PlaybackEventSummary {
    let mut summary = PlaybackEventSummary::default();
    for event in events {
        summary.count += 1;
        if event.severity == "critical" {
            summary.critical_count += 1;
        }
        if event.severity == "high" {
            summary.high_count += 1;
        }
        if resolve_incident_occurrence_window(event)
            .as_ref()
            .is_some_and(|occurrence| occurrence.precision != IncidentTemporalPrecision::Second)
        {
            summary.uncertain_time_count += 1;
        }
        match event.incident.as_ref().map(|incident| incident.confidence) {
            Some(IncidentCorrelationConfidence::Corroborated) => summary.corroborated_count += 1,
            Some(IncidentCorrelationConfidence::Contested) => summary.contested_count += 1,
            Some(IncidentCorrelationConfidence::Inferred) => summary.inferred_count += 1,
            Some(IncidentCorrelationConfidence::SingleSource) => summary.single_source_count += 1,
            None => {}
        }
        summary.retained_report_count += event
            .incident
            .as_ref()
            .map(|incident| incident.member_count.max(1))
            .unwrap_or(1);
    }
    summary
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ResolutionChoice {
    pub requested: TemporalResolutionPreference,
    pub resolution: TemporalResolutionKey,
    pub coerced: bool,
    pub notice: Option<String>,
}

/// Precomputed temporal grids for every operator-selectable resolution. The grids are built where
/// a snapshot is loaded/correlated (the refresh path does this in its worker), so changing playback
/// resolution in the render loop never rebuilds the sparse membership matrix.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct IncidentPlaybackAnalyses {
    pub coverage: IncidentTemporalCoverage,
    pub auto_resolution: TemporalResolutionKey,
    choices: BTreeMap<TemporalResolutionPreference, ResolutionChoice>,
    analyses: BTreeMap<TemporalResolutionKey, Arc<IncidentTemporalAnalysis>>,
    pub build_elapsed_ms: f64,
}

impl Default for IncidentPlaybackAnalyses {
    fn default() -> Self {
        let empty: Vec<Incident> = Vec::new();
        Self::build(&empty)
    }
}

impl IncidentPlaybackAnalyses {
    pub fn build(events: &[Incident]) -> Self {
        let started = Instant::now();
        let coverage = measure_incident_temporal_coverage(events);
        let mut analyses = BTreeMap::new();
        let mut choices = BTreeMap::new();

        if coverage.valid_event_count == 0 {
            let base = Arc::new(build_incident_temporal_analysis(
                events,
                BuildTemporalAnalysisOptions {
                    resolution: TemporalResolutionPreference::Day,
                    ..Default::default()
                },
            ));
            analyses.insert(TemporalResolutionKey::Day, base);
            for requested in TemporalResolutionPreference::ALL {
                choices.insert(
                    requested,
                    ResolutionChoice {
                        requested,
                        resolution: TemporalResolutionKey::Day,
                        coerced: false,
                        notice: None,
                    },
                );
            }
            return Self {
                coverage,
                auto_resolution: TemporalResolutionKey::Day,
                choices,
                analyses,
                build_elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
            };
        }

        let raw_span_seconds = (coverage.end_exclusive - coverage.start).max(1.0);
        let auto_resolution = choose_automatic_resolution(raw_span_seconds, DEFAULT_TARGET_FRAMES);
        let mut needed = vec![auto_resolution];
        let mut manual_decisions = Vec::new();
        for key in TemporalResolutionKey::ALL {
            let requested_frame_count = (raw_span_seconds / key.step_seconds()).ceil() as usize;
            let (actual, notice) = if requested_frame_count > DEFAULT_MAX_MANUAL_FRAMES {
                (
                    auto_resolution,
                    Some(format!(
                        "{} resolution would create {} frames; using {} resolution so dense coverage remains legible",
                        key.label(),
                        comma_number(requested_frame_count),
                        auto_resolution.label().to_lowercase()
                    )),
                )
            } else {
                (key, None)
            };
            manual_decisions.push((key, actual, notice));
            if !needed.contains(&actual) {
                needed.push(actual);
            }
        }

        for resolution in needed {
            let analysis = build_incident_temporal_analysis(
                events,
                BuildTemporalAnalysisOptions {
                    resolution: match resolution {
                        TemporalResolutionKey::Hour => TemporalResolutionPreference::Hour,
                        TemporalResolutionKey::SixHour => TemporalResolutionPreference::SixHour,
                        TemporalResolutionKey::Day => TemporalResolutionPreference::Day,
                        TemporalResolutionKey::Week => TemporalResolutionPreference::Week,
                    },
                    ..Default::default()
                },
            );
            analyses.insert(resolution, Arc::new(analysis));
        }

        choices.insert(
            TemporalResolutionPreference::Auto,
            ResolutionChoice {
                requested: TemporalResolutionPreference::Auto,
                resolution: auto_resolution,
                coerced: false,
                notice: None,
            },
        );
        for (key, actual, notice) in manual_decisions {
            let requested = match key {
                TemporalResolutionKey::Hour => TemporalResolutionPreference::Hour,
                TemporalResolutionKey::SixHour => TemporalResolutionPreference::SixHour,
                TemporalResolutionKey::Day => TemporalResolutionPreference::Day,
                TemporalResolutionKey::Week => TemporalResolutionPreference::Week,
            };
            choices.insert(
                requested,
                ResolutionChoice {
                    requested,
                    resolution: actual,
                    coerced: actual != key,
                    notice,
                },
            );
        }

        Self {
            coverage,
            auto_resolution,
            choices,
            analyses,
            build_elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        }
    }

    pub fn resolution_choice(&self, requested: TemporalResolutionPreference) -> ResolutionChoice {
        self.choices
            .get(&requested)
            .cloned()
            .unwrap_or(ResolutionChoice {
                requested,
                resolution: TemporalResolutionKey::Day,
                coerced: false,
                notice: None,
            })
    }

    pub fn analysis_for(
        &self,
        requested: TemporalResolutionPreference,
    ) -> &IncidentTemporalAnalysis {
        let choice = self.resolution_choice(requested);
        self.analyses
            .get(&choice.resolution)
            .map(Arc::as_ref)
            .or_else(|| self.analyses.values().next().map(Arc::as_ref))
            .expect("playback analysis set always contains at least one grid")
    }
}

pub const PLAYBACK_SPEED_OPTIONS: [f64; 8] = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0];
pub const PLAYBACK_TRAIL_OPTIONS_HOURS: [f64; 4] = [24.0, 72.0, 24.0 * 7.0, 24.0 * 30.0];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ExtractionKey {
    generation: u64,
    frame_index: usize,
    mode: PlaybackMode,
    trailing_frames: usize,
    resolution: TemporalResolutionPreference,
}

/// Deterministic incident playback transport. Wall-clock time only decides when quantized frame
/// steps are committed. Emitted positions always lie on the precomputed UTC frame grid; there is
/// no interpolation of incident positions or source times.
pub struct IncidentPlaybackController {
    analyses: IncidentPlaybackAnalyses,
    generation: u64,
    active: bool,
    playing: bool,
    mode: PlaybackMode,
    speed_multiplier: f64,
    resolution_preference: TemporalResolutionPreference,
    trail_hours: f64,
    cursor_seconds: Option<f64>,
    step_carry: f64,
    commit_elapsed_seconds: f64,
    extraction_cache: Option<PlaybackExtraction>,
    extraction_key: Option<ExtractionKey>,
    extraction_version: u64,
    reduced_motion: bool,
}

#[allow(dead_code)]
impl IncidentPlaybackController {
    pub fn new(analyses: IncidentPlaybackAnalyses, reduced_motion: bool) -> Self {
        Self {
            analyses,
            generation: 0,
            active: false,
            playing: false,
            mode: PlaybackMode::Trailing,
            speed_multiplier: 1.0,
            resolution_preference: TemporalResolutionPreference::Auto,
            trail_hours: 24.0 * 7.0,
            cursor_seconds: None,
            step_carry: 0.0,
            commit_elapsed_seconds: 0.0,
            extraction_cache: None,
            extraction_key: None,
            extraction_version: 0,
            reduced_motion,
        }
    }

    pub fn replace_analyses(&mut self, analyses: IncidentPlaybackAnalyses) {
        self.analyses = analyses;
        self.generation = self.generation.wrapping_add(1);
        self.extraction_cache = None;
        self.extraction_key = None;
        self.extraction_version = self.extraction_version.wrapping_add(1);
        // A corpus/grid replacement restarts the transport cadence just as the web effect is
        // restarted when its memoized analysis object changes. The absolute cursor is preserved;
        // if it falls outside the replacement grid it is clamped deterministically.
        self.step_carry = 0.0;
        self.commit_elapsed_seconds = 0.0;
    }

    pub fn analyses(&self) -> &IncidentPlaybackAnalyses {
        &self.analyses
    }

    pub fn analysis(&self) -> &IncidentTemporalAnalysis {
        self.analyses.analysis_for(self.resolution_preference)
    }

    pub fn resolution_choice(&self) -> ResolutionChoice {
        self.analyses.resolution_choice(self.resolution_preference)
    }

    pub fn active(&self) -> bool {
        self.active
    }

    pub fn playing(&self) -> bool {
        self.playing
    }

    pub fn mode(&self) -> PlaybackMode {
        self.mode
    }

    pub fn speed_multiplier(&self) -> f64 {
        self.speed_multiplier
    }

    pub fn resolution_preference(&self) -> TemporalResolutionPreference {
        self.resolution_preference
    }

    pub fn trail_hours(&self) -> f64 {
        self.trail_hours
    }

    pub fn reduced_motion(&self) -> bool {
        self.reduced_motion
    }

    pub fn frame_index(&self) -> usize {
        let analysis = self.analysis();
        if analysis.frame_count == 0 {
            return 0;
        }
        let time = self.cursor_seconds.unwrap_or(analysis.domain_start);
        (((time - analysis.domain_start) / analysis.step_seconds).floor() as isize)
            .clamp(0, analysis.frame_count as isize - 1) as usize
    }

    pub fn frame(&self) -> Option<&TemporalFrameAggregate> {
        self.analysis().frames.get(self.frame_index())
    }

    pub fn trailing_frames(&self) -> usize {
        ((self.trail_hours * HOUR_SECONDS) / self.analysis().step_seconds.max(1.0))
            .ceil()
            .max(1.0) as usize
    }

    pub fn data_time_per_wall_second_seconds(&self) -> f64 {
        self.analysis().step_seconds * self.speed_multiplier
    }

    pub fn extraction_version(&self) -> u64 {
        self.extraction_version
    }

    pub fn extraction(&self) -> Option<&PlaybackExtraction> {
        self.extraction_cache.as_ref()
    }

    pub fn seek_frame(&mut self, requested_frame: isize) {
        let analysis = self.analysis();
        if analysis.frame_count == 0 {
            return;
        }
        let next_frame = requested_frame.clamp(0, analysis.frame_count as isize - 1) as usize;
        self.cursor_seconds =
            Some(analysis.domain_start + next_frame as f64 * analysis.step_seconds);
    }

    pub fn seek_fraction(&mut self, fraction: f64) {
        let frame_count = self.analysis().frame_count;
        if frame_count == 0 || !fraction.is_finite() {
            return;
        }
        let frame = (fraction.clamp(0.0, 1.0) * frame_count as f64).floor() as isize;
        self.seek_frame(frame.clamp(0, frame_count as isize - 1));
    }

    pub fn step_frames(&mut self, delta: isize) {
        if self.analysis().frame_count == 0 {
            return;
        }
        let next_frame = (self.frame_index() as isize + delta)
            .clamp(0, self.analysis().frame_count as isize - 1);
        self.seek_frame(next_frame);
    }

    pub fn jump_to_start(&mut self) {
        self.seek_frame(0);
    }

    pub fn jump_to_end(&mut self) {
        if self.analysis().frame_count == 0 {
            return;
        }
        self.seek_frame(self.analysis().frame_count as isize - 1);
    }

    pub fn pause(&mut self) {
        if self.playing {
            self.step_carry = 0.0;
            self.commit_elapsed_seconds = 0.0;
        }
        self.playing = false;
    }

    pub fn toggle_playing(&mut self) {
        if self.analysis().frame_count == 0 {
            return;
        }
        if !self.playing && self.frame_index() >= self.analysis().frame_count - 1 {
            self.cursor_seconds = Some(self.analysis().domain_start);
        }
        self.playing = !self.playing;
        self.step_carry = 0.0;
        self.commit_elapsed_seconds = 0.0;
    }

    pub fn toggle_active(&mut self) {
        if self.active {
            self.pause();
            self.active = false;
            return;
        }
        if self.cursor_seconds.is_none() {
            self.cursor_seconds = Some(self.analysis().domain_start);
        }
        self.active = true;
    }

    pub fn reset(&mut self) {
        self.pause();
        if self.analysis().frame_count > 0 {
            self.cursor_seconds = Some(self.analysis().domain_start);
        }
    }

    pub fn set_mode(&mut self, mode: PlaybackMode) {
        self.mode = mode;
    }

    pub fn cycle_mode(&mut self) {
        self.mode = self.mode.next();
    }

    pub fn set_speed_multiplier(&mut self, speed: f64) {
        if PLAYBACK_SPEED_OPTIONS.contains(&speed) {
            self.speed_multiplier = speed;
        }
    }

    pub fn cycle_speed(&mut self, direction: isize) {
        let index = PLAYBACK_SPEED_OPTIONS
            .iter()
            .position(|option| *option == self.speed_multiplier)
            .unwrap_or(2) as isize;
        let next_index = (index + direction).clamp(0, PLAYBACK_SPEED_OPTIONS.len() as isize - 1);
        self.speed_multiplier = PLAYBACK_SPEED_OPTIONS[next_index as usize];
    }

    pub fn set_resolution_preference(&mut self, resolution: TemporalResolutionPreference) {
        self.resolution_preference = resolution;
    }

    pub fn cycle_resolution(&mut self) {
        self.resolution_preference = self.resolution_preference.next();
    }

    pub fn set_trail_hours(&mut self, hours: f64) {
        if PLAYBACK_TRAIL_OPTIONS_HOURS.contains(&hours) {
            self.trail_hours = hours;
        }
    }

    pub fn cycle_trail(&mut self) {
        let index = PLAYBACK_TRAIL_OPTIONS_HOURS
            .iter()
            .position(|option| *option == self.trail_hours)
            .unwrap_or(2);
        self.trail_hours =
            PLAYBACK_TRAIL_OPTIONS_HOURS[(index + 1) % PLAYBACK_TRAIL_OPTIONS_HOURS.len()];
    }

    fn minimum_commit_seconds(&self) -> f64 {
        if self.reduced_motion {
            0.240
        } else if self.speed_multiplier >= 8.0 {
            0.120
        } else if self.speed_multiplier >= 2.0 {
            0.080
        } else {
            0.040
        }
    }

    /// Advance the transport by a render delta. The elapsed input is capped exactly like the web
    /// controller so a throttled/backgrounded frame causes one bounded, reviewable jump rather
    /// than an opaque leap across the corpus.
    pub fn advance(&mut self, dt_seconds: f64) -> bool {
        if !self.active || !self.playing || self.analysis().frame_count == 0 {
            return false;
        }
        let elapsed_seconds = dt_seconds.clamp(0.0, 0.5);
        self.step_carry += elapsed_seconds * self.speed_multiplier;
        self.commit_elapsed_seconds += dt_seconds.max(0.0);
        if self.commit_elapsed_seconds < self.minimum_commit_seconds() {
            return false;
        }
        let steps = self.step_carry.floor() as isize;
        if steps <= 0 {
            return false;
        }
        self.step_carry -= steps as f64;
        self.commit_elapsed_seconds = 0.0;
        let max_frame = self.analysis().frame_count - 1;
        let current_frame = self.frame_index();
        let next_frame = (current_frame as isize + steps).min(max_frame as isize) as usize;
        let changed = next_frame != current_frame;
        if changed {
            self.cursor_seconds = Some(
                self.analysis().domain_start + next_frame as f64 * self.analysis().step_seconds,
            );
        }
        if next_frame >= max_frame {
            self.playing = false;
            self.step_carry = 0.0;
            self.commit_elapsed_seconds = 0.0;
        }
        changed
    }

    /// Recompute the sparse extraction only when one of its deterministic inputs changes. Render
    /// code can therefore inspect the extraction every frame without repeating trailing-window
    /// deduplication or cumulative prefix copying.
    pub fn refresh_extraction(&mut self) -> bool {
        if !self.active || self.analysis().frame_count == 0 {
            let had_cache = self.extraction_cache.take().is_some();
            self.extraction_key = None;
            if had_cache {
                self.extraction_version = self.extraction_version.wrapping_add(1);
            }
            return had_cache;
        }
        let key = ExtractionKey {
            generation: self.generation,
            frame_index: self.frame_index(),
            mode: self.mode,
            trailing_frames: self.trailing_frames(),
            resolution: self.resolution_preference,
        };
        if self.extraction_key == Some(key) && self.extraction_cache.is_some() {
            return false;
        }
        self.extraction_cache = collect_playback_events(
            self.analysis(),
            key.frame_index as isize,
            key.mode,
            key.trailing_frames,
        );
        self.extraction_key = Some(key);
        self.extraction_version = self.extraction_version.wrapping_add(1);
        true
    }
}

pub fn unresolved_window_intersects_playback_frame(
    event: &Incident,
    frame: Option<&TemporalFrameAggregate>,
) -> bool {
    let Some(frame) = frame else {
        return false;
    };
    resolve_incident_occurrence_window(event).is_some_and(|occurrence| {
        occurrence.precision != IncidentTemporalPrecision::Second
            && occurrence.start < frame.end_exclusive
            && occurrence.end_exclusive > frame.start
    })
}

pub fn format_utc_exact(timestamp: f64) -> String {
    let Some(datetime) = utc_datetime(timestamp) else {
        return "unknown".to_string();
    };
    if timestamp <= 0.0 {
        return "unknown".to_string();
    }
    format!("{} UTC", datetime.format("%Y-%m-%d %H:%M:%S"))
}

pub fn format_duration_seconds(duration_seconds: f64) -> String {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return "0s".to_string();
    }
    if duration_seconds % WEEK_SECONDS == 0.0 {
        return format!("{}w", duration_seconds / WEEK_SECONDS);
    }
    if duration_seconds % DAY_SECONDS == 0.0 {
        return format!("{}d", duration_seconds / DAY_SECONDS);
    }
    if duration_seconds % HOUR_SECONDS == 0.0 {
        return format!("{}h", duration_seconds / HOUR_SECONDS);
    }
    if duration_seconds % 60.0 == 0.0 {
        return format!("{}m", duration_seconds / 60.0);
    }
    if duration_seconds >= DAY_SECONDS {
        return format!("{:.1}d", duration_seconds / DAY_SECONDS);
    }
    if duration_seconds >= HOUR_SECONDS {
        return format!("{:.1}h", duration_seconds / HOUR_SECONDS);
    }
    format!("{:.0}s", duration_seconds.round())
}

fn truthy_env(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[cfg(target_os = "windows")]
fn windows_animation_effects_disabled() -> bool {
    // Windows exposes the closest system-level animation preference through
    // SPI_GETCLIENTAREAANIMATION. This is intentionally queried once at startup rather than
    // polling a platform API every frame.
    type WinBool = i32;
    unsafe extern "system" {
        fn SystemParametersInfoW(
            action: u32,
            param: u32,
            value: *mut WinBool,
            win_ini: u32,
        ) -> WinBool;
    }
    const SPI_GETCLIENTAREAANIMATION: u32 = 0x1042;
    let mut enabled: WinBool = 1;
    let result = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            &mut enabled as *mut WinBool,
            0,
        )
    };
    result != 0 && enabled == 0
}

#[cfg(not(target_os = "windows"))]
fn windows_animation_effects_disabled() -> bool {
    false
}

/// Conservative reduced-motion detection for the native shell. Playback never autoplays merely
/// because playback is enabled; when this returns true, continuous commits are additionally
/// slowed. Operators can force the behavior with GODSEYE_REDUCED_MOTION=1 (or the broader
/// GODSEYE_REDUCED_EFFECTS=1), which is also the portable override on non-Windows platforms.
pub fn detect_reduced_motion() -> bool {
    std::env::var("GODSEYE_REDUCED_MOTION")
        .map(|value| truthy_env(&value))
        .unwrap_or(false)
        || std::env::var("GODSEYE_REDUCED_EFFECTS")
            .map(|value| truthy_env(&value))
            .unwrap_or(false)
        || windows_animation_effects_disabled()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlation::correlate_incidents;
    use crate::data::{
        create_day_occurrence_window, create_second_occurrence_window,
        create_ucdp_occurrence_window, load_embedded, IncidentMembership, IncidentOccurrenceBasis,
    };

    const DAY0: f64 = 1_795_046_400.0; // 2026-11-19T00:00:00Z
    const NOW: f64 = 1_795_176_000.0; // fixed correlation horizon for deterministic tests

    fn make_event(id: &str) -> Incident {
        Incident {
            id: id.to_string(),
            lat: 0.0,
            lng: 0.0,
            severity: "high".to_string(),
            category: "airstrike".to_string(),
            title: "Untitled incident".to_string(),
            detail: None,
            country: "Ukraine".to_string(),
            conflict: "Russia-Ukraine War".to_string(),
            theater: "russia-ukraine-war".to_string(),
            region: Some("Europe".to_string()),
            precision: None,
            casualties: Some(0.0),
            killed: Some(0.0),
            displaced: Some(0.0),
            occurred_at: Some(DAY0 + 13.5 * HOUR_SECONDS),
            updated_at: Some(DAY0 + 13.5 * HOUR_SECONDS),
            verified: false,
            source_name: None,
            source_url: None,
            sources: Vec::new(),
            source_family: "warheatmap".to_string(),
            intensity: 0.5,
            occurrence: None,
            ucdp: None,
            incident: None,
            evidence: None,
        }
    }

    fn set_exact(event: &mut Incident, timestamp: f64) {
        event.occurred_at = Some(timestamp);
        event.updated_at = Some(timestamp);
        event.occurrence = create_second_occurrence_window(timestamp);
    }

    fn extraction_ids(analysis: &IncidentTemporalAnalysis, frame: isize) -> String {
        collect_playback_events(analysis, frame, PlaybackMode::Step, 1)
            .map(|extraction| {
                extraction
                    .event_indices
                    .iter()
                    .map(|index| index.to_string())
                    .collect::<Vec<_>>()
                    .join("|")
            })
            .unwrap_or_default()
    }

    #[test]
    fn exact_day_and_publisher_range_windows_are_not_interpolated() {
        let mut exact = make_event("exact-second");
        set_exact(&mut exact, DAY0 + 13.5 * HOUR_SECONDS);
        let mut day_only = make_event("legacy-day");
        day_only.occurred_at = Some(DAY0);
        day_only.updated_at = Some(DAY0);
        day_only.occurrence =
            create_day_occurrence_window(DAY0, crate::data::IncidentOccurrenceBasis::InferredDay);
        let mut ucdp_range = make_event("ucdp-range");
        ucdp_range.occurred_at = Some(DAY0 + 2.0 * DAY_SECONDS);
        ucdp_range.occurrence =
            create_ucdp_occurrence_window(Some("2026-11-20"), Some("2026-11-22"), Some(3));

        let analysis = build_incident_temporal_analysis(
            &[exact, day_only.clone(), ucdp_range],
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Hour,
                ..Default::default()
            },
        );
        assert_eq!(analysis.frame_count, 96);

        let events = [make_event("exact-second"), day_only.clone()];
        let _ = events;
        let exact_frame = 13;
        let before = collect_playback_events(&analysis, exact_frame - 1, PlaybackMode::Step, 1)
            .expect("before extraction");
        let containing = collect_playback_events(&analysis, exact_frame, PlaybackMode::Step, 1)
            .expect("containing extraction");
        let after = collect_playback_events(&analysis, exact_frame + 1, PlaybackMode::Step, 1)
            .expect("after extraction");
        // The exact event is input index zero; the day and range are uncertainty intervals and may
        // legitimately coexist in adjacent frames.
        assert!(containing.event_indices.contains(&0));
        assert!(!before.event_indices.contains(&0));
        assert!(!after.event_indices.contains(&0));

        let isolated_day = build_incident_temporal_analysis(
            &[day_only],
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Hour,
                ..Default::default()
            },
        );
        let day_membership_frames: Vec<usize> = isolated_day
            .frames
            .iter()
            .filter(|frame| {
                collect_playback_events(&isolated_day, frame.index as isize, PlaybackMode::Step, 1)
                    .is_some_and(|extraction| extraction.event_indices.contains(&0))
            })
            .map(|frame| frame.index)
            .collect();
        assert_eq!(day_membership_frames.len(), 24);
        let trailing_day = collect_playback_events(&isolated_day, 23, PlaybackMode::Trailing, 24)
            .expect("trailing day extraction");
        assert_eq!(
            trailing_day
                .event_indices
                .iter()
                .filter(|index| **index == 0)
                .count(),
            1,
            "trailing mode deduplicates a multi-frame uncertainty window"
        );
        assert!(day_membership_frames.iter().all(|frame| {
            collect_playback_events(&isolated_day, *frame as isize, PlaybackMode::Step, 1)
                .expect("frame extraction")
                .event_indices
                .iter()
                .filter(|index| **index == 0)
                .count()
                == 1
        }));

        let range_frame_count = analysis
            .frames
            .iter()
            .filter(|frame| {
                collect_playback_events(&analysis, frame.index as isize, PlaybackMode::Step, 1)
                    .is_some_and(|extraction| extraction.event_indices.contains(&2))
            })
            .count();
        assert_eq!(range_frame_count, 72);
        let mut coverage_event = make_event("ucdp-range-coverage");
        coverage_event.occurrence =
            create_ucdp_occurrence_window(Some("2026-11-20"), Some("2026-11-22"), Some(3));
        let coverage = measure_incident_temporal_coverage(&[coverage_event]);
        assert_eq!(coverage.end_exclusive - coverage.start, 3.0 * DAY_SECONDS);
    }

    #[test]
    fn midnight_fallback_is_day_uncertainty_but_explicit_midnight_second_is_exact() {
        let mut legacy_midnight = make_event("legacy-midnight");
        legacy_midnight.occurred_at = Some(DAY0);
        legacy_midnight.updated_at = Some(DAY0);
        legacy_midnight.occurrence = None;
        let mut explicit_midnight = make_event("explicit-midnight-second");
        explicit_midnight.occurred_at = Some(DAY0);
        explicit_midnight.updated_at = Some(DAY0);
        explicit_midnight.occurrence = create_second_occurrence_window(DAY0);
        let incidents = [legacy_midnight, explicit_midnight];
        assert_eq!(
            resolve_incident_occurrence_window(&incidents[0])
                .expect("legacy midnight window")
                .precision,
            IncidentTemporalPrecision::Day
        );
        assert_eq!(
            resolve_incident_occurrence_window(&incidents[1])
                .expect("explicit midnight window")
                .precision,
            IncidentTemporalPrecision::Second
        );
        let analysis = build_incident_temporal_analysis(
            &incidents,
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Hour,
                ..Default::default()
            },
        );
        let first = collect_playback_events(&analysis, 0, PlaybackMode::Step, 1)
            .expect("first midnight frame");
        let second = collect_playback_events(&analysis, 1, PlaybackMode::Step, 1)
            .expect("next hourly frame");
        assert!(first.event_indices.contains(&0));
        assert!(first.event_indices.contains(&1));
        assert!(second.event_indices.contains(&0));
        assert!(
            !second.event_indices.contains(&1),
            "explicit midnight second must not be widened into the day"
        );
    }

    #[test]
    fn deterministic_extraction_and_accumulation_modes_match_frame_grid() {
        let mut exact_a = make_event("exact-a");
        set_exact(&mut exact_a, DAY0 + 13.5 * HOUR_SECONDS);
        let mut exact_b = make_event("exact-b");
        set_exact(&mut exact_b, DAY0 + 15.0 * HOUR_SECONDS);
        let analysis = build_incident_temporal_analysis(
            &[exact_b, exact_a],
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Hour,
                ..Default::default()
            },
        );
        let one =
            collect_playback_events(&analysis, 1, PlaybackMode::Step, 1).expect("first extraction");
        let two = collect_playback_events(&analysis, 1, PlaybackMode::Step, 1)
            .expect("second extraction");
        assert_eq!(one.event_indices, two.event_indices);
        assert_eq!(extraction_ids(&analysis, 1), extraction_ids(&analysis, 1));

        let a_frame =
            ((DAY0 + 13.5 * HOUR_SECONDS - analysis.domain_start) / HOUR_SECONDS).floor() as isize;
        let b_frame =
            ((DAY0 + 15.0 * HOUR_SECONDS - analysis.domain_start) / HOUR_SECONDS).floor() as isize;
        let cumulative_a = collect_playback_events(&analysis, a_frame, PlaybackMode::Cumulative, 1)
            .expect("cumulative a");
        let cumulative_before_b =
            collect_playback_events(&analysis, b_frame - 1, PlaybackMode::Cumulative, 1)
                .expect("cumulative before b");
        let cumulative_b = collect_playback_events(&analysis, b_frame, PlaybackMode::Cumulative, 1)
            .expect("cumulative b");
        // Input order was reversed, but by_start_indices is start-time ordered: exact-a is index 1.
        assert!(cumulative_a.event_indices.contains(&1));
        assert!(cumulative_before_b.event_indices.contains(&1));
        assert!(!cumulative_before_b.event_indices.contains(&0));
        assert_eq!(
            cumulative_b.event_indices,
            vec![1, 0],
            "cumulative output is ordered by occurrence start, not input order"
        );

        let within_trail =
            collect_playback_events(&analysis, a_frame + 1, PlaybackMode::Trailing, 2)
                .expect("within trail");
        let beyond_trail =
            collect_playback_events(&analysis, a_frame + 2, PlaybackMode::Trailing, 2)
                .expect("beyond trail");
        assert!(within_trail.event_indices.contains(&1));
        assert!(!beyond_trail.event_indices.contains(&1));
    }

    #[test]
    fn adaptive_resolution_and_histogram_uniqueness_match_web_rules() {
        assert_eq!(
            choose_automatic_resolution(2.0 * DAY_SECONDS, 96),
            TemporalResolutionKey::Hour
        );
        assert_eq!(
            choose_automatic_resolution(10.0 * DAY_SECONDS, 96),
            TemporalResolutionKey::SixHour
        );
        assert_eq!(
            choose_automatic_resolution(60.0 * DAY_SECONDS, 96),
            TemporalResolutionKey::Day
        );
        assert_eq!(
            choose_automatic_resolution(200.0 * DAY_SECONDS, 96),
            TemporalResolutionKey::Week
        );

        let mut m1 = make_event("m1");
        set_exact(&mut m1, DAY0 + HOUR_SECONDS);
        let mut m2 = make_event("m2");
        set_exact(&mut m2, DAY0 + 2.0 * HOUR_SECONDS);
        let mut m3 = make_event("m3");
        m3.occurred_at = Some(DAY0 + DAY_SECONDS);
        m3.occurrence =
            create_day_occurrence_window(DAY0 + DAY_SECONDS, IncidentOccurrenceBasis::InferredDay);
        let incidents = [m1, m2, m3];
        let analysis = build_incident_temporal_analysis(
            &incidents,
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Hour,
                ..Default::default()
            },
        );
        let start_total: usize = analysis.frames.iter().map(|frame| frame.start_count).sum();
        assert_eq!(start_total, incidents.len());
        let uncertain_starts: usize = analysis
            .frames
            .iter()
            .map(|frame| frame.start_imprecise_count)
            .sum();
        assert_eq!(uncertain_starts, 1);

        let mut long_a = make_event("long-a");
        set_exact(&mut long_a, DAY0);
        let mut long_b = make_event("long-b");
        set_exact(&mut long_b, DAY0 + 200.0 * DAY_SECONDS);
        let coerced = build_incident_temporal_analysis(
            &[long_a, long_b],
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Hour,
                ..Default::default()
            },
        );
        assert_ne!(coerced.resolution, TemporalResolutionKey::Hour);
        assert!(coerced.resolution_notice.is_some());
    }

    #[test]
    fn invalid_times_are_excluded_and_correlated_evidence_is_summarized() {
        let mut invalid = make_event("invalid-time");
        invalid.occurred_at = Some(0.0);
        invalid.updated_at = Some(0.0);
        invalid.occurrence = None;
        let mut corroborated = make_event("cluster-canonical");
        set_exact(&mut corroborated, DAY0 + HOUR_SECONDS);
        corroborated.incident = Some(IncidentMembership {
            cluster_id: "inc:cluster-canonical".to_string(),
            canonical_event_id: "cluster-canonical".to_string(),
            is_canonical: true,
            correlation_score: 1.0,
            confidence: IncidentCorrelationConfidence::Corroborated,
            member_count: 3,
            independent_family_count: 2,
            rationale: vec!["validation fixture".to_string()],
        });
        let mut uncertain = make_event("uncertain-day");
        uncertain.occurred_at = Some(DAY0 + DAY_SECONDS);
        uncertain.occurrence =
            create_day_occurrence_window(DAY0 + DAY_SECONDS, IncidentOccurrenceBasis::PublisherDay);
        let mut invalid_negative = make_event("invalid-negative-time");
        invalid_negative.occurred_at = Some(-10.0);
        invalid_negative.occurrence = None;
        let mut invalid_nan = make_event("invalid-nonfinite-time");
        invalid_nan.occurred_at = Some(f64::NAN);
        invalid_nan.occurrence = None;
        let coverage = measure_incident_temporal_coverage(&[
            invalid,
            invalid_negative,
            invalid_nan,
            corroborated.clone(),
            uncertain.clone(),
        ]);
        assert_eq!(coverage.invalid_time_count, 3);
        assert_eq!(coverage.valid_event_count, 2);
        assert_eq!(coverage.precise_count, 1);
        assert_eq!(coverage.imprecise_count, 1);

        let summary = summarize_playback_events([&corroborated, &uncertain]);
        assert_eq!(summary.retained_report_count, 4);
        assert_eq!(summary.corroborated_count, 1);
        assert_eq!(summary.uncertain_time_count, 1);
    }

    #[test]
    fn controller_steps_are_deterministic_quantized_and_bounded() {
        let mut first = make_event("first");
        set_exact(&mut first, DAY0 + HOUR_SECONDS);
        let mut second = make_event("second");
        set_exact(&mut second, DAY0 + 2.0 * HOUR_SECONDS);
        let mut third = make_event("third");
        set_exact(&mut third, DAY0 + 3.0 * HOUR_SECONDS);
        let incidents = [first, second, third];
        let analyses = IncidentPlaybackAnalyses::build(&incidents);
        let mut controller = IncidentPlaybackController::new(analyses, false);
        controller.toggle_active();
        controller.set_speed_multiplier(4.0);
        controller.toggle_playing();
        assert!(controller.playing());
        for _ in 0..4 {
            controller.advance(0.05);
        }
        assert_eq!(
            controller.frame_index(),
            0,
            "0.2s at 4x is not yet one frame"
        );
        assert!(controller.advance(0.05));
        assert_eq!(
            controller.frame_index(),
            1,
            "0.25s at 4x commits exactly one frame"
        );
        controller.step_frames(10);
        assert_eq!(
            controller.frame_index(),
            controller.analysis().frame_count - 1
        );
        controller.step_frames(-10);
        assert_eq!(controller.frame_index(), 0);
        controller.jump_to_end();
        assert_eq!(
            controller.frame_index(),
            controller.analysis().frame_count - 1
        );
        controller.jump_to_start();
        assert_eq!(controller.frame_index(), 0);

        controller.set_speed_multiplier(3.0);
        assert_eq!(
            controller.speed_multiplier(),
            4.0,
            "non-option speed is rejected"
        );
        for _ in 0..20 {
            controller.cycle_speed(1);
        }
        assert_eq!(
            controller.speed_multiplier(),
            32.0,
            "speed is bounded above"
        );
        for _ in 0..20 {
            controller.cycle_speed(-1);
        }
        assert_eq!(
            controller.speed_multiplier(),
            0.25,
            "speed is bounded below"
        );

        controller.pause();
        assert!(!controller.playing());
        controller.reset();
        assert_eq!(controller.frame_index(), 0);
    }

    #[test]
    fn typed_index_performance_smoke_five_thousand_incidents() {
        let mut synthetic = Vec::new();
        for index in 0..5000usize {
            let timestamp = DAY0 + (index % (120 * 24)) as f64 * HOUR_SECONDS;
            let mut event = make_event(&format!("perf-{index}"));
            event.occurred_at = Some(timestamp);
            event.updated_at = Some(timestamp);
            event.occurrence = if index % 3 == 0 {
                create_day_occurrence_window(timestamp, IncidentOccurrenceBasis::InferredDay)
            } else {
                create_second_occurrence_window(timestamp)
            };
            if index % 11 == 0 {
                event.incident = Some(IncidentMembership {
                    cluster_id: format!("inc:perf-{index}"),
                    canonical_event_id: format!("perf-{index}"),
                    is_canonical: true,
                    correlation_score: 1.0,
                    confidence: if index % 22 == 0 {
                        IncidentCorrelationConfidence::Corroborated
                    } else {
                        IncidentCorrelationConfidence::Inferred
                    },
                    member_count: 2,
                    independent_family_count: if index % 22 == 0 { 2 } else { 1 },
                    rationale: vec!["performance fixture".to_string()],
                });
            }
            synthetic.push(event);
        }
        let started = Instant::now();
        let analysis = build_incident_temporal_analysis(
            &synthetic,
            BuildTemporalAnalysisOptions {
                resolution: TemporalResolutionPreference::Day,
                ..Default::default()
            },
        );
        let mut extracted = 0usize;
        for frame in 0..analysis.frame_count {
            extracted += collect_playback_events(&analysis, frame as isize, PlaybackMode::Step, 1)
                .map(|value| value.event_indices.len())
                .unwrap_or(0);
            extracted +=
                collect_playback_events(&analysis, frame as isize, PlaybackMode::Trailing, 7)
                    .map(|value| value.event_indices.len())
                    .unwrap_or(0);
            extracted +=
                collect_playback_events(&analysis, frame as isize, PlaybackMode::Cumulative, 1)
                    .map(|value| value.event_indices.len())
                    .unwrap_or(0);
        }
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "playback performance fixture: 5000 incidents · {} frames · {} memberships · {} extraction rows · {:.1} ms",
            analysis.frame_count, analysis.total_membership_count, extracted, elapsed_ms
        );
        assert!(elapsed_ms < 2000.0, "{elapsed_ms:.1} ms");
        assert!(analysis.total_membership_count >= 5000);
        assert_eq!(
            analysis.membership_indices.len(),
            analysis.total_membership_count
        );
    }

    #[test]
    fn controller_cache_and_incident_mesh_rebuild_are_incremental_and_measurable() {
        let package = load_embedded();
        let correlated = correlate_incidents(package.normalized_incidents, NOW + 6.0 * DAY_SECONDS);
        let analyses = IncidentPlaybackAnalyses::build(&correlated.incidents);
        let mut controller = IncidentPlaybackController::new(analyses, false);
        controller.toggle_active();

        assert!(
            controller.refresh_extraction(),
            "first active frame extraction is built"
        );
        let initial_version = controller.extraction_version();
        assert!(
            !controller.refresh_extraction(),
            "unchanged frame/mode/trail/grid reuses cached extraction"
        );
        assert_eq!(controller.extraction_version(), initial_version);
        controller.step_frames(1);
        assert!(
            controller.refresh_extraction(),
            "quantized frame change rebuilds extraction"
        );
        let stepped_version = controller.extraction_version();
        assert_ne!(stepped_version, initial_version);
        assert!(
            !controller.refresh_extraction(),
            "sub-frame wall-clock redraws do not rebuild extraction"
        );

        controller.set_mode(PlaybackMode::Cumulative);
        controller.jump_to_end();
        assert!(controller.refresh_extraction());
        let extraction = controller
            .extraction()
            .expect("cumulative extraction")
            .clone();
        assert_eq!(extraction.mode, PlaybackMode::Cumulative);
        assert!(extraction.event_indices.len() > 1000);

        let rebuild_started = Instant::now();
        let mut total_mesh_bytes = 0usize;
        const REBUILD_ITERATIONS: usize = 60;
        for _ in 0..REBUILD_ITERATIONS {
            let cache = crate::build_playback_visual_cache(
                &correlated.incidents,
                &extraction,
                controller.extraction_version(),
            );
            total_mesh_bytes = total_mesh_bytes.saturating_add(
                cache
                    .near
                    .iter()
                    .map(|mesh| {
                        mesh.vertices.len() * std::mem::size_of::<macroquad::models::Vertex>()
                    })
                    .sum::<usize>(),
            );
            std::hint::black_box(cache);
        }
        let rebuild_elapsed_ms = rebuild_started.elapsed().as_secs_f64() * 1000.0;
        let average_rebuild_ms = rebuild_elapsed_ms / REBUILD_ITERATIONS as f64;
        println!(
            "incident visual rebuild: {} iterations · {:.3} ms average · {} vertex bytes total",
            REBUILD_ITERATIONS, average_rebuild_ms, total_mesh_bytes
        );
        assert!(
            average_rebuild_ms < 8.0,
            "incident-only visual rebuild averaged {average_rebuild_ms:.3} ms in debug tests"
        );
    }

    #[test]
    fn embedded_snapshot_playback_behavior_is_deterministic_and_auditable() {
        let package = load_embedded();
        assert!(package.load_errors.is_empty(), "{:?}", package.load_errors);
        let correlated = correlate_incidents(package.normalized_incidents, NOW + 6.0 * DAY_SECONDS);
        let analyses = IncidentPlaybackAnalyses::build(&correlated.incidents);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        println!(
            "embedded playback: {} incidents · {} valid/{} invalid · resolution {} · {} frames · {} memberships · grid prebuild {:.1} ms",
            correlated.incidents.len(),
            analysis.coverage.valid_event_count,
            analysis.coverage.invalid_time_count,
            analysis.resolution.as_str(),
            analysis.frame_count,
            analysis.total_membership_count,
            analyses.build_elapsed_ms
        );
        assert_eq!(correlated.incidents.len(), 3198);
        assert_eq!(
            analysis.coverage.input_event_count,
            correlated.incidents.len()
        );
        assert_eq!(
            analysis.coverage.valid_event_count + analysis.coverage.invalid_time_count,
            correlated.incidents.len()
        );
        assert!(analysis.coverage.valid_event_count > 3000);
        assert_eq!(analysis.resolution, TemporalResolutionKey::Day);
        assert!(analysis.frame_count <= 120);
        assert!(analysis.total_membership_count >= analysis.coverage.valid_event_count);
        assert!(analyses.build_elapsed_ms < 1000.0);

        let first_a = collect_playback_events(analysis, 17, PlaybackMode::Step, 1)
            .expect("first real extraction");
        let first_b = collect_playback_events(analysis, 17, PlaybackMode::Step, 1)
            .expect("second real extraction");
        assert_eq!(first_a.event_indices, first_b.event_indices);
        let summary = summarize_playback_events(
            first_a
                .event_indices
                .iter()
                .filter_map(|index| correlated.incidents.get(*index)),
        );
        assert_eq!(summary.count, first_a.event_indices.len());

        let manual_hour = analyses.resolution_choice(TemporalResolutionPreference::Hour);
        assert!(manual_hour.coerced);
        assert!(manual_hour.notice.is_some());
        assert_eq!(manual_hour.resolution, TemporalResolutionKey::Day);
    }
}
