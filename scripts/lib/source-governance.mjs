import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

export const REGISTRY_SCHEMA_VERSION = 'source-registry/v1';
export const LEDGER_SCHEMA_VERSION = 'provenance-ledger/v1';
export const GOVERNANCE_BUILD_VERSION = 'godseye-source-governance/2026.11.26.1';
export const LEGAL_POSITION = 'Source registry and provenance ledger entries are audit metadata assembled from publisher documentation or explicit unknowns. They are not legal advice, not a license compliance certification, and not evidence that a deployer holds permissions not recorded in the repository.';

export const SNAPSHOT_COLLECTIONS = Object.freeze([
  'militaryAircraft',
  'aircraft',
  'vessels',
  'satellites',
  'news',
  'launches',
  'naturalEvents',
  'gpsInterference',
  'mapOfWarsEvents',
  'webcams',
  'cyberVulnerabilities',
  'internetOutages',
  'gdeltGeoNews',
]);

export const STATIC_ARTIFACT_COLLECTIONS = Object.freeze({
  conflictFallback: {
    artifactPath: 'frontend/public/data/conflict-fallback.json',
    publicPath: 'data/conflict-fallback.json',
    label: 'Conflict fallback event cache',
  },
  referenceBasemap: {
    artifactPath: 'frontend/public/data/ne_110m_admin_0_countries.geojson',
    publicPath: 'data/ne_110m_admin_0_countries.geojson',
    label: 'Natural Earth country reference basemap',
  },
});

export const COLLECTION_NAMES = Object.freeze([
  ...SNAPSHOT_COLLECTIONS,
  ...Object.keys(STATIC_ARTIFACT_COLLECTIONS),
]);

export const RETRIEVAL_STATUSES = Object.freeze([
  'fetched',
  'partial',
  'bundled',
  'cache-hit',
  'preserved',
  'failed',
  'not-configured',
  'not-attempted',
  'unavailable',
  'unknown',
]);

