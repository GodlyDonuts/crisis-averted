import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, 'frontend/public/data/osint-snapshot.json');
mkdirSync(dirname(outFile), { recursive: true });

async function getJson(url, timeout = 14000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GodseyeOSINT/1.0 (+https://github.com/GodlyDonuts/crisis-averted)', ...extraHeaders },
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function getText(url, timeout = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 GodseyeOSINT/1.0' } });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseRssItems(xml, limit = 30) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((match) => {
    const item = match[1];
    const pick = (tag) => { const start = item.indexOf(`<${tag}>`); const end = item.indexOf(`</${tag}>`, start); return start < 0 || end < 0 ? "" : decodeXml(item.slice(start + tag.length + 2, end).replace(/<!\[CDATA\[|\]\]>/g, "").trim()); };
    return { title: pick('title'), url: pick('link'), source: pick('source') || 'Google News', publishedAt: pick('pubDate') || null };
  }).filter((article) => article.title && article.url);
}

const IODA_EVENTS_API_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events';
const IODA_API_BASE_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
const IODA_ENTITY_TYPES = ['country', 'region'];
const IODA_LOOKBACK_SECONDS = 24 * 60 * 60;
const IODA_EXTEND_WINDOW_SECONDS = 24 * 60 * 60;
const IODA_PAGE_LIMIT = 1000;
const IODA_MAX_PAGES_PER_ENTITY_TYPE = 3;
const IODA_REFERENCE_FILE = join(root, 'scripts', 'natural-earth-reference-points.json');
const IODA_LIMITATIONS = 'IODA detections describe macroscopic Internet connectivity change, not causal attribution, intent, a proven shutdown, or the connectivity of any particular user or facility. Coordinates are broad Natural Earth reference placements rather than outage origins or spatial footprints. An empty result is not an all-clear; an end equal to the query horizon is clipped/ambiguous and establishes neither recovery nor continuing outage.';

function unixSecondsToIso(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function createIodaQueryWindow() {
  const until = Math.floor(Date.now() / 1000);
  const from = until - IODA_LOOKBACK_SECONDS;
  return {
    from,
    until,
    fromIso: unixSecondsToIso(from),
    untilIso: unixSecondsToIso(until),
    lookbackSeconds: IODA_LOOKBACK_SECONDS,
    extendWindowSeconds: IODA_EXTEND_WINDOW_SECONDS,
  };
}

function createIodaUnavailableMeta(queryWindow) {
  return {
    status: 'unavailable',
    provider: 'Georgia Tech Internet Outage Detection and Analysis (IODA)',
    apiBaseUrl: IODA_API_BASE_URL,
    queryWindow,
    entityTypes: [...IODA_ENTITY_TYPES],
    format: 'ioda',
    overall: false,
    includeAlerts: false,
    pageLimit: IODA_PAGE_LIMIT,
    maxPagesPerEntityType: IODA_MAX_PAGES_PER_ENTITY_TYPE,
    fetchedEventCount: 0,
    countryEventCount: 0,
    regionEventCount: 0,
    geolocatedEventCount: 0,
    omittedEventCount: 0,
    omittedByReason: {
      invalidEventContract: 0,
      missingCoordinateReference: 0,
    },
    requestUrls: [],
    coordinateReference: 'Natural Earth v5.1.2 country label coordinates and admin-1 reference latitude/longitude attributes',
    caveat: IODA_LIMITATIONS,
  };
}

function buildIodaEventsUrl(entityType, queryWindow, page) {
  const url = new URL(IODA_EVENTS_API_URL);
  url.searchParams.set('from', String(queryWindow.from));
  url.searchParams.set('until', String(queryWindow.until));
  url.searchParams.set('entityType', entityType);
  url.searchParams.set('format', 'ioda');
  url.searchParams.set('overall', 'false');
  url.searchParams.set('includeAlerts', 'false');
  url.searchParams.set('orderBy', 'time/desc');
  url.searchParams.set('limit', String(IODA_PAGE_LIMIT));
  url.searchParams.set('page', String(page));
  url.searchParams.set('extendWindow', String(IODA_EXTEND_WINDOW_SECONDS));
  return url;
}

async function fetchIodaEntityEvents(entityType, queryWindow) {
  const events = [];
  const requestUrls = [];
  for (let page = 0; page < IODA_MAX_PAGES_PER_ENTITY_TYPE; page += 1) {
    const url = buildIodaEventsUrl(entityType, queryWindow, page);
    requestUrls.push(url.toString());
    const payload = await getJson(url, 26000);
    if (payload.error) throw new Error(`IODA ${entityType} page ${page}: ${payload.error}`);
    if (payload.type !== 'outages.events' || !Array.isArray(payload.data)) throw new Error(`IODA ${entityType} page ${page}: unexpected response contract`);
    events.push(...payload.data);
    if (payload.data.length < IODA_PAGE_LIMIT) break;
  }
  return { events, requestUrls };
}

function loadNaturalEarthReferencePoints() {
  const payload = JSON.parse(readFileSync(IODA_REFERENCE_FILE, 'utf8'));
  if (payload.schemaVersion !== 1 || !payload.countries || !payload.regions) throw new Error('Natural Earth reference-point file has an unexpected contract');
  return payload;
}

function validIodaEventContract(event, entityType) {
  return Boolean(
    event &&
    typeof event === 'object' &&
    event.entity?.type === entityType &&
    typeof event.entity.code === 'string' && event.entity.code.length > 0 &&
    typeof event.entity.name === 'string' && event.entity.name.length > 0 &&
    Number.isInteger(event.from) && event.from > 0 &&
    Number.isInteger(event.until) && event.until > 0 &&
    event.from <= event.until &&
    Number.isFinite(event.score) && event.score >= 0 &&
    (event.datasource == null || typeof event.datasource === 'string') &&
    (event.method == null || typeof event.method === 'string')
  );
}

function resolveIodaCoordinates(event, referencePoints) {
  if (event.entity.type === 'country') {
    const reference = referencePoints.countries[event.entity.code];
    if (!reference) return null;
    return {
      lat: reference.lat,
      lng: reference.lng,
      coordinatePrecision: 'country-reference',
      coordinateNote: 'Country-scope IODA detection plotted at a Natural Earth cartographic reference point. This is symbolic country-level placement, not an outage origin, asset location, centroid of impact, or spatial footprint.',
    };
  }

  const regionId = event.entity.attrs?.ne_region_id == null ? null : String(event.entity.attrs.ne_region_id);
  const reference = regionId ? referencePoints.regions[regionId] : null;
  if (!reference) return null;
  return {
    lat: reference.lat,
    lng: reference.lng,
    coordinatePrecision: 'region-reference',
    coordinateNote: 'Region-scope IODA detection plotted at a Natural Earth admin-1 reference coordinate. This is broad regional placement, not an outage origin, asset location, centroid of impact, or spatial footprint.',
    naturalEarthRegionId: regionId,
  };
}

function normalizeIodaOutageEvent(event, queryWindow, referencePoints) {
  const coordinates = resolveIodaCoordinates(event, referencePoints);
  if (!coordinates) return null;
  const attrs = event.entity.attrs ?? {};
  const countryCode = event.entity.type === 'country'
    ? event.entity.code
    : typeof attrs.country_code === 'string' ? attrs.country_code : null;
  const countryName = event.entity.type === 'country'
    ? event.entity.name
    : typeof attrs.country_name === 'string' ? attrs.country_name : null;
  return {
    entityType: event.entity.type,
    entityCode: event.entity.code,
    entityName: event.entity.name,
    countryCode,
    countryName,
    naturalEarthRegionId: coordinates.naturalEarthRegionId ?? null,
    lat: coordinates.lat,
    lng: coordinates.lng,
    coordinatePrecision: coordinates.coordinatePrecision,
    coordinateNote: coordinates.coordinateNote,
    from: event.from,
    until: event.until,
    score: event.score,
    datasource: event.datasource ?? null,
    method: event.method ?? null,
    fromBeforeQueryWindow: event.from < queryWindow.from,
    untilEqualsQueryHorizon: event.until === queryWindow.until,
  };
}

async function collectIodaOutages(queryWindow) {
  const referencePoints = loadNaturalEarthReferencePoints();
  const requestUrls = [];
  const rawEvents = [];
  const perTypeCounts = { country: 0, region: 0 };

  for (const entityType of IODA_ENTITY_TYPES) {
    const pageResult = await fetchIodaEntityEvents(entityType, queryWindow);
    rawEvents.push(...pageResult.events.map((event) => ({ entityType, event })));
    perTypeCounts[entityType] = pageResult.events.length;
    requestUrls.push(...pageResult.requestUrls);
  }

  let invalidEventContract = 0;
  let missingCoordinateReference = 0;
  const outages = [];
  for (const { entityType, event } of rawEvents) {
    if (!validIodaEventContract(event, entityType)) {
      invalidEventContract += 1;
      continue;
    }
    const outage = normalizeIodaOutageEvent(event, queryWindow, referencePoints);
    if (!outage) {
      missingCoordinateReference += 1;
      continue;
    }
    outages.push(outage);
  }

  return {
    outages,
    meta: {
      ...createIodaUnavailableMeta(queryWindow),
      status: 'ok',
      fetchedEventCount: rawEvents.length,
      countryEventCount: perTypeCounts.country,
      regionEventCount: perTypeCounts.region,
      geolocatedEventCount: outages.length,
      omittedEventCount: invalidEventContract + missingCoordinateReference,
      omittedByReason: {
        invalidEventContract,
        missingCoordinateReference,
      },
      requestUrls,
    },
  };
}

// UCDP versions are immutable once published. The official API documentation currently
// lists 26.0.10 as the latest monthly GED Candidate release; using that explicit version
// avoids a mutable "latest" endpoint while providing the recent operational month that
// overlaps the UCDP-derived Map of Wars lattice. Candidate review status is preserved on
// every event rather than presenting these rows as final annual GED coding.
const UCDP_GED_VERSION = '26.0.10';
const UCDP_DATASET_RELEASE = 'candidate-monthly';
const UCDP_API_URL = `https://ucdpapi.pcr.uu.se/api/gedevents/${UCDP_GED_VERSION}`;
const UCDP_CODEBOOK_URL = 'https://ucdp.uu.se/downloads/candidateged/ucdp-candidate-codebook1.5.pdf';
const UCDP_PAGE_SIZE = 1000;
// The documented quota is 5,000 requests/day. Even the hard 8-page safety cap is at most
// 384 requests/day in a twice-hourly workflow; the current candidate release uses 3 pages.
const UCDP_MAX_PAGES = 8;
const UCDP_MAX_NORMALIZED_EVENTS = 1200;
const UCDP_LIMITATIONS = 'UCDP Candidate events are preliminary monthly rows: not all candidate events necessarily enter the final annual UCDP GED, and events can be revised or reclassified in later releases. The fixed API version itself is immutable. Fatality low/best/high values are source-estimate intervals, date and location precision codes describe uncertainty, the map timestamp uses date_end while the full date range is retained, and a point for a low-precision event can represent a district, province, country, linear feature, or other approximation rather than the exact incident site.';
const UCDP_SELECTION_DESCRIPTION = `Fixed immutable UCDP GED Candidate monthly release ${UCDP_GED_VERSION}; the complete release is fetched within a hard page cap, canonical event IDs are deduplicated, then at most ${UCDP_MAX_NORMALIZED_EVENTS} records are retained by local high-value score: log1p(best)*120 + log1p(high)*25 + (8-where_prec)*4 + (6-date_prec)*3 + 10 for event_clarity 1 + 8 for code_status Clear + up to 25 for recency within 45 days of the release's newest date_end.`;
const UCDP_TYPE_OF_VIOLENCE_LABELS = {
  1: 'state-based conflict',
  2: 'non-state conflict',
  3: 'one-sided violence',
};
const UCDP_WHERE_PRECISION_LABELS = {
  1: 'exact location known',
  2: 'within 25 km of a known point',
  3: 'second-order administrative division representation',
  4: 'first-order administrative division representation',
  5: 'linear feature or fuzzy-area representation',
  6: 'country-only representation',
  7: 'international waters or airspace',
};
const UCDP_DATE_PRECISION_LABELS = {
  1: 'exact date known',
  2: '2-6 day range',
  3: 'week range',
  4: '8-30 day or month range',
  5: 'range longer than one month and up to one year',
};

function createUcdpOmissionCounts() {
  return {
    missingCanonicalId: 0,
    invalidCoordinates: 0,
    invalidTime: 0,
    invalidFatalityContract: 0,
    invalidPrecisionContract: 0,
    duplicateCanonicalId: 0,
    highValueCap: 0,
    mergeCap: 0,
  };
}

function createUcdpMeta(status = 'unconfigured') {
  return {
    status,
    provider: 'Uppsala Conflict Data Program (UCDP), Uppsala University',
    resource: 'gedevents',
    version: UCDP_GED_VERSION,
    datasetRelease: UCDP_DATASET_RELEASE,
    apiEndpoint: UCDP_API_URL,
    codebook: UCDP_CODEBOOK_URL,
    authentication: 'build-time x-ucdp-access-token header; token is never written to the browser artifact',
    releaseSelection: 'newest fixed monthly GED Candidate version listed in the official UCDP API documentation at implementation time',
    pageSize: UCDP_PAGE_SIZE,
    maxPages: UCDP_MAX_PAGES,
    maxNormalizedEvents: UCDP_MAX_NORMALIZED_EVENTS,
    totalCount: null,
    totalPages: null,
    pagesFetched: 0,
    fetchedEventCount: 0,
    uniqueCanonicalEventCount: 0,
    validEventCount: 0,
    ingestedEventCount: 0,
    mergedEventCount: 0,
    preservedPriorEventCount: 0,
    omittedEventCount: 0,
    omittedByReason: createUcdpOmissionCounts(),
    requestUrls: [],
    selection: UCDP_SELECTION_DESCRIPTION,
    caveat: UCDP_LIMITATIONS,
  };
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function nonNegativeIntegerOrNull(value) {
  const number = integerOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function booleanOrNull(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true' || value === '1') return true;
    if (value.toLowerCase() === 'false' || value === '0') return false;
  }
  return null;
}

function identifierTextOrNull(value) {
  const text = textOrNull(value);
  if (text) return text;
  const number = numberOrNull(value);
  return number !== null ? String(number) : null;
}

function parseUcdpDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epochMs = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(epochMs);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null;
  return { iso: `${match[1]}-${match[2]}-${match[3]}`, epochMs };
}

function canonicalUcdpKeyFromId(id) {
  return Number.isInteger(id) && id > 0 ? `ucdp:${id}` : null;
}

function canonicalMapOfWarsKey(event) {
  const nestedId = integerOrNull(event?.ucdp?.id);
  const nestedKey = canonicalUcdpKeyFromId(nestedId);
  if (nestedKey) return nestedKey;
  const id = typeof event?.id === 'string' || typeof event?.id === 'number' ? String(event.id) : '';
  const ucdpMatch = id.match(/^ucdp:(\d+)$/);
  if (ucdpMatch) return `ucdp:${Number(ucdpMatch[1])}`;
  return id || null;
}

function mergeMapOfWarsEventRecords(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const event of group ?? []) {
      const key = canonicalMapOfWarsKey(event);
      if (!key) continue;
      merged.set(key, event);
    }
  }
  return [...merged.values()];
}

