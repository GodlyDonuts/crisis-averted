import { cellToBoundary, cellToLatLng, getResolution, isValidCell } from "h3-js";
import type {
  ConflictEvent,
  ConvergenceClassification,
  ConvergenceDomain,
  ConvergenceDomainAlignment,
  ConvergenceEvidenceFamily,
  ConvergenceEvidenceGap,
  ConvergenceFactor,
  DomainConvergenceAnalysis,
  DomainConvergenceStats,
  GdeltGeoNewsMention,
  GpsInterferenceCell,
  IncidentConvergenceCard,
  IncidentTemporalPrecision,
  IodaInternetOutage,
  MilitaryAircraft,
  OsintAircraft,
  OsintLaunch,
  OsintNaturalEvent,
  OsintVessel,
  ReliefWebRecord,
} from "@/types/conflict";
import { resolveIncidentOccurrenceWindow } from "@/lib/incidentTime";

/**
 * Deterministic, explainable multi-domain convergence intelligence (catalog batch 7).
 *
 * Design contract:
 * - Co-occurrence is not causation. The engine measures spatial-temporal convergence
 *   between conflict incidents and independent evidence domains. It never asserts that an
 *   aligned observation caused, enabled, or is operationally related to an incident, and
 *   every output surface carries that disclaimer.
 * - Independence is modeled honestly. Evidence domains are grouped into measurement
 *   families; gpsjam.org interference grids are derived from aircraft navigation-quality
 *   reports, so GNSS interference and aviation positions form ONE aviation-derived family
 *   and cannot corroborate each other. GDELT media attention is derivative of the same
 *   event ecosystem as conflict reporting and never counts as independent corroboration.
 * - Coincidence is a first-class outcome. Structurally expected co-occurrence (dense civil
 *   aviation, long-scheduled space launches) and weak or media-only alignment classify as
 *   coincidence, with the reasoning attached — the system earns trust by what it refuses
 *   to call evidence.
 * - Coarse geography is discounted, never trusted. Country-scope connectivity reference
 *   points, admin-1 media centroids, and coarse incident fixes (precision 5-7) contribute
 *   heavily discounted spatial evidence so shared centroids cannot fabricate convergence.
 * - No clocks, no randomness. Given the same inputs the analysis is byte-stable; the only
 *   time inputs are the observations' own publisher/supplied windows.
 * - Spatial indexing: evidence observations are binned into a uniform 1°x1° spherical grid
 *   and anchors scan only the cells intersecting their per-pair-type gate bounding box, so
 *   work scales with local density rather than naively O(anchors x observations).
 */

export const CONVERGENCE_ALGORITHM_VERSION = "domain-convergence-v1";

export const CONVERGENCE_DISCLAIMER =
  "Convergence is co-occurrence, not causation. These classifications describe evidence geometry only — never causality, intent, operational relationships, or attribution. Absence of convergence is not evidence of absence.";

const SECOND_MS = 1000;
const HOUR_MS = 36e5;
const DAY_MS = 24 * HOUR_MS;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const la1 = (lat1 * Math.PI) / 180;
  const la2 = (lat2 * Math.PI) / 180;
  const dLat = la2 - la1;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/* ------------------------------------------------------------------------- */
/* Country canonicalization (approximate, documented)                          */
/* ------------------------------------------------------------------------- */

/**
 * Deterministic canonicalization for country-name comparison. Used ONLY for country-scope
 * connectivity evidence, where the publisher supplies a national entity and distance to a
 * symbolic reference point is meaningless. Both sides pass through the same alias table;
 * aliases not in the table simply fail to match, which is a documented coverage limitation
 * (a missed match is never treated as a mismatch elsewhere in the engine).
 */
const COUNTRY_ALIAS_CANONICAL: Record<string, string> = {
  russianfederation: "russia",
  syrianarabrepublic: "syria",
  iranislamicrepublicof: "iran",
  venezuelabolivarianrepublicof: "venezuela",
  laopeoplesdemocraticrepublic: "laos",
  koreademocraticpeoplesrepublicof: "northkorea",
  korearepublicof: "southkorea",
  moldovarepublicof: "moldova",
  tanzaniaunitedrepublicof: "tanzania",
  egyptarabrepublicof: "egypt",
  democraticrepublicofthecongo: "democraticrepubliccongo",
  drcongo: "democraticrepubliccongo",
  congodemocraticrepublic: "democraticrepubliccongo",
  ivorycoast: "cotedivoire",
  czechia: "czechrepublic",
  burma: "myanmar",
  macedonia: "northmacedonia",
  unitedstatesofamerica: "unitedstates",
  usa: "unitedstates",
  us: "unitedstates",
  boliviaplurinationalstateof: "bolivia",
  libya: "libya",
  libyanarabjamahiriya: "libya",
  republicofthecongo: "congo",
  turkiye: "turkey",
  vietnam: "vietnam",
  vietnamesepublic: "vietnam",
};

export function canonicalizeCountryKey(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return "";
  return COUNTRY_ALIAS_CANONICAL[normalized] ?? normalized;
}

/* ------------------------------------------------------------------------- */
/* Observation model                                                           */
/* ------------------------------------------------------------------------- */

export type ConvergenceObservation = {
  id: string;
  domain: ConvergenceDomain;
  family: ConvergenceEvidenceFamily;
  lat: number;
  lng: number;
  windowStart: number;
  windowEndExclusive: number;
  /** Temporal character of the window: a measured instant, a publisher interval, or a day-resolution stamp. */
  temporalKind: "instant" | "interval" | "day" | "snapshot-instant";
  /** Mobility class of the observed entity. Fast movers (aircraft) leave their recorded
   *  position within minutes, so temporal evidence decays fast and even overlapping a
   *  day-precision incident window establishes only same-day presence. Slow movers
   *  (vessels) hold position for hours. Fixed evidence (interference cells, outages,
   *  media mentions, launch pads, environmental events) persists at its location. */
  mobility: "fast" | "slow" | "fixed";
  /** 0..1 multiplier applied to spatial decay evidence; coarse geography yields weak evidence. */
  spatialConfidence: number;
  spatialNote: string | null;
  /** Native area radius subtracted from center-to-center distance (GNSS hex cells only). */
  areaRadiusKm: number;
  countryKey: string;
  label: string;
  detail: string | null;
  url: string | null;
  provenanceSource: string;
  provenanceObservedAt: string | null;
  provenanceNote: string | null;
  /** Domain payloads used by pair-specific evidence factors. */
  gnssAffectedShare?: number;
  gnssLevel?: string;
  gnssCellCount?: number;
  squawk?: string | null;
  emergencySquawk?: boolean;
  magnitude?: number | null;
  magnitudeUnit?: string | null;
  environmentalCategory?: string;
  connectivityScope?: "country" | "region";
  mediaProximityChars?: number;
  /** True when the observation's own geography is too coarse to establish same-place
   *  convergence (state/admin-1 gazetteer centroids). Such observations are surfaced as
   *  coincidence-class context but can never qualify as evidence — centroid coincidence
   *  must not fabricate corroboration. */
  neverEvidence?: boolean;
  neverEvidenceNote?: string;
};

export interface ConvergenceEvidenceInput {
  fetchedAt: string;
  sources: Record<string, string>;
  militaryAircraft: MilitaryAircraft[];
  aircraft: OsintAircraft[];
  vessels: OsintVessel[];
  launches: OsintLaunch[];
  naturalEvents: OsintNaturalEvent[];
  gpsInterference: GpsInterferenceCell[];
  internetOutages: IodaInternetOutage[];
  gdeltGeoNews: GdeltGeoNewsMention[];
  reliefwebRecords: ReliefWebRecord[];
}

export interface EvidenceLayers {
  observations: ConvergenceObservation[];
  byDomain: Record<ConvergenceDomain, ConvergenceObservation[]>;
  gaps: ConvergenceEvidenceGap[];
  notes: string[];
  droppedByDomain: Record<ConvergenceDomain, number>;
}

const DOMAIN_FAMILY: Record<ConvergenceDomain, ConvergenceEvidenceFamily> = {
  "gnss-interference": "aviation-derived",
  "military-aviation": "aviation-derived",
  "civil-aviation": "aviation-derived",
  "ais-vessel": "maritime-ais",
  "space-launch": "spaceflight-schedule",
  "environmental-event": "environmental-sensors",
  "connectivity-outage": "network-measurement",
  "media-attention": "media-attention",
  "humanitarian-context": "humanitarian-context",
};

/** Domains allowed to count toward independent corroboration. Media attention is derivative
 *  of the conflict-reporting ecosystem and is permanently excluded. */
