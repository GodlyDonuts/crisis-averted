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


export interface OsintCyberVulnerability {
  cveId: string;
  vendor: string | null;
  product: string | null;
  name: string;
  dateAdded: string | null;
  dueDate: string | null;
  ransomwareUse: string;
  requiredAction: string | null;
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
  internetOutages: IodaInternetOutage[];
  internetOutageMeta: IodaInternetOutageMeta | null;
  ucdpMeta: UcdpIngestionMeta | null;
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