function validCoordinatePair(lat, lon) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

function normalizeUcdpGedEvent(rawEvent) {
  const id = integerOrNull(rawEvent?.id);
  if (!id || id <= 0) return { reason: 'missingCanonicalId' };

  const lat = numberOrNull(rawEvent.latitude);
  const lon = numberOrNull(rawEvent.longitude);
  if (!validCoordinatePair(lat, lon)) return { reason: 'invalidCoordinates' };

  const start = parseUcdpDate(rawEvent.date_start);
  const end = parseUcdpDate(rawEvent.date_end);
  if (!start || !end || start.epochMs > end.epochMs) return { reason: 'invalidTime' };

  const deathsA = nonNegativeIntegerOrNull(rawEvent.deaths_a);
  const deathsB = nonNegativeIntegerOrNull(rawEvent.deaths_b);
  const deathsCivilians = nonNegativeIntegerOrNull(rawEvent.deaths_civilians);
  const deathsUnknown = nonNegativeIntegerOrNull(rawEvent.deaths_unknown);
  const low = nonNegativeIntegerOrNull(rawEvent.low);
  const best = nonNegativeIntegerOrNull(rawEvent.best);
  const high = nonNegativeIntegerOrNull(rawEvent.high);
  if ([deathsA, deathsB, deathsCivilians, deathsUnknown, low, best, high].some((value) => value === null)) return { reason: 'invalidFatalityContract' };
  if (deathsA + deathsB + deathsCivilians + deathsUnknown !== best) return { reason: 'invalidFatalityContract' };
  if (Math.max(low, best, high) < 1) return { reason: 'invalidFatalityContract' };

  const typeOfViolence = integerOrNull(rawEvent.type_of_violence);
  const wherePrecision = integerOrNull(rawEvent.where_prec);
  const datePrecision = integerOrNull(rawEvent.date_prec);
  if (!UCDP_TYPE_OF_VIOLENCE_LABELS[typeOfViolence] || !UCDP_WHERE_PRECISION_LABELS[wherePrecision] || !UCDP_DATE_PRECISION_LABELS[datePrecision]) return { reason: 'invalidPrecisionContract' };

  const conflictId = integerOrNull(rawEvent.conflict_new_id);
  const dyadId = integerOrNull(rawEvent.dyad_new_id);
  const sideAId = integerOrNull(rawEvent.side_a_new_id);
  const sideBId = integerOrNull(rawEvent.side_b_new_id);
  const conflictName = textOrNull(rawEvent.conflict_name);
  const dyadName = textOrNull(rawEvent.dyad_name);
  const sideA = textOrNull(rawEvent.side_a);
  const sideB = textOrNull(rawEvent.side_b);
  const actorsText = dyadName || [sideA, sideB].filter(Boolean).join(' - ') || 'Unknown actors';
  const country = textOrNull(rawEvent.country);
  const locationName = textOrNull(rawEvent.where_coordinates) || textOrNull(rawEvent.where_description) || textOrNull(rawEvent.adm_2) || textOrNull(rawEvent.adm_1) || country || 'unknown location';
  const violenceLabel = UCDP_TYPE_OF_VIOLENCE_LABELS[typeOfViolence];
  const effectiveFatalities = Math.max(best, high > 0 ? 1 : 0);
  const event = {
    id: `ucdp:${id}`,
    kind: 'battle',
    lat,
    lon,
    title: country && !locationName.includes(country) ? `${locationName}, ${country}` : locationName,
    detail: `†${best} best (low ${low} / high ${high}) · ${actorsText} · ${violenceLabel}`,
    level: effectiveFatalities >= 100 ? 5 : effectiveFatalities >= 25 ? 4 : effectiveFatalities >= 5 ? 3 : effectiveFatalities >= 1 ? 2 : 1,
    ts: Math.floor(end.epochMs / 1000),
    source: 'UCDP',
    url: conflictId ? `https://ucdp.uu.se/conflict/${conflictId}` : 'https://ucdp.uu.se/apidocs/',
    ucdp: {
      id,
      relid: textOrNull(rawEvent.relid),
      year: integerOrNull(rawEvent.year),
      active_year: booleanOrNull(rawEvent.active_year),
      code_status: textOrNull(rawEvent.code_status),
      type_of_violence: typeOfViolence,
      conflict_new_id: conflictId,
      conflict_name: conflictName,
      dyad_new_id: dyadId,
      dyad_name: dyadName,
      side_a_new_id: sideAId,
      side_a: sideA,
      side_b_new_id: sideBId,
      side_b: sideB,
      number_of_sources: integerOrNull(rawEvent.number_of_sources),
      source_article: textOrNull(rawEvent.source_article),
      source_office: textOrNull(rawEvent.source_office),
      source_date: textOrNull(rawEvent.source_date),
      source_headline: textOrNull(rawEvent.source_headline),
      source_original: textOrNull(rawEvent.source_original),
      where_prec: wherePrecision,
      where_coordinates: textOrNull(rawEvent.where_coordinates),
      where_description: textOrNull(rawEvent.where_description),
      adm_1: textOrNull(rawEvent.adm_1),
      adm_2: textOrNull(rawEvent.adm_2),
      priogrid_gid: integerOrNull(rawEvent.priogrid_gid),
      country,
      country_id: integerOrNull(rawEvent.country_id),
      region: textOrNull(rawEvent.region),
      event_clarity: integerOrNull(rawEvent.event_clarity),
      date_prec: datePrecision,
      date_start: start.iso,
      date_end: end.iso,
      deaths_a: deathsA,
      deaths_b: deathsB,
      deaths_civilians: deathsCivilians,
      deaths_unknown: deathsUnknown,
      low,
      best,
      high,
      gwnoa: identifierTextOrNull(rawEvent.gwnoa),
      gwnob: identifierTextOrNull(rawEvent.gwnob),
      dataset_version: UCDP_GED_VERSION,
      dataset_release: UCDP_DATASET_RELEASE,
    },
  };
  return { event, endEpochMs: end.epochMs };
}