const LICENSE_STATUSES = new Set(['open-license', 'public-domain', 'terms-identified', 'unknown']);
const ATTRIBUTION_REQUIREMENTS = new Set(['required', 'requested', 'unknown', 'not-required']);
const AUTH_MODES = new Set(['none', 'api-key-header', 'optional-api-key-header', 'api-key-path', 'api-key-query', 'email-key-query', 'websocket-api-key']);
const BROWSER_MODES = new Set(['direct-keyless-browser-permitted', 'keyless-build-time-mirror', 'keyed-build-time-only', 'browser-prohibited-by-provider']);
const CORS_STATUSES = new Set(['enabled', 'disabled', 'unknown']);
const REDISTRIBUTION_STATUSES = new Set(['open', 'permitted-with-conditions', 'restricted-review', 'unknown']);
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'unknown']);
const BULK_EXPORT_STATUSES = new Set(['permitted', 'permitted-with-conditions', 'license-or-permission-required', 'unknown', 'prohibited']);
const COLLECTION_SET = new Set(COLLECTION_NAMES);
const RETRIEVAL_STATUS_SET = new Set(RETRIEVAL_STATUSES);
const FRESHNESS_STATES = new Set(['current', 'aging', 'stale', 'preserved', 'unavailable', 'unknown']);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stableStringify(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (isPlainObject(input)) {
      const output = {};
      for (const key of Object.keys(input).sort()) {
        if (input[key] !== undefined) output[key] = normalize(input[key]);
      }
      return output;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function validUrl(value, protocols = new Set(['http:', 'https:', 'wss:'])) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    return protocols.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function nullableUrl(value) {
  return value === null || validUrl(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function positiveIntegerOrNull(value) {
  return value === null || (Number.isInteger(value) && value > 0);
}

function validateStringArray(value, label, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => !nonEmptyString(item))) {
    errors.push(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'} of non-empty strings`);
    return false;
  }
  return true;
}

export function validateSourceRegistry(registry) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(registry)) return { errors: ['source registry is not an object'], warnings, sourceIds: [], coverage: {} };
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) errors.push(`source registry schemaVersion must be ${REGISTRY_SCHEMA_VERSION}`);
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(registry.registryVersion ?? ''))) errors.push('source registry registryVersion must use YYYY.MM.DD.N form');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(registry.updatedAt ?? ''))) errors.push('source registry updatedAt must be YYYY-MM-DD');
  if (!nonEmptyString(registry.documentation)) errors.push('source registry documentation path missing');
  if (!Array.isArray(registry.sources) || registry.sources.length === 0) {
    errors.push('source registry sources missing or empty');
    return { errors, warnings, sourceIds: [], coverage: {} };
  }

  const ids = new Set();
  const coverage = Object.fromEntries(COLLECTION_NAMES.map((collection) => [collection, []]));
  registry.sources.forEach((source, index) => {
    const label = `source[${index}]${source?.id ? `:${source.id}` : ''}`;
    if (!isPlainObject(source)) {
      errors.push(`${label} is not an object`);
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(source.id ?? ''))) errors.push(`${label} invalid lowercase hyphenated id`);
    if (ids.has(source.id)) errors.push(`${label} duplicate source id`);
    ids.add(source.id);
    for (const key of ['displayName', 'owner', 'connectorVersion']) {
      if (!nonEmptyString(source[key])) errors.push(`${label} missing ${key}`);
    }

    if (!isPlainObject(source.endpoint)) {
      errors.push(`${label} endpoint missing`);
    } else {
      if (!validateStringArray(source.endpoint.urls, `${label} endpoint.urls`, errors)) {
        // Detailed URL validation only when the array itself is shaped correctly.
      } else {
        source.endpoint.urls.forEach((url, urlIndex) => {
          const templateNormalized = url.replaceAll('{MAP_KEY}', 'MAPKEY').replaceAll('{date}', '2026-01-01');
          if (!validUrl(templateNormalized)) errors.push(`${label} endpoint.urls[${urlIndex}] is not a valid http/https/wss URL template`);
        });
      }
      if (!nonEmptyString(source.endpoint.protocol)) errors.push(`${label} endpoint.protocol missing`);
      if (!nullableUrl(source.endpoint.documentationUrl)) errors.push(`${label} endpoint.documentationUrl must be null or a valid URL`);
    }

    if (!isPlainObject(source.license)) {
      errors.push(`${label} license missing`);
    } else {
      if (!LICENSE_STATUSES.has(source.license.status)) errors.push(`${label} license.status invalid`);
      if (!(source.license.name === null || nonEmptyString(source.license.name))) errors.push(`${label} license.name must be null or non-empty`);
      if (!nullableUrl(source.license.termsUrl)) errors.push(`${label} license.termsUrl must be null or a valid URL`);
      if (!nullableUrl(source.license.evidenceUrl)) errors.push(`${label} license.evidenceUrl must be null or a valid URL`);
      if (!nonEmptyString(source.license.note)) errors.push(`${label} license.note missing`);
      if (source.license.status !== 'unknown' && !validUrl(source.license.termsUrl)) errors.push(`${label} non-unknown license status requires a source-backed termsUrl`);
      if (source.license.status === 'unknown') warnings.push(`${label} license is explicitly unknown`);
    }

    if (!isPlainObject(source.attribution)) {
      errors.push(`${label} attribution missing`);
    } else {
      if (!ATTRIBUTION_REQUIREMENTS.has(source.attribution.requirement)) errors.push(`${label} attribution.requirement invalid`);
      if (!nonEmptyString(source.attribution.text)) errors.push(`${label} attribution.text missing; even unknown requirements need conservative source credit`);
      if (!nullableUrl(source.attribution.evidenceUrl)) errors.push(`${label} attribution.evidenceUrl must be null or a valid URL`);
      if (!nonEmptyString(source.attribution.note)) errors.push(`${label} attribution.note missing`);
    }

    if (!isPlainObject(source.cadence)) {
      errors.push(`${label} cadence missing`);
    } else {
      if (!nonEmptyString(source.cadence.publisherCadence) || !nonEmptyString(source.cadence.retrievalCadence)) errors.push(`${label} cadence publisher/retrieval text missing`);
      if (!positiveIntegerOrNull(source.cadence.expectedUpdateSeconds)) errors.push(`${label} cadence.expectedUpdateSeconds invalid`);
      if (!isPlainObject(source.cadence.retention) || !nonEmptyString(source.cadence.retention.mode) || !nonEmptyString(source.cadence.retention.note)) errors.push(`${label} cadence.retention invalid`);
      else if (!(source.cadence.retention.maxCacheAgeSeconds === null || nonNegativeInteger(source.cadence.retention.maxCacheAgeSeconds))) errors.push(`${label} cadence.retention.maxCacheAgeSeconds invalid`);
      if (!isPlainObject(source.cadence.freshness)) {
        errors.push(`${label} cadence.freshness missing`);
      } else {
        const freshness = source.cadence.freshness;
        if (!Number.isInteger(freshness.warnAfterSeconds) || freshness.warnAfterSeconds <= 0) errors.push(`${label} freshness.warnAfterSeconds invalid`);
        if (!Number.isInteger(freshness.staleAfterSeconds) || freshness.staleAfterSeconds <= 0) errors.push(`${label} freshness.staleAfterSeconds invalid`);
        if (Number.isInteger(freshness.warnAfterSeconds) && Number.isInteger(freshness.staleAfterSeconds) && freshness.staleAfterSeconds < freshness.warnAfterSeconds) errors.push(`${label} freshness stale threshold precedes warning threshold`);
        if (!nonEmptyString(freshness.timestampBasis) || !nonEmptyString(freshness.note)) errors.push(`${label} freshness basis/note missing`);
      }
    }

    if (!isPlainObject(source.access)) {
      errors.push(`${label} access missing`);
    } else {
      const authentication = source.access.authentication;
      if (!isPlainObject(authentication)) errors.push(`${label} access.authentication missing`);
      else {
        if (!AUTH_MODES.has(authentication.mode)) errors.push(`${label} authentication.mode invalid`);
        if (typeof authentication.required !== 'boolean') errors.push(`${label} authentication.required must be boolean`);
        if (!Array.isArray(authentication.envVars) || authentication.envVars.some((name) => !/^[A-Z][A-Z0-9_]*$/.test(name))) errors.push(`${label} authentication.envVars invalid`);
        if (authentication.required && (authentication.mode === 'none' || authentication.envVars.length === 0)) errors.push(`${label} required authentication needs a non-none mode and env var names`);
      }
      const browser = source.access.browser;
      if (!isPlainObject(browser)) errors.push(`${label} access.browser missing`);
      else {
        if (!BROWSER_MODES.has(browser.mode)) errors.push(`${label} browser.mode invalid`);
        if (!CORS_STATUSES.has(browser.cors)) errors.push(`${label} browser.cors invalid`);
        if (typeof browser.runtimeFetchAllowed !== 'boolean') errors.push(`${label} browser.runtimeFetchAllowed must be boolean`);
        if (!nonEmptyString(browser.note)) errors.push(`${label} browser.note missing`);
        if ((browser.mode === 'keyed-build-time-only' || browser.mode === 'browser-prohibited-by-provider') && browser.runtimeFetchAllowed !== false) errors.push(`${label} keyed/prohibited browser mode cannot permit runtime fetch`);
      }
    }

    if (!isPlainObject(source.redistribution)) {
      errors.push(`${label} redistribution missing`);
    } else {
      if (!REDISTRIBUTION_STATUSES.has(source.redistribution.status)) errors.push(`${label} redistribution.status invalid`);
      if (!RISK_LEVELS.has(source.redistribution.publicStaticRisk)) errors.push(`${label} redistribution.publicStaticRisk invalid`);
      if (!BULK_EXPORT_STATUSES.has(source.redistribution.bulkPublicExport)) errors.push(`${label} redistribution.bulkPublicExport invalid`);
      validateStringArray(source.redistribution.constraints, `${label} redistribution.constraints`, errors);
      if (!nonEmptyString(source.redistribution.note)) errors.push(`${label} redistribution.note missing`);
      if (source.redistribution.status === 'restricted-review' || source.redistribution.status === 'unknown' || source.redistribution.publicStaticRisk === 'high') warnings.push(`${label} redistribution requires review: ${source.redistribution.note}`);
    }

    if (!isPlainObject(source.confidence)) {
      errors.push(`${label} confidence missing`);
    } else {
      for (const key of ['authority', 'verification', 'coverage', 'automation']) {
        if (!nonEmptyString(source.confidence[key])) errors.push(`${label} confidence.${key} missing`);
      }
      validateStringArray(source.confidence.caveats, `${label} confidence.caveats`, errors);
    }

    if (!Array.isArray(source.collections) || source.collections.length === 0) {
      errors.push(`${label} collections missing or empty`);
    } else {
      for (const collection of source.collections) {
        if (!COLLECTION_SET.has(collection)) errors.push(`${label} unknown collection ${collection}`);
        else if (!coverage[collection].includes(source.id)) coverage[collection].push(source.id);
      }
    }
  });

  for (const collection of COLLECTION_NAMES) {
    if (coverage[collection].length === 0) errors.push(`registry coverage gap: no source registered for collection ${collection}`);
  }
  return { errors, warnings, sourceIds: [...ids], coverage };
}

