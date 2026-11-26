import { createHash } from 'node:crypto';

/**
 * ReliefWeb humanitarian-intelligence ingestion/normalization (catalog batch 20).
 *
 * Official API facts researched before implementation:
 * - API v2 is JSON over HTTPS at https://api.reliefweb.int/v2; every request requires
 *   a pre-approved appname as a URL query parameter. Missing appname => 400; unapproved
 *   appname => 403. The appname is operational access metadata and is never serialized.
 * - List/search endpoints accept POST JSON. Maximum 1000 entries/call and 10000 calls/day.
 * - Disaster records carry status/name/glide/country/type/date; report records carry title,
 *   dates, countries, source organizations, disaster references, format/theme/type metadata.
 *   `location` is documented only as a country's centroid; reports/disasters do not carry
 *   verified incident coordinates.
 * - ReliefWeb Terms permit personal non-commercial download/copying without a right to resell,
 *   redistribute, or compile/derivative-work the materials. Original sources retain rights.
 *   Consequently this connector stores factual metadata and links only: no body, HTML,
 *   disaster description, headline summary, attachment, image, impact figure, or excerpt.
 */

export const RELIEFWEB_API_BASE_URL = 'https://api.reliefweb.int/v2';
export const RELIEFWEB_API_VERSION = 'v2';
export const RELIEFWEB_DOCUMENTATION_URL = 'https://apidoc.reliefweb.int/';
export const RELIEFWEB_TERMS_URL = 'https://reliefweb.int/terms-conditions';
export const RELIEFWEB_HELP_URL = 'https://reliefweb.int/help';
export const RELIEFWEB_MAX_ENTRIES_PER_CALL = 1000;
export const RELIEFWEB_MAX_CALLS_PER_DAY = 10000;
export const RELIEFWEB_DISASTER_LIMIT = 48;
export const RELIEFWEB_REPORT_LIMIT = 84;
export const RELIEFWEB_COUNTRY_LIMIT = 1000;
export const RELIEFWEB_MAX_RECORDS = 132;
export const RELIEFWEB_MIN_REQUEST_INTERVAL_MS = 350;
export const RELIEFWEB_CONNECTOR_VERSION = 'godseye-reliefweb-humanitarian/2026.11.26.1';

export const RELIEFWEB_METHODOLOGY_CAVEAT = 'ReliefWeb records are humanitarian metadata and document/disaster index entries, not verified incident points. Disaster entries group reporting and carry ReliefWeb workflow status (alert/current/past) and GLIDE/type taxonomy; report entries are situational reports, appeals, maps/infographics, analyses, or other documents as classified by the publisher-supplied ReliefWeb format field. They are never conflict incidents and are never merged into the conflict-incident lattice. Coordinates, when present, are ReliefWeb country centroids joined through the primary country reference: symbolic national placement only. ReliefWeb does not supply incident coordinates, a numeric humanitarian severity scale, casualties, displacement, or people-in-need values in the fields used here; absent values remain null/omitted and are never inferred. Editorial narrative is owned by ReliefWeb sources and is deliberately not redistributed.';

