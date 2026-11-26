use crate::data::{
    rebuild_incidents, resolve_incident_occurrence_window, Incident, IncidentContradiction,
    IncidentContradictionKind, IncidentCorrelationConfidence, IncidentEvidenceCluster,
    IncidentEvidenceMember, IncidentMembership, IncidentTemporalPrecision, OsintSnapshot,
};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::time::Instant;
use unicode_normalization::UnicodeNormalization;

/// Deterministic, explainable cross-source incident correlation for the native client.
///
/// This is a deliberate Rust port of `frontend/src/lib/incidentCorrelation.ts`. The web engine
/// uses Unix milliseconds while the native normalization layer uses Unix seconds, so all temporal
/// constants are scaled seconds here. Scoring ratios, thresholds, ordering, negative evidence,
/// curated-source rules, chain guarding, contradiction precedence, and provenance semantics mirror
/// the web algorithm. No temporal playback state is built in this module.
pub const CORRELATION_ALGORITHM_VERSION: &str = "incident-correlation-v1";

const X_CELLS: i32 = 360;
const Y_CELLS: i32 = 180;
const MAX_DISTANCE_KM: f64 = 60.0;
const MAX_TIME_GAP_HOURS: f64 = 48.0;
const WINDOW_SCAN_SLACK_SECONDS: f64 = 14.0 * 24.0 * 3600.0;
const FUTURE_TOLERANCE_SECONDS: f64 = 6.0 * 3600.0;
const FULL_SPATIAL_KM: f64 = 10.0;
const ZERO_SPATIAL_KM: f64 = 55.0;
const WEIGHT_SPATIAL: f64 = 0.3;
const WEIGHT_TEMPORAL: f64 = 0.26;
const WEIGHT_TITLE: f64 = 0.2;
const WEIGHT_ACTOR: f64 = 0.14;
const WEIGHT_FATALITY: f64 = 0.1;
const CROSS_SOURCE_THRESHOLD: f64 = 0.6;
const SAME_SOURCE_THRESHOLD: f64 = 0.68;
const DETACH_FLOOR: f64 = 0.45;
const COUNTRY_MISMATCH_PENALTY: f64 = 0.05;
const INCLUSIVE_WINDOW_EPSILON_SECONDS: f64 = 0.001;

const TITLE_STOPWORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "with",
    "after",
    "amid",
    "over",
    "under",
    "into",
    "from",
    "that",
    "this",
    "says",
    "said",
    "say",
    "report",
    "reports",
    "reported",
    "reportedly",
    "claims",
    "claim",
    "claimed",
    "officials",
    "official",
    "video",
    "new",
    "news",
    "update",
    "updates",
    "breaking",
    "live",
    "war",
    "conflict",
    "crisis",
    "town",
    "city",
    "village",
    "district",
    "province",
    "provincial",
    "region",
    "regional",
    "oblast",
    "governorate",
    "municipality",
    "area",
    "north",
    "south",
    "east",
    "west",
    "northern",
    "southern",
    "eastern",
    "western",
    "central",
    "near",
    "across",
    "killed",
    "kills",
    "kill",
    "dead",
    "deaths",
    "death",
    "injured",
    "wounded",
    "people",
    "civilian",
    "civilians",
    "strike",
    "strikes",
    "attack",
    "attacks",
    "hit",
    "hits",
    "shelling",
    "shells",
    "as",
    "at",
    "in",
    "on",
    "of",
    "to",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "a",
    "an",
    "its",
    "it",
    "his",
    "her",
    "their",
    "our",
    "us",
    "we",
    "they",
    "he",
    "she",
];

const ACTOR_STOPWORDS: &[&str] = &[
    "government",
    "forces",
    "force",
    "military",
    "army",
    "armed",
    "group",
    "groups",
    "fighters",
    "fighter",
    "rebels",
    "rebel",
    "militia",
    "militias",
    "troops",
    "troop",
    "soldiers",
    "soldier",
    "police",
    "security",
    "state",
    "national",
    "peoples",
    "people",
    "united",
    "organization",
    "organisation",
    "movement",
    "front",
    "brigade",
    "battalion",
    "corps",
    "guard",
    "guards",
    "defense",
    "defence",
    "ministry",
    "department",
    "agency",
    "committee",
    "council",
    "authority",
    "authorities",
    "administration",
    "regime",
    "pro",
    "anti",
    "backed",
    "allied",
    "affiliated",
    "loyal",
    "opposition",
    "insurgents",
    "insurgent",
    "militants",
    "militant",
    "paramilitary",
    "the",
    "of",
    "and",
    "for",
    "in",
    "on",
    "a",
    "an",
];

fn is_incident_category(category: &str) -> bool {
    matches!(
        category,
        "airstrike"
            | "ground_battle"
            | "missile"
            | "explosion"
            | "terrorism"
            | "assassination"
            | "border_crossing"
            | "organized_violence"
            | "naval"
    )
}

fn haversine_km(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let la1 = lat1.to_radians();
    let la2 = lat2.to_radians();
    let d_lat = la2 - la1;
    let d_lng = (lng2 - lng1).to_radians();
    let h = (d_lat / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (d_lng / 2.0).sin().powi(2);
    6371.0 * 2.0 * h.sqrt().atan2((1.0 - h).sqrt())
}

/// Crude deterministic morphological normalization for similarity evidence only, mirroring the
/// documented web approximation. Source text is never rewritten.
fn stem_token(token: &str) -> String {
    let mut stem = token.to_string();
    if stem.len() > 4 {
        for suffix in ["ian", "an", "ish", "ese", "ist", "ism"] {
            if stem.ends_with(suffix) && stem.len() - suffix.len() >= 3 {
                stem.truncate(stem.len() - suffix.len());
                break;
            }
        }
    }
    while stem.len() > 3 {
        let Some(last) = stem.as_bytes().last().copied() else {
            break;
        };
        if !matches!(last, b'a' | b'e' | b'i' | b'o' | b'u') {
            break;
        }
        stem.pop();
    }
    stem
}

fn push_token_if_significant(raw: &str, stopwords: &[&str], output: &mut BTreeSet<String>) {
    if raw.len() < 3 || raw.bytes().all(|byte| byte.is_ascii_digit()) {
        return;
    }
    if stopwords.contains(&raw) {
        return;
    }
    let stem = stem_token(raw);
    if stem.len() < 3 || stopwords.contains(&stem.as_str()) {
        return;
    }
    output.insert(stem);
}

fn tokenize(text: &str, stopwords: &[&str]) -> BTreeSet<String> {
    let mut tokens = BTreeSet::new();
    let lowercase = text.to_lowercase();
    let normalized: String = lowercase
        .nfd()
        .filter(|character| !('\u{0300}'..='\u{036f}').contains(character))
        .collect();
    let mut current = String::new();
    for character in normalized.chars() {
        if character.is_ascii_alphanumeric() {
            current.push(character);
        } else if !current.is_empty() {
            push_token_if_significant(&current, stopwords, &mut tokens);
            current.clear();
        }
    }
    if !current.is_empty() {
        push_token_if_significant(&current, stopwords, &mut tokens);
    }
    tokens
}

/// Overlap coefficient |intersection| / min(|a|, |b|); None when either set is empty.
fn overlap_coefficient(a: &BTreeSet<String>, b: &BTreeSet<String>) -> Option<f64> {
    if a.is_empty() || b.is_empty() {
        return None;
    }
    let (smaller, larger) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    let intersection = smaller
        .iter()
        .filter(|token| larger.contains(*token))
        .count();
    Some(intersection as f64 / a.len().min(b.len()) as f64)
}

fn format_token_list(tokens: &BTreeSet<String>, cap: usize) -> String {
    tokens
        .iter()
        .take(cap)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ")
}

fn intersect_tokens(a: &BTreeSet<String>, b: &BTreeSet<String>) -> BTreeSet<String> {
    let (smaller, larger) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    smaller
        .iter()
        .filter(|token| larger.contains(*token))
        .cloned()
        .collect()
}

fn is_ucdp_id(id: &str) -> bool {
    id.strip_prefix("ucdp:").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn is_acled_id(id: &str) -> bool {
    let lowercase = id.to_ascii_lowercase();
    let without_mow = lowercase.strip_prefix("mow-").unwrap_or(&lowercase);
    without_mow.starts_with("acled-") || without_mow.starts_with("acled:")
}

/// Resolve publisher family with the same conservative fallback logic as the web algorithm.
pub fn resolve_source_family(event: &Incident) -> String {
    let explicit = event.source_family.trim();
    if !explicit.is_empty() {
        return explicit.to_string();
    }
    if event.ucdp.is_some() || is_ucdp_id(&event.id) {
        return "ucdp".to_string();
    }
    if is_acled_id(&event.id) || event.source_name.as_deref() == Some("ACLED") {
        return "acled".to_string();
    }
    if event.id.starts_with("mow-") || event.source_name.as_deref() == Some("Map of Wars") {
        return "mapofwars".to_string();
    }
    "unknown".to_string()
}

#[derive(Debug)]
pub struct EventFeatures<'a> {
    pub index: usize,
    pub event: &'a Incident,
    pub family: String,
    pub cell_x: i32,
    pub cell_y: i32,
    pub window_start: f64,
    pub window_end: f64,
    pub window_precision: IncidentTemporalPrecision,
    pub title_tokens: BTreeSet<String>,
    pub actor_tokens: BTreeSet<String>,
    pub conflict_tokens: BTreeSet<String>,
    pub country_key: String,
    pub has_direct_actors: bool,
}

fn has_actor_separator(segment: &str) -> bool {
    segment
        .split_whitespace()
        .any(|token| token == "-" || token == "vs" || token == "vs.")
}

fn extract_actor_tokens(event: &Incident) -> (BTreeSet<String>, bool) {
    let mut tokens = BTreeSet::new();
    let mut direct = false;
    if let Some(ucdp) = &event.ucdp {
        for side in [&ucdp.side_a, &ucdp.side_b]
            .into_iter()
            .flatten()
            .filter(|side| !side.is_empty())
        {
            direct = true;
            tokens.extend(tokenize(side, ACTOR_STOPWORDS));
        }
    }
    if let Some(detail) = &event.detail {
        // ACLED rows read "subevent · actor1 vs actor2 · N reported fatalities"; UCDP rows
        // read "†X best (...) · sideA - sideB · violence type".
        for segment in detail.split('·').map(str::trim) {
            if !has_actor_separator(segment) || segment.chars().count() > 240 {
                continue;
            }
            let before = tokens.len();
            tokens.extend(tokenize(segment, ACTOR_STOPWORDS));
            if tokens.len() > before {
                direct = true;
            }
        }
    }
    (tokens, direct)
}

/// Deterministic feature extraction for one normalized record. Public so validation harnesses can
/// inspect pairwise assessments directly, as in the web validation script.
pub fn extract_event_features(event: &Incident, index: usize) -> EventFeatures<'_> {
    let family = resolve_source_family(event);
    let lat = event.lat.clamp(-90.0, 90.0) as f64;
    let lng = event.lng.clamp(-180.0, 180.0) as f64;
    let cell_x = ((lng + 180.0).floor() as i32).rem_euclid(X_CELLS);
    let cell_y = ((lat + 90.0).floor() as i32).clamp(0, Y_CELLS - 1);
    let occurrence = resolve_incident_occurrence_window(event);
    let occurred_at = event.occurred_at.unwrap_or(0.0);
    let window_start = occurrence
        .as_ref()
        .map(|window| window.start)
        .unwrap_or(occurred_at);
    let window_end = occurrence
        .as_ref()
        .map(|window| window.end_exclusive - INCLUSIVE_WINDOW_EPSILON_SECONDS)
        .unwrap_or(occurred_at);
    let (actor_tokens, has_direct_actors) = extract_actor_tokens(event);
    EventFeatures {
        index,
        event,
        family,
        cell_x,
        cell_y,
        window_start,
        window_end,
        window_precision: occurrence
            .as_ref()
            .map(|window| window.precision)
            .unwrap_or(IncidentTemporalPrecision::Second),
        title_tokens: tokenize(&event.title, TITLE_STOPWORDS),
        actor_tokens,
        conflict_tokens: tokenize(&event.conflict, TITLE_STOPWORDS),
        country_key: event.country.trim().to_lowercase(),
        has_direct_actors,
    }
}