export function loadSourceRegistry(registryPath) {
  const text = readFileSync(registryPath, 'utf8');
  return { registry: JSON.parse(text), text, path: registryPath };
}

export function createIngestionTracker() {
  const events = [];
  return {
    events,
    record(sourceId, status, detail = null, extra = {}) {
      events.push({
        sourceId,
        status,
        detail,
        retrievedAt: new Date().toISOString(),
        ...extra,
      });
    },
  };
}

function latestEventBySource(events) {
  const latest = new Map();
  for (const event of events) {
    if (event && typeof event.sourceId === 'string') latest.set(event.sourceId, event);
  }
  return latest;
}

function parseTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;
  const gdelt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (gdelt) {
    const [year, month, day, hour, minute, second] = gdelt.slice(1).map(Number);
    return Date.UTC(year, month - 1, day, hour, minute, second);
  }
  return null;
}

function isoFromMs(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function recordTimestamp(collection, record) {
  if (!isPlainObject(record)) return null;
  const first = (values) => values.map(parseTimestampMs).find((value) => value !== null) ?? null;
  switch (collection) {
    case 'aircraft': return first([record.lastContact]);
    case 'vessels': return first([record.timestamp]);
    case 'news': return first([record.publishedAt]);
    case 'launches': return first([record.net]);
    case 'naturalEvents': return first([record.occurredAt]);
    case 'mapOfWarsEvents': return first([record.ts]);
    case 'cyberVulnerabilities': return first([record.nvd?.retrievedAt, record.epss?.retrievedAt, record.dateAdded]);
    case 'internetOutages': return first([record.until, record.from]);
    case 'gdeltGeoNews': return first([record.seenAt, record.slotTime]);
    default: return null;
  }
}

function timestampSummary(collection, records) {
  let newest = null;
  let coverage = 0;
  for (const record of records) {
    const timestamp = recordTimestamp(collection, record);
    if (timestamp !== null) {
      coverage += 1;
      if (newest === null || timestamp > newest) newest = timestamp;
    }
  }
  return { newestRecordTimestamp: isoFromMs(newest), timestampedRecordCount: coverage };
}

function publicSourceSummary(source) {
  return {
    sourceId: source.id,
    displayName: source.displayName,
    owner: source.owner,
    endpointUrls: [...source.endpoint.urls],
    endpointProtocol: source.endpoint.protocol,
    documentationUrl: source.endpoint.documentationUrl,
    connectorVersion: source.connectorVersion,
    authenticationMode: source.access.authentication.mode,
    authenticationRequired: source.access.authentication.required,
    credentialEnvVars: [...source.access.authentication.envVars],
    browserMode: source.access.browser.mode,
    cors: source.access.browser.cors,
    runtimeFetchAllowed: source.access.browser.runtimeFetchAllowed,
    license: { ...source.license },
    attribution: { ...source.attribution },
    redistribution: { ...source.redistribution, constraints: [...source.redistribution.constraints] },
    cadence: JSON.parse(JSON.stringify(source.cadence)),
    confidence: { ...source.confidence, caveats: [...source.confidence.caveats] },
  };
}

function thresholdSummary(sources) {
  const active = sources.filter((source) => !['not-attempted', 'not-configured'].includes(source.retrieval.status));
  const candidates = active.length > 0 ? active : sources;
  const warn = Math.min(...candidates.map((source) => source.cadence.freshness.warnAfterSeconds));
  const stale = Math.min(...candidates.map((source) => source.cadence.freshness.staleAfterSeconds));
  return { warnAfterSeconds: warn, staleAfterSeconds: stale };
}

function collectionRetrievalState(entries, recordCount) {
  const statuses = entries.map((entry) => entry.retrieval.status);
  if (statuses.includes('preserved')) return 'preserved';
  if (recordCount === 0 && statuses.every((status) => ['failed', 'not-configured', 'not-attempted', 'unavailable', 'unknown'].includes(status))) return 'unavailable';
  if (statuses.includes('failed') || statuses.includes('partial') || statuses.includes('unknown')) return 'partial';
  if (statuses.some((status) => ['fetched', 'bundled', 'cache-hit'].includes(status))) return 'active';
  if (recordCount > 0) return 'active';
  return 'unavailable';
}

export function buildSnapshotProvenanceLedger({ registry, snapshot, ingestionEvents = [], previousSnapshot = {} }) {
  const generatedAt = snapshot.fetchedAt;
  const generatedMs = parseTimestampMs(generatedAt);
  const registrySources = new Map(registry.sources.map((source) => [source.id, source]));
  const latestEvents = latestEventBySource(ingestionEvents);
  const collections = {};

  for (const collection of SNAPSHOT_COLLECTIONS) {
    const records = Array.isArray(snapshot[collection]) ? snapshot[collection] : [];
    const registered = registry.sources.filter((source) => source.collections.includes(collection));
    const sourceEntries = registered.map((source) => {
      const event = latestEvents.get(source.id) ?? null;
      const status = event?.status ?? 'unknown';
      const preserved = status === 'preserved';
      const retrievedAt = event?.retrievedAt ?? (preserved && previousSnapshot.fetchedAt ? previousSnapshot.fetchedAt : generatedAt);
      return {
        ...publicSourceSummary(source),
        retrieval: {
          status,
          detail: event?.detail ?? (event ? null : 'no explicit connector telemetry recorded; status is conservatively unknown'),
          retrievedAt,
          recordCount: Number.isInteger(event?.recordCount) ? event.recordCount : null,
        },
      };
    });

    const state = collectionRetrievalState(sourceEntries, records.length);
    const thresholds = thresholdSummary(sourceEntries);
    const preserved = state === 'preserved';
    const retrievalCandidates = sourceEntries
      .map((entry) => parseTimestampMs(entry.retrieval.retrievedAt))
      .filter((value) => value !== null);
    let retrievalAtMs = retrievalCandidates.length > 0 ? Math.min(...retrievalCandidates) : null;
    if (preserved && previousSnapshot.fetchedAt) {
      const priorMs = parseTimestampMs(previousSnapshot.fetchedAt);
      if (priorMs !== null) retrievalAtMs = priorMs;
    }
    const ageSeconds = retrievalAtMs !== null && generatedMs !== null ? Math.max(0, Math.floor((generatedMs - retrievalAtMs) / 1000)) : null;
    let freshnessState = 'unknown';
    if (state === 'unavailable') freshnessState = 'unavailable';
    else if (preserved) freshnessState = 'preserved';
    else if (ageSeconds === null) freshnessState = 'unknown';
    else if (ageSeconds >= thresholds.staleAfterSeconds) freshnessState = 'stale';
    else if (ageSeconds >= thresholds.warnAfterSeconds) freshnessState = 'aging';
    else freshnessState = 'current';

    const timestamps = timestampSummary(collection, records);
    const normalizationSha256 = sha256Text(stableStringify(records));
    const provenanceSha256 = sha256Text(stableStringify(sourceEntries.map((entry) => ({
      sourceId: entry.sourceId,
      status: entry.retrieval.status,
      licenseStatus: entry.license.status,
      attributionRequirement: entry.attribution.requirement,
      redistributionRisk: entry.redistribution.publicStaticRisk,
    }))));
    collections[collection] = {
      collection,
      artifact: 'data/osint-snapshot.json',
      jsonPointer: `/${collection}`,
      schemaVersion: `${collection}/normalized/v1`,
      recordCount: records.length,
      sourceIds: sourceEntries.map((entry) => entry.sourceId),
      sources: sourceEntries,
      retrievalState: state,
      retrievedAt: isoFromMs(retrievalAtMs),
      freshness: {
        state: freshnessState,
        ageSeconds,
        basis: 'snapshot-retrieval-time; record timestamps are separately disclosed and are not substituted for retrieval freshness',
        warnAfterSeconds: thresholds.warnAfterSeconds,
        staleAfterSeconds: thresholds.staleAfterSeconds,
      },
      dataVintage: {
        ...timestamps,
        note: 'newestRecordTimestamp is the newest publisher/record timestamp recognized by the normalizer; null means the row schema does not expose a trustworthy per-record time',
      },
      normalizationSha256,
      provenanceSha256,
    };
  }

  const summary = summarizeCollections(collections);
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    governanceVersion: GOVERNANCE_BUILD_VERSION,
    registrySchemaVersion: registry.schemaVersion,
    registryVersion: registry.registryVersion,
    generatedAt,
    legalPosition: LEGAL_POSITION,
    collections,
    summary,
  };
}

