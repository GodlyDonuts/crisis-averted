export type SeverityKey = "critical" | "high" | "medium" | "low";

export type CategoryGroup =
  | "kinetic"
  | "security"
  | "humanitarian"
  | "political"
  | "strategic";

export type TimeWindowKey = "24h" | "7d" | "30d" | "all";

/**
 * Source-supported occurrence interval for one incident. `start` is inclusive and
 * `endExclusive` is exclusive, so exact frame-containment tests never need to infer
 * a duration or interpolate a time inside the interval. A "second" record means the
 * publisher supplied a timestamp; day/range records are uncertainty intervals, not
 * claims that the incident persisted for the whole interval.
 */
export interface IncidentOccurrenceWindow {
  start: number;
  endExclusive: number;
  precision: "second" | "day" | "range";
  basis: "publisher-second" | "publisher-day" | "publisher-range" | "inferred-day";
  label: string;
}

export type IncidentTemporalPrecision = IncidentOccurrenceWindow["precision"];

export interface ConflictSource {
  name: string;
  url: string;
}

/** Official UCDP GED fields retained with an ingested event. Field names intentionally mirror the UCDP API/codebook. */
export interface UcdpGedEventMetadata {
  id: number;
  relid: string | null;
  year: number | null;
  active_year: boolean | null;
  code_status: string | null;
  type_of_violence: number | null;
  conflict_new_id: number | null;
  conflict_name: string | null;
  dyad_new_id: number | null;
  dyad_name: string | null;
  side_a_new_id: number | null;
  side_a: string | null;
  side_b_new_id: number | null;
  side_b: string | null;
  number_of_sources: number | null;
  source_article: string | null;
  source_office: string | null;
  source_date: string | null;
  source_headline: string | null;
  source_original: string | null;
  where_prec: number | null;
  where_coordinates: string | null;
  where_description: string | null;
  adm_1: string | null;
  adm_2: string | null;
  priogrid_gid: number | null;
  country: string | null;
  country_id: number | null;
  region: string | null;
  event_clarity: number | null;
  date_prec: number | null;
  date_start: string | null;
  date_end: string | null;
  deaths_a: number | null;
  deaths_b: number | null;
  deaths_civilians: number | null;
  deaths_unknown: number | null;
  low: number | null;
  best: number | null;
  high: number | null;
  gwnoa: string | null;
  gwnob: string | null;
  dataset_version: string;
  dataset_release: string;
}

/**
 * Publisher family a conflict record originates from. Correlation treats records from
 * different families as independent evidence; records sharing a family are not independent
 * corroboration. "unknown" is the conservative fallback for untagged legacy records and is
 * never assumed independent of any other family.
 */
export type ConflictSourceFamily = "warheatmap" | "mapofwars" | "ucdp" | "acled" | "unknown";

/**
 * Evidentiary status of a canonical incident, derived from its evidence cluster:
 * - corroborated: at least two independent source families report the incident and no
 *   material contradiction was detected between their records.
 * - single-source: the incident rests on one source family only (typically a lone record);
 *   nothing independent corroborates it yet. This is a coverage statement, not a dismissal.
 * - inferred: multiple records were algorithmically grouped, but they all belong to a single
 *   source family, so the grouping is an inference about duplicate reporting rather than
 *   independent corroboration.
 * - contested: linked records materially disagree (fatalities, actors, or location spread).
 *   Contested takes precedence over corroborated because the disagreement must stay visible.
 */
export type IncidentCorrelationConfidence = "corroborated" | "single-source" | "inferred" | "contested";

export type IncidentContradictionKind = "fatalities" | "actors" | "location";

export interface IncidentContradiction {
  kind: IncidentContradictionKind;
  /** Deterministic human-readable explanation, e.g. which values disagree across which families. */
  summary: string;
  memberEventIds: string[];
}

/** One retained source record inside an evidence cluster. The full event is embedded so no report is ever discarded. */
export interface IncidentEvidenceMember {
  event: ConflictEvent;
  sourceFamily: ConflictSourceFamily;
  /** Pairwise correlation score of this record against the canonical representative, 0..1. */
  correlationScore: number;
  /** Ordered deterministic explanations of the evidence factors behind the score. */
  rationale: string[];
}

/**
 * Canonical-incident evidence cluster. Attached only to canonical representatives and only
 * when at least one additional report was correlated. `members` deliberately excludes the
 * canonical record itself: the canonical is the carrying event, and embedding it would create
 * a circular structure. Every correlated source record is retained here with provenance,
 * pairwise scores, and rationale — correlation never silently deletes a report.
 */
export interface IncidentEvidenceCluster {
  clusterId: string;
  canonicalEventId: string;
  algorithmVersion: string;
  confidence: IncidentCorrelationConfidence;
  /** One-line deterministic explanation of why this confidence label was assigned. */
  confidenceReason: string;
  sourceFamilies: ConflictSourceFamily[];
  independentFamilyCount: number;
  /** Total records in the cluster including the canonical representative. */
  memberCount: number;
  contradictions: IncidentContradiction[];
  members: IncidentEvidenceMember[];
}

/**
 * Lightweight membership summary attached to every correlated incident (canonical or not).
 * Survives even when the full evidence cluster is not attached, so feed/globe/export views
 * can display corroboration state without walking member lists.
 */
export interface IncidentMembership {
  clusterId: string;
  canonicalEventId: string;
  isCanonical: boolean;
  correlationScore: number;
  confidence: IncidentCorrelationConfidence;
  memberCount: number;
  independentFamilyCount: number;
  rationale: string[];
}