export const RELIEFWEB_REDISTRIBUTION_NOTE = 'ReliefWeb Terms & Conditions restrict redistribution and derivative compilation; materials may be owned by original sources. This artifact therefore retains only titles, identifiers, dates, taxonomy, organizations, links, status, and factual country-centroid georeferences. Report bodies, body-html, headline summaries, disaster descriptions/overviews, attachments, images, and excerpts are intentionally omitted. Users must follow the ReliefWeb/source links for narrative content and contact original sources for reuse permission.';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function textOrNull(value) {
  return nonEmptyString(value) ? value.trim() : null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function validReliefWebCoordinate(lat, lon) {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function createReliefWebOmissionCounts() {
  return {
    invalidApiItem: 0,
    missingRequiredIdentity: 0,
    invalidTimestamps: 0,
    duplicateCanonicalId: 0,
    selectionCap: 0,
  };
}

export function createReliefWebFieldOmissionCounts() {
  return {
    reportBodiesNotRedistributed: 0,
    reportHeadlineSummariesNotRedistributed: 0,
    reportAttachmentsNotIngested: 0,
    reportImagesNotIngested: 0,
    disasterDescriptionsNotRedistributed: 0,
    coordinateLookupMisses: 0,
    invalidCountryCentroidsExcluded: 0,
  };
}

export function createReliefWebMeta(status = 'not-configured') {
  return {
    status,
    provider: 'ReliefWeb API v2 / UN OCHA and original publishing organizations',
    connectorVersion: RELIEFWEB_CONNECTOR_VERSION,
    apiBaseUrl: RELIEFWEB_API_BASE_URL,
    apiVersion: RELIEFWEB_API_VERSION,
    documentationUrl: RELIEFWEB_DOCUMENTATION_URL,
    termsUrl: RELIEFWEB_TERMS_URL,
    appnameConfigured: false,
    authentication: 'approved ReliefWeb appname supplied only as a build-time URL query parameter; its value is never written to the snapshot, registry, ledger, browser bundle, or export',
    plannedCallCount: 3,
    rateLimits: {
      maxEntriesPerCall: RELIEFWEB_MAX_ENTRIES_PER_CALL,
      maxCallsPerDay: RELIEFWEB_MAX_CALLS_PER_DAY,
      minRequestIntervalMs: RELIEFWEB_MIN_REQUEST_INTERVAL_MS,
      requestsAreSerial: true,
    },
    disasterLimit: RELIEFWEB_DISASTER_LIMIT,
    reportLimit: RELIEFWEB_REPORT_LIMIT,
    countryLimit: RELIEFWEB_COUNTRY_LIMIT,
    maxRecords: RELIEFWEB_MAX_RECORDS,
    retrievedAt: null,
    requests: [],
    fetchedDisasterCount: 0,
    fetchedReportCount: 0,
    fetchedCountryReferenceCount: 0,
    validDisasterCount: 0,
    validReportCount: 0,
    coordinateAttachedCount: 0,
    recordsWithoutCoordinates: 0,
    ingestedRecordCount: 0,
    omittedRecordCount: 0,
    omittedByReason: createReliefWebOmissionCounts(),
    fieldOmissions: createReliefWebFieldOmissionCounts(),
    recordKindCounts: {
      disaster: 0,
      'situation-report': 0,
      appeal: 0,
      'map-infographic': 0,
      'other-report': 0,
    },
    redistribution: RELIEFWEB_REDISTRIBUTION_NOTE,
    selection: `Fetches up to ${RELIEFWEB_DISASTER_LIMIT} alert/current ReliefWeb disaster records, up to ${RELIEFWEB_REPORT_LIMIT} latest published reports, and the public country reference table in three serial POST requests, then canonicalizes/deduplicates factual metadata and caps at ${RELIEFWEB_MAX_RECORDS} records. The reports query intentionally excludes body, body-html, headline, files, and images.`,
    caveat: RELIEFWEB_METHODOLOGY_CAVEAT,
    statusDetail: null,
    preservedAt: null,
  };
}

export function reliefwebRecordKind(apiResource, formatName = null) {
  if (apiResource === 'disasters') return 'disaster';
  const format = String(formatName ?? '').toLowerCase();
  if (/situation report|sitrep/.test(format)) return 'situation-report';
  if (/appeal|response plan|humanitarian needs|flash appeal/.test(format)) return 'appeal';
  if (/^(map|infographic)$|map\/infographic|infographic/.test(format)) return 'map-infographic';
  return 'other-report';
}

function normalizeReference(value) {
  if (!value || typeof value !== 'object') return null;
  const id = integerOrNull(value.id);
  const name = textOrNull(value.name);
  if (id === null && !name) return null;
  return {
    id,
    name,
    shortname: textOrNull(value.shortname),
    iso3: textOrNull(value.iso3),
    primary: typeof value.primary === 'boolean' ? value.primary : null,
  };
}

function normalizeCountryReference(value) {
  const reference = normalizeReference(value);
  if (!reference || reference.iso3 === null) return null;
  return {
    id: reference.id,
    name: reference.name,
    shortname: reference.shortname,
    iso3: reference.iso3,
    primary: reference.primary,
  };
}

function normalizeDisasterType(value) {
  if (!value || typeof value !== 'object') return null;
  const name = textOrNull(value.name);
  const code = textOrNull(value.code);
  if (!name && !code) return null;
  return {
    id: integerOrNull(value.id),
    name,
    code,
    primary: typeof value.primary === 'boolean' ? value.primary : null,
  };
}

function normalizeOrganization(value) {
  if (!value || typeof value !== 'object') return null;
  const name = textOrNull(value.name) ?? textOrNull(value.shortname) ?? textOrNull(value.longname);
  if (!name) return null;
  return {
    id: integerOrNull(value.id),
    name,
    shortname: textOrNull(value.shortname),
    longname: textOrNull(value.longname),
    homepage: textOrNull(value.homepage),
    typeName: textOrNull(value.type?.name),
  };
}

function normalizeDisasterReference(value) {
  if (!value || typeof value !== 'object') return null;
  const id = integerOrNull(value.id);
  const name = textOrNull(value.name);
  if (id === null || !name) return null;
  return {
    id,
    name,
    glide: textOrNull(value.glide),
    types: (Array.isArray(value.type) ? value.type : []).map(normalizeDisasterType).filter(Boolean),
  };
}

function normalizeDates(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    created: isoOrNull(input.created),
    changed: isoOrNull(input.changed),
    original: isoOrNull(input.original),
  };
}

function latestTimestamp(dates) {
  return dates.changed ?? dates.created ?? dates.original ?? null;
}

function normalizeCountryIndex(payload, omissions) {
  const index = new Map();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    const fields = row?.fields ?? {};
    const id = integerOrNull(row?.id ?? fields.id);
    const iso3 = textOrNull(fields.iso3);
    const lat = Number(fields.location?.lat);
    const lon = Number(fields.location?.lon);
    if (id === null && !iso3) continue;
    const entry = {
      id,
      iso3,
      name: textOrNull(fields.name),
      shortname: textOrNull(fields.shortname),
      location: null,
    };
    if (Number.isFinite(fields.location?.lat) || Number.isFinite(fields.location?.lon)) {
      if (validReliefWebCoordinate(lat, lon)) {
        entry.location = {
          lat,
          lng: lon,
          precision: 'country-centroid',
          countryIso3: iso3,
          countryName: entry.name ?? entry.shortname ?? iso3,
          basis: 'ReliefWeb country resource location field, documented as centroid coordinates and joined only through the primary-country reference',
          note: 'Symbolic national centroid joined from ReliefWeb country reference data. It is not a report location, not an incident coordinate, not a disaster footprint, and not verification of impact at this point.',
        };
      } else {
        omissions.invalidCountryCentroidsExcluded += 1;
      }
    }
    if (id !== null) index.set(`id:${id}`, entry);
    if (iso3) index.set(`iso3:${iso3.toUpperCase()}`, entry);
  }
  return index;
}

