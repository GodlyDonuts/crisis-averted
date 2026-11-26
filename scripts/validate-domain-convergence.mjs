#!/usr/bin/env node
/**
 * Deterministic validation harness for catalog batch 7 (multi-domain convergence intelligence).
 *
 * What it does:
 *  1. Transpiles the frontend TypeScript convergence engine and its temporal dependency with
 *     the repository's pinned typescript compiler, rewriting @/ aliases and the h3-js import
 *     onto a temp module graph (no network, no test framework).
 *  2. Runs fixture assertions per evidence domain: spatial-temporal gates must hold, coarse
 *     centroids must never fabricate evidence, structurally expected co-occurrence must read
 *     as coincidence, aviation-derived domains must collapse into one measurement family,
 *     media attention must never count as independent corroboration, and the whole pipeline
 *     must be byte-stable under input reordering.
 *  3. Runs a real-data smoke/performance pass over the committed public snapshot.
 *
 * Exit code 0 means every assertion passed.
 */
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');

const typescript = require(path.join(frontendDir, 'node_modules', 'typescript'));

// ---------------------------------------------------------------------------
// Transpilation helpers
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-convergence-'));

function transpileModule(tsPath, outName, rewriteMap = {}) {
  const source = fs.readFileSync(tsPath, 'utf8');
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2020,
      module: typescript.ModuleKind.ES2020,
      isolatedModules: true,
    },
    fileName: path.basename(tsPath),
  }).outputText;
  let rewritten = output;
  for (const [specifier, replacement] of Object.entries(rewriteMap)) {
    rewritten = rewritten.split(`"${specifier}"`).join(`"${replacement}"`);
    rewritten = rewritten.split(`'${specifier}'`).join(`'${replacement}'`);
  }
  const outPath = path.join(tempDir, outName);
  fs.writeFileSync(outPath, rewritten);
  return outPath;
}

fs.writeFileSync(path.join(tempDir, 'assets-stub.mjs'), 'export const assetPath = (value) => value;\n');

// h3-js ships an emscripten ES build that references __dirname (undefined in Node ESM).
// The CommonJS build works cleanly, so the harness generates a small ESM adapter that
// re-exports the CJS functions the engine imports.
const h3CjsPath = path.join(frontendDir, 'node_modules', 'h3-js', 'dist', 'h3-js.js').replace(/\\/g, '/');
fs.writeFileSync(path.join(tempDir, 'h3-adapter.mjs'), `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const h3 = require(${JSON.stringify(h3CjsPath)});
export const cellToBoundary = h3.cellToBoundary;
export const cellToLatLng = h3.cellToLatLng;
export const getResolution = h3.getResolution;
export const isValidCell = h3.isValidCell;
export const latLngToCell = h3.latLngToCell;
`);
const h3AdapterSpecifier = './h3-adapter.mjs';
const h3AdapterUrl = pathToFileURL(path.join(tempDir, 'h3-adapter.mjs')).href;

const incidentTimePath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'incidentTime.ts'),
  'incidentTime.mjs',
);
const convergencePath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'domainConvergence.ts'),
  'domainConvergence.mjs',
  {
    '@/lib/incidentTime': './incidentTime.mjs',
    'h3-js': h3AdapterSpecifier,
  },
);
const correlationPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'incidentCorrelation.ts'),
  'incidentCorrelation.mjs',
  {
    '@/lib/incidentTime': './incidentTime.mjs',
  },
);
const conflictDataPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'conflictData.ts'),
  'conflictData.mjs',
  {
    '@/lib/assets': './assets-stub.mjs',
    '@/lib/incidentCorrelation': './incidentCorrelation.mjs',
    '@/lib/incidentTime': './incidentTime.mjs',
  },
);

const convergence = await import(`file://${convergencePath.replace(/\\/g, '/')}`);
const conflictData = await import(`file://${conflictDataPath.replace(/\\/g, '/')}`);
const h3 = await import(h3AdapterUrl);

const {
  analyzeDomainConvergence,
  assessConvergencePair,
  buildIncidentAnchor,
  buildEvidenceLayers,
  buildConvergenceAnalystSummary,
  canonicalizeCountryKey,
  CONVERGENCE_DISCLAIMER,
} = convergence;

// ---------------------------------------------------------------------------
// Assertion plumbing
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0); // 2026-11-26T12:00Z, fixed for determinism
const HOUR = 36e5;
const DAY = 24 * HOUR;
const NOV25_NOON = Date.UTC(2026, 10, 25, 12, 0, 0);
const FETCHED_AT = '2026-11-26T12:00:00.000Z';

let fixtureSeq = 0;
function makeEvent(overrides = {}) {
  fixtureSeq += 1;
  return {
    id: overrides.id || `fixture-${fixtureSeq}`,
    lat: 51.5,
    lng: 106.0,
    precision: 2,
    severity: 'high',
    category: 'airstrike',
    categoryGroup: 'kinetic',
    date: '2026-11-25',
    occurredAt: NOV25_NOON,
    updatedAt: NOV25_NOON,
    killed: 0,
    countedCasualties: 0,
    displaced: 0,
    country: 'Mongolia',
    conflict: 'Test conflict',
    theater: 'test-conflict',
    region: 'Asia',
    title: 'Test incident',
    verified: false,
    sourceName: null,
    sourceUrl: null,
    sources: [],
    intensity: 0.5,
    sourceFamily: 'warheatmap',
    ...overrides,
  };
}