function summarizeCollections(collections) {
  const uniqueSources = new Map();
  const retrievalStatusCounts = {};
  const freshnessStateCounts = {};
  let highRiskCollectionCount = 0;
  let reviewRequiredCollectionCount = 0;
  let staleOrPreservedCollectionCount = 0;
  for (const collection of Object.values(collections)) {
    retrievalStatusCounts[collection.retrievalState] = (retrievalStatusCounts[collection.retrievalState] ?? 0) + 1;
    freshnessStateCounts[collection.freshness.state] = (freshnessStateCounts[collection.freshness.state] ?? 0) + 1;
    if (['stale', 'preserved'].includes(collection.freshness.state)) staleOrPreservedCollectionCount += 1;
    let high = false;
    let review = false;
    for (const source of collection.sources) {
      if (!uniqueSources.has(source.sourceId)) uniqueSources.set(source.sourceId, source);
      if (source.redistribution.publicStaticRisk === 'high') high = true;
      if (['restricted-review', 'unknown'].includes(source.redistribution.status) || ['license-or-permission-required', 'unknown'].includes(source.redistribution.bulkPublicExport)) review = true;
    }
    if (high) highRiskCollectionCount += 1;
    if (review) reviewRequiredCollectionCount += 1;
  }

  const licenseStatusCounts = {};
  const attributionRequirementCounts = {};
  const redistributionStatusCounts = {};
  const redistributionRiskCounts = {};
  const browserModeCounts = {};
  const keyedSourceIds = [];
  const unknownLicenseSourceIds = [];
  const highRiskSourceIds = [];
  const reviewRequiredSourceIds = [];
  for (const source of uniqueSources.values()) {
    licenseStatusCounts[source.license.status] = (licenseStatusCounts[source.license.status] ?? 0) + 1;
    attributionRequirementCounts[source.attribution.requirement] = (attributionRequirementCounts[source.attribution.requirement] ?? 0) + 1;
    redistributionStatusCounts[source.redistribution.status] = (redistributionStatusCounts[source.redistribution.status] ?? 0) + 1;
    redistributionRiskCounts[source.redistribution.publicStaticRisk] = (redistributionRiskCounts[source.redistribution.publicStaticRisk] ?? 0) + 1;
    browserModeCounts[source.browserMode] = (browserModeCounts[source.browserMode] ?? 0) + 1;
    if (source.authenticationRequired || source.credentialEnvVars.length > 0) keyedSourceIds.push(source.sourceId);
    if (source.license.status === 'unknown') unknownLicenseSourceIds.push(source.sourceId);
    if (source.redistribution.publicStaticRisk === 'high') highRiskSourceIds.push(source.sourceId);
    if (['restricted-review', 'unknown'].includes(source.redistribution.status) || ['license-or-permission-required', 'unknown'].includes(source.redistribution.bulkPublicExport)) reviewRequiredSourceIds.push(source.sourceId);
  }
  keyedSourceIds.sort();
  unknownLicenseSourceIds.sort();
  highRiskSourceIds.sort();
  reviewRequiredSourceIds.sort();

  return {
    collectionCount: Object.keys(collections).length,
    involvedSourceCount: uniqueSources.size,
    keyedSourceCount: keyedSourceIds.length,
    keyedSourceIds,
    unknownLicenseCount: unknownLicenseSourceIds.length,
    unknownLicenseSourceIds,
    highRiskSourceCount: highRiskSourceIds.length,
    highRiskSourceIds,
    reviewRequiredSourceCount: reviewRequiredSourceIds.length,
    reviewRequiredSourceIds,
    highRiskCollectionCount,
    reviewRequiredCollectionCount,
    staleOrPreservedCollectionCount,
    licenseStatusCounts,
    attributionRequirementCounts,
    redistributionStatusCounts,
    redistributionRiskCounts,
    browserModeCounts,
    retrievalStatusCounts,
    freshnessStateCounts,
  };
}

