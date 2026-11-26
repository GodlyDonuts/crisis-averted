//! Deterministic incident filtering and operational scoping for the native client.
//!
//! This is a deliberate Rust port of the web pipeline's `filterConflictEvents`
//! (`frontend/src/lib/conflictData.ts`) as wired in `GodEyeCommandCenter.tsx`:
//!
//! 1. The full correlated canonical corpus is scanned. Severity, category-group, time-window,
//!    and text-query filters are applied first; theater/region/country scoping is conjunctive
//!    on top. Filter application never mutates incidents, never reorders the corpus, and never
//!    rewrites correlation memberships — the output is an index subset in corpus order.
//! 2. Scope-option aggregations (theater/region/country pickers) are computed over the
//!    pre-scope result, exactly as the web aggregates theaters over `scopeEvents` (all filters
//!    except the theater selection itself). The native extension applies the same idea to all
//!    three geographic scope dimensions: every scope option list describes the corpus after
//!    severity/category/time/query filtering but before geographic scoping.
//! 3. Temporal playback grids are then rebuilt over the filtered corpus only, matching the
//!    web contract where `useIncidentPlayback(visibleEvents)` analyzes the filtered scope —
//!    never the full unfiltered corpus.
//!
//! Deliberate native extensions beyond the web filter, disclosed as such:
//! - Region and country exact-match scoping (the web exposes theater only).
//! - The text-query haystack adds actor evidence (UCDP side_a/side_b/dyad, ACLED detail actor
//!   segments) and source attribution (source name, publisher family) to the web's
//!   title/country/conflict/region/category fields. Matching remains lowercase substring
//!   semantics with Unicode-aware case folding; diacritics are never stripped, matching the
//!   web exactly.
//!
//! Everything in this module is deterministic given its inputs: wall-clock time enters only
//! through the explicit `now` parameter, and ordering is fully determined by corpus order and
//! documented tie-breaks.

use crate::data::Incident;
use crate::playback::IncidentPlaybackAnalyses;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::Instant;

/// Severity keys in rank order, mirroring the web `SEVERITY_ORDER`.
pub const SEVERITY_KEYS: [&str; 4] = ["critical", "high", "medium", "low"];

