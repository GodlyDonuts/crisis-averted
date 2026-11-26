use serde::Deserialize;
use std::collections::BTreeMap;

/// Compact event representation used by `conflict-fallback.json`.
/// Field names intentionally mirror the publisher's compressed keys.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct ConflictFallback {
    #[serde(rename = "generatedAt")]
    pub generated_at: Option<f64>,
    pub source: Option<String>,
    pub license: Option<String>,
    pub events: Vec<WarEvent>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct WarEvent {
    #[serde(rename = "i")]
    pub id: Option<String>,
    #[serde(rename = "la")]
    pub lat: Option<f32>,
    #[serde(rename = "lo")]
    pub lng: Option<f32>,
    #[serde(rename = "p")]
    pub precision: Option<i32>,
    #[serde(rename = "s")]
    pub severity: Option<String>,
    #[serde(rename = "c")]
    pub category: Option<String>,
    #[serde(rename = "d")]
    pub date: Option<String>,
    #[serde(rename = "t")]
    pub theater: Option<String>,
    #[serde(rename = "k")]
    pub killed: Option<f32>,
    #[serde(rename = "u")]
    pub updated_at: Option<f64>,
    #[serde(rename = "x")]
    pub counted_casualties: Option<f32>,
    #[serde(rename = "n")]
    pub country: Option<String>,
    #[serde(rename = "cf")]
    pub conflict: Option<String>,
    #[serde(rename = "dp")]
    pub displaced: Option<f32>,
    #[serde(rename = "ti")]
    pub title: Option<String>,
    #[serde(rename = "r")]
    pub region: Option<String>,
    #[serde(rename = "v")]
    pub verified: Option<bool>,
    #[serde(rename = "sn")]
    pub source_name: Option<String>,
    #[serde(rename = "su")]
    pub source_url: Option<String>,
    #[serde(rename = "sc")]
    pub sources: Vec<ConflictSource>,
    #[serde(rename = "et")]
    pub occurred_at: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConflictSource {
    pub name: Option<String>,
    pub url: Option<String>,
}

/// Official UCDP GED fields retained with an ingested event. Names mirror the web contract.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct UcdpGedEventMetadata {
    pub id: Option<u64>,
    pub relid: Option<String>,
    pub year: Option<i32>,
    pub active_year: Option<bool>,
    pub code_status: Option<String>,
    pub type_of_violence: Option<i32>,
    pub conflict_new_id: Option<u64>,
    pub conflict_name: Option<String>,
    pub dyad_new_id: Option<u64>,
    pub dyad_name: Option<String>,
    pub side_a_new_id: Option<u64>,
    pub side_a: Option<String>,
    pub side_b_new_id: Option<u64>,
    pub side_b: Option<String>,
    pub number_of_sources: Option<u32>,
    pub source_article: Option<String>,
    pub source_office: Option<String>,
    pub source_date: Option<String>,
    pub source_headline: Option<String>,
    pub source_original: Option<String>,
    pub where_prec: Option<i32>,
    pub where_coordinates: Option<String>,
    pub where_description: Option<String>,
    pub adm_1: Option<String>,
    pub adm_2: Option<String>,
    pub priogrid_gid: Option<u64>,
    pub country: Option<String>,
    pub country_id: Option<u64>,
    pub region: Option<String>,
    pub event_clarity: Option<i32>,
    pub date_prec: Option<i32>,
    pub date_start: Option<String>,
    pub date_end: Option<String>,
    pub deaths_a: Option<f32>,
    pub deaths_b: Option<f32>,
    pub deaths_civilians: Option<f32>,
    pub deaths_unknown: Option<f32>,
    pub low: Option<f32>,
    pub best: Option<f32>,
    pub high: Option<f32>,
    pub gwnoa: Option<String>,
    pub gwnob: Option<String>,
    pub dataset_version: Option<String>,
    pub dataset_release: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct OsintSnapshot {
    #[serde(rename = "fetchedAt")]
    pub fetched_at: Option<String>,
    pub sources: BTreeMap<String, String>,
    #[serde(rename = "militaryAircraft")]
    pub military_aircraft: Vec<MilitaryAircraft>,
    /// Civil/commercial OpenSky state vectors. This is intentionally separate from militaryAircraft.
    pub aircraft: Vec<CivilAircraft>,
    pub vessels: Vec<Vessel>,
    pub satellites: Vec<SatelliteTle>,
    pub news: Vec<NewsArticle>,
    pub launches: Vec<Launch>,
    #[serde(rename = "naturalEvents")]
    pub natural_events: Vec<NaturalEvent>,
    #[serde(rename = "gpsInterference")]
    pub gps_interference: Vec<GpsInterferenceCell>,
    #[serde(rename = "mapOfWarsEvents")]
    pub map_events: Vec<MapEvent>,
    /// Webcam and cyber sections are retained as opaque values for counts/provenance only in the
    /// native vertical slice; no unsupported fields are projected onto the globe.
    pub webcams: Vec<serde_json::Value>,
    #[serde(rename = "cyberVulnerabilities")]
    pub cyber_vulnerabilities: Vec<serde_json::Value>,
    #[serde(rename = "cyberVulnerabilityMeta")]
    pub cyber_vulnerability_meta: Option<serde_json::Value>,
    #[serde(rename = "internetOutages")]
    pub internet_outages: Vec<IodaInternetOutage>,
    #[serde(rename = "internetOutageMeta")]
    pub internet_outage_meta: Option<IodaInternetOutageMeta>,
    #[serde(rename = "ucdpMeta")]
    pub ucdp_meta: Option<UcdpIngestionMeta>,
    #[serde(rename = "gdeltGeoNews")]
    pub gdelt_geo_news: Vec<GdeltGeoNewsMention>,
    #[serde(rename = "gdeltGeoMeta")]
    pub gdelt_geo_meta: Option<GdeltGeoIngestionMeta>,
    /// ReliefWeb humanitarian metadata is retained as opaque values for counts/provenance only.
    /// It is never projected as conflict incidents in the native vertical slice.
    #[serde(rename = "reliefwebRecords")]
    pub reliefweb_records: Vec<serde_json::Value>,
    #[serde(rename = "reliefwebMeta")]
    pub reliefweb_meta: Option<serde_json::Value>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MilitaryAircraft {
    pub id: String,
    pub callsign: String,
    pub registration: Option<String>,
    #[serde(rename = "aircraftType")]
    pub aircraft_type: Option<String>,
    pub lat: f32,
    pub lng: f32,
    pub altitude: Option<f32>,
    pub speed: Option<f32>,
    pub track: Option<f32>,
    pub squawk: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CivilAircraft {
    pub id: String,
    pub callsign: String,
    #[serde(rename = "originCountry")]
    pub origin_country: Option<String>,
    pub lat: f32,
    pub lng: f32,
    pub altitude: Option<f32>,
    pub speed: Option<f32>,
    pub track: Option<f32>,
    #[serde(rename = "verticalRate")]
    pub vertical_rate: Option<f32>,
    pub squawk: Option<String>,
    #[serde(rename = "operatorClass")]
    pub operator_class: String,
    #[serde(rename = "lastContact")]
    pub last_contact: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Vessel {
    pub id: String,
    pub mmsi: u64,
    pub imo: Option<u64>,
    pub name: String,
    #[serde(rename = "callSign")]
    pub call_sign: Option<String>,
    pub destination: Option<String>,
    #[serde(rename = "shipType")]
    pub ship_type: Option<i32>,
    #[serde(rename = "vesselClass")]
    pub vessel_class: String,
    #[serde(rename = "navigationStatus")]
    pub navigation_status: String,
    pub lat: f32,
    pub lng: f32,
    pub speed: Option<f32>,
    pub course: Option<f32>,
    pub heading: Option<f32>,
    pub timestamp: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SatelliteTle {
    pub id: String,
    pub name: String,
    pub group: String,
    #[serde(rename = "catalogNumber")]
    pub catalog_number: u64,
    pub line1: String,
    pub line2: String,
    pub epoch: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewsArticle {
    pub title: String,
    pub url: String,
    pub source: String,
    #[serde(rename = "publishedAt")]
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Launch {
    pub id: String,
    pub name: String,
    pub provider: Option<String>,
    pub location: Option<String>,
    pub lat: f32,
    pub lng: f32,
    pub net: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NaturalEvent {
    pub id: String,
    pub title: String,
    pub category: String,
    pub kind: String,
    pub lat: f32,
    pub lng: f32,
    #[serde(rename = "occurredAt")]
    pub occurred_at: Option<String>,
    pub magnitude: Option<f32>,
    #[serde(rename = "magnitudeUnit")]
    pub magnitude_unit: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GpsInterferenceCell {
    pub hex: String,
    #[serde(rename = "goodAircraft")]
    pub good_aircraft: u32,
    #[serde(rename = "badAircraft")]
    pub bad_aircraft: u32,
    #[serde(rename = "aircraftCount")]
    pub aircraft_count: u32,
    #[serde(rename = "affectedShare")]
    pub affected_share: f32,
    pub level: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct MapEvent {
    pub id: Option<String>,
    pub kind: Option<String>,
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub title: Option<String>,
    pub detail: Option<String>,
    pub level: Option<u8>,
    pub ts: Option<f64>,
    pub source: Option<String>,
    pub violence: Option<String>,
    pub note: Option<String>,
    pub url: Option<String>,
    pub ucdp: Option<UcdpGedEventMetadata>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IodaInternetOutage {
    #[serde(rename = "entityType")]
    pub entity_type: String,
    #[serde(rename = "entityCode")]
    pub entity_code: String,
    #[serde(rename = "entityName")]
    pub entity_name: String,
    #[serde(rename = "countryCode")]
    pub country_code: Option<String>,
    #[serde(rename = "countryName")]
    pub country_name: Option<String>,
    #[serde(rename = "naturalEarthRegionId")]
    pub natural_earth_region_id: Option<String>,
    pub lat: f32,
    pub lng: f32,
    #[serde(rename = "coordinatePrecision")]
    pub coordinate_precision: String,
    #[serde(rename = "coordinateNote")]
    pub coordinate_note: String,
    pub from: f64,
    pub until: f64,
    pub score: f64,
    pub datasource: Option<String>,
    pub method: Option<String>,
    #[serde(rename = "fromBeforeQueryWindow")]
    pub from_before_query_window: bool,
    #[serde(rename = "untilEqualsQueryHorizon")]
    pub until_equals_query_horizon: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct IodaQueryWindow {
    pub from: Option<f64>,
    pub until: Option<f64>,
    #[serde(rename = "fromIso")]
    pub from_iso: Option<String>,
    #[serde(rename = "untilIso")]
    pub until_iso: Option<String>,
    #[serde(rename = "lookbackSeconds")]
    pub lookback_seconds: Option<f64>,
    #[serde(rename = "extendWindowSeconds")]
    pub extend_window_seconds: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct IodaOmittedByReason {
    #[serde(rename = "invalidEventContract")]
    pub invalid_event_contract: Option<usize>,
    #[serde(rename = "missingCoordinateReference")]
    pub missing_coordinate_reference: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct IodaInternetOutageMeta {
    pub status: Option<String>,
    pub provider: Option<String>,
    #[serde(rename = "apiBaseUrl")]
    pub api_base_url: Option<String>,
    #[serde(rename = "queryWindow")]
    pub query_window: Option<IodaQueryWindow>,
    #[serde(rename = "entityTypes")]
    pub entity_types: Vec<String>,
    pub format: Option<String>,
    pub overall: Option<bool>,
    #[serde(rename = "includeAlerts")]
    pub include_alerts: Option<bool>,
    #[serde(rename = "pageLimit")]
    pub page_limit: Option<usize>,
    #[serde(rename = "maxPagesPerEntityType")]
    pub max_pages_per_entity_type: Option<usize>,
    #[serde(rename = "fetchedEventCount")]
    pub fetched_event_count: Option<usize>,
    #[serde(rename = "countryEventCount")]
    pub country_event_count: Option<usize>,
    #[serde(rename = "regionEventCount")]
    pub region_event_count: Option<usize>,
    #[serde(rename = "geolocatedEventCount")]
    pub geolocated_event_count: Option<usize>,
    #[serde(rename = "omittedEventCount")]
    pub omitted_event_count: Option<usize>,
    #[serde(rename = "omittedByReason")]
    pub omitted_by_reason: Option<IodaOmittedByReason>,
    #[serde(rename = "requestUrls")]
    pub request_urls: Vec<String>,
    #[serde(rename = "coordinateReference")]
    pub coordinate_reference: Option<String>,
    pub caveat: Option<String>,
    #[serde(rename = "statusDetail")]
    pub status_detail: Option<String>,
    #[serde(rename = "preservedAt")]
    pub preserved_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct UcdpIngestionMeta {
    pub status: Option<String>,
    pub provider: Option<String>,
    pub resource: Option<String>,
    pub version: Option<String>,
    #[serde(rename = "datasetRelease")]
    pub dataset_release: Option<String>,
    #[serde(rename = "apiEndpoint")]
    pub api_endpoint: Option<String>,
    pub codebook: Option<String>,
    pub authentication: Option<String>,
    #[serde(rename = "releaseSelection")]
    pub release_selection: Option<String>,
    #[serde(rename = "pageSize")]
    pub page_size: Option<usize>,
    #[serde(rename = "maxPages")]
    pub max_pages: Option<usize>,
    #[serde(rename = "maxNormalizedEvents")]
    pub max_normalized_events: Option<usize>,
    #[serde(rename = "totalCount")]
    pub total_count: Option<usize>,
    #[serde(rename = "totalPages")]
    pub total_pages: Option<usize>,
    #[serde(rename = "pagesFetched")]
    pub pages_fetched: Option<usize>,
    #[serde(rename = "fetchedEventCount")]
    pub fetched_event_count: Option<usize>,
    #[serde(rename = "uniqueCanonicalEventCount")]
    pub unique_canonical_event_count: Option<usize>,
    #[serde(rename = "validEventCount")]
    pub valid_event_count: Option<usize>,
    #[serde(rename = "ingestedEventCount")]
    pub ingested_event_count: Option<usize>,
    #[serde(rename = "mergedEventCount")]
    pub merged_event_count: Option<usize>,
    #[serde(rename = "preservedPriorEventCount")]
    pub preserved_prior_event_count: Option<usize>,
    #[serde(rename = "omittedEventCount")]
    pub omitted_event_count: Option<usize>,
    #[serde(rename = "requestUrls")]
    pub request_urls: Vec<String>,
    pub selection: Option<String>,
    pub caveat: Option<String>,
    #[serde(rename = "statusDetail")]
    pub status_detail: Option<String>,
    #[serde(rename = "preservedAt")]
    pub preserved_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GdeltGeoNewsMention {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub domain: String,
    pub collection: String,
    #[serde(rename = "locationName")]
    pub location_name: String,
    #[serde(rename = "locationType")]
    pub location_type: i32,
    #[serde(rename = "coordinatePrecision")]
    pub coordinate_precision: String,
    #[serde(rename = "countryCode")]
    pub country_code: Option<String>,
    #[serde(rename = "adm1Code")]
    pub adm1_code: Option<String>,
    #[serde(rename = "featureId")]
    pub feature_id: serde_json::Value,
    pub lat: f32,
    pub lng: f32,
    #[serde(rename = "proximityChars")]
    pub proximity_chars: i32,
    pub themes: Vec<String>,
    pub tone: Option<f32>,
    #[serde(rename = "positiveScore")]
    pub positive_score: Option<f32>,
    #[serde(rename = "negativeScore")]
    pub negative_score: Option<f32>,
    #[serde(rename = "wordCount")]
    pub word_count: Option<u32>,
    #[serde(rename = "sharingImage")]
    pub sharing_image: Option<String>,
    #[serde(rename = "slotTime")]
    pub slot_time: String,
    #[serde(rename = "seenAt")]
    pub seen_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct GdeltOmittedByReason {
    #[serde(rename = "invalidCoordinates")]
    pub invalid_coordinates: Option<usize>,
    #[serde(rename = "notProximalToConflictTheme")]
    pub not_proximal_to_conflict_theme: Option<usize>,
    #[serde(rename = "duplicateMention")]
    pub duplicate_mention: Option<usize>,
    #[serde(rename = "selectionCap")]
    pub selection_cap: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct GdeltGeoIngestionMeta {
    pub status: Option<String>,
    pub provider: Option<String>,
    pub attribution: Option<String>,
    #[serde(rename = "geoApiNote")]
    pub geo_api_note: Option<String>,
    #[serde(rename = "feedBaseUrl")]
    pub feed_base_url: Option<String>,
    #[serde(rename = "conflictThemes")]
    pub conflict_themes: Vec<String>,
    #[serde(rename = "proximityChars")]
    pub proximity_chars: Option<usize>,
    #[serde(rename = "slotsPerCollection")]
    pub slots_per_collection: Option<usize>,
    #[serde(rename = "maxSlotAttempts")]
    pub max_slot_attempts: Option<usize>,
    #[serde(rename = "maxMentions")]
    pub max_mentions: Option<usize>,
    #[serde(rename = "failedSlotDownloadCount")]
    pub failed_slot_download_count: Option<usize>,
    #[serde(rename = "rowsScanned")]
    pub rows_scanned: Option<usize>,
    #[serde(rename = "invalidRowCount")]
    pub invalid_row_count: Option<usize>,
    #[serde(rename = "conflictThemeRowCount")]
    pub conflict_theme_row_count: Option<usize>,
    #[serde(rename = "countryLevelMentionCount")]
    pub country_level_mention_count: Option<usize>,
    #[serde(rename = "subnationalMentionCount")]
    pub subnational_mention_count: Option<usize>,
    #[serde(rename = "proximalMentionCount")]
    pub proximal_mention_count: Option<usize>,
    #[serde(rename = "uniqueMentionCount")]
    pub unique_mention_count: Option<usize>,
    #[serde(rename = "ingestedMentionCount")]
    pub ingested_mention_count: Option<usize>,
    #[serde(rename = "uniqueArticleCount")]
    pub unique_article_count: Option<usize>,
    #[serde(rename = "uniqueLocationCount")]
    pub unique_location_count: Option<usize>,
    #[serde(rename = "titleEnrichedArticleCount")]
    pub title_enriched_article_count: Option<usize>,
    #[serde(rename = "omittedMentionCount")]
    pub omitted_mention_count: Option<usize>,
    #[serde(rename = "omittedByReason")]
    pub omitted_by_reason: Option<GdeltOmittedByReason>,
    #[serde(rename = "requestUrls")]
    pub request_urls: Vec<String>,
    pub selection: Option<String>,
    pub caveat: Option<String>,
    #[serde(rename = "statusDetail")]
    pub status_detail: Option<String>,
    #[serde(rename = "preservedAt")]
    pub preserved_at: Option<String>,
}

/// Temporal resolution carried by a source-supported occurrence interval. Native timestamps
/// use Unix seconds rather than the web client's milliseconds; conversion happens only at the
/// normalization boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncidentTemporalPrecision {
    Second,
    Day,
    Range,
}

impl IncidentTemporalPrecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Second => "second",
            Self::Day => "day",
            Self::Range => "range",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncidentOccurrenceBasis {
    PublisherSecond,
    PublisherDay,
    PublisherRange,
    InferredDay,
}

/// Source-supported occurrence interval. `start` is inclusive and `end_exclusive` exclusive.
/// Correlation and deterministic temporal playback both consume this interval directly; neither
/// layer interpolates uncertain occurrences into invented exact instants.
#[derive(Debug, Clone)]
pub struct IncidentOccurrenceWindow {
    pub start: f64,
    pub end_exclusive: f64,
    pub precision: IncidentTemporalPrecision,
    pub basis: IncidentOccurrenceBasis,
    pub label: String,
}

/// Evidentiary status of a canonical incident. These labels describe deterministic evidence
/// linkage only; they are deliberately not verification or truth adjudication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncidentCorrelationConfidence {
    Corroborated,
    SingleSource,
    Inferred,
    Contested,
}

impl IncidentCorrelationConfidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Corroborated => "corroborated",
            Self::SingleSource => "single-source",
            Self::Inferred => "inferred",
            Self::Contested => "contested",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncidentContradictionKind {
    Fatalities,
    Actors,
    Location,
}

impl IncidentContradictionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fatalities => "fatalities",
            Self::Actors => "actors",
            Self::Location => "location",
        }
    }
}

#[derive(Debug, Clone)]
pub struct IncidentContradiction {
    pub kind: IncidentContradictionKind,
    pub summary: String,
    pub member_event_ids: Vec<String>,
}

/// One retained source record inside an evidence cluster. The full normalized record is embedded
/// so correlation never silently discards an independent report.
#[derive(Debug, Clone)]
pub struct IncidentEvidenceMember {
    pub event: Incident,
    pub source_family: String,
    pub correlation_score: f64,
    pub rationale: Vec<String>,
}

/// Canonical-incident evidence cluster. Present only on canonical representatives that absorbed
/// at least one additional report; `members` excludes the canonical carrier itself.
#[derive(Debug, Clone)]
pub struct IncidentEvidenceCluster {
    pub cluster_id: String,
    pub canonical_event_id: String,
    pub algorithm_version: String,
    pub confidence: IncidentCorrelationConfidence,
    pub confidence_reason: String,
    pub source_families: Vec<String>,
    pub independent_family_count: usize,
    pub member_count: usize,
    pub contradictions: Vec<IncidentContradiction>,
    pub members: Vec<IncidentEvidenceMember>,
}

/// Lightweight membership summary attached to every emitted incident, including singletons.
#[derive(Debug, Clone)]
pub struct IncidentMembership {
    pub cluster_id: String,
    pub canonical_event_id: String,
    pub is_canonical: bool,
    pub correlation_score: f64,
    pub confidence: IncidentCorrelationConfidence,
    pub member_count: usize,
    pub independent_family_count: usize,
    pub rationale: Vec<String>,
}

/// Native incident normalization. Optional numeric fields remain optional so the UI can say
/// "not supplied" rather than inventing zero casualties, zero displacement, or exact timestamps.
#[derive(Debug, Clone)]
pub struct Incident {
    pub id: String,
    pub lat: f32,
    pub lng: f32,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub detail: Option<String>,
    pub country: String,
    pub conflict: String,
    pub theater: String,
    pub region: Option<String>,
    pub precision: Option<i32>,
    pub casualties: Option<f32>,
    pub killed: Option<f32>,
    pub displaced: Option<f32>,
    pub occurred_at: Option<f64>,
    pub updated_at: Option<f64>,
    pub verified: bool,
    pub source_name: Option<String>,
    pub source_url: Option<String>,
    pub sources: Vec<ConflictSource>,
    pub source_family: String,
    pub intensity: f32,
    pub occurrence: Option<IncidentOccurrenceWindow>,
    pub ucdp: Option<UcdpGedEventMetadata>,
    /// Canonical-incident membership summary, present after the deterministic correlation pass.
    pub incident: Option<IncidentMembership>,
    /// Full evidence drill-down, present only on canonical representatives with retained members.
    pub evidence: Option<IncidentEvidenceCluster>,
}

#[derive(Debug, Clone)]
pub struct NativeDataPackage {
    /// Raw normalized records before canonical incident correlation. Correlation consumes these
    /// records but retains every independent report either as a singleton or evidence member.
    pub normalized_incidents: Vec<Incident>,
    pub fallback_incidents: Vec<Incident>,
    pub osint: OsintSnapshot,
    pub conflict_generated_at: Option<f64>,
    pub conflict_source: Option<String>,
    pub conflict_license: Option<String>,
    pub load_errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct InternetOutageMarker {
    pub key: String,
    pub entity_type: String,
    pub entity_code: String,
    pub entity_name: String,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub lat: f32,
    pub lng: f32,
    pub coordinate_precision: String,
    pub coordinate_note: String,
    pub event_indices: Vec<usize>,
    pub datasource_methods: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct GdeltLocationMarker {
    pub key: String,
    pub lat: f32,
    pub lng: f32,
    pub location_name: String,
    pub coordinate_precision: String,
    pub location_type: i32,
    pub mention_indices: Vec<usize>,
    pub article_indices: Vec<usize>,
    pub themes: Vec<String>,
    pub latest_slot_time: String,
}

pub fn parse_conflict_fallback(input: &str) -> Result<ConflictFallback, serde_json::Error> {
    serde_json::from_str(input)
}

pub fn parse_osint_snapshot(input: &str) -> Result<OsintSnapshot, serde_json::Error> {
    serde_json::from_str(input)
}

pub fn unix_time_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn parse_rfc3339_unix(value: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.timestamp_millis() as f64 / 1000.0)
}

fn parse_day_unix_seconds(value: &str) -> Option<f64> {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()?
        .and_hms_opt(0, 0, 0)
        .map(|value| value.and_utc().timestamp_millis() as f64 / 1000.0)
}

fn parse_iso_day_prefix_unix_seconds(value: Option<&str>) -> Option<f64> {
    let value = value?;
    parse_day_unix_seconds(value.get(..10)?)
}

fn is_finite_positive_timestamp(timestamp: f64) -> bool {
    timestamp.is_finite() && timestamp > 0.0
}

pub fn create_second_occurrence_window(timestamp: f64) -> Option<IncidentOccurrenceWindow> {
    if !is_finite_positive_timestamp(timestamp) {
        return None;
    }
    let start = timestamp.floor();
    Some(IncidentOccurrenceWindow {
        start,
        end_exclusive: start + 1.0,
        precision: IncidentTemporalPrecision::Second,
        basis: IncidentOccurrenceBasis::PublisherSecond,
        label: "publisher timestamp normalized to a one-second UTC interval".to_string(),
    })
}

pub fn create_day_occurrence_window(
    day_start_or_timestamp: f64,
    basis: IncidentOccurrenceBasis,
) -> Option<IncidentOccurrenceWindow> {
    if !is_finite_positive_timestamp(day_start_or_timestamp) {
        return None;
    }
    if !matches!(
        basis,
        IncidentOccurrenceBasis::PublisherDay | IncidentOccurrenceBasis::InferredDay
    ) {
        return None;
    }
    let start = (day_start_or_timestamp / 86_400.0).floor() * 86_400.0;
    Some(IncidentOccurrenceWindow {
        start,
        end_exclusive: start + 86_400.0,
        precision: IncidentTemporalPrecision::Day,
        basis,
        label: if basis == IncidentOccurrenceBasis::PublisherDay {
            "publisher supplies a calendar date only; the exact time inside the UTC-normalized day is unresolved"
        } else {
            "legacy timestamp falls at a UTC midnight boundary and is conservatively treated as date-only; the exact time inside the day is unresolved"
        }
        .to_string(),
    })
}

fn ucdp_date_precision_text(date_prec: Option<i32>) -> &'static str {
    match date_prec {
        Some(1) => "exact calendar day known (day resolution, not a time of day)",
        Some(2) => "exact day unknown within a 2-6 day range",
        Some(3) => "exact day unknown within the source week",
        Some(4) => "exact day unknown within an 8-30 day/month range",
        Some(5) => "exact day unknown within a range longer than one month and up to one year",
        _ => "date precision unspecified by publisher",
    }
}

pub fn create_ucdp_occurrence_window(
    date_start: Option<&str>,
    date_end: Option<&str>,
    date_prec: Option<i32>,
) -> Option<IncidentOccurrenceWindow> {
    let start_day = parse_iso_day_prefix_unix_seconds(date_start)?;
    let end_day = parse_iso_day_prefix_unix_seconds(date_end)?;
    if start_day > end_day {
        return None;
    }
    let end_exclusive = end_day + 86_400.0;
    let is_single_day = start_day + 86_400.0 == end_exclusive;
    let days = ((end_exclusive - start_day) / 86_400.0).round() as usize;
    let precision_text = ucdp_date_precision_text(date_prec);
    Some(IncidentOccurrenceWindow {
        start: start_day,
        end_exclusive,
        precision: if is_single_day {
            IncidentTemporalPrecision::Day
        } else {
            IncidentTemporalPrecision::Range
        },
        basis: if is_single_day {
            IncidentOccurrenceBasis::PublisherDay
        } else {
            IncidentOccurrenceBasis::PublisherRange
        },
        label: format!(
            "UCDP {}; earliest/latest possible dates are {} through {} inclusive ({} UTC-normalized day{})",
            precision_text,
            date_start.and_then(|value| value.get(..10)).unwrap_or("unknown"),
            date_end.and_then(|value| value.get(..10)).unwrap_or("unknown"),
            days,
            if days == 1 { "" } else { "s" }
        ),
    })
}

/// Resolve an occurrence interval without inventing precision. This mirrors the web correlation
/// input contract, scaled to Unix seconds. It is intentionally not a temporal-playback index.
pub fn resolve_incident_occurrence_window(event: &Incident) -> Option<IncidentOccurrenceWindow> {
    if let Some(explicit) = &event.occurrence {
        if explicit.start.is_finite()
            && explicit.end_exclusive.is_finite()
            && explicit.end_exclusive > explicit.start
        {
            return Some(explicit.clone());
        }
    }

    if let Some(ucdp) = &event.ucdp {
        if let Some(window) = create_ucdp_occurrence_window(
            ucdp.date_start.as_deref(),
            ucdp.date_end.as_deref(),
            ucdp.date_prec,
        ) {
            return Some(window);
        }
    }

    let occurred_at = event.occurred_at?;
    if !is_finite_positive_timestamp(occurred_at) {
        return None;
    }
    if occurred_at.rem_euclid(86_400.0).abs() < f64::EPSILON {
        create_day_occurrence_window(occurred_at, IncidentOccurrenceBasis::InferredDay)
    } else {
        create_second_occurrence_window(occurred_at)
    }
}

fn severity_from_code(code: Option<&str>) -> String {
    match code {
        Some("c") | Some("critical") => "critical",
        Some("h") | Some("high") => "high",
        Some("m") | Some("medium") => "medium",
        _ => "low",
    }
    .to_string()
}

fn severity_rank(severity: &str) -> f32 {
    match severity {
        "critical" | "c" => 4.0,
        "high" | "h" => 3.0,
        "medium" | "m" => 2.0,
        _ => 1.0,
    }
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn slugify_theater(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut pending_dash = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !output.is_empty() {
                output.push('-');
            }
            pending_dash = false;
            output.push(character);
        } else {
            pending_dash = true;
        }
    }
    if output.is_empty() {
        "global".to_string()
    } else {
        output
    }
}

fn normalize_theater_name(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut uppercase_next = true;
    for character in value.chars() {
        if character == '_' || character == '-' {
            output.push(' ');
            uppercase_next = true;
        } else if uppercase_next {
            output.extend(character.to_uppercase());
            uppercase_next = false;
        } else {
            output.push(character);
        }
    }
    output
}

fn first_finite(values: impl IntoIterator<Item = Option<f32>>) -> Option<f32> {
    values.into_iter().flatten().find(|value| value.is_finite())
}

pub fn normalize_warheatmap_event(raw: &WarEvent) -> Option<Incident> {
    let id = raw.id.clone()?;
    let lat = raw.lat?;
    let lng = raw.lng?;
    if !lat.is_finite() || !lng.is_finite() {
        return None;
    }
    let severity = severity_from_code(raw.severity.as_deref());
    let category = raw.category.clone().unwrap_or_else(|| "other".to_string());
    let occurred_at = raw
        .occurred_at
        .filter(|value| value.is_finite() && *value > 0.0)
        .or_else(|| raw.date.as_deref().and_then(parse_day_unix_seconds));
    let updated_at = raw
        .updated_at
        .filter(|value| value.is_finite() && *value > 0.0)
        .or(occurred_at);
    let occurrence = if raw
        .occurred_at
        .is_some_and(|value| value.is_finite() && value > 0.0)
    {
        occurred_at.and_then(create_second_occurrence_window)
    } else {
        occurred_at.and_then(|timestamp| {
            create_day_occurrence_window(timestamp, IncidentOccurrenceBasis::PublisherDay)
        })
    };
    let killed = raw
        .killed
        .filter(|value| value.is_finite() && *value >= 0.0);
    let counted_casualties = raw
        .counted_casualties
        .filter(|value| value.is_finite() && *value >= 0.0);
    let displaced = raw
        .displaced
        .filter(|value| value.is_finite() && *value >= 0.0);
    let now = unix_time_now();
    let recency_hours = occurred_at
        .map(|timestamp| ((now - timestamp).max(0.0)) / 3600.0)
        .unwrap_or(720.0) as f32;
    let recency_boost = clamp01(1.0 - recency_hours / (24.0 * 30.0));
    let casualty_boost = clamp01((1.0 + killed.unwrap_or(0.0).min(1000.0)).log10() / 3.0);
    let displacement_boost = clamp01((1.0 + displaced.unwrap_or(0.0).min(100000.0)).log10() / 5.0);
    let precision_boost = raw
        .precision
        .map(|precision| clamp01((7.0 - precision as f32) / 7.0) * 0.08)
        .unwrap_or(0.0);
    let verification_boost = if raw.verified.unwrap_or(false) {
        0.08
    } else {
        0.0
    };
    let intensity = clamp01(
        severity_rank(&severity) / 4.0 * 0.52
            + casualty_boost * 0.2
            + displacement_boost * 0.1
            + recency_boost * 0.16
            + precision_boost
            + verification_boost,
    );
    let theater = raw
        .theater
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| raw.conflict.clone().filter(|value| !value.is_empty()))
        .or_else(|| raw.country.clone().filter(|value| !value.is_empty()))
        .unwrap_or_else(|| "global".to_string());
    let mut sources: Vec<ConflictSource> = raw
        .sources
        .iter()
        .filter(|source| {
            source
                .name
                .as_deref()
                .is_some_and(|value| !value.is_empty())
                && source.url.as_deref().is_some_and(|value| !value.is_empty())
        })
        .take(4)
        .cloned()
        .collect();
    if let (Some(name), Some(url)) = (&raw.source_name, &raw.source_url) {
        if !name.is_empty()
            && !url.is_empty()
            && !sources
                .iter()
                .any(|source| source.url.as_ref() == Some(url))
        {
            sources.insert(
                0,
                ConflictSource {
                    name: Some(name.clone()),
                    url: Some(url.clone()),
                },
            );
        }
    }
    Some(Incident {
        id,
        lat,
        lng,
        severity,
        category,
        title: raw
            .title
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Untitled incident".to_string()),
        detail: None,
        country: raw
            .country
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Unknown".to_string()),
        conflict: raw
            .conflict
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| normalize_theater_name(&theater)),
        theater,
        region: raw.region.clone(),
        precision: raw.precision,
        casualties: counted_casualties,
        killed,
        displaced,
        occurred_at,
        updated_at,
        verified: raw.verified.unwrap_or(false),
        source_name: raw.source_name.clone().filter(|value| !value.is_empty()),
        source_url: raw.source_url.clone().filter(|value| !value.is_empty()),
        sources,
        source_family: "warheatmap".to_string(),
        intensity,
        occurrence,
        ucdp: None,
        incident: None,
        evidence: None,
    })
}

fn parse_fatality_number_after_marker(detail: &str, marker: char) -> Option<f32> {
    let marker_index = detail.find(marker)?;
    let after_marker = detail[marker_index + marker.len_utf8()..].trim_start();
    let digit_len = after_marker
        .bytes()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    if digit_len == 0 {
        return None;
    }
    after_marker[..digit_len].parse::<f32>().ok()
}

fn parse_fatality_number_after_markers(detail: &str) -> Option<f32> {
    // Match the web parser's priority order. The replacement-character fallback is native-only
    // hardening for malformed cached rows; well-formed embedded rows use the publisher dagger.
    for marker in ['†', '•', '�'] {
        if let Some(value) = parse_fatality_number_after_marker(detail, marker) {
            return Some(value);
        }
    }
    let lower = detail.to_ascii_lowercase();
    if lower.contains("reported fatalities") {
        let words: Vec<&str> = detail.split_whitespace().collect();
        for window in words.windows(3) {
            if window[1].eq_ignore_ascii_case("reported")
                && window[2].eq_ignore_ascii_case("fatalities")
            {
                if let Ok(value) = window[0].parse::<f32>() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn map_country(title: Option<&str>) -> String {
    let Some(title) = title else {
        return "Unknown".to_string();
    };
    if !title.contains(',') {
        return "Unknown".to_string();
    }
    title
        .rsplit(',')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Unknown")
        .to_string()
}

fn canonical_ucdp_id(raw_id: &str, ucdp: Option<&UcdpGedEventMetadata>) -> Option<u64> {
    ucdp.and_then(|metadata| metadata.id).or_else(|| {
        let suffix = raw_id.strip_prefix("ucdp:")?;
        if !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit()) {
            suffix.parse::<u64>().ok()
        } else {
            None
        }
    })
}

/// Normalize the battle records of the Map of Wars lattice. Non-battle lattice rows are not
/// conflict incidents in the web contract; launches and vessels remain in their dedicated arrays.
pub fn normalize_map_of_wars_event(raw: &MapEvent) -> Option<Incident> {
    let raw_id = raw.id.clone().filter(|value| !value.is_empty())?;
    let lat = raw.lat?;
    let lng = raw.lon?;
    let occurred_at = raw.ts.filter(|value| value.is_finite())?;
    if raw.kind.as_deref() != Some("battle") || !lat.is_finite() || !lng.is_finite() {
        return None;
    }
    let title = raw
        .title
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Unnamed contact".to_string());
    let parsed_fatalities = raw
        .detail
        .as_deref()
        .and_then(parse_fatality_number_after_markers);
    let ucdp = raw.ucdp.clone();
    let casualties = first_finite([
        ucdp.as_ref().and_then(|value| value.best),
        parsed_fatalities,
    ])
    .filter(|value| *value >= 0.0);
    let uncertainty_aware_fatalities = if ucdp.is_some() {
        casualties.unwrap_or(0.0).max(
            if ucdp.as_ref().and_then(|value| value.high).unwrap_or(0.0) > 0.0 {
                1.0
            } else {
                0.0
            },
        )
    } else {
        casualties.unwrap_or(0.0)
    };
    let severity = if uncertainty_aware_fatalities >= 25.0 {
        "critical"
    } else if uncertainty_aware_fatalities >= 5.0 || raw.level.unwrap_or(1) >= 3 {
        "high"
    } else if uncertainty_aware_fatalities > 0.0 {
        "medium"
    } else {
        "low"
    };
    let country = ucdp
        .as_ref()
        .and_then(|value| value.country.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| map_country(raw.title.as_deref()));
    let conflict = ucdp
        .as_ref()
        .and_then(|value| value.conflict_name.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if country != "Unknown" {
                format!("{} conflict", country)
            } else {
                "Unresolved conflict zone".to_string()
            }
        });
    let canonical_id = canonical_ucdp_id(&raw_id, ucdp.as_ref());
    let id = canonical_id
        .map(|value| format!("ucdp:{}", value))
        .unwrap_or_else(|| format!("mow-{}", raw_id));
    let recency_boost =
        clamp01(1.0 - ((unix_time_now() - occurred_at).max(0.0) / 3600.0) as f32 / (24.0 * 30.0));
    let intensity = clamp01(
        severity_rank(severity) / 4.0 * 0.58
            + clamp01((1.0 + uncertainty_aware_fatalities).log10() / 2.5) * 0.25
            + recency_boost * 0.17,
    );
    let source_family = if canonical_id.is_some() {
        "ucdp"
    } else if raw_id.starts_with("acled-") || raw.source.as_deref() == Some("ACLED") {
        "acled"
    } else {
        "mapofwars"
    };
    let verified = if let Some(metadata) = ucdp.as_ref() {
        metadata
            .code_status
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("clear"))
    } else {
        raw.source.as_deref() == Some("UCDP")
    };
    let occurrence = ucdp
        .as_ref()
        .and_then(|metadata| {
            create_ucdp_occurrence_window(
                metadata.date_start.as_deref(),
                metadata.date_end.as_deref(),
                metadata.date_prec,
            )
        })
        .or_else(|| {
            if occurred_at.rem_euclid(86_400.0).abs() < f64::EPSILON {
                create_day_occurrence_window(occurred_at, IncidentOccurrenceBasis::InferredDay)
            } else {
                create_second_occurrence_window(occurred_at)
            }
        });
    Some(Incident {
        id,
        lat,
        lng,
        severity: severity.to_string(),
        category: if ucdp.is_some() {
            "organized_violence".to_string()
        } else {
            "ground_battle".to_string()
        },
        title: raw
            .note
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or(title),
        detail: raw.detail.clone().filter(|value| !value.is_empty()),
        country,
        conflict: conflict.clone(),
        theater: slugify_theater(&conflict),
        region: ucdp
            .as_ref()
            .and_then(|value| value.region.clone())
            .filter(|value| !value.is_empty())
            .or_else(|| Some("Global".to_string())),
        precision: ucdp.as_ref().and_then(|value| value.where_prec),
        casualties,
        killed: casualties,
        displaced: None,
        occurred_at: Some(occurred_at),
        updated_at: Some(occurred_at),
        verified,
        source_name: raw.source.clone().filter(|value| !value.is_empty()),
        source_url: raw.url.clone().filter(|value| !value.is_empty()),
        sources: raw
            .url
            .as_ref()
            .filter(|url| !url.is_empty())
            .map(|url| {
                vec![ConflictSource {
                    name: Some(
                        raw.source
                            .clone()
                            .filter(|value| !value.is_empty())
                            .unwrap_or_else(|| "Map of Wars".to_string()),
                    ),
                    url: Some(url.clone()),
                }]
            })
            .unwrap_or_default(),
        source_family: source_family.to_string(),
        intensity,
        occurrence,
        ucdp,
        incident: None,
        evidence: None,
    })
}

pub fn assemble_incidents(
    fallback_incidents: &[Incident],
    map_events: &[MapEvent],
) -> Vec<Incident> {
    let mut incidents = Vec::with_capacity(fallback_incidents.len() + map_events.len());
    incidents.extend(fallback_incidents.iter().cloned());
    incidents.extend(map_events.iter().filter_map(normalize_map_of_wars_event));
    incidents.sort_by(|a, b| {
        b.occurred_at
            .unwrap_or(0.0)
            .partial_cmp(&a.occurred_at.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.intensity.total_cmp(&a.intensity))
            .then_with(|| a.id.cmp(&b.id))
    });
    incidents
}

pub fn load_embedded() -> NativeDataPackage {
    let mut load_errors = Vec::new();
    let fallback = match parse_conflict_fallback(include_str!(
        "../../../frontend/public/data/conflict-fallback.json"
    )) {
        Ok(value) => Some(value),
        Err(error) => {
            load_errors.push(format!(
                "embedded conflict fallback parse failed: {}",
                error
            ));
            None
        }
    };
    let osint = match parse_osint_snapshot(include_str!(
        "../../../frontend/public/data/osint-snapshot.json"
    )) {
        Ok(value) => value,
        Err(error) => {
            load_errors.push(format!("embedded OSINT snapshot parse failed: {}", error));
            OsintSnapshot::default()
        }
    };
    let fallback_incidents: Vec<Incident> = fallback
        .as_ref()
        .map(|value| {
            value
                .events
                .iter()
                .filter_map(normalize_warheatmap_event)
                .collect()
        })
        .unwrap_or_default();
    let normalized_incidents = assemble_incidents(&fallback_incidents, &osint.map_events);
    NativeDataPackage {
        normalized_incidents,
        fallback_incidents,
        osint,
        conflict_generated_at: fallback.as_ref().and_then(|value| value.generated_at),
        conflict_source: fallback.as_ref().and_then(|value| value.source.clone()),
        conflict_license: fallback.as_ref().and_then(|value| value.license.clone()),
        load_errors,
    }
}

pub fn rebuild_incidents(fallback_incidents: &[Incident], osint: &OsintSnapshot) -> Vec<Incident> {
    assemble_incidents(fallback_incidents, &osint.map_events)
}

pub fn snapshot_revision(snapshot: &OsintSnapshot) -> String {
    format!(
        "{}|{}:{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        snapshot.fetched_at.as_deref().unwrap_or("no-fetched-at"),
        snapshot.military_aircraft.len(),
        snapshot.aircraft.len(),
        snapshot.vessels.len(),
        snapshot.satellites.len(),
        snapshot.launches.len(),
        snapshot.natural_events.len(),
        snapshot.gps_interference.len(),
        snapshot.map_events.len(),
        snapshot.internet_outages.len(),
        snapshot.gdelt_geo_news.len(),
        snapshot.reliefweb_records.len()
    )
}

pub fn build_internet_outage_markers(outages: &[IodaInternetOutage]) -> Vec<InternetOutageMarker> {
    let mut groups: BTreeMap<String, InternetOutageMarker> = BTreeMap::new();
    for (index, outage) in outages.iter().enumerate() {
        let key = format!("{}:{}", outage.entity_type, outage.entity_code);
        let marker = groups
            .entry(key.clone())
            .or_insert_with(|| InternetOutageMarker {
                key,
                entity_type: outage.entity_type.clone(),
                entity_code: outage.entity_code.clone(),
                entity_name: outage.entity_name.clone(),
                country_code: outage.country_code.clone(),
                country_name: outage.country_name.clone(),
                lat: outage.lat,
                lng: outage.lng,
                coordinate_precision: outage.coordinate_precision.clone(),
                coordinate_note: outage.coordinate_note.clone(),
                event_indices: Vec::new(),
                datasource_methods: Vec::new(),
            });
        marker.event_indices.push(index);
        let datasource_method = format!(
            "{}/{}",
            outage.datasource.as_deref().unwrap_or("unknown source"),
            outage.method.as_deref().unwrap_or("unknown method")
        );
        if !marker.datasource_methods.contains(&datasource_method) {
            marker.datasource_methods.push(datasource_method);
        }
    }
    groups.into_values().collect()
}

fn gdelt_precision_rank(precision: &str) -> u8 {
    match precision {
        "us-city-or-landmark" | "world-city-or-landmark" => 2,
        "us-state-centroid" | "world-admin1-centroid" => 1,
        _ => 0,
    }
}

pub fn build_gdelt_location_markers(mentions: &[GdeltGeoNewsMention]) -> Vec<GdeltLocationMarker> {
    let mut groups: BTreeMap<String, GdeltLocationMarker> = BTreeMap::new();
    for (index, mention) in mentions.iter().enumerate() {
        let key = format!(
            "{:.3}:{:.3}:{}",
            mention.lat, mention.lng, mention.location_name
        );
        let marker = groups
            .entry(key.clone())
            .or_insert_with(|| GdeltLocationMarker {
                key,
                lat: mention.lat,
                lng: mention.lng,
                location_name: mention.location_name.clone(),
                coordinate_precision: mention.coordinate_precision.clone(),
                location_type: mention.location_type,
                mention_indices: Vec::new(),
                article_indices: Vec::new(),
                themes: Vec::new(),
                latest_slot_time: mention.slot_time.clone(),
            });
        marker.mention_indices.push(index);
        if !marker
            .article_indices
            .iter()
            .any(|article_index| mentions[*article_index].url == mention.url)
        {
            marker.article_indices.push(index);
        }
        for theme in &mention.themes {
            if !marker.themes.contains(theme) {
                marker.themes.push(theme.clone());
            }
        }
        if mention.slot_time > marker.latest_slot_time {
            marker.latest_slot_time = mention.slot_time.clone();
        }
        if gdelt_precision_rank(&mention.coordinate_precision)
            > gdelt_precision_rank(&marker.coordinate_precision)
        {
            marker.coordinate_precision = mention.coordinate_precision.clone();
            marker.location_type = mention.location_type;
        }
    }
    let mut output: Vec<_> = groups.into_values().collect();
    for marker in &mut output {
        marker.themes.sort();
        marker.article_indices.sort_by(|a, b| {
            let left = &mentions[*a];
            let right = &mentions[*b];
            right
                .themes
                .len()
                .cmp(&left.themes.len())
                .then_with(|| left.proximity_chars.cmp(&right.proximity_chars))
                .then_with(|| right.slot_time.cmp(&left.slot_time))
                .then_with(|| left.url.cmp(&right.url))
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_contracts_parse_with_expected_layers() {
        let package = load_embedded();
        assert!(package.load_errors.is_empty(), "{:?}", package.load_errors);
        assert!(!package.osint.military_aircraft.is_empty());
        assert!(!package.osint.aircraft.is_empty());
        assert!(!package.osint.vessels.is_empty());
        assert!(!package.osint.satellites.is_empty());
        assert!(!package.osint.launches.is_empty());
        assert!(!package.osint.natural_events.is_empty());
        assert!(!package.osint.gps_interference.is_empty());
        assert!(!package.osint.internet_outages.is_empty());
        assert!(!package.osint.gdelt_geo_news.is_empty());
        assert!(!package.osint.map_events.is_empty());
        assert!(!package.fallback_incidents.is_empty());
        assert!(!package.normalized_incidents.is_empty());
    }

    #[test]
    fn warheatmap_normalization_preserves_richer_fields() {
        let raw = WarEvent {
            id: Some("abc".to_string()),
            lat: Some(10.0),
            lng: Some(20.0),
            precision: Some(2),
            severity: Some("h".to_string()),
            category: Some("airstrike".to_string()),
            date: Some("2026-01-02".to_string()),
            theater: Some("theater".to_string()),
            killed: Some(3.0),
            updated_at: Some(1_767_000_100.0),
            counted_casualties: Some(4.0),
            country: Some("Country".to_string()),
            conflict: Some("Conflict".to_string()),
            displaced: Some(12.0),
            title: Some("Title".to_string()),
            region: Some("Region".to_string()),
            verified: Some(true),
            source_name: Some("Source".to_string()),
            source_url: Some("https://example.test".to_string()),
            sources: vec![ConflictSource {
                name: Some("Source".to_string()),
                url: Some("https://example.test".to_string()),
            }],
            occurred_at: Some(1_767_000_000.0),
        };
        let incident = normalize_warheatmap_event(&raw).expect("valid incident");
        assert_eq!(incident.severity, "high");
        assert_eq!(incident.killed, Some(3.0));
        assert_eq!(incident.casualties, Some(4.0));
        assert_eq!(incident.displaced, Some(12.0));
        assert_eq!(incident.precision, Some(2));
        assert!(incident.verified);
        assert_eq!(incident.sources.len(), 1);
    }

    #[test]
    fn map_event_without_fatality_evidence_does_not_invent_zero() {
        let raw = MapEvent {
            id: Some("x".to_string()),
            kind: Some("battle".to_string()),
            lat: Some(1.0),
            lon: Some(2.0),
            title: Some("Place, Country".to_string()),
            detail: None,
            level: Some(1),
            ts: Some(100.0),
            source: Some("Map of Wars".to_string()),
            violence: None,
            note: None,
            url: None,
            ucdp: None,
        };
        let incident = normalize_map_of_wars_event(&raw).expect("valid incident");
        assert_eq!(incident.casualties, None);
        assert_eq!(incident.displaced, None);
    }

    #[test]
    fn fatality_parser_supports_publishers_markers() {
        assert_eq!(
            parse_fatality_number_after_markers("† 12 • actor"),
            Some(12.0)
        );
        assert_eq!(parse_fatality_number_after_markers("�7 � actor"), Some(7.0));
        assert_eq!(
            parse_fatality_number_after_markers("5 reported fatalities"),
            Some(5.0)
        );
    }

    #[test]
    fn outage_and_gdelt_markers_are_display_groupings_only() {
        let outage = IodaInternetOutage {
            entity_type: "country".to_string(),
            entity_code: "AA".to_string(),
            entity_name: "Example".to_string(),
            country_code: Some("AA".to_string()),
            country_name: Some("Example".to_string()),
            natural_earth_region_id: None,
            lat: 1.0,
            lng: 2.0,
            coordinate_precision: "country-reference".to_string(),
            coordinate_note: "symbolic".to_string(),
            from: 1.0,
            until: 2.0,
            score: 10.0,
            datasource: Some("ping".to_string()),
            method: Some("median".to_string()),
            from_before_query_window: false,
            until_equals_query_horizon: true,
        };
        let markers = build_internet_outage_markers(&[outage.clone(), outage]);
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].event_indices.len(), 2);
    }
}