export interface ConflictEvent {
  id: string;
  lat: number;
  lng: number;
  precision: number | null;
  severity: SeverityKey;
  category: string;
  categoryGroup: CategoryGroup;
  date: string;
  occurredAt: number;
  updatedAt: number;
  killed: number;
  countedCasualties: number;
  displaced: number;
  country: string;
  conflict: string;
  theater: string;
  region: string;
  title: string;
  detail?: string | null;
  verified: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
  sources: ConflictSource[];
  intensity: number;
  /** Source-supported occurrence interval used by deterministic temporal playback. Legacy or test records may omit it; consumers then fall back to conservative inference. */
  occurrence?: IncidentOccurrenceWindow;
  ucdp?: UcdpGedEventMetadata;
  /** Publisher family assigned at normalization time; legacy records may omit it and are resolved as "unknown". */
  sourceFamily?: ConflictSourceFamily;
  /** Canonical-incident membership summary, present after the correlation pass. */
  incident?: IncidentMembership;
  /** Evidence cluster drill-down, present only on canonical representatives that absorbed at least one additional report. */
  evidence?: IncidentEvidenceCluster;
}

/** Deterministic statistics of one correlation pass, exposed for source-status transparency. */
export interface IncidentCorrelationStats {
  algorithmVersion: string;
  inputRecordCount: number;
  exactDuplicateRecordCount: number;
  correlationEligibleRecordCount: number;
  ineligibleRecordCount: number;
  incidentCount: number;
  multiMemberClusterCount: number;
  correlatedEvidenceRecordCount: number;
  contestedClusterCount: number;
  corroboratedClusterCount: number;
  inferredClusterCount: number;
  singleSourceClusterCount: number;
  candidatePairCount: number;
  evaluatedPairCount: number;
  elapsedMs: number;
}

export interface ConflictTheater {
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  eventCount: number;
  recentEventCount: number;
  criticalCount: number;
  highCount: number;
  killed: number;
  displaced: number;
  intensity: number;
  momentum: number;
  trend: "escalating" | "stable" | "cooling";
  latestAt: number;
  categories: Record<string, number>;
  topEvents: ConflictEvent[];
}

export interface ConflictFilters {
  timeWindow: TimeWindowKey;
  categoryGroups: CategoryGroup[];
  severities: SeverityKey[];
  theater: string | null;
  query: string;
}

export interface ConflictSummary {
  totalEvents: number;
  criticalEvents: number;
  highEvents: number;
  kineticEvents: number;
  humanitarianEvents: number;
  reportedKilled: number;
  reportedDisplaced: number;
  activeTheaters: number;
  latestEventAt: number;
}

export interface TimelineBucket {
  key: string;
  label: string;
  start: number;
  count: number;
  critical: number;
  intensity: number;
}

export interface WarHeatmapRawEvent {
  i?: string;
  la?: number;
  lo?: number;
  p?: number | null;
  s?: string;
  c?: string;
  d?: string;
  t?: string | null;
  k?: number | null;
  u?: number | null;
  x?: number | null;
  n?: string | null;
  cf?: string | null;
  dp?: number | null;
  ti?: string | null;
  r?: string | null;
  v?: boolean;
  sn?: string | null;
  su?: string | null;
  sc?: { name?: string; url?: string }[];
  et?: number | null;
}

export interface MilitaryAircraft {
  id: string;
  callsign: string;
  registration: string | null;
  aircraftType: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
  speed: number | null;
  track: number | null;
  squawk: string | null;
}


export interface OsintAircraft {
  id: string;
  callsign: string;
  originCountry: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
  speed: number | null;
  track: number | null;
  verticalRate: number | null;
  squawk: string | null;
  operatorClass: string;
  lastContact: string | null;
}

export interface OsintVessel {
  id: string;
  mmsi: number;
  imo: number | null;
  name: string;
  callSign: string | null;
  destination: string | null;
  shipType: number | null;
  vesselClass: string;
  navigationStatus: string;
  lat: number;
  lng: number;
  speed: number | null;
  course: number | null;
  heading: number | null;
  timestamp: string | null;
  source: string;
}


export interface OsintSatellite {
  id: string;
  name: string;
  group: string;
  catalogNumber: number;
  line1: string;
  line2: string;
  epoch: string;
}

export interface OsintNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface OsintLaunch {
  id: string;
  name: string;
  provider: string | null;
  location: string | null;
  lat: number;
  lng: number;
  net: string | null;
  url: string | null;
}


export type CyberEnrichmentServiceStatus = "ok" | "partial" | "preserved" | "unavailable" | "not-attempted";
export type CyberVulnerabilitySnapshotStatus = "ok" | "partial" | "preserved" | "unavailable";
export type NvdCvssMetricSet = "cvssMetricV40" | "cvssMetricV31" | "cvssMetricV30" | "cvssMetricV2";

export interface NvdDescription {
  lang: string;
  value: string;
}

export interface NvdCvssMetric {
  metricSet: NvdCvssMetricSet;
  source: string | null;
  type: string | null;
  vectorString: string | null;
  baseScore: number | null;
  baseSeverity: string | null;
  exploitabilityScore: number | null;
  impactScore: number | null;
}

export interface NvdWeakness {
  id: string;
  source: string | null;
  type: string | null;
}

export interface NvdReference {
  url: string;
  source: string | null;
  tags: string[];
}

export interface NvdCpeMatch {
  criteria: string;
  vulnerable: boolean | null;
  matchCriteriaId: string | null;
  versionStartIncluding: string | null;
  versionStartExcluding: string | null;
  versionEndIncluding: string | null;
  versionEndExcluding: string | null;
}

export interface NvdConfigurationNode {
  operator: string | null;
  negate: boolean | null;
  cpeMatch: NvdCpeMatch[];
  nodes: NvdConfigurationNode[];
}