function artifactRecordCount(collection, payload) {
  if (collection === 'conflictFallback') return Array.isArray(payload?.events) ? payload.events.length : null;
  if (collection === 'referenceBasemap') return Array.isArray(payload?.features) ? payload.features.length : null;
  return null;
}

function artifactGeneratedAt(collection, payload) {
  if (collection === 'conflictFallback') return isoFromMs(parseTimestampMs(payload?.generatedAt));
  return null;
}

export function buildMasterProvenanceLedger({ root, registry, snapshotLedger }) {
  const artifacts = {};
  const artifactErrors = [];
  for (const [collection, spec] of Object.entries(STATIC_ARTIFACT_COLLECTIONS)) {
    const absolutePath = join(root, spec.artifactPath);
    const sources = registry.sources.filter((source) => source.collections.includes(collection)).map(publicSourceSummary);
    if (!existsSync(absolutePath)) {
      artifactErrors.push(`${collection}: missing static artifact ${spec.artifactPath}`);
      artifacts[collection] = {
        collection,
        label: spec.label,
        artifactPath: spec.publicPath,
        present: false,
        sourceIds: sources.map((source) => source.sourceId),
        sources,
      };
      continue;
    }
    const buffer = readFileSync(absolutePath);
    let payload = null;
    try { payload = JSON.parse(buffer.toString('utf8')); } catch {}
    const generatedAtArtifact = artifactGeneratedAt(collection, payload);
    const artifactAgeSeconds = generatedAtArtifact && snapshotLedger.generatedAt
      ? Math.max(0, Math.floor((Date.parse(snapshotLedger.generatedAt) - Date.parse(generatedAtArtifact)) / 1000))
      : null;
    const thresholds = sources.length > 0
      ? {
          warnAfterSeconds: Math.min(...sources.map((source) => source.cadence.freshness.warnAfterSeconds)),
          staleAfterSeconds: Math.min(...sources.map((source) => source.cadence.freshness.staleAfterSeconds)),
        }
      : { warnAfterSeconds: null, staleAfterSeconds: null };
    let freshnessState = 'unknown';
    if (artifactAgeSeconds !== null && thresholds.staleAfterSeconds !== null) {
      freshnessState = artifactAgeSeconds >= thresholds.staleAfterSeconds ? 'stale' : artifactAgeSeconds >= thresholds.warnAfterSeconds ? 'aging' : 'current';
    } else if (collection === 'referenceBasemap') freshnessState = 'unknown';
    artifacts[collection] = {
      collection,
      label: spec.label,
      artifactPath: spec.publicPath,
      present: true,
      bytes: buffer.length,
      sha256: sha256Buffer(buffer),
      recordCount: artifactRecordCount(collection, payload),
      artifactGeneratedAt: generatedAtArtifact,
      artifactLicenseDeclaration: typeof payload?.license === 'string' ? payload.license : null,
      artifactSourceDeclaration: typeof payload?.source === 'string' ? payload.source : null,
      sourceIds: sources.map((source) => source.sourceId),
      sources,
      freshness: {
        state: freshnessState,
        ageSeconds: artifactAgeSeconds,
        basis: collection === 'conflictFallback' ? 'artifact-generatedAt' : 'pinned-reference-version',
        warnAfterSeconds: thresholds.warnAfterSeconds,
        staleAfterSeconds: thresholds.staleAfterSeconds,
      },
    };
  }

  const artifactPseudoCollections = Object.fromEntries(Object.entries(artifacts).map(([collection, artifact]) => [collection, {
    retrievalState: artifact.present ? 'active' : 'unavailable',
    freshness: artifact.freshness ?? { state: 'unknown' },
    sources: artifact.sources ?? [],
  }]));
  const summary = summarizeCollections({ ...snapshotLedger.collections, ...artifactPseudoCollections });
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    governanceVersion: GOVERNANCE_BUILD_VERSION,
    registrySchemaVersion: registry.schemaVersion,
    registryVersion: registry.registryVersion,
    generatedAt: snapshotLedger.generatedAt,
    legalPosition: LEGAL_POSITION,
    collections: snapshotLedger.collections,
    artifacts,
    artifactErrors,
    summary,
  };
}

