import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  buildMasterProvenanceLedger,
  buildSnapshotProvenanceLedger,
  createIngestionTracker,
  loadSourceRegistry,
  validateSnapshotGovernance,
  validateSourceRegistry,
} from './lib/source-governance.mjs';
import { buildChunkedPublication, writeChunkedPublication } from './lib/osint-chunked-publication.mjs';
import { OSINT_CHUNK_LAYOUT } from './lib/osint-chunk-layout.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataOutDir = join(root, 'frontend/public/data');
const outFile = join(dataOutDir, 'osint-snapshot.json');
const registryOutFile = join(dataOutDir, 'source-registry.json');
const provenanceOutFile = join(dataOutDir, 'provenance-ledger.json');
mkdirSync(dataOutDir, { recursive: true });
mkdirSync(join(dataOutDir, 'osint'), { recursive: true });

const { registry: sourceRegistry, text: sourceRegistryText } = loadSourceRegistry(join(root, 'scripts', 'source-registry.json'));
const registryValidation = validateSourceRegistry(sourceRegistry);
if (registryValidation.errors.length > 0) {
  throw new Error(`Source registry validation failed before ingestion: ${registryValidation.errors.slice(0, 8).join('; ')}`);
}
const ingestionTracker = createIngestionTracker();
function markSource(sourceId, status, detail = null, extra = {}) {
  ingestionTracker.record(sourceId, status, detail, extra);
}

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

async function getBinary(url, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'GodseyeOSINT/1.0 (+https://github.com/GodlyDonuts/crisis-averted)' } });
    if (!response.ok) throw new Error(`${response.status}`);
    return Buffer.from(await response.arrayBuffer());
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

// GDELT geolocated conflict-news ingestion. Research summary (verified live at implementation
// time): the GDELT GEO 2.0 API (https://api.gdeltproject.org/api/v2/geo/geo) answers HTTP 404 for
// its own documented example URLs and is treated as retired. The closest supported keyless public
// surface is the GKG 2.1 fifteen-minute file feed at data.gdeltproject.org/gdeltv2 — the same
// underlying data stream that powered the GEO API. This pipeline reproduces the GEO API's
// documented PointData semantics from the raw feed: locations mentioned "within a sentence or two"
// of a search term, implemented here as a documented 300-character proximity window measured with
// the character offsets GDELT itself supplies in V2ENHANCEDTHEMES/V2ENHANCEDLOCATIONS.
const GDELT_FEED_BASE_URL = 'https://data.gdeltproject.org/gdeltv2';
const GDELT_DOC_API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_CONFLICT_THEMES = ['ARMEDCONFLICT', 'TERROR', 'REBELLION', 'INSURGENCY', 'VIOLENT_UNREST', 'CEASEFIRE', 'PEACEKEEPING'];
const GDELT_CONFLICT_THEME_SET = new Set(GDELT_CONFLICT_THEMES);
const GDELT_PROXIMITY_CHARS = 300;
const GDELT_SLOTS_PER_COLLECTION = 2;
const GDELT_MAX_SLOT_ATTEMPTS = 6;
const GDELT_SLOT_STEP_MS = 15 * 60 * 1000;
const GDELT_MAX_MENTIONS = 600;
const GDELT_DOC_THROTTLE_MS = 5600;
const GDELT_DOC_ENRICHMENT_MAX_RECORDS = 250;
const GDELT_DOC_ENRICHMENT_TIMESPAN = '120min';
const GDELT_LOCATION_PRECISION_BY_TYPE = {
  2: { precision: 'us-state-centroid', rank: 1 },
  3: { precision: 'us-city-or-landmark', rank: 2 },
  4: { precision: 'world-city-or-landmark', rank: 2 },
  5: { precision: 'world-admin1-centroid', rank: 1 },
};
const GDELT_LIMITATIONS = 'GDELT geolocated news points are locations mentioned inside news text within roughly a sentence or two (a documented 300-character window, measured with GDELT-supplied character offsets) of automated conflict-theme tags. They describe the geography of media attention, not verified incident locations, and a point is never evidence that an event occurred at that place. GDELT geocoding, machine translation, and theme assignment are fully automated and error-prone; city/landmark coordinates come from GDELT gazetteer matching, while US-state and world admin-1 matches plot at the centroid of that entire division as coarse symbolic placement, never at an incident site. The GKG feed does not supply per-article publication times: slotTime is the fifteen-minute monitoring slot in which the mention was captured and seenAt exists only where a DOC API cross-reference matched the exact article URL. Article headlines are not part of the GKG feed either and appear only through that same opportunistic cross-reference. Absence of coverage is not absence of conflict.';
const GDELT_SELECTION_DESCRIPTION = `Ingests the newest ${GDELT_SLOTS_PER_COLLECTION} successfully downloaded fifteen-minute GKG 2.1 slots for both the English web and machine-translated collections (walking back up to ${GDELT_MAX_SLOT_ATTEMPTS} slots per collection when the newest files are not yet published), keeps rows carrying at least one of the documented conflict themes [${GDELT_CONFLICT_THEMES.join(', ')}] in V2ENHANCEDTHEMES, retains only sub-national location mentions (GDELT location types 2-5) within ${GDELT_PROXIMITY_CHARS} characters of a conflict-theme mention, deduplicates by normalized article URL plus location identity, then caps at ${GDELT_MAX_MENTIONS} mentions ranked by matched-theme count, spatial precision class, proximity, and recency. Country-level mentions (type 1) are out of scope by design and reported as an informational count rather than an omission.`;

function createGdeltGeoOmissionCounts() {
  return {
    invalidCoordinates: 0,
    notProximalToConflictTheme: 0,
    duplicateMention: 0,
    selectionCap: 0,
  };
}

function createGdeltGeoEnrichmentMeta() {
  return {
    status: 'unavailable',
    apiEndpoint: GDELT_DOC_API_URL,
    query: `(${GDELT_CONFLICT_THEMES.map((theme) => `theme:${theme}`).join(' OR ')})`,
    maxRecords: GDELT_DOC_ENRICHMENT_MAX_RECORDS,
    timespan: GDELT_DOC_ENRICHMENT_TIMESPAN,
    sort: 'datedesc',
    fetchedArticleCount: 0,
    matchedArticleCount: 0,
    requestUrl: null,
    detail: 'not attempted',
  };
}

function createGdeltGeoMeta(status = 'unavailable') {
  return {
    status,
    provider: 'The GDELT Project — Global Knowledge Graph (GKG) 2.1 fifteen-minute feeds',
    attribution: 'GDELT terms of use require citation: The GDELT Project (https://www.gdeltproject.org/)',
    geoApiNote: 'The GDELT GEO 2.0 API (api.gdeltproject.org/api/v2/geo/geo) answered HTTP 404 for its own documented example URLs at implementation time and is treated as retired; this pipeline reproduces its documented point-mode semantics from the supported keyless GKG 2.1 fifteen-minute files that powered it.',
    feedBaseUrl: GDELT_FEED_BASE_URL,
    conflictThemes: [...GDELT_CONFLICT_THEMES],
    proximityChars: GDELT_PROXIMITY_CHARS,
    slotsPerCollection: GDELT_SLOTS_PER_COLLECTION,
    maxSlotAttempts: GDELT_MAX_SLOT_ATTEMPTS,
    maxMentions: GDELT_MAX_MENTIONS,
    slotsIngested: [],
    failedSlotDownloadCount: 0,
    rowsScanned: 0,
    invalidRowCount: 0,
    conflictThemeRowCount: 0,
    countryLevelMentionCount: 0,
    subnationalMentionCount: 0,
    proximalMentionCount: 0,
    uniqueMentionCount: 0,
    ingestedMentionCount: 0,
    uniqueArticleCount: 0,
    uniqueLocationCount: 0,
    titleEnrichedArticleCount: 0,
    omittedMentionCount: 0,
    omittedByReason: createGdeltGeoOmissionCounts(),
    titleEnrichment: createGdeltGeoEnrichmentMeta(),
    requestUrls: [],
    selection: GDELT_SELECTION_DESCRIPTION,
    caveat: GDELT_LIMITATIONS,
  };
}

let lastGdeltDocRequestAt = 0;
async function throttleGdeltDocApi() {
  const wait = GDELT_DOC_THROTTLE_MS - (Date.now() - lastGdeltDocRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGdeltDocRequestAt = Date.now();
}

function unzipFirstMember(buffer) {
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 22 - 65536); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocdOffset = index; break; }
  }
  if (eocdOffset < 0) throw new Error('zip end-of-central-directory not found');
  if (buffer.readUInt16LE(eocdOffset + 10) < 1) throw new Error('zip archive is empty');
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('zip central directory corrupt');
  const compression = buffer.readUInt16LE(centralOffset + 10);
  const compressedSize = buffer.readUInt32LE(centralOffset + 20);
  const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
  const nameLength = buffer.readUInt16LE(centralOffset + 28);
  const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
  const name = buffer.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLength);
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('zip local header corrupt');
  const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
  let data;
  if (compression === 8) data = inflateRawSync(compressed);
  else if (compression === 0) data = Buffer.from(compressed);
  else throw new Error(`unsupported zip compression method ${compression}`);
  if (data.length !== uncompressedSize) throw new Error('zip uncompressed size mismatch');
  return { name, data };
}

function parseGdeltSlotDateTime(text) {
  const match = typeof text === 'string' ? text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(epochMs);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day || roundTrip.getUTCHours() !== hour || roundTrip.getUTCMinutes() !== minute) return null;
  return epochMs;
}

function formatGdeltSlotDateTime(epochMs) {
  const date = new Date(epochMs);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function extractGdeltGkgSeed(text, fileSuffix) {
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const url = parts[2] ?? '';
    if (!url.endsWith(fileSuffix)) continue;
    const match = url.match(/(\d{14})\.[a-z.]*gkg\.csv\.zip$/i);
    if (!match) continue;
    const epochMs = parseGdeltSlotDateTime(match[1]);
    if (epochMs !== null) return { epochMs, slotTimestamp: match[1], listingUrl: url };
  }
  return null;
}

const GDELT_GKG_COLLECTIONS = [
  { key: 'english-web', lastUpdateUrl: `${GDELT_FEED_BASE_URL}/lastupdate.txt`, fileSuffix: '.gkg.csv.zip', fileInfix: '.' },
  { key: 'machine-translated', lastUpdateUrl: `${GDELT_FEED_BASE_URL}/lastupdate-translation.txt`, fileSuffix: '.translation.gkg.csv.zip', fileInfix: '.translation.' },
];

async function collectGdeltGkgSlots(collection, meta) {
  const listing = await getText(collection.lastUpdateUrl, 20000);
  meta.requestUrls.push(collection.lastUpdateUrl);
  const seed = extractGdeltGkgSeed(listing, collection.fileSuffix);
  if (!seed) throw new Error(`${collection.key}: lastupdate listing has no usable ${collection.fileSuffix} member`);
  const slots = [];
  let lastError = null;
  for (let step = 0; step < GDELT_MAX_SLOT_ATTEMPTS && slots.length < GDELT_SLOTS_PER_COLLECTION; step += 1) {
    const slotEpochMs = seed.epochMs - step * GDELT_SLOT_STEP_MS;
    const slotTimestamp = formatGdeltSlotDateTime(slotEpochMs);
    const url = `${GDELT_FEED_BASE_URL}/${slotTimestamp}${collection.fileInfix}gkg.csv.zip`;
    try {
      const buffer = await getBinary(url, 60000);
      const member = unzipFirstMember(buffer);
      slots.push({ slotTimestamp, slotEpochMs, url, text: member.data.toString('utf8') });
      meta.requestUrls.push(url);
    } catch (error) {
      lastError = error;
      meta.failedSlotDownloadCount += 1;
    }
  }
  if (slots.length === 0) throw new Error(`${collection.key}: no fifteen-minute GKG slot downloadable after ${GDELT_MAX_SLOT_ATTEMPTS} walkback attempts${lastError ? ` (last error: ${lastError.message})` : ''}`);
  return slots;
}

function parseGdeltConflictThemeOffsets(field) {
  const offsets = [];
  if (!field) return offsets;
  for (const entry of field.split(';')) {
    if (!entry) continue;
    const comma = entry.lastIndexOf(',');
    if (comma <= 0) continue;
    const theme = entry.slice(0, comma);
    const offset = Number(entry.slice(comma + 1));
    if (GDELT_CONFLICT_THEME_SET.has(theme) && Number.isInteger(offset) && offset >= 0) offsets.push({ theme, offset });
  }
  return offsets;
}

function parseGdeltEnhancedLocations(field) {
  const locations = [];
  if (!field) return locations;
  for (const entry of field.split(';')) {
    if (!entry) continue;
    const parts = entry.split('#');
    if (parts.length < 9) continue;
    const type = Number(parts[0]);
    const lat = Number(parts[5]);
    const lng = Number(parts[6]);
    const offset = Number(parts[8]);
    locations.push({
      type,
      fullName: parts[1] || '',
      countryCode: parts[2] || null,
      adm1Code: parts[3] || null,
      lat,
      lng,
      featureId: parts[7] || null,
      offset: Number.isInteger(offset) && offset >= 0 ? offset : null,
    });
  }
  return locations;
}

function parseGdeltTone(field) {
  if (!field) return null;
  const parts = field.split(',').map(Number);
  if (parts.length < 7 || parts.some((value) => !Number.isFinite(value))) return null;
  return {
    tone: parts[0],
    positiveScore: parts[1],
    negativeScore: parts[2],
    wordCount: Number.isInteger(parts[6]) && parts[6] >= 0 ? parts[6] : null,
  };
}