export interface NvdConfiguration {
  operator: string | null;
  nodes: NvdConfigurationNode[];
}

export interface NvdAffectedVersion {
  version: string | null;
  status: string | null;
  versionType: string | null;
  lessThan: string | null;
  lessThanOrEqual: string | null;
  changes: { at: string; status: string }[];
}

export interface NvdAffectedProduct {
  source: string | null;
  vendor: string | null;
  product: string | null;
  collectionUrl: string | null;
  packageName: string | null;
  defaultStatus: string | null;
  platforms: string[];
  cpes: string[];
  modules: string[];
  versions: NvdAffectedVersion[];
}

export interface NvdEvidenceTruncation {
  descriptionsOmitted: number;
  referencesOmitted: number;
  referenceTagsOmitted: number;
  configurationsOmitted: number;
  cpeMatchesOmitted: number;
  affectedProductsOmitted: number;
  affectedVersionsOmitted: number;
  affectedFieldValuesOmitted: number;
  nonCweWeaknessValuesOmitted: number;
  invalidFieldCount: number;
}

export interface NvdCveEvidence {
  id: string;
  sourceIdentifier: string | null;
  vulnStatus: string | null;
  published: string | null;
  lastModified: string | null;
  descriptions: NvdDescription[];
  metrics: NvdCvssMetric[];
  weaknesses: NvdWeakness[];
  references: NvdReference[];
  configurations: NvdConfiguration[];
  affectedProducts: NvdAffectedProduct[];
  /** Original NVD API retrieval time. Cache/prior preservation never rewrites this timestamp. */
  retrievedAt: string;
  truncation: NvdEvidenceTruncation;
}

export interface EpssEvidence {
  cve: string;
  /** FIRST EPSS probability estimate for exploitation in the next 30 days; not observed exploitation evidence. */
  score: number;
  percentile: number;
  /** FIRST's supplied score date. */
  date: string | null;
  /** Original EPSS API retrieval time. Cache/prior preservation never rewrites this timestamp. */
  retrievedAt: string;
}

export interface OsintCyberVulnerability {
  cveId: string;
  vendor: string | null;
  product: string | null;
  name: string | null;
  dateAdded: string | null;
  dueDate: string | null;
  ransomwareUse: string | null;
  requiredAction: string | null;
  nvd: NvdCveEvidence | null;
  epss: EpssEvidence | null;
}

export interface CyberRateLimitCounters {
  requestAttemptCount: number;
  successfulRequestCount: number;
  retryCount: number;
  throttledResponseCount: number;
  retryDelayMsTotal: number;
  retryDelayMsMax: number;
}

export interface CyberKevProvenance {
  status: CyberEnrichmentServiceStatus;
  provider: string;
  apiUrl: string;
  requestUrl: string;
  retrievedAt: string | null;
  title: string | null;
  catalogVersion: string | null;
  dateReleased: string | null;
  reportedCount: number;
  fetchedRecordCount: number;
  validRecordCount: number;
  selectedRecordCount: number;
  maxSelectedRecords: number;
  omittedRecordCount: number;
  omittedByReason: {
    invalidRecord: number;
    duplicateCveId: number;
    selectionCap: number;
  };
}

export interface CyberNvdProvenance extends CyberRateLimitCounters {
  status: CyberEnrichmentServiceStatus;
  provider: string;
  apiBaseUrl: string;
  apiVersion: "2.0";
  /** Presence only; the build-time secret value is never serialized. */
  apiKeyConfigured: boolean;
  batchParameter: "cveIds";
  maxBatchSize: number;
  maxConcurrency: 1;
  configuredMinRequestIntervalMs: number;
  documentedPublicRequestsPerRolling30Seconds: number;
  documentedAuthenticatedRequestsPerRolling30Seconds: number;
  maxAttemptsPerBatch: number;
  retryFallbackDelayMs: number;
  maxRetryDelayMs: number;
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
  requestedCveCount: number;
  fetchedCveCount: number;
  freshCacheHitCount: number;
  negativeCacheHitCount: number;
  staleCacheHitCount: number;
  priorSnapshotHitCount: number;
  enrichedCveCount: number;
  omittedCveCount: number;
  omittedByReason: {
    missingNvdRecord: number;
    invalidNvdRecord: number;
    requestFailed: number;
    notAttempted: number;
  };
  requestUrls: string[];
  retrievedAt: string | null;
  statusDetail?: string | null;
}

export interface CyberEpssProvenance extends CyberRateLimitCounters {
  status: CyberEnrichmentServiceStatus;
  provider: string;
  apiBaseUrl: string;
  scope: "public";
  maxCveParameterChars: number;
  maxCvesPerBatch: number;
  maxConcurrency: 1;
  configuredMinRequestIntervalMs: number;
  maxAttemptsPerBatch: number;
  retryFallbackDelayMs: number;
  maxRetryDelayMs: number;
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
  requestedCveCount: number;
  fetchedCveCount: number;
  freshCacheHitCount: number;
  negativeCacheHitCount: number;
  staleCacheHitCount: number;
  priorSnapshotHitCount: number;
  enrichedCveCount: number;
  omittedCveCount: number;
  omittedByReason: {
    missingEpssRecord: number;
    invalidEpssRecord: number;
    requestFailed: number;
    notAttempted: number;
  };
  requestUrls: string[];
  retrievedAt: string | null;
  statusDetail?: string | null;
}

export interface CyberVulnerabilityMeta {
  status: CyberVulnerabilitySnapshotStatus;
  provider: string;
  selection: string;
  caveat: string;
  statusDetail: string | null;
  preservedAt: string | null;
  kev: CyberKevProvenance;
  nvd: CyberNvdProvenance;
  epss: CyberEpssProvenance;
  cache: {
    status: "ok" | "empty" | "unavailable" | "write-failed";
    path: string;
    version: number;
    loaded: boolean;
    written: boolean;
    detail: string | null;
  };
}

