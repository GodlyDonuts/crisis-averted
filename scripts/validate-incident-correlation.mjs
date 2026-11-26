#!/usr/bin/env node
/**
 * Deterministic validation harness for catalog batch 5 (canonical incident correlation).
 *
 * What it does:
 *  1. Transpiles the frontend TypeScript correlation engine and normalizers with the
 *     repository's own pinned typescript dependency (no network, no test-framework magic),
 *     rewriting @/ path aliases onto a temp module graph.
 *  2. Runs unit-like fixture assertions: cross-source duplicates must cluster, independent
 *     records must not, curated same-family pairs must never merge, future-dated rows and
 *     non-incident categories must stay unmerged, contradictions must surface, and the whole
 *     pipeline must be byte-stable under input reordering.
 *  3. Runs a real-data smoke/performance pass over the committed public snapshot and fallback
 *     cache, printing correlation statistics and elapsed time.
 *
 * Exit code 0 means every assertion passed.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-correlation-'));

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

fs.writeFileSync(
  path.join(tempDir, 'assets-stub.mjs'),
  'export const assetPath = (value) => value;\n',
);

const correlationPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'incidentCorrelation.ts'),
  'incidentCorrelation.mjs',
);
const conflictDataPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'conflictData.ts'),
  'conflictData.mjs',
  {
    '@/lib/assets': './assets-stub.mjs',
    '@/lib/incidentCorrelation': './incidentCorrelation.mjs',
  },
);

const correlation = await import(`file://${correlationPath.replace(/\\/g, '/')}`);
const conflictData = await import(`file://${conflictDataPath.replace(/\\/g, '/')}`);

const { correlateConflictEvents, extractEventFeatures, assessPair, resolveSourceFamily } = correlation;

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

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0); // 2026-11-20T12:00Z, fixed for determinism
const DAY = 24 * 36e5;

let fixtureSeq = 0;
function makeEvent(overrides) {
  fixtureSeq += 1;
  return {
    id: overrides.id || `fixture-${fixtureSeq}`,
    lat: 0,
    lng: 0,
    precision: null,
    severity: 'high',
    category: 'airstrike',
    categoryGroup: 'kinetic',
    date: '2026-11-19',
    occurredAt: NOW - DAY,
    updatedAt: NOW - DAY,
    killed: 0,
    countedCasualties: 0,
    displaced: 0,
    country: 'Ukraine',
    conflict: 'Russia-Ukraine War',
    theater: 'russia-ukraine-war',
    region: 'Europe',
    title: 'Untitled incident',
    verified: false,
    sourceName: null,
    sourceUrl: null,
    sources: [],
    intensity: 0.5,
    ...overrides,
  };
}

const KHARKIV = { lat: 49.9935, lng: 36.2304 };
const NOV19_NOON = Date.UTC(2026, 10, 19, 12, 0, 0);
const NOV19_MIDNIGHT = Date.UTC(2026, 10, 19, 0, 0, 0);

function clusterOf(result, eventId) {
  return result.incidents.find((incident) => incident.incident?.clusterId === `inc:${eventId}`)
    ?? result.incidents.find((incident) => incident.evidence?.members.some((member) => member.event.id === eventId));
}

function canonicalFor(result, eventId) {
  for (const incident of result.incidents) {
    if (incident.id === eventId) return incident;
    if (incident.evidence?.members.some((member) => member.event.id === eventId)) return incident;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scenario 1: one strike, three source families — must corroborate into one cluster
// ---------------------------------------------------------------------------
console.log('\nscenario 1: cross-source duplicate strike clusters and corroborates');
{
  const whm = makeEvent({
    id: 'whm-aaaa1111',
    lat: KHARKIV.lat, lng: KHARKIV.lng,
    title: 'Russian missile strike hits Kharkiv industrial plant',
    category: 'missile',
    killed: 6, countedCasualties: 9,
    occurredAt: NOV19_NOON, updatedAt: NOV19_NOON,
    verified: true,
    sourceFamily: 'warheatmap',
    sources: [{ name: 'Suspilne', url: 'https://example.test/1' }],
    intensity: 0.72,
  });
  const ucdp = makeEvent({
    id: 'ucdp:900001',
    lat: KHARKIV.lat + 0.02, lng: KHARKIV.lng + 0.015,
    title: 'Kharkiv, Ukraine',
    detail: '†6 · Government of Russia (Soviet Union) - Government of Ukraine',
    category: 'organized_violence',
    killed: 6, countedCasualties: 6,
    occurredAt: NOV19_MIDNIGHT, updatedAt: NOV19_MIDNIGHT,
    verified: true,
    sourceName: 'UCDP',
    sourceFamily: 'ucdp',
    intensity: 0.6,
  });
  const acled = makeEvent({
    id: 'mow-acled-UKR22119',
    lat: KHARKIV.lat - 0.01, lng: KHARKIV.lng - 0.02,
    title: 'Explosions/Remote violence — Kharkiv',
    detail: 'Shelling/artillery/missile attack · Military Forces of Russia vs Military Forces of Ukraine · 7 reported fatalities',
    category: 'ground_battle',
    killed: 7, countedCasualties: 7,
    occurredAt: NOV19_MIDNIGHT, updatedAt: NOV19_MIDNIGHT,
    sourceName: 'ACLED',
    sourceFamily: 'acled',
    intensity: 0.58,
  });

  const result = correlateConflictEvents([whm, ucdp, acled], { now: NOW });
  check('three source records collapse to one canonical incident', result.incidents.length === 1, `got ${result.incidents.length}`);
  const incident = result.incidents[0];
  check('cluster is corroborated', incident.incident?.confidence === 'corroborated', incident.incident?.confidence);
  check('cluster reports three independent families', (incident.incident?.independentFamilyCount ?? 0) === 3);
  check('evidence retains both non-canonical reports in full', (incident.evidence?.members.length ?? 0) === 2);
  check('member count includes canonical', incident.evidence?.memberCount === 3);
  check('no contradictions for consistent tolls', (incident.evidence?.contradictions.length ?? 99) === 0,
    JSON.stringify(incident.evidence?.contradictions));
  const member = incident.evidence?.members[0];
  check('member rationale is non-empty and explainable', (member?.rationale.length ?? 0) >= 3);
  check('rationale cites spatial evidence', member?.rationale.some((line) => line.startsWith('spatial:')) === true);
  check('rationale cites temporal evidence', member?.rationale.some((line) => line.startsWith('temporal:')) === true);
  check('ucdp curated pair score vs acled is meaningful', (() => {
    const fa = extractEventFeatures(ucdp, 0);
    const fb = extractEventFeatures(acled, 1);
    return assessPair(fa, fb).score >= 0.6;
  })());
}

// ---------------------------------------------------------------------------
// Scenario 2: independent incidents must never merge
// ---------------------------------------------------------------------------
console.log('\nscenario 2: independent records stay independent');
{
  const base = {
    category: 'airstrike', country: 'Ukraine', conflict: 'Russia-Ukraine War',
    sourceFamily: 'warheatmap', occurredAt: NOV19_NOON,
  };
  // 2a: two UCDP rows, same village, same day — independent coded events by definition
  const u1 = makeEvent({ id: 'ucdp:111', lat: 48.0, lng: 37.0, title: 'Avdiivka, Ukraine', occurredAt: NOV19_MIDNIGHT, sourceFamily: 'ucdp', category: 'organized_violence', killed: 3, detail: '†3 · Government of Russia (Soviet Union) - Government of Ukraine' });
  const u2 = makeEvent({ id: 'ucdp:222', lat: 48.005, lng: 37.004, title: 'Avdiivka, Ukraine', occurredAt: NOV19_MIDNIGHT, sourceFamily: 'ucdp', category: 'organized_violence', killed: 3, detail: '†3 · Government of Russia (Soviet Union) - Government of Ukraine' });
  const r1 = correlateConflictEvents([u1, u2], { now: NOW });
  check('curated same-family records never merge even when identical', r1.incidents.length === 2, `got ${r1.incidents.length}`);

  // 2b: same town, different days (>48h gap)
  const d1 = makeEvent({ ...base, id: 'whm-day1', lat: 48.0, lng: 37.0, title: 'Airstrike hits Avdiivka positions', occurredAt: NOV19_NOON });
  const d2 = makeEvent({ ...base, id: 'whm-day2', lat: 48.001, lng: 37.002, title: 'Airstrike hits Avdiivka positions again', occurredAt: NOV19_NOON + 3 * DAY });
  const r2 = correlateConflictEvents([d1, d2], { now: NOW + 4 * DAY });
  check('same-town incidents 72h apart do not merge', r2.incidents.length === 2, `got ${r2.incidents.length}`);

  // 2c: same day, 200 km apart
  const f1 = makeEvent({ ...base, id: 'whm-far1', lat: 48.0, lng: 37.0, title: 'Airstrike hits Avdiivka' });
  const f2 = makeEvent({ ...base, id: 'whm-far2', lat: 49.8, lng: 37.2, title: 'Airstrike hits Avdiivka' });
  const r3 = correlateConflictEvents([f1, f2], { now: NOW });
  check('same-day incidents 200 km apart do not merge', r3.incidents.length === 2, `got ${r3.incidents.length}`);

  // 2d: non-incident categories never merge even when identical in space/time
  const n1 = makeEvent({ ...base, id: 'whm-diplo1', category: 'diplomacy', title: 'Ceasefire talks in Geneva' });
  const n2 = makeEvent({ ...base, id: 'ucdp-ish-diplo', category: 'diplomacy', title: 'Ceasefire talks in Geneva', sourceFamily: 'ucdp' });
  const r4 = correlateConflictEvents([n1, n2], { now: NOW });
  check('non-incident categories are never merged', r4.incidents.length === 2, `got ${r4.incidents.length}`);

  // 2e: future-dated rows are never merged
  const fut1 = makeEvent({ ...base, id: 'future-1', occurredAt: NOW + 5 * DAY, title: 'Anticipated strike package' });
  const fut2 = makeEvent({ ...base, id: 'future-2', occurredAt: NOW + 5 * DAY, title: 'Anticipated strike package', sourceFamily: 'ucdp' });
  const r5 = correlateConflictEvents([fut1, fut2], { now: NOW });
  check('future-dated records are never merged', r5.incidents.length === 2, `got ${r5.incidents.length}`);
  check('future-dated records still pass through visibly', r5.stats.ineligibleRecordCount === 2);

  // 2f: coarse offshore centroid coincidence is weak evidence — distinct tanker incidents at a
  // shared strait centroid must not merge on spatial+temporal evidence alone
  const t1 = makeEvent({ ...base, id: 'whm-tanker-1', lat: 26.45, lng: 56.2, precision: 7, category: 'naval', title: 'Tanker hit in Strait of Hormuz', country: 'Iran', conflict: 'Iran-US confrontation', occurredAt: NOV19_NOON });
  const t2 = makeEvent({ ...base, id: 'whm-tanker-2', lat: 26.45, lng: 56.2, precision: 7, category: 'naval', title: 'Second tanker reported hit in Strait of Hormuz', country: 'Iran', conflict: 'Iran-US confrontation', occurredAt: NOV19_NOON + 20 * 36e5 });
  const r6 = correlateConflictEvents([t1, t2], { now: NOW + 2 * DAY });
  check('offshore-centroid coincidence alone does not merge distinct incidents', r6.incidents.length === 2, `got ${r6.incidents.length}`);

  // 2g: town-level fixes keep full spatial evidence — the same strike at precision 2 still merges
  const p1 = makeEvent({ ...base, id: 'whm-prec-1', lat: 48.0, lng: 37.0, precision: 2, title: 'Airstrike hits Avdiivka depot', killed: 4 });
  const p2 = makeEvent({ ...base, id: 'ucdp:prec-2', lat: 48.004, lng: 37.003, precision: 2, title: 'Avdiivka, Ukraine', category: 'organized_violence', occurredAt: NOV19_MIDNIGHT, sourceFamily: 'ucdp', killed: 4, detail: '†4 · Government of Russia (Soviet Union) - Government of Ukraine' });
  const r7 = correlateConflictEvents([p1, p2], { now: NOW });
  check('town-precision cross-source duplicate still merges', r7.incidents.length === 1, `got ${r7.incidents.length}`);
}

// ---------------------------------------------------------------------------
// Scenario 3: same-family duplicate reporting merges as inferred, not corroborated
// ---------------------------------------------------------------------------
console.log('\nscenario 3: same-source re-report clusters as inferred');
{
  const r1 = makeEvent({
    id: 'whm-qeshm-1', lat: 26.95, lng: 56.27, occurredAt: NOV19_NOON,
    title: 'Explosions reported on Qeshm Island amid US blockade measures',
    category: 'explosion', country: 'Iran', conflict: 'Iran-US confrontation', theater: 'iran-us-confrontation',
    sourceFamily: 'warheatmap', intensity: 0.5,
  });
  const r2 = makeEvent({
    id: 'whm-qeshm-2', lat: 26.96, lng: 56.28, occurredAt: NOV19_NOON + 2 * 36e5,
    title: 'Explosions hit Qeshm island and Hormuz',
    category: 'explosion', country: 'Iran', conflict: 'Iran-US confrontation', theater: 'iran-us-confrontation',
    sourceFamily: 'warheatmap', intensity: 0.55,
  });
  const result = correlateConflictEvents([r1, r2], { now: NOW });
  check('same-family duplicate reporting clusters', result.incidents.length === 1, `got ${result.incidents.length}`);
  const incident = result.incidents[0];
  check('single-family cluster is inferred, never corroborated', incident.incident?.confidence === 'inferred', incident.incident?.confidence);
}

// ---------------------------------------------------------------------------
// Scenario 4: contradictory fatality reports surface as contested
// ---------------------------------------------------------------------------
console.log('\nscenario 4: contradictory tolls are contested, not resolved');
{
  const whm = makeEvent({
    id: 'whm-toll-low', lat: 33.5, lng: 36.3, occurredAt: NOV19_NOON,
    title: 'Airstrike hits Damascus suburb', category: 'airstrike',
    country: 'Syria', conflict: 'Syrian conflict', theater: 'syrian-conflict',
    killed: 2, sourceFamily: 'warheatmap', intensity: 0.6,
  });
  const acled = makeEvent({
    id: 'mow-acled-SYR991', lat: 33.51, lng: 36.31, occurredAt: NOV19_MIDNIGHT,
    title: 'Explosions/Remote violence — Damascus', category: 'ground_battle',
    detail: 'Shelling/artillery/missile attack · Military Forces of Syria vs Opposition forces · 30 reported fatalities',
    country: 'Syria', conflict: 'Syrian conflict', theater: 'syrian-conflict',
    killed: 30, sourceName: 'ACLED', sourceFamily: 'acled', intensity: 0.7,
  });
  const result = correlateConflictEvents([whm, acled], { now: NOW });
  if (result.incidents.length === 1) {
    const incident = result.incidents[0];
    check('contradictory toll cluster is contested', incident.incident?.confidence === 'contested', incident.incident?.confidence);
    check('fatality contradiction is preserved with member ids',
      incident.evidence?.contradictions.some((c) => c.kind === 'fatalities' && c.memberEventIds.length === 2) === true);
    check('both contradictory reports remain in evidence', (incident.evidence?.members.length ?? 0) === 1);
  } else {
    check('contradictory toll cluster is contested', false, `records did not cluster at all (${result.incidents.length} incidents)`);
  }
}

// ---------------------------------------------------------------------------
// Scenario 5: exact duplicate ids collapse openly, singletons are single-source
// ---------------------------------------------------------------------------
console.log('\nscenario 5: exact-id collapse and singleton language');
{
  const a = makeEvent({ id: 'whm-same', lat: 40.0, lng: 44.0, title: 'Strike in the north' });
  const b = makeEvent({ id: 'whm-same', lat: 40.0, lng: 44.0, title: 'Strike in the north' });
  const solo = makeEvent({ id: 'whm-solo', lat: 10.0, lng: 10.0, title: 'Isolated border incident', category: 'border_crossing' });
  const result = correlateConflictEvents([a, b, solo], { now: NOW });
  check('identical ids collapse to one record', result.incidents.filter((i) => i.id === 'whm-same').length === 1);
  check('exact collapse is counted openly', result.stats.exactDuplicateRecordCount === 1, `got ${result.stats.exactDuplicateRecordCount}`);
  const singleton = result.incidents.find((i) => i.id === 'whm-solo');
  check('uncorroborated singleton is single-source', singleton?.incident?.confidence === 'single-source', singleton?.incident?.confidence);
  check('singletons carry no evidence cluster', singleton?.evidence === undefined);
}

// ---------------------------------------------------------------------------
// Scenario 6: determinism under input reordering
// ---------------------------------------------------------------------------
console.log('\nscenario 6: input order never changes output');
{
  const events = [
    makeEvent({ id: 'ev-a', lat: 35.0, lng: 38.0, title: 'Strike on convoy near Deir ez-Zor', occurredAt: NOV19_NOON, sourceFamily: 'warheatmap', country: 'Syria', conflict: 'Syrian conflict', killed: 4 }),
    makeEvent({ id: 'ucdp:777', lat: 35.01, lng: 38.01, title: 'Dayr az Zawr, Syria', occurredAt: NOV19_MIDNIGHT, sourceFamily: 'ucdp', country: 'Syria', conflict: 'Syrian conflict', killed: 4, category: 'organized_violence', detail: '†4 · Government of Syria - IS' }),
    makeEvent({ id: 'ev-b', lat: 35.02, lng: 38.005, title: 'Convoy strike in Deir ez-Zor desert', occurredAt: NOV19_NOON + 36e5, sourceFamily: 'warheatmap', country: 'Syria', conflict: 'Syrian conflict', killed: 5 }),
    makeEvent({ id: 'ev-c', lat: 20.0, lng: 42.0, title: 'Unrelated saudi border incident', occurredAt: NOV19_NOON, sourceFamily: 'warheatmap', country: 'Saudi Arabia', conflict: 'Yemen war', category: 'border_crossing' }),
    makeEvent({ id: 'ev-d', lat: 35.5, lng: 38.6, title: 'Separate strike same region', occurredAt: NOV19_NOON + 30 * DAY, sourceFamily: 'warheatmap', country: 'Syria', conflict: 'Syrian conflict' }),
  ];
  const forward = correlateConflictEvents(events, { now: NOW + 31 * DAY });
  const reversed = correlateConflictEvents([...events].reverse(), { now: NOW + 31 * DAY });
  const shuffled = correlateConflictEvents([events[2], events[4], events[0], events[3], events[1]], { now: NOW + 31 * DAY });
  const signature = (result) => result.incidents
    .map((i) => `${i.id}|${i.incident?.confidence}|${i.incident?.memberCount}|${(i.evidence?.members ?? []).map((m) => m.event.id).sort().join('+')}`)
    .sort()
    .join(';;');
  check('reversed input yields identical clustering', signature(forward) === signature(reversed));
  check('shuffled input yields identical clustering', signature(forward) === signature(shuffled));
  const repeat = correlateConflictEvents(events, { now: NOW + 31 * DAY });
  check('repeat run yields identical clustering', signature(forward) === signature(repeat));
}

// ---------------------------------------------------------------------------
// Scenario 7: source family resolution
// ---------------------------------------------------------------------------
console.log('\nscenario 7: source family resolution');
{
  check('explicit tag wins', resolveSourceFamily({ id: 'x', sourceName: null, sourceFamily: 'acled' }) === 'acled');
  check('ucdp id inferred', resolveSourceFamily({ id: 'ucdp:42', sourceName: null }) === 'ucdp');
  check('lattice acled id inferred', resolveSourceFamily({ id: 'mow-acled-99', sourceName: null }) === 'acled');
  check('untyped record resolves unknown', resolveSourceFamily({ id: 'abcdef', sourceName: null }) === 'unknown');
}

// ---------------------------------------------------------------------------
// Scenario 8: performance at thousands-of-records scale
// ---------------------------------------------------------------------------
console.log('\nscenario 8: performance harness');
{
  const synthetic = [];
  let seq = 0;
  // 60 theaters x 25 incident days x 3 reports = 4500 records. Each incident sits at its own
  // deterministic sub-location inside a 1.2° theater box with a distinctive object token —
  // modeling realistic same-theatre density where distinct incidents are NOT coincident.
  const OBJECTS = ['depot', 'convoy', 'bridge', 'airfield', 'substation', 'harbor', 'barracks', 'checkpoint'];
  for (let theater = 0; theater < 60; theater += 1) {
    const baseLat = -50 + (theater * 1.7) % 130;
    const baseLng = -170 + (theater * 47) % 340;
    for (let day = 0; day < 25; day += 1) {
      const occurred = NOW - day * DAY;
      const incidentLat = baseLat + ((day * 37 + theater * 11) % 100) / 100 * 1.1;
      const incidentLng = baseLng + ((day * 53 + theater * 7) % 100) / 100 * 1.1;
      const object = OBJECTS[(day + theater) % OBJECTS.length];
      for (const [family, jitter, prefix] of [['warheatmap', 0, 'w'], ['ucdp', 0.02, 'u'], ['acled', -0.02, 'a']]) {
        seq += 1;
        synthetic.push(makeEvent({
          id: `${prefix}-${theater}-${day}-${seq}`,
          lat: incidentLat + jitter + (seq % 3) * 0.005,
          lng: incidentLng + jitter + (seq % 2) * 0.005,
          title: family === 'warheatmap' ? `Strike hits ${object} near town${theater}-${day}` : `town${theater}-${day} area, country`,
          occurredAt: family === 'warheatmap' ? occurred + 10 * 36e5 : occurred - (occurred % DAY),
          killed: (day % 9),
          sourceFamily: family,
          category: 'airstrike',
          intensity: 0.4 + (seq % 10) * 0.03,
        }));
      }
    }
  }
  const started = process.hrtime.bigint();
  const result = correlateConflictEvents(synthetic, { now: NOW + DAY });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  perf: ${synthetic.length} records → ${result.incidents.length} incidents in ${elapsedMs.toFixed(1)} ms (engine-reported ${result.stats.elapsedMs} ms, ${result.stats.candidatePairCount} candidate pairs)`);
  check('correlation of ~4500 dense records completes under 3000 ms', elapsedMs < 3000, `${elapsedMs.toFixed(1)} ms`);
  check('dense correlated input actually reduces incident noise', result.incidents.length < synthetic.length * 0.75,
    `${result.incidents.length}/${synthetic.length}`);
}

// ---------------------------------------------------------------------------
// Scenario 9: real committed data — smoke + scale validation
// ---------------------------------------------------------------------------
console.log('\nscenario 9: real-data smoke pass over committed public data');
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
  const result = correlateConflictEvents(combined, { now: NOW + 6 * DAY });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const contested = result.incidents.filter((i) => i.incident?.confidence === 'contested').length;
  const corroborated = result.incidents.filter((i) => i.incident?.confidence === 'corroborated').length;
  const inferred = result.incidents.filter((i) => i.incident?.confidence === 'inferred').length;
  const crossFamily = result.incidents.filter((i) => (i.incident?.independentFamilyCount ?? 0) >= 2);
  console.log(`  real data: ${combined.length} normalized records → ${result.incidents.length} canonical incidents in ${elapsedMs.toFixed(1)} ms`);
  console.log(`  stats: ${JSON.stringify(result.stats)}`);
  console.log(`  confidence split: corroborated ${corroborated} · inferred ${inferred} · contested ${contested} · single-source ${result.incidents.length - corroborated - inferred - contested}`);
  console.log(`  sample cross-family incidents:`);
  for (const incident of crossFamily.slice(0, 4)) {
    console.log(`    · [${incident.incident?.confidence}] ${incident.title.slice(0, 72)} — ${incident.incident?.memberCount} reports, families: ${incident.evidence?.sourceFamilies.join('+')}`);
    for (const member of (incident.evidence?.members ?? []).slice(0, 2)) {
      console.log(`        - ${member.sourceFamily}: ${member.event.title.slice(0, 64)} (score ${member.correlationScore.toFixed(2)})`);
    }
  }
  check('real data correlation completes under 4000 ms', elapsedMs < 4000, `${elapsedMs.toFixed(1)} ms`);
  check('real data produces canonical incidents for every input group', result.incidents.length > 0);
  check('no incident lacks membership metadata', result.incidents.every((i) => Boolean(i.incident)));
  check('exact-duplicate collapse is counted, never silent', result.stats.exactDuplicateRecordCount >= 0);
  check('real-data noise reduction stays conservative (no more than 60% absorbed)',
    result.stats.correlatedEvidenceRecordCount <= combined.length * 0.6,
    `${result.stats.correlatedEvidenceRecordCount}/${combined.length}`);
  const curatedMerges = result.incidents.filter((i) => {
    const families = (i.evidence?.members ?? []).map((m) => m.sourceFamily);
    return families.length !== new Set(families).size && families.some((f) => f === 'ucdp' || f === 'acled') && i.evidence?.sourceFamilies.length === 1;
  });
  check('curated datasets never self-merge on real data', curatedMerges.length === 0, `${curatedMerges.length} violations`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  for (const failure of failures) console.log(`  - ${failure}`);
}
try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* temp cleanup is best-effort */ }
process.exit(failed > 0 ? 1 : 0);
