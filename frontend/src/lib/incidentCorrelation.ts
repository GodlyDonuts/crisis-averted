import type {
  ConflictEvent,
  ConflictSourceFamily,
  IncidentContradiction,
  IncidentCorrelationConfidence,
  IncidentCorrelationStats,
  IncidentEvidenceMember,
} from "@/types/conflict";

/**
 * Deterministic, explainable cross-source incident correlation (catalog items 163/178).
 *
 * Design contract:
 * - No report is ever deleted. Records that correlate are retained in full inside the
 *   canonical incident's evidence cluster; records that do not correlate pass through as
 *   their own canonical singletons. The only removal is byte-identical re-ingestion of the
 *   same record id (the same report fetched twice), which is counted, not silent.
 * - Every merge decision is reproducible: fixed thresholds, sorted iteration, no randomness,
 *   no wall-clock dependence inside scoring (the only time input is the caller-supplied
 *   `now` used solely to exclude future-dated non-incidents).
 * - Every accepted pair carries ordered human-readable rationale strings, and every member
 *   of a cluster keeps its pairwise score against the canonical representative.
 * - Curated datasets never self-merge: two UCDP records or two ACLED records are independent
 *   coded events by definition (canonical-id collisions are already resolved upstream), so
 *   same-family curated pairs are refused regardless of similarity.
 * - Candidate generation uses a uniform 1°x1° spherical grid with a 3x3 neighborhood and
 *   time-sorted sliding-window scans, so work scales ~linearly with record density rather
 *   than naively O(n^2).
 */

export const CORRELATION_ALGORITHM_VERSION = "incident-correlation-v1";

/** Categories treated as discrete battle/conflict incidents. Strategic, political, and
 *  humanitarian developments (diplomacy, sanctions, infrastructure, cyber, nuclear, protest,
 *  coup, humanitarian, migration, other) are deliberately not correlation-eligible: they are
 *  situational narratives rather than discrete physical incidents, so merging them across
 *  sources would fabricate certainty. They still pass through as visible singletons. */
const INCIDENT_CATEGORIES = new Set([
  "airstrike",
  "ground_battle",
  "missile",
  "explosion",
  "terrorism",
  "assassination",
  "border_crossing",
  "organized_violence",
  "naval",
]);

const CELL_DEGREES = 1;
const X_CELLS = Math.round(360 / CELL_DEGREES);
const Y_CELLS = Math.round(180 / CELL_DEGREES);

/** Hard spatial gate: pairs farther apart never correlate. 60 km absorbs UCDP where_prec 2
 *  (within 25 km of a known point) stacked on a second coarse source fix, while spatial evidence
 *  itself decays to zero by 55 km so fringe fixes can never carry a pair on their own. */
const MAX_DISTANCE_KM = 60;
/** Hard temporal gate on the gap between event time windows. Genuine cross-source duplicates of
 *  one incident almost always overlap or sit within hours; wider gaps are dominated by distinct
 *  same-theatre incidents, so the gate favors precision over recall. */
const MAX_TIME_GAP_HOURS = 48;
/** Extra scan slack for candidate generation so bounded-duration windows are not missed. */
const WINDOW_SCAN_SLACK_MS = 14 * 24 * 36e5;
/** Future-dated records (launches, announcements) are never incident evidence. Small slack
 *  covers timezone-skewed same-day reporting. */
const FUTURE_TOLERANCE_MS = 6 * 36e5;
/** Evidence decay geometry: full spatial evidence inside 10 km (same-town geocoding spread),
 *  linear decay to zero at 55 km. */
const FULL_SPATIAL_KM = 10;
const ZERO_SPATIAL_KM = 55;
/** Component weights. Evidence that is structurally absent contributes zero rather than being
 *  renormalized away: the score is a sum of positive evidence only, so thin evidence can never
 *  be inflated into a merge. */
const WEIGHTS = { spatial: 0.3, temporal: 0.26, title: 0.2, actor: 0.14, fatality: 0.1 };
/** Acceptance thresholds. Cross-source pairs carry independent corroborative value and use a
 *  lower bar; same-family pairs must overcome the possibility of distinct same-place incidents. */
const CROSS_SOURCE_THRESHOLD = 0.6;
const SAME_SOURCE_THRESHOLD = 0.68;
/** Members scoring below this against their own cluster's canonical representative are
 *  detached back into visible singletons: chaining through single-linkage must never hide a
 *  record that does not itself resemble the incident it was absorbed into. */
const DETACH_FLOOR = 0.45;
/** Country mismatch penalty: meaningful negative evidence, kept small for border regions. */
const COUNTRY_MISMATCH_PENALTY = 0.05;

