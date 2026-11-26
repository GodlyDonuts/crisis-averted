export type SeverityKey = "critical" | "high" | "medium" | "low";

export type CategoryGroup =
  | "kinetic"
  | "security"
  | "humanitarian"
  | "political"
  | "strategic";

export type TimeWindowKey = "24h" | "7d" | "30d" | "all";

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
  ucdp?: UcdpGedEventMetadata;
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

export interface OsintSnapshot {
  fetchedAt: string;
  sources: Record<string, string>;
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