export const DOMAIN_INDEPENDENCE: Record<ConvergenceDomain, boolean> = {
  "gnss-interference": true,
  "military-aviation": true,
  "civil-aviation": true,
  "ais-vessel": true,
  "space-launch": true,
  "environmental-event": true,
  "connectivity-outage": true,
  "media-attention": false,
  "humanitarian-context": false,
};

function instantWindow(ms: number): { start: number; endExclusive: number } {
  const start = Math.floor(ms / SECOND_MS) * SECOND_MS;
  return { start, endExclusive: start + SECOND_MS };
}

function sortObservations(observations: ConvergenceObservation[]): ConvergenceObservation[] {
  return [...observations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function buildGnssObservations(
  cells: GpsInterferenceCell[],
  input: ConvergenceEvidenceInput,
  notes: string[],
): ConvergenceObservation[] {
  if (cells.length === 0) return [];
  // gpsjam.org publishes daily H3 resolution-4 grids. The snapshot records the publisher
  // date inside the human-readable source string ("gpsjam.org daily H3 interference
  // (YYYY-MM-DD)"); that date is the only publisher time the feed supplies. When it cannot
  // be parsed we fall back to the snapshot retrieval day and say so in every rationale.
  const sourceLine = input.sources?.gpsInterference ?? "";
  const dateMatch = sourceLine.match(/(\d{4})-(\d{2})-(\d{2})/);
  let dayStart: number | null = null;
  let dateBasis: "publisher-date" | "snapshot-retrieval-day-fallback" = "publisher-date";
  if (dateMatch) {
    dayStart = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
  } else {
    const fetchedMs = parseIsoMs(input.fetchedAt);
    if (fetchedMs !== null) {
      dayStart = Math.floor(fetchedMs / DAY_MS) * DAY_MS;
      dateBasis = "snapshot-retrieval-day-fallback";
    }
  }
  if (dayStart === null) return [];
  if (dateBasis !== "publisher-date") {
    notes.push("GNSS interference date could not be parsed from the source ledger; the snapshot retrieval day is used as a documented fallback with reduced temporal confidence.");
  }
  const observations: ConvergenceObservation[] = [];
  for (const cell of cells) {
    if (!isValidCell(cell.hex)) continue;
    const [lat, lng] = cellToLatLng(cell.hex);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // Per-cell measured radius: maximum center-to-vertex distance of the actual hexagon,
    // so the area adjustment never overestimates overlap for distorted high-latitude cells.
    const boundary = cellToBoundary(cell.hex);
    let radiusKm = 0;
    for (const [vertexLat, vertexLng] of boundary) {
      radiusKm = Math.max(radiusKm, haversineKm(lat, lng, vertexLat, vertexLng));
    }
    const resolution = getResolution(cell.hex);
    observations.push({
      id: `gnss:${cell.hex}`,
      domain: "gnss-interference",
      family: DOMAIN_FAMILY["gnss-interference"],
      lat,
      lng,
      windowStart: dayStart,
      windowEndExclusive: dayStart + DAY_MS,
      temporalKind: "day",
      mobility: "fixed",
      spatialConfidence: 0.6,
      spatialNote: `H3 resolution-${resolution} cell: interference is natively cell-area evidence (~${Math.round(radiusKm)} km measured center-to-vertex radius), so proximity is inherently coarse`,
      areaRadiusKm: radiusKm,
      countryKey: "",
      label: `cell ${cell.hex.slice(0, 9)}…`,
      detail: `${cell.badAircraft}/${cell.aircraftCount} aircraft reporting interference (${Math.round(cell.affectedShare * 100)}%), level ${cell.level}`,
      url: "https://gpsjam.org/",
      provenanceSource: "gpsjam.org daily H3 interference grid",
      provenanceObservedAt: new Date(dayStart).toISOString().slice(0, 10),
      provenanceNote: dateBasis === "publisher-date"
        ? "interference date is the publisher's daily grid date; the grid is derived from aircraft navigation-quality reports (aviation-derived measurement family)"
        : "publisher date unparsable; snapshot retrieval day used as fallback",
      gnssAffectedShare: cell.affectedShare,
      gnssLevel: cell.level,
      gnssCellCount: cell.aircraftCount,
    });
  }
  return sortObservations(observations);
}

function buildMilitaryAircraftObservations(
  aircraft: MilitaryAircraft[],
  snapshotMs: number | null,
): ConvergenceObservation[] {
  if (aircraft.length === 0 || snapshotMs === null) return [];
  const window = instantWindow(snapshotMs);
  return sortObservations(aircraft
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .map((item) => ({
      id: `milair:${item.id}`,
      domain: "military-aviation" as const,
      family: DOMAIN_FAMILY["military-aviation"],
      lat: item.lat,
      lng: item.lng,
      windowStart: window.start,
      windowEndExclusive: window.endExclusive,
      temporalKind: "snapshot-instant" as const,
      mobility: "fast" as const,
      spatialConfidence: 0.95,
      spatialNote: null,
      areaRadiusKm: 0,
      countryKey: "",
      label: item.callsign || item.id,
      detail: [item.aircraftType, item.registration].filter(Boolean).join(" · ") || null,
      url: null,
      provenanceSource: "adsb.lol /v2/mil",
      provenanceObservedAt: input0Iso(snapshotMs),
      provenanceNote: "per-aircraft contact time is not supplied by this feed; the snapshot retrieval instant is the documented observation time",
      squawk: item.squawk ?? null,
    })));
}

function input0Iso(ms: number): string {
  return new Date(ms).toISOString();
}

function buildCivilAircraftObservations(aircraft: OsintAircraft[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const item of aircraft) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
    const contactMs = parseIsoMs(item.lastContact);
    if (contactMs === null) continue;
    const window = instantWindow(contactMs);
    const squawk = (item.squawk ?? "").trim();
    const emergencySquawk = squawk === "7700" || squawk === "7500";
    observations.push({
      id: `civair:${item.id}`,
      domain: "civil-aviation",
      family: DOMAIN_FAMILY["civil-aviation"],
      lat: item.lat,
      lng: item.lng,
      windowStart: window.start,
      windowEndExclusive: window.endExclusive,
      temporalKind: "instant",
      mobility: "fast",
      spatialConfidence: 0.95,
      spatialNote: null,
      areaRadiusKm: 0,
      countryKey: "",
      label: item.callsign || item.id,
      detail: [item.originCountry, item.operatorClass].filter(Boolean).join(" · ") || null,
      url: null,
      provenanceSource: "OpenSky Network live state vectors",
      provenanceObservedAt: item.lastContact,
      provenanceNote: "single-position state vector; civil aviation is structurally dense near populated areas, so proximity without an emergency squawk is treated as expected coincidence",
      squawk: item.squawk ?? null,
      emergencySquawk: emergencySquawk || squawk === "7600",
    });
  }
  return sortObservations(observations);
}

function buildVesselObservations(vessels: OsintVessel[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const vessel of vessels) {
    if (!Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lng)) continue;
    const timestampMs = parseIsoMs(vessel.timestamp);
    if (timestampMs === null) continue;
    const window = instantWindow(timestampMs);
    observations.push({
      id: `vessel:${vessel.id}`,
      domain: "ais-vessel",
      family: DOMAIN_FAMILY["ais-vessel"],
      lat: vessel.lat,
      lng: vessel.lng,
      windowStart: window.start,
      windowEndExclusive: window.endExclusive,
      temporalKind: "instant",
      mobility: "slow",
      spatialConfidence: 0.95,
      spatialNote: null,
      areaRadiusKm: 0,
      countryKey: "",
      label: vessel.name || vessel.id,
      detail: [vessel.vesselClass, vessel.navigationStatus, vessel.destination ? `dest ${vessel.destination}` : null].filter(Boolean).join(" · ") || null,
      url: null,
      provenanceSource: vessel.source || "AIS",
      provenanceObservedAt: vessel.timestamp,
      provenanceNote: "single AIS position report; only vessels voluntarily transmitting AIS are observable",
    });
  }
  return sortObservations(observations);
}

function buildLaunchObservations(launches: OsintLaunch[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const launch of launches) {
    if (!Number.isFinite(launch.lat) || !Number.isFinite(launch.lng)) continue;
    const netMs = parseIsoMs(launch.net);
    if (netMs === null) continue;
    const window = instantWindow(netMs);
    observations.push({
      id: `launch:${launch.id}`,
      domain: "space-launch",
      family: DOMAIN_FAMILY["space-launch"],
      lat: launch.lat,
      lng: launch.lng,
      windowStart: window.start,
      windowEndExclusive: window.endExclusive,
      temporalKind: "instant",
      mobility: "fixed",
      spatialConfidence: 1,
      spatialNote: null,
      areaRadiusKm: 0,
      countryKey: "",
      label: launch.name,
      detail: [launch.provider, launch.location].filter(Boolean).join(" · ") || null,
      url: launch.url,
      provenanceSource: "Launch Library 2",
      provenanceObservedAt: launch.net,
      provenanceNote: "orbital launch schedules are published weeks to months in advance; co-occurrence with conflict incidents is structurally expected coincidence and never counts as evidence",
    });
  }
  return sortObservations(observations);
}