export type IodaEntityType = "country" | "region";
export type IodaCoordinatePrecision = "country-reference" | "region-reference";
export type IodaSnapshotStatus = "ok" | "preserved" | "unavailable";

export interface IodaInternetOutage {
  entityType: IodaEntityType;
  entityCode: string;
  entityName: string;
  countryCode: string | null;
  countryName: string | null;
  naturalEarthRegionId: string | null;
  lat: number;
  lng: number;
  coordinatePrecision: IodaCoordinatePrecision;
  coordinateNote: string;
  /** IODA event start in Unix seconds; it can precede the requested window because extendWindow is explicit. */
  from: number;
  /** IODA event end in Unix seconds. Equality with the query horizon is clipped/ambiguous, not proof of recovery. */
  until: number;
  /** IODA's source-specific event score. It is not an absolute or cross-source severity scale. */
  score: number;
  datasource: string | null;
  method: string | null;
  fromBeforeQueryWindow: boolean;
  untilEqualsQueryHorizon: boolean;
}

export interface IodaInternetOutageMeta {
  status: IodaSnapshotStatus;
  provider: string;
  apiBaseUrl: string;
  queryWindow: {
    from: number;
    until: number;
    fromIso: string;
    untilIso: string;
    lookbackSeconds: number;
    extendWindowSeconds: number;
  };
  entityTypes: IodaEntityType[];
  format: "ioda";
  overall: false;
  includeAlerts: false;
  pageLimit: number;
  maxPagesPerEntityType: number;
  fetchedEventCount: number;
  countryEventCount: number;
  regionEventCount: number;
  geolocatedEventCount: number;
  omittedEventCount: number;
  omittedByReason: {
    invalidEventContract: number;
    missingCoordinateReference: number;
  };
  requestUrls: string[];
  coordinateReference: string;
  caveat: string;
  statusDetail?: string;
  preservedAt?: string;
}

export type UcdpSnapshotStatus = "ok" | "unconfigured" | "degraded";

export interface UcdpIngestionMeta {
  status: UcdpSnapshotStatus;
  provider: string;
  resource: "gedevents";
  version: string;
  datasetRelease: string;
  apiEndpoint: string;
  codebook: string;
  authentication: string;
  releaseSelection: string;
  pageSize: number;
  maxPages: number;
  maxNormalizedEvents: number;
  totalCount: number | null;
  totalPages: number | null;
  pagesFetched: number;
  fetchedEventCount: number;
  uniqueCanonicalEventCount: number;
  validEventCount: number;
  ingestedEventCount: number;
  mergedEventCount: number;
  preservedPriorEventCount: number;
  omittedEventCount: number;
  omittedByReason: {
    missingCanonicalId: number;
    invalidCoordinates: number;
    invalidTime: number;
    invalidFatalityContract: number;
    invalidPrecisionContract: number;
    duplicateCanonicalId: number;
    highValueCap: number;
    mergeCap: number;
  };
  requestUrls: string[];
  selection: string;
  caveat: string;
  statusDetail?: string;
  preservedAt?: string;
}

export type GdeltGeoCollection = "english-web" | "machine-translated";

export type GdeltGeoCoordinatePrecision =
  | "us-state-centroid"
  | "us-city-or-landmark"
  | "world-city-or-landmark"
  | "world-admin1-centroid";

export type GdeltGeoSnapshotStatus = "ok" | "preserved" | "unavailable";

/**
 * One geolocated conflict-news media mention from the GDELT GKG 2.1 fifteen-minute feeds.
 * Every field is either supplied verbatim by GDELT or explicitly derived and documented in
 * gdeltGeoMeta; nothing is inferred. A mention is a place named inside news text near an
 * automated conflict-theme tag — it is never a verified incident location.
 */
export interface GdeltGeoNewsMention {
  id: string;
  url: string;
  /** Article headline. The GKG feed does not carry titles; present only where a DOC API cross-reference matched the exact article URL. */
  title: string | null;
  domain: string;
  collection: GdeltGeoCollection;
  locationName: string;
  /** GDELT location type code: 2=US state, 3=US city/landmark, 4=world city/landmark, 5=world admin-1. Type 1 (country) is out of scope by design. */
  locationType: number;
  coordinatePrecision: GdeltGeoCoordinatePrecision;
  countryCode: string | null;
  adm1Code: string | null;
  /** GDELT gazetteer feature id (numeric GNS/GNIS id or textual country/ADM1 code) as supplied. */
  featureId: string | number | null;
  lat: number;
  lng: number;
  /** Character distance between this location mention and the nearest conflict-theme mention in the document text, from GDELT-supplied offsets. */
  proximityChars: number;
  themes: string[];
  /** GDELT automated tone of the article (-100..100); not a measure of event severity. */
  tone: number | null;
  positiveScore: number | null;
  negativeScore: number | null;
  wordCount: number | null;
  /** Social sharing image URL supplied in the GKG SharingImage field, when present. */
  sharingImage: string | null;
  /** ISO timestamp of the fifteen-minute GDELT monitoring slot that captured this mention. Not a per-article publication time. */
  slotTime: string;
  /** Per-article first-seen time, present only where the DOC API cross-reference matched. */
  seenAt: string | null;
}