/// Defensive severity index lookup. Normalization always emits one of the four keys;
/// unknown legacy values conservatively fall to the lowest severity exactly like the
/// native severity-rank fallback.
pub fn severity_index(severity: &str) -> usize {
    match severity {
        "critical" | "c" => 0,
        "high" | "h" => 1,
        "medium" | "m" => 2,
        _ => 3,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CategoryGroup {
    Kinetic,
    Security,
    Strategic,
    Humanitarian,
    Political,
}

impl CategoryGroup {
    /// UI/iteration order mirrors the web `CATEGORY_GROUP_META` declaration order.
    pub const ALL: [Self; 5] = [
        Self::Kinetic,
        Self::Security,
        Self::Strategic,
        Self::Humanitarian,
        Self::Political,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Kinetic => "kinetic",
            Self::Security => "security",
            Self::Strategic => "strategic",
            Self::Humanitarian => "humanitarian",
            Self::Political => "political",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Kinetic => "Kinetic",
            Self::Security => "Security",
            Self::Strategic => "Strategic",
            Self::Humanitarian => "Humanitarian",
            Self::Political => "Political",
        }
    }

    pub fn index(self) -> usize {
        match self {
            Self::Kinetic => 0,
            Self::Security => 1,
            Self::Strategic => 2,
            Self::Humanitarian => 3,
            Self::Political => 4,
        }
    }
}

/// Category-to-group mapping mirroring the web `CATEGORY_GROUP_MAP` exactly, including the
/// conservative "security" fallback for unmapped categories.
pub fn category_group_for(category: &str) -> CategoryGroup {
    match category {
        "airstrike" | "ground_battle" | "missile" | "explosion" | "organized_violence" => {
            CategoryGroup::Kinetic
        }
        "terrorism" | "assassination" | "border_crossing" => CategoryGroup::Security,
        "protest" | "coup" | "diplomacy" | "sanctions" => CategoryGroup::Political,
        "humanitarian" | "migration" => CategoryGroup::Humanitarian,
        "naval" | "infrastructure" | "cyber" | "nuclear" => CategoryGroup::Strategic,
        _ => CategoryGroup::Security,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TimeWindowKey {
    Hours24,
    Days7,
    Days30,
    All,
}

impl TimeWindowKey {
    pub const ALL_KEYS: [Self; 4] = [Self::Hours24, Self::Days7, Self::Days30, Self::All];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hours24 => "24h",
            Self::Days7 => "7d",
            Self::Days30 => "30d",
            Self::All => "all",
        }
    }

    /// Hours of lookback; `None` mirrors the web's `Infinity` for the "all" window.
    pub fn hours(self) -> Option<f64> {
        match self {
            Self::Hours24 => Some(24.0),
            Self::Days7 => Some(24.0 * 7.0),
            Self::Days30 => Some(24.0 * 30.0),
            Self::All => None,
        }
    }
}

/// Complete immutable filter input. Equality drives change detection, so every dimension the
/// scan consumes is part of the struct. Defaults mirror `DEFAULT_CONFLICT_FILTERS` on the web
/// exactly: 30-day window, every severity enabled, the kinetic/security/strategic category
/// groups enabled while humanitarian and political start disabled, no geographic scope, and an
/// empty query.
#[derive(Debug, Clone, PartialEq)]
pub struct IncidentFilterSpec {
    pub severities: [bool; 4],
    pub category_groups: [bool; 5],
    pub time_window: TimeWindowKey,
    pub theater: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub query: String,
}

impl Default for IncidentFilterSpec {
    fn default() -> Self {
        Self {
            severities: [true; 4],
            // Web parity: DEFAULT_CONFLICT_FILTERS enables kinetic/security/strategic only;
            // humanitarian and political incidents are hidden until the operator opts in.
            category_groups: [true, true, true, false, false],
            time_window: TimeWindowKey::Days30,
            theater: None,
            region: None,
            country: None,
            query: String::new(),
        }
    }
}

impl IncidentFilterSpec {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    pub fn normalized_query(&self) -> String {
        normalize_query_text(&self.query)
    }
}

/// Query normalization identical to the web: trim, then Unicode-aware lowercase. The web's
/// `String.prototype.toLowerCase` and Rust's `str::to_lowercase` both implement the Unicode
/// default case conversion, so casing behavior (including e.g. Turkish dotted-capital İ
/// folding to `i` + combining dot) is equivalent. Diacritics are never stripped.
pub fn normalize_query_text(query: &str) -> String {
    query.trim().to_lowercase()
}

fn push_haystack_field(output: &mut String, field: &str) {
    if field.is_empty() {
        return;
    }
    if !output.is_empty() {
        output.push(' ');
    }
    output.push_str(field);
}

/// Build the lowercase search haystack for one incident. The first five fields mirror the web
/// haystack (title, country, conflict, region, category) exactly; the remaining fields are the
/// disclosed native extension covering actor evidence and source attribution. The haystack is
/// precomputed once per corpus load so per-keystroke rescans stay allocation-free in the scan
/// loop itself.
pub fn build_search_haystack(incident: &Incident) -> String {
    let mut combined = String::new();
    // Web-parity fields, in the web's concatenation order.
    push_haystack_field(&mut combined, &incident.title);
    push_haystack_field(&mut combined, &incident.country);
    push_haystack_field(&mut combined, &incident.conflict);
    if let Some(region) = &incident.region {
        push_haystack_field(&mut combined, region);
    }
    push_haystack_field(&mut combined, &incident.category);
    // Native extensions: theater slug, category group label, actor evidence, source attribution.
    push_haystack_field(&mut combined, &incident.theater);
    push_haystack_field(
        &mut combined,
        category_group_for(&incident.category).as_str(),
    );
    if let Some(detail) = &incident.detail {
        push_haystack_field(&mut combined, detail);
    }
    if let Some(ucdp) = &incident.ucdp {
        if let Some(side_a) = &ucdp.side_a {
            push_haystack_field(&mut combined, side_a);
        }
        if let Some(side_b) = &ucdp.side_b {
            push_haystack_field(&mut combined, side_b);
        }
        if let Some(dyad) = &ucdp.dyad_name {
            push_haystack_field(&mut combined, dyad);
        }
    }
    if let Some(source_name) = &incident.source_name {
        push_haystack_field(&mut combined, source_name);
    }
    push_haystack_field(&mut combined, &incident.source_family);
    combined.to_lowercase()
}

pub fn build_search_haystacks(incidents: &[Incident]) -> Vec<String> {
    incidents.iter().map(build_search_haystack).collect()
}

/// Deterministic per-dimension accounting of one scan. `excluded_*` counts are independent
/// per dimension: an incident failing several dimensions is counted in each of them, so the
/// counts intentionally overlap rather than summing to the total exclusion count. This is
/// disclosed in the UI rather than silently summed.
#[derive(Debug, Clone, Default)]
pub struct FilterStats {
    pub input_count: usize,
    pub output_count: usize,
    pub pre_scope_count: usize,
    pub excluded_severity: usize,
    pub excluded_category_group: usize,
    pub excluded_time_window: usize,
    pub excluded_query: usize,
    pub excluded_theater: usize,
    pub excluded_region: usize,
    pub excluded_country: usize,
    /// Wall clock used for the time-window evaluation, for transparent disclosure.
    pub now: f64,
    /// Cutoff timestamp actually applied. Mirrors the web exactly: finite windows use
    /// `now - hours`, while the unbounded "all" window uses `0`, so missing/zero timestamps
    /// are visible only in "all" and pre-1970 negative timestamps are never visible.
    pub cutoff: f64,
    pub scan_ms: f64,
}

/// One selectable scope value with its pre-scope incidence count. Ordering is deterministic:
/// weight/count descending, then key ascending.
#[derive(Debug, Clone)]
pub struct ScopeOption {
    pub key: String,
    pub label: String,
    pub count: usize,
    pub weight: f64,
}

/// Aggregated selectable scopes over the pre-scope corpus (severity/category/time/query
/// applied, geographic scope deliberately not applied), mirroring how the web derives the
/// theater list from `scopeEvents`.
#[derive(Debug, Clone, Default)]
pub struct ScopeOptions {
    pub theaters: Vec<ScopeOption>,
    pub regions: Vec<ScopeOption>,
    pub countries: Vec<ScopeOption>,
}

/// Output of one deterministic scan pass. `indices` maps filtered positions to corpus
/// positions in corpus order; the corpus itself is never reordered or mutated.
#[derive(Debug, Clone)]
pub struct FilterPass {
    pub indices: Vec<u32>,
    pub in_scope: Vec<bool>,
    pub stats: FilterStats,
    pub options: ScopeOptions,
}

/// Time-window predicate mirroring the web comparison `event.occurredAt < cutoff` exactly.
/// Missing timestamps behave as the web's normalized zero. NaN is deliberately not excluded:
/// in JS `NaN < cutoff` evaluates false and the incident survives, so the incomparable case
/// here is survival too. This is the exact IEEE/JS ordering semantic, not an oversight.
fn within_time_window(occurred_at: Option<f64>, cutoff: f64) -> bool {
    let occurred_at = occurred_at.unwrap_or(0.0);
    !matches!(
        occurred_at.partial_cmp(&cutoff),
        Some(std::cmp::Ordering::Less)
    )
}

/// Evaluate one incident against the complete spec. `haystack` is the precomputed lowercase
/// search text for this incident; `query` is the already-normalized query.
pub fn incident_matches(
    incident: &Incident,
    haystack: &str,
    spec: &IncidentFilterSpec,
    cutoff: f64,
    query: &str,
) -> bool {
    if !spec.severities[severity_index(&incident.severity)] {
        return false;
    }
    if !spec.category_groups[category_group_for(&incident.category).index()] {
        return false;
    }
    if !within_time_window(incident.occurred_at, cutoff) {
        return false;
    }
    if !query.is_empty() && !haystack.contains(query) {
        return false;
    }
    if let Some(theater) = &spec.theater {
        if &incident.theater != theater {
            return false;
        }
    }
    if let Some(region) = &spec.region {
        if incident.region.as_deref() != Some(region.as_str()) {
            return false;
        }
    }
    if let Some(country) = &spec.country {
        if &incident.country != country {
            return false;
        }
    }
    true
}

fn dimension_failures(
    incident: &Incident,
    haystack: &str,
    spec: &IncidentFilterSpec,
    cutoff: f64,
    query: &str,
) -> (bool, bool, bool, bool) {
    let severity_fail = !spec.severities[severity_index(&incident.severity)];
    let category_fail = !spec.category_groups[category_group_for(&incident.category).index()];
    let time_fail = !within_time_window(incident.occurred_at, cutoff);
    let query_fail = !query.is_empty() && !haystack.contains(query);
    (severity_fail, category_fail, time_fail, query_fail)
}

/// Cutoff timestamp for a scan, mirroring the web `filterConflictEvents` exactly: finite
/// windows trail `now` by their hour count; the "all" window uses `0`, which keeps zero/missing
/// timestamps visible while still excluding negative (pre-1970) timestamps.
pub fn time_window_cutoff(time_window: TimeWindowKey, now: f64) -> f64 {
    spec_cutoff_hours(time_window, now)
}

fn spec_cutoff_hours(time_window: TimeWindowKey, now: f64) -> f64 {
    match time_window.hours() {
        Some(hours) => now - hours * 3600.0,
        None => 0.0,
    }
}

/// Scan the canonical corpus deterministically. The scan order is the corpus order, which is
/// the correlation output order (occurrence-descending); filtering never reorders.
pub fn scan_corpus(
    incidents: &[Incident],
    haystacks: &[String],
    spec: &IncidentFilterSpec,
    now: f64,
) -> FilterPass {
    let started = Instant::now();
    let cutoff = spec_cutoff_hours(spec.time_window, now);
    let query = spec.normalized_query();

    let mut indices = Vec::new();
    let mut in_scope = vec![false; incidents.len()];
    let mut stats = FilterStats {
        input_count: incidents.len(),
        now,
        cutoff,
        ..Default::default()
    };

    // Pre-scope aggregation accumulators. Theater weight mirrors the web `aggregateTheaters`
    // ordering input (raw intensity sum; normalization by the maximum does not change order),
    // and the representative label is the first non-empty conflict name in scan order, exactly
    // like the web's `group.find((event) => event.conflict)` representative selection.
    let mut theater_acc: std::collections::BTreeMap<String, (usize, f64, String)> =
        std::collections::BTreeMap::new();
    let mut region_acc: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    let mut country_acc: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();

    for (index, incident) in incidents.iter().enumerate() {
        let haystack = haystacks.get(index).map(String::as_str).unwrap_or_default();
        let (severity_fail, category_fail, time_fail, query_fail) =
            dimension_failures(incident, haystack, spec, cutoff, &query);
        stats.excluded_severity += usize::from(severity_fail);
        stats.excluded_category_group += usize::from(category_fail);
        stats.excluded_time_window += usize::from(time_fail);
        stats.excluded_query += usize::from(query_fail);
        let pre_scope_ok = !(severity_fail || category_fail || time_fail || query_fail);

        if pre_scope_ok {
            stats.pre_scope_count += 1;
            let entry =
                theater_acc
                    .entry(incident.theater.clone())
                    .or_insert((0, 0.0, String::new()));
            entry.0 += 1;
            entry.1 += incident.intensity as f64;
            if entry.2.is_empty() && !incident.conflict.is_empty() {
                entry.2 = incident.conflict.clone();
            }
            if let Some(region) = incident.region.as_deref().filter(|value| !value.is_empty()) {
                *region_acc.entry(region.to_string()).or_insert(0) += 1;
            }
            if !incident.country.is_empty() {
                *country_acc.entry(incident.country.clone()).or_insert(0) += 1;
            }
        }

        let theater_fail = spec
            .theater
            .as_ref()
            .is_some_and(|theater| &incident.theater != theater);
        let region_fail = spec
            .region
            .as_ref()
            .is_some_and(|region| incident.region.as_deref() != Some(region.as_str()));
        let country_fail = spec
            .country
            .as_ref()
            .is_some_and(|country| &incident.country != country);
        stats.excluded_theater += usize::from(theater_fail);
        stats.excluded_region += usize::from(region_fail);
        stats.excluded_country += usize::from(country_fail);

        if pre_scope_ok && !theater_fail && !region_fail && !country_fail {
            indices.push(index as u32);
            in_scope[index] = true;
        }
    }

    stats.output_count = indices.len();

    let mut theaters: Vec<ScopeOption> = theater_acc
        .into_iter()
        .map(|(key, (count, weight, label))| ScopeOption {
            label: if label.is_empty() { key.clone() } else { label },
            key,
            count,
            weight,
        })
        .collect();
    // Web parity: `aggregateTheaters` sorts by intensity descending, then event count
    // descending. The final key-ascending tie-break is a native determinism addition for
    // exactly-equal theaters, which the web leaves to insertion order.
    theaters.sort_by(|a, b| {
        b.weight
            .total_cmp(&a.weight)
            .then_with(|| b.count.cmp(&a.count))
            .then_with(|| a.key.cmp(&b.key))
    });
    let mut regions: Vec<ScopeOption> = region_acc
        .into_iter()
        .map(|(key, count)| ScopeOption {
            label: key.clone(),
            key,
            count,
            weight: count as f64,
        })
        .collect();
    regions.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));
    let mut countries: Vec<ScopeOption> = country_acc
        .into_iter()
        .map(|(key, count)| ScopeOption {
            label: key.clone(),
            key,
            count,
            weight: count as f64,
        })
        .collect();
    countries.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));

    stats.scan_ms = started.elapsed().as_secs_f64() * 1000.0;
    FilterPass {
        indices,
        in_scope,
        stats,
        options: ScopeOptions {
            theaters,
            regions,
            countries,
        },
    }
}