function countryLookup(countryIndex, country) {
  if (!country) return null;
  if (country.id !== null && countryIndex.has(`id:${country.id}`)) return countryIndex.get(`id:${country.id}`);
  if (country.iso3 && countryIndex.has(`iso3:${country.iso3.toUpperCase()}`)) return countryIndex.get(`iso3:${country.iso3.toUpperCase()}`);
  return null;
}

function normalizeCommonIdentity(item, apiResource) {
  const fields = item?.fields ?? {};
  const reliefwebId = integerOrNull(item?.id ?? fields.id);
  const title = apiResource === 'disasters' ? textOrNull(fields.name) : textOrNull(fields.title);
  const url = textOrNull(fields.url);
  if (reliefwebId === null || !title || !url) return null;
  return { fields, reliefwebId, title, url };
}

function normalizeReliefWebItem(item, apiResource, countryIndex, fieldOmissions) {
  const identity = normalizeCommonIdentity(item, apiResource);
  if (!identity) return { record: null, reason: 'missingRequiredIdentity' };
  const { fields, reliefwebId, title, url } = identity;
  const dates = normalizeDates(fields.date);
  if (!dates.created && !dates.changed && !dates.original) return { record: null, reason: 'invalidTimestamps' };
  const primaryCountry = normalizeCountryReference(fields.primary_country) ?? (Array.isArray(fields.country) ? fields.country.map(normalizeCountryReference).find((country) => country?.primary === true) ?? null : null);
  const countries = (Array.isArray(fields.country) ? fields.country : []).map(normalizeCountryReference).filter(Boolean);
  const disasterTypes = (Array.isArray(fields.type) ? fields.type : Array.isArray(fields.disaster_type) ? fields.disaster_type : []).map(normalizeDisasterType).filter(Boolean);
  const primaryType = normalizeDisasterType(fields.primary_type) ?? disasterTypes.find((type) => type.primary === true) ?? disasterTypes[0] ?? null;
  const organizations = (Array.isArray(fields.source) ? fields.source : []).map(normalizeOrganization).filter(Boolean);
  const linkedDisasters = (Array.isArray(fields.disaster) ? fields.disaster : []).map(normalizeDisasterReference).filter(Boolean);
  const format = fields.format?.[0] && typeof fields.format[0] === 'object'
    ? { id: integerOrNull(fields.format[0].id), name: textOrNull(fields.format[0].name) }
    : null;
  const kind = reliefwebRecordKind(apiResource, format?.name);
  const countryReference = primaryCountry ? countryLookup(countryIndex, primaryCountry) : null;
  const location = countryReference?.location ?? null;
  if (primaryCountry && !location) fieldOmissions.coordinateLookupMisses += 1;

  if (apiResource === 'reports') {
    if (nonEmptyString(fields.body) || nonEmptyString(fields['body-html'])) fieldOmissions.reportBodiesNotRedistributed += 1;
    if (nonEmptyString(fields.headline?.summary)) fieldOmissions.reportHeadlineSummariesNotRedistributed += 1;
    if (Array.isArray(fields.file) && fields.file.length > 0) fieldOmissions.reportAttachmentsNotIngested += 1;
    if (fields.image) fieldOmissions.reportImagesNotIngested += 1;
  } else if (nonEmptyString(fields.description) || nonEmptyString(fields['description-html']) || nonEmptyString(fields.profile?.overview) || nonEmptyString(fields.profile?.['overview-html'])) {
    fieldOmissions.disasterDescriptionsNotRedistributed += 1;
  }

  const status = textOrNull(fields.status);
  return {
    record: {
      id: `reliefweb:${apiResource === 'disasters' ? 'disaster' : 'report'}:${reliefwebId}`,
      apiResource,
      recordKind: kind,
      reliefwebId,
      uuid: textOrNull(fields.uuid),
      title,
      url,
      urlAlias: textOrNull(fields.url_alias),
      originUrl: textOrNull(fields.origin),
      status,
      dates,
      publisherTimestamp: latestTimestamp(dates),
      glide: apiResource === 'disasters' ? textOrNull(fields.glide) : null,
      relatedGlide: apiResource === 'disasters' && Array.isArray(fields.related_glide) ? fields.related_glide.filter(nonEmptyString) : [],
      primaryCountry,
      countries,
      disasterTypes,
      primaryType,
      organizations,
      linkedDisasters,
      format,
      themes: (Array.isArray(fields.theme) ? fields.theme : []).map((theme) => ({ id: integerOrNull(theme?.id), name: textOrNull(theme?.name) })).filter((theme) => theme.name),
      languages: (Array.isArray(fields.language) ? fields.language : []).map((language) => ({ id: integerOrNull(language?.id), name: textOrNull(language?.name), code: textOrNull(language?.code) })).filter((language) => language.name || language.code),
      location,
      coordinatePrecision: location?.precision ?? null,
      coordinateNote: location?.note ?? 'No genuinely supplied ReliefWeb country centroid was available for this record; no coordinate was fabricated.',
      alertMetadata: apiResource === 'disasters' && status
        ? {
          status,
          basis: 'ReliefWeb disaster workflow status (alert/current/past); not a numeric severity or impact scale',
          severityScale: null,
        }
        : null,
      severityMetadata: null,
      rights: {
        narrativeIncluded: false,
        excerptIncluded: false,
        attachmentsIncluded: false,
        redistributionNote: RELIEFWEB_REDISTRIBUTION_NOTE,
      },
      methodologyNote: RELIEFWEB_METHODOLOGY_CAVEAT,
    },
    reason: null,
  };
}