const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "with", "after", "amid", "over", "under", "into", "from", "that", "this",
  "says", "said", "say", "report", "reports", "reported", "reportedly", "claims", "claim", "claimed",
  "officials", "official", "video", "new", "news", "update", "updates", "breaking", "live",
  "war", "conflict", "crisis", "town", "city", "village", "district", "province", "provincial",
  "region", "regional", "oblast", "governorate", "municipality", "area", "north", "south", "east",
  "west", "northern", "southern", "eastern", "western", "central", "near", "across",
  "killed", "kills", "kill", "dead", "deaths", "death", "injured", "wounded", "people", "civilian",
  "civilians", "strike", "strikes", "attack", "attacks", "hit", "hits", "shelling", "shells",
  "amid", "as", "at", "in", "on", "of", "to", "by", "is", "are", "was", "were", "be", "been",
  "a", "an", "its", "it", "his", "her", "their", "our", "us", "we", "they", "he", "she",
]);

const ACTOR_STOPWORDS = new Set([
  "government", "forces", "force", "military", "army", "armed", "group", "groups", "fighters",
  "fighter", "rebels", "rebel", "militia", "militias", "troops", "troop", "soldiers", "soldier",
  "police", "security", "state", "national", "peoples", "people", "united", "organization",
  "organisation", "movement", "front", "brigade", "battalion", "corps", "guard", "guards",
  "defense", "defence", "ministry", "department", "agency", "committee", "council", "authority",
  "authorities", "administration", "regime", "pro", "anti", "backed", "allied", "affiliated",
  "loyal", "opposition", "insurgents", "insurgent", "militants", "militant", "paramilitary",
  "the", "of", "and", "for", "in", "on", "a", "an",
]);

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const la1 = (lat1 * Math.PI) / 180;
  const la2 = (lat2 * Math.PI) / 180;
  const dLat = la2 - la1;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Crude deterministic morphological normalization for similarity evidence only.
 *  Strips common relational suffixes and trailing vowels so inflected names compare equal
 *  (russia/russian, ukraine/ukrainian, china/chinese). Not a linguistic stemmer; documented
 *  approximation used solely inside scored similarity, never to rewrite source text. */
function stemToken(token: string): string {
  let stem = token;
  if (stem.length > 4) {
    for (const suffix of ["ian", "an", "ish", "ese", "ist", "ism"]) {
      if (stem.endsWith(suffix) && stem.length - suffix.length >= 3) {
        stem = stem.slice(0, stem.length - suffix.length);
        break;
      }
    }
  }
  while (stem.length > 3 && /[aeiou]$/.test(stem)) stem = stem.slice(0, -1);
  return stem;
}

function tokenize(text: string, stopwords: Set<string>): Set<string> {
  const tokens = new Set<string>();
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const raw of normalized.split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (/^\d+$/.test(raw)) continue;
    if (stopwords.has(raw)) continue;
    const stem = stemToken(raw);
    if (stem.length < 3) continue;
    if (stopwords.has(stem)) continue;
    tokens.add(stem);
  }
  return tokens;
}

/** Overlap coefficient |intersection| / min(|a|, |b|); null when either set is empty. */
function overlapCoefficient(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 || b.size === 0) return null;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) if (larger.has(token)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

function formatTokenList(tokens: Set<string>, cap = 4): string {
  return [...tokens].sort().slice(0, cap).join(", ");
}

function intersectTokens(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) if (larger.has(token)) out.add(token);
  return out;
}

export function resolveSourceFamily(event: Pick<ConflictEvent, "id" | "sourceName" | "ucdp" | "sourceFamily">): ConflictSourceFamily {
  if (event.sourceFamily) return event.sourceFamily;
  if (event.ucdp || /^ucdp:\d+$/.test(event.id)) return "ucdp";
  if (/^(mow-)?acled[-:]/i.test(event.id) || event.sourceName === "ACLED") return "acled";
  if (event.id.startsWith("mow-") || event.sourceName === "Map of Wars") return "mapofwars";
  return "unknown";
}

export interface EventFeatures {
  index: number;
  event: ConflictEvent;
  family: ConflictSourceFamily;
  cellX: number;
  cellY: number;
  windowStart: number;
  windowEnd: number;
  titleTokens: Set<string>;
  actorTokens: Set<string>;
  conflictTokens: Set<string>;
  countryKey: string;
  /** Actor evidence derived from structured fields/detail, false when only conflict-name proxies exist. */
  hasDirectActors: boolean;
}

function parseIsoDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? ms : null;
}