/// Cycle a scope selection through an option list in deterministic order. The "no scope"
/// position sits before the first option; moving forward from the last option clears the
/// scope. A current value that no longer appears in the option list (for example because a
/// narrowed query removed its incidents) is treated as the cleared position, so cycling
/// remains total and deterministic.
pub fn cycle_scope_option(
    current: &Option<String>,
    options: &[ScopeOption],
    direction: isize,
) -> Option<String> {
    if options.is_empty() {
        return None;
    }
    let position = current
        .as_ref()
        .and_then(|value| options.iter().position(|option| &option.key == value));
    let len = options.len() as isize;
    match position {
        Some(index) => {
            let mut next = index as isize + direction;
            // Stepping backward before the first option or forward past the last clears scope.
            if next < 0 || next >= len {
                // Wrap around through the cleared position so long lists remain cyclable.
                let span = len + 1;
                next = (index as isize + direction).rem_euclid(span);
                if next == len {
                    return None;
                }
                return Some(options[next as usize].key.clone());
            }
            Some(options[next as usize].key.clone())
        }
        None => {
            if direction >= 0 {
                Some(options[0].key.clone())
            } else {
                Some(options[(len - 1) as usize].key.clone())
            }
        }
    }
}

/// Heavy playback-grid construction input. The scan itself stays on the render thread (it is
/// measured in microseconds); only the sparse temporal grid prebuild — the multi-millisecond
/// part — is delegated so typing in the search box never stalls frames.
#[derive(Debug, Clone)]
pub struct FilterAnalysisJob {
    pub generation: u64,
    pub corpus: Arc<Vec<Incident>>,
    pub indices: Vec<u32>,
}

