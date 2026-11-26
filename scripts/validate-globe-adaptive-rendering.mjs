#!/usr/bin/env node
/**
 * Deterministic validation harness for the Godseye adaptive-rendering pipeline.
 *
 * The harness uses the repository's pinned TypeScript compiler to transpile the pure
 * render-budget module inside an OS temp directory (never the repo tree), then verifies:
 * quality tiers/caps, pixel-ratio and texture budgets, viewport-adaptive selection accounting,
 * key-based preservation dedupe across feed-refresh identities, tagged-object identity semantics,
 * layer-toggle-aware omission accounting, reduced-effects profile truthfulness, satellite
 * propagation cadences, frame-budget tier transitions and recovery, and status-store dedup.
 * Every assertion is reproducible; no wall-clock or randomness is involved.
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'globe-adaptive-'));
const sourcePath = path.join(frontendDir, 'src', 'lib', 'globeRendering.ts');
const transpiled = typescript.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.ES2022,
    isolatedModules: true,
  },
});
if (transpiled.diagnostics?.some((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error)) {
  for (const diagnostic of transpiled.diagnostics) {
    console.error(typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
  throw new Error('globeRendering.ts failed to transpile');
}
const modulePath = path.join(tempDir, 'globeRendering.mjs');
fs.writeFileSync(modulePath, transpiled.outputText);
const m = await import(pathToFileUrlHref(modulePath));

function pathToFileUrlHref(filePath) {
  let resolved = path.resolve(filePath).replace(/\\/g, '/');
  if (!resolved.startsWith('/')) resolved = `/${resolved}`;
  return `file://${resolved}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`assertion failed: ${message} — expected ${expected}, got ${actual}`);
}

const checks = [];

// --- Detail levels and quality profiles -------------------------------------------------------
assertEqual(m.detailLevelForAltitude(0.5), 2, 'detail level 2 below 0.62');
assertEqual(m.detailLevelForAltitude(1), 1, 'detail level 1 below 1.35');
assertEqual(m.detailLevelForAltitude(2), 0, 'detail level 0 at high altitude');
for (const tier of m.RENDER_QUALITY_TIERS) {
  for (const detail of [0, 1, 2]) {
    const profile = m.globeRenderQualityProfile(tier, detail);
    for (const value of Object.values(profile.caps)) assert(value > 0, `caps positive at ${tier}/${detail}`);
    assert(profile.satelliteTileMaxLevel <= 17, 'tile level within Esri ceiling');
  }
}
assert(
  m.globeRenderQualityProfile('minimal', 2).caps.incidents < m.globeRenderQualityProfile('full', 2).caps.incidents,
  'minimal tier tightens the incident cap',
);
checks.push('quality-profiles');

// --- Reduced-effects / tier chrome truthfulness -----------------------------------------------
{
  const full = m.globeRenderQualityProfile('full', 0);
  const balanced = m.globeRenderQualityProfile('balanced', 0);
  const constrained = m.globeRenderQualityProfile('constrained', 0);
  const minimal = m.globeRenderQualityProfile('minimal', 0);
  assert(full.scanlines && balanced.scanlines, 'scanlines on at full/balanced');
  assert(!constrained.scanlines && !minimal.scanlines, 'scanlines off at constrained/minimal');
  assert(full.htmlPulse && balanced.htmlPulse, 'html pulse on at full/balanced');
  assert(!constrained.htmlPulse && !minimal.htmlPulse, 'html pulse off at constrained/minimal');
  assert(full.animateArcs && balanced.animateArcs && constrained.animateArcs, 'arc flow animates above minimal');
  assert(!minimal.animateArcs, 'arc flow static at minimal');
  assert(full.vignette && constrained.vignette, 'vignette retained above minimal');
  assert(!minimal.vignette, 'vignette simplified at minimal');
  assert(full.enableBloom && balanced.enableBloom, 'bloom enabled at full/balanced');
  assert(!constrained.enableBloom && !minimal.enableBloom, 'bloom disabled at constrained/minimal');
  assertEqual(full.ringAnimation, 'animated', 'rings animated at full');
  assertEqual(constrained.ringAnimation, 'slow', 'rings slowed at constrained');
  assertEqual(minimal.ringAnimation, 'static', 'rings static at minimal');
  assert(!minimal.enableClouds && minimal.cloudSegments === 0, 'cloud shell dropped at minimal');

  // reducedEffects coerces the effective tier to at least constrained, so the chrome flags and
  // budget profile the operator override produces are exactly the constrained-or-lower ones.
  assertEqual(m.moreConstrainedTier('full', 'constrained'), 'constrained', 'override coerces full down');
  assertEqual(m.moreConstrainedTier('minimal', 'constrained'), 'minimal', 'override never raises the tier');
  assertEqual(m.moreConstrainedTier('balanced', 'constrained'), 'constrained', 'override coerces balanced down');
  const overridden = m.globeRenderQualityProfile(m.moreConstrainedTier('full', 'constrained'), 1);
  assert(!overridden.scanlines && !overridden.htmlPulse && !overridden.enableBloom, 'override disables decorative chrome');
}
checks.push('reduced-effects-profile');

// --- Pixel ratio and propagation cadence --------------------------------------------------------
assertEqual(m.resolveAdaptivePixelRatio(3, 0.5, 'full'), 2, 'full tier close zoom caps at 2');
assertEqual(m.resolveAdaptivePixelRatio(3, 2, 'full'), 1.25, 'overview caps at 1.25');
assertEqual(m.resolveAdaptivePixelRatio(3, 0.5, 'minimal'), 1, 'minimal tier caps at 1');
assertEqual(m.satellitePropagationIntervalMs('full'), 10000, 'full tier propagates at 10s');
assertEqual(m.satellitePropagationIntervalMs('balanced'), 10000, 'balanced tier propagates at 10s');
assertEqual(m.satellitePropagationIntervalMs('constrained'), 20000, 'constrained tier propagates at 20s');
assertEqual(m.satellitePropagationIntervalMs('minimal'), 30000, 'minimal tier propagates at 30s');
checks.push('pixel-ratio-and-cadence');

// --- Viewport selection accounting ----------------------------------------------------------------
const events = Array.from({ length: 900 }, (_, index) => ({
  id: `e${index}`,
  lat: (index % 90) - 45,
  lng: ((index * 7) % 360) - 180,
  intensity: (index % 100) / 100,
  occurredAt: index,
}));
{
  const selection = m.selectAdaptiveEvents(events, 0, 0, 2, 430);
  assertEqual(selection.rendered, Math.min(430, selection.viewportCandidates), 'cap-limited rendering');
  assertEqual(selection.total, 900, 'total reflects full input');
  assertEqual(selection.omitted, 900 - selection.sourceRendered, 'omission accounting exact');
}
checks.push('viewport-selection');

// --- Preservation: identity and key-based dedupe --------------------------------------------------
{
  const preserved = events[0];
  const keyed = m.selectAdaptiveEvents(events, 170, 170, 2, 10, [preserved]);
  assertEqual(keyed.selected[0], preserved, 'preserved record renders first');
  assertEqual(keyed.forcedIncluded, 1, 'one forced inclusion');
  const occurrences = keyed.selected.filter((item) => item === preserved).length;
  assertEqual(occurrences, 1, 'preserved input record never duplicated');

  // Simulate a feed refresh: the parent still holds the stale record object while the input
  // carries a fresh object with the same logical id. Keyed matching must render the fresh record,
  // never the stale copy, and never both.
  const stale = events[5];
  const refreshedInput = events.map((event, index) => (index === 5 ? { ...event, lat: event.lat } : event));
  const fresh = refreshedInput[5];
  assert(stale !== fresh && stale.id === fresh.id, 'fixture simulates refresh identity churn');
  const deduped = m.selectAdaptiveEvents(refreshedInput, 170, 170, 2, 10, [stale]);
  assertEqual(deduped.selected.filter((item) => item.id === fresh.id).length, 1, 'no duplicate logical entity');
  assertEqual(deduped.selected[0], fresh, 'fresh input record renders in place of the stale copy');
  assertEqual(deduped.selected.includes(stale), false, 'stale copy never renders');
  assertEqual(deduped.sourceRendered, deduped.selected.length, 'every rendered record is source-backed');
  assertEqual(deduped.omitted, refreshedInput.length - deduped.sourceRendered, 'omission accounting stays exact');

  // A preserved record that no longer exists in the input renders as a transparent overlay and
  // must not corrupt source accounting.
  const ghost = { id: 'ghost', lat: 0, lng: 0, intensity: 1, occurredAt: 1 };
  const overlaid = m.selectAdaptiveEvents(events, 170, 170, 2, 10, [ghost]);
  assertEqual(overlaid.selected[0], ghost, 'unmatched preserved record overlays');
  assertEqual(overlaid.rendered, overlaid.selected.length, 'rendered counts overlay');
  assert(overlaid.sourceRendered < overlaid.rendered, 'overlay excluded from source rendering');
  assertEqual(overlaid.omitted, events.length - overlaid.sourceRendered, 'overlay does not distort omissions');

  // Without keyOf, identity fallback still matches exact input records.
  const legacy = m.selectViewportAdaptiveItems(events, {
    focusLat: 170,
    focusLng: 170,
    detailLevel: 2,
    cap: 10,
    preserve: [events[2]],
  });
  assertEqual(legacy.selected[0], events[2], 'identity preservation without keyOf');
  assertEqual(legacy.selected.filter((item) => item === events[2]).length, 1, 'identity path dedupes');
}
checks.push('preservation-dedupe');

// --- Tagged object identity semantics -------------------------------------------------------------
{
  const record = { id: 'a1', lat: 4, lng: 5 };
  const taggedA = m.tagGlobeObject(record, 'aircraft');
  const taggedB = m.tagGlobeObject(record, 'aircraft');
  assertEqual(taggedA, taggedB, 'tagging is identity-stable per record+kind');
  assertEqual(taggedA.objectKind, 'aircraft', 'tag applied');
  assertEqual(taggedA.id, 'a1', 'source fields copied');
  assert(!('objectKind' in record), 'source record never mutated');
  const otherKind = m.tagGlobeObject(record, 'vessel');
  assert(taggedA !== otherKind, 'distinct kinds distinct objects');
  assertEqual(m.untagGlobeObject(taggedA), record, 'untag roundtrips to source');
  assertEqual(m.untagGlobeObject(otherKind), record, 'untag resolves per kind');
  const plain = { id: 'plain' };
  assertEqual(m.untagGlobeObject(plain), plain, 'untagged input passes through unchanged');
}
checks.push('object-identity');

// --- Track projection -----------------------------------------------------------------------------
{
  const input = { lat: 10, lng: 20, track: 90, speed: 500 };
  const full = m.projectTrackPoints(input, { minSpeed: 70, horizonHours: 0.28, sampleCount: 8 });
  assertEqual(full.length, 8, 'full sample count');
  assert(JSON.stringify(full[0]) === JSON.stringify([10, 20, 0.018]), 'projection starts at origin');
  assert(Number.isFinite(full[7][0]) && full[7][1] > 20, 'projection advances east');
  const reduced = m.projectTrackPoints(input, { minSpeed: 70, horizonHours: 0.28, sampleCount: 5 });
  assertEqual(reduced.length, 5, 'reduced sample count');
  assert(JSON.stringify(reduced[0]) === JSON.stringify(full[0]), 'reduced projection shares origin');
  assert(
    m.cachedTrackProjection(input, { minSpeed: 70, horizonHours: 0.28, sampleCount: 8 })
      === m.cachedTrackProjection(input, { minSpeed: 70, horizonHours: 0.28, sampleCount: 8 }),
    'projection cache identity-stable',
  );
}
checks.push('track-projection');

// --- Particle batching ----------------------------------------------------------------------------
{
  const groups = m.createBatchedParticleGroups([
    { item: { x: 1 }, kind: 'aircraft', color: '#fff', size: 2 },
    { item: { x: 2 }, kind: 'aircraft', color: '#fff', size: 2 },
    { item: { x: 3 }, kind: 'vessel', color: '#00f', size: 1 },
  ]);
  assertEqual(groups.length, 2, 'visual classes batch separately');
  assertEqual(groups[0].length, 2, 'same-visual records merge');
  assertEqual(groups[0].particleColor, '#fff', 'group carries color');
  assert(groups[0] !== groups[1], 'distinct group identities');
}
checks.push('particle-batching');

// --- Layer-toggle-aware omission accounting -------------------------------------------------------
{
  const base = Object.fromEntries(m.RENDER_ACCOUNT_KEYS.map((key) => [key, { total: 10, rendered: 6, omitted: 4 }]));
  const allEnabled = m.summarizeRenderAccounts(base);
  assertEqual(allEnabled.renderedTotal, 6 * m.RENDER_ACCOUNT_KEYS.length, 'enabled layers count toward totals');
  assertEqual(allEnabled.omittedTotal, 4 * m.RENDER_ACCOUNT_KEYS.length, 'enabled omissions count toward totals');
  const withDisabled = Object.fromEntries(m.RENDER_ACCOUNT_KEYS.map((key, index) => [
    key,
    index === 0
      ? m.accountWithLayerEnabled({ total: 10, rendered: 6, omitted: 4 }, false)
      : m.accountWithLayerEnabled({ total: 10, rendered: 6, omitted: 4 }, true),
  ]));
  const partial = m.summarizeRenderAccounts(withDisabled);
  assertEqual(partial.renderedTotal, 6 * (m.RENDER_ACCOUNT_KEYS.length - 1), 'toggled-off layer contributes no rendered objects');
  assertEqual(partial.omittedTotal, 4 * (m.RENDER_ACCOUNT_KEYS.length - 1), 'toggled-off layer contributes no adaptive omissions');
  assertEqual(withDisabled.incidents.layerEnabled, false, 'layer flag preserved');
  assertEqual(withDisabled.incidents.rendered, 6, 'pipeline numbers unaltered by the flag');
  assert(m.RENDER_ACCOUNT_KEYS.includes('theaterLabels') && m.RENDER_ACCOUNT_KEYS.includes('signalArcs'), 'theater labels and signal arcs accounted');
}
checks.push('omission-accounting');

// --- Frame-budget transitions and recovery --------------------------------------------------------
{
  const controller = new m.FrameBudgetController({ initialTier: 'full', windowFrames: 8, warmupFrames: 0 });
  for (let index = 0; index < 16; index += 1) controller.sample(30);
  assertEqual(controller.snapshot().tier, 'balanced', 'sustained over-budget frames step down one tier');
  for (let index = 0; index < 8; index += 1) controller.sample(40);
  assertEqual(controller.snapshot().tier, 'constrained', 'one severely over-budget window steps down immediately');
  for (let index = 0; index < 8; index += 1) controller.sample(40);
  assertEqual(controller.snapshot().tier, 'minimal', 'continued severe pressure steps down again');

  const recovering = new m.FrameBudgetController({ initialTier: 'full', windowFrames: 8, warmupFrames: 0 });
  // 25ms sits above the 1.25x over-budget threshold but below the 1.8x severe threshold, so two
  // sustained windows produce exactly one downward step.
  for (let index = 0; index < 16; index += 1) recovering.sample(25);
  assertEqual(recovering.snapshot().tier, 'balanced', 'drop before recovery test');
  let transition = null;
  for (let index = 0; index < 8 * 5 && !transition; index += 1) transition = recovering.sample(8);
  assertEqual(transition?.reason, 'recovered', 'comfortable frames recover upward');
  assertEqual(recovering.snapshot().tier, 'full', 'recovery restores toward the device ceiling');

  const floored = new m.FrameBudgetController({ initialTier: 'minimal', windowFrames: 8, warmupFrames: 0 });
  for (let index = 0; index < 32; index += 1) floored.sample(50);
  assertEqual(floored.snapshot().tier, 'minimal', 'tier never degrades below minimal');

  const warming = new m.FrameBudgetController({ initialTier: 'full', windowFrames: 8, warmupFrames: 30 });
  for (let index = 0; index < 30; index += 1) assertEqual(warming.sample(60), null, 'warmup never transitions');
  assertEqual(warming.snapshot().windowsCompleted, 0, 'warmup frames excluded from windows');
}
checks.push('frame-budget-transitions');

// --- Status store semantic dedup -------------------------------------------------------------------
{
  const store = m.createGlobeRenderStatusStore();
  const accounts = Object.fromEntries(m.RENDER_ACCOUNT_KEYS.map((key) => [key, { total: 1, rendered: 1, omitted: 0 }]));
  const status = {
    qualityTier: 'full',
    runtimeQualityTier: 'full',
    detailLevel: 2,
    detailLabel: 'local',
    reducedEffects: false,
    pixelRatio: 2,
    frameP80Ms: null,
    frameWindows: 0,
    adaptationLabel: '',
    batchingLabel: '',
    accounts,
    renderedTotal: m.RENDER_ACCOUNT_KEYS.length,
    omittedTotal: 0,
  };
  assertEqual(store.publish(status), true, 'first publish');
  assertEqual(store.publish({ ...status }), false, 'semantic duplicate suppressed');
  const toggled = {
    ...status,
    accounts: {
      ...accounts,
      incidents: m.accountWithLayerEnabled({ total: 1, rendered: 1, omitted: 0 }, false),
    },
  };
  assertEqual(store.publish(toggled), true, 'layer toggle republishes');
}
checks.push('status-store');

// --- Performance smoke ----------------------------------------------------------------------------
function bench(fn, iterations) {
  const start = performance.now();
  let sink = 0;
  for (let index = 0; index < iterations; index += 1) sink += fn(index).length || 0;
  return [(performance.now() - start) / iterations, sink];
}
const [projectionMs] = bench(() => m.projectTrackPoints({ lat: 10, lng: 20, track: 90, speed: 500 }, { minSpeed: 70, horizonHours: 0.28, sampleCount: 8 }), 1000);
const [selectionMs] = bench(() => m.selectAdaptiveEvents(events, 0, 0, 2, 430).selected, 500);

try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* temp cleanup is best-effort */ }

console.log(JSON.stringify({
  ok: true,
  projectionMs: +projectionMs.toFixed(4),
  selectionMs: +selectionMs.toFixed(4),
  checks: checks.join('/'),
}));