function compareRecords(a, b) {
  const timeDelta = (Date.parse(b.publisherTimestamp ?? '') || 0) - (Date.parse(a.publisherTimestamp ?? '') || 0);
  if (timeDelta !== 0) return timeDelta;
  const kindDelta = a.recordKind.localeCompare(b.recordKind);
  if (kindDelta !== 0) return kindDelta;
  return a.id.localeCompare(b.id);
}

export function normalizeReliefWebApiPayloads({ disastersPayload, reportsPayload, countriesPayload, retrievedAt }) {
  const fieldOmissions = createReliefWebFieldOmissionCounts();
  const omissions = createReliefWebOmissionCounts();
  const countryIndex = normalizeCountryIndex(countriesPayload, fieldOmissions);
  const records = [];
  const seen = new Set();
  let validDisasterCount = 0;
  let validReportCount = 0;

  for (const [apiResource, payload] of [['disasters', disastersPayload], ['reports', reportsPayload]]) {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        omissions.invalidApiItem += 1;
        continue;
      }
      const normalized = normalizeReliefWebItem(row, apiResource, countryIndex, fieldOmissions);
      if (!normalized.record) {
        omissions[normalized.reason ?? 'invalidApiItem'] += 1;
        continue;
      }
      if (apiResource === 'disasters') validDisasterCount += 1;
      else validReportCount += 1;
      if (seen.has(normalized.record.id)) {
        omissions.duplicateCanonicalId += 1;
        continue;
      }
      seen.add(normalized.record.id);
      records.push(normalized.record);
    }
  }

  records.sort(compareRecords);
  const retained = records.slice(0, RELIEFWEB_MAX_RECORDS);
  omissions.selectionCap = records.length - retained.length;
  const omittedRecordCount = Object.values(omissions).reduce((sum, value) => sum + value, 0);
  const recordKindCounts = { disaster: 0, 'situation-report': 0, appeal: 0, 'map-infographic': 0, 'other-report': 0 };
  for (const record of retained) recordKindCounts[record.recordKind] += 1;
  const coordinateAttachedCount = retained.filter((record) => record.location !== null).length;

  return {
    records: retained,
    metaCounts: {
      fetchedDisasterCount: Array.isArray(disastersPayload?.data) ? disastersPayload.data.length : 0,
      fetchedReportCount: Array.isArray(reportsPayload?.data) ? reportsPayload.data.length : 0,
      fetchedCountryReferenceCount: Array.isArray(countriesPayload?.data) ? countriesPayload.data.length : 0,
      validDisasterCount,
      validReportCount,
      coordinateAttachedCount,
      recordsWithoutCoordinates: retained.length - coordinateAttachedCount,
      ingestedRecordCount: retained.length,
      omittedRecordCount,
      omittedByReason: omissions,
      fieldOmissions,
      recordKindCounts,
    },
  };
}