export interface GdeltGeoIngestionMeta {
  status: GdeltGeoSnapshotStatus;
  provider: string;
  attribution: string;
  geoApiNote: string;
  feedBaseUrl: string;
  conflictThemes: string[];
  proximityChars: number;
  slotsPerCollection: number;
  maxSlotAttempts: number;
  maxMentions: number;
  slotsIngested: {
    collection: GdeltGeoCollection;
    slotTimestamp: string;
    url: string;
    rowCount: number;
  }[];
  failedSlotDownloadCount: number;
  rowsScanned: number;
  invalidRowCount: number;
  conflictThemeRowCount: number;
  countryLevelMentionCount: number;
  subnationalMentionCount: number;
  proximalMentionCount: number;
  uniqueMentionCount: number;
  ingestedMentionCount: number;
  uniqueArticleCount: number;
  uniqueLocationCount: number;
  titleEnrichedArticleCount: number;
  omittedMentionCount: number;
  omittedByReason: {
    invalidCoordinates: number;
    notProximalToConflictTheme: number;
    duplicateMention: number;
    selectionCap: number;
  };
  titleEnrichment: {
    status: "ok" | "unavailable";
    apiEndpoint: string;
    query: string;
    maxRecords: number;
    timespan: string;
    sort: string;
    fetchedArticleCount: number;
    matchedArticleCount: number;
    requestUrl: string | null;
    detail: string | null;
  };
  requestUrls: string[];
  selection: string;
  caveat: string;
  statusDetail?: string;
  preservedAt?: string;
}

export interface SourceRegistryLicense {
  status: "open-license" | "public-domain" | "terms-identified" | "unknown";
  name: string | null;
  termsUrl: string | null;
  evidenceUrl: string | null;
  note: string;
}

export interface SourceRegistryAttribution {
  requirement: "required" | "requested" | "unknown" | "not-required";
  text: string;
  evidenceUrl: string | null;
  note: string;
}

export interface SourceRegistryRedistribution {
  status: "open" | "permitted-with-conditions" | "restricted-review" | "unknown";
  publicStaticRisk: "low" | "medium" | "high" | "unknown";
  bulkPublicExport: "permitted" | "permitted-with-conditions" | "license-or-permission-required" | "unknown" | "prohibited";
  constraints: string[];
  note: string;
}

export interface SourceLedgerEntry {
  sourceId: string;
  displayName: string;
  owner: string;
  endpointUrls: string[];
  documentationUrl: string | null;
  connectorVersion: string;
  authenticationMode: string;
  authenticationRequired: boolean;
  browserMode: string;
  cors: "enabled" | "disabled" | "unknown";
  runtimeFetchAllowed: boolean;
  license: SourceRegistryLicense;
  attribution: SourceRegistryAttribution;
  redistribution: SourceRegistryRedistribution;
  cadence: {
    publisherCadence: string;
    freshness: { warnAfterSeconds: number; staleAfterSeconds: number; timestampBasis: string; note: string };
  };
  confidence: { authority: string; verification: string; coverage: string; automation: string; caveats: string[] };
  retrieval: { status: string; detail: string | null; retrievedAt: string; recordCount: number | null };
}

export interface CollectionProvenanceLedgerEntry {
  collection: string;
  artifact: string;
  jsonPointer: string;
  recordCount: number;
  sourceIds: string[];
  sources: SourceLedgerEntry[];
  retrievalState: string;
  retrievedAt: string | null;
  freshness: {
    state: "current" | "aging" | "stale" | "preserved" | "unavailable" | "unknown";
    ageSeconds: number | null;
    basis: string;
    warnAfterSeconds: number;
    staleAfterSeconds: number;
  };
  dataVintage: { newestRecordTimestamp: string | null; timestampedRecordCount: number; note: string };
  normalizationSha256: string;
  provenanceSha256: string;
}

export interface SourceGovernanceSummary {
  collectionCount: number;
  involvedSourceCount: number;
  keyedSourceCount: number;
  keyedSourceIds: string[];
  unknownLicenseCount: number;
  unknownLicenseSourceIds: string[];
  highRiskSourceCount: number;
  highRiskSourceIds: string[];
  reviewRequiredSourceCount: number;
  reviewRequiredSourceIds: string[];
  highRiskCollectionCount: number;
  reviewRequiredCollectionCount: number;
  staleOrPreservedCollectionCount: number;
  licenseStatusCounts: Record<string, number>;
  redistributionRiskCounts: Record<string, number>;
  freshnessStateCounts: Record<string, number>;
}

export interface SourceGovernanceLedger {
  schemaVersion: string;
  governanceVersion: string;
  registryVersion: string;
  generatedAt: string;
  legalPosition: string;
  collections: Record<string, CollectionProvenanceLedgerEntry>;
  summary: SourceGovernanceSummary;
}

export interface OsintSnapshot {
  fetchedAt: string;
  sources: Record<string, string>;
  provenanceLedger?: SourceGovernanceLedger | null;
  militaryAircraft: MilitaryAircraft[];
  aircraft: OsintAircraft[];
  vessels: OsintVessel[];
  satellites: OsintSatellite[];
  news: OsintNewsArticle[];
  launches: OsintLaunch[];
  naturalEvents: OsintNaturalEvent[];
  gpsInterference: GpsInterferenceCell[];
  mapOfWarsEvents: MapOfWarsRawEvent[];
  webcams: OsintWebcam[];
  cyberVulnerabilities: OsintCyberVulnerability[];
  cyberVulnerabilityMeta: CyberVulnerabilityMeta | null;
  internetOutages: IodaInternetOutage[];
  internetOutageMeta: IodaInternetOutageMeta | null;
  ucdpMeta: UcdpIngestionMeta | null;
  gdeltGeoNews: GdeltGeoNewsMention[];
  gdeltGeoMeta: GdeltGeoIngestionMeta | null;
  errors: string[];
}