function extractActorTokens(event: ConflictEvent): { tokens: Set<string>; direct: boolean } {
  const tokens = new Set<string>();
  let direct = false;
  if (event.ucdp) {
    for (const side of [event.ucdp.side_a, event.ucdp.side_b]) {
      if (!side) continue;
      direct = true;
      for (const token of tokenize(side, ACTOR_STOPWORDS)) tokens.add(token);
    }
  }
  const detail = event.detail;
  if (detail) {
    // ACLED lattice rows read "subevent · actor1 vs actor2 · N reported fatalities"; UCDP lattice
    // rows read "†X best (...) · sideA - sideB · violence type". The actor segment is the one
    // carrying an explicit adversarial separator.
    for (const segment of detail.split("·").map((part) => part.trim())) {
      if (!/\s+vs\.?\s+|\s+-\s+/.test(segment) || segment.length > 240) continue;
      const before = new Set(tokens);
      for (const token of tokenize(segment, ACTOR_STOPWORDS)) tokens.add(token);
      if (tokens.size > before.size) direct = true;
    }
  }
  return { tokens, direct };
}

/** Deterministic feature extraction for one normalized record. Exported so validation
 *  harnesses can inspect pairwise assessments directly. */
export function extractEventFeatures(event: ConflictEvent, index: number): EventFeatures {
  const family = resolveSourceFamily(event);
  const lat = Math.min(90, Math.max(-90, event.lat));
  const lng = Math.min(180, Math.max(-180, event.lng));
  const cellX = Math.floor((lng + 180) / CELL_DEGREES) % X_CELLS;
  const cellY = Math.min(Y_CELLS - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEGREES)));
  let windowStart = event.occurredAt;
  let windowEnd = event.occurredAt;
  if (event.ucdp) {
    const start = parseIsoDay(event.ucdp.date_start);
    const end = parseIsoDay(event.ucdp.date_end);
    if (start !== null && end !== null && start <= end) {
      windowStart = start;
      windowEnd = end + 24 * 36e5 - 1; // date_end is an inclusive UTC day in the GED contract
    }
  } else if (event.occurredAt > 0 && event.occurredAt % (24 * 36e5) === 0) {
    // A timestamp exactly at a UTC midnight boundary is a modeling artifact of date-only
    // source data (UCDP lattice rows, ACLED event_date), not a claim the incident happened at
    // midnight. Treat it as the day-resolution window the publisher actually supplies.
    windowEnd = event.occurredAt + 24 * 36e5 - 1;
  }
  const actors = extractActorTokens(event);
  return {
    index,
    event,
    family,
    cellX,
    cellY,
    windowStart,
    windowEnd,
    titleTokens: tokenize(event.title, TITLE_STOPWORDS),
    actorTokens: actors.tokens,
    conflictTokens: tokenize(event.conflict || "", TITLE_STOPWORDS),
    countryKey: (event.country || "").trim().toLowerCase(),
    hasDirectActors: actors.direct,
  };
}

export interface PairAssessment {
  score: number;
  distanceKm: number;
  timeGapHours: number;
  spatialScore: number;
  temporalScore: number;
  titleScore: number | null;
  actorScore: number | null;
  fatalityScore: number | null;
  crossFamily: boolean;
  countryMismatch: boolean;
  rationale: string[];
}

function timeGapHours(a: EventFeatures, b: EventFeatures): number {
  const gapMs = Math.max(0, Math.max(a.windowStart - b.windowEnd, b.windowStart - a.windowEnd));
  return gapMs / 36e5;
}

function fatalityEvidence(a: ConflictEvent, b: ConflictEvent): { score: number | null; note: string } {
  const ka = a.killed;
  const kb = b.killed;
  if (ka === kb) {
    if (ka > 0) return { score: 1, note: `fatalities: both report ${ka} killed` };
    return { score: null, note: "fatalities: both report zero — no distinguishing evidence" };
  }
  if (ka > 0 && kb > 0) {
    const ratio = Math.max(ka, kb) / Math.min(ka, kb);
    const score = ratio <= 1.25 ? 1 : ratio <= 2 ? 0.75 : ratio <= 3 ? 0.5 : ratio <= 5 ? 0.25 : 0;
    return { score, note: `fatalities: ${ka} vs ${kb} killed (ratio ${ratio.toFixed(1)})` };
  }
  const positive = Math.max(ka, kb);
  const score = positive <= 2 ? 0.3 : 0.15;
  return { score, note: `fatalities: ${ka} vs ${kb} killed — one record lacks a positive toll` };
}