function buildUcdpInitialUrl() {
  const url = new URL(UCDP_API_URL);
  url.searchParams.set('pagesize', String(UCDP_PAGE_SIZE));
  return url;
}

function readUcdpNextPageUrl(value, page) {
  try {
    const url = new URL(value);
    const expected = new URL(UCDP_API_URL);
    if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname) throw new Error('unexpected next-page target');
    return url;
  } catch {
    throw new Error(`UCDP page ${page}: invalid or untrusted NextPageUrl`);
  }
}

function readUcdpPaginationInteger(payload, key, page) {
  const value = integerOrNull(payload?.[key]);
  if (value === null || value < 0) throw new Error(`UCDP page ${page}: missing or invalid ${key}`);
  return value;
}

function ucdpSelectionScore(normalized, newestEndEpochMs) {
  const ucdp = normalized.event.ucdp;
  const fatalityScore = Math.log1p(ucdp.best) * 120 + Math.log1p(ucdp.high) * 25;
  const spatialScore = (8 - ucdp.where_prec) * 4;
  const temporalScore = (6 - ucdp.date_prec) * 3;
  const clarityScore = ucdp.event_clarity === 1 ? 10 : 0;
  const statusScore = ucdp.code_status?.toLowerCase() === 'clear' ? 8 : 0;
  const ageDays = Math.max(0, (newestEndEpochMs - normalized.endEpochMs) / 86400000);
  const recencyScore = Math.max(0, 1 - ageDays / 45) * 25;
  return fatalityScore + spatialScore + temporalScore + clarityScore + statusScore + recencyScore;
}

async function collectUcdpGedEvents(token) {
  // UCDP explicitly warns that API result ordering is meaningless. This bounded monthly
  // release is therefore fetched completely before local canonical dedupe/ranking.
  const rawEvents = [];
  const requestUrls = [];
  let totalCount = null;
  let totalPages = null;
  let pagesFetched = 0;

  let url = buildUcdpInitialUrl();
  for (let page = 1; page <= UCDP_MAX_PAGES; page += 1) {
    requestUrls.push(url.toString());
    const payload = await getJson(url, 32000, {
      Accept: 'application/json',
      'x-ucdp-access-token': token,
    });
    if (!payload || !Array.isArray(payload.Result)) throw new Error(`UCDP page ${page}: unexpected response contract`);
    totalCount = readUcdpPaginationInteger(payload, 'TotalCount', page);
    totalPages = readUcdpPaginationInteger(payload, 'TotalPages', page);
    if (totalPages > UCDP_MAX_PAGES) throw new Error(`UCDP release has ${totalPages} pages, exceeding bounded safety cap of ${UCDP_MAX_PAGES}`);
    rawEvents.push(...payload.Result);
    pagesFetched = page;
    if (page >= totalPages || payload.Result.length === 0) break;
    if (!textOrNull(payload.NextPageUrl)) throw new Error(`UCDP page ${page}: missing NextPageUrl before final page`);
    url = readUcdpNextPageUrl(payload.NextPageUrl, page);
  }

  if (totalCount !== rawEvents.length) throw new Error(`UCDP pagination incomplete: expected ${totalCount} rows, received ${rawEvents.length}`);

  const omittedByReason = createUcdpOmissionCounts();
  const byCanonicalId = new Map();
  for (const rawEvent of rawEvents) {
    const id = integerOrNull(rawEvent?.id);
    const key = canonicalUcdpKeyFromId(id);
    if (!key) {
      omittedByReason.missingCanonicalId += 1;
      continue;
    }
    if (byCanonicalId.has(key)) {
      omittedByReason.duplicateCanonicalId += 1;
      continue;
    }
    byCanonicalId.set(key, rawEvent);
  }

  const normalizedEvents = [];
  for (const rawEvent of byCanonicalId.values()) {
    const normalized = normalizeUcdpGedEvent(rawEvent);
    if (!normalized.event) {
      omittedByReason[normalized.reason] = (omittedByReason[normalized.reason] ?? 0) + 1;
      continue;
    }
    normalizedEvents.push(normalized);
  }

  const newestEndEpochMs = Math.max(0, ...normalizedEvents.map((item) => item.endEpochMs));
  const ranked = normalizedEvents
    .map((item) => ({ ...item, score: ucdpSelectionScore(item, newestEndEpochMs) }))
    .sort((a, b) => b.score - a.score || b.endEpochMs - a.endEpochMs || a.event.ucdp.id - b.event.ucdp.id);
  const selected = ranked.slice(0, UCDP_MAX_NORMALIZED_EVENTS).map((item) => item.event);
  omittedByReason.highValueCap = Math.max(0, ranked.length - selected.length);
  const omittedEventCount = Object.values(omittedByReason).reduce((sum, value) => sum + value, 0);

  return {
    events: selected,
    meta: {
      ...createUcdpMeta('ok'),
      totalCount,
      totalPages,
      pagesFetched,
      fetchedEventCount: rawEvents.length,
      uniqueCanonicalEventCount: byCanonicalId.size,
      validEventCount: normalizedEvents.length,
      ingestedEventCount: selected.length,
      omittedEventCount,
      omittedByReason,
      requestUrls,
    },
  };
}

function isOfficialUcdpRecord(event) {
  return event?.source === 'UCDP' && Number.isInteger(event?.ucdp?.id) && event.ucdp.id > 0;
}

const currentUcdpIngestionKeys = new Set();

function preservePriorUcdpRecords(result, previousSnapshot) {
  const prior = Array.isArray(previousSnapshot.mapOfWarsEvents)
    ? previousSnapshot.mapOfWarsEvents.filter(isOfficialUcdpRecord)
    : [];
  if (prior.length === 0) return 0;
  result.mapOfWarsEvents = mergeMapOfWarsEventRecords(result.mapOfWarsEvents, prior);
  return prior.length;
}

let previousSnapshot = {};
try { if (existsSync(outFile)) previousSnapshot = JSON.parse(readFileSync(outFile, 'utf8')); } catch {}

const iodaQueryWindow = createIodaQueryWindow();
const result = { fetchedAt: new Date().toISOString(), sources: {}, militaryAircraft: [], aircraft: [], vessels: [], satellites: [], news: [], launches: [], naturalEvents: [], gpsInterference: [], mapOfWarsEvents: [], webcams: [], cyberVulnerabilities: [], internetOutages: [], internetOutageMeta: createIodaUnavailableMeta(iodaQueryWindow), ucdpMeta: createUcdpMeta('unconfigured'), errors: [] };