function emptyEvidence(overrides = {}) {
  return {
    fetchedAt: FETCHED_AT,
    sources: {},
    militaryAircraft: [],
    aircraft: [],
    vessels: [],
    launches: [],
    naturalEvents: [],
    gpsInterference: [],
    internetOutages: [],
    gdeltGeoNews: [],
    ...overrides,
  };
}

function gnssCellAt(lat, lng, overrides = {}) {
  return {
    hex: h3.latLngToCell(lat, lng, 4),
    goodAircraft: 1,
    badAircraft: 3,
    aircraftCount: 4,
    affectedShare: 0.75,
    level: 'high',
    ...overrides,
  };
}

function findFinding(card, domain) {
  return card?.domains.find((alignment) => alignment.domain === domain) ?? null;
}

// ---------------------------------------------------------------------------
// Scenario 1: GNSS interference convergence
// ---------------------------------------------------------------------------
console.log('\nscenario 1: GNSS interference spatial-temporal gates and coarse-anchor refusal');
{
  const incident = makeEvent({ id: 'ev-gnss', occurredAt: NOV25_NOON });
  const evidence = emptyEvidence({
    gpsInterference: [gnssCellAt(incident.lat, incident.lng)],
    sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
  });
  const result = analyzeDomainConvergence([incident], evidence);
  const card = result.cards.find((candidate) => candidate.eventId === 'ev-gnss');
  check('incident inside interference cell on the interference day receives a card', Boolean(card));
  const alignment = findFinding(card, 'gnss-interference');
  check('gnss alignment qualifies as independent evidence', alignment?.qualifies === true, JSON.stringify(alignment?.bestScore));
  check('gnss finding reports edge-adjusted zero distance inside the cell', (alignment?.findings[0]?.effectiveDistanceKm ?? 99) === 0);
  check('gnss finding carries ordered factor rationale', (alignment?.findings[0]?.rationale.length ?? 0) >= 3);
  check('gnss rationale cites interference strength', alignment?.findings[0]?.rationale.some((line) => line.startsWith('interference strength:')) === true);
  check('gnss rationale discloses aviation-derived measurement family', Boolean(alignment?.findings[0]?.provenance.note?.includes('aviation-derived')));

  // same position, incident four days earlier — outside the 30h temporal gate
  const stale = makeEvent({ id: 'ev-gnss-stale', occurredAt: NOV25_NOON - 4 * DAY });
  const staleResult = analyzeDomainConvergence([stale], evidence);
  check('incident four days before the interference grid produces no gnss finding',
    !staleResult.cards.some((card) => card.eventId === 'ev-gnss-stale' && findFinding(card, 'gnss-interference')));

  // country-precision (6) incident fix — distance from a shared centroid is noise, refused
  const coarse = makeEvent({ id: 'ev-gnss-coarse', precision: 6, occurredAt: NOV25_NOON });
  const coarseResult = analyzeDomainConvergence([coarse], evidence);
  check('country-precision incident fix is refused distance-based convergence',
    !coarseResult.cards.some((card) => card.eventId === 'ev-gnss-coarse' && findFinding(card, 'gnss-interference')),
    'coarse anchor must not fabricate convergence from centroid proximity');

  // weak interference share depresses the strength factor deterministically
  const weakResult = analyzeDomainConvergence(
    [incident],
    emptyEvidence({
      gpsInterference: [gnssCellAt(incident.lat, incident.lng, { affectedShare: 0.08, level: 'low', badAircraft: 1, aircraftCount: 12 })],
      sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
    }),
  );
  const weakScore = findFinding(weakResult.cards.find((card) => card.eventId === 'ev-gnss'), 'gnss-interference')?.bestScore ?? 1;
  const strongScore = alignment?.bestScore ?? 0;
  check('low affected-share interference scores strictly weaker than high share', weakScore < strongScore, `${weakScore} vs ${strongScore}`);
}

// ---------------------------------------------------------------------------
// Scenario 2: military aviation snapshot-instant behavior
// ---------------------------------------------------------------------------
console.log('\nscenario 2: military aviation mobility-aware temporal evidence');
{
  const incident = makeEvent({ id: 'ev-milair', lat: 50.0, lng: 36.5, occurredAt: NOV25_NOON });
  const aircraftNear = {
    id: 'ae1234', callsign: 'RCH001', registration: null, aircraftType: 'C17',
    lat: 50.1, lng: 36.6, altitude: 25000, speed: 420, track: 90, squawk: '2000',
  };
  const evidence = emptyEvidence({ militaryAircraft: [aircraftNear] });
  // snapshot fetchedAt = NOW (2026-11-26T12:00Z) — exactly 24h after the incident
  const result = analyzeDomainConvergence([incident], evidence);
  check('aircraft position 24h after the incident is outside the 5h fast-mover gate',
    !result.cards.some((card) => card.eventId === 'ev-milair' && findFinding(card, 'military-aviation')));

  // snapshot 30 minutes after the incident — inside the gate
  const closeEvidence = emptyEvidence({ militaryAircraft: [aircraftNear], fetchedAt: '2026-11-25T12:30:00.000Z' });
  const closeResult = analyzeDomainConvergence([incident], closeEvidence);
  const closeCard = closeResult.cards.find((card) => card.eventId === 'ev-milair');
  const closeAlignment = findFinding(closeCard, 'military-aviation');
  check('aircraft position 30min after the incident within 15km qualifies', closeAlignment?.qualifies === true, JSON.stringify(closeAlignment?.bestScore));
  check('fast-mover rationale discloses position staleness', closeAlignment?.findings[0]?.rationale.some((line) => line.includes('fast mover')) === true);
  check('military aviation provenance discloses snapshot-instant approximation',
    closeAlignment?.findings[0]?.provenance.note?.includes('snapshot retrieval instant') === true);

  // day-precision incident window covering the snapshot instant — overlap, but discounted
  const dayIncident = makeEvent({
    id: 'ev-milair-day', lat: 50.0, lng: 36.5,
    occurredAt: Date.UTC(2026, 10, 26, 0, 0, 0), // UTC midnight => inferred day window
  });
  const dayResult = analyzeDomainConvergence([dayIncident], evidence);
  const dayAlignment = findFinding(dayResult.cards.find((card) => card.eventId === 'ev-milair-day'), 'military-aviation');
  check('day-precision incident overlapping the aircraft instant still converges', Boolean(dayAlignment));
  check('day-precision overlap is discounted for fast movers',
    (dayAlignment?.findings[0]?.score ?? 1) < 0.95,
    `score ${dayAlignment?.findings[0]?.score}`);
  check('day-overlap rationale says same-period presence only',
    dayAlignment?.findings[0]?.rationale.some((line) => line.includes('same-period presence')) === true);
}