/** Compute the full deterministic pairwise assessment. Pure: no clocks, no randomness. */
export function assessPair(a: EventFeatures, b: EventFeatures): PairAssessment {
  const rationale: string[] = [];
  const distanceKm = haversineKm(a.event.lat, a.event.lng, b.event.lat, b.event.lng);
  let spatialScore = distanceKm <= FULL_SPATIAL_KM ? 1 : Math.max(0, 1 - (distanceKm - FULL_SPATIAL_KM) / (ZERO_SPATIAL_KM - FULL_SPATIAL_KM));
  // Precision-aware discount: WarHeatMap precision codes and UCDP where_prec share a 1-7 scale
  // (exact, town, district, province, linear, country, offshore/airspace). Coarse fixes place
  // distinct incidents at shared administrative or feature centroids, so proximity at country
  // level or beyond is weak evidence of sameness and is discounted accordingly. Missing
  // precision is neutral — lattice rows are usually town-level fixes.
  const precisions = [a.event.precision, b.event.precision].filter((value): value is number => typeof value === "number" && value >= 1);
  const worstPrecision = precisions.length > 0 ? Math.max(...precisions) : 1;
  const precisionFactor = worstPrecision >= 7 ? 0.2 : worstPrecision === 6 ? 0.35 : worstPrecision === 5 ? 0.6 : 1;
  let precisionNote = "";
  if (precisionFactor < 1) {
    spatialScore *= precisionFactor;
    precisionNote = `, discounted ×${precisionFactor} because the coarsest fix is precision ${worstPrecision} (centroid proximity is weak evidence)`;
  }
  rationale.push(
    distanceKm <= FULL_SPATIAL_KM
      ? `spatial: ${distanceKm.toFixed(1)} km apart, inside the ${FULL_SPATIAL_KM} km full-evidence radius${precisionNote}`
      : `spatial: ${distanceKm.toFixed(1)} km apart, evidence decayed toward zero at ${ZERO_SPATIAL_KM} km inside the ${MAX_DISTANCE_KM} km gate${precisionNote}`
  );

  const gapHours = timeGapHours(a, b);
  const maxWindowHours = Math.max(a.windowEnd - a.windowStart, b.windowEnd - b.windowStart) / 36e5;
  // Temporal evidence is deliberately non-linear: overlapping windows are the strong signal of
  // shared incident time; small gaps are consistent with timezone/reporting slack; gaps beyond
  // a day are dominated by distinct same-theatre incidents.
  let temporalScore = gapHours <= 0 ? 1 : gapHours <= 6 ? 0.7 : gapHours <= 12 ? 0.55 : gapHours <= 24 ? 0.3 : gapHours <= 48 ? 0.1 : 0;
  // Most source datasets are day-resolution: sharing a UTC calendar day is meaningful even when
  // exact hours are modeling artifacts rather than measurements.
  if (temporalScore < 0.6 && gapHours > 0) {
    const dayA = Math.floor(a.event.occurredAt / (24 * 36e5));
    const dayB = Math.floor(b.event.occurredAt / (24 * 36e5));
    if (dayA === dayB) temporalScore = 0.6;
  }
  // Imprecise windows (weeks-long UCDP ranges) overlap many unrelated reports; discount them.
  if (maxWindowHours > 96) temporalScore *= Math.sqrt(96 / maxWindowHours);
  rationale.push(
    gapHours <= 0
      ? `temporal: time windows overlap${maxWindowHours > 96 ? ` but span ${Math.round(maxWindowHours / 24)} days (discounted)` : ""}`
      : `temporal: ${gapHours.toFixed(1)} h gap between windows (weak evidence beyond same-day overlap)`
  );

  const sharedTitle = intersectTokens(a.titleTokens, b.titleTokens);
  const titleScore = overlapCoefficient(a.titleTokens, b.titleTokens);
  if (titleScore !== null) {
    rationale.push(
      sharedTitle.size > 0
        ? `title/location: shared tokens ${formatTokenList(sharedTitle)} (overlap ${titleScore.toFixed(2)})`
        : "title/location: no shared significant tokens"
    );
  }

  let actorScore = overlapCoefficient(a.actorTokens, b.actorTokens);
  let actorNote = "";
  if (actorScore !== null && actorScore > 0) {
    const shared = intersectTokens(a.actorTokens, b.actorTokens);
    actorNote = `actors: shared distinctive tokens ${formatTokenList(shared)}`;
  } else if (actorScore !== null) {
    actorNote = "actors: no shared distinctive tokens";
  }
  if (actorScore === null && (!a.hasDirectActors || !b.hasDirectActors)) {
    const conflictSim = overlapCoefficient(a.conflictTokens, b.conflictTokens);
    if (conflictSim !== null) {
      actorScore = conflictSim * 0.5;
      actorNote = `actors: no direct actor fields; conflict-name proxy overlap ${conflictSim.toFixed(2)} at half weight`;
    }
  }
  if (actorNote) rationale.push(actorNote);

  const fatality = fatalityEvidence(a.event, b.event);
  rationale.push(fatality.note);

  // Aggregation: sum of positive weighted evidence only. Structurally absent evidence (null)
  // contributes zero at full weight — never renormalized upward — so thin evidence cannot be
  // inflated into a merge, and every accepted pair visibly earned its score.
  let score =
    WEIGHTS.spatial * spatialScore +
    WEIGHTS.temporal * temporalScore +
    WEIGHTS.title * (titleScore ?? 0) +
    WEIGHTS.actor * (actorScore ?? 0) +
    WEIGHTS.fatality * (fatality.score ?? 0);

  // Negative evidence: token-rich records sharing no title/location tokens are unlikely to
  // describe the same incident, even when co-located in space and time.
  if (titleScore === 0 && a.titleTokens.size >= 3 && b.titleTokens.size >= 3) {
    score = Math.max(0, score - 0.06);
    rationale.push("title/location: token-rich titles share nothing (-0.06)");
  }
  if (actorScore === 0 && a.hasDirectActors && b.hasDirectActors && a.actorTokens.size >= 2 && b.actorTokens.size >= 2) {
    score = Math.max(0, score - 0.05);
    rationale.push("actors: both records name actors yet share no distinctive tokens (-0.05)");
  }

  const countryMismatch = Boolean(a.countryKey && b.countryKey && a.countryKey !== b.countryKey && a.countryKey !== "unknown" && b.countryKey !== "unknown");
  if (countryMismatch) {
    score = Math.max(0, score - COUNTRY_MISMATCH_PENALTY);
    rationale.push(`country mismatch: ${a.event.country} vs ${b.event.country} (-${COUNTRY_MISMATCH_PENALTY})`);
  }

  return {
    score,
    distanceKm,
    timeGapHours: gapHours,
    spatialScore,
    temporalScore,
    titleScore,
    actorScore,
    fatalityScore: fatality.score,
    crossFamily: a.family !== b.family,
    countryMismatch,
    rationale,
  };
}