function buildEnvironmentalObservations(events: OsintNaturalEvent[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const event of events) {
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) continue;
    const occurredMs = parseIsoMs(event.occurredAt);
    if (occurredMs === null) continue;
    const window = instantWindow(occurredMs);
    observations.push({
      id: `env:${event.id}`,
      domain: "environmental-event",
      family: DOMAIN_FAMILY["environmental-event"],
      lat: event.lat,
      lng: event.lng,
      windowStart: window.start,
      windowEndExclusive: window.endExclusive,
      temporalKind: "instant",
      mobility: "fixed",
      spatialConfidence: 0.9,
      spatialNote: null,
      areaRadiusKm: 0,
      countryKey: "",
      label: event.title,
      detail: [event.category, event.magnitude !== null && event.magnitudeUnit ? `${event.magnitude}${event.magnitudeUnit}` : null].filter(Boolean).join(" · ") || null,
      url: event.url,
      provenanceSource: "NASA EONET / USGS / GDACS / NOAA",
      provenanceObservedAt: event.occurredAt,
      provenanceNote: "environmental events are independent geophysical or meteorological measurements; co-occurrence with conflict indicates compound stress, never causation in either direction",
      magnitude: event.magnitude,
      magnitudeUnit: event.magnitudeUnit,
      environmentalCategory: event.category,
    });
  }
  return sortObservations(observations);
}

function buildConnectivityObservations(outages: IodaInternetOutage[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const outage of outages) {
    if (!Number.isFinite(outage.lat) || !Number.isFinite(outage.lng)) continue;
    if (!Number.isFinite(outage.from) || !Number.isFinite(outage.until) || outage.until <= outage.from) continue;
    const isCountry = outage.entityType === "country";
    observations.push({
      id: `ioda:${outage.entityType}:${outage.entityCode}:${outage.from}`,
      domain: "connectivity-outage",
      family: DOMAIN_FAMILY["connectivity-outage"],
      lat: outage.lat,
      lng: outage.lng,
      windowStart: outage.from * SECOND_MS,
      windowEndExclusive: outage.until * SECOND_MS,
      temporalKind: "interval",
      mobility: "fixed",
      spatialConfidence: isCountry ? 0.2 : 0.35,
      spatialNote: isCountry
        ? "country-scope detection plotted at a symbolic national reference point; distance to that point is meaningless, so spatial evidence uses country-name matching at fixed weak weight"
        : "region-scope detection plotted at a broad admin-1 reference coordinate, not an outage footprint; spatial evidence is heavily discounted",
      areaRadiusKm: 0,
      countryKey: canonicalizeCountryKey(outage.countryName ?? outage.entityName),
      label: outage.entityType === "region" && outage.countryName ? `${outage.entityName}, ${outage.countryName}` : outage.entityName,
      detail: `${outage.datasource ?? "unknown source"}/${outage.method ?? "unknown method"} · IODA score ${outage.score.toFixed(1)} (source-specific, not cross-source severity)`,
      url: "https://ioda.inetintel.cc.gatech.edu/",
      provenanceSource: "IODA macroscopic connectivity measurement",
      provenanceObservedAt: new Date(outage.from * SECOND_MS).toISOString(),
      provenanceNote: "connectivity evidence establishes that a network outage was measured — never why; outages have many causes and no cause, intent, or shutdown attribution is implied",
      connectivityScope: outage.entityType,
    });
  }
  return sortObservations(observations);
}

function buildMediaObservations(mentions: GdeltGeoNewsMention[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const mention of mentions) {
    if (!Number.isFinite(mention.lat) || !Number.isFinite(mention.lng)) continue;
    const slotMs = parseIsoMs(mention.slotTime);
    if (slotMs === null) continue;
    const coarse = mention.coordinatePrecision === "us-state-centroid" || mention.coordinatePrecision === "world-admin1-centroid";
    observations.push({
      id: `media:${mention.id}`,
      domain: "media-attention",
      family: DOMAIN_FAMILY["media-attention"],
      lat: mention.lat,
      lng: mention.lng,
      windowStart: slotMs,
      windowEndExclusive: slotMs + 15 * 60 * SECOND_MS,
      temporalKind: "interval",
      mobility: "fixed",
      spatialConfidence: coarse ? 0.25 : 0.7,
      spatialNote: coarse
        ? "coarse gazetteer centroid for an entire state/admin-1 division — symbolic placement, heavily discounted"
        : "city/landmark-level gazetteer coordinate for a place mentioned in article text — not an incident site",
      areaRadiusKm: 0,
      countryKey: "",
      label: mention.locationName,
      detail: [mention.domain, mention.title].filter(Boolean).join(" · ") || mention.domain,
      url: mention.url,
      provenanceSource: "GDELT GKG 2.1 conflict-theme media mentions",
      provenanceObservedAt: mention.slotTime,
      provenanceNote: "media attention is derivative of the same event ecosystem as conflict reporting; it corroborates attention geography, never incident occurrence, and never counts as independent evidence",
      mediaProximityChars: mention.proximityChars,
      neverEvidence: coarse,
      neverEvidenceNote: coarse
        ? "qualification refused: this mention is plotted at the centroid of an entire state/admin-1 division, so distance to the centroid cannot establish same-place convergence — centroid coincidence is never evidence"
        : undefined,
    });
  }
  return sortObservations(observations);
}


function buildReliefWebObservations(records: ReliefWebRecord[]): ConvergenceObservation[] {
  const observations: ConvergenceObservation[] = [];
  for (const record of records) {
    if (!record.location) continue;
    const ms = parseIsoMs(record.publisherTimestamp);
    if (ms === null) continue;
    const window = instantWindow(ms);
    observations.push({
      id: `humanitarian:${record.id}`,
      domain: "humanitarian-context",
      family: DOMAIN_FAMILY["humanitarian-context"],
      lat: record.location.lat,
      lng: record.location.lng,
      windowStart: window.start,
      windowEndExclusive: window.endExclusive,
      temporalKind: "instant",
      mobility: "fixed",
      spatialConfidence: 0.16,
      spatialNote: "ReliefWeb country centroid joined through primary-country reference — symbolic national placement, heavily discounted and never same-place evidence",
      areaRadiusKm: 0,
      countryKey: canonicalizeCountryKey(record.primaryCountry?.name ?? record.location.countryName),
      label: record.title,
      detail: `${record.recordKind} · ${record.primaryCountry?.name ?? record.location.countryName}`,
      url: record.url,
      provenanceSource: "ReliefWeb API v2 humanitarian metadata",
      provenanceObservedAt: record.publisherTimestamp,
      provenanceNote: "humanitarian metadata/document indexing is contextual only; it is not incident confirmation and never counts as independent corroboration",
      neverEvidence: true,
      neverEvidenceNote: "qualification refused: ReliefWeb rows plot at a country centroid and are metadata/document index entries, not incident points or independent incident confirmation",
    });
  }
  return sortObservations(observations);
}

