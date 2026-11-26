#!/usr/bin/env node
/**
 * Deterministic validation harness for catalog batch 6 (incident temporal playback).
 *
 * The harness uses the repository's pinned TypeScript compiler to transpile the pure
 * temporal-index module, then verifies interval truthfulness, deterministic extraction,
 * multi-resolution aggregation, correlated-evidence summaries, invalid-time exclusion,
 * and a fixed-size performance smoke pass. It deliberately does not use wall-clock-dependent
 * fixture times; every assertion is reproducible.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { performance } from 'perf_hooks';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const typescript = require(path.join(frontendDir, 'node_modules', 'typescript'));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incident-playback-'));
const sourcePath = path.join(frontendDir, 'src', 'lib', 'incidentTime.ts');
const transpiled = typescript.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    target: typescript.ScriptTarget.ES2020,
    module: typescript.ModuleKind.ES2020,
    isolatedModules: true,
  },
  fileName: 'incidentTime.ts',
}).outputText;
const modulePath = path.join(tempDir, 'incidentTime.mjs');
fs.writeFileSync(modulePath, transpiled);
const temporal = await import(`file://${modulePath.replace(/\\/g, '/')}`);

const {
  buildIncidentTemporalAnalysis,
  chooseAutomaticResolution,
  collectPlaybackEvents,
  createDayOccurrenceWindow,
  createSecondOccurrenceWindow,
  measureIncidentTemporalCoverage,
  summarizePlaybackEvents,
  HOUR_MS,
  DAY_MS,
} = temporal;

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

const DAY0 = Date.UTC(2026, 10, 19, 0, 0, 0); // 2026-11-19T00:00:00Z
let fixtureSeq = 0;
function makeEvent(overrides = {}) {
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
    occurredAt: DAY0 + 13.5 * HOUR_MS,
    updatedAt: DAY0 + 13.5 * HOUR_MS,
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

function ids(extraction) {
  return extraction ? extraction.events.map((event) => event.id).join('|') : '';
}

console.log('\nscenario 1: exact, day, and publisher-range windows are not interpolated');
{
  const exact = makeEvent({
    id: 'exact-second',
    occurredAt: DAY0 + 13.5 * HOUR_MS,
    occurrence: createSecondOccurrenceWindow(DAY0 + 13.5 * HOUR_MS),
  });
  const dayOnly = makeEvent({
    id: 'legacy-day',
    occurredAt: DAY0,
    occurrence: createDayOccurrenceWindow(DAY0, 'inferred-day'),
  });
  const ucdpRange = makeEvent({
    id: 'ucdp-range',
    occurredAt: DAY0 + 2 * DAY_MS,
    ucdp: { date_start: '2026-11-20', date_end: '2026-11-22', date_prec: 3 },
  });
  const analysis = buildIncidentTemporalAnalysis([exact, dayOnly, ucdpRange], { resolution: 'hour' });
  check('hourly analysis covers the full UTC uncertainty extent', analysis.frameCount === 96, `got ${analysis.frameCount}`);

  const exactFrame = 13;
  const before = collectPlaybackEvents(analysis, exactFrame - 1, 'step');
  const containing = collectPlaybackEvents(analysis, exactFrame, 'step');
  const after = collectPlaybackEvents(analysis, exactFrame + 1, 'step');
  check('exact timestamp appears in its containing frame', containing.events.some((event) => event.id === 'exact-second'));
  check('exact timestamp does not leak into prior frame', !before.events.some((event) => event.id === 'exact-second'));
  check('exact timestamp does not leak into next frame', !after.events.some((event) => event.id === 'exact-second'));

  const isolatedDay = buildIncidentTemporalAnalysis([dayOnly], { resolution: 'hour' });
  const dayMembershipFrames = isolatedDay.frames
    .filter((frame) => collectPlaybackEvents(isolatedDay, frame.index, 'step').events.some((event) => event.id === 'legacy-day'))
    .map((frame) => frame.index);
  check('date-only incident appears across exactly its 24 hourly uncertainty frames', dayMembershipFrames.length === 24, JSON.stringify(dayMembershipFrames));
  check('date-only frame memberships are the same single record, never fabricated copies', dayMembershipFrames.every((frame) => collectPlaybackEvents(isolatedDay, frame, 'step').events.filter((event) => event.id === 'legacy-day').length === 1));

  const rangeFrameCount = analysis.frames
    .filter((frame) => collectPlaybackEvents(analysis, frame.index, 'step').events.some((event) => event.id === 'ucdp-range'))
    .length;
  check('UCDP date_end is inclusive across the publisher range', rangeFrameCount === 72, `got ${rangeFrameCount}`);
  const resolvedCoverage = measureIncidentTemporalCoverage([ucdpRange]);
  check('UCDP coverage ends at exclusive midnight after the inclusive end date', resolvedCoverage.endExclusive - resolvedCoverage.start === 3 * DAY_MS, `${resolvedCoverage.endExclusive - resolvedCoverage.start}`);
}

console.log('\nscenario 2: deterministic frame extraction and accumulation semantics');
{
  const exact = makeEvent({ id: 'exact-a', occurrence: createSecondOccurrenceWindow(DAY0 + 13.5 * HOUR_MS), occurredAt: DAY0 + 13.5 * HOUR_MS });
  const later = makeEvent({ id: 'exact-b', occurredAt: DAY0 + 15 * HOUR_MS, occurrence: createSecondOccurrenceWindow(DAY0 + 15 * HOUR_MS) });
  const analysis = buildIncidentTemporalAnalysis([later, exact], { resolution: 'hour' });
  const one = collectPlaybackEvents(analysis, 14, 'step');
  const two = collectPlaybackEvents(analysis, 14, 'step');
  check('same frame index yields byte-identical membership order', ids(one) === ids(two), `${ids(one)} vs ${ids(two)}`);

  const cumulative13 = collectPlaybackEvents(analysis, 13, 'cumulative');
  const cumulative15 = collectPlaybackEvents(analysis, 15, 'cumulative');
  check('cumulative mode includes events whose starts have been reached', cumulative13.events.some((event) => event.id === 'exact-a'));
  check('cumulative mode is monotonic for started incidents', cumulative15.events.some((event) => event.id === 'exact-a') && cumulative15.events.some((event) => event.id === 'exact-b'));

  const exactFrame = Math.floor((exact.occurrence.start - analysis.domainStart) / HOUR_MS);
  const withinTrail = collectPlaybackEvents(analysis, exactFrame + 1, 'trailing', 2);
  const beyondTrail = collectPlaybackEvents(analysis, exactFrame + 2, 'trailing', 2);
  check('trailing mode retains a frame within the quantized trail', withinTrail.events.some((event) => event.id === 'exact-a'));
  check('trailing mode expires a frame after the quantized trail', !beyondTrail.events.some((event) => event.id === 'exact-a'));
}

console.log('\nscenario 3: multi-resolution aggregation remains unique and legible');
{
  check('auto resolution chooses hours for a two-day span', chooseAutomaticResolution(2 * DAY_MS) === 'hour');
  check('auto resolution chooses six-hour buckets for a ten-day span', chooseAutomaticResolution(10 * DAY_MS) === 'sixHour');
  check('auto resolution chooses days for a sixty-day span', chooseAutomaticResolution(60 * DAY_MS) === 'day');
  check('auto resolution chooses weeks for a two-hundred-day span', chooseAutomaticResolution(200 * DAY_MS) === 'week');

  const events = [
    makeEvent({ id: 'm1', occurredAt: DAY0 + HOUR_MS, occurrence: createSecondOccurrenceWindow(DAY0 + HOUR_MS) }),
    makeEvent({ id: 'm2', occurredAt: DAY0 + 2 * HOUR_MS, occurrence: createSecondOccurrenceWindow(DAY0 + 2 * HOUR_MS) }),
    makeEvent({ id: 'm3', occurredAt: DAY0 + DAY_MS, occurrence: createDayOccurrenceWindow(DAY0 + DAY_MS, 'inferred-day') }),
  ];
  const analysis = buildIncidentTemporalAnalysis(events, { resolution: 'hour' });
  const startTotal = analysis.frames.reduce((sum, frame) => sum + frame.startCount, 0);
  check('histogram start buckets count every valid incident exactly once', startTotal === events.length, `got ${startTotal}`);
  const uncertainStarts = analysis.frames.reduce((sum, frame) => sum + frame.startImpreciseCount, 0);
  check('histogram uncertainty totals are exact per incident', uncertainStarts === 1, `got ${uncertainStarts}`);

  const longSpanEvents = [
    makeEvent({ id: 'long-a', occurredAt: DAY0, occurrence: createSecondOccurrenceWindow(DAY0) }),
    makeEvent({ id: 'long-b', occurredAt: DAY0 + 200 * DAY_MS, occurrence: createSecondOccurrenceWindow(DAY0 + 200 * DAY_MS) }),
  ];
  const coerced = buildIncidentTemporalAnalysis(longSpanEvents, { resolution: 'hour' });
  check('excessively fine manual resolution is coerced with an explanation', coerced.resolution !== 'hour' && typeof coerced.resolutionNotice === 'string', `${coerced.resolution}/${coerced.resolutionNotice}`);
}

console.log('\nscenario 4: uncertainty, invalid times, and correlated evidence stay visible');
{
  const invalid = makeEvent({ id: 'invalid-time', occurredAt: 0, updatedAt: 0, occurrence: null });
  const corroborated = makeEvent({
    id: 'cluster-canonical',
    occurredAt: DAY0 + HOUR_MS,
    occurrence: createSecondOccurrenceWindow(DAY0 + HOUR_MS),
    incident: {
      clusterId: 'inc:cluster-canonical',
      canonicalEventId: 'cluster-canonical',
      isCanonical: true,
      correlationScore: 1,
      confidence: 'corroborated',
      memberCount: 3,
      independentFamilyCount: 2,
      rationale: ['validation fixture'],
    },
  });
  const uncertain = makeEvent({ id: 'uncertain-day', occurredAt: DAY0 + DAY_MS, occurrence: createDayOccurrenceWindow(DAY0 + DAY_MS, 'publisher-day') });
  const coverage = measureIncidentTemporalCoverage([invalid, corroborated, uncertain]);
  check('invalid-time records are excluded rather than placed on the timeline', coverage.invalidTimeCount === 1 && coverage.validEventCount === 2, JSON.stringify(coverage));
  check('coverage exposes precise and imprecise counts', coverage.preciseCount === 1 && coverage.impreciseCount === 1, JSON.stringify(coverage));

  const summary = summarizePlaybackEvents([corroborated, uncertain]);
  check('playback summary counts retained evidence reports', summary.retainedReportCount === 4, `got ${summary.retainedReportCount}`);
  check('playback summary counts corroborated incidents', summary.corroboratedCount === 1);
  check('playback summary counts uncertain-time incidents', summary.uncertainTimeCount === 1);
}

console.log('\nscenario 5: typed-array index performance smoke (5,000 incidents)');
{
  const synthetic = [];
  for (let index = 0; index < 5000; index += 1) {
    const timestamp = DAY0 + (index % (120 * 24)) * HOUR_MS;
    synthetic.push(makeEvent({
      id: `perf-${index}`,
      occurredAt: timestamp,
      occurrence: index % 3 === 0
        ? createDayOccurrenceWindow(timestamp, 'inferred-day')
        : createSecondOccurrenceWindow(timestamp),
      incident: index % 11 === 0 ? {
        clusterId: `inc:perf-${index}`,
        canonicalEventId: `perf-${index}`,
        isCanonical: true,
        correlationScore: 1,
        confidence: index % 22 === 0 ? 'corroborated' : 'inferred',
        memberCount: 2,
        independentFamilyCount: index % 22 === 0 ? 2 : 1,
        rationale: ['performance fixture'],
      } : undefined,
    }));
  }
  const started = performance.now();
  const analysis = buildIncidentTemporalAnalysis(synthetic, { resolution: 'day' });
  let extracted = 0;
  for (let frame = 0; frame < analysis.frameCount; frame += 1) {
    extracted += collectPlaybackEvents(analysis, frame, 'step').events.length;
    extracted += collectPlaybackEvents(analysis, frame, 'trailing', 7).events.length;
    extracted += collectPlaybackEvents(analysis, frame, 'cumulative').events.length;
  }
  const elapsed = performance.now() - started;
  console.log(`  info 5,000 incidents · ${analysis.frameCount} frames · ${analysis.totalMembershipCount.toLocaleString()} interval memberships · ${extracted.toLocaleString()} extraction rows · ${elapsed.toFixed(1)} ms`);
  check('5,000-incident index plus 360 extractions completes within validation budget', elapsed < 2000, `${elapsed.toFixed(1)} ms`);
  check('typed-array CSR membership matrix is populated', analysis.totalMembershipCount >= 5000 && analysis.membershipIndices.length === analysis.totalMembershipCount);
}

console.log(`\nincident playback validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nfailures:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