export interface OsintNaturalEvent {
  id: string;
  title: string;
  category: string;
  kind: string;
  lat: number;
  lng: number;
  occurredAt: string | null;
  magnitude: number | null;
  magnitudeUnit: string | null;
  url: string | null;
}

export interface GpsInterferenceCell {
  hex: string;
  goodAircraft: number;
  badAircraft: number;
  aircraftCount: number;
  affectedShare: number;
  level: "low" | "medium" | "high";
}


export interface MapOfWarsRawEvent {
  id?: string;
  kind?: string;
  lat?: number;
  lon?: number;
  title?: string;
  detail?: string;
  level?: number;
  ts?: number;
  source?: string;
  violence?: string;
  note?: string;
  url?: string;
  ucdp?: UcdpGedEventMetadata;
}


export interface OsintWebcam {
  id: string;
  title: string;
  lat: number;
  lng: number;
  city: string | null;
  region: string | null;
  country: string | null;
  status: string | null;
  categories: string[];
  detailUrl: string | null;
  playerUrl: string | null;
}

/* ------------------------------------------------------------------------- */
/* Multi-domain convergence intelligence (catalog batch 7)                    */
/* ------------------------------------------------------------------------- */

/**
 * Evidence domains participating in multi-domain convergence analysis. The conflict
 * incident is the anchor entity; every other domain is evidence/context. Orbital objects
 * are deliberately absent: propagated satellite positions sweep the globe continuously,
 * so spatial proximity to a terrestrial incident carries no discriminating evidence and
 * including them would manufacture coincidence. Space launches (fixed pads, published
 * windows) are the appropriate orbital-domain evidence and are included instead.
 */
export type ConvergenceDomain =
  | "gnss-interference"
  | "military-aviation"
  | "civil-aviation"
  | "ais-vessel"
  | "space-launch"
  | "environmental-event"
  | "connectivity-outage"
  | "media-attention";

/**
 * Measurement family an evidence domain belongs to. Corroboration counting uses families,
 * not raw domains, because domains sharing a sensor ecosystem are not independent of each
 * other: gpsjam.org interference grids are derived from aircraft navigation-quality
 * reports, so GNSS interference and aviation positions are facets of one aviation-derived
 * measurement family and can never corroborate each other.
 */
export type ConvergenceEvidenceFamily =
  | "aviation-derived"
  | "maritime-ais"
  | "spaceflight-schedule"
  | "environmental-sensors"
  | "network-measurement"
  | "media-attention";

/**
 * Card-level convergence classification. These labels describe evidence geometry only —
 * never causality, intent, or operational attribution:
 * - corroboration: spatial-temporal alignments qualified in at least two independent
 *   non-media measurement families.
 * - correlation: alignments qualified in exactly one independent measurement family.
 * - coincidence: spatial-temporal overlap exists but nothing qualified as independent
 *   evidence — structurally expected co-occurrence (dense civil aviation, long-scheduled
 *   launches), weak evidence, or media-attention-only alignment. Media attention is
 *   derivative of the same event ecosystem as conflict reporting and is never independent
 *   corroboration, so media-only cards are coincidence-class with that reasoning attached.
 * Evidence gaps are not a classification; they are annotated per card and per analysis.
 */
export type ConvergenceClassification = "corroboration" | "correlation" | "coincidence";

/** A domain whose evidence could not be evaluated at all, with the reason. Absence of a
 *  converging observation is NOT a gap — a gap means the data needed to look was missing. */
export interface ConvergenceEvidenceGap {
  domain: ConvergenceDomain;
  reason: string;
}

/** One independent evidence factor inside a pairwise assessment. `score` null means the
 *  evidence is structurally absent (e.g. no magnitude supplied); absent evidence contributes
 *  zero at full weight and is never renormalized upward. */
export interface ConvergenceFactor {
  key: "spatial" | "temporal" | "strength" | "squawk" | "significance" | "proximity";
  score: number | null;
  weight: number;
  rationale: string;
}

/** Provenance of the single domain observation behind a finding. */
export interface ConvergenceFindingProvenance {
  source: string;
  url: string | null;
  observedAt: string | null;
  note: string | null;
}

/**
 * One deterministic pairwise spatial-temporal assessment between the anchor incident and
 * a single domain observation. Everything needed to reproduce the verdict is carried here:
 * distances, times, per-factor scores with weights, and ordered rationale lines.
 */
export interface ConvergencePairFinding {
  observationId: string;
  domain: ConvergenceDomain;
  family: ConvergenceEvidenceFamily;
  /** Short human-readable identity of the observation (vessel name, outage entity, hex cell, article location). */
  label: string;
  detail: string | null;
  url: string | null;
  /** Raw great-circle distance between the incident fix and the observation reference point, km. */
  distanceKm: number;
  /** Distance after subtracting native area radius (GNSS hex cells); the distance the evidence actually supports. */
  effectiveDistanceKm: number;
  /** Hours between the temporal windows; 0 means they overlap. */
  timeGapHours: number;
  /** Weighted sum of positive evidence, 0..1. */
  score: number;
  /** Score met the pair-type qualification bar and any pair-specific structural requirements. */
  qualifies: boolean;
  /** False when the pair type is structurally coincidence-only (launches) or fails a discriminating-evidence requirement. */
  countsAsEvidence: boolean;
  factors: ConvergenceFactor[];
  rationale: string[];
  provenance: ConvergenceFindingProvenance;
}

/** All findings between the anchor incident and one evidence domain, best-first. */
export interface ConvergenceDomainAlignment {
  domain: ConvergenceDomain;
  family: ConvergenceEvidenceFamily;
  /** Whether this domain is allowed to count toward independent corroboration. Media attention never does. */
  independent: boolean;
  bestScore: number;
  qualifies: boolean;
  /** Observations inside the hard spatial-temporal gates. */
  findingCount: number;
  qualifyingFindingCount: number;
  /** Strongest findings retained for drill-down (qualifying first, then score, deterministic). */
  findings: ConvergencePairFinding[];
  /** Domain-level caveat, e.g. regional AIS coverage or snapshot-instant aviation positions. Null when none applies. */
  coverageNote: string | null;
}