/** Build every evidence layer once. Exported so validation harnesses can inspect normalization. */
export function buildEvidenceLayers(input: ConvergenceEvidenceInput): EvidenceLayers {
  const notes: string[] = [];
  const gaps: ConvergenceEvidenceGap[] = [];
  const snapshotMs = parseIsoMs(input.fetchedAt);

  const gnss = buildGnssObservations(input.gpsInterference ?? [], input, notes);
  const military = buildMilitaryAircraftObservations(input.militaryAircraft ?? [], snapshotMs);
  const civil = buildCivilAircraftObservations(input.aircraft ?? []);
  const vessels = buildVesselObservations(input.vessels ?? []);
  const launches = buildLaunchObservations(input.launches ?? []);
  const environmental = buildEnvironmentalObservations(input.naturalEvents ?? []);
  const connectivity = buildConnectivityObservations(input.internetOutages ?? []);
  const media = buildMediaObservations(input.gdeltGeoNews ?? []);
  const humanitarian = buildReliefWebObservations(input.reliefwebRecords ?? []);

  const byDomain: Record<ConvergenceDomain, ConvergenceObservation[]> = {
    "gnss-interference": gnss,
    "military-aviation": military,
    "civil-aviation": civil,
    "ais-vessel": vessels,
    "space-launch": launches,
    "environmental-event": environmental,
    "connectivity-outage": connectivity,
    "media-attention": media,
    "humanitarian-context": humanitarian,
  };

  const gapReasons: Partial<Record<ConvergenceDomain, string>> = {
    "gnss-interference": "no interference cells loaded — the gpsjam.org grid may have failed to ingest; convergence with interference cannot be evaluated at all",
    "military-aviation": "no military aviation positions loaded; aviation convergence cannot be evaluated",
    "civil-aviation": "no civil aviation positions loaded; aviation convergence cannot be evaluated",
    "ais-vessel": "no AIS vessel positions loaded; maritime convergence cannot be evaluated",
    "space-launch": "no launch records loaded",
    "environmental-event": "no environmental event records loaded",
    "connectivity-outage": "no IODA connectivity detections loaded; connectivity convergence cannot be evaluated",
    "media-attention": "no GDELT media mentions loaded; media-attention alignment cannot be evaluated",
    "humanitarian-context": "no ReliefWeb humanitarian metadata loaded (often because the approved appname is absent); humanitarian contextual alignment cannot be evaluated",
  };
  for (const domain of Object.keys(byDomain) as ConvergenceDomain[]) {
    const rawCount = domain === "military-aviation" ? (input.militaryAircraft ?? []).length
      : domain === "civil-aviation" ? (input.aircraft ?? []).length
      : domain === "ais-vessel" ? (input.vessels ?? []).length
      : domain === "space-launch" ? (input.launches ?? []).length
      : domain === "environmental-event" ? (input.naturalEvents ?? []).length
      : domain === "connectivity-outage" ? (input.internetOutages ?? []).length
      : domain === "media-attention" ? (input.gdeltGeoNews ?? []).length
      : domain === "humanitarian-context" ? (input.reliefwebRecords ?? []).length
      : (input.gpsInterference ?? []).length;
    if (rawCount === 0) {
      gaps.push({ domain, reason: gapReasons[domain] ?? "domain source empty" });
    }
  }
  if (snapshotMs === null && (input.militaryAircraft ?? []).length > 0) {
    gaps.push({ domain: "military-aviation", reason: "snapshot retrieval time is unparseable, so military aviation positions cannot be placed in time" });
  }

  const droppedByDomain = {} as Record<ConvergenceDomain, number>;
  for (const domain of Object.keys(byDomain) as ConvergenceDomain[]) {
    const rawCount = domain === "military-aviation" ? (input.militaryAircraft ?? []).length
      : domain === "civil-aviation" ? (input.aircraft ?? []).length
      : domain === "ais-vessel" ? (input.vessels ?? []).length
      : domain === "space-launch" ? (input.launches ?? []).length
      : domain === "environmental-event" ? (input.naturalEvents ?? []).length
      : domain === "connectivity-outage" ? (input.internetOutages ?? []).length
      : domain === "media-attention" ? (input.gdeltGeoNews ?? []).length
      : (input.gpsInterference ?? []).length;
    droppedByDomain[domain] = Math.max(0, rawCount - byDomain[domain].length);
  }

  return { observations: Object.values(byDomain).flat(), byDomain, gaps, notes, droppedByDomain };
}

/* ------------------------------------------------------------------------- */
/* Anchor model                                                                */
/* ------------------------------------------------------------------------- */

export interface ConvergenceAnchor {
  event: ConflictEvent;
  lat: number;
  lng: number;
  windowStart: number;
  windowEndExclusive: number;
  windowPrecision: IncidentTemporalPrecision;
  spatialConfidence: number;
  spatialNote: string | null;
  countryKey: string;
  cellX: number;
  cellY: number;
}

function anchorSpatialConfidence(event: ConflictEvent): { confidence: number; note: string | null } {
  const precision = event.precision;
  if (precision === null || precision === undefined) {
    return { confidence: 0.85, note: null };
  }
  if (precision <= 1) return { confidence: 1, note: null };
  if (precision === 2) return { confidence: 0.95, note: null };
  if (precision === 3) return { confidence: 0.75, note: null };
  if (precision === 4) return { confidence: 0.55, note: "province-level incident fix: spatial evidence is weakened because the true location is uncertain within a broad area" };
  if (precision === 5) return { confidence: 0.4, note: "linear-feature incident fix: spatial evidence is weak because the true location is uncertain along an extended feature" };
  if (precision === 6) return { confidence: 0.15, note: "country-level incident fix: proximity to a shared national geography is weak evidence and is heavily discounted so centroid coincidence cannot fabricate convergence" };
  return { confidence: 0.12, note: "offshore/airspace incident fix: proximity to a shared regional centroid is weak evidence and is heavily discounted" };
}

/** Resolve the deterministic anchor observation for one incident. Null when the incident
 *  has no resolvable time or coordinates — such incidents are excluded and counted. */
export function buildIncidentAnchor(event: ConflictEvent): ConvergenceAnchor | null {
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) return null;
  const occurrence = resolveIncidentOccurrenceWindow(event);
  if (!occurrence) return null;
  const { confidence, note } = anchorSpatialConfidence(event);
  return {
    event,
    lat: event.lat,
    lng: event.lng,
    windowStart: occurrence.start,
    windowEndExclusive: occurrence.endExclusive,
    windowPrecision: occurrence.precision,
    spatialConfidence: confidence,
    spatialNote: note,
    countryKey: canonicalizeCountryKey(event.country),
    cellX: 0,
    cellY: 0,
  };
}

/* ------------------------------------------------------------------------- */
/* Pair-type parameters — the explicit evidence model                          */
/* ------------------------------------------------------------------------- */

interface PairTypeParams {
  spatialFullKm: number;
  spatialZeroKm: number;
  spatialGateKm: number;
  timeGateHours: number;
  weights: { spatial: number; temporal: number; strength?: number; squawk?: number; significance?: number; proximity?: number };
  /** Score bar for a finding to qualify as evidence; null means the pair type can never
   *  qualify — it is structurally coincidence-only (space launches). */
  qualifyScore: number | null;
  /** When true, qualification additionally requires an emergency-squawk factor. Civil
   *  aviation is so structurally dense that proximity alone is never discriminating. */
  requireEmergencySquawk?: boolean;
  independenceNote: string;
}

const PAIR_PARAMS: Record<ConvergenceDomain, PairTypeParams> = {
  "gnss-interference": {
    spatialFullKm: 0,
    spatialZeroKm: 70,
    spatialGateKm: 100,
    timeGateHours: 30,
    weights: { spatial: 0.42, temporal: 0.33, strength: 0.25 },
    qualifyScore: 0.5,
    independenceNote: "interference grids are independent of conflict reporting but are derived from aircraft navigation quality — they share the aviation-derived measurement family with aviation positions",
  },
  "military-aviation": {
    spatialFullKm: 35,
    spatialZeroKm: 150,
    spatialGateKm: 190,
    timeGateHours: 5,
    weights: { spatial: 0.58, temporal: 0.42 },
    qualifyScore: 0.55,
    independenceNote: "military aviation positions are independent transponder measurements, but a single snapshot position is one instant — only tight temporal overlap is meaningful",
  },
  "civil-aviation": {
    spatialFullKm: 20,
    spatialZeroKm: 90,
    spatialGateKm: 120,
    timeGateHours: 5,
    weights: { spatial: 0.42, temporal: 0.28, squawk: 0.3 },
    qualifyScore: 0.55,
    requireEmergencySquawk: true,
    independenceNote: "civil aviation is structurally dense near populated areas; proximity alone is expected coincidence and only an emergency squawk supplies discriminating evidence",
  },
  "ais-vessel": {
    spatialFullKm: 12,
    spatialZeroKm: 60,
    spatialGateKm: 80,
    timeGateHours: 8,
    weights: { spatial: 0.62, temporal: 0.38 },
    qualifyScore: 0.55,
    independenceNote: "AIS positions are independent voluntary transmissions; only transmitting vessels are observable and coverage is regionally incomplete",
  },
  "space-launch": {
    spatialFullKm: 90,
    spatialZeroKm: 380,
    spatialGateKm: 480,
    timeGateHours: 26,
    weights: { spatial: 0.5, temporal: 0.5 },
    qualifyScore: null,
    independenceNote: "orbital launches are scheduled and published weeks to months in advance, so spatial-temporal co-occurrence with conflict incidents is structurally expected coincidence; this pair type is never evidence",
  },
  "environmental-event": {
    spatialFullKm: 30,
    spatialZeroKm: 130,
    spatialGateKm: 160,
    timeGateHours: 96,
    weights: { spatial: 0.45, temporal: 0.3, significance: 0.25 },
    qualifyScore: 0.52,
    independenceNote: "environmental measurements are independent of conflict reporting; co-occurrence indicates compound humanitarian stress, never causation",
  },
  "connectivity-outage": {
    spatialFullKm: 25,
    spatialZeroKm: 110,
    spatialGateKm: 150,
    timeGateHours: 40,
    weights: { spatial: 0.5, temporal: 0.5 },
    qualifyScore: 0.5,
    independenceNote: "connectivity measurement is independent of conflict reporting, but outages have many causes — alignment never implies why connectivity was lost",
  },
  "humanitarian-context": {
    spatialFullKm: 8,
    spatialZeroKm: 45,
    spatialGateKm: 90,
    timeGateHours: 96,
    weights: { spatial: 0.6, temporal: 0.4 },
    qualifyScore: 0.5,
    independenceNote: "ReliefWeb humanitarian metadata is derivative contextual indexing and never counts as independent evidence",
  },
  "media-attention": {
    spatialFullKm: 18,
    spatialZeroKm: 85,
    spatialGateKm: 120,
    timeGateHours: 60,
    weights: { spatial: 0.45, temporal: 0.35, proximity: 0.2 },
    qualifyScore: 0.5,
    independenceNote: "media attention derives from the same event ecosystem as conflict reporting; it corroborates attention geography only and never counts as independent evidence",
  },
};