const CURATED_FAMILIES = new Set<ConflictSourceFamily>(["ucdp", "acled"]);

export interface CorrelationOptions {
  now?: number;
}

export interface CorrelationResult {
  incidents: ConflictEvent[];
  stats: IncidentCorrelationStats;
}

function isCorrelatable(event: ConflictEvent, now: number): boolean {
  if (!INCIDENT_CATEGORIES.has(event.category)) return false;
  if (!Number.isFinite(event.occurredAt) || event.occurredAt <= 0) return false;
  if (event.occurredAt > now + FUTURE_TOLERANCE_MS) return false;
  return true;
}

function canonicalQuality(event: ConflictEvent): number {
  const precisionBoost = event.precision !== null ? ((7 - Math.min(7, Math.max(1, event.precision))) / 7) * 0.05 : 0;
  return (
    event.intensity +
    (event.verified ? 0.08 : 0) +
    (event.ucdp ? 0.06 : 0) +
    precisionBoost +
    Math.min(event.sources.length, 3) * 0.01
  );
}

function confidenceReason(confidence: IncidentCorrelationConfidence, families: ConflictSourceFamily[], memberCount: number, contradictions: IncidentContradiction[]): string {
  const familyList = [...families].sort().join(", ");
  switch (confidence) {
    case "corroborated":
      return `${families.length} independent source families (${familyList}) report consistent evidence for one incident`;
    case "contested":
      return `linked reports materially disagree (${contradictions.map((item) => item.kind).join(", ")}); contradictions are preserved, not resolved`;
    case "inferred":
      return `${memberCount} linked reports all come from one source family (${familyList}); the grouping is inferred duplicate reporting, not independent corroboration`;
    default:
      return "no additional report met the deterministic correlation threshold; absence of corroboration is a coverage statement, not a dismissal";
  }
}