try {
  const ioda = await collectIodaOutages(iodaQueryWindow);
  result.internetOutages = ioda.outages;
  result.internetOutageMeta = ioda.meta;
  result.sources.internetOutages = `IODA v2 outage events (country/region, explicit Unix-second window ${iodaQueryWindow.from}-${iodaQueryWindow.until}) + Natural Earth reference coordinates`;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`IODA: ${message}`);
  if (previousSnapshot.internetOutageMeta && Array.isArray(previousSnapshot.internetOutages)) {
    result.internetOutages = previousSnapshot.internetOutages;
    result.internetOutageMeta = {
      ...previousSnapshot.internetOutageMeta,
      status: 'preserved',
      preservedAt: result.fetchedAt,
      statusDetail: `Transient IODA/ingestion failure; prior snapshot retained. ${message}`,
    };
    result.sources.internetOutages = 'IODA v2 outage events (prior build-time snapshot preserved after transient ingestion failure)';
    result.errors.push('internetOutages: transient failure; preserved previous snapshot');
  } else {
    result.internetOutageMeta = {
      ...createIodaUnavailableMeta(iodaQueryWindow),
      statusDetail: message,
    };
    result.sources.internetOutages = 'IODA v2 outage events unavailable during build';
  }
}

try {
  const payload = await getJson('https://api.adsb.lol/v2/mil');
  result.militaryAircraft = (payload.ac ?? [])
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .slice(0, 420)
    .map((a) => ({
      id: a.hex || `${a.lat}-${a.lon}`,
      callsign: (a.flight || 'MILITARY').trim(),
      registration: a.r || null,
      aircraftType: a.t || null,
      lat: a.lat,
      lng: a.lon,
      altitude: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      speed: typeof a.gs === 'number' ? a.gs : null,
      track: typeof a.track === 'number' ? a.track : null,
      squawk: a.squawk || null,
    }));
  result.sources.militaryAircraft = 'adsb.lol /v2/mil';
} catch (error) { result.errors.push(`adsb.lol: ${error.message}`); }


function shipTypeLabel(type) {
  if (type >= 70 && type < 80) return 'Cargo';
  if (type >= 80 && type < 90) return 'Tanker';
  if (type >= 60 && type < 70) return 'Passenger';
  if (type === 35) return 'Military / government';
  if (type === 55) return 'Law enforcement';
  if (type === 51) return 'Search and rescue';
  if (type === 52 || type === 31 || type === 32) return 'Tug / towing';
  if (type === 30) return 'Fishing';
  if (type >= 40 && type < 50) return 'High-speed craft';
  return type ? `AIS type ${type}` : 'Unspecified vessel';
}

function navigationStatusLabel(status) {
  return {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted maneuverability',
    4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
    11: 'Power-driven vessel towing astern', 12: 'Power-driven vessel pushing ahead', 14: 'AIS-SART active', 15: 'Undefined',
  }[status] || 'Unknown status';
}

function inferAircraftOperatorClass(callsign) {
  const prefix = (callsign || '').trim().slice(0, 3).toUpperCase();
  if (['FDX', 'UPS', 'CLX', 'GTI', 'CKS', 'ABX', 'ATN', 'BCS', 'DHK', 'GEC', 'CKK', 'CAO', 'RUN', 'NCA', 'ANA'].includes(prefix)) return 'cargo-inferred';
  if (/^(RCH|REACH|CFC|RRR|ASY|AFD|BAF|GAF|IAM|MMF|NATO|UAF|PLF|SVF|TUAF)/.test((callsign || '').trim().toUpperCase())) return 'military/government-inferred';
  return 'civil/commercial';
}

try {
  const payload = await getJson('https://opensky-network.org/api/states/all', 32000);
  const militaryHexes = new Set(result.militaryAircraft.map((aircraft) => String(aircraft.id).toLowerCase()));
  result.aircraft = (payload.states ?? [])
    .filter((state) => state[5] != null && state[6] != null && state[8] !== true)
    .filter((state) => !militaryHexes.has(String(state[0]).toLowerCase()))
    .sort((a, b) => (Number(b[7]) || 0) - (Number(a[7]) || 0))
    .slice(0, 1200)
    .map((state) => {
      const callsign = (state[1] || 'UNKNOWN').trim() || 'UNKNOWN';
      return {
        id: String(state[0]),
        callsign,
        originCountry: state[2] || null,
        lat: state[6],
        lng: state[5],
        altitude: typeof state[7] === 'number' ? Math.round(state[7] * 3.28084) : null,
        speed: typeof state[9] === 'number' ? Math.round(state[9] * 1.94384) : null,
        track: typeof state[10] === 'number' ? state[10] : null,
        verticalRate: typeof state[11] === 'number' ? Math.round(state[11] * 196.85) : null,
        squawk: state[14] || null,
        operatorClass: inferAircraftOperatorClass(callsign),
        lastContact: state[4] ? new Date(state[4] * 1000).toISOString() : null,
      };
    });
  result.sources.aircraft = 'OpenSky Network live state vectors (anonymous public snapshot)';
} catch (error) { result.errors.push(`OpenSky: ${error.message}`); }


async function collectAisStreamVessels(apiKey) {
  if (!apiKey || typeof WebSocket !== 'function') return [];
  return new Promise((resolve) => {
    const vessels = new Map();
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const finish = () => {
      try { socket.close(); } catch {}
      resolve([...vessels.values()]);
    };
    const timer = setTimeout(finish, 10000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-75, -180], [75, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    });
    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.MessageType !== 'PositionReport') return;
        const report = payload.Message?.PositionReport ?? {};
        const meta = payload.MetaData ?? {};
        const mmsi = report.UserID || meta.MMSI;
        const lat = report.Latitude ?? meta.Latitude;
        const lng = report.Longitude ?? meta.Longitude;
        if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        vessels.set(String(mmsi), {
          id: String(mmsi), mmsi, imo: null,
          name: (meta.ShipName || `MMSI ${mmsi}`).trim(),
          callSign: meta.CallSign || null,
          destination: meta.Destination || null,
          shipType: meta.ShipType || null,
          vesselClass: shipTypeLabel(meta.ShipType),
          navigationStatus: navigationStatusLabel(report.NavigationalStatus),
          lat, lng,
          speed: typeof report.Sog === 'number' ? report.Sog : null,
          course: typeof report.Cog === 'number' ? report.Cog : null,
          heading: typeof report.TrueHeading === 'number' && report.TrueHeading < 360 ? report.TrueHeading : null,
          timestamp: meta.time_utc || null,
          source: 'AISStream global AIS',
        });
      } catch {}
    });
    socket.addEventListener('error', finish);
    socket.addEventListener('close', () => { clearTimeout(timer); resolve([...vessels.values()]); });
  });
}

try {
  const headers = { 'Digitraffic-User': 'GodseyeOSINT public command center/1.0', Accept: 'application/json' };
  const [locations, vessels] = await Promise.all([
    getJson('https://meri.digitraffic.fi/api/ais/v1/locations', 24000, headers),
    getJson('https://meri.digitraffic.fi/api/ais/v1/vessels', 24000, headers),
  ]);
  const metadata = new Map((Array.isArray(vessels) ? vessels : []).map((vessel) => [String(vessel.mmsi), vessel]));
  result.vessels = (locations.features ?? [])
    .map((feature) => {
      const properties = feature.properties ?? {};
      const vessel = metadata.get(String(properties.mmsi)) ?? {};
      const lng = feature.geometry?.coordinates?.[0];
      const lat = feature.geometry?.coordinates?.[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: String(properties.mmsi),
        mmsi: properties.mmsi,
        imo: vessel.imo || null,
        name: vessel.name || `MMSI ${properties.mmsi}`,
        callSign: vessel.callSign || null,
        destination: vessel.destination || null,
        shipType: vessel.shipType || null,
        vesselClass: shipTypeLabel(vessel.shipType),
        navigationStatus: navigationStatusLabel(properties.navStat),
        lat,
        lng,
        speed: typeof properties.sog === 'number' ? properties.sog : null,
        course: typeof properties.cog === 'number' ? properties.cog : null,
        heading: typeof properties.heading === 'number' && properties.heading < 360 ? properties.heading : null,
        timestamp: properties.timestampExternal ? new Date(properties.timestampExternal).toISOString() : null,
        source: 'Fintraffic Digitraffic AIS',
      };
    })
    .filter(Boolean)
    .slice(0, 1100);
  result.sources.vessels = 'Fintraffic Digitraffic AIS (Finnish/Baltic regional coverage)';
} catch (error) { result.errors.push(`Digitraffic AIS: ${error.message}`); }


if (process.env.AISSTREAM_API_KEY) {
  try {
    const streamVessels = await collectAisStreamVessels(process.env.AISSTREAM_API_KEY);
    if (streamVessels.length > 0) {
      const merged = new Map(result.vessels.map((vessel) => [String(vessel.mmsi), vessel]));
      for (const vessel of streamVessels) merged.set(String(vessel.mmsi), vessel);
      result.vessels = [...merged.values()].slice(0, 1600);
      result.sources.vessels = `AISStream global AIS + Fintraffic Digitraffic regional AIS (${streamVessels.length} streamed positions)`;
    }
  } catch (error) { result.errors.push(`AISStream: ${error.message}`); }
} else {
  result.errors.push('AISStream: AISSTREAM_API_KEY not configured; using keyless Digitraffic Baltic coverage only');
}