// ---------------------------------------------------------------------------
// Scenario 3: civil aviation structural coincidence vs emergency squawk
// ---------------------------------------------------------------------------
console.log('\nscenario 3: civil aviation coincidence discipline');
{
  const incident = makeEvent({ id: 'ev-civair', lat: 52.2, lng: 21.0, occurredAt: NOW - 1 * HOUR });
  const civil = {
    id: 'ab0001', callsign: 'LOT123', originCountry: 'Poland', lat: 52.21, lng: 21.02,
    altitude: 34000, speed: 460, track: 100, verticalRate: 0, squawk: '1000',
    operatorClass: 'civil/commercial', lastContact: '2026-11-26T11:20:00.000Z',
  };
  const evidence = emptyEvidence({ aircraft: [civil] });
  const result = analyzeDomainConvergence([incident], evidence);
  const card = result.cards.find((candidate) => candidate.eventId === 'ev-civair');
  const alignment = findFinding(card, 'civil-aviation');
  check('tight civil aviation overlap still produces a finding (transparency, not deletion)', Boolean(alignment));
  check('civil aviation without emergency squawk never qualifies', alignment?.qualifies === false);
  check('refusal rationale is attached', alignment?.findings[0]?.rationale.some((line) => line.includes('structurally expected coincidence')) === true);
  check('card with only civil aviation overlap classifies as coincidence', card?.classification === 'coincidence', card?.classification);

  const emergency = { ...civil, squawk: '7700' };
  const emergencyResult = analyzeDomainConvergence([incident], emptyEvidence({ aircraft: [emergency] }));
  const emergencyAlignment = findFinding(emergencyResult.cards.find((candidate) => candidate.eventId === 'ev-civair'), 'civil-aviation');
  check('civil aircraft squawking 7700 in tight overlap qualifies', emergencyAlignment?.qualifies === true);
  check('squawk factor rationale cites the emergency code', emergencyAlignment?.findings[0]?.rationale.some((line) => line.includes('7700')) === true);
}

// ---------------------------------------------------------------------------
// Scenario 4: launches are structurally coincidence-only
// ---------------------------------------------------------------------------
console.log('\nscenario 4: launch co-occurrence can never become evidence');
{
  const incident = makeEvent({ id: 'ev-launch', lat: 28.3, lng: 102.0, occurredAt: NOW - 2 * HOUR, category: 'missile', country: 'China' });
  const launch = {
    id: 'launch-1', name: 'Long March 2D | Unknown Payload', provider: 'CASC',
    location: 'Xichang', lat: 28.24, lng: 102.02, net: '2026-11-26T11:00:00Z',
    url: 'https://example.test/launch',
  };
  const result = analyzeDomainConvergence([incident], emptyEvidence({ launches: [launch] }));
  const card = result.cards.find((candidate) => candidate.eventId === 'ev-launch');
  const alignment = findFinding(card, 'space-launch');
  check('near-perfect launch overlap still produces a finding', Boolean(alignment));
  check('launch finding never qualifies regardless of overlap strength', alignment?.qualifies === false);
  check('launch rationale explains scheduled-in-advance coincidence', alignment?.findings[0]?.rationale.some((line) => line.includes('weeks to months in advance')) === true);
  check('launch-only card is coincidence-class', card?.classification === 'coincidence', card?.classification);
}