// Dimensional fields are diagnostic provenance consumed by validation harnesses; the binary's
// render path uses the compact human-readable rationale, so dead-code analysis cannot see them.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct PairAssessment {
    pub score: f64,
    pub distance_km: f64,
    pub time_gap_hours: f64,
    pub spatial_score: f64,
    pub temporal_score: f64,
    pub title_score: Option<f64>,
    pub actor_score: Option<f64>,
    pub fatality_score: Option<f64>,
    pub cross_family: bool,
    pub country_mismatch: bool,
    pub rationale: Vec<String>,
}

fn time_gap_hours(a: &EventFeatures<'_>, b: &EventFeatures<'_>) -> f64 {
    let gap_seconds = (a.window_start - b.window_end)
        .max(b.window_start - a.window_end)
        .max(0.0);
    gap_seconds / 3600.0
}

fn killed_for_evidence(event: &Incident) -> f64 {
    event.killed.unwrap_or(0.0) as f64
}

fn fatality_evidence(a: &Incident, b: &Incident) -> (Option<f64>, String) {
    let ka = killed_for_evidence(a);
    let kb = killed_for_evidence(b);
    if ka == kb {
        if ka > 0.0 {
            return (Some(1.0), format!("fatalities: both report {} killed", ka));
        }
        return (
            None,
            "fatalities: both report zero — no distinguishing evidence".to_string(),
        );
    }
    if ka > 0.0 && kb > 0.0 {
        let ratio = ka.max(kb) / ka.min(kb);
        let score = if ratio <= 1.25 {
            1.0
        } else if ratio <= 2.0 {
            0.75
        } else if ratio <= 3.0 {
            0.5
        } else if ratio <= 5.0 {
            0.25
        } else {
            0.0
        };
        return (
            Some(score),
            format!("fatalities: {} vs {} killed (ratio {:.1})", ka, kb, ratio),
        );
    }
    let positive = ka.max(kb);
    let score = if positive <= 2.0 { 0.3 } else { 0.15 };
    (
        Some(score),
        format!(
            "fatalities: {} vs {} killed — one record lacks a positive toll",
            ka, kb
        ),
    )
}

/// Compute the full deterministic pairwise assessment. Pure: no clocks and no randomness.
pub fn assess_pair(a: &EventFeatures<'_>, b: &EventFeatures<'_>) -> PairAssessment {
    let mut rationale = Vec::new();
    let distance_km = haversine_km(
        a.event.lat as f64,
        a.event.lng as f64,
        b.event.lat as f64,
        b.event.lng as f64,
    );
    let mut spatial_score = if distance_km <= FULL_SPATIAL_KM {
        1.0
    } else {
        (1.0 - (distance_km - FULL_SPATIAL_KM) / (ZERO_SPATIAL_KM - FULL_SPATIAL_KM)).max(0.0)
    };
    let mut worst_precision = 1;
    let mut saw_precision = false;
    for precision in [a.event.precision, b.event.precision].into_iter().flatten() {
        if precision >= 1 {
            worst_precision = worst_precision.max(precision);
            saw_precision = true;
        }
    }
    if !saw_precision {
        worst_precision = 1;
    }
    let precision_factor = if worst_precision >= 7 {
        0.2
    } else if worst_precision == 6 {
        0.35
    } else if worst_precision == 5 {
        0.6
    } else {
        1.0
    };
    let mut precision_note = String::new();
    if precision_factor < 1.0 {
        spatial_score *= precision_factor;
        precision_note = format!(
            ", discounted ×{} because the coarsest fix is precision {} (centroid proximity is weak evidence)",
            precision_factor, worst_precision
        );
    }
    rationale.push(if distance_km <= FULL_SPATIAL_KM {
        format!(
            "spatial: {:.1} km apart, inside the {} km full-evidence radius{}",
            distance_km, FULL_SPATIAL_KM as i32, precision_note
        )
    } else {
        format!(
            "spatial: {:.1} km apart, evidence decayed toward zero at {} km inside the {} km gate{}",
            distance_km, ZERO_SPATIAL_KM as i32, MAX_DISTANCE_KM as i32, precision_note
        )
    });

    let gap_hours = time_gap_hours(a, b);
    let max_window_hours =
        (a.window_end - a.window_start).max(b.window_end - b.window_start) / 3600.0;
    let mut temporal_score = if gap_hours <= 0.0 {
        1.0
    } else if gap_hours <= 6.0 {
        0.7
    } else if gap_hours <= 12.0 {
        0.55
    } else if gap_hours <= 24.0 {
        0.3
    } else if gap_hours <= 48.0 {
        0.1
    } else {
        0.0
    };
    if temporal_score < 0.6
        && gap_hours > 0.0
        && (a.window_precision != IncidentTemporalPrecision::Second
            || b.window_precision != IncidentTemporalPrecision::Second)
    {
        let day_a = (a.event.occurred_at.unwrap_or(0.0) / 86_400.0).floor();
        let day_b = (b.event.occurred_at.unwrap_or(0.0) / 86_400.0).floor();
        if day_a == day_b {
            temporal_score = 0.6;
        }
    }
    if max_window_hours > 96.0 {
        temporal_score *= (96.0 / max_window_hours).sqrt();
    }
    rationale.push(if gap_hours <= 0.0 {
        format!(
            "temporal: time windows overlap{}",
            if max_window_hours > 96.0 {
                format!(
                    " but span {} days (discounted)",
                    (max_window_hours / 24.0).round() as i32
                )
            } else {
                String::new()
            }
        )
    } else {
        format!(
            "temporal: {:.1} h gap between windows (weak evidence beyond same-day overlap)",
            gap_hours
        )
    });

    let shared_title = intersect_tokens(&a.title_tokens, &b.title_tokens);
    let title_score = overlap_coefficient(&a.title_tokens, &b.title_tokens);
    if let Some(title_score) = title_score {
        rationale.push(if shared_title.is_empty() {
            "title/location: no shared significant tokens".to_string()
        } else {
            format!(
                "title/location: shared tokens {} (overlap {:.2})",
                format_token_list(&shared_title, 4),
                title_score
            )
        });
    }

    let mut actor_score = overlap_coefficient(&a.actor_tokens, &b.actor_tokens);
    let mut actor_note = String::new();
    if let Some(actor_score_value) = actor_score {
        if actor_score_value > 0.0 {
            let shared = intersect_tokens(&a.actor_tokens, &b.actor_tokens);
            actor_note = format!(
                "actors: shared distinctive tokens {}",
                format_token_list(&shared, 4)
            );
        } else {
            actor_note = "actors: no shared distinctive tokens".to_string();
        }
    }
    if actor_score.is_none() && (!a.has_direct_actors || !b.has_direct_actors) {
        if let Some(conflict_similarity) =
            overlap_coefficient(&a.conflict_tokens, &b.conflict_tokens)
        {
            actor_score = Some(conflict_similarity * 0.5);
            actor_note = format!(
                "actors: no direct actor fields; conflict-name proxy overlap {:.2} at half weight",
                conflict_similarity
            );
        }
    }
    if !actor_note.is_empty() {
        rationale.push(actor_note);
    }

    let (fatality_score, fatality_note) = fatality_evidence(a.event, b.event);
    rationale.push(fatality_note);

    // Positive evidence only: structurally absent evidence contributes zero and is never
    // renormalized upward, so thin evidence cannot be inflated into a merge.
    let mut score = WEIGHT_SPATIAL * spatial_score
        + WEIGHT_TEMPORAL * temporal_score
        + WEIGHT_TITLE * title_score.unwrap_or(0.0)
        + WEIGHT_ACTOR * actor_score.unwrap_or(0.0)
        + WEIGHT_FATALITY * fatality_score.unwrap_or(0.0);

    if title_score == Some(0.0) && a.title_tokens.len() >= 3 && b.title_tokens.len() >= 3 {
        score = (score - 0.06).max(0.0);
        rationale.push("title/location: token-rich titles share nothing (-0.06)".to_string());
    }
    if actor_score == Some(0.0)
        && a.has_direct_actors
        && b.has_direct_actors
        && a.actor_tokens.len() >= 2
        && b.actor_tokens.len() >= 2
    {
        score = (score - 0.05).max(0.0);
        rationale.push(
            "actors: both records name actors yet share no distinctive tokens (-0.05)".to_string(),
        );
    }

    let country_mismatch = !a.country_key.is_empty()
        && !b.country_key.is_empty()
        && a.country_key != b.country_key
        && a.country_key != "unknown"
        && b.country_key != "unknown";
    if country_mismatch {
        score = (score - COUNTRY_MISMATCH_PENALTY).max(0.0);
        rationale.push(format!(
            "country mismatch: {} vs {} (-{})",
            a.event.country, b.event.country, COUNTRY_MISMATCH_PENALTY
        ));
    }

    PairAssessment {
        score,
        distance_km,
        time_gap_hours: gap_hours,
        spatial_score,
        temporal_score,
        title_score,
        actor_score,
        fatality_score,
        cross_family: a.family != b.family,
        country_mismatch,
        rationale,
    }
}