try {
  const groups = [['military', 36], ['stations', 12], ['gps-ops', 32], ['weather', 20]];
  const satellites = [];
  for (const [group, limit] of groups) {
    try {
      const text = await getText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, 18000);
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (let index = 0; index + 2 < lines.length && satellites.length < 100; index += 1) {
        if (!lines[index + 1]?.startsWith('1 ') || !lines[index + 2]?.startsWith('2 ')) continue;
        const name = lines[index];
        const line1 = lines[index + 1];
        const line2 = lines[index + 2];
        const catalog = line1.slice(2, 7).trim();
        satellites.push({ id: catalog, name, group, catalogNumber: Number(catalog), line1, line2, epoch: line1.slice(18, 32).trim() });
        index += 2;
        if (satellites.filter((item) => item.group === group).length >= limit) break;
      }
    } catch (error) { result.errors.push(`CelesTrak ${group}: ${error.message}`); }
  }
  result.satellites = satellites;
  result.sources.satellites = 'CelesTrak public NORAD TLE groups (military, stations, GPS, weather)';
} catch (error) { result.errors.push(`CelesTrak: ${error.message}`); }

try {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', '(war OR conflict OR airstrike OR missile OR military)');
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', '30');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'hybridrel');
  const payload = await getJson(url);
  result.news = (payload.articles ?? []).filter((a) => a.title && a.url).map((a) => ({
    title: a.title,
    url: a.url,
    source: a.domain || 'GDELT',
    publishedAt: a.seendate || null,
  }));
  result.sources.news = 'GDELT DOC 2.0 artlist';
} catch (error) { result.errors.push(`GDELT: ${error.message}`); }

if (result.news.length === 0) {
  try {
    const xml = await getText('https://news.google.com/rss/search?q=war%20OR%20conflict%20OR%20airstrike%20OR%20missile&hl=en-US&gl=US&ceid=US:en');
    result.news = parseRssItems(xml, 30);
    result.sources.news = 'Google News RSS conflict query';
  } catch (error) { result.errors.push(`Google News RSS: ${error.message}`); }
}

try {
  const payload = await getJson('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=detailed', 26000);
  result.launches = (payload.results ?? []).map((launch) => ({
    id: launch.id,
    name: launch.name,
    provider: launch.launch_service_provider?.name || null,
    location: launch.pad?.location?.name || launch.pad?.name || null,
    lat: launch.pad?.latitude ? Number(launch.pad.latitude) : null,
    lng: launch.pad?.longitude ? Number(launch.pad.longitude) : null,
    net: launch.net || null,
    url: launch.url || null,
  })).filter((launch) => Number.isFinite(launch.lat) && Number.isFinite(launch.lng));
  result.sources.launches = 'Launch Library 2';
} catch (error) { result.errors.push(`Launch Library: ${error.message}`); }


try {
  const [eonet, usgs, gdacs, noaaAlerts] = await Promise.all([
    getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40'),
    getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson'),
    getJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtypes=EQ,TC,FL,VO,DR,WF&alertlevel=Red;Orange&format=json', 18000),
    getJson('https://api.weather.gov/alerts/active?status=actual&message_type=alert', 18000),
  ]);
  const eonetEvents = (eonet.events ?? []).map((event) => {
    const geometry = [...(event.geometry ?? [])].reverse().find((g) => Array.isArray(g.coordinates));
    if (!geometry) return null;
    const coords = geometry.type === 'Polygon' ? geometry.coordinates[0]?.[0] : geometry.coordinates;
    if (!Array.isArray(coords)) return null;
    return {
      id: event.id,
      title: event.title,
      category: event.categories?.[0]?.title || 'Natural event',
      kind: (event.categories?.[0]?.id || 'natural').toLowerCase(),
      lat: coords[1], lng: coords[0],
      occurredAt: geometry.date || null,
      magnitude: geometry.magnitudeValue || null,
      magnitudeUnit: geometry.magnitudeUnit || null,
      url: event.sources?.[0]?.url || event.link || null,
    };
  }).filter(Boolean);
  const earthquakes = (usgs.features ?? []).map((feature) => ({
    id: `usgs-${feature.id}`,
    title: feature.properties?.title || 'Significant earthquake',
    category: 'Earthquake', kind: 'earthquake',
    lat: feature.geometry?.coordinates?.[1], lng: feature.geometry?.coordinates?.[0],
    occurredAt: feature.properties?.time ? new Date(feature.properties.time).toISOString() : null,
    magnitude: feature.properties?.mag || null, magnitudeUnit: 'M',
    url: feature.properties?.url || null,
  })).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng));
  const gdacsTypeNames = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };
  const gdacsEvents = (gdacs.features ?? []).map((feature) => {
    const properties = feature.properties ?? {};
    const type = properties.eventtype || 'event';
    const alertLevel = properties.episodealertlevel || properties.alertlevel || 'Orange';
    if (!['Red', 'Orange'].includes(alertLevel)) return null;
    return {
      id: `gdacs-${properties.eventid}-${properties.episodeid}`,
      title: properties.name || properties.eventname || 'GDACS disaster alert',
      category: `GDACS ${alertLevel} ${gdacsTypeNames[type] || 'disaster'}`,
      kind: String(type).toLowerCase(),
      lat: feature.geometry?.coordinates?.[1],
      lng: feature.geometry?.coordinates?.[0],
      occurredAt: properties.fromdate || properties.datemodified || null,
      magnitude: properties.episodealertscore ?? properties.alertscore ?? null,
      magnitudeUnit: 'alert score',
      url: properties.url?.report || properties.url?.details || null,
    };
  }).filter(Boolean).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).slice(0, 30);
  const weatherAlerts = (noaaAlerts.features ?? []).map((feature) => {
    const properties = feature.properties ?? {};
    const geometry = feature.geometry;
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const first = geometry.type === 'Point' ? geometry.coordinates : geometry.type === 'Polygon' ? geometry.coordinates[0]?.[0] : geometry.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0]?.[0] : null;
    if (!Array.isArray(first)) return null;
    return {
      id: `noaa-${properties.id || properties.event}-${first[0]}`,
      title: `${properties.event || 'Weather alert'} — ${properties.headline || properties.areaDesc || 'United States'}`,
      category: `NOAA ${properties.severity || 'weather'} alert`,
      kind: 'weather',
      lat: first[1], lng: first[0],
      occurredAt: properties.onset || properties.sent || null,
      magnitude: null,
      magnitudeUnit: null,
      url: properties['@id'] || null,
    };
  }).filter(Boolean).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).slice(0, 35);
  const seenNaturalIds = new Set();
  result.naturalEvents = [...earthquakes, ...eonetEvents, ...gdacsEvents, ...weatherAlerts]
    .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))
    .filter((event) => {
      const key = `${event.kind}-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (seenNaturalIds.has(key)) return false;
      seenNaturalIds.add(key);
      return true;
    })
    .slice(0, 90);
  result.sources.naturalEvents = 'NASA EONET + USGS earthquakes + GDACS red/orange alerts + NOAA active weather alerts';
} catch (error) { result.errors.push(`Natural events: ${error.message}`); }



if (process.env.FIRMS_MAP_KEY) {
  try {
    const csv = await getText(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/world/1`, 30000);
    const lines = csv.trim().split(String.fromCharCode(10));
    const fires = lines.slice(1).map((line) => {
      const columns = line.split(',');
      const lat = Number(columns[0]);
      const lng = Number(columns[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const acqDate = columns[5] || '';
      const acqTime = String(columns[6] || '').padStart(4, '0');
      const frp = Number(columns[12]);
      return {
        id: `firms-${lat}-${lng}-${acqDate}-${acqTime}`,
        title: `VIIRS active fire detection${Number.isFinite(frp) ? ` — ${frp.toFixed(1)} MW FRP` : ''}`,
        category: 'NASA FIRMS active fire',
        kind: 'wildfire',
        lat, lng,
        occurredAt: acqDate ? new Date(`${acqDate}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00Z`).toISOString() : null,
        magnitude: Number.isFinite(frp) ? frp : null,
        magnitudeUnit: 'MW FRP',
        url: 'https://firms.modaps.eosdis.nasa.gov/',
      };
    }).filter(Boolean).sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0)).slice(0, 180);
    result.naturalEvents = [...result.naturalEvents, ...fires]
      .filter((event, index, array) => array.findIndex((candidate) => candidate.id === event.id) === index)
      .slice(0, 130);
    result.sources.firms = 'NASA FIRMS VIIRS S-NPP near-real-time active fires';
  } catch (error) { result.errors.push(`NASA FIRMS: ${error.message}`); }
} else {
  result.errors.push('NASA FIRMS: FIRMS_MAP_KEY not configured; active-fire layer unavailable');
}

try {
  const payload = await getJson('https://mapofwars.org/api/events', 24000);
  result.mapOfWarsEvents = (payload.events ?? [])
    .filter((event) => ['battle', 'ship', 'outage', 'activation', 'launch'].includes(event.kind) && Number.isFinite(event.lat) && Number.isFinite(event.lon) && event.id && event.ts)
    .slice(0, 1800)
    .map((event) => ({
      id: event.id, kind: event.kind, lat: event.lat, lon: event.lon, title: event.title,
      detail: event.detail, level: event.level, ts: event.ts, source: event.source,
      note: event.note, url: event.url,
    }));
  result.sources.mapOfWars = 'Map of Wars public event lattice (build-time cache)';
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`Map of Wars: ${message}`);
  if (Array.isArray(previousSnapshot.mapOfWarsEvents) && previousSnapshot.mapOfWarsEvents.length > 0) {
    result.mapOfWarsEvents = mergeMapOfWarsEventRecords(previousSnapshot.mapOfWarsEvents);
    result.sources.mapOfWars = 'Map of Wars public event lattice (prior build-time snapshot preserved after transient ingestion failure)';
    result.errors.push('mapOfWarsEvents: transient failure; preserved previous snapshot');
  }
}