// ---------------------------------------------------------------------------
// Scenario 5: environmental events — independent compound-stress evidence
// ---------------------------------------------------------------------------
console.log('\nscenario 5: environmental convergence');
{
  const incident = makeEvent({ id: 'ev-env', lat: 37.0, lng: 37.5, occurredAt: NOV25_NOON, country: 'Syria' });
  const quake = {
    id: 'usgs-test', title: 'M 5.8 - 12 km NW of test', category: 'Earthquake', kind: 'earthquake',
    lat: 37.05, lng: 37.52, occurredAt: '2026-11-25T18:00:00.000Z', magnitude: 5.8, magnitudeUnit: 'M', url: 'https://example.test/eq',
  };
  const result = analyzeDomainConvergence([incident], emptyEvidence({ naturalEvents: [quake] }));
  const alignment = findFinding(result.cards.find((candidate) => candidate.eventId === 'ev-env'), 'environmental-event');
  check('same-day earthquake within 10km qualifies as independent evidence', alignment?.qualifies === true, JSON.stringify(alignment?.bestScore));
  check('significance factor cites magnitude scaling', alignment?.findings[0]?.rationale.some((line) => line.startsWith('significance: earthquake magnitude')) === true);
  check('earthquake convergence never claims causation', alignment?.findings[0]?.provenance.note?.includes('never causation') === true);

  const far = { ...quake, lat: 39.8, lng: 37.5 };
  const farResult = analyzeDomainConvergence([incident], emptyEvidence({ naturalEvents: [far] }));
  check('earthquake 200km away produces no environmental finding',
    !farResult.cards.some((card) => findFinding(card, 'environmental-event')));
}

// ---------------------------------------------------------------------------
// Scenario 6: connectivity outages — region distance, country name matching
// ---------------------------------------------------------------------------
console.log('\nscenario 6: connectivity evidence honesty');
{
  const incident = makeEvent({ id: 'ev-ioda', lat: 49.5, lng: 44.4, occurredAt: NOV25_NOON, country: 'Russia' });
  const regionOutage = {
    entityType: 'region', entityCode: '3442', entityName: 'Volgograd', countryCode: 'RU', countryName: 'Russian Federation',
    naturalEarthRegionId: '2369', lat: 49.50, lng: 44.45, coordinatePrecision: 'region-reference',
    coordinateNote: 'test', from: Math.floor(NOV25_NOON / 1000) - 3600, until: Math.floor(NOV25_NOON / 1000) + 7200,
    score: 27.7, datasource: 'bgp', method: 'median', fromBeforeQueryWindow: false, untilEqualsQueryHorizon: false,
  };
  const result = analyzeDomainConvergence([incident], emptyEvidence({ internetOutages: [regionOutage] }));
  const alignment = findFinding(result.cards.find((candidate) => candidate.eventId === 'ev-ioda'), 'connectivity-outage');
  check('overlapping region-scope outage at close distance qualifies', alignment?.qualifies === true, JSON.stringify(alignment?.bestScore));
  check('region-scope spatial discount is disclosed', alignment?.findings[0]?.rationale.some((line) => line.includes('discounted')) === true);
  check('connectivity provenance never implies cause', alignment?.findings[0]?.provenance.note?.includes('never why') === true);

  // country-scope: reference point 600km away must still match by canonicalized country name
  const countryOutage = {
    ...regionOutage, entityType: 'country', entityCode: 'RU', entityName: 'Russian Federation', lat: 55.7, lng: 37.6,
    coordinatePrecision: 'country-reference',
  };
  const countryResult = analyzeDomainConvergence([incident], emptyEvidence({ internetOutages: [countryOutage] }));
  const countryAlignment = findFinding(countryResult.cards.find((candidate) => candidate.eventId === 'ev-ioda'), 'connectivity-outage');
  check('country-scope outage matches same-country incident despite distant symbolic reference point', Boolean(countryAlignment));
  check('country-scope rationale discloses fixed weak national-level weight', countryAlignment?.findings[0]?.rationale.some((line) => line.includes('weak national-level weight')) === true);
  check('country canonicalization bridged Russia vs Russian Federation', canonicalizeCountryKey('Russia') === canonicalizeCountryKey('Russian Federation'));

  // country mismatch — no pair at all
  const foreignIncident = makeEvent({ id: 'ev-ioda-foreign', lat: 49.5, lng: 44.4, occurredAt: NOV25_NOON, country: 'Kazakhstan' });
  const mismatchResult = analyzeDomainConvergence([foreignIncident], emptyEvidence({ internetOutages: [countryOutage] }));
  check('country-name mismatch rejects country-scope connectivity evidence',
    !mismatchResult.cards.some((card) => findFinding(card, 'connectivity-outage')));
  check('mismatched country rows are never even evaluated', mismatchResult.stats.countryScopeEvaluationCount === 0, `${mismatchResult.stats.countryScopeEvaluationCount}`);
}