/**
 * Multi-domain convergence card for one anchor incident. The card is a co-occurrence
 * digest: it never asserts that the aligned observations caused, enabled, or are otherwise
 * operationally related to the incident.
 */
export interface IncidentConvergenceCard {
  eventId: string;
  algorithmVersion: string;
  classification: ConvergenceClassification;
  /** One-line deterministic explanation of why this classification was assigned. */
  classificationReason: string;
  /** Ranking device only — not a probability. Exact formula is documented in uncertaintyNotes. */
  convergenceIndex: number;
  independentFamilyCount: number;
  qualifyingDomainCount: number;
  /** Domains with at least one finding inside the gates, strongest first. */
  domains: ConvergenceDomainAlignment[];
  /** Independent non-media measurement families that qualified, sorted. */
  independentFamilies: ConvergenceEvidenceFamily[];
  evidenceGaps: ConvergenceEvidenceGap[];
  uncertaintyNotes: string[];
  disclaimer: string;
}

/** Deterministic statistics of one convergence analysis pass. */
export interface DomainConvergenceStats {
  algorithmVersion: string;
  anchorEventCount: number;
  eligibleAnchorCount: number;
  ineligibleAnchorCount: number;
  observationsByDomain: Record<ConvergenceDomain, number>;
  candidatePairCount: number;
  evaluatedPairCount: number;
  findingCount: number;
  qualifyingFindingCount: number;
  cardCount: number;
  corroborationCount: number;
  correlationCount: number;
  coincidenceCount: number;
  /** Country-scope connectivity pair evaluations performed through exact canonicalized
   *  country-name matches. Mismatched rows are never spuriously evaluated — they simply
   *  never become candidates — so no rejection counting is needed. */
  countryScopeEvaluationCount: number;
  elapsedMs: number;
}

export interface DomainConvergenceAnalysis {
  algorithmVersion: string;
  /** Cards sorted by convergenceIndex descending then event id ascending. Only incidents
   *  with at least one in-gate finding receive a card; absence of a card means no
   *  spatial-temporal overlap was found, which is not evidence of absence. */
  cards: IncidentConvergenceCard[];
  /** Analysis-level evidence gaps (domain sources empty/unavailable in the loaded snapshot). */
  gaps: ConvergenceEvidenceGap[];
  /** Global caveats that apply to every card, e.g. snapshot-instant transport positions. */
  globalNotes: string[];
  stats: DomainConvergenceStats;
}

/* ------------------------------------------------------------------------- */
/* Escalation-surge indicators and analyst watch rules (catalog batch 8)      */
/* ------------------------------------------------------------------------- */

/** Aggregation scopes supported by deterministic escalation-surge analysis. */
export type EscalationGroupKind = "theater" | "region";

/**
 * Statistical change labels for the loaded incident corpus. These are indicators only:
 * they do not predict future escalation, certify current danger, or carry operational
 * warning authority. `uncertain-change` means the upper/lower temporal bounds admit an
 * increase but uncertainty or evidence support is too weak for a watch/surge indicator.
 */
export type EscalationSignalLevel =
  | "surge-indicator"
  | "watch-indicator"
  | "uncertain-change"
  | "no-signal"
  | "insufficient-evidence";

export interface EscalationAnalysisWindow {
  start: number;
  endExclusive: number;
  label: string;
}

/**
 * Uncertainty-aware ratio bounds. `lower` uses the conservative current count over the
 * maximum plausible baseline count; `upper` uses the maximum plausible current count over
 * the conservative baseline count. Null plus an unbounded flag means the corresponding
 * denominator can be zero, so no finite ratio is claimed. If both sides can be zero the
 * ratio is undefined rather than silently smoothed into certainty.
 */
export interface EscalationRatioBounds {
  defined: boolean;
  lower: number | null;
  upper: number | null;
  lowerUnbounded: boolean;
  upperUnbounded: boolean;
}

/** Deterministic metric bundle for one theater/region over recent and baseline windows. */
export interface EscalationMetricSet {
  currentDefiniteCount: number;
  currentPossibleCount: number;
  baselineDefiniteCount: number;
  baselinePossibleCount: number;
  /** Incidents per UTC day under definite/possible temporal membership. */
  currentRatePerDay: { definite: number; possible: number };
  baselineRatePerDay: { definite: number; possible: number };
  incidentRateRatio: EscalationRatioBounds;
  /** Severity/casualty/displacement-weighted intensity sums per day. Recency is deliberately absent. */
  currentIntensityPerDay: { definite: number; possible: number };
  baselineIntensityPerDay: { definite: number; possible: number };
  intensityRatio: EscalationRatioBounds;
  corroboratedShareCurrent: number | null;
  corroboratedShareBaseline: number | null;
  corroboratedShareDelta: number | null;
  contestedShareCurrent: number | null;
  contestedShareBaseline: number | null;
  meanIndependentFamiliesCurrent: number | null;
  meanIndependentFamiliesBaseline: number | null;
  /** Definite-current incidents whose category+1° cell facet is absent even from possible baseline membership. */
  novelCurrentCount: number;
  novelFacetShare: number;
  novelFacetExamples: string[];
  /** Positive definite current activity while no incident uncertainty window intersects baseline. */
  onsetVsBaseline: boolean;
  /** Possible-but-not-definite memberships caused by source time uncertainty at the window boundaries. */
  currentBoundaryAmbiguousCount: number;
  baselineBoundaryAmbiguousCount: number;
}