function sameJson(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function validIsoOrNull(value) {
  return value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validateSnapshotGovernance(snapshot, registry) {
  const registryValidation = validateSourceRegistry(registry);
  const errors = [...registryValidation.errors];
  const warnings = [...registryValidation.warnings];
  const ledger = snapshot?.provenanceLedger;
  if (!isPlainObject(ledger)) {
    errors.push('snapshot provenanceLedger missing');
    return { errors, warnings, registryValidation };
  }
  if (ledger.schemaVersion !== LEDGER_SCHEMA_VERSION) errors.push('provenanceLedger schemaVersion mismatch');
  if (ledger.registrySchemaVersion !== registry.schemaVersion || ledger.registryVersion !== registry.registryVersion) errors.push('provenanceLedger does not match canonical registry version');
  if (!String(ledger.legalPosition ?? '').includes('not legal advice')) errors.push('provenanceLedger missing honest legal-position disclaimer');
  if (!isPlainObject(ledger.collections)) errors.push('provenanceLedger collections missing');

  for (const collection of SNAPSHOT_COLLECTIONS) {
    if (!Array.isArray(snapshot[collection])) {
      errors.push(`${collection} missing or not an array`);
      continue;
    }
    const entry = ledger.collections?.[collection];
    if (!isPlainObject(entry)) {
      errors.push(`${collection} provenance ledger entry missing`);
      continue;
    }
    const records = snapshot[collection];
    const registeredIds = registry.sources.filter((source) => source.collections.includes(collection)).map((source) => source.id).sort();
    const ledgerIds = Array.isArray(entry.sourceIds) ? [...entry.sourceIds].sort() : [];
    if (!sameJson(registeredIds, ledgerIds)) errors.push(`${collection} registry coverage drift: registered ${registeredIds.join(',') || 'none'} but ledger ${ledgerIds.join(',') || 'none'}`);
    if (entry.recordCount !== records.length) errors.push(`${collection} ledger recordCount ${entry.recordCount} does not match emitted array length ${records.length}`);
    if (entry.artifact !== 'data/osint-snapshot.json' || entry.jsonPointer !== `/${collection}`) errors.push(`${collection} invalid artifact/jsonPointer provenance`);
    if (!/^[0-9a-f]{64}$/.test(String(entry.normalizationSha256 ?? ''))) errors.push(`${collection} normalization hash malformed`);
    else if (entry.normalizationSha256 !== sha256Text(stableStringify(records))) errors.push(`${collection} normalization hash does not match emitted records`);
    if (!/^[0-9a-f]{64}$/.test(String(entry.provenanceSha256 ?? ''))) errors.push(`${collection} provenance hash malformed`);
    if (!validIsoOrNull(entry.retrievedAt)) errors.push(`${collection} invalid retrieval timestamp`);
    if (!FRESHNESS_STATES.has(entry.freshness?.state)) errors.push(`${collection} invalid freshness state`);
    if (!(entry.freshness?.ageSeconds === null || nonNegativeInteger(entry.freshness.ageSeconds))) errors.push(`${collection} invalid freshness age`);
    if (!validIsoOrNull(entry.dataVintage?.newestRecordTimestamp ?? null)) errors.push(`${collection} invalid newest record timestamp`);
    if (!nonNegativeInteger(entry.dataVintage?.timestampedRecordCount) || entry.dataVintage.timestampedRecordCount > records.length) errors.push(`${collection} impossible timestamp coverage count`);
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
      errors.push(`${collection} provenance sources missing`);
      continue;
    }

    const registryById = new Map(registry.sources.map((source) => [source.id, source]));
    for (const sourceEntry of entry.sources) {
      const label = `${collection}:${sourceEntry?.sourceId || 'unknown-source'}`;
      const registrySource = registryById.get(sourceEntry?.sourceId);
      if (!registrySource) {
        errors.push(`${label} is not present in canonical source registry`);
        continue;
      }
      const expected = publicSourceSummary(registrySource);
      for (const key of ['displayName', 'owner', 'endpointUrls', 'endpointProtocol', 'documentationUrl', 'connectorVersion', 'authenticationMode', 'authenticationRequired', 'credentialEnvVars', 'browserMode', 'cors', 'runtimeFetchAllowed', 'license', 'attribution', 'redistribution', 'cadence', 'confidence']) {
        if (!sameJson(sourceEntry[key], expected[key])) errors.push(`${label} ledger field ${key} differs from canonical registry`);
      }
      if (!RETRIEVAL_STATUS_SET.has(sourceEntry.retrieval?.status)) errors.push(`${label} invalid retrieval status`);
      if (!(sourceEntry.retrieval?.detail === null || typeof sourceEntry.retrieval?.detail === 'string')) errors.push(`${label} invalid retrieval detail`);
      if (!(typeof sourceEntry.retrieval?.retrievedAt === 'string' && Number.isFinite(Date.parse(sourceEntry.retrieval.retrievedAt)))) errors.push(`${label} missing or invalid source retrieval timestamp`);
      if (!(sourceEntry.retrieval?.recordCount === null || nonNegativeInteger(sourceEntry.retrieval.recordCount))) errors.push(`${label} invalid source record count`);
      if (['required', 'requested'].includes(registrySource.attribution.requirement) && !nonEmptyString(sourceEntry.attribution?.text)) errors.push(`${label} missing required/requested attribution text`);
      if (registrySource.license.status !== 'unknown' && !validUrl(registrySource.license.termsUrl)) errors.push(`${label} non-unknown license lacks terms URL`);
      if (registrySource.redistribution.bulkPublicExport === 'prohibited' && records.length > 0) errors.push(`${label} explicitly prohibited bulk export appears in emitted collection`);
      if (registrySource.redistribution.status === 'restricted-review' || registrySource.redistribution.publicStaticRisk === 'high') warnings.push(`${label} redistribution review risk: ${registrySource.redistribution.note}`);
      if (registrySource.license.status === 'unknown') warnings.push(`${label} license explicitly unknown; no compliance inference made`);
    }
  }

  const recomputedSummary = summarizeCollections(ledger.collections ?? {});
  if (!sameJson(ledger.summary, recomputedSummary)) errors.push('provenanceLedger summary does not match collection ledger contents');
  return { errors, warnings, registryValidation };
}

const TEXT_FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.geojson', '.html', '.htm', '.xml', '.txt', '.csv', '.map', '.css', '.svg', '.md']);
const BINARY_FILE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.zip', '.gz', '.br', '.mp4', '.webm', '.mp3', '.wav']);

const SECRET_PATTERNS = Object.freeze([
  { id: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9_]{30,255}\b/g },
  { id: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe-secret-key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'jwt-like-token', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'uri-embedded-credential', regex: /https?:\/\/[^\s/:@]+:[^\s/@]+@/g },
  { id: 'secret-query-parameter', regex: /[?&](?:api[-_]?key|key|token|access[-_]?token|secret|password)=[A-Za-z0-9_.~%+/-]{8,}(?=[&#\s"']|$)/gi },
  { id: 'json-secret-assignment', regex: /"(?:apiKey|api_key|apikey|token|accessToken|access_token|secret|password|privateKey)"\s*:\s*"[^"\s]{12,}"/gi },
  { id: 'bearer-token', regex: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}\b/gi },
]);

function collectFiles(inputPath, output = []) {
  if (!existsSync(inputPath)) return output;
  const stat = statSync(inputPath);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(inputPath)) collectFiles(join(inputPath, entry), output);
  } else if (stat.isFile()) output.push(inputPath);
  return output;
}

function probablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte < 8 || (byte > 13 && byte < 32)) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.02;
}

function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return { line, column: index - lastNewline };
}

export function scanSecretShapedMaterial({ paths, secretValues = [], root = process.cwd(), maxFileBytes = 25 * 1024 * 1024 }) {
  const files = [];
  const missingPaths = [];
  for (const input of paths) {
    if (!existsSync(input)) missingPaths.push(input);
    collectFiles(input, files);
  }
  const findings = [];
  const skippedFiles = [];
  let bytesScanned = 0;
  const uniqueFiles = [...new Set(files.map((file) => resolve(file)))];
  const preparedSecrets = [...new Set(secretValues.filter((value) => typeof value === 'string' && value.length >= 8))].map((value) => ({ value, fingerprint: sha256Text(value).slice(0, 16) }));

  for (const file of uniqueFiles) {
    const stat = statSync(file);
    if (stat.size > maxFileBytes) {
      skippedFiles.push({ file: relative(root, file), reason: `exceeds ${maxFileBytes} byte scan cap` });
      continue;
    }
    const extension = extname(file).toLowerCase();
    const buffer = readFileSync(file);
    if (BINARY_FILE_EXTENSIONS.has(extension) || probablyBinary(buffer) || (!TEXT_FILE_EXTENSIONS.has(extension) && buffer.length > 0)) {
      skippedFiles.push({ file: relative(root, file), reason: 'binary or unrecognized file type' });
      continue;
    }
    bytesScanned += buffer.length;
    const text = buffer.toString('utf8');
    const relativeFile = relative(root, file) || basename(file);

    for (const secret of preparedSecrets) {
      let index = text.indexOf(secret.value);
      while (index >= 0) {
        findings.push({
          file: relativeFile,
          patternId: 'exact-configured-secret',
          secretFingerprint: secret.fingerprint,
          matchLength: secret.value.length,
          ...lineAndColumn(text, index),
        });
        index = text.indexOf(secret.value, index + secret.value.length);
      }
    }

    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      for (const match of text.matchAll(pattern.regex)) {
        const raw = match[0];
        findings.push({
          file: relativeFile,
          patternId: pattern.id,
          secretFingerprint: sha256Text(raw).slice(0, 16),
          matchLength: raw.length,
          ...lineAndColumn(text, match.index ?? 0),
        });
      }
    }
  }
  return {
    filesScanned: uniqueFiles.length - skippedFiles.length,
    bytesScanned,
    skippedFiles,
    missingPaths,
    findings,
  };
}