// ---------------------------------------------------------------------------
// Scenario 7: media attention — derivative context, never independent
// ---------------------------------------------------------------------------
console.log('\nscenario 7: media attention discipline');
{
  const incident = makeEvent({ id: 'ev-media', lat: 55.75, lng: 37.61, occurredAt: NOW - 3 * HOUR, country: 'Russia' });
  const mention = {
    id: 'gdeltgeo:test1', url: 'https://example.test/article', title: 'Test headline', domain: 'example.test',
    collection: 'english-web', locationName: 'Moscow, Moskva, Russia', locationType: 4,
    coordinatePrecision: 'world-city-or-landmark', countryCode: 'RS', adm1Code: 'RS48', featureId: '-2960561',
    lat: 55.7522, lng: 37.6156, proximityChars: 7, themes: ['ARMEDCONFLICT'], tone: -5.3,
    positiveScore: null, negativeScore: null, wordCount: null, sharingImage: null,
    slotTime: '2026-11-26T11:45:00.000Z', seenAt: null,
  };
  const result = analyzeDomainConvergence([incident], emptyEvidence({ gdeltGeoNews: [mention] }));
  const card = result.cards.find((candidate) => candidate.eventId === 'ev-media');
  const alignment = findFinding(card, 'media-attention');
  check('city-level media mention in tight overlap aligns', Boolean(alignment));
  check('media alignment can qualify as attention context', alignment?.qualifies === true);
  check('media-only card remains coincidence-class because media is never independent', card?.classification === 'coincidence', card?.classification);
  check('media classification reason explains derivative coverage', card?.classificationReason.includes('same event ecosystem') === true);

  // centroid-precision mention — never evidence even in tight overlap
  const centroidMention = { ...mention, id: 'gdeltgeo:test2', coordinatePrecision: 'world-admin1-centroid', locationType: 5, proximityChars: 9 };
  const centroidResult = analyzeDomainConvergence([incident], emptyEvidence({ gdeltGeoNews: [centroidMention] }));
  const centroidAlignment = findFinding(centroidResult.cards.find((candidate) => candidate.eventId === 'ev-media'), 'media-attention');
  check('admin-1 centroid mention is still surfaced as context', Boolean(centroidAlignment));
  check('admin-1 centroid mention never qualifies', centroidAlignment?.qualifies === false);
  check('centroid refusal rationale attached', centroidAlignment?.findings[0]?.rationale.some((line) => line.includes('centroid')) === true);
}

// ---------------------------------------------------------------------------
// Scenario 8: measurement-family independence — the corroboration bar
// ---------------------------------------------------------------------------
console.log('\nscenario 8: aviation-derived domains collapse into one family');
{
  const incident = makeEvent({ id: 'ev-family', lat: 51.5, lng: 106.0, occurredAt: NOV25_NOON });
  const militaryClose = {
    id: 'ae9999', callsign: 'MIL01', registration: null, aircraftType: 'E3',
    lat: 51.52, lng: 106.02, altitude: 30000, speed: 400, track: 270, squawk: null,
  };
  const sharedEvidence = emptyEvidence({
    gpsInterference: [gnssCellAt(incident.lat, incident.lng)],
    militaryAircraft: [militaryClose],
    fetchedAt: '2026-11-25T12:30:00.000Z',
    sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
  });
  const result = analyzeDomainConvergence([incident], sharedEvidence);
  const card = result.cards.find((candidate) => candidate.eventId === 'ev-family');
  const gnssAlignment = findFinding(card, 'gnss-interference');
  const airAlignment = findFinding(card, 'military-aviation');
  check('gnss alignment qualifies', gnssAlignment?.qualifies === true);
  check('military aviation alignment qualifies', airAlignment?.qualifies === true);
  check('gnss + military aviation is correlation, NOT corroboration — same aviation-derived family',
    card?.classification === 'correlation', card?.classification);
  check('independent family count collapses to one', card?.independentFamilyCount === 1, `${card?.independentFamilyCount}`);

  // adding an overlapping connectivity outage — a genuinely independent family — corroborates
  const regionOutage = {
    entityType: 'region', entityCode: '9999', entityName: 'Test region', countryCode: 'MN', countryName: 'Mongolia',
    naturalEarthRegionId: null, lat: 51.52, lng: 106.02, coordinatePrecision: 'region-reference',
    coordinateNote: 'test', from: Math.floor(NOV25_NOON / 1000) - 1800, until: Math.floor(NOV25_NOON / 1000) + 3600,
    score: 40, datasource: 'bgp', method: 'median', fromBeforeQueryWindow: false, untilEqualsQueryHorizon: false,
  };
  const corroboratedResult = analyzeDomainConvergence(
    [incident],
    emptyEvidence({
      gpsInterference: [gnssCellAt(incident.lat, incident.lng)],
      militaryAircraft: [militaryClose],
      internetOutages: [regionOutage],
      fetchedAt: '2026-11-25T12:30:00.000Z',
      sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
    }),
  );
  const corroboratedCard = corroboratedResult.cards.find((candidate) => candidate.eventId === 'ev-family');
  check('aviation + connectivity families corroborate', corroboratedCard?.classification === 'corroboration', corroboratedCard?.classification);
  check('corroboration card reports two independent families', corroboratedCard?.independentFamilyCount === 2, `${corroboratedCard?.independentFamilyCount}`);
  check('corroboration reason names co-occurrence geometry not causation', corroboratedCard?.classificationReason.includes('not causation') === true);

  // media added on top of corroboration strengthens context but never the family count
  const mention = {
    id: 'gdeltgeo:fam', url: 'https://example.test/a', title: null, domain: 'example.test',
    collection: 'english-web', locationName: 'Test city', locationType: 4,
    coordinatePrecision: 'world-city-or-landmark', countryCode: 'MN', adm1Code: null, featureId: null,
    lat: 51.51, lng: 106.01, proximityChars: 20, themes: ['ARMEDCONFLICT'], tone: null,
    positiveScore: null, negativeScore: null, wordCount: null, sharingImage: null,
    slotTime: '2026-11-25T13:00:00.000Z', seenAt: null,
  };
  const withMedia = analyzeDomainConvergence(
    [incident],
    emptyEvidence({
      gpsInterference: [gnssCellAt(incident.lat, incident.lng)],
      internetOutages: [regionOutage],
      gdeltGeoNews: [mention],
      sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
    }),
  );
  const mediaCard = withMedia.cards.find((candidate) => candidate.eventId === 'ev-family');
  check('media alignment never inflates the independent family count', mediaCard?.independentFamilyCount === 2, `${mediaCard?.independentFamilyCount}`);
}