function reliefwebRequestBodies() {
  return {
    disasters: {
      profile: 'list',
      preset: 'latest',
      limit: RELIEFWEB_DISASTER_LIMIT,
      sort: ['date.changed:desc'],
      filter: { field: 'status', value: ['alert', 'current'], operator: 'OR' },
      fields: {
        include: [
          'uuid', 'url_alias', 'date.changed', 'related_glide',
          'primary_country.id', 'primary_country.name', 'primary_country.shortname', 'primary_country.iso3', 'primary_country.primary',
          'country.id', 'country.name', 'country.shortname', 'country.iso3', 'country.primary',
          'primary_type.id', 'primary_type.name', 'primary_type.code', 'primary_type.primary',
          'type.id', 'type.name', 'type.code', 'type.primary',
        ],
      },
    },
    reports: {
      profile: 'list',
      preset: 'latest',
      limit: RELIEFWEB_REPORT_LIMIT,
      sort: ['date.created:desc'],
      fields: {
        include: [
          'uuid', 'url_alias', 'date.changed', 'date.original', 'origin',
          'language.id', 'language.name', 'language.code',
          'primary_country.id', 'primary_country.name', 'primary_country.shortname', 'primary_country.iso3', 'primary_country.primary',
          'country.id', 'country.name', 'country.shortname', 'country.iso3', 'country.primary',
          'source.id', 'source.name', 'source.shortname', 'source.longname', 'source.homepage', 'source.type.id', 'source.type.name',
          'disaster.id', 'disaster.name', 'disaster.glide', 'disaster.type.id', 'disaster.type.name', 'disaster.type.code', 'disaster.type.primary',
          'format.id', 'format.name', 'theme.id', 'theme.name',
          'disaster_type.id', 'disaster_type.name', 'disaster_type.code', 'disaster_type.primary',
        ],
        exclude: ['body', 'body-html', 'headline', 'file', 'image'],
      },
    },
    countries: {
      profile: 'list',
      preset: 'analysis',
      limit: RELIEFWEB_COUNTRY_LIMIT,
      fields: { include: ['shortname', 'iso3', 'location.lat', 'location.lon'] },
    },
  };
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildReliefWebRequests(appname) {
  const bodies = reliefwebRequestBodies();
  return Object.entries(bodies).map(([resource, body]) => ({
    resource,
    method: 'POST',
    endpoint: `${RELIEFWEB_API_BASE_URL}/${resource}`,
    url: `${RELIEFWEB_API_BASE_URL}/${resource}?appname=${encodeURIComponent(appname)}`,
    redactedUrl: `${RELIEFWEB_API_BASE_URL}/${resource}?appname=REDACTED_APPROVED_APPNAME`,
    body,
    bodySha256: sha256Json(body),
  }));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectReliefWebHumanitarianIntelligence({ appname, postJson }) {
  const meta = createReliefWebMeta('unavailable');
  meta.appnameConfigured = nonEmptyString(appname);
  if (!meta.appnameConfigured) {
    meta.status = 'not-configured';
    meta.statusDetail = 'RELIEFWEB_APPNAME is not configured; ReliefWeb requires a pre-approved appname on every API request, so no unapproved or generic identifier was used';
    return { records: [], meta, errors: ['ReliefWeb: RELIEFWEB_APPNAME not configured; approved-appname ingestion unavailable'] };
  }

  const retrievedAt = new Date().toISOString();
  const payloads = {};
  const requestLog = [];
  let lastRequestAt = 0;
  try {
    for (const request of buildReliefWebRequests(appname.trim())) {
      const wait = RELIEFWEB_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
      if (lastRequestAt > 0 && wait > 0) await sleep(wait);
      const response = await postJson(request.url, request.body, 24000);
      lastRequestAt = Date.now();
      requestLog.push({
        resource: request.resource,
        method: request.method,
        endpoint: request.endpoint,
        redactedUrl: request.redactedUrl,
        body: request.body,
        bodySha256: request.bodySha256,
        responseCount: Number.isInteger(response?.count) ? response.count : Array.isArray(response?.data) ? response.data.length : null,
        totalCount: Number.isInteger(response?.totalCount) ? response.totalCount : null,
      });
      payloads[request.resource] = response;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    meta.status = 'unavailable';
    meta.statusDetail = `ReliefWeb API ingestion failed before the three-response disaster/report/country contract completed: ${message}`;
    meta.requests = requestLog;
    return { records: [], meta, errors: [`ReliefWeb: ${message}`] };
  }

  const normalized = normalizeReliefWebApiPayloads({
    disastersPayload: payloads.disasters,
    reportsPayload: payloads.reports,
    countriesPayload: payloads.countries,
    retrievedAt,
  });
  Object.assign(meta, normalized.metaCounts);
  meta.status = 'ok';
  meta.retrievedAt = retrievedAt;
  meta.requests = requestLog;
  return { records: normalized.records, meta, errors: [] };
}

export function createPreservedReliefWebMeta(previousMeta, detail, preservedAt) {
  return {
    ...createReliefWebMeta('preserved'),
    ...(previousMeta && typeof previousMeta === 'object' ? previousMeta : {}),
    status: 'preserved',
    preservedAt,
    statusDetail: detail,
  };
}

export function validateReliefWebRecord(record, label, errors) {
  if (!record || typeof record !== 'object') {
    errors.push(`${label} missing or not an object`);
    return;
  }
  if (!/^reliefweb:(disaster|report):\d+$/.test(String(record.id ?? ''))) errors.push(`${label} invalid canonical id`);
  if (!['disasters', 'reports'].includes(record.apiResource)) errors.push(`${label} invalid apiResource`);
  if (!['disaster', 'situation-report', 'appeal', 'map-infographic', 'other-report'].includes(record.recordKind)) errors.push(`${label} invalid recordKind`);
  if (record.apiResource === 'disasters' && record.recordKind !== 'disaster') errors.push(`${label} disaster resource/kind mismatch`);
  if (record.apiResource === 'reports' && record.recordKind === 'disaster') errors.push(`${label} report resource/kind mismatch`);
  if (!Number.isInteger(record.reliefwebId) || record.reliefwebId <= 0) errors.push(`${label} invalid ReliefWeb id`);
  if (!nonEmptyString(record.title) || !/^https:\/\/reliefweb\.int\//.test(String(record.url ?? ''))) errors.push(`${label} missing title or ReliefWeb source URL`);
  if (!isoOrNull(record.dates?.created) && !isoOrNull(record.dates?.changed) && !isoOrNull(record.dates?.original)) errors.push(`${label} missing publisher timestamps`);
  if (!isoOrNull(record.publisherTimestamp)) errors.push(`${label} missing normalized publisher timestamp`);
  if (record.recordKind === 'disaster' && !['alert', 'current', 'past', 'ongoing'].includes(record.status)) errors.push(`${label} invalid disaster status`);
  if (record.recordKind !== 'disaster' && record.glide !== null) errors.push(`${label} report carries disaster-only GLIDE field`);
  if (record.alertMetadata && record.alertMetadata.severityScale !== null) errors.push(`${label} fabricated severity scale`);
  if (record.severityMetadata !== null) errors.push(`${label} severity metadata must remain null unless ReliefWeb supplies a documented scale`);
  if (!Array.isArray(record.countries) || !Array.isArray(record.organizations) || !Array.isArray(record.disasterTypes) || !Array.isArray(record.linkedDisasters)) errors.push(`${label} malformed taxonomy/provenance arrays`);
  if (record.location !== null) {
    if (!validReliefWebCoordinate(record.location?.lat, record.location?.lng)) errors.push(`${label} invalid coordinate`);
    if (record.location?.precision !== 'country-centroid' || record.coordinatePrecision !== 'country-centroid') errors.push(`${label} coordinate precision is not honest country-centroid metadata`);
    if (!String(record.location?.note ?? '').includes('not a report location')) errors.push(`${label} missing non-incident coordinate caveat`);
  } else if (record.coordinatePrecision !== null) {
    errors.push(`${label} location null but precision present`);
  }
  if (record.rights?.narrativeIncluded !== false || record.rights?.excerptIncluded !== false || record.rights?.attachmentsIncluded !== false) errors.push(`${label} redistribution rights flags violated`);
  if ('summary' in record || 'body' in record || 'bodyHtml' in record || 'excerpt' in record) errors.push(`${label} narrative content leaked into normalized record`);
}

export function validateReliefWebMeta(meta, recordCount, errors) {
  if (!meta || typeof meta !== 'object') {
    errors.push('reliefwebMeta missing or not an object');
    return;
  }
  if (!['ok', 'preserved', 'unavailable', 'not-configured'].includes(meta.status)) errors.push('reliefwebMeta invalid status');
  if (meta.apiBaseUrl !== RELIEFWEB_API_BASE_URL || meta.apiVersion !== RELIEFWEB_API_VERSION) errors.push('reliefwebMeta invalid API provenance');
  if (typeof meta.appnameConfigured !== 'boolean') errors.push('reliefwebMeta missing appnameConfigured boolean');
  if (!String(meta.authentication ?? '').includes('never written')) errors.push('reliefwebMeta missing no-secret authentication statement');
  for (const key of ['fetchedDisasterCount', 'fetchedReportCount', 'fetchedCountryReferenceCount', 'validDisasterCount', 'validReportCount', 'coordinateAttachedCount', 'recordsWithoutCoordinates', 'ingestedRecordCount', 'omittedRecordCount']) {
    if (!Number.isInteger(meta[key]) || meta[key] < 0) errors.push(`reliefwebMeta invalid ${key}`);
  }
  const omissionSum = Object.values(meta.omittedByReason ?? {}).reduce((sum, value) => sum + (Number.isInteger(value) ? value : 0), 0);
  if (meta.omittedRecordCount !== omissionSum) errors.push('reliefwebMeta omittedRecordCount does not equal omission reasons');
  if (meta.status === 'ok') {
    if (meta.ingestedRecordCount !== recordCount) errors.push('reliefwebMeta ingestedRecordCount does not match records');
    if (!meta.retrievedAt || !isoOrNull(meta.retrievedAt)) errors.push('reliefwebMeta missing live retrieval timestamp');
    if (!Array.isArray(meta.requests) || meta.requests.length !== 3) errors.push('reliefwebMeta does not account for exactly three disaster/report/country requests');
    else if (!meta.requests.every((request) => request?.method === 'POST' && typeof request?.endpoint === 'string' && typeof request?.redactedUrl === 'string' && request.redactedUrl.includes('REDACTED_APPROVED_APPNAME') && /^[0-9a-f]{64}$/.test(String(request?.bodySha256 ?? '')))) errors.push('reliefwebMeta request audit lacks redacted URLs or body hashes');
  }
  if (!String(meta.caveat ?? '').includes('not verified incident points')) errors.push('reliefwebMeta missing non-incident caveat');
  if (!String(meta.redistribution ?? '').includes('intentionally omitted')) errors.push('reliefwebMeta missing redistribution constraint disclosure');
}