/* ------------------------------------------------------------------------- */
/* Pairwise assessment                                                         */
/* ------------------------------------------------------------------------- */

export interface PairVerdict {
  withinGates: boolean;
  distanceKm: number;
  effectiveDistanceKm: number;
  timeGapHours: number;
  score: number;
  qualifies: boolean;
  countsAsEvidence: boolean;
  factors: ConvergenceFactor[];
  rationale: string[];
  countryNameRejected: boolean;
}

function temporalAssessment(anchor: ConvergenceAnchor, obs: ConvergenceObservation, gateHours: number): { score: number; gapHours: number; rationale: string } | null {
  const gapMs = Math.max(0, Math.max(anchor.windowStart - obs.windowEndExclusive, obs.windowStart - anchor.windowEndExclusive));
  const gapHours = gapMs / HOUR_MS;
  if (gapHours > gateHours) return null;

  // Gap curves are mobility-aware. A fast mover's recorded position is stale within
  // minutes, so positive gaps carry little evidence even inside the gate; a slow vessel
  // holds position for hours; fixed evidence persists at its location.
  let base: number;
  if (obs.mobility === "fast") {
    if (gapHours <= 0) base = 1;
    else if (gapHours <= 1) base = 0.4;
    else if (gapHours <= 3) base = 0.22;
    else base = 0.1;
  } else if (obs.mobility === "slow") {
    if (gapHours <= 0) base = 1;
    else if (gapHours <= 2) base = 0.55;
    else if (gapHours <= 6) base = 0.35;
    else base = 0.15;
  } else {
    if (gapHours <= 0) base = 1;
    else if (gapHours <= 6) base = 0.7;
    else if (gapHours <= 12) base = 0.55;
    else if (gapHours <= 24) base = 0.35;
    else if (gapHours <= 48) base = 0.18;
    else base = 0.1;
  }

  // Imprecise anchor windows carry less temporal specificity — bounded further by mobility.
  // A fast mover overlapping a day-precision incident window establishes only that it
  // operated nearby on the same day, not that it was present during the incident.
  const precisionFactor = anchor.windowPrecision === "second"
    ? 1
    : anchor.windowPrecision === "day"
      ? obs.mobility === "fast" ? 0.6 : obs.mobility === "slow" ? 0.75 : 0.85
      : obs.mobility === "fast" ? 0.4 : obs.mobility === "slow" ? 0.5 : 0.7;
  // Long windows overlap many unrelated observations; discount them exactly as the
  // incident-correlation engine does so week-spanning ranges cannot inflate evidence.
  const maxWindowHours = Math.max(anchor.windowEndExclusive - anchor.windowStart, obs.windowEndExclusive - obs.windowStart) / HOUR_MS;
  const durationFactor = maxWindowHours > 96 ? Math.sqrt(96 / maxWindowHours) : 1;
  const score = base * precisionFactor * durationFactor;

  const overlapText = gapHours <= 0
    ? `time windows overlap${obs.temporalKind === "snapshot-instant" || obs.temporalKind === "instant" ? " (observation instant falls inside the incident window)" : ""}`
    : `${gapHours.toFixed(1)} h gap between the incident window and the observation${obs.mobility === "fast" ? " — fast mover: position at incident time is unknown, presence evidence decays fast" : obs.mobility === "slow" ? " — slow mover: position holds for hours" : ""}`;
  const precisionText = precisionFactor < 1 ? `, discounted ×${precisionFactor} because the incident time is ${anchor.windowPrecision}-precision${obs.mobility === "fast" && anchor.windowPrecision !== "second" ? " and a fast mover can only establish same-period presence" : ""}` : "";
  const durationText = durationFactor < 1 ? `, discounted ×${durationFactor.toFixed(2)} because the widest window spans ${Math.round(maxWindowHours / 24)} days` : "";
  return { score, gapHours, rationale: `temporal: ${overlapText}${precisionText}${durationText}` };
}

function squawkFactor(obs: ConvergenceObservation): { score: number | null; rationale: string } {
  const squawk = (obs.squawk ?? "").trim();
  if (squawk === "7700" || squawk === "7500") {
    return { score: 1, rationale: `squawk: emergency transponder code ${squawk} — a rare, discriminating aviation signal` };
  }
  if (squawk === "7600") {
    return { score: 0.6, rationale: "squawk: radio-failure code 7600 — unusual but usually non-conflict" };
  }
  return { score: 0, rationale: `squawk: no emergency code${squawk ? ` (${squawk})` : ""} — civil aviation proximity alone is structurally expected coincidence` };
}

function strengthFactor(obs: ConvergenceObservation): { score: number | null; rationale: string } {
  if (typeof obs.gnssAffectedShare !== "number") return { score: null, rationale: "interference strength: not supplied" };
  const share = obs.gnssAffectedShare;
  const score = clamp01(share * 1.25);
  return {
    score,
    rationale: `interference strength: ${Math.round(share * 100)}% of aircraft in the cell reported degraded navigation (level ${obs.gnssLevel ?? "unknown"})`,
  };
}

function significanceFactor(obs: ConvergenceObservation): { score: number | null; rationale: string } {
  const category = (obs.environmentalCategory ?? "").toLowerCase();
  if (category.includes("red")) return { score: 1, rationale: "significance: GDACS red-alert classification supplied by the publisher" };
  if (category.includes("orange")) return { score: 0.75, rationale: "significance: GDACS orange-alert classification supplied by the publisher" };
  if (typeof obs.magnitude === "number" && obs.magnitudeUnit && /^m/i.test(obs.magnitudeUnit)) {
    const score = clamp01(obs.magnitude / 8);
    return { score, rationale: `significance: earthquake magnitude ${obs.magnitude}${obs.magnitudeUnit} scaled toward M8` };
  }
  return { score: null, rationale: "significance: no publisher severity or magnitude scale applies — structurally absent evidence, contributes zero" };
}

function proximityFactor(obs: ConvergenceObservation): { score: number | null; rationale: string } {
  if (typeof obs.mediaProximityChars !== "number") return { score: null, rationale: "mention proximity: not supplied" };
  const chars = obs.mediaProximityChars;
  const score = chars <= 80 ? 1 : chars <= 160 ? 0.75 : 0.5;
  return {
    score,
    rationale: `mention proximity: the place name appears ${chars} characters from the nearest automated conflict-theme tag in the article text`,
  };
}

/** Compute the full deterministic pairwise verdict between an anchor incident and one
 *  evidence observation. Pure: no clocks, no randomness. Exported for harness inspection. */