// ---------------------------------------------------------------------------
// Scenario 8b: AIS vessels — maritime independence family, temporal gates, corroboration
// ---------------------------------------------------------------------------
console.log('\nscenario 8b: AIS vessel convergence and cross-family corroboration');
{
  function makeVessel(overrides = {}) {
    return {
      id: 'vessel-1', mmsi: 211000001, imo: 9000001, name: 'MV TEST MERCHANT', callSign: 'DAAA',
      destination: 'CONSTANTA', shipType: 70, vesselClass: 'cargo', navigationStatus: 'under way using engine',
      lat: 44.15, lng: 28.65, speed: 12, course: 180, heading: 180,
      timestamp: '2026-11-25T13:00:00.000Z', source: 'aisstream.io',
      ...overrides,
    };
  }
  const incident = makeEvent({ id: 'ev-ais', lat: 44.16, lng: 28.66, occurredAt: NOV25_NOON, category: 'naval' });

  // tight overlap: 1h after incident, ~1.5 km away — inside 12 km full radius and 8h gate
  const tightResult = analyzeDomainConvergence([incident], emptyEvidence({ vessels: [makeVessel()] }));
  const tightCard = tightResult.cards.find((card) => card.eventId === 'ev-ais');
  const tightAlignment = findFinding(tightCard, 'ais-vessel');
  check('tight AIS overlap produces a finding', Boolean(tightAlignment));
  check('tight AIS overlap qualifies as independent evidence', tightAlignment?.qualifies === true, JSON.stringify(tightAlignment?.bestScore));
  check('AIS alignment reports the maritime independence family', tightAlignment?.family === 'maritime-ais', tightAlignment?.family);
  check('AIS coverage note discloses voluntary-transmission limit', Boolean(tightAlignment?.coverageNote?.includes('voluntarily transmitting')));
  check('AIS provenance discloses single-position nature', Boolean(tightAlignment?.findings[0]?.provenance.note?.includes('single AIS position')));

  // stale position: vessel fix 12h after the incident — outside the 8h gate
  const staleResult = analyzeDomainConvergence([incident], emptyEvidence({ vessels: [makeVessel({ timestamp: '2026-11-26T00:30:00.000Z' })] }));
  check('AIS position 12h after the incident is outside the temporal gate',
    !staleResult.cards.some((card) => card.eventId === 'ev-ais' && findFinding(card, 'ais-vessel')));

  // distant vessel: 200 km away — outside the 80 km spatial gate
  const farResult = analyzeDomainConvergence([incident], emptyEvidence({ vessels: [makeVessel({ lat: 45.9, lng: 28.65 })] }));
  check('AIS vessel 200km away produces no finding',
    !farResult.cards.some((card) => card.eventId === 'ev-ais' && findFinding(card, 'ais-vessel')));

  // corroboration: maritime AIS + aviation-derived GNSS interference are genuinely independent families
  const bothEvidence = emptyEvidence({
    vessels: [makeVessel()],
    gpsInterference: [gnssCellAt(incident.lat, incident.lng)],
    sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
  });
  const bothResult = analyzeDomainConvergence([incident], bothEvidence);
  const bothCard = bothResult.cards.find((card) => card.eventId === 'ev-ais');
  check('AIS + GNSS interference corroborates (two independent families)', bothCard?.classification === 'corroboration', bothCard?.classification);
  check('corroboration card counts two independent families', bothCard?.independentFamilyCount === 2, String(bothCard?.independentFamilyCount));
  check('independent families span maritime and aviation-derived measurement',
    Boolean(bothCard?.independentFamilies?.includes('maritime-ais')) && Boolean(bothCard?.independentFamilies?.includes('aviation-derived')));

  // AIS alone is correlation, not corroboration — one family only
  check('AIS-only card classifies as correlation not corroboration', tightCard?.classification === 'correlation', tightCard?.classification);
}

// ---------------------------------------------------------------------------
// Scenario 9: evidence gaps and analyst summary
// ---------------------------------------------------------------------------
console.log('\nscenario 9: evidence gaps, uncertainty, copyable summary');
{
  const incident = makeEvent({ id: 'ev-gaps', lat: 51.5, lng: 106.0, occurredAt: NOV25_NOON });
  const result = analyzeDomainConvergence([incident], emptyEvidence());
  check('empty snapshot produces evidence gaps for every domain', result.gaps.length === 8, `${result.gaps.length}`);
  check('gap reasons are explicit about what cannot be evaluated', result.gaps.every((gap) => gap.reason.length > 20));

  const populated = analyzeDomainConvergence(
    [incident],
    emptyEvidence({
      gpsInterference: [gnssCellAt(incident.lat, incident.lng)],
      sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
    }),
  );
  const card = populated.cards.find((candidate) => candidate.eventId === 'ev-gaps');
  check('card carries uncertainty notes', (card?.uncertaintyNotes.length ?? 0) >= 1);
  check('card carries the never-causation disclaimer', card?.disclaimer === CONVERGENCE_DISCLAIMER);
  check('card evidence gaps list missing domains', (card?.evidenceGaps.length ?? 0) > 0);

  const summary = buildConvergenceAnalystSummary(card, incident);
  check('analyst summary includes classification', summary.includes('CLASSIFICATION: CORRELATION'));
  check('analyst summary includes distance and time evidence', /distance [\d.]+ km effective/.test(summary) && /time gap [\d.]+ h/.test(summary));
  check('analyst summary includes provenance lines', summary.includes('provenance:'));
  check('analyst summary includes evidence gaps section', summary.includes('EVIDENCE GAPS:'));
  check('analyst summary includes the causality caveat', summary.includes('co-occurrence, not causation'));
  check('analyst summary discloses ranking-device nature', summary.includes('not a probability'));
}