function safePublicMediaUrl(value) {
  if (!/^https?:\/\//i.test(value || '')) return null;
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (/(^|[_-])(api[-_]?key|key|token|access[-_]?token|secret|password)([_-]|$)/i.test(key)) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeGdeltArticleUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}${parsed.search}`;
  } catch {
    return String(url).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

function parseGdeltDocSeenDate(value) {
  const match = typeof value === 'string' ? value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(epochMs);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null;
  return new Date(epochMs).toISOString();
}

async function collectGdeltDocEnrichment(meta) {
  const enrichment = meta.titleEnrichment;
  const url = new URL(GDELT_DOC_API_URL);
  url.searchParams.set('query', enrichment.query);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', String(GDELT_DOC_ENRICHMENT_MAX_RECORDS));
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', GDELT_DOC_ENRICHMENT_TIMESPAN);
  url.searchParams.set('sort', 'datedesc');
  enrichment.requestUrl = url.toString();
  try {
    let payload = null;
    let lastError = null;
    // The DOC API enforces a shared rate limit and frequently answers 429 even for polite
    // clients; one spaced retry materially improves headline coverage without abusing the API.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await throttleGdeltDocApi();
        payload = await getJson(url, 24000);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 8000));
      }
    }
    if (!payload) throw lastError ?? new Error('DOC API unavailable');
    const articles = Array.isArray(payload?.articles) ? payload.articles : null;
    if (!articles) throw new Error('unexpected DOC API response contract');
    const byNormalizedUrl = new Map();
    for (const article of articles) {
      if (!article || typeof article.url !== 'string' || !article.url) continue;
      byNormalizedUrl.set(normalizeGdeltArticleUrl(article.url), {
        title: textOrNull(article.title),
        seenAt: parseGdeltDocSeenDate(article.seendate),
      });
    }
    enrichment.status = 'ok';
    enrichment.fetchedArticleCount = byNormalizedUrl.size;
    enrichment.detail = null;
    return byNormalizedUrl;
  } catch (error) {
    enrichment.status = 'unavailable';
    enrichment.detail = error instanceof Error ? error.message : String(error);
    return new Map();
  }
}

function gdeltMentionSortScore(mention) {
  const precisionRank = GDELT_LOCATION_PRECISION_BY_TYPE[mention.locationType]?.rank ?? 0;
  const proximityScore = (1 - mention.proximityChars / (GDELT_PROXIMITY_CHARS + 1)) * 15;
  return mention.themes.length * 100 + precisionRank * 25 + proximityScore;
}

async function collectGdeltGeoNews() {
  const meta = createGdeltGeoMeta('unavailable');
  const enrichmentMap = await collectGdeltDocEnrichment(meta);
  const mentionByKey = new Map();

  for (const collection of GDELT_GKG_COLLECTIONS) {
    const slots = await collectGdeltGkgSlots(collection, meta);
    // Process oldest slots first so first-seen captures win cross-slot deduplication.
    for (const slot of [...slots].reverse()) {
      let slotRowCount = 0;
      for (const line of slot.text.split('\n')) {
        if (!line.trim()) continue;
        slotRowCount += 1;
        meta.rowsScanned += 1;
        const cols = line.split('\t');
        const url = textOrNull(cols[4]);
        const domain = textOrNull(cols[3]);
        if (cols.length < 19 || !url || !/^https?:\/\//i.test(url) || !domain) {
          meta.invalidRowCount += 1;
          continue;
        }
        const themeOffsets = parseGdeltConflictThemeOffsets(cols[8]);
        if (themeOffsets.length === 0) continue;
        meta.conflictThemeRowCount += 1;
        const tone = parseGdeltTone(cols[15]);
        const sharingImage = safePublicMediaUrl(cols[18]);

        // Within one article, keep the nearest mention per location identity.
        const nearestByLocation = new Map();
        const countryLevelKeys = new Set();
        for (const location of parseGdeltEnhancedLocations(cols[10])) {
          if (location.type === 1) {
            countryLevelKeys.add(`${location.featureId ?? 'unknown'}:${location.lat.toFixed(2)}:${location.lng.toFixed(2)}`);
            continue;
          }
          if (!GDELT_LOCATION_PRECISION_BY_TYPE[location.type]) continue;
          if (!validCoordinatePair(location.lat, location.lng) || location.offset === null) {
            meta.omittedByReason.invalidCoordinates += 1;
            continue;
          }
          const proximity = Math.min(...themeOffsets.map((entry) => Math.abs(entry.offset - location.offset)));
          const locationKey = `${location.type}:${location.featureId ?? 'unknown'}:${location.lat.toFixed(3)}:${location.lng.toFixed(3)}`;
          const existing = nearestByLocation.get(locationKey);
          if (!existing || proximity < existing.proximity) nearestByLocation.set(locationKey, { location, locationKey, proximity });
        }
        meta.countryLevelMentionCount += countryLevelKeys.size;

        for (const { location, locationKey, proximity } of nearestByLocation.values()) {
          meta.subnationalMentionCount += 1;
          if (proximity > GDELT_PROXIMITY_CHARS) {
            meta.omittedByReason.notProximalToConflictTheme += 1;
            continue;
          }
          meta.proximalMentionCount += 1;
          const dedupeKey = `${normalizeGdeltArticleUrl(url)}|${locationKey}`;
          if (mentionByKey.has(dedupeKey)) {
            meta.omittedByReason.duplicateMention += 1;
            continue;
          }
          const enrichment = enrichmentMap.get(normalizeGdeltArticleUrl(url)) ?? null;
          const precisionInfo = GDELT_LOCATION_PRECISION_BY_TYPE[location.type];
          // Per-mention themes are limited to the tags actually inside this location's
          // proximity window, never the article-wide union, so the point cannot overclaim.
          const proximateThemes = [...new Set(
            themeOffsets
              .filter((entry) => Math.abs(entry.offset - location.offset) <= GDELT_PROXIMITY_CHARS)
              .map((entry) => entry.theme)
          )].sort();
          if (proximateThemes.length === 0) continue;
          mentionByKey.set(dedupeKey, {
            id: `gdeltgeo:${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 20)}`,
            url,
            title: enrichment?.title ?? null,
            domain,
            collection: collection.key,
            locationName: location.fullName,
            locationType: location.type,
            coordinatePrecision: precisionInfo.precision,
            countryCode: location.countryCode,
            adm1Code: location.adm1Code,
            featureId: location.featureId,
            lat: location.lat,
            lng: location.lng,
            proximityChars: proximity,
            themes: proximateThemes,
            tone: tone?.tone ?? null,
            positiveScore: tone?.positiveScore ?? null,
            negativeScore: tone?.negativeScore ?? null,
            wordCount: tone?.wordCount ?? null,
            sharingImage,
            slotTime: new Date(slot.slotEpochMs).toISOString(),
            seenAt: enrichment?.seenAt ?? null,
            slotEpochMs: slot.slotEpochMs,
          });
        }
      }
      meta.slotsIngested.push({ collection: collection.key, slotTimestamp: slot.slotTimestamp, url: slot.url, rowCount: slotRowCount });
    }
  }

  meta.uniqueMentionCount = mentionByKey.size;
  const ranked = [...mentionByKey.values()]
    .map((mention) => ({ mention, score: gdeltMentionSortScore(mention) }))
    .sort((a, b) => b.score - a.score || b.mention.slotEpochMs - a.mention.slotEpochMs || a.mention.id.localeCompare(b.mention.id));
  const selected = ranked.slice(0, GDELT_MAX_MENTIONS).map((entry) => entry.mention);
  meta.omittedByReason.selectionCap = Math.max(0, ranked.length - selected.length);
  meta.ingestedMentionCount = selected.length;
  meta.uniqueArticleCount = new Set(selected.map((mention) => normalizeGdeltArticleUrl(mention.url))).size;
  meta.uniqueLocationCount = new Set(selected.map((mention) => `${mention.lat.toFixed(3)}:${mention.lng.toFixed(3)}:${mention.locationName}`)).size;
  meta.titleEnrichedArticleCount = new Set(selected.filter((mention) => mention.title !== null).map((mention) => normalizeGdeltArticleUrl(mention.url))).size;
  meta.titleEnrichment.matchedArticleCount = meta.titleEnrichedArticleCount;
  meta.omittedMentionCount = Object.values(meta.omittedByReason).reduce((sum, value) => sum + value, 0);
  meta.status = 'ok';
  for (const mention of selected) delete mention.slotEpochMs;
  return { mentions: selected, meta };
}

// Authoritative cyber-vulnerability enrichment. NVD documents the CVE 2.0 API at
// services.nvd.nist.gov/rest/json/cves/2.0, apiKey as a request header, 5 requests per
// rolling 30 seconds without a key and 50 per rolling 30 seconds with one. The pipeline
// is deliberately more conservative than either quota: serial requests only, cveIds
// batching, a minimum 6.5 second gap when more than one NVD request is needed, one
// bounded retry for transient/rate-limit responses, and six-hour positive caching.
const CISA_KEV_API_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const CISA_KEV_MAX_RECORDS = 30;
const NVD_CVE_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_CVE_IDS_MAX_BATCH = 100;
const NVD_MIN_REQUEST_INTERVAL_MS = 6500;
const NVD_MAX_ATTEMPTS_PER_BATCH = 2;
const NVD_RETRY_FALLBACK_DELAY_MS = 31000;
const NVD_MAX_RETRY_DELAY_MS = 75000;
const NVD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NVD_NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const NVD_MAX_DESCRIPTIONS_PER_CVE = 4;
const NVD_MAX_REFERENCES_PER_CVE = 12;
const NVD_MAX_REFERENCE_TAGS_PER_REFERENCE = 8;
const NVD_MAX_CONFIGURATIONS_PER_CVE = 12;
const NVD_MAX_CPE_MATCHES_PER_CVE = 40;
const NVD_MAX_AFFECTED_PRODUCTS_PER_CVE = 12;
const NVD_MAX_AFFECTED_VERSIONS_PER_PRODUCT = 10;
const NVD_MAX_AFFECTED_CHANGES_PER_VERSION = 8;
const NVD_MAX_AFFECTED_STRINGS_PER_FIELD = 12;
const EPSS_API_URL = 'https://api.first.org/data/v1/epss';
const EPSS_CVE_PARAMETER_MAX_CHARS = 2000;
const EPSS_MAX_CVES_PER_BATCH = 100;
const EPSS_MIN_REQUEST_INTERVAL_MS = 600;
const EPSS_MAX_ATTEMPTS_PER_BATCH = 2;
const EPSS_RETRY_FALLBACK_DELAY_MS = 5000;
const EPSS_MAX_RETRY_DELAY_MS = 60000;
const EPSS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EPSS_NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const VULNERABILITY_CACHE_VERSION = 3;
const VULNERABILITY_CACHE_PATH = 'scripts/.cache/nvd-cve-enrichment.json';
const VULNERABILITY_CACHE_FILE = join(root, 'scripts', '.cache', 'nvd-cve-enrichment.json');
const CYBER_VULNERABILITY_CAVEAT = 'CISA KEV presence is authoritative evidence that CISA knows the vulnerability has been exploited; it is not a complete exploitation inventory. NVD fields are NVD/CNA-supplied vulnerability metadata, not independent confirmation of exploitation, and absent NVD or EPSS fields are explicit gaps rather than zero risk. EPSS is FIRST\'s current probability estimate for exploitation in the next 30 days, not observed exploitation evidence. Bounded references, affected-product entries, configurations, and CPE matches are build-size caps; per-record truncation counts disclose what was omitted. Cached or preserved evidence retains its original retrieval timestamp and is never represented as a fresh authoritative lookup.';
const CYBER_VULNERABILITY_SELECTION = `Selects the ${CISA_KEV_MAX_RECORDS} most recently added valid unique CISA KEV records, enriches those CVE IDs with the NVD CVE 2.0 cveIds batch API (maximum ${NVD_CVE_IDS_MAX_BATCH} IDs/request, serial concurrency), and queries FIRST EPSS public scores in length-bounded batches (maximum ${EPSS_CVE_PARAMETER_MAX_CHARS} characters of CVE parameter, serial concurrency). NVD descriptions are capped at ${NVD_MAX_DESCRIPTIONS_PER_CVE}, references at ${NVD_MAX_REFERENCES_PER_CVE}, configurations at ${NVD_MAX_CONFIGURATIONS_PER_CVE}, CPE matches at ${NVD_MAX_CPE_MATCHES_PER_CVE}, and affected products at ${NVD_MAX_AFFECTED_PRODUCTS_PER_CVE} per CVE.`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

async function getJsonWithMetadata(url, timeout = 20000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GodseyeOSINT/1.0 (+https://github.com/GodlyDonuts/crisis-averted)', ...extraHeaders },
    });
    const text = await response.text();
    let payload = null;
    if (text.trim()) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const upstreamMessage = response.headers.get('message');
      const error = new Error(`${response.status}${upstreamMessage ? ` ${upstreamMessage}` : ''}`);
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      throw error;
    }
    if (!payload || typeof payload !== 'object') throw new Error('invalid JSON response contract');
    return { payload, status: response.status, retrievedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}

async function fetchJsonWithBoundedRetry(url, timeout, extraHeaders, behavior, counters, state) {
  for (let attempt = 1; attempt <= behavior.maxAttempts; attempt += 1) {
    const wait = behavior.minIntervalMs - (Date.now() - state.lastRequestAt);
    if (wait > 0) await sleep(wait);
    state.lastRequestAt = Date.now();
    counters.requestAttemptCount += 1;
    try {
      const result = await getJsonWithMetadata(url, timeout, extraHeaders);
      counters.successfulRequestCount += 1;
      return result;
    } catch (error) {
      if (error.status === 429) counters.throttledResponseCount += 1;
      const retryable = error.status === undefined || [408, 429, 500, 502, 503, 504].includes(error.status);
      if (!retryable || attempt >= behavior.maxAttempts) throw error;
      if (error.retryAfterMs !== null && error.retryAfterMs !== undefined && error.retryAfterMs > behavior.maxRetryDelayMs) throw error;
      counters.retryCount += 1;
      const retryDelayMs = Math.min(error.retryAfterMs ?? behavior.retryFallbackDelayMs, behavior.maxRetryDelayMs);
      counters.retryDelayMsTotal += retryDelayMs;
      counters.retryDelayMsMax = Math.max(counters.retryDelayMsMax, retryDelayMs);
      await sleep(retryDelayMs);
    }
  }
  throw new Error('bounded retry loop exhausted unexpectedly');
}

function createCyberKevOmissionCounts() {
  return {
    invalidRecord: 0,
    duplicateCveId: 0,
    selectionCap: 0,
  };
}

function createCyberNvdOmissionCounts() {
  return {
    missingNvdRecord: 0,
    invalidNvdRecord: 0,
    requestFailed: 0,
    notAttempted: 0,
  };
}

function createCyberEpssOmissionCounts() {
  return {
    missingEpssRecord: 0,
    invalidEpssRecord: 0,
    requestFailed: 0,
    notAttempted: 0,
  };
}

function createCyberRateLimitCounters() {
  return {
    requestAttemptCount: 0,
    successfulRequestCount: 0,
    retryCount: 0,
    throttledResponseCount: 0,
    retryDelayMsTotal: 0,
    retryDelayMsMax: 0,
  };
}

function createCyberVulnerabilityMeta(status = 'unavailable') {
  return {
    status,
    provider: 'CISA Known Exploited Vulnerabilities + NIST NVD CVE API 2.0 + FIRST EPSS API',
    selection: CYBER_VULNERABILITY_SELECTION,
    caveat: CYBER_VULNERABILITY_CAVEAT,
    statusDetail: null,
    preservedAt: null,
    kev: {
      status: 'unavailable',
      provider: 'CISA Known Exploited Vulnerabilities catalog',
      apiUrl: CISA_KEV_API_URL,
      requestUrl: CISA_KEV_API_URL,
      retrievedAt: null,
      title: null,
      catalogVersion: null,
      dateReleased: null,
      reportedCount: 0,
      fetchedRecordCount: 0,
      validRecordCount: 0,
      selectedRecordCount: 0,
      maxSelectedRecords: CISA_KEV_MAX_RECORDS,
      omittedRecordCount: 0,
      omittedByReason: createCyberKevOmissionCounts(),
    },
    nvd: {
      status: 'not-attempted',
      provider: 'NIST National Vulnerability Database CVE API',
      apiBaseUrl: NVD_CVE_API_URL,
      apiVersion: '2.0',
      apiKeyConfigured: false,
      batchParameter: 'cveIds',
      maxBatchSize: NVD_CVE_IDS_MAX_BATCH,
      maxConcurrency: 1,
      configuredMinRequestIntervalMs: NVD_MIN_REQUEST_INTERVAL_MS,
      documentedPublicRequestsPerRolling30Seconds: 5,
      documentedAuthenticatedRequestsPerRolling30Seconds: 50,
      maxAttemptsPerBatch: NVD_MAX_ATTEMPTS_PER_BATCH,
      retryFallbackDelayMs: NVD_RETRY_FALLBACK_DELAY_MS,
      maxRetryDelayMs: NVD_MAX_RETRY_DELAY_MS,
      cacheTtlMs: NVD_CACHE_TTL_MS,
      negativeCacheTtlMs: NVD_NEGATIVE_CACHE_TTL_MS,
      requestedCveCount: 0,
      fetchedCveCount: 0,
      freshCacheHitCount: 0,
      negativeCacheHitCount: 0,
      staleCacheHitCount: 0,
      priorSnapshotHitCount: 0,
      enrichedCveCount: 0,
      omittedCveCount: 0,
      omittedByReason: createCyberNvdOmissionCounts(),
      requestUrls: [],
      retrievedAt: null,
      ...createCyberRateLimitCounters(),
    },
    epss: {
      status: 'not-attempted',
      provider: 'FIRST Exploit Prediction Scoring System (EPSS) API v1',
      apiBaseUrl: EPSS_API_URL,
      scope: 'public',
      maxCveParameterChars: EPSS_CVE_PARAMETER_MAX_CHARS,
      maxCvesPerBatch: EPSS_MAX_CVES_PER_BATCH,
      maxConcurrency: 1,
      configuredMinRequestIntervalMs: EPSS_MIN_REQUEST_INTERVAL_MS,
      maxAttemptsPerBatch: EPSS_MAX_ATTEMPTS_PER_BATCH,
      retryFallbackDelayMs: EPSS_RETRY_FALLBACK_DELAY_MS,
      maxRetryDelayMs: EPSS_MAX_RETRY_DELAY_MS,
      cacheTtlMs: EPSS_CACHE_TTL_MS,
      negativeCacheTtlMs: EPSS_NEGATIVE_CACHE_TTL_MS,
      requestedCveCount: 0,
      fetchedCveCount: 0,
      freshCacheHitCount: 0,
      negativeCacheHitCount: 0,
      staleCacheHitCount: 0,
      priorSnapshotHitCount: 0,
      enrichedCveCount: 0,
      omittedCveCount: 0,
      omittedByReason: createCyberEpssOmissionCounts(),
      requestUrls: [],
      retrievedAt: null,
      ...createCyberRateLimitCounters(),
    },
    cache: {
      status: 'empty',
      path: VULNERABILITY_CACHE_PATH,
      version: VULNERABILITY_CACHE_VERSION,
      loaded: false,
      written: false,
      detail: null,
    },
  };
}

function createEmptyVulnerabilityCache() {
  return {
    version: VULNERABILITY_CACHE_VERSION,
    updatedAt: null,
    nvd: {},
    epss: {},
  };
}

function loadVulnerabilityCache(meta) {
  if (!existsSync(VULNERABILITY_CACHE_FILE)) return createEmptyVulnerabilityCache();
  try {
    const parsed = JSON.parse(readFileSync(VULNERABILITY_CACHE_FILE, 'utf8'));
    if (parsed?.version !== VULNERABILITY_CACHE_VERSION || typeof parsed.nvd !== 'object' || typeof parsed.epss !== 'object') {
      meta.cache.status = 'unavailable';
      meta.cache.detail = 'cache schema/version mismatch; starting with an empty cache';
      return createEmptyVulnerabilityCache();
    }
    meta.cache.status = 'ok';
    meta.cache.loaded = true;
    return {
      version: VULNERABILITY_CACHE_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      nvd: parsed.nvd && !Array.isArray(parsed.nvd) ? parsed.nvd : {},
      epss: parsed.epss && !Array.isArray(parsed.epss) ? parsed.epss : {},
    };
  } catch (error) {
    meta.cache.status = 'unavailable';
    meta.cache.detail = `cache unreadable: ${error.message}`;
    return createEmptyVulnerabilityCache();
  }
}

function writeVulnerabilityCache(cache, meta) {
  try {
    mkdirSync(dirname(VULNERABILITY_CACHE_FILE), { recursive: true });
    const tmpFile = `${VULNERABILITY_CACHE_FILE}.tmp`;
    writeFileSync(tmpFile, JSON.stringify({ ...cache, version: VULNERABILITY_CACHE_VERSION, updatedAt: new Date().toISOString() }));
    renameSync(tmpFile, VULNERABILITY_CACHE_FILE);
    meta.cache.written = true;
    meta.cache.status = 'ok';
    return true;
  } catch (error) {
    meta.cache.status = 'write-failed';
    meta.cache.detail = `cache write failed: ${error.message}`;
    return false;
  }
}

function normalizeCveId(value) {
  if (typeof value !== 'string') return null;
  const cveId = value.trim().toUpperCase();
  return /^CVE-\d{4}-\d{4,}$/.test(cveId) ? cveId : null;
}

function uniqueValidCveIds(values) {
  return [...new Set((values ?? []).map(normalizeCveId).filter(Boolean))];
}

function validIsoDateTimeString(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plausibleNvdEvidence(evidence, cveId) {
  return evidence && typeof evidence === 'object'
    && evidence.id === cveId
    && validIsoDateTimeString(evidence.retrievedAt)
    && Array.isArray(evidence.descriptions)
    && Array.isArray(evidence.metrics)
    && Array.isArray(evidence.weaknesses)
    && Array.isArray(evidence.references)
    && Array.isArray(evidence.configurations)
    && Array.isArray(evidence.affectedProducts)
    && evidence.truncation && typeof evidence.truncation === 'object'
    && Object.keys(createNvdEvidenceTruncation()).every((key) => Number.isInteger(evidence.truncation[key]) && evidence.truncation[key] >= 0);
}

function plausibleEpssEvidence(evidence, cveId) {
  return evidence && typeof evidence === 'object'
    && evidence.cve === cveId
    && Number.isFinite(evidence.score)
    && Number.isFinite(evidence.percentile)
    && validIsoDateTimeString(evidence.retrievedAt);
}

function createNvdEvidenceTruncation() {
  return {
    descriptionsOmitted: 0,
    referencesOmitted: 0,
    referenceTagsOmitted: 0,
    configurationsOmitted: 0,
    cpeMatchesOmitted: 0,
    affectedProductsOmitted: 0,
    affectedVersionsOmitted: 0,
    affectedFieldValuesOmitted: 0,
    nonCweWeaknessValuesOmitted: 0,
    invalidFieldCount: 0,
  };
}

function normalizeNvdDescriptions(value, truncation) {
  const valid = [];
  for (const item of Array.isArray(value) ? value : []) {
    const lang = textOrNull(item?.lang);
    const description = textOrNull(item?.value);
    if (lang && description) valid.push({ lang, value: description });
    else truncation.invalidFieldCount += 1;
  }
  truncation.descriptionsOmitted += Math.max(0, valid.length - NVD_MAX_DESCRIPTIONS_PER_CVE);
  return valid.slice(0, NVD_MAX_DESCRIPTIONS_PER_CVE);
}

function normalizeNvdMetrics(metrics) {
  const normalized = [];
  for (const metricSet of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2']) {
    for (const item of Array.isArray(metrics?.[metricSet]) ? metrics[metricSet] : []) {
      const cvssData = item?.cvssData && typeof item.cvssData === 'object' ? item.cvssData : {};
      normalized.push({
        metricSet,
        source: textOrNull(item?.source),
        type: textOrNull(item?.type),
        vectorString: textOrNull(cvssData.vectorString),
        baseScore: numberOrNull(cvssData.baseScore),
        baseSeverity: textOrNull(cvssData.baseSeverity ?? item?.baseSeverity),
        exploitabilityScore: numberOrNull(item?.exploitabilityScore),
        impactScore: numberOrNull(item?.impactScore),
      });
    }
  }
  return normalized;
}

function normalizeNvdWeaknesses(value, truncation) {
  const weaknesses = [];
  for (const item of Array.isArray(value) ? value : []) {
    const source = textOrNull(item?.source);
    const type = textOrNull(item?.type);
    const descriptions = Array.isArray(item?.description) ? item.description : [];
    if (descriptions.length === 0) truncation.invalidFieldCount += 1;
    for (const description of descriptions) {
      const id = textOrNull(description?.value);
      if (id && /^CWE-\d+$/.test(id)) weaknesses.push({ id, source, type });
      else if (id) truncation.nonCweWeaknessValuesOmitted += 1;
      else truncation.invalidFieldCount += 1;
    }
  }
  return weaknesses;
}

function normalizeHttpUrl(value) {
  const text = textOrNull(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeNvdReferences(value, truncation) {
  const references = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (references.length >= NVD_MAX_REFERENCES_PER_CVE) {
      truncation.referencesOmitted += 1;
      continue;
    }
    const url = normalizeHttpUrl(item?.url);
    if (!url) {
      truncation.invalidFieldCount += 1;
      continue;
    }
    const tags = (Array.isArray(item?.tags) ? item.tags : []).filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim());
    truncation.referenceTagsOmitted += Math.max(0, tags.length - NVD_MAX_REFERENCE_TAGS_PER_REFERENCE);
    references.push({
      url,
      source: textOrNull(item?.source),
      tags: tags.slice(0, NVD_MAX_REFERENCE_TAGS_PER_REFERENCE),
    });
  }
  return references;
}

function normalizeNvdCpeMatch(value) {
  const criteria = textOrNull(value?.criteria);
  if (!criteria || !criteria.startsWith('cpe:2.3:')) return null;
  return {
    criteria,
    vulnerable: typeof value?.vulnerable === 'boolean' ? value.vulnerable : null,
    matchCriteriaId: textOrNull(value?.matchCriteriaId),
    versionStartIncluding: textOrNull(value?.versionStartIncluding),
    versionStartExcluding: textOrNull(value?.versionStartExcluding),
    versionEndIncluding: textOrNull(value?.versionEndIncluding),
    versionEndExcluding: textOrNull(value?.versionEndExcluding),
  };
}

function countRawConfigurationCpeMatches(value) {
  if (!value || typeof value !== 'object') return 0;
  const own = Array.isArray(value.cpeMatch) ? value.cpeMatch.length : 0;
  return own + (Array.isArray(value.nodes) ? value.nodes : []).reduce((sum, node) => sum + countRawConfigurationCpeMatches(node), 0);
}

function nvdConfigurationNodeHasEvidence(node) {
  return node.cpeMatch.length > 0 || node.nodes.some(nvdConfigurationNodeHasEvidence);
}

function normalizeNvdConfigurationNode(rawNode, cpeBudget, truncation) {
  const node = {
    operator: textOrNull(rawNode?.operator),
    negate: typeof rawNode?.negate === 'boolean' ? rawNode.negate : null,
    cpeMatch: [],
    nodes: [],
  };
  for (const rawMatch of Array.isArray(rawNode?.cpeMatch) ? rawNode.cpeMatch : []) {
    if (cpeBudget.remaining <= 0) {
      truncation.cpeMatchesOmitted += 1;
      continue;
    }
    const match = normalizeNvdCpeMatch(rawMatch);
    if (!match) {
      truncation.invalidFieldCount += 1;
      continue;
    }
    cpeBudget.remaining -= 1;
    node.cpeMatch.push(match);
  }
  for (const rawChild of Array.isArray(rawNode?.nodes) ? rawNode.nodes : []) {
    const child = normalizeNvdConfigurationNode(rawChild, cpeBudget, truncation);
    if (nvdConfigurationNodeHasEvidence(child)) node.nodes.push(child);
  }
  return node;
}

function normalizeNvdConfigurations(value, truncation) {
  const configurations = [];
  for (const rawConfiguration of Array.isArray(value) ? value : []) {
    if (configurations.length >= NVD_MAX_CONFIGURATIONS_PER_CVE) {
      truncation.configurationsOmitted += 1;
      truncation.cpeMatchesOmitted += countRawConfigurationCpeMatches(rawConfiguration);
      continue;
    }
    const cpeBudget = { remaining: Math.max(0, NVD_MAX_CPE_MATCHES_PER_CVE - configurations.reduce((sum, item) => sum + countNvdConfigurationCpeMatches(item), 0)) };
    const nodes = (Array.isArray(rawConfiguration?.nodes) ? rawConfiguration.nodes : [])
      .map((node) => normalizeNvdConfigurationNode(node, cpeBudget, truncation))
      .filter(nvdConfigurationNodeHasEvidence);
    if (nodes.length === 0) {
      if (countRawConfigurationCpeMatches(rawConfiguration) === 0) truncation.invalidFieldCount += 1;
      continue;
    }
    configurations.push({
      operator: textOrNull(rawConfiguration?.operator),
      nodes,
    });
  }
  return configurations;
}

function countNvdConfigurationCpeMatches(configuration) {
  const countNode = (node) => node.cpeMatch.length + node.nodes.reduce((sum, child) => sum + countNode(child), 0);
  return (configuration?.nodes ?? []).reduce((sum, node) => sum + countNode(node), 0);
}

function normalizeStringList(value, cap, truncation) {
  const strings = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = textOrNull(item);
    if (text) strings.push(text);
    else truncation.invalidFieldCount += 1;
  }
  truncation.affectedFieldValuesOmitted += Math.max(0, strings.length - cap);
  return strings.slice(0, cap);
}

function normalizeNvdAffectedVersion(rawVersion, truncation) {
  const rawChanges = Array.isArray(rawVersion?.changes) ? rawVersion.changes : [];
  const changes = [];
  for (const rawChange of rawChanges.slice(0, NVD_MAX_AFFECTED_CHANGES_PER_VERSION)) {
    const at = textOrNull(rawChange?.at);
    const status = textOrNull(rawChange?.status);
    if (at && status) changes.push({ at, status });
    else truncation.invalidFieldCount += 1;
  }
  truncation.affectedFieldValuesOmitted += Math.max(0, rawChanges.length - NVD_MAX_AFFECTED_CHANGES_PER_VERSION);
  return {
    version: textOrNull(rawVersion?.version),
    status: textOrNull(rawVersion?.status),
    versionType: textOrNull(rawVersion?.versionType),
    lessThan: textOrNull(rawVersion?.lessThan),
    lessThanOrEqual: textOrNull(rawVersion?.lessThanOrEqual),
    changes,
  };
}

function normalizeNvdAffectedProducts(value, truncation) {
  const products = [];
  for (const group of Array.isArray(value) ? value : []) {
    const source = textOrNull(group?.source);
    const affectedData = Array.isArray(group?.affectedData)
      ? group.affectedData
      : (group && typeof group === 'object' && (group.vendor || group.product || Array.isArray(group.versions)) ? [group] : []);
    if (affectedData.length === 0) truncation.invalidFieldCount += 1;
    for (const rawProduct of affectedData) {
      if (products.length >= NVD_MAX_AFFECTED_PRODUCTS_PER_CVE) {
        truncation.affectedProductsOmitted += 1;
        continue;
      }
      const rawVersions = Array.isArray(rawProduct?.versions) ? rawProduct.versions : [];
      truncation.affectedVersionsOmitted += Math.max(0, rawVersions.length - NVD_MAX_AFFECTED_VERSIONS_PER_PRODUCT);
      const cpes = [];
      for (const cpe of normalizeStringList(rawProduct?.cpes, NVD_MAX_AFFECTED_STRINGS_PER_FIELD, truncation)) {
        if (cpe.startsWith('cpe:')) cpes.push(cpe);
        else truncation.invalidFieldCount += 1;
      }
      products.push({
        source,
        vendor: textOrNull(rawProduct?.vendor),
        product: textOrNull(rawProduct?.product),
        collectionUrl: normalizeHttpUrl(rawProduct?.collectionURL),
        packageName: textOrNull(rawProduct?.packageName),
        defaultStatus: textOrNull(rawProduct?.defaultStatus),
        platforms: normalizeStringList(rawProduct?.platforms, NVD_MAX_AFFECTED_STRINGS_PER_FIELD, truncation),
        cpes,
        modules: normalizeStringList(rawProduct?.modules, NVD_MAX_AFFECTED_STRINGS_PER_FIELD, truncation),
        versions: rawVersions.slice(0, NVD_MAX_AFFECTED_VERSIONS_PER_PRODUCT).map((version) => normalizeNvdAffectedVersion(version, truncation)),
      });
    }
  }
  return products;
}

function normalizeNvdEvidence(cve, retrievedAt) {
  const id = normalizeCveId(cve?.id);
  if (!id || !validIsoDateTimeString(retrievedAt)) return null;
  const truncation = createNvdEvidenceTruncation();
  return {
    id,
    sourceIdentifier: textOrNull(cve?.sourceIdentifier),
    vulnStatus: textOrNull(cve?.vulnStatus),
    published: textOrNull(cve?.published),
    lastModified: textOrNull(cve?.lastModified),
    descriptions: normalizeNvdDescriptions(cve?.descriptions, truncation),
    metrics: normalizeNvdMetrics(cve?.metrics),
    weaknesses: normalizeNvdWeaknesses(cve?.weaknesses, truncation),
    references: normalizeNvdReferences(cve?.references, truncation),
    configurations: normalizeNvdConfigurations(cve?.configurations, truncation),
    affectedProducts: normalizeNvdAffectedProducts(cve?.affected, truncation),
    retrievedAt,
    truncation,
  };
}

function normalizeEpssEvidence(entry, retrievedAt) {
  const cve = normalizeCveId(entry?.cve);
  const score = Number(entry?.epss);
  const percentile = Number(entry?.percentile);
  const date = textOrNull(entry?.date);
  if (!cve || !Number.isFinite(score) || score < 0 || score > 1 || !Number.isFinite(percentile) || percentile < 0 || percentile > 1) return null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { cve, score, percentile, date, retrievedAt };
}

function buildNvdCveRequestUrl(cveIds) {
  const url = new URL(NVD_CVE_API_URL);
  url.searchParams.set('cveIds', cveIds.join(','));
  url.searchParams.set('resultsPerPage', String(cveIds.length));
  return url;
}

function buildEpssRequestUrl(cveIds) {
  const url = new URL(EPSS_API_URL);
  url.searchParams.set('cve', cveIds.join(','));
  url.searchParams.set('limit', String(cveIds.length));
  return url;
}

function chunkCveIds(values, maxCount, maxJoinedLength = null) {
  const chunks = [];
  let current = [];
  for (const cveId of values) {
    const nextJoinedLength = [...current, cveId].join(',').length;
    if (current.length > 0 && (current.length >= maxCount || (maxJoinedLength !== null && nextJoinedLength > maxJoinedLength))) {
      chunks.push(current);
      current = [];
    }
    current.push(cveId);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function cacheEntryIsFresh(entry, ttlMs, nowMs) {
  const retrievedMs = Date.parse(entry?.retrievedAt ?? '');
  return Number.isFinite(retrievedMs) && nowMs - retrievedMs >= 0 && nowMs - retrievedMs < ttlMs;
}

function isSafeHttpHeaderToken(value) {
  return typeof value === 'string' && value.length > 0 && [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 33 && code <= 126;
  });
}

const nvdRequestState = { lastRequestAt: 0 };
const epssRequestState = { lastRequestAt: 0 };

async function collectNvdEnrichment(cveIds, cache, priorByCve, meta) {
  const evidenceByCve = new Map();
  const uniqueIds = uniqueValidCveIds(cveIds);
  const nvdMeta = meta.nvd;
  nvdMeta.requestedCveCount = uniqueIds.length;
  const configuredApiKey = process.env.NVD_API_KEY?.trim();
  const apiKey = configuredApiKey && isSafeHttpHeaderToken(configuredApiKey) ? configuredApiKey : null;
  nvdMeta.apiKeyConfigured = Boolean(configuredApiKey);
  if (configuredApiKey && !apiKey) nvdMeta.statusDetail = 'NVD_API_KEY contains characters invalid for an HTTP header; key withheld from requests';
  if (uniqueIds.length === 0) return evidenceByCve;

  const nowMs = Date.now();
  const idsToFetch = [];
  for (const cveId of uniqueIds) {
    const entry = cache.nvd?.[cveId];
    if (cacheEntryIsFresh(entry, NVD_CACHE_TTL_MS, nowMs) && plausibleNvdEvidence(entry.evidence, cveId)) {
      evidenceByCve.set(cveId, entry.evidence);
      nvdMeta.freshCacheHitCount += 1;
    } else if (entry?.evidence === null && cacheEntryIsFresh(entry, NVD_NEGATIVE_CACHE_TTL_MS, nowMs)) {
      nvdMeta.negativeCacheHitCount += 1;
    } else {
      idsToFetch.push(cveId);
    }
  }

  const requestFailedIds = new Set();
  const invalidEvidenceIds = new Set();
  for (const chunk of chunkCveIds(idsToFetch, NVD_CVE_IDS_MAX_BATCH)) {
    const url = buildNvdCveRequestUrl(chunk);
    nvdMeta.requestUrls.push(url.toString());
    try {
      const { payload, retrievedAt } = await fetchJsonWithBoundedRetry(
        url,
        30000,
        apiKey ? { apiKey } : {},
        {
          minIntervalMs: NVD_MIN_REQUEST_INTERVAL_MS,
          maxAttempts: NVD_MAX_ATTEMPTS_PER_BATCH,
          retryFallbackDelayMs: NVD_RETRY_FALLBACK_DELAY_MS,
          maxRetryDelayMs: NVD_MAX_RETRY_DELAY_MS,
        },
        nvdMeta,
        nvdRequestState,
      );
      if (payload.version !== '2.0' || !Array.isArray(payload.vulnerabilities)) throw new Error('unexpected NVD CVE 2.0 response contract');
      if (Number.isFinite(payload.totalResults) && payload.totalResults > chunk.length) throw new Error(`unexpected NVD pagination contract: ${payload.totalResults} results for ${chunk.length} requested CVE IDs`);
      nvdMeta.retrievedAt = retrievedAt;
      const returnedIds = new Set();
      for (const wrapper of payload.vulnerabilities) {
        const evidence = normalizeNvdEvidence(wrapper?.cve, retrievedAt);
        if (!evidence || !chunk.includes(evidence.id)) {
          const invalidId = normalizeCveId(wrapper?.cve?.id);
          if (invalidId && chunk.includes(invalidId)) invalidEvidenceIds.add(invalidId);
          continue;
        }
        returnedIds.add(evidence.id);
        evidenceByCve.set(evidence.id, evidence);
        cache.nvd[evidence.id] = { retrievedAt, evidence };
        nvdMeta.fetchedCveCount += 1;
      }
      for (const cveId of chunk) {
        if (!returnedIds.has(cveId) && !invalidEvidenceIds.has(cveId)) cache.nvd[cveId] = { retrievedAt, evidence: null };
      }
    } catch (error) {
      for (const cveId of chunk) requestFailedIds.add(cveId);
      nvdMeta.statusDetail = error.message;
    }
  }

  for (const cveId of uniqueIds) {
    if (evidenceByCve.has(cveId) || !requestFailedIds.has(cveId)) continue;
    const staleEntry = cache.nvd?.[cveId];
    if (plausibleNvdEvidence(staleEntry?.evidence, cveId)) {
      evidenceByCve.set(cveId, staleEntry.evidence);
      nvdMeta.staleCacheHitCount += 1;
      continue;
    }
    const prior = priorByCve.get(cveId)?.nvd;
    if (plausibleNvdEvidence(prior, cveId)) {
      evidenceByCve.set(cveId, prior);
      nvdMeta.priorSnapshotHitCount += 1;
    }
  }

  for (const cveId of uniqueIds) {
    if (evidenceByCve.has(cveId)) continue;
    if (requestFailedIds.has(cveId)) nvdMeta.omittedByReason.requestFailed += 1;
    else if (invalidEvidenceIds.has(cveId)) nvdMeta.omittedByReason.invalidNvdRecord += 1;
    else nvdMeta.omittedByReason.missingNvdRecord += 1;
  }
  nvdMeta.omittedCveCount = Object.values(nvdMeta.omittedByReason).reduce((sum, value) => sum + value, 0);
  nvdMeta.enrichedCveCount = evidenceByCve.size;
  if (requestFailedIds.size > 0) nvdMeta.status = evidenceByCve.size > 0 ? 'partial' : 'unavailable';
  else nvdMeta.status = evidenceByCve.size === uniqueIds.length ? 'ok' : 'partial';
  return evidenceByCve;
}

async function collectEpssEnrichment(cveIds, cache, priorByCve, meta) {
  const evidenceByCve = new Map();
  const uniqueIds = uniqueValidCveIds(cveIds);
  const epssMeta = meta.epss;
  epssMeta.requestedCveCount = uniqueIds.length;
  if (uniqueIds.length === 0) return evidenceByCve;

  const nowMs = Date.now();
  const idsToFetch = [];
  for (const cveId of uniqueIds) {
    const entry = cache.epss?.[cveId];
    if (cacheEntryIsFresh(entry, EPSS_CACHE_TTL_MS, nowMs) && plausibleEpssEvidence(entry.evidence, cveId)) {
      evidenceByCve.set(cveId, entry.evidence);
      epssMeta.freshCacheHitCount += 1;
    } else if (entry?.evidence === null && cacheEntryIsFresh(entry, EPSS_NEGATIVE_CACHE_TTL_MS, nowMs)) {
      epssMeta.negativeCacheHitCount += 1;
    } else {
      idsToFetch.push(cveId);
    }
  }

  const requestFailedIds = new Set();
  const invalidEvidenceIds = new Set();
  for (const chunk of chunkCveIds(idsToFetch, EPSS_MAX_CVES_PER_BATCH, EPSS_CVE_PARAMETER_MAX_CHARS)) {
    const url = buildEpssRequestUrl(chunk);
    epssMeta.requestUrls.push(url.toString());
    try {
      const { payload, retrievedAt } = await fetchJsonWithBoundedRetry(
        url,
        24000,
        {},
        {
          minIntervalMs: EPSS_MIN_REQUEST_INTERVAL_MS,
          maxAttempts: EPSS_MAX_ATTEMPTS_PER_BATCH,
          retryFallbackDelayMs: EPSS_RETRY_FALLBACK_DELAY_MS,
          maxRetryDelayMs: EPSS_MAX_RETRY_DELAY_MS,
        },
        epssMeta,
        epssRequestState,
      );
      if (payload.status !== 'OK' || !Array.isArray(payload.data)) throw new Error('unexpected FIRST EPSS response contract');
      epssMeta.retrievedAt = retrievedAt;
      const returnedIds = new Set();
      for (const entry of payload.data) {
        const evidence = normalizeEpssEvidence(entry, retrievedAt);
        if (!evidence || !chunk.includes(evidence.cve)) {
          const invalidId = normalizeCveId(entry?.cve);
          if (invalidId && chunk.includes(invalidId)) invalidEvidenceIds.add(invalidId);
          continue;
        }
        returnedIds.add(evidence.cve);
        evidenceByCve.set(evidence.cve, evidence);
        cache.epss[evidence.cve] = { retrievedAt, evidence };
        epssMeta.fetchedCveCount += 1;
      }
      for (const cveId of chunk) {
        if (!returnedIds.has(cveId) && !invalidEvidenceIds.has(cveId)) cache.epss[cveId] = { retrievedAt, evidence: null };
      }
    } catch (error) {
      for (const cveId of chunk) requestFailedIds.add(cveId);
      epssMeta.statusDetail = error.message;
    }
  }

  for (const cveId of uniqueIds) {
    if (evidenceByCve.has(cveId) || !requestFailedIds.has(cveId)) continue;
    const staleEntry = cache.epss?.[cveId];
    if (plausibleEpssEvidence(staleEntry?.evidence, cveId)) {
      evidenceByCve.set(cveId, staleEntry.evidence);
      epssMeta.staleCacheHitCount += 1;
      continue;
    }
    const prior = priorByCve.get(cveId)?.epss;
    if (plausibleEpssEvidence(prior, cveId)) {
      evidenceByCve.set(cveId, prior);
      epssMeta.priorSnapshotHitCount += 1;
    }
  }

  for (const cveId of uniqueIds) {
    if (evidenceByCve.has(cveId)) continue;
    if (requestFailedIds.has(cveId)) epssMeta.omittedByReason.requestFailed += 1;
    else if (invalidEvidenceIds.has(cveId)) epssMeta.omittedByReason.invalidEpssRecord += 1;
    else epssMeta.omittedByReason.missingEpssRecord += 1;
  }
  epssMeta.omittedCveCount = Object.values(epssMeta.omittedByReason).reduce((sum, value) => sum + value, 0);
  epssMeta.enrichedCveCount = evidenceByCve.size;
  if (requestFailedIds.size > 0) epssMeta.status = evidenceByCve.size > 0 ? 'partial' : 'unavailable';
  else epssMeta.status = evidenceByCve.size === uniqueIds.length ? 'ok' : 'partial';
  return evidenceByCve;
}

function normalizeCyberRecordDefaults(item) {
  return {
    ...item,
    nvd: item?.nvd && typeof item.nvd === 'object' ? item.nvd : null,
    epss: item?.epss && typeof item.epss === 'object' ? item.epss : null,
  };
}

function buildPriorCyberEnrichmentMap(previousSnapshot) {
  const prior = new Map();
  for (const item of Array.isArray(previousSnapshot?.cyberVulnerabilities) ? previousSnapshot.cyberVulnerabilities : []) {
    const cveId = normalizeCveId(item?.cveId);
    if (!cveId) continue;
    prior.set(cveId, {
      nvd: plausibleNvdEvidence(item?.nvd, cveId) ? item.nvd : null,
      epss: plausibleEpssEvidence(item?.epss, cveId) ? item.epss : null,
    });
  }
  return prior;
}

function createPreservedCyberMeta(previousSnapshot, detail) {
  const priorMeta = previousSnapshot?.cyberVulnerabilityMeta && typeof previousSnapshot.cyberVulnerabilityMeta === 'object'
    ? previousSnapshot.cyberVulnerabilityMeta
    : null;
  const records = Array.isArray(previousSnapshot?.cyberVulnerabilities) ? previousSnapshot.cyberVulnerabilities.map(normalizeCyberRecordDefaults) : [];
  const meta = createCyberVulnerabilityMeta('preserved');
  if (priorMeta?.kev && typeof priorMeta.kev === 'object') meta.kev = { ...meta.kev, ...priorMeta.kev };
  if (priorMeta?.nvd && typeof priorMeta.nvd === 'object') meta.nvd = { ...meta.nvd, ...priorMeta.nvd };
  if (priorMeta?.epss && typeof priorMeta.epss === 'object') meta.epss = { ...meta.epss, ...priorMeta.epss };
  if (priorMeta?.cache && typeof priorMeta.cache === 'object') meta.cache = { ...meta.cache, ...priorMeta.cache, written: false };
  meta.cache.path = VULNERABILITY_CACHE_PATH;
  meta.cache.version = VULNERABILITY_CACHE_VERSION;
  meta.status = 'preserved';
  meta.statusDetail = detail;
  meta.preservedAt = new Date().toISOString();
  meta.kev.status = 'preserved';
  meta.kev.selectedRecordCount = records.length;
  meta.nvd.status = records.some((item) => item.nvd) ? 'preserved' : 'unavailable';
  meta.epss.status = records.some((item) => item.epss) ? 'preserved' : 'unavailable';
  meta.nvd.requestedCveCount = records.length;
  meta.nvd.enrichedCveCount = records.filter((item) => item.nvd).length;
  meta.nvd.omittedCveCount = records.length - meta.nvd.enrichedCveCount;
  meta.nvd.omittedByReason = createCyberNvdOmissionCounts();
  meta.nvd.omittedByReason.notAttempted = meta.nvd.omittedCveCount;
  meta.epss.requestedCveCount = records.length;
  meta.epss.enrichedCveCount = records.filter((item) => item.epss).length;
  meta.epss.omittedCveCount = records.length - meta.epss.enrichedCveCount;
  meta.epss.omittedByReason = createCyberEpssOmissionCounts();
  meta.epss.omittedByReason.notAttempted = meta.epss.omittedCveCount;
  return meta;
}

function finalizeCyberVulnerabilityMeta(meta) {
  const detailParts = [];
  if (meta.nvd.statusDetail) detailParts.push(`NVD: ${meta.nvd.statusDetail}`);
  if (meta.epss.statusDetail) detailParts.push(`EPSS: ${meta.epss.statusDetail}`);
  meta.statusDetail = detailParts.length > 0 ? detailParts.join('; ') : null;
  const degraded = ['partial', 'unavailable'].includes(meta.nvd.status) || ['partial', 'unavailable'].includes(meta.epss.status);
  meta.status = degraded ? 'partial' : 'ok';
}

async function collectCyberVulnerabilityIntelligence(previousSnapshot) {
  const meta = createCyberVulnerabilityMeta('unavailable');
  const cache = loadVulnerabilityCache(meta);
  const errors = [];
  const priorByCve = buildPriorCyberEnrichmentMap(previousSnapshot);

  try {
    const { payload, retrievedAt } = await getJsonWithMetadata(CISA_KEV_API_URL, 18000);
    if (!Array.isArray(payload.vulnerabilities)) throw new Error('unexpected CISA KEV response contract');
    meta.kev.status = 'ok';
    meta.kev.retrievedAt = retrievedAt;
    meta.kev.title = textOrNull(payload.title);
    meta.kev.catalogVersion = textOrNull(payload.catalogVersion);
    meta.kev.dateReleased = textOrNull(payload.dateReleased);
    meta.kev.reportedCount = Number.isInteger(payload.count) ? payload.count : 0;
    meta.kev.fetchedRecordCount = payload.vulnerabilities.length;

    const sorted = payload.vulnerabilities.slice().sort((a, b) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')));
    const seen = new Set();
    const selected = [];
    for (const item of sorted) {
      const cveId = normalizeCveId(item?.cveID);
      if (!cveId) {
        meta.kev.omittedByReason.invalidRecord += 1;
        continue;
      }
      meta.kev.validRecordCount += 1;
      if (seen.has(cveId)) {
        meta.kev.omittedByReason.duplicateCveId += 1;
        continue;
      }
      seen.add(cveId);
      if (selected.length >= CISA_KEV_MAX_RECORDS) {
        meta.kev.omittedByReason.selectionCap += 1;
        continue;
      }
      selected.push(normalizeCyberRecordDefaults({
        cveId,
        vendor: item.vendorProject || null,
        product: item.product || null,
        name: item.vulnerabilityName || null,
        dateAdded: item.dateAdded || null,
        dueDate: item.dueDate || null,
        ransomwareUse: item.knownRansomwareCampaignUse || null,
        requiredAction: item.requiredAction || null,
      }));
    }
    meta.kev.selectedRecordCount = selected.length;
    meta.kev.omittedRecordCount = Object.values(meta.kev.omittedByReason).reduce((sum, value) => sum + value, 0);
    if (selected.length === 0) throw new Error('CISA KEV response contained no valid unique CVE records');

    const cveIds = selected.map((item) => item.cveId);
    let nvdByCve = new Map();
    try {
      nvdByCve = await collectNvdEnrichment(cveIds, cache, priorByCve, meta);
    } catch (error) {
      const count = uniqueValidCveIds(cveIds).length;
      meta.nvd.status = 'unavailable';
      meta.nvd.statusDetail = `enrichment failure: ${error.message}`;
      meta.nvd.requestedCveCount = count;
      meta.nvd.enrichedCveCount = 0;
      meta.nvd.omittedCveCount = count;
      meta.nvd.omittedByReason = createCyberNvdOmissionCounts();
      meta.nvd.omittedByReason.requestFailed = count;
    }
    let epssByCve = new Map();
    try {
      epssByCve = await collectEpssEnrichment(cveIds, cache, priorByCve, meta);
    } catch (error) {
      const count = uniqueValidCveIds(cveIds).length;
      meta.epss.status = 'unavailable';
      meta.epss.statusDetail = `enrichment failure: ${error.message}`;
      meta.epss.requestedCveCount = count;
      meta.epss.enrichedCveCount = 0;
      meta.epss.omittedCveCount = count;
      meta.epss.omittedByReason = createCyberEpssOmissionCounts();
      meta.epss.omittedByReason.requestFailed = count;
    }
    const records = selected.map((item) => ({
      ...item,
      nvd: nvdByCve.get(item.cveId) ?? null,
      epss: epssByCve.get(item.cveId) ?? null,
    }));

    writeVulnerabilityCache(cache, meta);
    finalizeCyberVulnerabilityMeta(meta);
    for (const detail of [meta.nvd.statusDetail ? `NVD: ${meta.nvd.statusDetail}` : null, meta.epss.statusDetail ? `EPSS: ${meta.epss.statusDetail}` : null, meta.cache.status === 'write-failed' ? meta.cache.detail : null].filter(Boolean)) errors.push(detail);
    return {
      records,
      meta,
      errors,
      sourceDescription: `CISA KEV catalog ${meta.kev.catalogVersion || 'version unavailable'} + NVD CVE 2.0 (${meta.nvd.enrichedCveCount}/${meta.nvd.requestedCveCount} enriched) + FIRST EPSS (${meta.epss.enrichedCveCount}/${meta.epss.requestedCveCount} scored)`,
    };
  } catch (error) {
    const detail = `CISA KEV request failed: ${error.message}`;
    errors.push(`CISA KEV: ${error.message}`);
    const priorRecords = Array.isArray(previousSnapshot?.cyberVulnerabilities) ? previousSnapshot.cyberVulnerabilities.map(normalizeCyberRecordDefaults) : [];
    if (priorRecords.length > 0) {
      const preservedMeta = createPreservedCyberMeta(previousSnapshot, `${detail}; prior snapshot evidence retained without altering original retrieval timestamps`);
      writeVulnerabilityCache(cache, preservedMeta);
      return {
        records: priorRecords,
        meta: preservedMeta,
        errors,
        sourceDescription: `CISA KEV prior catalog preserved (${priorRecords.length} records); current ingest unavailable`,
      };
    }
    meta.statusDetail = detail;
    meta.cache.written = writeVulnerabilityCache(cache, meta);
    return {
      records: [],
      meta,
      errors,
      sourceDescription: 'CISA KEV collection unavailable',
    };
  }
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
const result = { fetchedAt: new Date().toISOString(), sources: {}, militaryAircraft: [], aircraft: [], vessels: [], satellites: [], news: [], launches: [], naturalEvents: [], gpsInterference: [], mapOfWarsEvents: [], webcams: [], cyberVulnerabilities: [], cyberVulnerabilityMeta: createCyberVulnerabilityMeta('unavailable'), internetOutages: [], internetOutageMeta: createIodaUnavailableMeta(iodaQueryWindow), ucdpMeta: createUcdpMeta('unconfigured'), gdeltGeoNews: [], gdeltGeoMeta: createGdeltGeoMeta('unavailable'), errors: [] };

markSource('natural-earth-vector', 'bundled', 'Pinned Natural Earth v5.1.2 reference points are bundled for coarse IODA placement');
try {
  const ioda = await collectIodaOutages(iodaQueryWindow);
  result.internetOutages = ioda.outages;
  result.internetOutageMeta = ioda.meta;
  result.sources.internetOutages = `IODA v2 outage events (country/region, explicit Unix-second window ${iodaQueryWindow.from}-${iodaQueryWindow.until}) + Natural Earth reference coordinates`;
  markSource('ioda-outages', 'fetched', null, { recordCount: result.internetOutages.length });
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
    markSource('ioda-outages', 'preserved', `Transient ingestion failure; prior snapshot retained. ${message}`, { recordCount: result.internetOutages.length, retrievedAt: previousSnapshot.fetchedAt ?? result.fetchedAt });
  } else {
    result.internetOutageMeta = {
      ...createIodaUnavailableMeta(iodaQueryWindow),
      statusDetail: message,
    };
    result.sources.internetOutages = 'IODA v2 outage events unavailable during build';
    markSource('ioda-outages', 'failed', message, { recordCount: 0 });
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
  markSource('adsb-lol-military', 'fetched', null, { recordCount: result.militaryAircraft.length });
} catch (error) {
  result.errors.push(`adsb.lol: ${error.message}`);
  markSource('adsb-lol-military', 'failed', error.message, { recordCount: 0 });
}


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
  markSource('opensky-network', 'fetched', null, { recordCount: result.aircraft.length });
} catch (error) {
  result.errors.push(`OpenSky: ${error.message}`);
  markSource('opensky-network', 'failed', error.message, { recordCount: 0 });
}


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
  markSource('digitraffic-ais', 'fetched', null, { recordCount: result.vessels.length });
} catch (error) {
  result.errors.push(`Digitraffic AIS: ${error.message}`);
  markSource('digitraffic-ais', 'failed', error.message, { recordCount: 0 });
}


if (process.env.AISSTREAM_API_KEY) {
  try {
    const streamVessels = await collectAisStreamVessels(process.env.AISSTREAM_API_KEY);
    if (streamVessels.length > 0) {
      const merged = new Map(result.vessels.map((vessel) => [String(vessel.mmsi), vessel]));
      for (const vessel of streamVessels) merged.set(String(vessel.mmsi), vessel);
      result.vessels = [...merged.values()].slice(0, 1600);
      result.sources.vessels = `AISStream global AIS + Fintraffic Digitraffic regional AIS (${streamVessels.length} streamed positions)`;
    }
    markSource('aisstream-global', streamVessels.length > 0 ? 'fetched' : 'unavailable', streamVessels.length > 0 ? null : 'bounded WebSocket sample returned no usable position reports', { recordCount: streamVessels.length });
  } catch (error) {
    result.errors.push(`AISStream: ${error.message}`);
    markSource('aisstream-global', 'failed', error.message, { recordCount: 0 });
  }
} else {
  result.errors.push('AISStream: AISSTREAM_API_KEY not configured; using keyless Digitraffic Baltic coverage only');
  markSource('aisstream-global', 'not-configured', 'AISSTREAM_API_KEY is not configured in the build-time environment', { recordCount: 0 });
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
  markSource('celestrak-gp', satellites.length > 0 ? 'partial' : 'failed', satellites.length > 0 ? 'one or more CelesTrak groups can fail; emitted rows are the bounded groups successfully parsed in this build' : 'no TLE group yielded usable rows', { recordCount: satellites.length });
} catch (error) {
  result.errors.push(`CelesTrak: ${error.message}`);
  markSource('celestrak-gp', 'failed', error.message, { recordCount: 0 });
}

try {
  const gdeltGeo = await collectGdeltGeoNews();
  result.gdeltGeoNews = gdeltGeo.mentions;
  result.gdeltGeoMeta = gdeltGeo.meta;
  result.sources.gdeltGeoNews = `GDELT GKG 2.1 fifteen-minute feeds (${gdeltGeo.meta.slotsIngested.length} slots) — geolocated conflict-news media mentions, not verified incidents`;
  markSource('gdelt-gkg', 'fetched', null, { recordCount: result.gdeltGeoNews.length });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`GDELT geo news: ${message}`);
  if (previousSnapshot.gdeltGeoMeta && Array.isArray(previousSnapshot.gdeltGeoNews) && previousSnapshot.gdeltGeoNews.length > 0) {
    result.gdeltGeoNews = previousSnapshot.gdeltGeoNews;
    result.gdeltGeoMeta = {
      ...previousSnapshot.gdeltGeoMeta,
      status: 'preserved',
      preservedAt: result.fetchedAt,
      statusDetail: `Transient GDELT ingestion failure; prior snapshot retained. ${message}`,
    };
    result.sources.gdeltGeoNews = 'GDELT GKG 2.1 feeds (prior build-time snapshot preserved after transient ingestion failure)';
    result.errors.push('gdeltGeoNews: transient failure; preserved previous snapshot');
    markSource('gdelt-gkg', 'preserved', `Transient ingestion failure; prior snapshot retained. ${message}`, { recordCount: result.gdeltGeoNews.length, retrievedAt: previousSnapshot.fetchedAt ?? result.fetchedAt });
  } else {
    result.gdeltGeoMeta = { ...createGdeltGeoMeta('unavailable'), statusDetail: message };
    result.sources.gdeltGeoNews = 'GDELT GKG 2.1 geolocated news unavailable during build';
    markSource('gdelt-gkg', 'failed', message, { recordCount: 0 });
  }
}

try {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', '(war OR conflict OR airstrike OR missile OR military)');
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', '30');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'hybridrel');
  await throttleGdeltDocApi();
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


const cyberIntelligence = await collectCyberVulnerabilityIntelligence(previousSnapshot);
result.cyberVulnerabilities = cyberIntelligence.records;
result.cyberVulnerabilityMeta = cyberIntelligence.meta;
result.sources.cyberVulnerabilities = cyberIntelligence.sourceDescription;
for (const error of cyberIntelligence.errors) result.errors.push(error);

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

function validateIsoDateTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateNullableIsoDateTime(value) {
  return value === null || validateIsoDateTime(value);
}

function validateCyberServiceStatus(value) {
  return ['ok', 'partial', 'preserved', 'unavailable', 'not-attempted'].includes(value);
}

function validateNvdConfigurationNode(node, label, errors, depth = 0) {
  if (depth > 12) {
    errors.push(`${label} configuration tree exceeds bounded depth`);
    return;
  }
  if (!validateNullableString(node.operator) || !(node.negate === null || typeof node.negate === 'boolean')) errors.push(`${label} invalid configuration operator/negate contract`);
  if (!Array.isArray(node.cpeMatch) || !Array.isArray(node.nodes)) {
    errors.push(`${label} invalid configuration node arrays`);
    return;
  }
  for (const match of node.cpeMatch) {
    if (typeof match?.criteria !== 'string' || !match.criteria.startsWith('cpe:2.3:')) errors.push(`${label} invalid CPE criteria`);
    if (!(match?.vulnerable === null || typeof match?.vulnerable === 'boolean')) errors.push(`${label} invalid CPE vulnerable flag`);
    for (const key of ['matchCriteriaId', 'versionStartIncluding', 'versionStartExcluding', 'versionEndIncluding', 'versionEndExcluding']) {
      if (!validateNullableString(match?.[key])) errors.push(`${label} invalid CPE ${key}`);
    }
  }
  node.nodes.forEach((child) => validateNvdConfigurationNode(child, label, errors, depth + 1));
}

function validateNvdEvidence(nvd, cveId, label, errors) {
  if (!nvd || typeof nvd !== 'object') {
    errors.push(`${label} invalid NVD evidence object`);
    return;
  }
  if (nvd.id !== cveId) errors.push(`${label} NVD evidence/CVE id mismatch`);
  for (const key of ['sourceIdentifier', 'vulnStatus']) {
    if (!validateNullableString(nvd[key])) errors.push(`${label} invalid NVD ${key}`);
  }
  if (!validateNullableIsoDateTime(nvd.published) || !validateNullableIsoDateTime(nvd.lastModified)) errors.push(`${label} invalid NVD publication chronology`);
  if (!validateIsoDateTime(nvd.retrievedAt)) errors.push(`${label} missing NVD retrieval timestamp`);
  for (const key of ['descriptions', 'metrics', 'weaknesses', 'references', 'configurations', 'affectedProducts']) {
    if (!Array.isArray(nvd[key])) errors.push(`${label} missing NVD ${key} array`);
  }
  if ((nvd.descriptions ?? []).length > NVD_MAX_DESCRIPTIONS_PER_CVE) errors.push(`${label} exceeds bounded NVD description cap`);
  for (const description of nvd.descriptions ?? []) {
    if (typeof description?.lang !== 'string' || typeof description?.value !== 'string' || description.value.length === 0) errors.push(`${label} invalid NVD description contract`);
  }
  for (const metric of nvd.metrics ?? []) {
    if (!['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30', 'cvssMetricV2'].includes(metric?.metricSet)) errors.push(`${label} invalid CVSS metric-set provenance`);
    for (const key of ['source', 'type', 'vectorString', 'baseSeverity']) {
      if (!validateNullableString(metric?.[key])) errors.push(`${label} invalid CVSS ${key}`);
    }
    for (const key of ['baseScore', 'exploitabilityScore', 'impactScore']) {
      if (!(metric?.[key] === null || (Number.isFinite(metric[key]) && metric[key] >= 0 && metric[key] <= 10))) errors.push(`${label} invalid CVSS ${key}`);
    }
  }
  for (const weakness of nvd.weaknesses ?? []) {
    if (!/^CWE-\d+$/.test(weakness?.id ?? '') || !validateNullableString(weakness?.source) || !validateNullableString(weakness?.type)) errors.push(`${label} invalid CWE weakness contract`);
  }
  if ((nvd.references ?? []).length > NVD_MAX_REFERENCES_PER_CVE) errors.push(`${label} exceeds bounded NVD reference cap`);
  for (const reference of nvd.references ?? []) {
    if (!/^https?:\/\//.test(reference?.url ?? '') || !validateNullableString(reference?.source) || !Array.isArray(reference?.tags) || reference.tags.length > NVD_MAX_REFERENCE_TAGS_PER_REFERENCE || reference.tags.some((tag) => typeof tag !== 'string')) errors.push(`${label} invalid NVD reference contract`);
  }
  if ((nvd.configurations ?? []).length > NVD_MAX_CONFIGURATIONS_PER_CVE) errors.push(`${label} exceeds bounded NVD configuration cap`);
  for (const configuration of nvd.configurations ?? []) {
    if (!validateNullableString(configuration?.operator) || !Array.isArray(configuration?.nodes)) errors.push(`${label} invalid NVD configuration contract`);
    else configuration.nodes.forEach((node) => validateNvdConfigurationNode(node, label, errors));
  }
  if ((nvd.affectedProducts ?? []).length > NVD_MAX_AFFECTED_PRODUCTS_PER_CVE) errors.push(`${label} exceeds bounded affected-product cap`);
  for (const product of nvd.affectedProducts ?? []) {
    for (const key of ['source', 'vendor', 'product', 'collectionUrl', 'packageName', 'defaultStatus']) {
      if (!validateNullableString(product?.[key])) errors.push(`${label} invalid affected-product ${key}`);
    }
    for (const key of ['platforms', 'cpes', 'modules', 'versions']) {
      if (!Array.isArray(product?.[key])) errors.push(`${label} invalid affected-product ${key} array`);
    }
    if ((product?.cpes ?? []).some((cpe) => typeof cpe !== 'string' || !cpe.startsWith('cpe:'))) errors.push(`${label} invalid affected-product CPE`);
    for (const version of product?.versions ?? []) {
      for (const key of ['version', 'status', 'versionType', 'lessThan', 'lessThanOrEqual']) {
        if (!validateNullableString(version?.[key])) errors.push(`${label} invalid affected-version ${key}`);
      }
      if (!Array.isArray(version?.changes) || version.changes.some((change) => typeof change?.at !== 'string' || typeof change?.status !== 'string')) errors.push(`${label} invalid affected-version changes`);
    }
  }
  const truncation = nvd.truncation;
  if (!truncation || typeof truncation !== 'object') {
    errors.push(`${label} missing NVD truncation accounting`);
  } else {
    for (const key of ['descriptionsOmitted', 'referencesOmitted', 'referenceTagsOmitted', 'configurationsOmitted', 'cpeMatchesOmitted', 'affectedProductsOmitted', 'affectedVersionsOmitted', 'affectedFieldValuesOmitted', 'nonCweWeaknessValuesOmitted', 'invalidFieldCount']) {
      if (!validateNonNegativeInteger(truncation[key])) errors.push(`${label} invalid NVD truncation ${key}`);
    }
  }
}

function validateEpssEvidence(epss, cveId, label, errors) {
  if (!epss || typeof epss !== 'object') {
    errors.push(`${label} invalid EPSS evidence object`);
    return;
  }
  if (epss.cve !== cveId) errors.push(`${label} EPSS evidence/CVE id mismatch`);
  if (!Number.isFinite(epss.score) || epss.score < 0 || epss.score > 1) errors.push(`${label} invalid EPSS score`);
  if (!Number.isFinite(epss.percentile) || epss.percentile < 0 || epss.percentile > 1) errors.push(`${label} invalid EPSS percentile`);
  if (!(epss.date === null || validateIsoDateOnly(epss.date))) errors.push(`${label} invalid EPSS score date`);
  if (!validateIsoDateTime(epss.retrievedAt)) errors.push(`${label} missing EPSS retrieval timestamp`);
}

function validateCyberVulnerabilityRecord(item, errors) {
  const label = `cyberVulnerabilities:${item?.cveId || 'unknown'}`;
  if (!normalizeCveId(item?.cveId)) errors.push(`${label} invalid CVE identifier`);
  for (const key of ['vendor', 'product', 'name', 'dateAdded', 'dueDate', 'ransomwareUse', 'requiredAction']) {
    if (!validateNullableString(item?.[key])) errors.push(`${label} invalid KEV ${key}`);
  }
  if (item?.dateAdded !== null && item?.dateAdded !== undefined && !validateIsoDateOnly(item.dateAdded)) errors.push(`${label} invalid KEV dateAdded`);
  if (item?.dueDate !== null && item?.dueDate !== undefined && !validateIsoDateOnly(item.dueDate)) errors.push(`${label} invalid KEV dueDate`);
  if (!(item?.nvd === null || (item?.nvd && typeof item.nvd === 'object'))) errors.push(`${label} NVD evidence must be an object or explicit null`);
  else if (item.nvd) validateNvdEvidence(item.nvd, item.cveId, label, errors);
  if (!(item?.epss === null || (item?.epss && typeof item.epss === 'object'))) errors.push(`${label} EPSS evidence must be an object or explicit null`);
  else if (item.epss) validateEpssEvidence(item.epss, item.cveId, label, errors);
}

function validateCyberRateLimitCounters(meta, label, errors) {
  for (const key of ['requestAttemptCount', 'successfulRequestCount', 'retryCount', 'throttledResponseCount', 'retryDelayMsTotal', 'retryDelayMsMax']) {
    if (!validateNonNegativeInteger(meta[key])) errors.push(`${label} invalid rate-limit counter ${key}`);
  }
  if (meta.successfulRequestCount > meta.requestAttemptCount) errors.push(`${label} successful requests exceed attempts`);
  if (meta.throttledResponseCount > meta.requestAttemptCount) errors.push(`${label} throttled responses exceed attempts`);
  if (meta.retryDelayMsMax > meta.retryDelayMsTotal) errors.push(`${label} maximum retry delay exceeds total`);
}

function validateCyberVulnerabilityMeta(snapshot, errors) {
  const meta = snapshot.cyberVulnerabilityMeta;
  if (!meta || typeof meta !== 'object') {
    errors.push('cyberVulnerabilityMeta missing or not an object');
    return;
  }
  if (!['ok', 'partial', 'preserved', 'unavailable'].includes(meta.status)) errors.push('cyberVulnerabilityMeta invalid status');
  if (!validateCyberServiceStatus(meta.kev?.status) || !validateCyberServiceStatus(meta.nvd?.status) || !validateCyberServiceStatus(meta.epss?.status)) errors.push('cyberVulnerabilityMeta invalid service status');
  if (!validateNullableIsoDateTime(meta.preservedAt) && meta.preservedAt !== null) errors.push('cyberVulnerabilityMeta invalid preservedAt');
  if (!String(meta.selection || '').includes('NVD CVE 2.0') || !String(meta.caveat || '').includes('not observed exploitation evidence')) errors.push('cyberVulnerabilityMeta missing selection/caveat provenance');

  const kev = meta.kev;
  if (!kev || typeof kev !== 'object') {
    errors.push('cyberVulnerabilityMeta missing KEV provenance');
  } else {
    if (kev.apiUrl !== CISA_KEV_API_URL || kev.requestUrl !== CISA_KEV_API_URL) errors.push('cyberVulnerabilityMeta invalid KEV endpoint provenance');
    if (!validateNullableIsoDateTime(kev.retrievedAt) && kev.retrievedAt !== null) errors.push('cyberVulnerabilityMeta invalid KEV retrieval timestamp');
    for (const key of ['title', 'catalogVersion', 'dateReleased']) {
      if (!validateNullableString(kev[key])) errors.push(`cyberVulnerabilityMeta invalid KEV ${key}`);
    }
    for (const key of ['reportedCount', 'fetchedRecordCount', 'validRecordCount', 'selectedRecordCount', 'maxSelectedRecords', 'omittedRecordCount']) {
      if (!validateNonNegativeInteger(kev[key])) errors.push(`cyberVulnerabilityMeta invalid KEV ${key}`);
    }
    if (kev.maxSelectedRecords !== CISA_KEV_MAX_RECORDS) errors.push('cyberVulnerabilityMeta invalid KEV selection cap');
    if (kev.selectedRecordCount !== (snapshot.cyberVulnerabilities ?? []).length) errors.push('cyberVulnerabilityMeta KEV selected count does not match snapshot records');
    if (kev.status === 'ok') {
      if (kev.reportedCount !== kev.fetchedRecordCount) errors.push('cyberVulnerabilityMeta KEV reported/fetched count mismatch');
      if (kev.fetchedRecordCount !== kev.validRecordCount + (kev.omittedByReason?.invalidRecord ?? -1)) errors.push('cyberVulnerabilityMeta KEV validity accounting mismatch');
      if (kev.validRecordCount !== kev.selectedRecordCount + (kev.omittedByReason?.duplicateCveId ?? -1) + (kev.omittedByReason?.selectionCap ?? -1)) errors.push('cyberVulnerabilityMeta KEV selection accounting mismatch');
    }
    if (!kev.omittedByReason || typeof kev.omittedByReason !== 'object') errors.push('cyberVulnerabilityMeta missing KEV omission accounting');
    else {
      for (const key of ['invalidRecord', 'duplicateCveId', 'selectionCap']) {
        if (!validateNonNegativeInteger(kev.omittedByReason[key])) errors.push(`cyberVulnerabilityMeta invalid KEV omission ${key}`);
      }
      if (Object.values(kev.omittedByReason).every(validateNonNegativeInteger) && kev.omittedRecordCount !== Object.values(kev.omittedByReason).reduce((sum, value) => sum + value, 0)) errors.push('cyberVulnerabilityMeta KEV omitted count does not equal reasons');
    }
  }

  const nvd = meta.nvd;
  if (!nvd || typeof nvd !== 'object') {
    errors.push('cyberVulnerabilityMeta missing NVD provenance');
  } else {
    if (nvd.apiBaseUrl !== NVD_CVE_API_URL || nvd.apiVersion !== '2.0' || nvd.batchParameter !== 'cveIds') errors.push('cyberVulnerabilityMeta invalid NVD endpoint/version provenance');
    if (typeof nvd.apiKeyConfigured !== 'boolean') errors.push('cyberVulnerabilityMeta invalid NVD apiKeyConfigured provenance');
    if (nvd.maxBatchSize > NVD_CVE_IDS_MAX_BATCH || nvd.maxConcurrency !== 1 || nvd.configuredMinRequestIntervalMs < 6000) errors.push('cyberVulnerabilityMeta violates bounded NVD rate-limit policy');
    for (const key of ['requestedCveCount', 'fetchedCveCount', 'freshCacheHitCount', 'negativeCacheHitCount', 'staleCacheHitCount', 'priorSnapshotHitCount', 'enrichedCveCount', 'omittedCveCount', 'maxBatchSize', 'maxAttemptsPerBatch', 'retryFallbackDelayMs', 'maxRetryDelayMs', 'cacheTtlMs', 'negativeCacheTtlMs', 'configuredMinRequestIntervalMs', 'documentedPublicRequestsPerRolling30Seconds', 'documentedAuthenticatedRequestsPerRolling30Seconds']) {
      if (!validateNonNegativeInteger(nvd[key])) errors.push(`cyberVulnerabilityMeta invalid NVD ${key}`);
    }
    validateCyberRateLimitCounters(nvd, 'cyberVulnerabilityMeta NVD', errors);
    if (!validateNullableIsoDateTime(nvd.retrievedAt) && nvd.retrievedAt !== null) errors.push('cyberVulnerabilityMeta invalid NVD retrieval timestamp');
    if (!Array.isArray(nvd.requestUrls)) errors.push('cyberVulnerabilityMeta missing NVD request URLs');
    else for (const url of nvd.requestUrls) {
      if (!url.startsWith(`${NVD_CVE_API_URL}?`) || !url.includes('cveIds=') || url.toLowerCase().includes('apikey')) errors.push('cyberVulnerabilityMeta invalid or secret-bearing NVD request URL');
    }
    if (!nvd.omittedByReason || typeof nvd.omittedByReason !== 'object') errors.push('cyberVulnerabilityMeta missing NVD omission accounting');
    else {
      for (const key of ['missingNvdRecord', 'invalidNvdRecord', 'requestFailed', 'notAttempted']) {
        if (!validateNonNegativeInteger(nvd.omittedByReason[key])) errors.push(`cyberVulnerabilityMeta invalid NVD omission ${key}`);
      }
      if (Object.values(nvd.omittedByReason).every(validateNonNegativeInteger) && nvd.omittedCveCount !== Object.values(nvd.omittedByReason).reduce((sum, value) => sum + value, 0)) errors.push('cyberVulnerabilityMeta NVD omitted count does not equal reasons');
    }
    if (nvd.enrichedCveCount + nvd.omittedCveCount !== nvd.requestedCveCount) errors.push('cyberVulnerabilityMeta NVD coverage accounting mismatch');
    if (nvd.enrichedCveCount !== (snapshot.cyberVulnerabilities ?? []).filter((item) => item.nvd).length) errors.push('cyberVulnerabilityMeta NVD enriched count does not match records');
  }

  const epss = meta.epss;
  if (!epss || typeof epss !== 'object') {
    errors.push('cyberVulnerabilityMeta missing EPSS provenance');
  } else {
    if (epss.apiBaseUrl !== EPSS_API_URL || epss.scope !== 'public') errors.push('cyberVulnerabilityMeta invalid EPSS endpoint/scope provenance');
    if (epss.maxConcurrency !== 1 || epss.configuredMinRequestIntervalMs < 500 || epss.maxCveParameterChars > EPSS_CVE_PARAMETER_MAX_CHARS) errors.push('cyberVulnerabilityMeta violates bounded EPSS rate-limit policy');
    for (const key of ['requestedCveCount', 'fetchedCveCount', 'freshCacheHitCount', 'negativeCacheHitCount', 'staleCacheHitCount', 'priorSnapshotHitCount', 'enrichedCveCount', 'omittedCveCount', 'maxCveParameterChars', 'maxCvesPerBatch', 'maxAttemptsPerBatch', 'retryFallbackDelayMs', 'maxRetryDelayMs', 'cacheTtlMs', 'negativeCacheTtlMs', 'configuredMinRequestIntervalMs']) {
      if (!validateNonNegativeInteger(epss[key])) errors.push(`cyberVulnerabilityMeta invalid EPSS ${key}`);
    }
    validateCyberRateLimitCounters(epss, 'cyberVulnerabilityMeta EPSS', errors);
    if (!validateNullableIsoDateTime(epss.retrievedAt) && epss.retrievedAt !== null) errors.push('cyberVulnerabilityMeta invalid EPSS retrieval timestamp');
    if (!Array.isArray(epss.requestUrls)) errors.push('cyberVulnerabilityMeta missing EPSS request URLs');
    else for (const url of epss.requestUrls) {
      if (!url.startsWith(`${EPSS_API_URL}?`) || !url.includes('cve=')) errors.push('cyberVulnerabilityMeta invalid EPSS request URL');
    }
    if (!epss.omittedByReason || typeof epss.omittedByReason !== 'object') errors.push('cyberVulnerabilityMeta missing EPSS omission accounting');
    else {
      for (const key of ['missingEpssRecord', 'invalidEpssRecord', 'requestFailed', 'notAttempted']) {
        if (!validateNonNegativeInteger(epss.omittedByReason[key])) errors.push(`cyberVulnerabilityMeta invalid EPSS omission ${key}`);
      }
      if (Object.values(epss.omittedByReason).every(validateNonNegativeInteger) && epss.omittedCveCount !== Object.values(epss.omittedByReason).reduce((sum, value) => sum + value, 0)) errors.push('cyberVulnerabilityMeta EPSS omitted count does not equal reasons');
    }
    if (epss.enrichedCveCount + epss.omittedCveCount !== epss.requestedCveCount) errors.push('cyberVulnerabilityMeta EPSS coverage accounting mismatch');
    if (epss.enrichedCveCount !== (snapshot.cyberVulnerabilities ?? []).filter((item) => item.epss).length) errors.push('cyberVulnerabilityMeta EPSS enriched count does not match records');
  }

  const cache = meta.cache;
  if (!cache || typeof cache !== 'object') {
    errors.push('cyberVulnerabilityMeta missing cache provenance');
  } else {
    if (!['ok', 'empty', 'unavailable', 'write-failed'].includes(cache.status)) errors.push('cyberVulnerabilityMeta invalid cache status');
    if (cache.path !== VULNERABILITY_CACHE_PATH || cache.version !== VULNERABILITY_CACHE_VERSION) errors.push('cyberVulnerabilityMeta invalid cache path/version');
    if (typeof cache.loaded !== 'boolean' || typeof cache.written !== 'boolean') errors.push('cyberVulnerabilityMeta invalid cache booleans');
    if (!validateNullableString(cache.detail)) errors.push('cyberVulnerabilityMeta invalid cache detail');
  }
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

function validateGdeltGeoMentionRecord(item, label, errors) {
  if (typeof item.id !== 'string' || !/^gdeltgeo:[0-9a-f]{20}$/.test(item.id)) errors.push(`${label} invalid canonical id`);
  if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) errors.push(`${label} invalid article url`);
  if (item.title !== null && typeof item.title !== 'string') errors.push(`${label} invalid title nullability`);
  if (typeof item.domain !== 'string' || item.domain.length === 0) errors.push(`${label} missing source domain`);
  if (!['english-web', 'machine-translated'].includes(item.collection)) errors.push(`${label} invalid collection`);
  if (typeof item.locationName !== 'string' || item.locationName.length === 0) errors.push(`${label} missing location name`);
  if (!Number.isInteger(item.locationType) || !GDELT_LOCATION_PRECISION_BY_TYPE[item.locationType]) errors.push(`${label} invalid location type`);
  else if (GDELT_LOCATION_PRECISION_BY_TYPE[item.locationType].precision !== item.coordinatePrecision) errors.push(`${label} coordinate precision/type mismatch`);
  if (!validCoordinatePair(item.lat, item.lng)) errors.push(`${label} invalid coordinate`);
  if (item.countryCode !== null && typeof item.countryCode !== 'string') errors.push(`${label} invalid country code nullability`);
  if (item.adm1Code !== null && typeof item.adm1Code !== 'string') errors.push(`${label} invalid adm1 code nullability`);
  if (item.featureId !== null && typeof item.featureId !== 'string' && typeof item.featureId !== 'number') errors.push(`${label} invalid gazetteer feature id`);
  if (!Number.isInteger(item.proximityChars) || item.proximityChars < 0 || item.proximityChars > GDELT_PROXIMITY_CHARS) errors.push(`${label} invalid proximity window`);
  if (!Array.isArray(item.themes) || item.themes.length === 0 || !item.themes.every((theme) => GDELT_CONFLICT_THEME_SET.has(theme))) errors.push(`${label} invalid conflict theme contract`);
  if (item.tone !== null && (typeof item.tone !== 'number' || !Number.isFinite(item.tone) || item.tone < -100 || item.tone > 100)) errors.push(`${label} invalid tone`);
  for (const key of ['positiveScore', 'negativeScore']) {
    if (item[key] !== null && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0 || item[key] > 100)) errors.push(`${label} invalid ${key}`);
  }
  if (item.wordCount !== null && (!Number.isInteger(item.wordCount) || item.wordCount < 0)) errors.push(`${label} invalid word count`);
  if (item.sharingImage !== null && (typeof item.sharingImage !== 'string' || !/^https?:\/\//i.test(item.sharingImage))) errors.push(`${label} invalid sharing image`);
  if (typeof item.slotTime !== 'string' || Number.isNaN(Date.parse(item.slotTime))) errors.push(`${label} invalid slot time`);
  if (item.seenAt !== null && (typeof item.seenAt !== 'string' || Number.isNaN(Date.parse(item.seenAt)))) errors.push(`${label} invalid seen-at timestamp`);
}

function validateGdeltGeoMeta(snapshot, errors) {
  const meta = snapshot.gdeltGeoMeta;
  if (!meta || typeof meta !== 'object') {
    errors.push('gdeltGeoMeta missing or not an object');
    return;
  }
  if (!['ok', 'preserved', 'unavailable'].includes(meta.status)) errors.push('gdeltGeoMeta invalid status');
  if (!String(meta.attribution || '').includes('gdeltproject.org')) errors.push('gdeltGeoMeta missing required GDELT citation');
  if (!String(meta.geoApiNote || '').includes('404')) errors.push('gdeltGeoMeta missing honest GEO API retirement note');
  if (!Array.isArray(meta.conflictThemes) || meta.conflictThemes.join(',') !== GDELT_CONFLICT_THEMES.join(',')) errors.push('gdeltGeoMeta conflict theme list mismatch');
  if (![meta.proximityChars, meta.slotsPerCollection, meta.maxSlotAttempts, meta.maxMentions].every(validateNonNegativeInteger)) errors.push('gdeltGeoMeta invalid numeric configuration');
  if (meta.proximityChars !== GDELT_PROXIMITY_CHARS) errors.push('gdeltGeoMeta proximity mismatch with implementation');
  const countKeys = ['failedSlotDownloadCount', 'rowsScanned', 'invalidRowCount', 'conflictThemeRowCount', 'countryLevelMentionCount', 'subnationalMentionCount', 'proximalMentionCount', 'uniqueMentionCount', 'ingestedMentionCount', 'uniqueArticleCount', 'uniqueLocationCount', 'titleEnrichedArticleCount', 'omittedMentionCount'];
  for (const key of countKeys) {
    if (!validateNonNegativeInteger(meta[key])) errors.push(`gdeltGeoMeta invalid ${key}`);
  }
  const reasons = meta.omittedByReason;
  if (!reasons || typeof reasons !== 'object') {
    errors.push('gdeltGeoMeta omission reasons missing');
  } else {
    for (const key of ['invalidCoordinates', 'notProximalToConflictTheme', 'duplicateMention', 'selectionCap']) {
      if (!validateNonNegativeInteger(reasons[key])) errors.push(`gdeltGeoMeta invalid omission reason ${key}`);
    }
    if (Object.values(reasons).every(validateNonNegativeInteger) && meta.omittedMentionCount !== Object.values(reasons).reduce((sum, value) => sum + value, 0)) errors.push('gdeltGeoMeta omittedMentionCount does not equal omission reasons');
  }
  if (!Array.isArray(meta.slotsIngested)) {
    errors.push('gdeltGeoMeta slotsIngested missing or not an array');
  } else {
    for (const slot of meta.slotsIngested) {
      if (!['english-web', 'machine-translated'].includes(slot?.collection) || typeof slot?.url !== 'string' || !/^\d{14}$/.test(slot?.slotTimestamp ?? '') || !validateNonNegativeInteger(slot?.rowCount)) errors.push('gdeltGeoMeta invalid ingested-slot provenance');
    }
  }
  if (!Array.isArray(meta.requestUrls)) errors.push('gdeltGeoMeta requestUrls missing or not an array');
  if (typeof meta.caveat !== 'string' || !meta.caveat.includes('not verified incident locations')) errors.push('gdeltGeoMeta missing media-attention caveat');
  if (typeof meta.selection !== 'string' || !meta.selection.includes('deduplicates')) errors.push('gdeltGeoMeta missing selection description');
  const enrichment = meta.titleEnrichment;
  if (!enrichment || typeof enrichment !== 'object') {
    errors.push('gdeltGeoMeta titleEnrichment missing');
  } else {
    if (!['ok', 'unavailable'].includes(enrichment.status)) errors.push('gdeltGeoMeta titleEnrichment invalid status');
    for (const key of ['fetchedArticleCount', 'matchedArticleCount']) {
      if (!validateNonNegativeInteger(enrichment[key])) errors.push(`gdeltGeoMeta titleEnrichment invalid ${key}`);
    }
  }
  if (meta.status === 'ok' && Object.values(reasons ?? {}).every(validateNonNegativeInteger) && countKeys.every((key) => validateNonNegativeInteger(meta[key]))) {
    if (meta.ingestedMentionCount !== (snapshot.gdeltGeoNews ?? []).length) errors.push('gdeltGeoMeta ingestedMentionCount does not match snapshot records');
    if (meta.subnationalMentionCount !== meta.proximalMentionCount + reasons.notProximalToConflictTheme) errors.push('gdeltGeoMeta proximity accounting mismatch');
    if (meta.proximalMentionCount !== meta.uniqueMentionCount + reasons.duplicateMention) errors.push('gdeltGeoMeta dedupe accounting mismatch');
    if (meta.uniqueMentionCount !== meta.ingestedMentionCount + reasons.selectionCap) errors.push('gdeltGeoMeta selection-cap accounting mismatch');
    if (meta.uniqueArticleCount > meta.ingestedMentionCount) errors.push('gdeltGeoMeta uniqueArticleCount exceeds ingested mentions');
    if (meta.titleEnrichedArticleCount > meta.uniqueArticleCount) errors.push('gdeltGeoMeta title-enriched count exceeds unique articles');
    if (meta.slotsIngested.length === 0 && meta.rowsScanned > 0) errors.push('gdeltGeoMeta rows scanned without slot provenance');
    if (meta.rowsScanned > 0 && meta.slotsIngested.reduce((sum, slot) => sum + slot.rowCount, 0) !== meta.rowsScanned) errors.push('gdeltGeoMeta row accounting does not match slot provenance');
  }
}

function validateSnapshot(snapshot) {
  const errors = [];
  for (const key of ['militaryAircraft', 'aircraft', 'vessels', 'satellites', 'news', 'launches', 'naturalEvents', 'gpsInterference', 'mapOfWarsEvents', 'webcams', 'cyberVulnerabilities', 'internetOutages', 'gdeltGeoNews']) {
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
  for (const item of snapshot.cyberVulnerabilities ?? []) validateCyberVulnerabilityRecord(item, errors);
  validateCyberVulnerabilityMeta(snapshot, errors);
  const gdeltMentionKeys = new Set();
  const gdeltArticleLocationKeys = new Set();
  for (const item of snapshot.gdeltGeoNews ?? []) {
    const label = `gdeltGeoNews:${item.id || 'unknown'}`;
    validateGdeltGeoMentionRecord(item, label, errors);
    if (typeof item.id === 'string') {
      if (gdeltMentionKeys.has(item.id)) errors.push(`${label} duplicate mention id`);
      gdeltMentionKeys.add(item.id);
    }
    if (typeof item.url === 'string' && typeof item.locationName === 'string') {
      const articleLocationKey = `${normalizeGdeltArticleUrl(item.url)}|${item.locationType}:${item.featureId ?? 'unknown'}:${item.lat.toFixed(3)}:${item.lng.toFixed(3)}`;
      if (gdeltArticleLocationKeys.has(articleLocationKey)) errors.push(`${label} duplicate article-location mention`);
      gdeltArticleLocationKeys.add(articleLocationKey);
    }
  }
  validateGdeltGeoMeta(snapshot, errors);
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

for (const key of ['militaryAircraft', 'aircraft', 'vessels', 'satellites', 'news', 'launches', 'naturalEvents', 'gpsInterference', 'mapOfWarsEvents']) {
  if (result[key].length === 0 && Array.isArray(previousSnapshot[key]) && previousSnapshot[key].length > 0) {
    result[key] = previousSnapshot[key];
    result.errors.push(`${key}: transiently empty; preserved previous snapshot`);
  }
}
result.cyberVulnerabilities = result.cyberVulnerabilities.map(normalizeCyberRecordDefaults);

function hasSourceTelemetry(sourceId) {
  return ingestionTracker.events.some((event) => event.sourceId === sourceId);
}
function markSourceIfAbsent(sourceId, status, detail = null, extra = {}) {
  if (!hasSourceTelemetry(sourceId)) markSource(sourceId, status, detail, extra);
}
function collectionWasPreserved(collection) {
  return result.errors.some((message) => message.startsWith(`${collection}: transiently empty; preserved`));
}

// Fill any connector telemetry not explicitly recorded beside the ingestion code. These
// inferences are deliberately conservative: when a joint upstream request fails, the detail
// says the individual outcome is indeterminate rather than pretending precise per-source truth.
markSourceIfAbsent('launch-library-2', result.launches.length > 0 ? 'fetched' : 'failed', result.launches.length > 0 ? null : 'Launch Library 2 unavailable or yielded no geolocated rows', { recordCount: result.launches.length });
if (result.sources.news === 'GDELT DOC 2.0 artlist') {
  markSourceIfAbsent('gdelt-doc', 'fetched', 'GDELT DOC artlist supplied the bounded conflict-news collection', { recordCount: result.news.length });
  markSourceIfAbsent('google-news-rss', 'not-attempted', 'fallback not needed because GDELT DOC supplied rows', { recordCount: 0 });
} else if (result.sources.news === 'Google News RSS conflict query') {
  markSourceIfAbsent('gdelt-doc', result.gdeltGeoMeta?.titleEnrichment?.status === 'ok' ? 'partial' : 'failed', 'GDELT DOC artlist did not supply rows; separate DOC title-enrichment status is disclosed in gdeltGeoMeta', { recordCount: 0 });
  markSourceIfAbsent('google-news-rss', 'fetched', 'fallback RSS supplied the bounded conflict-news collection', { recordCount: result.news.length });
} else {
  markSourceIfAbsent('gdelt-doc', result.gdeltGeoMeta?.titleEnrichment?.status === 'ok' ? 'partial' : 'failed', 'GDELT DOC artlist unavailable and no direct rows emitted', { recordCount: 0 });
  markSourceIfAbsent('google-news-rss', result.news.length > 0 ? 'unknown' : 'failed', result.news.length > 0 ? 'rows exist but the supplying headline connector cannot be identified from source metadata' : 'fallback RSS unavailable or yielded no rows', { recordCount: result.news.length });
}
for (const sourceId of ['nasa-eonet', 'usgs-earthquake-feed', 'gdacs-events', 'noaa-nws-alerts']) {
  const failed = result.errors.some((message) => message.startsWith('Natural events:'));
  markSourceIfAbsent(sourceId, failed ? 'failed' : 'fetched', failed ? 'joint natural-event request failed; individual upstream outcome indeterminate' : 'joint natural-event request completed', { recordCount: null });
}
markSourceIfAbsent('nasa-firms', process.env.FIRMS_MAP_KEY ? (result.sources.firms ? 'fetched' : 'failed') : 'not-configured', result.sources.firms ? null : 'FIRMS active-fire rows unavailable in this build', { recordCount: null });
const mapOfWarsIngestFailed = result.errors.some((message) => message.startsWith('Map of Wars:'));
markSourceIfAbsent('map-of-wars', String(result.sources.mapOfWars ?? '').includes('preserved') ? 'preserved' : mapOfWarsIngestFailed ? 'failed' : result.mapOfWarsEvents.length > 0 ? 'fetched' : 'failed', mapOfWarsIngestFailed ? 'aggregator ingestion failed even though authenticated/preserved rows may remain in the combined collection' : null, { recordCount: mapOfWarsIngestFailed ? 0 : result.mapOfWarsEvents.length });
if (result.ucdpMeta.status === 'ok') markSourceIfAbsent('ucdp-ged-candidate', 'fetched', null, { recordCount: result.ucdpMeta.mergedEventCount });
else if (result.ucdpMeta.preservedPriorEventCount > 0) markSourceIfAbsent('ucdp-ged-candidate', 'preserved', result.ucdpMeta.statusDetail, { recordCount: result.ucdpMeta.preservedPriorEventCount, retrievedAt: previousSnapshot.fetchedAt ?? result.fetchedAt });
else markSourceIfAbsent('ucdp-ged-candidate', result.ucdpMeta.status === 'unconfigured' ? 'not-configured' : 'failed', result.ucdpMeta.statusDetail, { recordCount: 0 });
markSourceIfAbsent('acled-political-violence', process.env.ACLED_API_KEY && process.env.ACLED_EMAIL ? (result.sources.acled ? 'fetched' : 'failed') : 'not-configured', result.sources.acled ? null : 'ACLED authenticated extract unavailable in this build', { recordCount: null });
markSourceIfAbsent('gpsjam-daily-h3', result.gpsInterference.length > 0 ? 'fetched' : 'failed', result.gpsInterference.length > 0 ? null : 'gpsjam manifest or daily H3 CSV unavailable', { recordCount: result.gpsInterference.length });
for (const [sourceId, service] of [['cisa-kev', result.cyberVulnerabilityMeta.kev], ['nvd-cve-api', result.cyberVulnerabilityMeta.nvd], ['first-epss', result.cyberVulnerabilityMeta.epss]]) {
  const status = service?.status === 'ok' ? 'fetched' : service?.status === 'partial' ? 'partial' : service?.status === 'preserved' ? 'preserved' : service?.status === 'not-attempted' ? 'not-attempted' : 'failed';
  const count = sourceId === 'cisa-kev' ? result.cyberVulnerabilities.length : sourceId === 'nvd-cve-api' ? result.cyberVulnerabilities.filter((item) => item.nvd).length : result.cyberVulnerabilities.filter((item) => item.epss).length;
  markSourceIfAbsent(sourceId, status, service?.statusDetail ?? service?.detail ?? null, { recordCount: count, retrievedAt: service?.retrievedAt ?? result.fetchedAt });
}
markSourceIfAbsent('windy-webcams', process.env.WINDY_WEBCAMS_KEY ? (result.webcams.length > 0 ? 'fetched' : 'failed') : 'not-configured', process.env.WINDY_WEBCAMS_KEY ? null : 'WINDY_WEBCAMS_KEY is not configured in the build-time environment', { recordCount: result.webcams.length });

const preservationSources = {
  militaryAircraft: ['adsb-lol-military'],
  aircraft: ['opensky-network'],
  vessels: ['digitraffic-ais', 'aisstream-global'],
  satellites: ['celestrak-gp'],
  news: [result.sources.news === 'Google News RSS conflict query' ? 'google-news-rss' : 'gdelt-doc'],
  launches: ['launch-library-2'],
  naturalEvents: ['nasa-eonet', 'usgs-earthquake-feed', 'gdacs-events', 'noaa-nws-alerts', 'nasa-firms'],
  gpsInterference: ['gpsjam-daily-h3'],
  mapOfWarsEvents: ['map-of-wars', 'ucdp-ged-candidate', 'acled-political-violence'],
};
for (const [collection, sourceIds] of Object.entries(preservationSources)) {
  if (!collectionWasPreserved(collection)) continue;
  for (const sourceId of sourceIds) {
    markSource(sourceId, 'preserved', 'collection-level previous snapshot retained after a transiently empty/failed ingest; row-level source mix is not separable', { recordCount: null, retrievedAt: previousSnapshot.fetchedAt ?? result.fetchedAt });
  }
}

validateSnapshot(result);
result.provenanceLedger = buildSnapshotProvenanceLedger({ registry: sourceRegistry, snapshot: result, ingestionEvents: ingestionTracker.events, previousSnapshot });
const snapshotGovernance = validateSnapshotGovernance(result, sourceRegistry);
if (snapshotGovernance.errors.length > 0) {
  throw new Error(`Source governance validation failed: ${snapshotGovernance.errors.slice(0, 10).join('; ')}`);
}
for (const warning of snapshotGovernance.warnings.slice(0, 20)) console.warn(`source-governance review: ${warning}`);
const masterLedger = buildMasterProvenanceLedger({ root, registry: sourceRegistry, snapshotLedger: result.provenanceLedger });
if (masterLedger.artifactErrors.length > 0) throw new Error(`Static artifact provenance incomplete: ${masterLedger.artifactErrors.join('; ')}`);
function writeTextAtomic(path, text) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}
writeTextAtomic(registryOutFile, sourceRegistryText.endsWith('\n') ? sourceRegistryText : `${sourceRegistryText}\n`);
writeTextAtomic(provenanceOutFile, JSON.stringify(masterLedger));
const chunkedPublication = buildChunkedPublication(result);
const publicationWrites = writeChunkedPublication({ publication: chunkedPublication, dataDir: dataOutDir, writeTextAtomic });
const chunkBytes = publicationWrites.filter((write) => write.role === 'domain-chunk').reduce((sum, write) => sum + write.bytes, 0);
const ucdpConsoleSuffix = result.ucdpMeta.preservedPriorEventCount > 0 ? `, ${result.ucdpMeta.preservedPriorEventCount} preserved` : '';
console.log(`osint snapshot: ${result.militaryAircraft.length} military aircraft, ${result.aircraft.length} civil aircraft, ${result.vessels.length} vessels, ${result.satellites.length} satellites, ${result.news.length} articles, ${result.launches.length} launches, ${result.naturalEvents.length} natural events, ${result.gpsInterference.length} gps interference cells, ${result.mapOfWarsEvents.length} map-of-wars events, ${result.ucdpMeta.mergedEventCount} UCDP official records (${result.ucdpMeta.status}${ucdpConsoleSuffix}), ${result.webcams.length} webcams, ${result.internetOutages.length} IODA outage detections (${result.internetOutageMeta.status}), ${result.cyberVulnerabilities.length} KEV records (${result.cyberVulnerabilityMeta.nvd.enrichedCveCount}/${result.cyberVulnerabilityMeta.nvd.requestedCveCount} NVD, ${result.cyberVulnerabilityMeta.epss.enrichedCveCount}/${result.cyberVulnerabilityMeta.epss.requestedCveCount} EPSS, ${result.cyberVulnerabilityMeta.status}), ${result.gdeltGeoNews.length} GDELT geo-news mentions (${result.gdeltGeoMeta.status}, ${result.gdeltGeoMeta.titleEnrichedArticleCount} title-enriched)`);
console.log(`osint chunks: ${OSINT_CHUNK_LAYOUT.length} domain chunks/${chunkBytes} bytes + manifest cursor; compatibility monolith retained at data/osint-snapshot.json (${chunkedPublication.legacyBytes} bytes)`);
