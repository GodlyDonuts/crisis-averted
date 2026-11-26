#!/usr/bin/env node
/**
 * Deterministic no-network ReliefWeb ingestion harness (catalog batch 20). Fixture names
 * are synthetic; the harness validates schema shape and connector semantics, never claims
 * that fixture geography/disasters are real humanitarian events.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RELIEFWEB_API_BASE_URL,
  RELIEFWEB_MAX_RECORDS,
  buildReliefWebRequests,
  collectReliefWebHumanitarianIntelligence,
  createPreservedReliefWebMeta,
  normalizeReliefWebApiPayloads,
  validateReliefWebMeta,
  validateReliefWebRecord,
} from './lib/reliefweb-ingestion.mjs';

const root = process.cwd();
const fixtureDir = join(root, 'scripts/fixtures/reliefweb');
const readFixture = (name) => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  if (!ok) console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
const fixtures = {
  disastersPayload: readFixture('disasters-response.json'),
  reportsPayload: readFixture('reports-response.json'),
  countriesPayload: readFixture('countries-response.json'),
  retrievedAt: '2026-11-26T12:00:00.000Z',
};

const normalized = normalizeReliefWebApiPayloads(fixtures);
const errors = [];
for (const record of normalized.records) validateReliefWebRecord(record, record.id, errors);
const metaForValidation = {
  status: 'ok', provider: 'fixture', connectorVersion: 'fixture', apiBaseUrl: RELIEFWEB_API_BASE_URL, apiVersion: 'v2', documentationUrl: 'https://apidoc.reliefweb.int/', termsUrl: 'https://reliefweb.int/terms-conditions', appnameConfigured: true, authentication: 'approved appname never written', plannedCallCount: 3,
  rateLimits: { maxEntriesPerCall: 1000, maxCallsPerDay: 10000, minRequestIntervalMs: 350, requestsAreSerial: true }, disasterLimit: 48, reportLimit: 84, countryLimit: 1000, maxRecords: RELIEFWEB_MAX_RECORDS, retrievedAt: fixtures.retrievedAt, requests: buildReliefWebRequests('fixture-approved-appname').map(({ resource, method, endpoint, redactedUrl, body, bodySha256 }) => ({ resource, method, endpoint, redactedUrl, body, bodySha256, responseCount: 1, totalCount: 1 })),
  ...normalized.metaCounts, redistribution: 'fields intentionally omitted', selection: 'fixture', caveat: 'not verified incident points', statusDetail: null, preservedAt: null,
};
validateReliefWebMeta(metaForValidation, normalized.records.length, errors);
check('recorded representative fixture payloads normalize with zero schema errors', errors.length === 0, errors.slice(0, 5).join('; '));
check('fixture yields one disaster plus situation-report/appeal/map-infographic classifications', normalized.metaCounts.recordKindCounts.disaster === 1 && normalized.metaCounts.recordKindCounts['situation-report'] === 1 && normalized.metaCounts.recordKindCounts.appeal === 1 && normalized.metaCounts.recordKindCounts['map-infographic'] === 1, JSON.stringify(normalized.metaCounts.recordKindCounts));
check('normalization is deterministic byte-for-byte', JSON.stringify(normalizeReliefWebApiPayloads(fixtures).records) === JSON.stringify(normalized.records));
check('every record is explicitly namespaced outside the conflict-incident corpus', normalized.records.every((record) => /^reliefweb:(disaster|report):\d+$/.test(record.id) && !String(record.id).startsWith('incident')));
check('all fixture rows carry supplied country centroids with exact country-centroid precision', normalized.metaCounts.coordinateAttachedCount === normalized.records.length && normalized.records.every((record) => record.coordinatePrecision === 'country-centroid' && record.location?.precision === 'country-centroid'));
check('coordinate notes explicitly reject incident-point interpretation', normalized.records.every((record) => record.location?.note.includes('not a report location') && record.location.note.includes('not an incident')));
check('disaster alert metadata preserves workflow status without inventing a severity scale', normalized.records.find((record) => record.recordKind === 'disaster')?.alertMetadata?.status === 'current' && normalized.records.every((record) => record.severityMetadata === null));
check('source organizations, GLIDE, original URLs, publisher timestamps, and canonical URLs are preserved', normalized.records.some((record) => record.glide === 'FL-2026-000001-FFX') && normalized.records.filter((record) => record.apiResource === 'reports').every((record) => record.originUrl?.startsWith('https://') && record.organizations.length > 0 && record.publisherTimestamp && record.url.startsWith('https://reliefweb.int/')));
check('fixture narrative fields trigger redistribution omission accounting without narrative leakage', normalized.metaCounts.fieldOmissions.reportBodiesNotRedistributed >= 1 && normalized.metaCounts.fieldOmissions.reportHeadlineSummariesNotRedistributed >= 1 && normalized.metaCounts.fieldOmissions.reportAttachmentsNotIngested >= 1 && normalized.metaCounts.fieldOmissions.disasterDescriptionsNotRedistributed >= 1 && !JSON.stringify(normalized.records).includes('Fixture narrative body'));
check('omission accounting is exact and nonnegative', normalized.metaCounts.omittedRecordCount === Object.values(normalized.metaCounts.omittedByReason).reduce((sum, value) => sum + value, 0));

// Adversarial coordinates and identity defects are rejected rather than repaired/invented.
const adversarial = structuredClone(fixtures);
adversarial.countriesPayload.data[0].fields.location = { lat: 120, lon: 45 };
adversarial.reportsPayload.data.push({ id: 8999, fields: { title: 'Missing canonical URL fixture', date: { created: '2026-11-25T00:00:00+00:00' } } });
adversarial.reportsPayload.data.push(structuredClone(adversarial.reportsPayload.data[0]));
const bad = normalizeReliefWebApiPayloads(adversarial);
check('invalid country centroids are excluded and missing identity/duplicates are counted', bad.metaCounts.fieldOmissions.invalidCountryCentroidsExcluded >= 1 && bad.metaCounts.omittedByReason.missingRequiredIdentity >= 1 && bad.metaCounts.omittedByReason.duplicateCanonicalId >= 1, JSON.stringify({ omissions: bad.metaCounts.omittedByReason, fields: bad.metaCounts.fieldOmissions }));
check('rows whose country centroid is invalid retain no coordinate and are never re-geocoded', bad.records.filter((record) => record.primaryCountry?.iso3 === 'FFX').every((record) => record.location === null && record.coordinatePrecision === null));

const requests = buildReliefWebRequests('fixture-approved-appname');
check('requests are exactly three serial POST contracts for disasters/reports/countries', requests.length === 3 && requests.every((request) => request.method === 'POST' && request.endpoint.startsWith(RELIEFWEB_API_BASE_URL)));
check('request audit material redacts appname and query intentionally excludes narrative fields', requests.every((request) => !request.redactedUrl.includes('fixture-approved-appname')) && requests.find((request) => request.resource === 'reports')?.body.fields.exclude.includes('body') && requests.find((request) => request.resource === 'reports')?.body.fields.exclude.includes('headline'));
check('serialized request log cannot leak the appname', !JSON.stringify(requests.map(({ resource, method, endpoint, redactedUrl, body }) => ({ resource, method, endpoint, redactedUrl, body }))).includes('fixture-approved-appname'));

let networkAttempted = false;
const notConfigured = await collectReliefWebHumanitarianIntelligence({ appname: '', postJson: async () => { networkAttempted = true; throw new Error('network must not be attempted'); } });
check('missing approved appname short-circuits before any network request', notConfigured.meta.status === 'not-configured' && notConfigured.records.length === 0 && networkAttempted === false);

const preserved = createPreservedReliefWebMeta({ ...metaForValidation, retrievedAt: '2026-11-25T00:00:00.000Z' }, 'fixture failure', '2026-11-26T00:00:00.000Z');
check('preservation retains original retrieval time and marks a separate preserved time', preserved.status === 'preserved' && preserved.retrievedAt === '2026-11-25T00:00:00.000Z' && preserved.preservedAt === '2026-11-26T00:00:00.000Z');

const failed = checks.filter((entry) => !entry.ok);
console.log(`reliefweb-ingestion: ${checks.length - failed.length}/${checks.length} checks passed`);
for (const entry of checks) console.log(`  ${entry.ok ? 'ok' : 'FAIL'} ${entry.name}`);
if (failed.length > 0) process.exit(1);