// ---------------------------------------------------------------------------
// Scenario 10: determinism — byte-stability under input reordering
// ---------------------------------------------------------------------------
console.log('\nscenario 10: deterministic byte-stability');
{
  const incidents = [
    makeEvent({ id: 'ev-det-1', lat: 51.5, lng: 106.0, occurredAt: NOV25_NOON }),
    makeEvent({ id: 'ev-det-2', lat: 51.6, lng: 106.1, occurredAt: NOV25_NOON + 2 * HOUR }),
    makeEvent({ id: 'ev-det-3', lat: 48.0, lng: 37.0, occurredAt: NOV25_NOON - 5 * HOUR }),
  ];
  const evidence = emptyEvidence({
    gpsInterference: [gnssCellAt(51.5, 106.0), gnssCellAt(48.0, 37.0)],
    internetOutages: [{
      entityType: 'region', entityCode: '1', entityName: 'Test', countryCode: 'MN', countryName: 'Mongolia',
      naturalEarthRegionId: null, lat: 51.51, lng: 106.01, coordinatePrecision: 'region-reference',
      coordinateNote: 'test', from: Math.floor(NOV25_NOON / 1000) - 900, until: Math.floor(NOV25_NOON / 1000) + 2700,
      score: 30, datasource: 'bgp', method: 'median', fromBeforeQueryWindow: false, untilEqualsQueryHorizon: false,
    }],
    sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
  });
  const forward = analyzeDomainConvergence(incidents, evidence);
  const reversed = analyzeDomainConvergence(
    [...incidents].reverse(),
    { ...evidence, gpsInterference: [...evidence.gpsInterference].reverse() },
  );
  const strip = (analysis) => JSON.stringify({ ...analysis, stats: { ...analysis.stats, elapsedMs: 0 } });
  check('analysis is byte-stable under input reordering', strip(forward) === strip(reversed));
}