export function correlateConflictEvents(input: ConflictEvent[], options: CorrelationOptions = {}): CorrelationResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = options.now ?? Date.now();

  // Deterministic input ordering: id ascending, then freshest revision first so the exact-id
  // collapse below keeps the most recently updated version of a re-ingested record.
  const ordered = [...input].sort((a, b) =>
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
    b.updatedAt - a.updatedAt ||
    b.occurredAt - a.occurredAt
  );

  // Pass 1: exact-id re-ingestion collapse. The same record id reaching the pipeline twice is
  // the same report fetched twice (live feed + cached fallback overlap), not an independent
  // record. The first deterministic occurrence is kept and the collapse is counted openly.
  const seenIds = new Set<string>();
  const unique: ConflictEvent[] = [];
  let exactDuplicateRecordCount = 0;
  for (const event of ordered) {
    if (seenIds.has(event.id)) {
      exactDuplicateRecordCount += 1;
      continue;
    }
    seenIds.add(event.id);
    unique.push(event);
  }

  // Pass 2: feature extraction and eligibility. Ineligible records (non-incident categories,
  // future-dated rows) are never merged — but never hidden either; they pass through as singletons.
  const features = unique.map((event, index) => extractEventFeatures(event, index));
  const eligible: EventFeatures[] = [];
  const passthrough: EventFeatures[] = [];
  for (const feature of features) {
    if (isCorrelatable(feature.event, now)) eligible.push(feature);
    else passthrough.push(feature);
  }

  // Pass 3: candidate generation on a uniform spherical grid. 1° cells with a 3x3 neighborhood
  // cover the 60 km hard gate everywhere on earth; longitudinal wrap is handled modulo cells.
  const cells = new Map<string, EventFeatures[]>();
  for (const feature of eligible) {
    const key = `${feature.cellX}:${feature.cellY}`;
    const list = cells.get(key);
    if (list) list.push(feature);
    else cells.set(key, [feature]);
  }
  for (const list of cells.values()) {
    list.sort((a, b) => a.event.occurredAt - b.event.occurredAt || (a.event.id < b.event.id ? -1 : 1));
  }

  interface AcceptedPair {
    a: EventFeatures;
    b: EventFeatures;
    assessment: PairAssessment;
  }
  const acceptedPairs: AcceptedPair[] = [];
  let candidatePairCount = 0;
  let evaluatedPairCount = 0;
  const scanSlackMs = MAX_TIME_GAP_HOURS * 36e5 + WINDOW_SCAN_SLACK_MS;

  const pairPasses = (a: EventFeatures, b: EventFeatures): PairAssessment | null => {
    evaluatedPairCount += 1;
    // Curated datasets never self-merge: their rows are independent coded events by definition.
    if (a.family === b.family && CURATED_FAMILIES.has(a.family)) return null;
    const assessment = assessPair(a, b);
    if (assessment.distanceKm > MAX_DISTANCE_KM) return null;
    if (assessment.timeGapHours > MAX_TIME_GAP_HOURS) return null;
    const bothKnownDistinct = a.family !== b.family && a.family !== "unknown" && b.family !== "unknown";
    const threshold = bothKnownDistinct ? CROSS_SOURCE_THRESHOLD : SAME_SOURCE_THRESHOLD;
    if (assessment.score < threshold) return null;
    return assessment;
  };

  const sortedKeys = [...cells.keys()].sort();
  for (const keyA of sortedKeys) {
    const [xA, yA] = keyA.split(":").map(Number);
    const listA = cells.get(keyA);
    if (!listA) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const xB = (xA + dx + X_CELLS) % X_CELLS;
        const yB = yA + dy;
        if (yB < 0 || yB >= Y_CELLS) continue;
        const keyB = `${xB}:${yB}`;
        if (keyB < keyA) continue; // each unordered cell pair is processed exactly once
        const listB = cells.get(keyB);
        if (!listB) continue;
        const sameCell = keyA === keyB;
        for (let i = 0; i < listA.length; i += 1) {
          const fa = listA[i];
          const aMin = fa.event.occurredAt - scanSlackMs;
          const aMax = fa.event.occurredAt + scanSlackMs;
          // binary search: first index in listB whose occurredAt >= aMin
          let lo = 0;
          let hi = listB.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (listB[mid].event.occurredAt < aMin) lo = mid + 1;
            else hi = mid;
          }
          for (let j = lo; j < listB.length; j += 1) {
            const fb = listB[j];
            if (fb.event.occurredAt > aMax) break;
            if (sameCell && fb.index <= fa.index) continue;
            candidatePairCount += 1;
            const assessment = pairPasses(fa, fb);
            if (assessment) acceptedPairs.push({ a: fa, b: fb, assessment });
          }
        }
      }
    }
  }

  // Pass 4: deterministic single-linkage union-find over accepted pairs, strongest evidence first.
  const parent = new Map<number, number>();
  const find = (value: number): number => {
    let root = value;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) as number;
    let node = value;
    while (parent.get(node) !== undefined && parent.get(node) !== node) {
      const next = parent.get(node) as number;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  const orderedPairs = [...acceptedPairs].sort((p, q) =>
    q.assessment.score - p.assessment.score ||
    (p.a.event.id < q.a.event.id ? -1 : p.a.event.id > q.a.event.id ? 1 : 0) ||
    (p.b.event.id < q.b.event.id ? -1 : p.b.event.id > q.b.event.id ? 1 : 0)
  );
  for (const pair of orderedPairs) union(pair.a.index, pair.b.index);

  const clusterMap = new Map<number, EventFeatures[]>();
  for (const feature of eligible) {
    const root = find(feature.index);
    const list = clusterMap.get(root);
    if (list) list.push(feature);
    else clusterMap.set(root, [feature]);
  }

  // Pass 5: canonical selection, chain-guard detachment, contradictions, confidence, assembly.
  const incidents: ConflictEvent[] = [];
  let contestedClusterCount = 0;
  let corroboratedClusterCount = 0;
  let inferredClusterCount = 0;
  let singleSourceClusterCount = 0;
  let multiMemberClusterCount = 0;
  let correlatedEvidenceRecordCount = 0;

  const emitSingleton = (feature: EventFeatures, note: string) => {
    singleSourceClusterCount += 1;
    const clusterId = `inc:${feature.event.id}`;
    incidents.push({
      ...feature.event,
      incident: {
        clusterId,
        canonicalEventId: feature.event.id,
        isCanonical: true,
        correlationScore: 1,
        confidence: "single-source",
        memberCount: 1,
        independentFamilyCount: 1,
        rationale: [note],
      },
    });
  };

  const clusters = [...clusterMap.values()].sort((a, b) => {
    const aMin = Math.min(...a.map((f) => f.index));
    const bMin = Math.min(...b.map((f) => f.index));
    return aMin - bMin;
  });

  for (const members of clusters) {
    // canonical representative: highest quality, then most recent, then lowest id — fully deterministic
    const ranked = [...members].sort((a, b) =>
      canonicalQuality(b.event) - canonicalQuality(a.event) ||
      b.event.occurredAt - a.event.occurredAt ||
      (a.event.id < b.event.id ? -1 : 1)
    );
    const canonical = ranked[0];

    if (ranked.length === 1) {
      emitSingleton(canonical, "no additional report met the deterministic correlation threshold");
      continue;
    }

    // Chain guard: every member must itself resemble the canonical representative. Single-linkage
    // chaining can otherwise absorb same-town different-day incidents transitively. Detached records
    // are not deleted — they re-emerge as their own visible singleton incidents.
    const retained: EventFeatures[] = [canonical];
    const detached: EventFeatures[] = [];
    const memberAssessments = new Map<number, PairAssessment>();
    for (const member of ranked.slice(1)) {
      const assessment = assessPair(member, canonical);
      memberAssessments.set(member.index, assessment);
      const gatesOk = assessment.distanceKm <= MAX_DISTANCE_KM && assessment.timeGapHours <= MAX_TIME_GAP_HOURS;
      if (assessment.score >= DETACH_FLOOR && gatesOk) retained.push(member);
      else detached.push(member);
    }
    for (const feature of detached) {
      emitSingleton(feature, "detached from a correlated cluster: pairwise evidence against the canonical record fell below the chain-guard floor, so the report is presented independently rather than absorbed");
    }

    if (retained.length === 1) {
      emitSingleton(canonical, "no additional report met the deterministic correlation threshold");
      continue;
    }

    multiMemberClusterCount += 1;
    correlatedEvidenceRecordCount += retained.length - 1;

    // Contradiction detection across retained members (canonical included), all deterministic.
    const allRecords = retained;
    const contradictions: IncidentContradiction[] = [];

    const positiveTolls = allRecords.filter((f) => f.event.killed > 0);
    if (positiveTolls.length >= 2) {
      const tolls = positiveTolls.map((f) => f.event.killed);
      const minToll = Math.min(...tolls);
      const maxToll = Math.max(...tolls);
      if (maxToll >= 3 * minToll) {
        const lowRecord = positiveTolls.find((f) => f.event.killed === minToll);
        const highRecord = positiveTolls.find((f) => f.event.killed === maxToll);
        contradictions.push({
          kind: "fatalities",
          summary: `reported fatalities range from ${minToll} (${lowRecord?.family ?? "unknown source"}) to ${maxToll} (${highRecord?.family ?? "unknown source"}) — a ${(maxToll / minToll).toFixed(1)}x spread across linked reports`,
          memberEventIds: positiveTolls.map((f) => f.event.id).sort(),
        });
      }
    }

    const actorDisputes: string[] = [];
    for (const member of allRecords.slice(1)) {
      if (canonical.actorTokens.size >= 2 && member.actorTokens.size >= 2) {
        const shared = intersectTokens(canonical.actorTokens, member.actorTokens);
        if (shared.size === 0) actorDisputes.push(member.event.id);
      }
    }
    if (actorDisputes.length > 0) {
      contradictions.push({
        kind: "actors",
        summary: `${actorDisputes.length} linked report${actorDisputes.length === 1 ? "" : "s"} share no distinctive actor tokens with the canonical record (${formatTokenList(canonical.actorTokens)})`,
        memberEventIds: [canonical.event.id, ...actorDisputes].sort(),
      });
    }

    let maxSpreadKm = 0;
    for (let i = 0; i < allRecords.length; i += 1) {
      for (let j = i + 1; j < allRecords.length; j += 1) {
        const d = haversineKm(allRecords[i].event.lat, allRecords[i].event.lng, allRecords[j].event.lat, allRecords[j].event.lng);
        if (d > maxSpreadKm) maxSpreadKm = d;
      }
    }
    if (maxSpreadKm > 40) {
      contradictions.push({
        kind: "location",
        summary: `linked reports span ${maxSpreadKm.toFixed(0)} km; the fusion of distant fixes may chain distinct incidents`,
        memberEventIds: allRecords.map((f) => f.event.id).sort(),
      });
    }

    const familySet = new Set<ConflictSourceFamily>();
    for (const feature of allRecords) {
      if (feature.family !== "unknown") familySet.add(feature.family);
    }
    const independentFamilyCount = Math.max(1, familySet.size);

    let confidence: IncidentCorrelationConfidence;
    if (contradictions.length > 0) confidence = "contested";
    else if (independentFamilyCount >= 2) confidence = "corroborated";
    else confidence = "inferred";

    if (confidence === "contested") contestedClusterCount += 1;
    else if (confidence === "corroborated") corroboratedClusterCount += 1;
    else inferredClusterCount += 1;

    const clusterId = `inc:${canonical.event.id}`;
    const membersSorted = [...allRecords].sort((a, b) => {
      if (a.index === canonical.index) return -1;
      if (b.index === canonical.index) return 1;
      const sa = memberAssessments.get(a.index)?.score ?? 0;
      const sb = memberAssessments.get(b.index)?.score ?? 0;
      return sb - sa || (a.event.id < b.event.id ? -1 : 1);
    });

    const evidenceMembers: IncidentEvidenceMember[] = membersSorted
      .filter((feature) => feature.index !== canonical.index)
      .map((feature) => {
        const assessment = memberAssessments.get(feature.index);
        const score = assessment?.score ?? 0;
        return {
          event: {
            ...feature.event,
            incident: {
              clusterId,
              canonicalEventId: canonical.event.id,
              isCanonical: false,
              correlationScore: score,
              confidence,
              memberCount: allRecords.length,
              independentFamilyCount,
              rationale: assessment?.rationale ?? [],
            },
          },
          sourceFamily: feature.family,
          correlationScore: score,
          rationale: assessment?.rationale ?? [],
        };
      });

    incidents.push({
      ...canonical.event,
      incident: {
        clusterId,
        canonicalEventId: canonical.event.id,
        isCanonical: true,
        correlationScore: 1,
        confidence,
        memberCount: allRecords.length,
        independentFamilyCount,
        rationale: [`selected as canonical representative: highest deterministic quality score among ${allRecords.length} linked reports`],
      },
      evidence: {
        clusterId,
        canonicalEventId: canonical.event.id,
        algorithmVersion: CORRELATION_ALGORITHM_VERSION,
        confidence,
        confidenceReason: confidenceReason(confidence, [...familySet], allRecords.length, contradictions),
        sourceFamilies: [...familySet].sort(),
        independentFamilyCount,
        memberCount: allRecords.length,
        contradictions,
        members: evidenceMembers,
      },
    });
  }

  // Pass-through singletons: non-incident categories and future-dated rows. Never merged, never hidden.
  for (const feature of passthrough) {
    emitSingleton(feature, feature.event.occurredAt > now + FUTURE_TOLERANCE_MS
      ? "future-dated record: not eligible for incident correlation (launches and announced events are never merged)"
      : "non-incident category: not eligible for incident correlation; presented as an independent record");
  }

  incidents.sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? -1 : 1));

  const finished = typeof performance !== "undefined" ? performance.now() : Date.now();
  const stats: IncidentCorrelationStats = {
    algorithmVersion: CORRELATION_ALGORITHM_VERSION,
    inputRecordCount: input.length,
    exactDuplicateRecordCount,
    correlationEligibleRecordCount: eligible.length,
    ineligibleRecordCount: passthrough.length,
    incidentCount: incidents.length,
    multiMemberClusterCount,
    correlatedEvidenceRecordCount,
    contestedClusterCount,
    corroboratedClusterCount,
    inferredClusterCount,
    singleSourceClusterCount,
    candidatePairCount,
    evaluatedPairCount,
    elapsedMs: Math.round((finished - started) * 100) / 100,
  };

  return { incidents, stats };
}