#[derive(Debug)]
pub struct FilterAnalysisOutcome {
    pub generation: u64,
    pub analyses: IncidentPlaybackAnalyses,
    pub filtered_count: usize,
    pub build_ms: f64,
}

/// Build playback analyses over the filtered corpus subset. The filtered clone preserves
/// corpus order, so analysis positions coincide with positions in `indices`; render code
/// remaps extraction rows back into corpus positions through that same vector, keeping the
/// underlying canonical incidents untouched.
pub fn build_analyses_for_indices(
    corpus: &[Incident],
    indices: &[u32],
) -> (IncidentPlaybackAnalyses, f64) {
    let started = Instant::now();
    let filtered: Vec<Incident> = indices
        .iter()
        .filter_map(|index| corpus.get(*index as usize).cloned())
        .collect();
    let analyses = IncidentPlaybackAnalyses::build(&filtered);
    (analyses, started.elapsed().as_secs_f64() * 1000.0)
}

fn run_filter_analysis_worker(rx: Receiver<FilterAnalysisJob>, tx: Sender<FilterAnalysisOutcome>) {
    while let Ok(mut job) = rx.recv() {
        // Latest-wins coalescing: intermediate keystroke generations whose results would be
        // discarded anyway are never built.
        while let Ok(newer) = rx.try_recv() {
            job = newer;
        }
        let started = Instant::now();
        let (analyses, _) = build_analyses_for_indices(&job.corpus, &job.indices);
        let outcome = FilterAnalysisOutcome {
            generation: job.generation,
            analyses,
            filtered_count: job.indices.len(),
            build_ms: started.elapsed().as_secs_f64() * 1000.0,
        };
        if tx.send(outcome).is_err() {
            break;
        }
    }
}