// ---------------------------------------------------------------------------
// Scenario 11: performance at thousands-of-records scale
// ---------------------------------------------------------------------------
console.log('\nscenario 11: performance harness');
{
  const syntheticIncidents = [];
  const syntheticGnss = [];
  const syntheticMedia = [];
  const syntheticOutages = [];
  let seq = 0;
  // 2400 incidents spread across 40 theaters x 60 positions, plus dense evidence layers.
  for (let theater = 0; theater < 40; theater += 1) {
    const baseLat = -55 + (theater * 3.1) % 120;
    const baseLng = -170 + (theater * 17) % 340;
    for (let day = 0; day < 60; day += 1) {
      seq += 1;
      syntheticIncidents.push(makeEvent({
        id: `perf-${theater}-${day}`,
        lat: baseLat + ((day * 37) % 100) / 200,
        lng: baseLng + ((day * 53) % 100) / 200,
        occurredAt: NOW - day * DAY,
      }));
    }
  }
  // 600 interference cells on a global grid
  for (let i = 0; i < 600; i += 1) {
    syntheticGnss.push(gnssCellAt(-60 + (i * 7 % 120), -175 + (i * 23 % 350), { affectedShare: 0.4 }));
  }
  // 1200 civil aircraft, 200 vessels, 400 media mentions, 100 outages
  const syntheticCivil = [];
  const syntheticVessels = [];
  for (let i = 0; i < 1200; i += 1) {
    syntheticCivil.push({
      id: `civ-${i}`, callsign: `C${i}`, originCountry: null, lat: -60 + (i * 11 % 120), lng: -175 + (i * 29 % 350),
      altitude: 30000, speed: 450, track: 90, verticalRate: 0, squawk: '1000', operatorClass: 'civil',
      lastContact: '2026-11-26T11:55:00.000Z',
    });
  }
  for (let i = 0; i < 200; i += 1) {
    syntheticVessels.push({
      id: `v-${i}`, mmsi: i, imo: null, name: `V${i}`, callSign: null, destination: null, shipType: 70,
      vesselClass: 'Cargo', navigationStatus: 'Under way', lat: -50 + (i * 13 % 90), lng: -170 + (i * 31 % 330),
      speed: 12, course: 100, heading: 100, timestamp: '2026-11-26T11:50:00.000Z', source: 'test',
    });
  }
  for (let i = 0; i < 400; i += 1) {
    syntheticMedia.push({
      id: `gm-${i}`, url: `https://example.test/${i}`, title: null, domain: 'example.test',
      collection: 'english-web', locationName: `place-${i}`, locationType: 4,
      coordinatePrecision: 'world-city-or-landmark', countryCode: null, adm1Code: null, featureId: null,
      lat: -55 + (i * 9 % 110), lng: -170 + (i * 19 % 340), proximityChars: 50, themes: ['ARMEDCONFLICT'], tone: null,
      positiveScore: null, negativeScore: null, wordCount: null, sharingImage: null,
      slotTime: '2026-11-26T11:45:00.000Z', seenAt: null,
    });
  }
  for (let i = 0; i < 100; i += 1) {
    syntheticOutages.push({
      entityType: 'region', entityCode: `${i}`, entityName: `region-${i}`, countryCode: 'XX', countryName: 'Nowhere',
      naturalEarthRegionId: null, lat: -50 + (i * 8 % 100), lng: -160 + (i * 21 % 320), coordinatePrecision: 'region-reference',
      coordinateNote: 'test', from: Math.floor((NOW - 2 * HOUR) / 1000), until: Math.floor((NOW + 4 * HOUR) / 1000),
      score: 30, datasource: 'bgp', method: 'median', fromBeforeQueryWindow: false, untilEqualsQueryHorizon: false,
    });
  }
  const evidence = emptyEvidence({
    gpsInterference: syntheticGnss,
    aircraft: syntheticCivil,
    vessels: syntheticVessels,
    gdeltGeoNews: syntheticMedia,
    internetOutages: syntheticOutages,
    sources: { gpsInterference: 'gpsjam.org daily H3 interference (2026-11-25)' },
  });
  const started = process.hrtime.bigint();
  const result = analyzeDomainConvergence(syntheticIncidents, evidence);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  perf: ${syntheticIncidents.length} incidents x ${result.stats.evaluatedPairCount} evaluated pairs in ${elapsedMs.toFixed(1)} ms (engine-reported ${result.stats.elapsedMs} ms)`);
  check('convergence over 2400 incidents x dense evidence completes under 4000 ms', elapsedMs < 4000, `${elapsedMs.toFixed(1)} ms`);
  check('cards were produced', result.stats.cardCount > 0);
  check('stats expose observations per domain', result.stats.observationsByDomain['gnss-interference'] === 600);
}

// ---------------------------------------------------------------------------
// Scenario 12: real committed data — smoke + scale validation
// ---------------------------------------------------------------------------
console.log('\nscenario 12: real-data smoke pass over committed public snapshot');
{
  const snapshot = JSON.parse(fs.readFileSync(path.join(frontendDir, 'public', 'data', 'osint-snapshot.json'), 'utf8'));
  const fallback = JSON.parse(fs.readFileSync(path.join(frontendDir, 'public', 'data', 'conflict-fallback.json'), 'utf8'));
  const mowEvents = (snapshot.mapOfWarsEvents ?? [])
    .map(conflictData.normalizeMapOfWarsEvent)
    .filter(Boolean);
  const whmEvents = (fallback.events ?? [])
    .map(conflictData.normalizeWarHeatmapEvent)
    .filter(Boolean);
  const combined = [...mowEvents, ...whmEvents];
  const started = process.hrtime.bigint();
  const result = analyzeDomainConvergence(combined, snapshot);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  real data: ${combined.length} incidents -> ${result.stats.cardCount} convergence cards in ${elapsedMs.toFixed(1)} ms`);
  console.log(`  stats: ${JSON.stringify(result.stats)}`);
  console.log(`  classification split: corroboration ${result.stats.corroborationCount} · correlation ${result.stats.correlationCount} · coincidence ${result.stats.coincidenceCount}`);
  const top = result.cards.slice(0, 4);
  for (const card of top) {
    const event = combined.find((candidate) => candidate.id === card.eventId);
    console.log(`    · [${card.classification} ${card.convergenceIndex}/100] ${(event?.title ?? card.eventId).slice(0, 64)} — domains: ${card.domains.map((alignment) => `${alignment.domain}${alignment.qualifies ? '*' : ''}`).join(', ')}`);
  }
  check('real data convergence completes under 6000 ms', elapsedMs < 6000, `${elapsedMs.toFixed(1)} ms`);
  check('real data produces cards with deterministic ordering', result.cards.length > 0);
  check('every card carries the disclaimer', result.cards.every((card) => card.disclaimer === CONVERGENCE_DISCLAIMER));
  check('every finding carries factor rationale', result.cards.every((card) => card.domains.every((alignment) => alignment.findings.every((finding) => finding.rationale.length >= 2 && finding.factors.length >= 2))));
  check('no launch or civil-aviation-without-squawk finding ever qualifies on real data', result.cards.every((card) => card.domains.every((alignment) => {
    if (alignment.domain === 'space-launch' && alignment.qualifies) return false;
    if (alignment.domain === 'civil-aviation' && alignment.qualifies) {
      return alignment.findings.every((finding) => {
        const squawkFactor = finding.factors.find((factor) => factor.key === 'squawk');
        return (squawkFactor?.score ?? 0) >= 0.6;
      });
    }
    return true;
  })));
  const corroborated = result.cards.filter((card) => card.classification === 'corroboration');
  check('corroboration cards always span at least two independent families', corroborated.every((card) => card.independentFamilyCount >= 2));
  check('media attention never appears as an independent family', result.cards.every((card) => !card.independentFamilies.includes('media-attention')));
  check('aviation domains share one family on real data', result.cards.every((card) => {
    const aviationDomains = card.domains.filter((alignment) => ['gnss-interference', 'military-aviation', 'civil-aviation'].includes(alignment.domain) && alignment.qualifies);
    if (aviationDomains.length < 2) return true;
    return card.independentFamilies.filter((family) => family === 'aviation-derived').length <= 1;
  }));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  for (const failure of failures) console.log(`  - ${failure}`);
}
try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* temp cleanup is best-effort */ }
process.exit(failed > 0 ? 1 : 0);