#[derive(Debug, Clone)]
pub struct IncidentCorrelationStats {
    pub algorithm_version: String,
    pub input_record_count: usize,
    pub exact_duplicate_record_count: usize,
    pub correlation_eligible_record_count: usize,
    pub ineligible_record_count: usize,
    pub incident_count: usize,
    pub multi_member_cluster_count: usize,
    pub correlated_evidence_record_count: usize,
    pub contested_cluster_count: usize,
    pub corroborated_cluster_count: usize,
    pub inferred_cluster_count: usize,
    pub single_source_cluster_count: usize,
    pub candidate_pair_count: usize,
    pub evaluated_pair_count: usize,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone)]
pub struct CorrelationResult {
    pub incidents: Vec<Incident>,
    pub stats: IncidentCorrelationStats,
}

fn is_correlatable(event: &Incident, now: f64) -> bool {
    if !is_incident_category(&event.category) {
        return false;
    }
    let Some(occurred_at) = event.occurred_at else {
        return false;
    };
    if !occurred_at.is_finite() || occurred_at <= 0.0 {
        return false;
    }
    occurred_at <= now + FUTURE_TOLERANCE_SECONDS
}

fn canonical_quality(event: &Incident) -> f64 {
    let precision_boost = event
        .precision
        .map(|precision| ((7 - precision.clamp(1, 7)) as f64 / 7.0) * 0.05)
        .unwrap_or(0.0);
    event.intensity as f64
        + if event.verified { 0.08 } else { 0.0 }
        + if event.ucdp.is_some() { 0.06 } else { 0.0 }
        + precision_boost
        + event.sources.len().min(3) as f64 * 0.01
}

