#!/usr/bin/env node
/**
 * Deterministic validation harness for catalog batch 8 (escalation-surge indicators and
 * analyst-defined local watch rules).
 *
 * What it does:
 *  1. Transpiles the frontend TypeScript temporal/surge/watch modules with the repository's
 *     pinned typescript compiler, rewriting @/ aliases onto a temp module graph.
 *  2. Runs fixture assertions for rate/intensity acceleration, corroboration and novelty
 *     metrics, temporal uncertainty bounds, input-order determinism, constrained watch-rule
 *     triggering, geographic/category/severity filtering, fingerprint stability, lifecycle
 *     suppression semantics, and non-authority export language.
 *  3. Runs a real-data smoke/performance pass over the committed fallback incident cache.
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalation-watch-'));

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

const incidentTimePath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'incidentTime.ts'),
  'incidentTime.mjs',
);
const surgePath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'escalationSurge.ts'),
  'escalationSurge.mjs',
  { '@/lib/incidentTime': './incidentTime.mjs' },
);
const watchPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'watchRules.ts'),
  'watchRules.mjs',
  {
    '@/lib/incidentTime': './incidentTime.mjs',
    '@/lib/escalationSurge': './escalationSurge.mjs',
  },
);
const correlationPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'incidentCorrelation.ts'),
  'incidentCorrelation.mjs',
  { '@/lib/incidentTime': './incidentTime.mjs' },
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

const incidentTime = await import(pathToFileURL(incidentTimePath).href);
const surge = await import(pathToFileURL(surgePath).href);
const watch = await import(pathToFileURL(watchPath).href);
const incidentCorrelation = await import(pathToFileURL(correlationPath).href);
const conflictData = await import(pathToFileURL(conflictDataPath).href);

const { analyzeEscalationSurge, buildSurgeAnalystSummary, boundedRateRatio, formatRatioBounds } = surge;
const {
  buildWatchAlertSummary,
  evaluateWatchRules,
  getWatchAlertLifecycle,
  normalizeWatchRule,
  normalizeWatchRules,
  stableWatchFingerprint,
} = watch;
const { createDayOccurrenceWindow } = incidentTime;

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

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0); // 2026-11-26T12:00Z, fixed for determinism
const HOUR = 36e5;
const DAY = 24 * HOUR;

let fixtureSeq = 0;
function membership(confidence = 'single-source', families = 1, reports = 1) {
  return {
    clusterId: `inc:test-${fixtureSeq}`,
    canonicalEventId: `test-${fixtureSeq}`,
    isCanonical: true,
    correlationScore: 1,
    confidence,
    memberCount: reports,
    independentFamilyCount: families,
    rationale: ['fixture membership'],
  };
}

function makeEvent(overrides = {}) {
  fixtureSeq += 1;
  const id = overrides.id || `fixture-${fixtureSeq}`;
  return {
    id,
    lat: 49.0,
    lng: 32.0,
    precision: null,
    severity: 'high',
    category: 'airstrike',
    categoryGroup: 'kinetic',
    date: '2026-11-25',
    occurredAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    killed: 0,
    countedCasualties: 0,
    displaced: 0,
    country: 'Ukraine',
    conflict: 'Russia-Ukraine War',
    theater: 'russia-ukraine-war',
    region: 'Europe',
    title: `Fixture incident ${id}`,
    detail: null,
    verified: false,
    sourceName: 'FixtureWire',
    sourceUrl: `https://example.test/${id}`,
    sources: [{ name: 'FixtureWire', url: `https://example.test/${id}` }],
    intensity: 0.5,
    sourceFamily: 'warheatmap',
    incident: membership(),
    ...overrides,
  };
}

function makeRule(overrides = {}) {
  const base = normalizeWatchRule({
    id: overrides.id || `rule-${fixtureSeq}`,
    version: 1,
    name: overrides.name || 'Fixture watch',
    enabled: overrides.enabled ?? true,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    condition: {
      kind: 'incident-count',
      threshold: 3,
      window: '72h',
      surgeLevel: 'watch-indicator',
      ...(overrides.condition || {}),
    },
    filters: {
      theater: null,
      region: null,
      country: null,
      category: null,
      categoryGroups: [],
      severities: [],
      ...(overrides.filters || {}),
    },
  });
  if (!base) throw new Error('fixture rule failed normalization');
  return base;
}

function surgeCorpus() {
  const events = [];
  for (let index = 0; index < 7; index += 1) {
    const at = NOW - (4 + index * 2) * DAY;
    events.push(makeEvent({
      id: `baseline-${index}`,
      occurredAt: at,
      updatedAt: at,
      severity: 'low',
      countedCasualties: 0,
      killed: 0,
      lat: 49.01,
      lng: 32.01,
      title: `Baseline artillery report ${index}`,
      incident: membership('single-source', 1, 1),
    }));
  }
  const currentTimes = [2, 8, 20, 30, 50, 65];
  currentTimes.forEach((hoursAgo, index) => {
    const at = NOW - hoursAgo * HOUR;
    const casualties = index < 2 ? 18 + index * 9 : 4 + index;
    events.push(makeEvent({
      id: `current-${index}`,
      occurredAt: at,
      updatedAt: at,
      severity: index < 2 ? 'critical' : 'high',
      countedCasualties: casualties,
      killed: Math.max(1, Math.floor(casualties / 2)),
      displaced: index === 0 ? 120 : 0,
      lat: 49.4 + index * 0.7,
      lng: 32.4 + index * 0.6,
      title: `Current strike cluster ${index}`,
      incident: membership('corroborated', index % 2 === 0 ? 3 : 2, index % 2 === 0 ? 4 : 3),
    }));
  });
  return events;
}

console.log('\nscenario 1: deterministic surge metrics and transparent statistical labeling');
{
  const events = surgeCorpus();
  const analysis = analyzeEscalationSurge(events, { now: NOW });
  const theater = analysis.signals.find((signal) => signal.id === 'surge:theater:russia-ukraine-war');
  check('theater signal exists', Boolean(theater));
  check('theater reaches surge-indicator level', theater?.level === 'surge-indicator', theater?.level);
  check('incident-rate acceleration lower bound is robustly elevated', (theater?.metrics.incidentRateRatio.lower ?? 0) >= 5.9, JSON.stringify(theater?.metrics.incidentRateRatio));
  check('intensity acceleration is elevated', (theater?.metrics.intensityRatio.lower ?? 0) >= 4, JSON.stringify(theater?.metrics.intensityRatio));
  check('corroboration share increase is measured', (theater?.metrics.corroboratedShareDelta ?? 0) >= 0.99, String(theater?.metrics.corroboratedShareDelta));
  check('novel facets are detected against baseline', (theater?.metrics.novelCurrentCount ?? 0) >= 4, String(theater?.metrics.novelCurrentCount));
  check('evidence references include source provenance', (theater?.evidenceRefs ?? []).every((ref) => ref.eventId && ref.sourceUrl && ref.independentFamilyCount >= 2));
  check('signal explicitly labels itself not a prediction', theater?.disclaimer.includes('not a prediction') === true);
  check('signal refuses operational warning authority', theater?.disclaimer.includes('not a verified operational warning') === true);
  const summary = theater ? buildSurgeAnalystSummary(theater) : '';
  check('copyable summary includes evidence references', summary.includes('evidence references:') && summary.includes('current-0'));
  check('copyable summary preserves non-prediction language', summary.includes('STATISTICAL SIGNAL, NOT A PREDICTION'));
  check('ratio formatter exposes bounded uncertainty style', formatRatioBounds(boundedRateRatio(2, 4, 1, 2)).includes('to'));

  const reordered = analyzeEscalationSurge([...events].reverse(), { now: NOW });
  check('signal output is byte-stable under input reordering', JSON.stringify(analysis.signals) === JSON.stringify(reordered.signals));
}

console.log('\nscenario 2: uncertainty intervals produce bounded memberships, not false exact counts');
{
  const uncertainDay = Date.UTC(2026, 10, 23, 0, 0, 0);
  const uncertain = makeEvent({
    id: 'boundary-day',
    theater: 'boundary-test-theater',
    conflict: 'Boundary Test Theater',
    occurredAt: uncertainDay,
    updatedAt: uncertainDay,
    occurrence: createDayOccurrenceWindow(uncertainDay, 'publisher-day'),
    title: 'Boundary-uncertain date-only incident',
  });
  const baseline = makeEvent({
    id: 'boundary-baseline',
    theater: 'boundary-test-theater',
    conflict: 'Boundary Test Theater',
    occurredAt: NOW - 10 * DAY,
    updatedAt: NOW - 10 * DAY,
    severity: 'low',
  });
  const analysis = analyzeEscalationSurge([uncertain, baseline], { now: NOW });
  const theater = analysis.signals.find((signal) => signal.id === 'surge:theater:boundary-test-theater');
  check('boundary date-only incident is possible but not definite in recent window', theater?.metrics.currentPossibleCount === 1 && theater.metrics.currentDefiniteCount === 0, JSON.stringify(theater?.metrics));
  check('boundary ambiguity is counted transparently', theater?.metrics.currentBoundaryAmbiguousCount === 1, String(theater?.metrics.currentBoundaryAmbiguousCount));
  check('uncertainty note is attached', (theater?.uncertaintyNotes ?? []).some((line) => line.includes('boundary-ambiguous')));
  check('possible-only current evidence cannot become a watch/surge indicator', theater?.level === 'uncertain-change' || theater?.level === 'no-signal' || theater?.level === 'insufficient-evidence', theater?.level);
}

console.log('\nscenario 3: constrained watch rules trigger with filters, evidence, and stable fingerprints');
{
  const events = surgeCorpus();
  const analysis = analyzeEscalationSurge(events, { now: NOW });
  const incidentRule = makeRule({
    id: 'rule-incident-filtered',
    name: 'Ukraine kinetic surge count',
    condition: { kind: 'incident-count', threshold: 4, window: '72h' },
    filters: {
      theater: 'russia-ukraine-war',
      region: 'Europe',
      country: 'Ukraine',
      category: 'airstrike',
      categoryGroups: ['kinetic'],
      severities: ['critical', 'high'],
    },
  });
  const result = evaluateWatchRules(events, [incidentRule], analysis, { now: NOW });
  const alert = result.alerts[0];
  check('filtered incident-count rule triggers', result.stats.triggeredRuleCount === 1, JSON.stringify(result.evaluations));
  check('alert definite count matches deterministic six current incidents', alert?.definiteIncidentCount === 6, String(alert?.definiteIncidentCount));
  check('alert evidence references include correlated provenance', (alert?.evidenceRefs.length ?? 0) >= 5 && alert.evidenceRefs.every((ref) => ref.sourceUrl && ref.independentFamilyCount >= 2));
  check('alert explanation states conservative temporal trigger', alert?.explanations.some((line) => line.includes('Only definite membership can satisfy')) === true);
  check('alert is explicitly not an operational warning', alert?.disclaimer.includes('not verified operational warnings') === true);
  const repeat = evaluateWatchRules(events, [incidentRule], analysis, { now: NOW }).alerts[0];
  check('alert fingerprint is stable for unchanged evidence', alert?.fingerprint === repeat?.fingerprint, `${alert?.fingerprint} vs ${repeat?.fingerprint}`);
  const reorderedAlert = evaluateWatchRules([...events].reverse(), [incidentRule], analysis, { now: NOW }).alerts[0];
  check('watch alert output is stable under input reordering', JSON.stringify(alert) === JSON.stringify(reorderedAlert));
  check('fingerprint helper is deterministic', stableWatchFingerprint(['a', 'b']) === stableWatchFingerprint(['a', 'b']));
  const alertSummary = alert ? buildWatchAlertSummary(alert) : '';
  check('copyable alert includes evidence ids and source urls', alertSummary.includes('current-0') && alertSummary.includes('https://example.test/current-0'));
  check('copyable alert includes non-authority heading', alertSummary.includes('NOT AN OPERATIONAL WARNING'));

  const negativeRule = makeRule({
    id: 'rule-negative-scope',
    condition: { kind: 'incident-count', threshold: 1, window: '72h' },
    filters: { theater: 'not-this-theater' },
  });
  const negative = evaluateWatchRules(events, [negativeRule], analysis, { now: NOW });
  check('theater filter prevents nonmatching trigger', negative.stats.triggeredRuleCount === 0);

  const disabledRule = makeRule({ id: 'rule-disabled', enabled: false, condition: { kind: 'incident-count', threshold: 1, window: '72h' } });
  const disabled = evaluateWatchRules(events, [disabledRule], analysis, { now: NOW });
  check('disabled rules are retained but not evaluated as triggers', disabled.stats.triggeredRuleCount === 0 && disabled.evaluations[0]?.explanation.includes('disabled'));

  const surgeRule = makeRule({
    id: 'rule-surge',
    condition: { kind: 'surge-level', surgeLevel: 'surge-indicator' },
    filters: { theater: 'russia-ukraine-war' },
  });
  const surgeResult = evaluateWatchRules(events, [surgeRule], analysis, { now: NOW });
  check('surge-level preset triggers on filtered theater surge', surgeResult.stats.triggeredRuleCount === 1, JSON.stringify(surgeResult.evaluations));
  check('surge alert carries surge signal references', (surgeResult.alerts[0]?.surgeSignalIds.length ?? 0) > 0);
  check('surge alert refuses forecast framing', surgeResult.alerts[0]?.explanations.some((line) => line.includes('not a forecast')) === true);

  const casualtyRule = makeRule({
    id: 'rule-casualty',
    condition: { kind: 'casualty-impact', threshold: 50, window: '72h' },
    filters: { theater: 'russia-ukraine-war' },
  });
  const casualtyResult = evaluateWatchRules(events, [casualtyRule], analysis, { now: NOW });
  check('casualty-impact preset triggers on non-duplicating casualty measure', casualtyResult.stats.triggeredRuleCount === 1, JSON.stringify(casualtyResult.evaluations));
  check('casualty alert reports deterministic measure', casualtyResult.alerts[0]?.summary.includes('casualty measure 75') === true, casualtyResult.alerts[0]?.summary);

  const corroborationRule = makeRule({
    id: 'rule-corroboration',
    condition: { kind: 'corroborated-incident', threshold: 3, window: '72h' },
    filters: { theater: 'russia-ukraine-war' },
  });
  const corroborationResult = evaluateWatchRules(events, [corroborationRule], analysis, { now: NOW });
  check('corroborated-incident preset triggers at independent-family threshold', corroborationResult.stats.triggeredRuleCount === 1, JSON.stringify(corroborationResult.evaluations));
  check('corroboration alert evidence retains family count', (corroborationResult.alerts[0]?.evidenceRefs[0]?.independentFamilyCount ?? 0) >= 3);
}

console.log('\nscenario 4: boundary-uncertain events cannot satisfy conservative event-rule triggers');
{
  const uncertainDay = Date.UTC(2026, 10, 25, 0, 0, 0);
  const uncertain = makeEvent({
    id: 'watch-boundary-only',
    theater: 'watch-boundary-theater',
    conflict: 'Watch Boundary Theater',
    occurredAt: uncertainDay,
    updatedAt: uncertainDay,
    occurrence: createDayOccurrenceWindow(uncertainDay, 'publisher-day'),
  });
  const rule = makeRule({
    id: 'rule-boundary',
    condition: { kind: 'incident-count', threshold: 1, window: '24h' },
    filters: { theater: 'watch-boundary-theater' },
  });
  const analysis = analyzeEscalationSurge([uncertain], { now: NOW });
  const result = evaluateWatchRules([uncertain], [rule], analysis, { now: NOW });
  check('possible-only boundary incident does not trigger count rule', result.stats.triggeredRuleCount === 0, JSON.stringify(result.evaluations));
  check('nontrigger evaluation exposes definite/possible distinction', result.evaluations[0]?.explanation.includes('0 definite incidents versus threshold 1'));
}

console.log('\nscenario 5: lifecycle suppression is presentation-only and storage normalization is fail-safe');
{
  const events = surgeCorpus();
  const analysis = analyzeEscalationSurge(events, { now: NOW });
  const rule = makeRule({ id: 'rule-life', condition: { kind: 'incident-count', threshold: 4, window: '72h' }, filters: { theater: 'russia-ukraine-war' } });
  const alert = evaluateWatchRules(events, [rule], analysis, { now: NOW }).alerts[0];
  check('fixture alert exists for lifecycle tests', Boolean(alert));
  check('unstored alert is active', alert ? getWatchAlertLifecycle(alert, null, NOW) === 'active' : false);
  check('future snooze suppresses without dismissal', alert ? getWatchAlertLifecycle(alert, { fingerprint: alert.fingerprint, ruleId: alert.ruleId, firstSeenAt: NOW, lastSeenAt: NOW, dismissedAt: null, snoozedUntil: NOW + HOUR }, NOW) === 'snoozed' : false);
  check('expired snooze returns active', alert ? getWatchAlertLifecycle(alert, { fingerprint: alert.fingerprint, ruleId: alert.ruleId, firstSeenAt: NOW, lastSeenAt: NOW, dismissedAt: null, snoozedUntil: NOW - 1 }, NOW) === 'active' : false);
  check('dismissal suppresses until restored by local state change', alert ? getWatchAlertLifecycle(alert, { fingerprint: alert.fingerprint, ruleId: alert.ruleId, firstSeenAt: NOW, lastSeenAt: NOW, dismissedAt: NOW, snoozedUntil: null }, NOW) === 'dismissed' : false);
  const normalized = normalizeWatchRules([
    rule,
    { id: '', condition: { kind: 'incident-count' }, filters: {} },
    { id: 'bad-kind', condition: { kind: 'free-form-javascript' }, filters: {} },
    rule,
  ]);
  check('storage normalization drops malformed/duplicate rules and preserves valid rule', normalized.length === 1 && normalized[0].id === rule.id, String(normalized.length));
  check('rule normalization clamps unsafe threshold', normalizeWatchRule({ ...rule, condition: { ...rule.condition, threshold: 999999 } })?.condition.threshold === 500);
}

console.log('\nreal-data smoke: committed fallback incident cache');
{
  const fallbackPath = path.join(frontendDir, 'public', 'data', 'conflict-fallback.json');
  const payload = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  const normalized = (payload.events ?? []).map(conflictData.normalizeWarHeatmapEvent).filter(Boolean);
  const realNow = Date.now();
  const correlated = incidentCorrelation.correlateConflictEvents(normalized, { now: realNow }).incidents;
  const analysis = analyzeEscalationSurge(correlated, { now: realNow });
  const evaluation = evaluateWatchRules(correlated, [], analysis, { now: realNow });
  check('fallback incidents normalize', normalized.length > 500, String(normalized.length));
  check('surge analysis uses correlated canonical incidents from real cache', analysis.stats.analyzedIncidentCount > 400 && analysis.stats.inputIncidentCount === correlated.length, JSON.stringify(analysis.stats));
  check('real analysis produces theater and region scopes', analysis.stats.theaterGroupCount > 0 && analysis.stats.regionGroupCount > 0);
  check('empty rule set evaluates cleanly', evaluation.stats.triggeredRuleCount === 0);
  console.log(`  info real-data: analyzed=${analysis.stats.analyzedIncidentCount}/${analysis.stats.inputIncidentCount}, futureExcluded=${analysis.stats.futureExcludedCount}, signals surge/watch/uncertain=${analysis.stats.surgeIndicatorCount}/${analysis.stats.watchIndicatorCount}/${analysis.stats.uncertainChangeCount}, elapsed=${analysis.stats.elapsedMs}ms`);
  const top = analysis.signals.filter((signal) => signal.isSignal).slice(0, 5);
  for (const signal of top) {
    console.log(`    - ${signal.level} ${signal.groupKind}/${signal.groupLabel}: idx ${signal.indicatorScore}, support ${signal.evidenceSupport}, rate ${formatRatioBounds(signal.metrics.incidentRateRatio)}, intensity ${formatRatioBounds(signal.metrics.intensityRatio)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