export function assessConvergencePair(anchor: ConvergenceAnchor, obs: ConvergenceObservation): PairVerdict {
  const params = PAIR_PARAMS[obs.domain];
  const rationale: string[] = [];
  const factors: ConvergenceFactor[] = [];

  const distanceKm = haversineKm(anchor.lat, anchor.lng, obs.lat, obs.lng);
  const effectiveDistanceKm = Math.max(0, distanceKm - obs.areaRadiusKm);

  // --- spatial factor ---
  let spatialScore: number;
  let spatialRationale: string;
  let countryNameRejected = false;
  // Coarse incident fixes (country-level precision 6, offshore/airspace 7) place distinct
  // incidents at shared administrative centroids. Distance from such a centroid is noise,
  // so distance-derived convergence is refused outright; only name-matched country-scope
  // connectivity evidence remains meaningful at national scale. This is the primary defense
  // against centroid false positives.
  if (obs.connectivityScope !== "country" && anchor.spatialConfidence < 0.2) {
    return {
      withinGates: false, distanceKm, effectiveDistanceKm, timeGapHours: 0, score: 0,
      qualifies: false, countsAsEvidence: false, factors, rationale, countryNameRejected,
    };
  }
  if (obs.connectivityScope === "country") {
    // Country-scope connectivity: the reference point is symbolic, so distance is meaningless.
    // Spatial evidence is an honest same-country-name test at fixed weak weight — or rejection.
    if (!anchor.countryKey || !obs.countryKey || anchor.countryKey !== obs.countryKey) {
      countryNameRejected = true;
      return {
        withinGates: false, distanceKm, effectiveDistanceKm, timeGapHours: 0, score: 0,
        qualifies: false, countsAsEvidence: false, factors, rationale, countryNameRejected,
      };
    }
    spatialScore = 0.3;
    spatialRationale = `spatial: country-scope connectivity detection matched by canonicalized country name (${obs.label}); the reference point is symbolic, so spatial evidence is fixed at weak national-level weight 0.3 rather than distance-derived`;
  } else {
    if (effectiveDistanceKm > params.spatialGateKm) {
      return {
        withinGates: false, distanceKm, effectiveDistanceKm, timeGapHours: 0, score: 0,
        qualifies: false, countsAsEvidence: false, factors, rationale, countryNameRejected,
      };
    }
    const decay = effectiveDistanceKm <= params.spatialFullKm
      ? 1
      : Math.max(0, 1 - (effectiveDistanceKm - params.spatialFullKm) / Math.max(1e-9, params.spatialZeroKm - params.spatialFullKm));
    const combinedConfidence = Math.min(anchor.spatialConfidence, obs.spatialConfidence);
    spatialScore = decay * combinedConfidence;
    const areaText = obs.areaRadiusKm > 0 ? ` after subtracting the cell's measured ~${Math.round(obs.areaRadiusKm)} km radius (raw center distance ${distanceKm.toFixed(1)} km)` : "";
    const confidenceText = combinedConfidence < 1
      ? `, discounted ×${combinedConfidence.toFixed(2)} for geographic precision (${anchor.spatialConfidence <= obs.spatialConfidence ? "incident fix" : "observation"})`
      : "";
    spatialRationale = effectiveDistanceKm <= params.spatialFullKm
      ? `spatial: effective distance ${effectiveDistanceKm.toFixed(1)} km${areaText}, inside the ${params.spatialFullKm} km full-evidence radius${confidenceText}`
      : `spatial: effective distance ${effectiveDistanceKm.toFixed(1)} km${areaText}, decayed toward zero at ${params.spatialZeroKm} km inside the ${params.spatialGateKm} km gate${confidenceText}`;
  }
  factors.push({ key: "spatial", score: spatialScore, weight: params.weights.spatial, rationale: spatialRationale });
  rationale.push(spatialRationale);

  // --- temporal factor ---
  const temporal = temporalAssessment(anchor, obs, params.timeGateHours);
  if (!temporal) {
    return {
      withinGates: false, distanceKm, effectiveDistanceKm, timeGapHours: Number.POSITIVE_INFINITY, score: 0,
      qualifies: false, countsAsEvidence: false, factors, rationale, countryNameRejected,
    };
  }
  factors.push({ key: "temporal", score: temporal.score, weight: params.weights.temporal, rationale: temporal.rationale });
  rationale.push(temporal.rationale);

  // --- domain-specific factors ---
  let score = params.weights.spatial * spatialScore + params.weights.temporal * temporal.score;

  if (params.weights.strength !== undefined) {
    const factor = strengthFactor(obs);
    factors.push({ key: "strength", score: factor.score, weight: params.weights.strength, rationale: factor.rationale });
    rationale.push(factor.rationale);
    score += params.weights.strength * (factor.score ?? 0);
  }
  if (params.weights.squawk !== undefined) {
    const factor = squawkFactor(obs);
    factors.push({ key: "squawk", score: factor.score, weight: params.weights.squawk, rationale: factor.rationale });
    rationale.push(factor.rationale);
    score += params.weights.squawk * (factor.score ?? 0);
  }
  if (params.weights.significance !== undefined) {
    const factor = significanceFactor(obs);
    factors.push({ key: "significance", score: factor.score, weight: params.weights.significance, rationale: factor.rationale });
    rationale.push(factor.rationale);
    score += params.weights.significance * (factor.score ?? 0);
  }
  if (params.weights.proximity !== undefined) {
    const factor = proximityFactor(obs);
    factors.push({ key: "proximity", score: factor.score, weight: params.weights.proximity, rationale: factor.rationale });
    rationale.push(factor.rationale);
    score += params.weights.proximity * (factor.score ?? 0);
  }

  score = Math.round(score * 10000) / 10000;

  // --- qualification ---
  let qualifies = params.qualifyScore !== null && score >= params.qualifyScore;
  if (qualifies && params.requireEmergencySquawk) {
    const squawk = factors.find((factor) => factor.key === "squawk");
    if (!squawk || (squawk.score ?? 0) < 0.6) {
      qualifies = false;
      rationale.push("qualification refused: civil aviation proximity without an emergency squawk is structurally expected coincidence, however tight");
    }
  }
  if (qualifies && obs.neverEvidence) {
    qualifies = false;
    rationale.push(obs.neverEvidenceNote ?? "qualification refused: observation geography is too coarse to establish same-place convergence");
  }
  if (params.qualifyScore === null) {
    rationale.push(`coincidence-only pair type: ${params.independenceNote}`);
  }

  return {
    withinGates: true,
    distanceKm,
    effectiveDistanceKm,
    timeGapHours: temporal.gapHours,
    score,
    qualifies,
    countsAsEvidence: qualifies && DOMAIN_INDEPENDENCE[obs.domain],
    factors,
    rationale,
    countryNameRejected,
  };
}

/* ------------------------------------------------------------------------- */
/* Spatial grid index                                                          */
/* ------------------------------------------------------------------------- */

const CELL_DEGREES = 1;
const X_CELLS = Math.round(360 / CELL_DEGREES);
const Y_CELLS = Math.round(180 / CELL_DEGREES);
const KM_PER_DEGREE_LAT = 110.574;

function cellXFor(lng: number): number {
  return Math.floor((Math.min(180, Math.max(-180, lng)) + 180) / CELL_DEGREES) % X_CELLS;
}

function cellYFor(lat: number): number {
  return Math.min(Y_CELLS - 1, Math.max(0, Math.floor((Math.min(90, Math.max(-90, lat)) + 90) / CELL_DEGREES)));
}

interface SpatialIndex {
  cells: Map<string, ConvergenceObservation[]>;
}

function buildSpatialIndex(observations: ConvergenceObservation[]): SpatialIndex {
  const cells = new Map<string, ConvergenceObservation[]>();
  for (const obs of observations) {
    const key = `${cellXFor(obs.lng)}:${cellYFor(obs.lat)}`;
    const list = cells.get(key);
    if (list) list.push(obs);
    else cells.set(key, [obs]);
  }
  return { cells };
}

/** Collect candidates from every grid cell intersecting the gate bounding box of the
 *  anchor. Handles longitudinal wrap and polar clamping; each observation appears in
 *  exactly one cell, so no deduplication is needed. The longitude degree width shrinks
 *  with cos(latitude) and is floored at 8 km/degree so polar anchors widen the scan
 *  rather than divide by zero — candidate generation may over-select, never under-select;
 *  exact haversine gating inside the assessment makes the final truth. */