/** Compact, exportable evidence reference for a surge signal or watch alert. */
export interface EscalationEvidenceRef {
  eventId: string;
  title: string;
  occurredAt: number;
  theater: string;
  region: string;
  country: string;
  category: string;
  severity: SeverityKey;
  casualtyMeasure: number;
  temporalMembership: "definite" | "possible";
  correlationConfidence: IncidentCorrelationConfidence | null;
  independentFamilyCount: number;
  evidenceReportCount: number;
  evidenceMemberEventIds: string[];
  sourceName: string | null;
  sourceUrl: string | null;
}

/** One deterministic theater/region surge assessment. */
export interface EscalationSignal {
  id: string;
  algorithmVersion: string;
  groupKind: EscalationGroupKind;
  groupKey: string;
  groupLabel: string;
  level: EscalationSignalLevel;
  /** True for surge/watch/uncertain change cards that merit analyst review; false for quiet/insufficient groups. */
  isSignal: boolean;
  /** Ranking index 0..100. It is not a probability and never represents prediction confidence. */
  indicatorScore: number;
  /** Evidence-support index 0..100 based on temporal definiteness, baseline coverage, volume, and corroboration. */
  evidenceSupport: number;
  rateScore: number;
  intensityScore: number;
  corroborationScore: number;
  noveltyScore: number;
  metrics: EscalationMetricSet;
  explanations: string[];
  uncertaintyNotes: string[];
  evidenceRefs: EscalationEvidenceRef[];
  disclaimer: string;
}

export interface EscalationSurgeStats {
  algorithmVersion: string;
  inputIncidentCount: number;
  invalidTimeCount: number;
  futureExcludedCount: number;
  analyzedIncidentCount: number;
  retainedEvidenceReportCount: number;
  theaterGroupCount: number;
  regionGroupCount: number;
  surgeIndicatorCount: number;
  watchIndicatorCount: number;
  uncertainChangeCount: number;
  insufficientEvidenceCount: number;
  boundaryAmbiguousMembershipCount: number;
  elapsedMs: number;
}

export interface EscalationSurgeAnalysis {
  algorithmVersion: string;
  analysisEnd: number;
  recentWindow: EscalationAnalysisWindow;
  baselineWindow: EscalationAnalysisWindow;
  /** Fraction of the baseline window overlapped by the observed corpus span. This is a conservative coverage cue, not proof of complete ingestion. */
  baselineCoverageRatio: number;
  corpusStart: number;
  corpusEndExclusive: number;
  signals: EscalationSignal[];
  globalNotes: string[];
  stats: EscalationSurgeStats;
  disclaimer: string;
}

/* Analyst-defined watch rules. Rules and alert lifecycle state are static local browser data. */

export type WatchRuleConditionKind =
  | "surge-level"
  | "incident-count"
  | "casualty-impact"
  | "corroborated-incident";

export type WatchRuleTimeWindow = "24h" | "72h" | "7d";
export type WatchRuleSurgeThreshold = "watch-indicator" | "surge-indicator";

export interface WatchRuleFilters {
  theater: string | null;
  region: string | null;
  country: string | null;
  category: string | null;
  /** Empty means all category groups. */
  categoryGroups: CategoryGroup[];
  /** Empty means all severities. */
  severities: SeverityKey[];
}

export interface WatchRuleCondition {
  kind: WatchRuleConditionKind;
  /** Meaning depends on kind: incidents, casualty measure, or independent source families. Unused for surge-level. */
  threshold: number;
  /** Trailing evaluation window for event-based rules. Surge-level rules use the surge engine's fixed recent/baseline windows. */
  window: WatchRuleTimeWindow;
  surgeLevel: WatchRuleSurgeThreshold;
}

export interface WatchRule {
  id: string;
  version: 1;
  name: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  condition: WatchRuleCondition;
  filters: WatchRuleFilters;
}

/** Local lifecycle state keyed by alert fingerprint. Alerts themselves are recomputed; state never alters incident evidence. */
export interface WatchAlertState {
  fingerprint: string;
  ruleId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  dismissedAt: number | null;
  snoozedUntil: number | null;
}

export type WatchAlertEmphasis = "standard" | "elevated";

/** Non-destructive in-app alert instance generated by deterministic local rule evaluation. */
export interface WatchAlert {
  fingerprint: string;
  algorithmVersion: string;
  ruleId: string;
  ruleName: string;
  conditionKind: WatchRuleConditionKind;
  emphasis: WatchAlertEmphasis;
  triggeredAt: number;
  title: string;
  summary: string;
  explanations: string[];
  evidenceRefs: EscalationEvidenceRef[];
  definiteIncidentCount: number;
  possibleIncidentCount: number;
  boundaryAmbiguousCount: number;
  window: EscalationAnalysisWindow;
  surgeSignalIds: string[];
  disclaimer: string;
}

export interface WatchRuleEvaluation {
  ruleId: string;
  ruleName: string;
  enabled: boolean;
  triggered: boolean;
  explanation: string;
  definiteIncidentCount: number;
  possibleIncidentCount: number;
  alert: WatchAlert | null;
}

export interface WatchEvaluationStats {
  algorithmVersion: string;
  ruleCount: number;
  enabledRuleCount: number;
  disabledRuleCount: number;
  triggeredRuleCount: number;
  evaluatedEventCount: number;
  elapsedMs: number;
}

export interface WatchEvaluationResult {
  algorithmVersion: string;
  evaluatedAt: number;
  alerts: WatchAlert[];
  evaluations: WatchRuleEvaluation[];
  stats: WatchEvaluationStats;
  disclaimer: string;
}