const ucdpApiToken = process.env.UCDP_API_TOKEN?.trim();
if (ucdpApiToken) {
  try {
    const ucdp = await collectUcdpGedEvents(ucdpApiToken);
    currentUcdpIngestionKeys.clear();
    for (const event of ucdp.events) currentUcdpIngestionKeys.add(canonicalMapOfWarsKey(event));
    result.mapOfWarsEvents = mergeMapOfWarsEventRecords(result.mapOfWarsEvents, ucdp.events);
    result.ucdpMeta = {
      ...ucdp.meta,
      mergedEventCount: ucdp.events.length,
    };
    result.sources.ucdp = `UCDP API gedevents/${UCDP_GED_VERSION} authenticated monthly candidate slice (${ucdp.events.length} high-value records from ${ucdp.meta.fetchedEventCount} fetched)`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const preservedPriorEventCount = preservePriorUcdpRecords(result, previousSnapshot);
    result.errors.push(`UCDP: ${message}`);
    result.ucdpMeta = {
      ...createUcdpMeta('degraded'),
      statusDetail: `Authenticated ingestion failed before a complete bounded release could be validated: ${message}`,
      preservedPriorEventCount,
      preservedAt: preservedPriorEventCount > 0 ? result.fetchedAt : undefined,
    };
    result.sources.ucdp = preservedPriorEventCount > 0
      ? `UCDP API gedevents/${UCDP_GED_VERSION} degraded; ${preservedPriorEventCount} prior authenticated records preserved`
      : `UCDP API gedevents/${UCDP_GED_VERSION} unavailable during build`;
    if (preservedPriorEventCount > 0) result.errors.push('UCDP: transient failure; preserved previous authenticated records');
  }
} else {
  const preservedPriorEventCount = preservePriorUcdpRecords(result, previousSnapshot);
  result.ucdpMeta = {
    ...createUcdpMeta('unconfigured'),
    statusDetail: 'UCDP_API_TOKEN is not configured in the build-time environment',
    preservedPriorEventCount,
    preservedAt: preservedPriorEventCount > 0 ? result.fetchedAt : undefined,
  };
  result.sources.ucdp = preservedPriorEventCount > 0
    ? `UCDP API token not configured; ${preservedPriorEventCount} prior authenticated records preserved`
    : 'UCDP API token not configured; official GED enrichment unavailable';
  result.errors.push('UCDP: UCDP_API_TOKEN not configured; authenticated official GED enrichment unavailable');
}

function finalizeMapOfWarsEventCap() {
  result.mapOfWarsEvents = result.mapOfWarsEvents.slice(0, 2800);
  if (result.ucdpMeta.status !== 'ok') return;
  const mergedEventCount = result.mapOfWarsEvents.filter((event) => currentUcdpIngestionKeys.has(canonicalMapOfWarsKey(event))).length;
  const mergeCap = Math.max(0, result.ucdpMeta.ingestedEventCount - mergedEventCount);
  const previousMergeCap = result.ucdpMeta.omittedByReason.mergeCap ?? 0;
  result.ucdpMeta.mergedEventCount = mergedEventCount;
  result.ucdpMeta.omittedByReason.mergeCap = mergeCap;
  result.ucdpMeta.omittedEventCount += mergeCap - previousMergeCap;
}

if (process.env.ACLED_API_KEY && process.env.ACLED_EMAIL) {
  try {
    const url = new URL('https://api.acleddata.com/acled/read');
    url.searchParams.set('key', process.env.ACLED_API_KEY);
    url.searchParams.set('email', process.env.ACLED_EMAIL);
    url.searchParams.set('limit', '1200');
    url.searchParams.set('fields', 'event_id_cnty|event_date|time_precision|event_type|sub_event_type|actor1|actor2|country|admin1|admin2|location|latitude|longitude|geo_precision|source|notes|fatalities');
    url.searchParams.set('sort', 'event_date DESC');
    const payload = await getJson(url, 32000);
    const acledEvents = (payload.data ?? []).map((event) => {
      const lat = Number(event.latitude);
      const lon = Number(event.longitude);
      const occurred = Date.parse(`${event.event_date}T00:00:00Z`);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(occurred)) return null;
      const fatalities = Number(event.fatalities) || 0;
      return {
        id: `acled-${event.event_id_cnty}`,
        kind: 'battle',
        lat, lon,
        title: `${event.event_type || 'Political violence'} — ${event.location || event.admin1 || event.country || 'unknown location'}`,
        detail: `${event.sub_event_type || 'Unspecified subevent'} · ${event.actor1 || 'Unknown actor'}${event.actor2 ? ` vs ${event.actor2}` : ''} · ${fatalities} reported fatalities`,
        level: fatalities >= 50 ? 5 : fatalities >= 10 ? 4 : fatalities >= 1 ? 3 : 2,
        ts: Math.floor(occurred / 1000),
        source: 'ACLED',
        note: event.notes || null,
        url: 'https://acleddata.com/',
      };
    }).filter(Boolean);
    result.mapOfWarsEvents = mergeMapOfWarsEventRecords(result.mapOfWarsEvents, acledEvents);
    result.sources.acled = `ACLED authenticated political violence API (${acledEvents.length} records)`;
  } catch (error) { result.errors.push(`ACLED: ${error.message}`); }
} else {
  result.errors.push('ACLED: ACLED_API_KEY/ACLED_EMAIL not configured; authenticated political-violence enrichment unavailable');
}
finalizeMapOfWarsEventCap();

try {
  const manifest = await getText('https://gpsjam.org/data/manifest.csv', 20000);
  const rows = manifest.trim().split(String.fromCharCode(10));
  const latestDate = rows[rows.length - 1].split(',')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) throw new Error('Unexpected gpsjam manifest');
  const csv = await getText(`https://gpsjam.org/data/${latestDate}-h3_4.csv`, 24000);
  result.gpsInterference = csv.trim().split(String.fromCharCode(10)).slice(1).map((line) => {
    const [hex, goodRaw, badRaw] = line.split(',');
    const good = Number(goodRaw), bad = Number(badRaw), total = good + bad;
    if (!hex || !Number.isFinite(total) || total < 3 || bad <= 0) return null;
    const affectedShare = bad / total;
    if (affectedShare < 0.02) return null;
    return {
      hex, goodAircraft: good, badAircraft: bad, aircraftCount: total, affectedShare,
      level: affectedShare > 0.1 ? 'high' : affectedShare > 0.04 ? 'medium' : 'low',
    };
  }).filter(Boolean).sort((a, b) => b.affectedShare - a.affectedShare).slice(0, 500);
  result.sources.gpsInterference = `gpsjam.org daily H3 interference (${latestDate})`;
} catch (error) { result.errors.push(`gpsjam.org: ${error.message}`); }