/// Spawn the background analysis builder. Returns `None` if the thread cannot be spawned;
/// callers then fall back to synchronous construction and disclose it.
pub fn spawn_filter_analysis_worker(
) -> Option<(Sender<FilterAnalysisJob>, Receiver<FilterAnalysisOutcome>)> {
    let (job_tx, job_rx) = std::sync::mpsc::channel::<FilterAnalysisJob>();
    let (outcome_tx, outcome_rx) = std::sync::mpsc::channel::<FilterAnalysisOutcome>();
    std::thread::Builder::new()
        .name("godseye-filter-analysis".to_string())
        .spawn(move || run_filter_analysis_worker(job_rx, outcome_tx))
        .ok()?;
    Some((job_tx, outcome_rx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::correlation::correlate_incidents;
    use crate::data::{
        create_day_occurrence_window, create_second_occurrence_window, load_embedded,
        IncidentOccurrenceBasis,
    };
    use crate::playback::{collect_playback_events, PlaybackMode, TemporalResolutionPreference};

    const NOW: f64 = 1_795_176_000.0; // 2026-11-20T12:00:00Z, fixed for deterministic tests
    const DAY: f64 = 86_400.0;
    const HOUR: f64 = 3_600.0;

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
            occurred_at: Some(NOW - DAY),
            updated_at: Some(NOW - DAY),
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

    fn scan(incidents: &[Incident], spec: &IncidentFilterSpec) -> FilterPass {
        let haystacks = build_search_haystacks(incidents);
        scan_corpus(incidents, &haystacks, spec, NOW)
    }

    #[test]
    fn severity_and_category_group_inclusion_mirror_web_semantics() {
        let mut critical = make_event("sev-critical");
        critical.severity = "critical".to_string();
        critical.category = "missile".to_string();
        let mut high = make_event("sev-high");
        high.severity = "high".to_string();
        high.category = "naval".to_string();
        let mut medium = make_event("sev-medium");
        medium.severity = "medium".to_string();
        medium.category = "diplomacy".to_string();
        let mut low = make_event("sev-low");
        low.severity = "low".to_string();
        low.category = "other".to_string();
        let incidents = vec![critical, high, medium, low];

        let mut spec = IncidentFilterSpec::default();
        spec.severities = [true, false, false, false];
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);
        assert_eq!(incidents[pass.indices[0] as usize].id, "sev-critical");
        assert_eq!(pass.stats.excluded_severity, 3);

        // naval is strategic; diplomacy political; other falls back to security; missile kinetic.
        let mut spec = IncidentFilterSpec::default();
        spec.category_groups = [false, true, false, false, false]; // security only
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);
        assert_eq!(incidents[pass.indices[0] as usize].id, "sev-low");
        assert_eq!(pass.stats.excluded_category_group, 3);

        let mut spec = IncidentFilterSpec::default();
        spec.category_groups = [false, false, true, false, true]; // strategic + political
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 2);

        // An empty severity set hides everything without panicking.
        let mut spec = IncidentFilterSpec::default();
        spec.severities = [false; 4];
        let pass = scan(&incidents, &spec);
        assert!(pass.indices.is_empty());
        assert_eq!(pass.stats.output_count, 0);
    }

    #[test]
    fn category_group_mapping_matches_web_table() {
        assert_eq!(category_group_for("airstrike"), CategoryGroup::Kinetic);
        assert_eq!(category_group_for("ground_battle"), CategoryGroup::Kinetic);
        assert_eq!(
            category_group_for("organized_violence"),
            CategoryGroup::Kinetic
        );
        assert_eq!(category_group_for("explosion"), CategoryGroup::Kinetic);
        assert_eq!(category_group_for("terrorism"), CategoryGroup::Security);
        assert_eq!(category_group_for("assassination"), CategoryGroup::Security);
        assert_eq!(
            category_group_for("border_crossing"),
            CategoryGroup::Security
        );
        assert_eq!(category_group_for("other"), CategoryGroup::Security);
        assert_eq!(category_group_for("protest"), CategoryGroup::Political);
        assert_eq!(category_group_for("coup"), CategoryGroup::Political);
        assert_eq!(category_group_for("diplomacy"), CategoryGroup::Political);
        assert_eq!(category_group_for("sanctions"), CategoryGroup::Political);
        assert_eq!(
            category_group_for("humanitarian"),
            CategoryGroup::Humanitarian
        );
        assert_eq!(category_group_for("migration"), CategoryGroup::Humanitarian);
        assert_eq!(category_group_for("naval"), CategoryGroup::Strategic);
        assert_eq!(
            category_group_for("infrastructure"),
            CategoryGroup::Strategic
        );
        assert_eq!(category_group_for("cyber"), CategoryGroup::Strategic);
        assert_eq!(category_group_for("nuclear"), CategoryGroup::Strategic);
        assert_eq!(
            category_group_for("unmapped-novelty"),
            CategoryGroup::Security
        );
    }

    #[test]
    fn time_window_uses_explicit_now_and_web_cutoff_semantics() {
        let mut fresh = make_event("fresh");
        fresh.occurred_at = Some(NOW - 2.0 * HOUR);
        let mut week_old = make_event("week-old");
        week_old.occurred_at = Some(NOW - 6.0 * DAY);
        let mut month_old = make_event("month-old");
        month_old.occurred_at = Some(NOW - 40.0 * DAY);
        let mut boundary = make_event("boundary");
        boundary.occurred_at = Some(NOW - 24.0 * HOUR);
        let mut missing_time = make_event("missing-time");
        missing_time.occurred_at = None;
        let incidents = vec![fresh, week_old, month_old, boundary, missing_time];

        let mut spec = IncidentFilterSpec::default();
        spec.time_window = TimeWindowKey::Hours24;
        let pass = scan(&incidents, &spec);
        let ids: Vec<&str> = pass
            .indices
            .iter()
            .map(|index| incidents[*index as usize].id.as_str())
            .collect();
        // The web comparison is `<` cutoff, so an incident exactly at the cutoff survives.
        assert_eq!(ids, vec!["fresh", "boundary"]);
        assert_eq!(pass.stats.excluded_time_window, 3);

        spec.time_window = TimeWindowKey::Days7;
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 3);

        spec.time_window = TimeWindowKey::Days30;
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 3);

        spec.time_window = TimeWindowKey::All;
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 5);
        assert_eq!(pass.stats.excluded_time_window, 0);
    }

    #[test]
    fn theater_region_country_scoping_is_exact_and_conjunctive() {
        let mut ukraine = make_event("scope-ukraine");
        ukraine.theater = "russia-ukraine-war".to_string();
        ukraine.country = "Ukraine".to_string();
        ukraine.region = Some("Europe".to_string());
        let mut iran = make_event("scope-iran");
        iran.theater = "iran-us-confrontation".to_string();
        iran.country = "Iran".to_string();
        iran.region = Some("Middle East".to_string());
        let mut no_region = make_event("scope-no-region");
        no_region.theater = "iran-us-confrontation".to_string();
        no_region.country = "Iran".to_string();
        no_region.region = None;
        let incidents = vec![ukraine, iran, no_region];

        let mut spec = IncidentFilterSpec::default();
        spec.theater = Some("iran-us-confrontation".to_string());
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 2);
        assert_eq!(pass.stats.excluded_theater, 1);

        spec.region = Some("Middle East".to_string());
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);
        assert_eq!(incidents[pass.indices[0] as usize].id, "scope-iran");

        // Region scope excludes records lacking the region entirely — never a silent match.
        let mut spec = IncidentFilterSpec::default();
        spec.region = Some("Middle East".to_string());
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);
        assert_eq!(pass.stats.excluded_region, 2);

        let mut spec = IncidentFilterSpec::default();
        spec.country = Some("Iran".to_string());
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 2);
        assert_eq!(pass.stats.excluded_country, 1);

        // Conjunctive narrowing: matching theater but wrong country yields nothing, and the
        // empty state is reported rather than silently widening.
        spec.country = Some("Ukraine".to_string());
        spec.theater = Some("iran-us-confrontation".to_string());
        let pass = scan(&incidents, &spec);
        assert!(pass.indices.is_empty());
        assert_eq!(pass.stats.input_count, 3);
        assert_eq!(pass.stats.output_count, 0);
    }

    #[test]
    fn text_search_is_case_insensitive_substring_across_web_and_extension_fields() {
        let mut incident = make_event("search-target");
        incident.title = "Missile strike hits Odesa port infrastructure".to_string();
        incident.country = "Ukraine".to_string();
        incident.region = Some("Europe".to_string());
        incident.detail =
            Some("shelling · Military Forces of Russia vs Military Forces of Ukraine · 4 reported fatalities".to_string());
        incident.source_name = Some("Suspilne".to_string());
        let mut other = make_event("search-other");
        other.title = "Border incident in the north".to_string();
        other.detail = None;
        // Fields are deliberately disjoint from the target so single-match assertions isolate
        // exactly one haystack dimension rather than accidental fixture overlap.
        other.country = "Finland".to_string();
        other.conflict = "Finland border tension".to_string();
        other.theater = "finland-border-tension".to_string();
        other.region = Some("Arctic".to_string());
        other.category = "border_crossing".to_string();
        let incidents = vec![incident, other];

        // Web-parity fields: title, country, conflict, region, category.
        for query in [
            "odesa",
            "ODESA",
            "Odesa Port",
            "ukraine",
            "europe",
            "airstrike",
        ] {
            let mut spec = IncidentFilterSpec::default();
            spec.query = query.to_string();
            let pass = scan(&incidents, &spec);
            assert_eq!(pass.indices.len(), 1, "query {query}");
            assert_eq!(incidents[pass.indices[0] as usize].id, "search-target");
        }

        // Whitespace-only and empty queries are treated as no query, exactly like the web trim.
        let mut spec = IncidentFilterSpec::default();
        spec.query = "   ".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 2);

        // Native extension: actor evidence inside ACLED-style detail text.
        let mut spec = IncidentFilterSpec::default();
        spec.query = "military forces of russia".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);

        // Native extension: source attribution.
        let mut spec = IncidentFilterSpec::default();
        spec.query = "suspilne".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);

        // A non-matching query hides everything but is counted openly.
        let mut spec = IncidentFilterSpec::default();
        spec.query = "nonexistent-place".to_string();
        let pass = scan(&incidents, &spec);
        assert!(pass.indices.is_empty());
        assert_eq!(pass.stats.excluded_query, 2);
    }

    #[test]
    fn text_search_unicode_case_folding_matches_web_behavior() {
        let mut incident = make_event("unicode-target");
        incident.title = "Clashes near İstanbul checkpoint".to_string();
        incident.country = "Türkiye".to_string();
        let incidents = vec![incident];

        // Unicode-aware lowercase: 'İ' folds to 'i' + U+0307 in both JS and Rust; searching the
        // folded form matches, while ASCII-only 'i' does not — exactly the web behavior.
        let folded_query = "İstanbul".to_lowercase();
        let mut spec = IncidentFilterSpec::default();
        spec.query = folded_query.clone();
        let pass = scan(&incidents, &spec);
        assert_eq!(
            pass.indices.len(),
            1,
            "folded query {folded_query:?} matches"
        );

        let mut spec = IncidentFilterSpec::default();
        spec.query = "istanbul".to_string();
        let pass = scan(&incidents, &spec);
        assert!(
            pass.indices.is_empty(),
            "plain ASCII does not match dotted-capital fold, mirroring JS substring semantics"
        );

        // Diacritics are not stripped: 'cafe' must not match 'café', exactly as in the web.
        let mut incident = make_event("diacritic-target");
        incident.title = "Explosion near café district".to_string();
        let incidents = vec![incident];
        let mut spec = IncidentFilterSpec::default();
        spec.query = "cafe".to_string();
        let pass = scan(&incidents, &spec);
        assert!(pass.indices.is_empty());
        let mut spec = IncidentFilterSpec::default();
        spec.query = "café".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);

        // Cyrillic case folding works in both directions.
        let mut incident = make_event("cyrillic-target");
        incident.title = "Обстріл у Харкові".to_string();
        let incidents = vec![incident];
        let mut spec = IncidentFilterSpec::default();
        spec.query = "харкові".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);
        let mut spec = IncidentFilterSpec::default();
        spec.query = "ХАРКОВІ".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices.len(), 1);
    }

    #[test]
    fn scope_options_aggregate_pre_scope_corpus_with_deterministic_order() {
        let mut a = make_event("opt-a");
        a.theater = "theater-alpha".to_string();
        a.conflict = "Alpha conflict".to_string();
        a.title = "Strike in Alpha province".to_string();
        a.country = "AlphaLand".to_string();
        a.intensity = 0.9;
        let mut b = make_event("opt-b");
        b.theater = "theater-beta".to_string();
        b.conflict = "Beta conflict".to_string();
        b.title = "Shelling in Beta city".to_string();
        b.country = "BetaLand".to_string();
        b.region = Some("Asia".to_string());
        b.intensity = 0.1;
        let mut c = make_event("opt-c");
        c.theater = "theater-beta".to_string();
        c.conflict = "Beta conflict".to_string();
        c.title = "Second strike in Beta city".to_string();
        c.country = "BetaLand".to_string();
        c.region = Some("Asia".to_string());
        c.intensity = 0.2;
        let incidents = vec![a, b, c];

        let pass = scan(&incidents, &IncidentFilterSpec::default());
        assert_eq!(pass.options.theaters.len(), 2);
        // Web `aggregateTheaters` ordering: raw intensity sum descending. Alpha carries 0.9;
        // beta carries 0.1+0.2 = 0.3, so alpha leads even though beta has more incidents.
        assert_eq!(pass.options.theaters[0].key, "theater-alpha");
        assert_eq!(pass.options.theaters[1].key, "theater-beta");
        assert_eq!(pass.options.theaters[1].count, 2);
        // Representative labels come from the first non-empty conflict name in scan order.
        assert_eq!(pass.options.theaters[0].label, "Alpha conflict");
        assert_eq!(pass.options.countries[0].key, "BetaLand");
        assert_eq!(pass.options.countries[0].count, 2);

        // Geographic scope must not shrink the option lists: selecting a theater still lists all
        // pre-scope theaters, exactly as the web theater list ignores the theater selection.
        let mut spec = IncidentFilterSpec::default();
        spec.theater = Some("theater-beta".to_string());
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.options.theaters.len(), 2);
        assert_eq!(pass.indices.len(), 2);

        // But non-scope dimensions do narrow the option lists.
        let mut spec = IncidentFilterSpec::default();
        spec.query = "alpha province".to_string();
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.options.theaters.len(), 1);
        assert_eq!(pass.options.theaters[0].key, "theater-alpha");
    }

    #[test]
    fn cycle_scope_option_is_total_and_deterministic() {
        let options = vec![
            ScopeOption {
                key: "alpha".to_string(),
                label: "Alpha".to_string(),
                count: 3,
                weight: 3.0,
            },
            ScopeOption {
                key: "beta".to_string(),
                label: "Beta".to_string(),
                count: 2,
                weight: 2.0,
            },
        ];
        assert_eq!(
            cycle_scope_option(&None, &options, 1),
            Some("alpha".to_string())
        );
        assert_eq!(
            cycle_scope_option(&Some("alpha".to_string()), &options, 1),
            Some("beta".to_string())
        );
        assert_eq!(
            cycle_scope_option(&Some("beta".to_string()), &options, 1),
            None
        );
        assert_eq!(
            cycle_scope_option(&Some("beta".to_string()), &options, -1),
            Some("alpha".to_string())
        );
        assert_eq!(
            cycle_scope_option(&Some("alpha".to_string()), &options, -1),
            None
        );
        // Unknown current values are treated as cleared.
        assert_eq!(
            cycle_scope_option(&Some("stale".to_string()), &options, 1),
            Some("alpha".to_string())
        );
        assert_eq!(cycle_scope_option(&None, &[], 1), None);
    }

    #[test]
    fn scan_output_is_deterministic_and_preserves_corpus_order() {
        let mut incidents = Vec::new();
        for index in 0..40 {
            let mut event = make_event(&format!("det-{}", index));
            event.severity = ["critical", "high", "medium", "low"][index % 4].to_string();
            event.category = ["airstrike", "naval", "diplomacy", "other"][index % 4].to_string();
            event.occurred_at = Some(NOW - (index % 20) as f64 * DAY);
            incidents.push(event);
        }
        let mut spec = IncidentFilterSpec::default();
        spec.severities = [true, true, false, false];
        let first = scan(&incidents, &spec);
        let second = scan(&incidents, &spec);
        assert_eq!(first.indices, second.indices);
        assert!(first.indices.windows(2).all(|window| window[0] < window[1]));
        let count = first.indices.len();
        assert_eq!(
            count,
            first.in_scope.iter().filter(|visible| **visible).count()
        );
    }

    #[test]
    fn playback_grids_analyze_only_the_filtered_corpus_in_corpus_order() {
        let mut keep_a = make_event("keep-a");
        keep_a.severity = "critical".to_string();
        keep_a.occurred_at = Some(NOW - 2.0 * HOUR);
        keep_a.occurrence = create_second_occurrence_window(NOW - 2.0 * HOUR);
        let mut drop_b = make_event("drop-b");
        drop_b.severity = "low".to_string();
        drop_b.occurred_at = Some(NOW - 3.0 * HOUR);
        drop_b.occurrence = create_second_occurrence_window(NOW - 3.0 * HOUR);
        let mut keep_c = make_event("keep-c");
        keep_c.severity = "high".to_string();
        keep_c.occurred_at = Some(NOW - 4.0 * HOUR);
        keep_c.occurrence = create_second_occurrence_window(NOW - 4.0 * HOUR);
        let incidents = vec![keep_a, drop_b, keep_c];

        let mut spec = IncidentFilterSpec::default();
        spec.severities = [true, true, false, false];
        let pass = scan(&incidents, &spec);
        assert_eq!(pass.indices, vec![0, 2]);

        let (analyses, _) = build_analyses_for_indices(&incidents, &pass.indices);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        assert_eq!(analysis.coverage.input_event_count, 2);
        assert_eq!(analysis.coverage.valid_event_count, 2);

        // Extraction rows are positions in the filtered clone; remapping through the scan
        // indices must recover exactly the original in-scope corpus positions.
        let extraction = collect_playback_events(analysis, 0, PlaybackMode::Cumulative, 1);
        if let Some(extraction) = extraction {
            for position in &extraction.event_indices {
                let corpus_index = pass.indices[*position] as usize;
                assert!(
                    matches!(corpus_index, 0 | 2),
                    "extraction never references filtered-out incidents"
                );
                assert_ne!(incidents[corpus_index].id, "drop-b");
            }
        }
    }

    #[test]
    fn empty_filter_result_yields_empty_playback_analysis_without_panics() {
        let mut incident = make_event("only-one");
        incident.occurrence = create_second_occurrence_window(NOW - HOUR);
        let incidents = vec![incident];
        let mut spec = IncidentFilterSpec::default();
        spec.query = "matches-nothing-anywhere".to_string();
        let pass = scan(&incidents, &spec);
        assert!(pass.indices.is_empty());

        let (analyses, _) = build_analyses_for_indices(&incidents, &pass.indices);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        assert_eq!(analysis.frame_count, 0);
        assert_eq!(analysis.coverage.valid_event_count, 0);
        assert!(collect_playback_events(analysis, 0, PlaybackMode::Step, 1).is_none());
    }

    #[test]
    fn evidence_members_can_be_scoped_without_mutating_cluster_state() {
        // Filtering operates on index membership only: a member record evaluated against the
        // spec yields a boolean; nothing in the incident or its cluster is rewritten.
        let mut member = make_event("member-evidence");
        member.title = "Linked report of the same strike".to_string();
        member.severity = "medium".to_string();
        let haystack = build_search_haystack(&member);
        let before = format!("{:?}", member.incident);

        let mut spec = IncidentFilterSpec::default();
        spec.severities = [true, true, false, false];
        let cutoff = time_window_cutoff(spec.time_window, NOW);
        let query = spec.normalized_query();
        let matches = incident_matches(&member, &haystack, &spec, cutoff, &query);
        assert!(!matches, "medium severity is disabled in this spec");
        let after = format!("{:?}", member.incident);
        assert_eq!(before, after, "evaluation never mutates membership state");
    }

    #[test]
    fn real_snapshot_filter_semantics_are_pinned_and_fast() {
        let package = load_embedded();
        assert!(package.load_errors.is_empty(), "{:?}", package.load_errors);
        let correlated = correlate_incidents(package.normalized_incidents, NOW + 6.0 * DAY);
        let incidents = correlated.incidents;
        let haystacks = build_search_haystacks(&incidents);

        let started = Instant::now();
        let pass = scan_corpus(
            &incidents,
            &haystacks,
            &IncidentFilterSpec::default(),
            NOW + 6.0 * DAY,
        );
        let scan_ms = started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "real snapshot default scan: {}/{} in scope · {} pre-scope · {:.2} ms (engine report {:.2} ms)",
            pass.stats.output_count, pass.stats.input_count, pass.stats.pre_scope_count, scan_ms, pass.stats.scan_ms
        );
        // Pinned scan accounting for the embedded corpus at the fixed evaluation time. These
        // counts are a deliberate parity contract: if the embedded snapshot or the web filter
        // semantics change, this test must be updated in the same commit with justification.
        assert_eq!(pass.stats.input_count, 3198);
        assert!(
            pass.stats.scan_ms < 25.0,
            "scan {:.2} ms",
            pass.stats.scan_ms
        );
        assert_eq!(pass.stats.output_count, 566);
        assert_eq!(pass.stats.pre_scope_count, 566);
        assert_eq!(
            pass.indices.len(),
            pass.in_scope.iter().filter(|visible| **visible).count()
        );

        // Theater option ordering is pinned exactly (intensity-sum descending per
        // `aggregateTheaters` semantics, deterministic tie-breaks).
        let theater_keys: Vec<&str> = pass
            .options
            .theaters
            .iter()
            .take(3)
            .map(|option| option.key.as_str())
            .collect();
        println!("top theaters: {:?}", theater_keys);
        assert_eq!(theater_keys, vec!["ukraine", "iran_hormuz", "israel_gaza"]);

        // A real query against the corpus behaves deterministically.
        let mut spec = IncidentFilterSpec::default();
        spec.query = "ukraine".to_string();
        let pass_query = scan_corpus(&incidents, &haystacks, &spec, NOW + 6.0 * DAY);
        println!(
            "ukraine query scan: {}/{} in scope · excluded_query {} · pre-scope {}",
            pass_query.stats.output_count,
            pass_query.stats.input_count,
            pass_query.stats.excluded_query,
            pass_query.stats.pre_scope_count
        );
        assert_eq!(pass_query.stats.output_count, 157);
        assert_eq!(pass_query.stats.excluded_query, 2273);

        // The heavy grid prebuild over the filtered corpus is bounded and index-consistent.
        let started = Instant::now();
        let (analyses, _) = build_analyses_for_indices(&incidents, &pass.indices);
        let build_ms = started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "filtered grid prebuild: {} incidents · {:.2} ms",
            pass.indices.len(),
            build_ms
        );
        assert!(build_ms < 500.0, "build {:.2} ms", build_ms);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        assert_eq!(analysis.coverage.input_event_count, pass.indices.len());
    }

    #[test]
    fn analysis_build_worker_coalesces_to_latest_generation() {
        let Some((job_tx, outcome_rx)) = spawn_filter_analysis_worker() else {
            return; // thread spawn unavailable in this environment; synchronous fallback covers it
        };
        let mut incident = make_event("worker-fixture");
        incident.occurrence = create_second_occurrence_window(NOW - HOUR);
        let corpus = Arc::new(vec![incident]);
        for generation in 1..=3u64 {
            job_tx
                .send(FilterAnalysisJob {
                    generation,
                    corpus: corpus.clone(),
                    indices: vec![0],
                })
                .expect("send job");
        }
        drop(job_tx);
        let mut generations = Vec::new();
        while let Ok(outcome) = outcome_rx.recv() {
            generations.push(outcome.generation);
        }
        // Coalescing means only a subset of generations is ever built, and the final one is
        // always the newest submitted.
        assert_eq!(generations.last().copied(), Some(3));
        assert!(generations.len() <= 3);
    }

    #[test]
    fn day_uncertainty_windows_inside_filtered_scope_remain_uncertainty_intervals() {
        let mut day_event = make_event("day-precision");
        day_event.occurred_at = Some((NOW / DAY).floor() * DAY);
        day_event.occurrence = create_day_occurrence_window(
            day_event.occurred_at.unwrap(),
            IncidentOccurrenceBasis::InferredDay,
        );
        let incidents = vec![day_event];
        let pass = scan(&incidents, &IncidentFilterSpec::default());
        assert_eq!(pass.indices.len(), 1);
        let (analyses, _) = build_analyses_for_indices(&incidents, &pass.indices);
        let analysis = analyses.analysis_for(TemporalResolutionPreference::Auto);
        // The day-precision incident still spans 24 hourly frames inside playback; filtering
        // must never collapse uncertainty into a fabricated exact instant.
        assert!(analysis.coverage.imprecise_count == 1);
    }
}