function collectCandidates(index: SpatialIndex, lat: number, lng: number, gateKm: number): ConvergenceObservation[] {
  const latRadius = gateKm / KM_PER_DEGREE_LAT;
  const lngKmPerDegree = Math.max(8, 111.32 * Math.cos((lat * Math.PI) / 180));
  const lngRadiusDegrees = gateKm / lngKmPerDegree;
  const south = Math.max(-90, lat - latRadius);
  const north = Math.min(90, lat + latRadius);
  const y0 = cellYFor(south);
  const y1 = cellYFor(north);
  const xWestRaw = (lng - lngRadiusDegrees + 180) / CELL_DEGREES;
  const xEastRaw = (lng + lngRadiusDegrees + 180) / CELL_DEGREES;
  const x0 = Math.floor(xWestRaw);
  const x1 = Math.floor(xEastRaw);
  const out: ConvergenceObservation[] = [];
  // Extreme polar gates can wrap the longitudinal scan past a full revolution; track scanned
  // cells so wrapped duplicates never produce double-counted candidate pairs.
  const scanned = new Set<string>();
  for (let x = x0; x <= x1; x += 1) {
    const wrappedX = ((x % X_CELLS) + X_CELLS) % X_CELLS;
    for (let y = y0; y <= y1; y += 1) {
      const key = `${wrappedX}:${y}`;
      if (scanned.has(key)) continue;
      scanned.add(key);
      const list = index.cells.get(key);
      if (list) out.push(...list);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Card aggregation                                                            */
/* ------------------------------------------------------------------------- */

const DOMAIN_ORDER: ConvergenceDomain[] = [
  "gnss-interference",
  "connectivity-outage",
  "environmental-event",
  "military-aviation",
  "civil-aviation",
  "ais-vessel",
  "space-launch",
  "media-attention",
  "humanitarian-context",
];

export const DOMAIN_DISPLAY: Record<ConvergenceDomain, { label: string; shortLabel: string }> = {
  "gnss-interference": { label: "GNSS interference", shortLabel: "GNSS" },
  "military-aviation": { label: "Military aviation", shortLabel: "MIL AIR" },
  "civil-aviation": { label: "Civil aviation", shortLabel: "CIV AIR" },
  "ais-vessel": { label: "AIS vessels", shortLabel: "AIS" },
  "space-launch": { label: "Space launches", shortLabel: "LAUNCH" },
  "environmental-event": { label: "Environmental events", shortLabel: "ENV" },
  "connectivity-outage": { label: "Connectivity outages", shortLabel: "IODA" },
  "media-attention": { label: "Media attention", shortLabel: "MEDIA" },
  "humanitarian-context": { label: "ReliefWeb humanitarian metadata", shortLabel: "RELIEF" },
};

const FAMILY_DISPLAY: Record<ConvergenceEvidenceFamily, string> = {
  "aviation-derived": "aviation-derived measurements",
  "maritime-ais": "maritime AIS",
  "spaceflight-schedule": "published launch schedules",
  "environmental-sensors": "environmental sensors",
  "network-measurement": "network connectivity measurement",
  "media-attention": "media attention",
  "humanitarian-context": "humanitarian metadata context",
};

const MAX_FINDINGS_PER_DOMAIN = 3;

function classificationReason(
  classification: ConvergenceClassification,
  independentFamilies: ConvergenceEvidenceFamily[],
  mediaQualified: boolean,
  domainCount: number,
): string {
  const familyList = independentFamilies.map((family) => FAMILY_DISPLAY[family]).join(" + ");
  switch (classification) {
    case "corroboration":
      return `${independentFamilies.length} independent measurement families converge in space and time (${familyList}); this is co-occurrence geometry, not causation`;
    case "correlation":
      return `exactly one independent measurement family converges (${familyList})${mediaQualified ? "; media attention also aligns but is derivative context, not independent corroboration" : ""}`;
    default:
      if (mediaQualified) {
        return "media attention aligns spatially and temporally, but coverage derives from the same event ecosystem as conflict reporting — nothing independent corroborates the convergence, so it reads as coincidence until independent evidence appears";
      }
      return domainCount > 0
        ? "spatial-temporal overlap exists but every alignment is weak, structurally expected, or coincidence-only — treat as coincidence unless independent evidence emerges"
        : "no domain evidence converged";
  }
}

export interface ConvergenceOptions {
  /** Maximum findings retained per domain per card for drill-down. */
  maxFindingsPerDomain?: number;
}

export function analyzeDomainConvergence(
  events: ConflictEvent[],
  input: ConvergenceEvidenceInput,
  options: ConvergenceOptions = {},
): DomainConvergenceAnalysis {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const maxFindings = Math.max(1, options.maxFindingsPerDomain ?? MAX_FINDINGS_PER_DOMAIN);

  const layers = buildEvidenceLayers(input);

  // Deterministic anchor ordering: id ascending.
  const orderedEvents = [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const anchors: ConvergenceAnchor[] = [];
  let ineligibleAnchorCount = 0;
  for (const event of orderedEvents) {
    const anchor = buildIncidentAnchor(event);
    if (anchor) anchors.push(anchor);
    else ineligibleAnchorCount += 1;
  }

  // Per-domain spatial indexes.
  const indexes = new Map<ConvergenceDomain, SpatialIndex>();
  for (const domain of DOMAIN_ORDER) {
    indexes.set(domain, buildSpatialIndex(layers.byDomain[domain]));
  }

  // Country-scope connectivity rows are matched by canonicalized country name, never by
  // distance to their symbolic reference point. Grouping them by key once turns matching
  // into an exact lookup — mismatched rows are never spuriously evaluated, which keeps
  // both the work and the bookkeeping honest.
  const countryScopeByKey = new Map<string, ConvergenceObservation[]>();
  for (const obs of layers.byDomain["connectivity-outage"]) {
    if (obs.connectivityScope !== "country" || !obs.countryKey) continue;
    const list = countryScopeByKey.get(obs.countryKey);
    if (list) list.push(obs);
    else countryScopeByKey.set(obs.countryKey, [obs]);
  }

  let candidatePairCount = 0;
  let evaluatedPairCount = 0;
  let findingCount = 0;
  let qualifyingFindingCount = 0;
  let countryScopeEvaluationCount = 0;

  const cards: IncidentConvergenceCard[] = [];
  let corroborationCount = 0;
  let correlationCount = 0;
  let coincidenceCount = 0;

  const globalNotes: string[] = [
    "Aviation and AIS positions are snapshot instants: they can only converge with incidents whose time windows intersect the observation era, and the temporal gate enforces this — convergence correctly drops out for historical incidents.",
    "Orbital objects are excluded by design: propagated satellite positions sweep the globe continuously, so proximity to terrestrial incidents carries no discriminating evidence. Fixed launch sites with published windows are the appropriate orbital-domain evidence.",
    ...layers.notes,
  ];
  if ((input.sources?.vessels ?? "").length > 0) {
    globalNotes.push(`AIS coverage ledger: ${input.sources.vessels}. Absence of vessels outside coverage is a coverage limitation, never evidence of inactivity.`);
  }

  for (const anchor of anchors) {
    const findingsByDomain = new Map<ConvergenceDomain, { obs: ConvergenceObservation; verdict: PairVerdict }[]>();

    for (const domain of DOMAIN_ORDER) {
      const observations = layers.byDomain[domain];
      if (observations.length === 0) continue;
      const params = PAIR_PARAMS[domain];
      const index = indexes.get(domain);
      if (!index) continue;
      // Region-scope rows use the spatial gate normally. Country-scope rows join the
      // candidate set only through the exact canonicalized country-name lookup — their
      // symbolic reference point can sit hundreds of kilometers from a same-country
      // incident, so distance-driven candidate generation would either miss them honestly
      // or flood the evaluator with mismatches dishonestly.
      let candidates = collectCandidates(index, anchor.lat, anchor.lng, params.spatialGateKm);
      if (domain === "connectivity-outage" && anchor.countryKey) {
        const spatialIds = new Set(candidates.map((obs) => obs.id));
        const nameMatched = (countryScopeByKey.get(anchor.countryKey) ?? []).filter((obs) => !spatialIds.has(obs.id));
        if (nameMatched.length > 0) {
          countryScopeEvaluationCount += nameMatched.length;
          candidates = [...candidates, ...nameMatched];
        }
      }
      candidatePairCount += candidates.length;
      for (const obs of candidates) {
        evaluatedPairCount += 1;
        const verdict = assessConvergencePair(anchor, obs);
        if (!verdict.withinGates) continue;
        const list = findingsByDomain.get(domain);
        if (list) list.push({ obs, verdict });
        else findingsByDomain.set(domain, [{ obs, verdict }]);
      }
    }

    if (findingsByDomain.size === 0) continue;

    // Assemble domain alignments, strongest first.
    const alignments: ConvergenceDomainAlignment[] = [];
    for (const [domain, pairs] of findingsByDomain) {
      pairs.sort((a, b) =>
        b.verdict.score - a.verdict.score ||
        (a.obs.id < b.obs.id ? -1 : a.obs.id > b.obs.id ? 1 : 0)
      );
      const qualifying = pairs.filter((pair) => pair.verdict.qualifies);
      const retained = [...pairs].sort((a, b) =>
        (b.verdict.qualifies ? 1 : 0) - (a.verdict.qualifies ? 1 : 0) ||
        b.verdict.score - a.verdict.score ||
        (a.obs.id < b.obs.id ? -1 : a.obs.id > b.obs.id ? 1 : 0)
      ).slice(0, maxFindings);
      findingCount += pairs.length;
      qualifyingFindingCount += qualifying.length;
      const best = pairs[0];
      alignments.push({
        domain,
        family: DOMAIN_FAMILY[domain],
        independent: DOMAIN_INDEPENDENCE[domain],
        bestScore: best.verdict.score,
        qualifies: qualifying.length > 0,
        findingCount: pairs.length,
        qualifyingFindingCount: qualifying.length,
        findings: retained.map((pair) => ({
          observationId: pair.obs.id,
          domain,
          family: DOMAIN_FAMILY[domain],
          label: pair.obs.label,
          detail: pair.obs.detail,
          url: pair.obs.url,
          distanceKm: Math.round(pair.verdict.distanceKm * 10) / 10,
          effectiveDistanceKm: Math.round(pair.verdict.effectiveDistanceKm * 10) / 10,
          timeGapHours: Math.round(pair.verdict.timeGapHours * 100) / 100,
          score: pair.verdict.score,
          qualifies: pair.verdict.qualifies,
          countsAsEvidence: pair.verdict.countsAsEvidence,
          factors: pair.verdict.factors,
          rationale: pair.verdict.rationale,
          provenance: {
            source: pair.obs.provenanceSource,
            url: pair.obs.url,
            observedAt: pair.obs.provenanceObservedAt,
            note: pair.obs.provenanceNote,
          },
        })),
        coverageNote: domain === "ais-vessel" ? "only voluntarily transmitting vessels inside receiver coverage are observable" : domain === "military-aviation" || domain === "civil-aviation" ? "single snapshot-instant positions; only tight temporal overlap is meaningful" : null,
      });
    }

    alignments.sort((a, b) =>
      b.bestScore - a.bestScore ||
      DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain)
    );

    // Family-level independence: qualifying independent domains collapse into measurement
    // families, so GNSS interference and aviation positions can never corroborate each other.
    const independentFamilySet = new Set<ConvergenceEvidenceFamily>();
    let independentBestSum = 0;
    let qualifyingDomainCount = 0;
    let mediaBest = 0;
    let mediaQualified = false;
    let coincidenceDomainCount = 0;
    for (const alignment of alignments) {
      if (alignment.qualifies) qualifyingDomainCount += 1;
      if (alignment.qualifies && alignment.independent) {
        independentFamilySet.add(alignment.family);
      }
      if (alignment.independent && alignment.domain !== "media-attention") {
        independentBestSum += alignment.qualifies ? alignment.bestScore : 0;
      }
      if (alignment.domain === "media-attention") {
        mediaBest = alignment.bestScore;
        if (alignment.qualifies) mediaQualified = true;
      }
      if (!alignment.qualifies) coincidenceDomainCount += 1;
    }
    const independentFamilies = [...independentFamilySet].sort() as ConvergenceEvidenceFamily[];

    let classification: ConvergenceClassification;
    if (independentFamilies.length >= 2) classification = "corroboration";
    else if (independentFamilies.length === 1) classification = "correlation";
    else classification = "coincidence";

    if (classification === "corroboration") corroborationCount += 1;
    else if (classification === "correlation") correlationCount += 1;
    else coincidenceCount += 1;

    // Transparent ranking device — documented verbatim in every card's uncertainty notes.
    // Independent qualifying families dominate; media attention adds a small derivative
    // bonus; coincidence-only alignments add almost nothing. Not a probability.
    const rawIndex = independentBestSum + 0.25 * (mediaQualified ? mediaBest : 0) + 0.05 * Math.min(2, coincidenceDomainCount);
    const convergenceIndex = Math.min(100, Math.round((rawIndex / 2.5) * 100));

    const uncertaintyNotes: string[] = [
      `convergence index ${convergenceIndex}/100 is a deterministic ranking device (sum of qualifying independent domain scores plus a small derivative media bonus, normalized to a 2.5-point ceiling) — it is not a probability of any relationship`,
    ];
    if (anchor.spatialNote) uncertaintyNotes.push(anchor.spatialNote);
    if (anchor.windowPrecision !== "second") {
      uncertaintyNotes.push(`incident time is ${anchor.windowPrecision}-precision; temporal alignment establishes at most ${anchor.windowPrecision === "day" ? "same-day" : "same-range"} co-occurrence`);
    }
    if (alignments.some((alignment) => alignment.domain === "military-aviation" || alignment.domain === "civil-aviation" || alignment.domain === "ais-vessel")) {
      uncertaintyNotes.push("transport positions are snapshot instants; they cannot corroborate incidents outside their observation era and never rewound during playback");
    }
    if (mediaQualified) {
      uncertaintyNotes.push("media attention alignment reflects reporting geography derived from the same event ecosystem — it is context, not independent corroboration");
    }
    if (layers.gaps.length > 0) {
      uncertaintyNotes.push("one or more evidence domains are unavailable in the loaded snapshot; see evidence gaps — absence of convergence in those domains cannot be evaluated");
    }

    cards.push({
      eventId: anchor.event.id,
      algorithmVersion: CONVERGENCE_ALGORITHM_VERSION,
      classification,
      classificationReason: classificationReason(classification, independentFamilies, mediaQualified, alignments.length),
      convergenceIndex,
      independentFamilyCount: independentFamilies.length,
      qualifyingDomainCount,
      domains: alignments,
      independentFamilies,
      evidenceGaps: layers.gaps,
      uncertaintyNotes,
      disclaimer: CONVERGENCE_DISCLAIMER,
    });
  }

  cards.sort((a, b) =>
    b.convergenceIndex - a.convergenceIndex ||
    (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
  );

  const observationsByDomain = {} as Record<ConvergenceDomain, number>;
  for (const domain of DOMAIN_ORDER) {
    observationsByDomain[domain] = layers.byDomain[domain].length;
  }

  const finished = typeof performance !== "undefined" ? performance.now() : Date.now();
  const stats: DomainConvergenceStats = {
    algorithmVersion: CONVERGENCE_ALGORITHM_VERSION,
    anchorEventCount: events.length,
    eligibleAnchorCount: anchors.length,
    ineligibleAnchorCount,
    observationsByDomain,
    candidatePairCount,
    evaluatedPairCount,
    findingCount,
    qualifyingFindingCount,
    cardCount: cards.length,
    corroborationCount,
    correlationCount,
    coincidenceCount,
    countryScopeEvaluationCount,
    elapsedMs: Math.round((finished - started) * 100) / 100,
  };

  return {
    algorithmVersion: CONVERGENCE_ALGORITHM_VERSION,
    cards,
    gaps: layers.gaps,
    globalNotes,
    stats,
  };
}

/* ------------------------------------------------------------------------- */
/* Analyst summary                                                             */
/* ------------------------------------------------------------------------- */

function formatUtcMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/** Build the copyable deterministic analyst summary for one convergence card. */
export function buildConvergenceAnalystSummary(card: IncidentConvergenceCard, event: ConflictEvent | null): string {
  const lines: string[] = [];
  lines.push(`CONVERGENCE ASSESSMENT — ${event?.title ?? card.eventId}`);
  if (event) {
    lines.push(`ANCHOR INCIDENT: ${event.id} · ${formatUtcMinute(event.occurredAt)} · ${event.lat.toFixed(4)}, ${event.lng.toFixed(4)} (${event.country}) · ${event.category} · severity ${event.severity}`);
  } else {
    lines.push(`ANCHOR INCIDENT: ${card.eventId}`);
  }
  lines.push(`CLASSIFICATION: ${card.classification.toUpperCase()} — ${card.classificationReason}`);
  lines.push(`CONVERGENCE INDEX: ${card.convergenceIndex}/100 (ranking device, not a probability) · independent measurement families: ${card.independentFamilyCount}`);
  lines.push("");
  for (const alignment of card.domains) {
    const domainLabel = DOMAIN_DISPLAY[alignment.domain].label.toUpperCase();
    const status = alignment.qualifies
      ? alignment.independent ? "QUALIFIES as independent evidence" : "aligns (derivative context, not independent evidence)"
      : "overlap only — coincidence-class";
    lines.push(`[${domainLabel}] ${status} · ${alignment.findingCount} observation(s) in gates`);
    for (const finding of alignment.findings) {
      lines.push(`  · ${finding.label}${finding.detail ? ` (${finding.detail})` : ""}`);
      lines.push(`    distance ${finding.effectiveDistanceKm} km effective (${finding.distanceKm} km raw) · time gap ${finding.timeGapHours} h · score ${finding.score.toFixed(2)}${finding.qualifies ? " · qualifies" : " · below evidence bar"}`);
      for (const rationale of finding.rationale) {
        lines.push(`    - ${rationale}`);
      }
      lines.push(`    provenance: ${finding.provenance.source}${finding.provenance.observedAt ? ` · observed ${finding.provenance.observedAt}` : ""}${finding.url ? ` · ${finding.url}` : ""}`);
    }
    if (alignment.coverageNote) lines.push(`  coverage: ${alignment.coverageNote}`);
    lines.push("");
  }
  if (card.evidenceGaps.length > 0) {
    lines.push("EVIDENCE GAPS:");
    for (const gap of card.evidenceGaps) {
      lines.push(`  - ${DOMAIN_DISPLAY[gap.domain].label}: ${gap.reason}`);
    }
    lines.push("");
  }
  lines.push("UNCERTAINTY:");
  for (const note of card.uncertaintyNotes) {
    lines.push(`  - ${note}`);
  }
  lines.push("");
  lines.push(`CAVEAT: ${card.disclaimer}`);
  lines.push(`algorithm: ${card.algorithmVersion} — deterministic; identical inputs reproduce this assessment exactly`);
  return lines.join("\n");
}