try {
  const payload = await getJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', 18000);
  result.cyberVulnerabilities = (payload.vulnerabilities ?? [])
    .slice()
    .sort((a, b) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')))
    .slice(0, 30)
    .map((item) => ({
      cveId: item.cveID,
      vendor: item.vendorProject || null,
      product: item.product || null,
      name: item.vulnerabilityName || 'Known exploited vulnerability',
      dateAdded: item.dateAdded || null,
      dueDate: item.dueDate || null,
      ransomwareUse: item.knownRansomwareCampaignUse || 'Unknown',
      requiredAction: item.requiredAction || null,
    }))
    .filter((item) => item.cveId);
  result.sources.cyberVulnerabilities = 'CISA Known Exploited Vulnerabilities catalog';
} catch (error) { result.errors.push(`CISA KEV: ${error.message}`); }

if (process.env.WINDY_WEBCAMS_KEY) {
  try {
    const regions = [
      [49.0, 32.0], [31.5, 34.8], [15.5, 32.5], [15.0, 43.0], [23.8, 121.0],
      [38.0, 127.5], [56.8, 24.5], [33.5, 44.3], [48.7, 44.5], [36.2, 37.1],
    ];
    const responses = await Promise.allSettled(regions.map(([lat, lng]) => getJson(
      `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lng},250&limit=12&include=categories,location,player,urls`,
      16000,
      { 'x-windy-api-key': process.env.WINDY_WEBCAMS_KEY },
    )));
    const unique = new Map();
    for (const response of responses) {
      if (response.status !== 'fulfilled') continue;
      for (const webcam of response.value.webcams ?? []) {
        const lat = webcam.location?.latitude, lng = webcam.location?.longitude;
        if (!webcam.webcamId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        unique.set(String(webcam.webcamId), {
          id: String(webcam.webcamId), title: webcam.title || 'Public webcam', lat, lng,
          city: webcam.location?.city || null, region: webcam.location?.region || null,
          country: webcam.location?.country || null, status: webcam.status || null,
          categories: (webcam.categories ?? []).map((category) => category.name).filter(Boolean).slice(0, 3),
          detailUrl: webcam.urls?.detail || null, playerUrl: webcam.player?.day || webcam.player?.lifetime || null,
        });
      }
    }
    result.webcams = [...unique.values()].slice(0, 160);
    result.sources.webcams = 'Windy Webcams API v3 metadata (configure WINDY_WEBCAMS_KEY)';
  } catch (error) { result.errors.push(`Windy Webcams: ${error.message}`); }
}


function validateCoordinate(item, label, errors) {
  if (!Number.isFinite(item.lat) || item.lat < -90 || item.lat > 90 || !Number.isFinite(item.lng) || item.lng < -180 || item.lng > 180) {
    errors.push(`${label}:${item.id || item.name || item.title || item.entityName || 'unknown'} invalid coordinate`);
  }
}

function validateNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateIsoDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateNullableString(value) {
  return value === null || typeof value === 'string';
}

function validateUcdpOfficialRecord(item, label, errors) {
  const ucdp = item.ucdp;
  if (!ucdp || typeof ucdp !== 'object') {
    errors.push(`${label} missing official UCDP provenance object`);
    return;
  }
  if (!Number.isInteger(ucdp.id) || ucdp.id <= 0 || item.id !== `ucdp:${ucdp.id}`) errors.push(`${label} canonical UCDP id mismatch`);
  if (typeof ucdp.relid !== 'string' || ucdp.relid.length === 0) errors.push(`${label} missing UCDP relid`);
  if (!Number.isInteger(ucdp.year) || ucdp.year < 1989) errors.push(`${label} invalid UCDP year`);
  if (typeof ucdp.active_year !== 'boolean') errors.push(`${label} invalid active_year`);
  if (typeof ucdp.code_status !== 'string' || ucdp.code_status.length === 0) errors.push(`${label} missing candidate code_status`);
  if (!UCDP_TYPE_OF_VIOLENCE_LABELS[ucdp.type_of_violence]) errors.push(`${label} invalid type_of_violence`);
  for (const key of ['conflict_new_id', 'dyad_new_id', 'side_a_new_id', 'side_b_new_id', 'country_id', 'priogrid_gid']) {
    if (!Number.isInteger(ucdp[key]) || ucdp[key] <= 0) errors.push(`${label} invalid ${key}`);
  }
  for (const key of ['conflict_name', 'dyad_name', 'side_a', 'side_b', 'where_coordinates', 'country', 'region']) {
    if (typeof ucdp[key] !== 'string' || ucdp[key].length === 0) errors.push(`${label} missing ${key}`);
  }
  if (!validateNullableString(ucdp.adm_1) || !validateNullableString(ucdp.adm_2) || !validateNullableString(ucdp.where_description)) errors.push(`${label} invalid location text fields`);
  if (!UCDP_WHERE_PRECISION_LABELS[ucdp.where_prec]) errors.push(`${label} invalid where_prec`);
  if (!UCDP_DATE_PRECISION_LABELS[ucdp.date_prec]) errors.push(`${label} invalid date_prec`);
  if (![1, 2].includes(ucdp.event_clarity)) errors.push(`${label} invalid event_clarity`);
  if (!validateIsoDateOnly(ucdp.date_start) || !validateIsoDateOnly(ucdp.date_end) || Date.parse(`${ucdp.date_start}T00:00:00Z`) > Date.parse(`${ucdp.date_end}T00:00:00Z`)) errors.push(`${label} invalid date_start/date_end`);
  for (const key of ['deaths_a', 'deaths_b', 'deaths_civilians', 'deaths_unknown', 'low', 'best', 'high']) {
    if (!validateNonNegativeInteger(ucdp[key])) errors.push(`${label} invalid fatality field ${key}`);
  }
  if (validateNonNegativeInteger(ucdp.deaths_a) && validateNonNegativeInteger(ucdp.deaths_b) && validateNonNegativeInteger(ucdp.deaths_civilians) && validateNonNegativeInteger(ucdp.deaths_unknown) && validateNonNegativeInteger(ucdp.best) && ucdp.deaths_a + ucdp.deaths_b + ucdp.deaths_civilians + ucdp.deaths_unknown !== ucdp.best) errors.push(`${label} fatality components do not sum to best`);
  if (validateNonNegativeInteger(ucdp.low) && validateNonNegativeInteger(ucdp.best) && validateNonNegativeInteger(ucdp.high) && Math.max(ucdp.low, ucdp.best, ucdp.high) < 1) errors.push(`${label} violates UCDP minimum one-fatality event definition`);
  if (!Number.isInteger(ucdp.number_of_sources) || ucdp.number_of_sources < -1) errors.push(`${label} invalid number_of_sources`);
  if (typeof ucdp.source_article !== 'string' || ucdp.source_article.length === 0) errors.push(`${label} missing UCDP source_article provenance`);
  for (const key of ['source_office', 'source_date', 'source_headline', 'source_original', 'gwnoa', 'gwnob']) {
    if (!validateNullableString(ucdp[key])) errors.push(`${label} invalid ${key}`);
  }
  if (ucdp.dataset_version !== UCDP_GED_VERSION || ucdp.dataset_release !== UCDP_DATASET_RELEASE) errors.push(`${label} invalid dataset version provenance`);
}

function validateUcdpMeta(snapshot, errors) {
  const meta = snapshot.ucdpMeta;
  if (!meta || typeof meta !== 'object') {
    errors.push('ucdpMeta missing or not an object');
    return;
  }
  if (!['ok', 'unconfigured', 'degraded'].includes(meta.status)) errors.push('ucdpMeta invalid status');
  if (meta.resource !== 'gedevents' || meta.version !== UCDP_GED_VERSION || meta.datasetRelease !== UCDP_DATASET_RELEASE) errors.push('ucdpMeta invalid endpoint/version provenance');
  if (meta.apiEndpoint !== UCDP_API_URL) errors.push('ucdpMeta invalid API endpoint');
  if (meta.codebook !== UCDP_CODEBOOK_URL) errors.push('ucdpMeta invalid codebook provenance');
  if (!String(meta.authentication || '').includes('x-ucdp-access-token') || !String(meta.authentication || '').includes('never written')) errors.push('ucdpMeta missing honest authentication provenance');
  for (const key of ['pageSize', 'maxPages', 'maxNormalizedEvents', 'pagesFetched', 'fetchedEventCount', 'uniqueCanonicalEventCount', 'validEventCount', 'ingestedEventCount', 'mergedEventCount', 'preservedPriorEventCount', 'omittedEventCount']) {
    if (!validateNonNegativeInteger(meta[key])) errors.push(`ucdpMeta invalid ${key}`);
  }
  if (meta.totalCount !== null && !validateNonNegativeInteger(meta.totalCount)) errors.push('ucdpMeta invalid totalCount');
  if (meta.totalPages !== null && !validateNonNegativeInteger(meta.totalPages)) errors.push('ucdpMeta invalid totalPages');
  const reasons = meta.omittedByReason;
  if (!reasons || typeof reasons !== 'object') {
    errors.push('ucdpMeta omission reasons missing');
  } else {
    for (const key of ['missingCanonicalId', 'invalidCoordinates', 'invalidTime', 'invalidFatalityContract', 'invalidPrecisionContract', 'duplicateCanonicalId', 'highValueCap', 'mergeCap']) {
      if (!validateNonNegativeInteger(reasons[key])) errors.push(`ucdpMeta invalid omission reason ${key}`);
    }
    if (Object.values(reasons).every(validateNonNegativeInteger) && meta.omittedEventCount !== Object.values(reasons).reduce((sum, value) => sum + value, 0)) errors.push('ucdpMeta omittedEventCount does not equal omission reasons');
    if (meta.status === 'ok' && Object.values(reasons).every(validateNonNegativeInteger)) {
      if (meta.fetchedEventCount !== meta.uniqueCanonicalEventCount + reasons.missingCanonicalId + reasons.duplicateCanonicalId) errors.push('ucdpMeta canonical dedupe count mismatch');
      const invalidCount = reasons.invalidCoordinates + reasons.invalidTime + reasons.invalidFatalityContract + reasons.invalidPrecisionContract;
      if (meta.uniqueCanonicalEventCount !== meta.validEventCount + invalidCount) errors.push('ucdpMeta normalization count mismatch');
      if (meta.validEventCount !== meta.ingestedEventCount + reasons.highValueCap) errors.push('ucdpMeta high-value selection count mismatch');
      if (meta.ingestedEventCount !== meta.mergedEventCount + reasons.mergeCap) errors.push('ucdpMeta merge count mismatch');
    }
  }
  if (!Array.isArray(meta.requestUrls)) {
    errors.push('ucdpMeta requestUrls missing or not an array');
  } else if (meta.status === 'ok') {
    if (meta.requestUrls.length !== meta.pagesFetched || meta.requestUrls.length === 0) errors.push('ucdpMeta requestUrls/page count mismatch');
    meta.requestUrls.forEach((url, index) => {
      if (!url.startsWith(`${UCDP_API_URL}?`) || !url.includes(`pagesize=${UCDP_PAGE_SIZE}`)) errors.push(`ucdpMeta request URL ${index + 1} lacks versioned paging provenance`);
    });
    if (meta.totalCount !== meta.fetchedEventCount) errors.push('ucdpMeta totalCount/fetched count mismatch');
    if (meta.totalPages !== meta.pagesFetched) errors.push('ucdpMeta totalPages/pagesFetched mismatch');
  }
  const actualMerged = (snapshot.mapOfWarsEvents ?? []).filter((event) => currentUcdpIngestionKeys.has(canonicalMapOfWarsKey(event))).length;
  if (meta.status === 'ok' && actualMerged !== meta.mergedEventCount) errors.push('ucdpMeta mergedEventCount does not match snapshot records');
  if (!String(meta.selection || '').includes('high-value') || !String(meta.caveat || '').includes('preliminary')) errors.push('ucdpMeta missing selection or candidate caveat');
  const configuredUcdpToken = process.env.UCDP_API_TOKEN?.trim();
  if (configuredUcdpToken && JSON.stringify(snapshot).includes(configuredUcdpToken)) errors.push('UCDP token leaked into snapshot');
}

function validateSnapshot(snapshot) {
  const errors = [];
  for (const key of ['militaryAircraft', 'aircraft', 'vessels', 'satellites', 'news', 'launches', 'naturalEvents', 'gpsInterference', 'mapOfWarsEvents', 'cyberVulnerabilities', 'internetOutages']) {
    if (!Array.isArray(snapshot[key])) errors.push(`${key} missing or not an array`);
  }
  for (const item of snapshot.militaryAircraft ?? []) validateCoordinate(item, 'militaryAircraft', errors);
  for (const item of snapshot.aircraft ?? []) validateCoordinate(item, 'aircraft', errors);
  for (const item of snapshot.vessels ?? []) validateCoordinate(item, 'vessels', errors);
  for (const item of snapshot.launches ?? []) validateCoordinate(item, 'launches', errors);
  for (const item of snapshot.naturalEvents ?? []) validateCoordinate(item, 'naturalEvents', errors);
  for (const item of snapshot.internetOutages ?? []) validateCoordinate(item, 'internetOutages', errors);
  const canonicalMapOfWarsKeys = new Set();
  for (const item of snapshot.mapOfWarsEvents ?? []) {
    const label = `mapOfWarsEvents:${item.id || 'unknown'}`;
    if (typeof item.id !== 'string' || item.id.length === 0) errors.push(`${label} missing id`);
    if (!['battle', 'ship', 'outage', 'activation', 'launch'].includes(item.kind)) errors.push(`${label} invalid kind`);
    if (!validCoordinatePair(item.lat, item.lon)) errors.push(`${label} invalid coordinate`);
    if (!Number.isFinite(item.ts) || item.ts <= 0) errors.push(`${label} invalid timestamp`);
    if (typeof item.title !== 'string' || item.title.length === 0) errors.push(`${label} missing title`);
    if (typeof item.source !== 'string' || item.source.length === 0) errors.push(`${label} missing source`);
    const canonicalKey = canonicalMapOfWarsKey(item);
    if (canonicalKey) {
      if (canonicalMapOfWarsKeys.has(canonicalKey)) errors.push(`${label} duplicate canonical key ${canonicalKey}`);
      canonicalMapOfWarsKeys.add(canonicalKey);
    }
    if (item.ucdp !== undefined) validateUcdpOfficialRecord(item, label, errors);
  }
  validateUcdpMeta(snapshot, errors);
  for (const item of snapshot.internetOutages ?? []) {
    const label = `internetOutages:${item.entityType || 'unknown'}:${item.entityCode || 'unknown'}`;
    if (!['country', 'region'].includes(item.entityType)) errors.push(`${label} invalid entityType`);
    if (!item.entityCode || !item.entityName) errors.push(`${label} missing entity identity`);
    if (!['country-reference', 'region-reference'].includes(item.coordinatePrecision)) errors.push(`${label} invalid coordinate precision`);
    if ((item.entityType === 'country' && item.coordinatePrecision !== 'country-reference') || (item.entityType === 'region' && item.coordinatePrecision !== 'region-reference')) errors.push(`${label} coordinate precision/entity mismatch`);
    if (typeof item.coordinateNote !== 'string' || item.coordinateNote.length < 30 || !item.coordinateNote.includes('not an outage origin')) errors.push(`${label} missing uncertainty coordinate note`);
    if (!Number.isInteger(item.from) || !Number.isInteger(item.until) || item.from <= 0 || item.until <= 0 || item.from > item.until) errors.push(`${label} invalid Unix-second event window`);
    if (!Number.isFinite(item.score) || item.score < 0) errors.push(`${label} invalid IODA score`);
    if (item.datasource !== null && typeof item.datasource !== 'string') errors.push(`${label} invalid datasource`);
    if (item.method !== null && typeof item.method !== 'string') errors.push(`${label} invalid method`);
    if (item.countryCode !== null && typeof item.countryCode !== 'string') errors.push(`${label} invalid countryCode`);
    if (item.countryName !== null && typeof item.countryName !== 'string') errors.push(`${label} invalid countryName`);
    if (item.naturalEarthRegionId !== null && typeof item.naturalEarthRegionId !== 'string') errors.push(`${label} invalid Natural Earth region id`);
    if (typeof item.fromBeforeQueryWindow !== 'boolean' || typeof item.untilEqualsQueryHorizon !== 'boolean') errors.push(`${label} invalid query-window uncertainty flags`);
  }
  const outageMeta = snapshot.internetOutageMeta;
  if (!outageMeta || typeof outageMeta !== 'object') {
    errors.push('internetOutageMeta missing or not an object');
  } else {
    if (!['ok', 'preserved', 'unavailable'].includes(outageMeta.status)) errors.push('internetOutageMeta invalid status');
    const window = outageMeta.queryWindow;
    if (!window || !Number.isInteger(window.from) || !Number.isInteger(window.until) || window.from <= 0 || window.from >= window.until) errors.push('internetOutageMeta invalid explicit Unix-second query window');
    if (!Number.isInteger(window?.lookbackSeconds) || window.lookbackSeconds <= 0 || !Number.isInteger(window?.extendWindowSeconds) || window.extendWindowSeconds < 0) errors.push('internetOutageMeta invalid lookback/extendWindow seconds');
    if (!Array.isArray(outageMeta.entityTypes) || !outageMeta.entityTypes.includes('country') || !outageMeta.entityTypes.includes('region')) errors.push('internetOutageMeta invalid entityTypes');
    for (const key of ['fetchedEventCount', 'countryEventCount', 'regionEventCount', 'geolocatedEventCount', 'omittedEventCount']) {
      if (!validateNonNegativeInteger(outageMeta[key])) errors.push(`internetOutageMeta invalid ${key}`);
    }
    if (validateNonNegativeInteger(outageMeta.fetchedEventCount) && outageMeta.fetchedEventCount !== outageMeta.countryEventCount + outageMeta.regionEventCount) errors.push('internetOutageMeta entity count mismatch');
    if (validateNonNegativeInteger(outageMeta.fetchedEventCount) && outageMeta.fetchedEventCount !== outageMeta.geolocatedEventCount + outageMeta.omittedEventCount) errors.push('internetOutageMeta geolocation count mismatch');
    if (!validateNonNegativeInteger(outageMeta.omittedByReason?.invalidEventContract) || !validateNonNegativeInteger(outageMeta.omittedByReason?.missingCoordinateReference)) errors.push('internetOutageMeta invalid omission reasons');
    if (outageMeta.geolocatedEventCount !== (snapshot.internetOutages ?? []).length) errors.push('internetOutageMeta geolocated count does not match internetOutages');
    if (!Array.isArray(outageMeta.requestUrls)) {
      errors.push('internetOutageMeta requestUrls missing or not an array');
    } else if (outageMeta.status === 'ok') {
      if (outageMeta.requestUrls.length === 0) errors.push('internetOutageMeta missing auditable request URLs');
      for (const url of outageMeta.requestUrls) {
        if (!url.includes(`from=${window?.from}`) || !url.includes(`until=${window?.until}`) || !url.includes('format=ioda') || !url.includes('overall=false')) errors.push('internetOutageMeta request URL lacks explicit window/format');
      }
    }
    if (typeof outageMeta.caveat !== 'string' || !outageMeta.caveat.includes('not an all-clear')) errors.push('internetOutageMeta missing uncertainty caveat');
  }
  for (const item of snapshot.satellites ?? []) {
    if (!item.line1?.startsWith('1 ') || !item.line2?.startsWith('2 ') || !item.name || !item.catalogNumber) errors.push(`satellites:${item.id || 'unknown'} invalid TLE contract`);
  }
  for (const item of snapshot.news ?? []) {
    if (!item.title || !/^https?:\/\//.test(item.url || '')) errors.push(`news:${item.title || 'unknown'} invalid article contract`);
  }
  if (!snapshot.fetchedAt || Number.isNaN(Date.parse(snapshot.fetchedAt))) errors.push('fetchedAt invalid');
  if (errors.length > 0) throw new Error(`Snapshot contract validation failed: ${errors.slice(0, 8).join('; ')}`);
}

for (const key of ['militaryAircraft', 'aircraft', 'vessels', 'satellites', 'news', 'launches', 'naturalEvents', 'gpsInterference', 'mapOfWarsEvents', 'cyberVulnerabilities']) {
  if (result[key].length === 0 && Array.isArray(previousSnapshot[key]) && previousSnapshot[key].length > 0) {
    result[key] = previousSnapshot[key];
    result.errors.push(`${key}: transiently empty; preserved previous snapshot`);
  }
}

validateSnapshot(result);
writeFileSync(outFile, JSON.stringify(result));
const ucdpConsoleSuffix = result.ucdpMeta.preservedPriorEventCount > 0 ? `, ${result.ucdpMeta.preservedPriorEventCount} preserved` : '';
console.log(`osint snapshot: ${result.militaryAircraft.length} military aircraft, ${result.aircraft.length} civil aircraft, ${result.vessels.length} vessels, ${result.satellites.length} satellites, ${result.news.length} articles, ${result.launches.length} launches, ${result.naturalEvents.length} natural events, ${result.gpsInterference.length} gps interference cells, ${result.mapOfWarsEvents.length} map-of-wars events, ${result.ucdpMeta.mergedEventCount} UCDP official records (${result.ucdpMeta.status}${ucdpConsoleSuffix}), ${result.webcams.length} webcams, ${result.internetOutages.length} IODA outage detections (${result.internetOutageMeta.status})`);