function endpointHosts(source) {
  const hosts = new Set();
  for (const endpoint of source.endpoint?.urls ?? []) {
    try {
      const normalized = endpoint.replaceAll('{MAP_KEY}', 'MAPKEY').replaceAll('{date}', '2026-01-01');
      hosts.add(new URL(normalized).host);
    } catch {}
  }
  return [...hosts].filter(Boolean);
}

export function keyedRegistrySources(registry) {
  return registry.sources.filter((source) => source.access.authentication.required || source.access.authentication.envVars.length > 0 || ['keyed-build-time-only', 'browser-prohibited-by-provider'].includes(source.access.browser.mode));
}

function scanEndpointExposureInText({ text, file, keyedSources, executableContext }) {
  const errors = [];
  const warnings = [];
  const networkUse = /\b(fetch|WebSocket|EventSource|XMLHttpRequest|axios)\b|\.open\s*\(/;
  for (const source of keyedSources) {
    for (const host of endpointHosts(source)) {
      let index = text.indexOf(host);
      while (index >= 0) {
        const context = text.slice(Math.max(0, index - 600), Math.min(text.length, index + host.length + 600));
        const envReference = source.access.authentication.envVars.some((name) => context.includes(name));
        const networkReference = networkUse.test(context);
        const finding = {
          file,
          sourceId: source.id,
          host,
          ...lineAndColumn(text, index),
          contextClassification: networkReference || envReference ? 'network-or-credential-context' : 'informational-string',
        };
        if ((networkReference || envReference) && executableContext) errors.push(finding);
        else warnings.push(finding);
        index = text.indexOf(host, index + host.length);
      }
    }
  }
  return { errors, warnings };
}

export function detectKeyedBrowserExposure({ registry, frontendSrcDir, artifactRoot, root = process.cwd() }) {
  const keyedSources = keyedRegistrySources(registry);
  const errors = [];
  const warnings = [];
  const sourceFiles = collectFiles(frontendSrcDir).filter((file) => TEXT_FILE_EXTENSIONS.has(extname(file).toLowerCase()));
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    const relativeFile = relative(root, file);
    for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const name = match[1];
      if (name !== 'NODE_ENV' && !name.startsWith('NEXT_PUBLIC_')) {
        errors.push({
          file: relativeFile,
          patternId: 'non-public-process-env-in-client-source',
          envVar: name,
          ...lineAndColumn(text, match.index ?? 0),
        });
      }
    }
    const endpointScan = scanEndpointExposureInText({ text, file: relativeFile, keyedSources, executableContext: true });
    errors.push(...endpointScan.errors);
    warnings.push(...endpointScan.warnings);
  }

  if (artifactRoot && existsSync(artifactRoot)) {
    const artifactFiles = collectFiles(artifactRoot).filter((file) => ['.js', '.mjs', '.cjs'].includes(extname(file).toLowerCase()));
    for (const file of artifactFiles) {
      const buffer = readFileSync(file);
      if (probablyBinary(buffer)) continue;
      const text = buffer.toString('utf8');
      const relativeFile = relative(root, file);
      const endpointScan = scanEndpointExposureInText({ text, file: relativeFile, keyedSources, executableContext: true });
      errors.push(...endpointScan.errors);
      warnings.push(...endpointScan.warnings);
    }
  }
  return { errors, warnings, keyedSourceIds: keyedSources.map((source) => source.id).sort() };
}

export function configuredConnectorSecretValues(env = process.env) {
  const names = [
    'WINDY_WEBCAMS_KEY',
    'AISSTREAM_API_KEY',
    'FIRMS_MAP_KEY',
    'ACLED_API_KEY',
    'ACLED_EMAIL',
    'UCDP_API_TOKEN',
    'NVD_API_KEY',
  ];
  return names.map((name) => env[name]).filter((value) => typeof value === 'string' && value.trim().length >= 8).map((value) => value.trim());
}

export function redistributionReviewFindings(snapshotLedger) {
  const findings = [];
  for (const collection of Object.values(snapshotLedger?.collections ?? {})) {
    for (const source of collection.sources ?? []) {
      const review = ['restricted-review', 'unknown'].includes(source.redistribution?.status) || ['license-or-permission-required', 'unknown'].includes(source.redistribution?.bulkPublicExport);
      if (review || source.redistribution?.publicStaticRisk === 'high' || source.license?.status === 'unknown') {
        findings.push({
          collection: collection.collection,
          sourceId: source.sourceId,
          licenseStatus: source.license?.status,
          redistributionStatus: source.redistribution?.status,
          bulkPublicExport: source.redistribution?.bulkPublicExport,
          publicStaticRisk: source.redistribution?.publicStaticRisk,
          note: source.redistribution?.note,
        });
      }
    }
  }
  return findings;
}