fn confidence_reason(
    confidence: IncidentCorrelationConfidence,
    families: &BTreeSet<String>,
    member_count: usize,
    contradictions: &[IncidentContradiction],
) -> String {
    let family_list = families.iter().cloned().collect::<Vec<_>>().join(", ");
    match confidence {
        IncidentCorrelationConfidence::Corroborated => format!(
            "{} independent source families ({}) report consistent evidence for one incident",
            families.len(),
            family_list
        ),
        IncidentCorrelationConfidence::Contested => format!(
            "linked reports materially disagree ({}); contradictions are preserved, not resolved",
            contradictions
                .iter()
                .map(|item| item.kind.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        IncidentCorrelationConfidence::Inferred => format!(
            "{} linked reports all come from one source family ({}); the grouping is inferred duplicate reporting, not independent corroboration",
            member_count,
            family_list
        ),
        IncidentCorrelationConfidence::SingleSource => {
            "no additional report met the deterministic correlation threshold; absence of corroboration is a coverage statement, not a dismissal".to_string()
        }
    }
}

fn make_singleton(feature: &EventFeatures<'_>, note: &str) -> Incident {
    let cluster_id = format!("inc:{}", feature.event.id);
    let mut output = feature.event.clone();
    output.evidence = None;
    output.incident = Some(IncidentMembership {
        cluster_id: cluster_id.clone(),
        canonical_event_id: feature.event.id.clone(),
        is_canonical: true,
        correlation_score: 1.0,
        confidence: IncidentCorrelationConfidence::SingleSource,
        member_count: 1,
        independent_family_count: 1,
        rationale: vec![note.to_string()],
    });
    output
}

fn find_parent(parent: &mut [usize], value: usize) -> usize {
    let mut root = value;
    while parent[root] != root {
        root = parent[root];
    }
    let mut node = value;
    while parent[node] != node {
        let next = parent[node];
        parent[node] = root;
        node = next;
    }
    root
}

fn union_parent(parent: &mut [usize], a: usize, b: usize) {
    let ra = find_parent(parent, a);
    let rb = find_parent(parent, b);
    if ra == rb {
        return;
    }
    if ra < rb {
        parent[rb] = ra;
    } else {
        parent[ra] = rb;
    }
}

fn assess_candidate(a: &EventFeatures<'_>, b: &EventFeatures<'_>) -> Option<PairAssessment> {
    // Curated datasets never self-merge: rows within UCDP or within ACLED are independent coded
    // events by definition regardless of textual or spatial similarity.
    if a.family == b.family && matches!(a.family.as_str(), "ucdp" | "acled") {
        return None;
    }
    let assessment = assess_pair(a, b);
    if assessment.distance_km > MAX_DISTANCE_KM || assessment.time_gap_hours > MAX_TIME_GAP_HOURS {
        return None;
    }
    let both_known_distinct =
        a.family != b.family && a.family != "unknown" && b.family != "unknown";
    let threshold = if both_known_distinct {
        CROSS_SOURCE_THRESHOLD
    } else {
        SAME_SOURCE_THRESHOLD
    };
    (assessment.score >= threshold).then_some(assessment)
}

fn lower_bound_occurrence(list: &[usize], features: &[EventFeatures<'_>], minimum: f64) -> usize {
    let mut low = 0usize;
    let mut high = list.len();
    while low < high {
        let middle = (low + high) / 2;
        if features[list[middle]].event.occurred_at.unwrap_or(0.0) < minimum {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

fn sort_incidents_output(incidents: &mut [Incident]) {
    incidents.sort_by(|a, b| {
        b.occurred_at
            .unwrap_or(0.0)
            .total_cmp(&a.occurred_at.unwrap_or(0.0))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Deterministic native correlation over normalized incident records.
///
/// Every input record either becomes a singleton canonical incident or is retained in full inside
/// a multi-member evidence cluster. The only collapse is exact re-ingestion of the same id, and it
/// is counted openly in the audit statistics.
pub fn correlate_incidents(input: Vec<Incident>, now: f64) -> CorrelationResult {
    let started = Instant::now();

    // Deterministic input ordering: id ascending, then freshest revision first so exact-id
    // collapse keeps the most recently updated version of a re-ingested record.
    let mut ordered = input;
    let input_record_count = ordered.len();
    ordered.sort_by(|a, b| {
        a.id.cmp(&b.id)
            .then_with(|| {
                b.updated_at
                    .unwrap_or(0.0)
                    .total_cmp(&a.updated_at.unwrap_or(0.0))
            })
            .then_with(|| {
                b.occurred_at
                    .unwrap_or(0.0)
                    .total_cmp(&a.occurred_at.unwrap_or(0.0))
            })
    });

    let mut seen_ids = HashSet::new();
    let mut unique = Vec::new();
    let mut exact_duplicate_record_count = 0usize;
    for event in ordered {
        if !seen_ids.insert(event.id.clone()) {
            exact_duplicate_record_count += 1;
            continue;
        }
        unique.push(event);
    }

    let features: Vec<EventFeatures<'_>> = unique
        .iter()
        .enumerate()
        .map(|(index, event)| extract_event_features(event, index))
        .collect();
    let mut eligible = Vec::new();
    let mut passthrough = Vec::new();
    for feature in &features {
        if is_correlatable(feature.event, now) {
            eligible.push(feature.index);
        } else {
            passthrough.push(feature.index);
        }
    }

    // Uniform 1°x1° spherical grid with a 3x3 neighborhood. Time-sorted sliding-window scans
    // avoid the naive quadratic all-pairs scan while retaining the web gates and thresholds.
    let mut cells: BTreeMap<(i32, i32), Vec<usize>> = BTreeMap::new();
    for feature_index in &eligible {
        let feature = &features[*feature_index];
        cells
            .entry((feature.cell_x, feature.cell_y))
            .or_default()
            .push(*feature_index);
    }
    for list in cells.values_mut() {
        list.sort_by(|a, b| {
            let left = &features[*a];
            let right = &features[*b];
            left.event
                .occurred_at
                .unwrap_or(0.0)
                .total_cmp(&right.event.occurred_at.unwrap_or(0.0))
                .then_with(|| left.event.id.cmp(&right.event.id))
        });
    }

    struct AcceptedPair {
        a: usize,
        b: usize,
        assessment: PairAssessment,
    }

    let mut accepted_pairs = Vec::new();
    let mut candidate_pair_count = 0usize;
    let mut evaluated_pair_count = 0usize;
    let scan_slack_seconds = MAX_TIME_GAP_HOURS * 3600.0 + WINDOW_SCAN_SLACK_SECONDS;

    let cell_keys: Vec<(i32, i32)> = cells.keys().copied().collect();
    for key_a in cell_keys {
        let Some(list_a) = cells.get(&key_a) else {
            continue;
        };
        for dx in -1..=1 {
            for dy in -1..=1 {
                let x_b = (key_a.0 + dx).rem_euclid(X_CELLS);
                let y_b = key_a.1 + dy;
                if !(0..Y_CELLS).contains(&y_b) {
                    continue;
                }
                let key_b = (x_b, y_b);
                if key_b < key_a {
                    continue;
                }
                let Some(list_b) = cells.get(&key_b) else {
                    continue;
                };
                let same_cell = key_a == key_b;
                for feature_a_index in list_a {
                    let feature_a = &features[*feature_a_index];
                    let occurred = feature_a.event.occurred_at.unwrap_or(0.0);
                    let a_min = occurred - scan_slack_seconds;
                    let a_max = occurred + scan_slack_seconds;
                    let start = lower_bound_occurrence(list_b, &features, a_min);
                    for feature_b_index in list_b.iter().skip(start) {
                        let feature_b = &features[*feature_b_index];
                        if feature_b.event.occurred_at.unwrap_or(0.0) > a_max {
                            break;
                        }
                        if same_cell && feature_b.index <= feature_a.index {
                            continue;
                        }
                        candidate_pair_count += 1;
                        evaluated_pair_count += 1;
                        if let Some(assessment) = assess_candidate(feature_a, feature_b) {
                            accepted_pairs.push(AcceptedPair {
                                a: feature_a.index,
                                b: feature_b.index,
                                assessment,
                            });
                        }
                    }
                }
            }
        }
    }

    // Deterministic single-linkage union-find over accepted pairs, strongest evidence first.
    let mut parent: Vec<usize> = (0..features.len()).collect();
    accepted_pairs.sort_by(|pair, other| {
        other
            .assessment
            .score
            .total_cmp(&pair.assessment.score)
            .then_with(|| features[pair.a].event.id.cmp(&features[other.a].event.id))
            .then_with(|| features[pair.b].event.id.cmp(&features[other.b].event.id))
    });
    for pair in &accepted_pairs {
        union_parent(&mut parent, pair.a, pair.b);
    }

    let mut cluster_map: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for feature_index in &eligible {
        let root = find_parent(&mut parent, *feature_index);
        cluster_map.entry(root).or_default().push(*feature_index);
    }

    let mut incidents = Vec::new();
    let mut contested_cluster_count = 0usize;
    let mut corroborated_cluster_count = 0usize;
    let mut inferred_cluster_count = 0usize;
    let mut single_source_cluster_count = 0usize;
    let mut multi_member_cluster_count = 0usize;
    let mut correlated_evidence_record_count = 0usize;

    let mut clusters: Vec<Vec<usize>> = cluster_map.into_values().collect();
    clusters.sort_by_key(|members| {
        members
            .iter()
            .map(|index| features[*index].index)
            .min()
            .unwrap_or(usize::MAX)
    });

    for members in clusters {
        // Canonical representative: highest quality, then most recent, then lowest id.
        let mut ranked = members.clone();
        ranked.sort_by(|a, b| {
            canonical_quality(features[*b].event)
                .total_cmp(&canonical_quality(features[*a].event))
                .then_with(|| {
                    features[*b]
                        .event
                        .occurred_at
                        .unwrap_or(0.0)
                        .total_cmp(&features[*a].event.occurred_at.unwrap_or(0.0))
                })
                .then_with(|| features[*a].event.id.cmp(&features[*b].event.id))
        });
        let canonical = ranked[0];

        if ranked.len() == 1 {
            incidents.push(make_singleton(
                &features[canonical],
                "no additional report met the deterministic correlation threshold",
            ));
            single_source_cluster_count += 1;
            continue;
        }

        // Chain guard: each member must itself resemble the canonical representative. Detached
        // reports are never deleted; they re-emerge as visible independent singletons.
        let mut retained = vec![canonical];
        let mut detached = Vec::new();
        let mut member_assessments: BTreeMap<usize, PairAssessment> = BTreeMap::new();
        for member in ranked.iter().skip(1) {
            let assessment = assess_pair(&features[*member], &features[canonical]);
            member_assessments.insert(*member, assessment.clone());
            let gates_ok = assessment.distance_km <= MAX_DISTANCE_KM
                && assessment.time_gap_hours <= MAX_TIME_GAP_HOURS;
            if assessment.score >= DETACH_FLOOR && gates_ok {
                retained.push(*member);
            } else {
                detached.push(*member);
            }
        }
        for feature_index in detached {
            incidents.push(make_singleton(
                &features[feature_index],
                "detached from a correlated cluster: pairwise evidence against the canonical record fell below the chain-guard floor, so the report is presented independently rather than absorbed",
            ));
            single_source_cluster_count += 1;
        }

        if retained.len() == 1 {
            incidents.push(make_singleton(
                &features[canonical],
                "no additional report met the deterministic correlation threshold",
            ));
            single_source_cluster_count += 1;
            continue;
        }

        multi_member_cluster_count += 1;
        correlated_evidence_record_count += retained.len() - 1;

        // Contradiction detection across retained members, canonical included.
        let all_records = retained;
        let mut contradictions = Vec::new();

        let positive_tolls: Vec<usize> = all_records
            .iter()
            .copied()
            .filter(|feature_index| killed_for_evidence(features[*feature_index].event) > 0.0)
            .collect();
        if positive_tolls.len() >= 2 {
            let mut min_toll = f64::INFINITY;
            let mut max_toll = 0.0f64;
            for feature_index in &positive_tolls {
                let toll = killed_for_evidence(features[*feature_index].event);
                min_toll = min_toll.min(toll);
                max_toll = max_toll.max(toll);
            }
            if min_toll.is_finite() && min_toll > 0.0 && max_toll >= 3.0 * min_toll {
                let low_record = positive_tolls
                    .iter()
                    .find(|feature_index| {
                        killed_for_evidence(features[**feature_index].event) == min_toll
                    })
                    .copied();
                let high_record = positive_tolls
                    .iter()
                    .find(|feature_index| {
                        killed_for_evidence(features[**feature_index].event) == max_toll
                    })
                    .copied();
                let low_family = low_record
                    .map(|index| features[index].family.as_str())
                    .unwrap_or("unknown source");
                let high_family = high_record
                    .map(|index| features[index].family.as_str())
                    .unwrap_or("unknown source");
                let mut member_event_ids: Vec<String> = positive_tolls
                    .iter()
                    .map(|index| features[*index].event.id.clone())
                    .collect();
                member_event_ids.sort();
                contradictions.push(IncidentContradiction {
                    kind: IncidentContradictionKind::Fatalities,
                    summary: format!(
                        "reported fatalities range from {} ({}) to {} ({}) — a {:.1}x spread across linked reports",
                        min_toll, low_family, max_toll, high_family, max_toll / min_toll
                    ),
                    member_event_ids,
                });
            }
        }

        let mut actor_disputes = Vec::new();
        for member in all_records.iter().skip(1) {
            if features[canonical].actor_tokens.len() >= 2
                && features[*member].actor_tokens.len() >= 2
            {
                let shared = intersect_tokens(
                    &features[canonical].actor_tokens,
                    &features[*member].actor_tokens,
                );
                if shared.is_empty() {
                    actor_disputes.push(features[*member].event.id.clone());
                }
            }
        }
        if !actor_disputes.is_empty() {
            let mut member_event_ids = vec![features[canonical].event.id.clone()];
            member_event_ids.extend(actor_disputes.iter().cloned());
            member_event_ids.sort();
            contradictions.push(IncidentContradiction {
                kind: IncidentContradictionKind::Actors,
                summary: format!(
                    "{} linked report{} share no distinctive actor tokens with the canonical record ({})",
                    actor_disputes.len(),
                    if actor_disputes.len() == 1 { "" } else { "s" },
                    format_token_list(&features[canonical].actor_tokens, 4)
                ),
                member_event_ids,
            });
        }

        let mut max_spread_km = 0.0f64;
        for (left_offset, left_index) in all_records.iter().enumerate() {
            for right_index in all_records.iter().skip(left_offset + 1) {
                let left = features[*left_index].event;
                let right = features[*right_index].event;
                let distance = haversine_km(
                    left.lat as f64,
                    left.lng as f64,
                    right.lat as f64,
                    right.lng as f64,
                );
                max_spread_km = max_spread_km.max(distance);
            }
        }
        if max_spread_km > 40.0 {
            let mut member_event_ids: Vec<String> = all_records
                .iter()
                .map(|index| features[*index].event.id.clone())
                .collect();
            member_event_ids.sort();
            contradictions.push(IncidentContradiction {
                kind: IncidentContradictionKind::Location,
                summary: format!(
                    "linked reports span {:.0} km; the fusion of distant fixes may chain distinct incidents",
                    max_spread_km
                ),
                member_event_ids,
            });
        }

        let mut family_set = BTreeSet::new();
        for feature_index in &all_records {
            if features[*feature_index].family != "unknown" {
                family_set.insert(features[*feature_index].family.clone());
            }
        }
        let independent_family_count = family_set.len().max(1);

        let confidence = if !contradictions.is_empty() {
            IncidentCorrelationConfidence::Contested
        } else if independent_family_count >= 2 {
            IncidentCorrelationConfidence::Corroborated
        } else {
            IncidentCorrelationConfidence::Inferred
        };
        match confidence {
            IncidentCorrelationConfidence::Contested => contested_cluster_count += 1,
            IncidentCorrelationConfidence::Corroborated => corroborated_cluster_count += 1,
            IncidentCorrelationConfidence::Inferred => inferred_cluster_count += 1,
            IncidentCorrelationConfidence::SingleSource => {}
        }

        let cluster_id = format!("inc:{}", features[canonical].event.id);
        let mut members_sorted = all_records.clone();
        members_sorted.sort_by(|a, b| {
            if *a == canonical {
                return std::cmp::Ordering::Less;
            }
            if *b == canonical {
                return std::cmp::Ordering::Greater;
            }
            let score_a = member_assessments
                .get(a)
                .map(|assessment| assessment.score)
                .unwrap_or(0.0);
            let score_b = member_assessments
                .get(b)
                .map(|assessment| assessment.score)
                .unwrap_or(0.0);
            score_b
                .total_cmp(&score_a)
                .then_with(|| features[*a].event.id.cmp(&features[*b].event.id))
        });

        let mut evidence_members = Vec::new();
        for feature_index in members_sorted
            .iter()
            .copied()
            .filter(|feature_index| *feature_index != canonical)
        {
            let assessment = member_assessments.get(&feature_index);
            let score = assessment.map(|value| value.score).unwrap_or(0.0);
            let rationale = assessment
                .map(|value| value.rationale.clone())
                .unwrap_or_default();
            let mut member_event = features[feature_index].event.clone();
            member_event.evidence = None;
            member_event.incident = Some(IncidentMembership {
                cluster_id: cluster_id.clone(),
                canonical_event_id: features[canonical].event.id.clone(),
                is_canonical: false,
                correlation_score: score,
                confidence,
                member_count: all_records.len(),
                independent_family_count,
                rationale: rationale.clone(),
            });
            evidence_members.push(IncidentEvidenceMember {
                event: member_event,
                source_family: features[feature_index].family.clone(),
                correlation_score: score,
                rationale,
            });
        }

        let mut canonical_incident = features[canonical].event.clone();
        canonical_incident.incident = Some(IncidentMembership {
            cluster_id: cluster_id.clone(),
            canonical_event_id: features[canonical].event.id.clone(),
            is_canonical: true,
            correlation_score: 1.0,
            confidence,
            member_count: all_records.len(),
            independent_family_count,
            rationale: vec![format!(
                "selected as canonical representative: highest deterministic quality score among {} linked reports",
                all_records.len()
            )],
        });
        canonical_incident.evidence = Some(IncidentEvidenceCluster {
            cluster_id: cluster_id.clone(),
            canonical_event_id: features[canonical].event.id.clone(),
            algorithm_version: CORRELATION_ALGORITHM_VERSION.to_string(),
            confidence,
            confidence_reason: confidence_reason(
                confidence,
                &family_set,
                all_records.len(),
                &contradictions,
            ),
            source_families: family_set.iter().cloned().collect(),
            independent_family_count,
            member_count: all_records.len(),
            contradictions,
            members: evidence_members,
        });
        incidents.push(canonical_incident);
    }

    // Pass-through singletons: non-incident categories, invalid/missing times, and future-dated
    // rows. They are never merged, but they are never hidden either.
    for feature_index in &passthrough {
        let feature = &features[*feature_index];
        let future_dated = feature
            .event
            .occurred_at
            .is_some_and(|timestamp| timestamp > now + FUTURE_TOLERANCE_SECONDS);
        incidents.push(make_singleton(
            feature,
            if future_dated {
                "future-dated record: not eligible for incident correlation (launches and announced events are never merged)"
            } else {
                "non-incident category: not eligible for incident correlation; presented as an independent record"
            },
        ));
        single_source_cluster_count += 1;
    }

    sort_incidents_output(&mut incidents);

    let elapsed_ms = ((started.elapsed().as_secs_f64() * 1000.0) * 100.0).round() / 100.0;
    let stats = IncidentCorrelationStats {
        algorithm_version: CORRELATION_ALGORITHM_VERSION.to_string(),
        input_record_count,
        exact_duplicate_record_count,
        correlation_eligible_record_count: eligible.len(),
        ineligible_record_count: passthrough.len(),
        incident_count: incidents.len(),
        multi_member_cluster_count,
        correlated_evidence_record_count,
        contested_cluster_count,
        corroborated_cluster_count,
        inferred_cluster_count,
        single_source_cluster_count,
        candidate_pair_count,
        evaluated_pair_count,
        elapsed_ms,
    };

    CorrelationResult { incidents, stats }
}

/// Correlate the native loaded conflict layers: embedded WarHeatMap fallback records plus
/// normalized Map-of-Wars/UCDP/ACLED lattice rows.
pub fn correlate_loaded_incidents(
    fallback_incidents: &[Incident],
    osint: &OsintSnapshot,
    now: f64,
) -> CorrelationResult {
    correlate_incidents(rebuild_incidents(fallback_incidents, osint), now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::{
        create_second_occurrence_window, load_embedded, ConflictSource, IncidentOccurrenceWindow,
    };

    const NOW: f64 = 1_795_176_000.0; // 2026-11-20T12:00:00Z, fixed for deterministic tests
    const DAY: f64 = 86_400.0;
    const NOV19_NOON: f64 = 1_795_089_600.0;
    const NOV19_MIDNIGHT: f64 = 1_795_046_400.0;

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
            source_family: String::new(),
            intensity: 0.5,
            // Most legacy fixtures deliberately omit the explicit interval, matching the web
            // harness. Midnight rows therefore exercise the conservative inferred-day fallback.
            occurrence: None,
            ucdp: None,
            incident: None,
            evidence: None,
        }
    }

    fn set_time(event: &mut Incident, timestamp: f64) {
        event.occurred_at = Some(timestamp);
        event.updated_at = Some(timestamp);
        event.occurrence = None;
    }

    fn canonical_for<'a>(result: &'a CorrelationResult, event_id: &str) -> Option<&'a Incident> {
        result.incidents.iter().find(|incident| {
            incident.id == event_id
                || incident.evidence.as_ref().is_some_and(|evidence| {
                    evidence
                        .members
                        .iter()
                        .any(|member| member.event.id == event_id)
                })
        })
    }

    fn output_signature(result: &CorrelationResult) -> Vec<String> {
        let mut rows: Vec<String> = result
            .incidents
            .iter()
            .map(|incident| {
                let membership = incident.incident.as_ref();
                let mut members: Vec<String> = incident
                    .evidence
                    .as_ref()
                    .map(|evidence| {
                        evidence
                            .members
                            .iter()
                            .map(|member| member.event.id.clone())
                            .collect()
                    })
                    .unwrap_or_default();
                members.sort();
                format!(
                    "{}|{}|{}|{}",
                    incident.id,
                    membership
                        .map(|value| value.confidence.as_str())
                        .unwrap_or("none"),
                    membership.map(|value| value.member_count).unwrap_or(0),
                    members.join("+")
                )
            })
            .collect();
        rows.sort();
        rows
    }

    #[test]
    fn cross_source_duplicate_strike_clusters_and_explains_evidence() {
        let mut whm = make_event("whm-aaaa1111");
        whm.lat = 49.9935;
        whm.lng = 36.2304;
        whm.title = "Russian missile strike hits Kharkiv industrial plant".to_string();
        whm.category = "missile".to_string();
        whm.killed = Some(6.0);
        whm.casualties = Some(9.0);
        set_time(&mut whm, NOV19_NOON);
        whm.verified = true;
        whm.source_family = "warheatmap".to_string();
        whm.sources = vec![ConflictSource {
            name: Some("Suspilne".to_string()),
            url: Some("https://example.test/1".to_string()),
        }];
        whm.intensity = 0.72;

        let mut ucdp = make_event("ucdp:900001");
        ucdp.lat = 49.9935 + 0.02;
        ucdp.lng = 36.2304 + 0.015;
        ucdp.title = "Kharkiv, Ukraine".to_string();
        ucdp.detail =
            Some("†6 · Government of Russia (Soviet Union) - Government of Ukraine".to_string());
        ucdp.category = "organized_violence".to_string();
        ucdp.killed = Some(6.0);
        ucdp.casualties = Some(6.0);
        set_time(&mut ucdp, NOV19_MIDNIGHT);
        ucdp.verified = true;
        ucdp.source_name = Some("UCDP".to_string());
        ucdp.source_family = "ucdp".to_string();
        ucdp.intensity = 0.6;

        let mut acled = make_event("mow-acled-UKR22119");
        acled.lat = 49.9935 - 0.01;
        acled.lng = 36.2304 - 0.02;
        acled.title = "Explosions/Remote violence — Kharkiv".to_string();
        acled.detail = Some("Shelling/artillery/missile attack · Military Forces of Russia vs Military Forces of Ukraine · 7 reported fatalities".to_string());
        acled.category = "ground_battle".to_string();
        acled.killed = Some(7.0);
        acled.casualties = Some(7.0);
        set_time(&mut acled, NOV19_MIDNIGHT);
        acled.source_name = Some("ACLED".to_string());
        acled.source_family = "acled".to_string();
        acled.intensity = 0.58;

        let pair_ucdp = extract_event_features(&ucdp, 0);
        let pair_acled = extract_event_features(&acled, 1);
        assert!(assess_pair(&pair_ucdp, &pair_acled).score >= 0.6);

        let result = correlate_incidents(vec![whm, ucdp, acled], NOW);
        assert_eq!(result.incidents.len(), 1, "{:#?}", result.stats);
        let incident = &result.incidents[0];
        let membership = incident.incident.as_ref().expect("membership");
        assert_eq!(
            membership.confidence,
            IncidentCorrelationConfidence::Corroborated
        );
        assert_eq!(membership.independent_family_count, 3);
        let evidence = incident.evidence.as_ref().expect("evidence cluster");
        assert_eq!(evidence.members.len(), 2);
        assert_eq!(evidence.member_count, 3);
        assert!(evidence.contradictions.is_empty());
        let member = &evidence.members[0];
        assert!(member.rationale.len() >= 3);
        assert!(member
            .rationale
            .iter()
            .any(|line| line.starts_with("spatial:")));
        assert!(member
            .rationale
            .iter()
            .any(|line| line.starts_with("temporal:")));
    }

    #[test]
    fn independent_records_and_ineligible_rows_stay_visible_without_merging() {
        let mut u1 = make_event("ucdp:111");
        u1.lat = 48.0;
        u1.lng = 37.0;
        u1.title = "Avdiivka, Ukraine".to_string();
        u1.category = "organized_violence".to_string();
        u1.killed = Some(3.0);
        u1.detail =
            Some("†3 · Government of Russia (Soviet Union) - Government of Ukraine".to_string());
        u1.source_family = "ucdp".to_string();
        set_time(&mut u1, NOV19_MIDNIGHT);
        let mut u2 = u1.clone();
        u2.id = "ucdp:222".to_string();
        u2.lat = 48.005;
        u2.lng = 37.004;
        let curated = correlate_incidents(vec![u1, u2], NOW);
        assert_eq!(curated.incidents.len(), 2);

        let mut d1 = make_event("whm-day1");
        d1.lat = 48.0;
        d1.lng = 37.0;
        d1.title = "Airstrike hits Avdiivka positions".to_string();
        d1.source_family = "warheatmap".to_string();
        set_time(&mut d1, NOV19_NOON);
        let mut d2 = d1.clone();
        d2.id = "whm-day2".to_string();
        d2.lat = 48.001;
        d2.lng = 37.002;
        d2.title = "Airstrike hits Avdiivka positions again".to_string();
        set_time(&mut d2, NOV19_NOON + 3.0 * DAY);
        let distant_days = correlate_incidents(vec![d1, d2], NOW + 4.0 * DAY);
        assert_eq!(distant_days.incidents.len(), 2);

        let mut f1 = make_event("whm-far1");
        f1.lat = 48.0;
        f1.lng = 37.0;
        f1.title = "Airstrike hits Avdiivka".to_string();
        f1.source_family = "warheatmap".to_string();
        set_time(&mut f1, NOV19_NOON);
        let mut f2 = f1.clone();
        f2.id = "whm-far2".to_string();
        f2.lat = 49.8;
        f2.lng = 37.2;
        let distant_space = correlate_incidents(vec![f1, f2], NOW);
        assert_eq!(distant_space.incidents.len(), 2);

        let mut n1 = make_event("whm-diplo1");
        n1.category = "diplomacy".to_string();
        n1.title = "Ceasefire talks in Geneva".to_string();
        n1.source_family = "warheatmap".to_string();
        let mut n2 = n1.clone();
        n2.id = "ucdp-ish-diplo".to_string();
        n2.source_family = "ucdp".to_string();
        let non_incidents = correlate_incidents(vec![n1, n2], NOW);
        assert_eq!(non_incidents.incidents.len(), 2);

        let mut fut1 = make_event("future-1");
        fut1.title = "Anticipated strike package".to_string();
        fut1.source_family = "warheatmap".to_string();
        set_time(&mut fut1, NOW + 5.0 * DAY);
        let mut fut2 = fut1.clone();
        fut2.id = "future-2".to_string();
        fut2.source_family = "ucdp".to_string();
        let future = correlate_incidents(vec![fut1, fut2], NOW);
        assert_eq!(future.incidents.len(), 2);
        assert_eq!(future.stats.ineligible_record_count, 2);

        let mut t1 = make_event("whm-tanker-1");
        t1.lat = 26.45;
        t1.lng = 56.2;
        t1.precision = Some(7);
        t1.category = "naval".to_string();
        t1.title = "Tanker hit in Strait of Hormuz".to_string();
        t1.country = "Iran".to_string();
        t1.conflict = "Iran-US confrontation".to_string();
        t1.source_family = "warheatmap".to_string();
        set_time(&mut t1, NOV19_NOON);
        let mut t2 = t1.clone();
        t2.id = "whm-tanker-2".to_string();
        t2.title = "Second tanker reported hit in Strait of Hormuz".to_string();
        set_time(&mut t2, NOV19_NOON + 20.0 * 3600.0);
        let offshore = correlate_incidents(vec![t1, t2], NOW + 2.0 * DAY);
        assert_eq!(offshore.incidents.len(), 2);

        let mut p1 = make_event("whm-prec-1");
        p1.lat = 48.0;
        p1.lng = 37.0;
        p1.precision = Some(2);
        p1.title = "Airstrike hits Avdiivka depot".to_string();
        p1.killed = Some(4.0);
        p1.source_family = "warheatmap".to_string();
        set_time(&mut p1, NOV19_NOON);
        let mut p2 = make_event("ucdp:prec-2");
        p2.lat = 48.004;
        p2.lng = 37.003;
        p2.precision = Some(2);
        p2.title = "Avdiivka, Ukraine".to_string();
        p2.category = "organized_violence".to_string();
        p2.killed = Some(4.0);
        p2.detail =
            Some("†4 · Government of Russia (Soviet Union) - Government of Ukraine".to_string());
        p2.source_family = "ucdp".to_string();
        set_time(&mut p2, NOV19_MIDNIGHT);
        let town_precision = correlate_incidents(vec![p1, p2], NOW);
        assert_eq!(town_precision.incidents.len(), 1);
    }

    #[test]
    fn same_family_duplicate_reporting_is_inferred_not_corroborated() {
        let mut r1 = make_event("whm-qeshm-1");
        r1.lat = 26.95;
        r1.lng = 56.27;
        r1.title = "Explosions reported on Qeshm Island amid US blockade measures".to_string();
        r1.category = "explosion".to_string();
        r1.country = "Iran".to_string();
        r1.conflict = "Iran-US confrontation".to_string();
        r1.theater = "iran-us-confrontation".to_string();
        r1.source_family = "warheatmap".to_string();
        r1.intensity = 0.5;
        set_time(&mut r1, NOV19_NOON);
        let mut r2 = r1.clone();
        r2.id = "whm-qeshm-2".to_string();
        r2.lat = 26.96;
        r2.lng = 56.28;
        r2.title = "Explosions hit Qeshm island and Hormuz".to_string();
        r2.intensity = 0.55;
        set_time(&mut r2, NOV19_NOON + 2.0 * 3600.0);
        let result = correlate_incidents(vec![r1, r2], NOW);
        assert_eq!(result.incidents.len(), 1);
        assert_eq!(
            result.incidents[0]
                .incident
                .as_ref()
                .map(|membership| membership.confidence),
            Some(IncidentCorrelationConfidence::Inferred)
        );
    }

    #[test]
    fn contradictory_tolls_are_contested_and_preserved() {
        let mut whm = make_event("whm-toll-low");
        whm.lat = 33.5;
        whm.lng = 36.3;
        whm.title = "Airstrike hits Damascus suburb".to_string();
        whm.country = "Syria".to_string();
        whm.conflict = "Syrian conflict".to_string();
        whm.theater = "syrian-conflict".to_string();
        whm.killed = Some(2.0);
        whm.source_family = "warheatmap".to_string();
        whm.intensity = 0.6;
        set_time(&mut whm, NOV19_NOON);

        let mut acled = make_event("mow-acled-SYR991");
        acled.lat = 33.51;
        acled.lng = 36.31;
        acled.title = "Explosions/Remote violence — Damascus".to_string();
        acled.category = "ground_battle".to_string();
        acled.detail = Some("Shelling/artillery/missile attack · Military Forces of Syria vs Opposition forces · 30 reported fatalities".to_string());
        acled.country = "Syria".to_string();
        acled.conflict = "Syrian conflict".to_string();
        acled.theater = "syrian-conflict".to_string();
        acled.killed = Some(30.0);
        acled.source_name = Some("ACLED".to_string());
        acled.source_family = "acled".to_string();
        acled.intensity = 0.7;
        set_time(&mut acled, NOV19_MIDNIGHT);

        let result = correlate_incidents(vec![whm, acled], NOW);
        assert_eq!(result.incidents.len(), 1, "{:#?}", result.stats);
        let incident = &result.incidents[0];
        assert_eq!(
            incident.incident.as_ref().map(|value| value.confidence),
            Some(IncidentCorrelationConfidence::Contested)
        );
        let evidence = incident.evidence.as_ref().expect("evidence");
        assert!(evidence.contradictions.iter().any(|contradiction| {
            contradiction.kind == IncidentContradictionKind::Fatalities
                && contradiction.member_event_ids.len() == 2
        }));
        assert_eq!(evidence.members.len(), 1);
    }

    #[test]
    fn actor_disputes_are_contested_even_when_spatiotemporal_evidence_links_reports() {
        let mut first = make_event("whm-actor-a");
        first.lat = 35.0;
        first.lng = 38.0;
        first.title = "Strike hits convoy near Deir Zor".to_string();
        first.detail = Some(
            "shelling · zarkan alpha forces vs birman beta militia · 4 reported fatalities"
                .to_string(),
        );
        first.killed = Some(4.0);
        first.country = "Syria".to_string();
        first.conflict = "Syrian conflict".to_string();
        first.source_family = "warheatmap".to_string();
        first.intensity = 0.8;
        set_time(&mut first, NOV19_NOON);

        let mut second = make_event("mow-acled-actor-b");
        second.lat = 35.001;
        second.lng = 38.001;
        second.title = "Strike hits convoy near Deir Zor".to_string();
        second.detail = Some(
            "shelling · crimson delta army vs azure omega rebels · 4 reported fatalities"
                .to_string(),
        );
        second.killed = Some(4.0);
        second.country = "Syria".to_string();
        second.conflict = "Syrian conflict".to_string();
        second.source_family = "acled".to_string();
        second.intensity = 0.7;
        set_time(&mut second, NOV19_NOON);

        let result = correlate_incidents(vec![first, second], NOW);
        assert_eq!(result.incidents.len(), 1);
        let evidence = result.incidents[0].evidence.as_ref().expect("evidence");
        assert!(evidence
            .contradictions
            .iter()
            .any(|contradiction| contradiction.kind == IncidentContradictionKind::Actors));
        assert_eq!(
            evidence.confidence,
            IncidentCorrelationConfidence::Contested
        );
    }

    #[test]
    fn exact_id_collapse_is_counted_and_singletons_are_single_source() {
        let mut a = make_event("whm-same");
        a.lat = 40.0;
        a.lng = 44.0;
        a.title = "Strike in the north".to_string();
        a.source_family = "warheatmap".to_string();
        let b = a.clone();
        let mut solo = make_event("whm-solo");
        solo.lat = 10.0;
        solo.lng = 10.0;
        solo.title = "Isolated border incident".to_string();
        solo.category = "border_crossing".to_string();
        solo.source_family = "warheatmap".to_string();
        let result = correlate_incidents(vec![a, b, solo], NOW);
        assert_eq!(
            result
                .incidents
                .iter()
                .filter(|incident| incident.id == "whm-same")
                .count(),
            1
        );
        assert_eq!(result.stats.exact_duplicate_record_count, 1);
        let singleton = result
            .incidents
            .iter()
            .find(|incident| incident.id == "whm-solo")
            .expect("singleton");
        assert_eq!(
            singleton.incident.as_ref().map(|value| value.confidence),
            Some(IncidentCorrelationConfidence::SingleSource)
        );
        assert!(singleton.evidence.is_none());
    }

    #[test]
    fn input_reordering_does_not_change_clustering() {
        let mut ev_a = make_event("ev-a");
        ev_a.lat = 35.0;
        ev_a.lng = 38.0;
        ev_a.title = "Strike on convoy near Deir ez-Zor".to_string();
        ev_a.killed = Some(4.0);
        ev_a.country = "Syria".to_string();
        ev_a.conflict = "Syrian conflict".to_string();
        ev_a.source_family = "warheatmap".to_string();
        set_time(&mut ev_a, NOV19_NOON);

        let mut ucdp = make_event("ucdp:777");
        ucdp.lat = 35.01;
        ucdp.lng = 38.01;
        ucdp.title = "Dayr az Zawr, Syria".to_string();
        ucdp.category = "organized_violence".to_string();
        ucdp.killed = Some(4.0);
        ucdp.detail = Some("†4 · Government of Syria - IS".to_string());
        ucdp.country = "Syria".to_string();
        ucdp.conflict = "Syrian conflict".to_string();
        ucdp.source_family = "ucdp".to_string();
        set_time(&mut ucdp, NOV19_MIDNIGHT);

        let mut ev_b = make_event("ev-b");
        ev_b.lat = 35.02;
        ev_b.lng = 38.005;
        ev_b.title = "Convoy strike in Deir ez-Zor desert".to_string();
        ev_b.killed = Some(5.0);
        ev_b.country = "Syria".to_string();
        ev_b.conflict = "Syrian conflict".to_string();
        ev_b.source_family = "warheatmap".to_string();
        set_time(&mut ev_b, NOV19_NOON + 3600.0);

        let mut ev_c = make_event("ev-c");
        ev_c.lat = 20.0;
        ev_c.lng = 42.0;
        ev_c.title = "Unrelated saudi border incident".to_string();
        ev_c.category = "border_crossing".to_string();
        ev_c.country = "Saudi Arabia".to_string();
        ev_c.conflict = "Yemen war".to_string();
        ev_c.source_family = "warheatmap".to_string();
        set_time(&mut ev_c, NOV19_NOON);

        let mut ev_d = make_event("ev-d");
        ev_d.lat = 35.5;
        ev_d.lng = 38.6;
        ev_d.title = "Separate strike same region".to_string();
        ev_d.country = "Syria".to_string();
        ev_d.conflict = "Syrian conflict".to_string();
        ev_d.source_family = "warheatmap".to_string();
        set_time(&mut ev_d, NOV19_NOON + 30.0 * DAY);

        let events = vec![ev_a, ucdp, ev_b, ev_c, ev_d];
        let forward = correlate_incidents(events.clone(), NOW + 31.0 * DAY);
        let mut reversed = events.clone();
        reversed.reverse();
        let reversed = correlate_incidents(reversed, NOW + 31.0 * DAY);
        let shuffled = correlate_incidents(
            vec![
                events[2].clone(),
                events[4].clone(),
                events[0].clone(),
                events[3].clone(),
                events[1].clone(),
            ],
            NOW + 31.0 * DAY,
        );
        assert_eq!(output_signature(&forward), output_signature(&reversed));
        assert_eq!(output_signature(&forward), output_signature(&shuffled));
        let repeat = correlate_incidents(events, NOW + 31.0 * DAY);
        assert_eq!(output_signature(&forward), output_signature(&repeat));
    }

    #[test]
    fn source_family_resolution_matches_web_rules() {
        let mut event = make_event("x");
        event.source_family = "acled".to_string();
        assert_eq!(resolve_source_family(&event), "acled");

        let mut ucdp = make_event("ucdp:42");
        ucdp.source_family.clear();
        assert_eq!(resolve_source_family(&ucdp), "ucdp");

        let mut acled = make_event("mow-acled-99");
        acled.source_family.clear();
        assert_eq!(resolve_source_family(&acled), "acled");

        let mut unknown = make_event("abcdef");
        unknown.source_family.clear();
        assert_eq!(resolve_source_family(&unknown), "unknown");
    }

    #[test]
    fn explicit_exact_second_midnight_is_not_widened_to_a_day() {
        let mut precise_midnight = make_event("ucdp:explicit-second-midnight");
        precise_midnight.lat = 34.8;
        precise_midnight.lng = 36.7;
        precise_midnight.title = "Precision strike hits bridge near Homs".to_string();
        precise_midnight.country = "Syria".to_string();
        precise_midnight.conflict = "Syrian conflict".to_string();
        precise_midnight.source_family = "ucdp".to_string();
        set_time(&mut precise_midnight, NOV19_MIDNIGHT);
        precise_midnight.occurrence = create_second_occurrence_window(NOV19_MIDNIGHT);

        let mut noon_report = make_event("w:noon-report");
        noon_report.lat = 34.801;
        noon_report.lng = 36.701;
        noon_report.title = precise_midnight.title.clone();
        noon_report.country = "Syria".to_string();
        noon_report.conflict = "Syrian conflict".to_string();
        noon_report.source_family = "warheatmap".to_string();
        set_time(&mut noon_report, NOV19_NOON);

        let first = extract_event_features(&precise_midnight, 0);
        let second = extract_event_features(&noon_report, 1);
        let assessment = assess_pair(&first, &second);
        assert!(assessment.temporal_score <= 0.55);
        assert!(assessment.time_gap_hours > 11.9);
    }

    #[test]
    fn chain_guard_detaches_weak_member_as_visible_singleton() {
        let mut a = make_event("chain-a");
        a.lat = 48.0;
        a.lng = 37.0;
        a.title = "zarkan depot alpha".to_string();
        a.killed = Some(4.0);
        a.source_family = "warheatmap".to_string();
        a.intensity = 0.8;
        set_time(&mut a, NOV19_NOON);

        let mut b = make_event("chain-b");
        b.lat = 48.0;
        b.lng = 37.2;
        b.title = "zarkan depot alpha bridgemark beta".to_string();
        b.killed = Some(4.0);
        b.source_family = "warheatmap".to_string();
        b.intensity = 0.7;
        set_time(&mut b, NOV19_NOON + 10.0 * 3600.0);

        let mut c = make_event("chain-c");
        c.lat = 48.0;
        c.lng = 37.25;
        c.title = "bridgemark beta copper".to_string();
        c.killed = Some(4.0);
        c.source_family = "warheatmap".to_string();
        c.intensity = 0.6;
        set_time(&mut c, NOV19_NOON + 20.0 * 3600.0);

        let result = correlate_incidents(vec![a, b, c], NOW + DAY);
        assert_eq!(result.incidents.len(), 2, "{:#?}", result.stats);
        let canonical = canonical_for(&result, "chain-a").expect("canonical a");
        assert_eq!(
            canonical.incident.as_ref().map(|value| value.member_count),
            Some(2)
        );
        let detached = result
            .incidents
            .iter()
            .find(|incident| incident.id == "chain-c")
            .expect("detached chain-c singleton");
        assert_eq!(
            detached.incident.as_ref().map(|value| value.confidence),
            Some(IncidentCorrelationConfidence::SingleSource)
        );
        assert!(detached.incident.as_ref().is_some_and(|value| value
            .rationale
            .iter()
            .any(|line| line.contains("chain-guard"))));
    }

    #[test]
    fn embedded_snapshot_correlation_is_conservative_and_auditable() {
        let package = load_embedded();
        assert!(package.load_errors.is_empty(), "{:?}", package.load_errors);
        let input_count = package.normalized_incidents.len();
        let started = Instant::now();
        let result = correlate_incidents(package.normalized_incidents, NOW + 6.0 * DAY);
        let wall_elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "embedded correlation: {} records -> {} incidents in {:.1} ms; stats={:?}",
            input_count,
            result.incidents.len(),
            wall_elapsed_ms,
            result.stats
        );
        assert_eq!(input_count, result.stats.input_record_count);
        assert_eq!(
            input_count, 3300,
            "embedded contract changed; update parity expectations deliberately"
        );
        assert_eq!(result.stats.incident_count, 3198);
        assert_eq!(result.stats.exact_duplicate_record_count, 0);
        assert_eq!(result.stats.correlation_eligible_record_count, 2471);
        assert_eq!(result.stats.ineligible_record_count, 829);
        assert_eq!(result.stats.multi_member_cluster_count, 56);
        assert_eq!(result.stats.correlated_evidence_record_count, 102);
        assert_eq!(result.stats.contested_cluster_count, 7);
        assert_eq!(result.stats.corroborated_cluster_count, 30);
        assert_eq!(result.stats.inferred_cluster_count, 19);
        assert_eq!(result.stats.single_source_cluster_count, 3142);
        assert_eq!(result.stats.candidate_pair_count, 44199);
        assert_eq!(result.stats.evaluated_pair_count, 44199);
        assert!(!result.incidents.is_empty());
        assert!(result
            .incidents
            .iter()
            .all(|incident| incident.incident.is_some()));
        assert!(
            result.stats.correlated_evidence_record_count as f64 <= input_count as f64 * 0.6,
            "correlation absorbed an implausibly large share of independent reporting"
        );
        let curated_self_merges = result
            .incidents
            .iter()
            .filter(|incident| {
                let Some(evidence) = &incident.evidence else {
                    return false;
                };
                let mut families: Vec<&str> = evidence
                    .members
                    .iter()
                    .map(|member| member.source_family.as_str())
                    .collect();
                families.sort_unstable();
                families.dedup();
                families.len() != evidence.members.len()
                    && evidence
                        .members
                        .iter()
                        .any(|member| matches!(member.source_family.as_str(), "ucdp" | "acled"))
                    && evidence.source_families.len() == 1
            })
            .count();
        assert_eq!(curated_self_merges, 0);
        assert!(result.stats.candidate_pair_count <= result.stats.evaluated_pair_count + 1);
    }

    #[test]
    fn dense_synthetic_performance_and_noise_reduction_smoke() {
        let objects = [
            "depot",
            "convoy",
            "bridge",
            "airfield",
            "substation",
            "harbor",
            "barracks",
            "checkpoint",
        ];
        let mut synthetic = Vec::new();
        let mut seq = 0usize;
        for theater in 0..60 {
            let base_lat = -50.0 + ((theater as f64 * 1.7) % 130.0);
            let base_lng = -170.0 + ((theater as f64 * 47.0) % 340.0);
            for day in 0..25 {
                let occurred = NOW - day as f64 * DAY;
                let incident_lat =
                    base_lat + (((day * 37 + theater * 11) % 100) as f64 / 100.0) * 1.1;
                let incident_lng =
                    base_lng + (((day * 53 + theater * 7) % 100) as f64 / 100.0) * 1.1;
                let object = objects[(day + theater) % objects.len()];
                for (family, jitter, prefix) in [
                    ("warheatmap", 0.0, "w"),
                    ("ucdp", 0.02, "u"),
                    ("acled", -0.02, "a"),
                ] {
                    seq += 1;
                    let mut event = make_event(&format!("{}-{}-{}-{}", prefix, theater, day, seq));
                    event.lat = (incident_lat + jitter + (seq % 3) as f64 * 0.005) as f32;
                    event.lng = (incident_lng + jitter + (seq % 2) as f64 * 0.005) as f32;
                    event.title = if family == "warheatmap" {
                        format!("Strike hits {} near town{}-{}", object, theater, day)
                    } else {
                        format!("town{}-{} area, country", theater, day)
                    };
                    let timestamp = if family == "warheatmap" {
                        occurred + 10.0 * 3600.0
                    } else {
                        (occurred / DAY).floor() * DAY
                    };
                    set_time(&mut event, timestamp);
                    event.killed = Some((day % 9) as f32);
                    event.source_family = family.to_string();
                    event.category = "airstrike".to_string();
                    event.intensity = 0.4 + (seq % 10) as f32 * 0.03;
                    synthetic.push(event);
                }
            }
        }
        let started = Instant::now();
        let result = correlate_incidents(synthetic, NOW + DAY);
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        println!(
            "synthetic correlation: 4500 records -> {} incidents in {:.1} ms (engine {:.2} ms, {} candidates)",
            result.incidents.len(),
            elapsed_ms,
            result.stats.elapsed_ms,
            result.stats.candidate_pair_count
        );
        assert!(elapsed_ms < 3000.0, "{elapsed_ms:.1} ms");
        assert_eq!(result.incidents.len(), 1500);
        assert_eq!(result.stats.candidate_pair_count, 145791);
        assert_eq!(result.stats.evaluated_pair_count, 145791);
    }
}
