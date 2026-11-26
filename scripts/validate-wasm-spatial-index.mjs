#!/usr/bin/env node
/**
 * Deterministic validation and benchmark harness for catalog batch 19: the resident Rust/WASM
 * incident spatial index and compact zero-copy query page.
 *
 * The harness compiles the exact production Rust core, transpiles the exact production TypeScript
 * wrapper/pure selection module with the repository-pinned compiler, and compares accelerated
 * selections object-by-object against the canonical JavaScript fallback. Fixtures are seeded and
 * cover realistic global distributions plus adversarial antimeridian, polar, invalid-coordinate,
 * duplicate-key, preservation, empty-input, memory-reload, category-mask, time-window, and dense
 * worst-case inputs. Benchmark iteration counts and camera paths are fixed; only wall-clock timing
 * measurements themselves vary by machine.
 */
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';
import { performance } from 'perf_hooks';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const typescript = require(path.join(frontendDir, 'node_modules', 'typescript'));

console.log('building godseye-core.wasm with the existing pipeline');
const build = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-wasm-core.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (build.status !== 0) {
  process.stderr.write(build.stdout ?? '');
  process.stderr.write(build.stderr ?? '');
  throw new Error('wasm build failed');
}
process.stdout.write(`${(build.stdout ?? '').trim()}\n`);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-spatial-'));

function transpileExact(sourceName, outputName, rewrite = (text) => text) {
  const sourcePath = path.join(frontendDir, 'src', 'lib', sourceName);
  const result = typescript.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.ES2022,
      isolatedModules: true,
    },
    fileName: sourceName,
  });
  if (result.diagnostics?.some((diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error)) {
    for (const diagnostic of result.diagnostics) {
      console.error(typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    }
    throw new Error(`${sourceName} failed to transpile`);
  }
  const modulePath = path.join(tempDir, outputName);
  fs.writeFileSync(modulePath, rewrite(result.outputText));
  return modulePath;
}

const globeModulePath = transpileExact('globeRendering.ts', 'globeRendering.mjs');
const wasmModulePath = transpileExact('godseyeWasm.ts', 'godseyeWasm.mjs', (text) => text
  .replace(/import \{ assetPath \} from ["']@\/lib\/assets["'];/, 'const assetPath = (path) => path;')
  .replace(/import \{([^}]+)\} from ["']@\/lib\/globeRendering["'];/, 'import {$1} from "./globeRendering.mjs";'));

const gr = await import(pathToFileURL(globeModulePath).href);
const wasmModule = await import(pathToFileURL(wasmModulePath).href);
const wasmBytes = fs.readFileSync(path.join(frontendDir, 'public', 'wasm', 'godseye-core.wasm'));
const wasmBuffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);
const core = await wasmModule.instantiateGodseyeWasmCore(wasmBuffer);
assert(core, 'production WASM wrapper must instantiate');

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

function makeEvent(id, lat, lng, overrides = {}) {
  return {
    id,
    lat,
    lng,
    intensity: overrides.intensity ?? 0.5,
    occurredAt: overrides.occurredAt ?? 1_760_000_000_000,
    severity: overrides.severity ?? 'high',
    category: overrides.category ?? 'airstrike',
    categoryGroup: overrides.categoryGroup ?? 'kinetic',
    ...overrides,
  };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRealisticEvents(count, seed = 19) {
  const random = seededRandom(seed);
  const groups = ['kinetic', 'security', 'humanitarian', 'political', 'strategic'];
  const categories = ['airstrike', 'artillery', 'naval-blockade', 'displacement', 'ceasefire', 'cyber-infrastructure', 'mobilization'];
  const events = [];
  const baseTime = 1_760_000_000_000;
  for (let index = 0; index < count; index += 1) {
    // Quantized intensity/time values intentionally create priority ties; zero-padded ids make
    // lexicographic tie order differ from source order in a controlled way.
    const clustered = index % 11 === 0;
    const lat = clustered
      ? Math.max(-89.5, Math.min(89.5, 15 + (random() - 0.5) * 35))
      : (random() * 170) - 85;
    const lng = clustered
      ? (random() * 360) - 180
      : (random() * 360) - 180;
    const categoryGroup = groups[Math.floor(random() * groups.length)];
    events.push(makeEvent(`ev-${String(count - index).padStart(7, '0')}`, lat, lng, {
      intensity: Math.floor(random() * 21) / 20,
      occurredAt: baseTime + Math.floor(random() * 24 * 45) * 3_600_000,
      categoryGroup,
      category: categories[Math.floor(random() * categories.length)],
      severity: ['low', 'medium', 'high', 'critical'][Math.floor(random() * 4)],
    }));
  }
  return events;
}

function acceleratedSelection(events, focusLat, focusLng, detailLevel, cap, preserve = []) {
  const priorityOrder = core.prepareIncidentEvents(events);
  if (!priorityOrder || !core.incidentStoreMatches(events)) return null;
  const queryCap = Math.min(events.length, Math.max(0, Math.floor(cap)) + preserve.length);
  const page = core.queryIncidentViewport({
    focusLat,
    focusLng,
    radiusDegrees: gr.viewportRadiusDegreesForDetail(detailLevel),
    cap: queryCap,
  });
  if (!page) return null;
  return gr.selectAdaptiveEventsFromSpatialPage(events, priorityOrder, page, { cap, preserve });
}

function selectionAccount(selection) {
  return [
    selection.total,
    selection.rendered,
    selection.sourceRendered,
    selection.omitted,
    selection.viewportCandidates,
    selection.outsideViewport,
    selection.forcedIncluded,
    selection.cap,
  ];
}

function assertParity(label, events, focusLat, focusLng, detailLevel, cap, preserve = []) {
  const expected = gr.selectAdaptiveEvents(events, focusLat, focusLng, detailLevel, cap, preserve);
  const actual = acceleratedSelection(events, focusLat, focusLng, detailLevel, cap, preserve);
  if (!actual) {
    check(`${label}: accelerated page is available`, false, 'wrapper returned null');
    return false;
  }
  const sameAccount = JSON.stringify(selectionAccount(actual)) === JSON.stringify(selectionAccount(expected));
  const sameLength = actual.selected.length === expected.selected.length;
  const sameObjects = sameLength && actual.selected.every((item, index) => item === expected.selected[index]);
  check(`${label}: selection accounting is exactly identical`, sameAccount, `wasm ${JSON.stringify(selectionAccount(actual))} vs js ${JSON.stringify(selectionAccount(expected))}`);
  check(`${label}: selected object identities and order are exactly identical`, sameObjects, sameLength ? 'object mismatch' : `length ${actual.selected.length} vs ${expected.selected.length}`);
  return sameAccount && sameObjects;
}

console.log('\nscenario 1: adaptive-selection parity across viewport, antimeridian, poles, and global mode');
{
  const borderEvents = [
    makeEvent('west-edge', 0.2, 179.92, { intensity: 0.9, occurredAt: 10 }),
    makeEvent('east-edge', -0.1, -179.91, { intensity: 0.9, occurredAt: 10 }),
    makeEvent('far-europe', 0, 0, { intensity: 1, occurredAt: 20 }),
    makeEvent('polar-east', 88.5, 170, { intensity: 0.8, occurredAt: 30 }),
    makeEvent('polar-west', 88.4, -170, { intensity: 0.8, occurredAt: 30 }),
    makeEvent('south-pole', -89.7, 45, { intensity: 0.7, occurredAt: 40 }),
  ];
  assertParity('antimeridian regional viewport', borderEvents, 0, 179.8, 2, 10);
  assertParity('antimeridian regional viewport opposite side', borderEvents, 0, -179.8, 2, 10);
  assertParity('north-pole viewport keeps longitude scaling exact', borderEvents, 90, 0, 2, 10);
  assertParity('south-pole viewport keeps longitude scaling exact', borderEvents, -90, 0, 2, 10);
  assertParity('unbounded global viewport', borderEvents, 20, 0, 0, 4);

  const realistic = makeRealisticEvents(2500, 101);
  const centers = [
    [20, 40, 2, 430],
    [0, 179.5, 2, 430],
    [0, -179.5, 2, 430],
    [72, 15, 1, 320],
    [-70, -160, 1, 320],
    [10, 10, 0, 190],
  ];
  let allRealistic = true;
  for (const [lat, lng, detail, cap] of centers) {
    allRealistic = assertParity(`seeded realistic viewport ${lat}/${lng}/detail-${detail}`, realistic, lat, lng, detail, cap) && allRealistic;
  }
  check('all seeded realistic center parity cases passed', allRealistic);
}

console.log('\nscenario 2: invalid coordinates, invalid focus, empty input, ties, and preservation parity');
{
  const invalidEvents = [
    makeEvent('valid-zero', 0, 0, { intensity: 1, occurredAt: 100 }),
    makeEvent('nan-lat', Number.NaN, 0, { intensity: 0.99, occurredAt: 90 }),
    makeEvent('nan-lng', 0, Number.NaN, { intensity: 0.98, occurredAt: 80 }),
    makeEvent('infinite-lat', Infinity, 0, { intensity: 0.97, occurredAt: 70 }),
    makeEvent('infinite-lng', 0, -Infinity, { intensity: 0.96, occurredAt: 60 }),
    makeEvent('out-of-range-lat', 120, 0, { intensity: 0.95, occurredAt: 50 }),
    makeEvent('out-of-range-lng', 0, 540, { intensity: 0.94, occurredAt: 40 }),
  ];
  assertParity('invalid coordinates in bounded viewport', invalidEvents, 0, 0, 2, 20);
  assertParity('invalid coordinates in unbounded global viewport', invalidEvents, 0, 0, 0, 20);
  assertParity('NaN camera focus fails closed and deterministic', invalidEvents, Number.NaN, 0, 2, 20);
  assertParity('empty input produces an empty page', [], 0, 0, 2, 430);

  const tieEvents = [
    makeEvent('zulu', 0, 1, { intensity: 0.7, occurredAt: 500 }),
    makeEvent('alpha', 0, 2, { intensity: 0.7, occurredAt: 500 }),
    makeEvent('mike', 0, 3, { intensity: 0.7, occurredAt: 500 }),
    makeEvent('a-combining-é', 0, 4, { intensity: 0.7, occurredAt: 500 }),
  ];
  assertParity('intensity/time ties retain lexicographic deterministic priority', tieEvents, 0, 2, 2, 4);
  assertParity('zero cap still reports exact candidates and omissions', tieEvents, 0, 2, 2, 0);
  assertParity('cap one returns only the canonical highest-priority row', tieEvents, 0, 2, 2, 1);

  const duplicateA = makeEvent('duplicate-id', 1, 1, { intensity: 0.8, occurredAt: 100 });
  const duplicateB = makeEvent('duplicate-id', 1.1, 1.1, { intensity: 0.8, occurredAt: 100 });
  const other = makeEvent('other', 1.2, 1.2, { intensity: 0.79, occurredAt: 101 });
  const duplicateEvents = [duplicateA, duplicateB, other];
  assertParity('duplicate-id rows remain distinct in regular rendering', duplicateEvents, 1, 1, 2, 3);
  const staleRefreshedCopy = { ...duplicateB };
  assertParity('stale preserved refresh identity resolves to fresh input row', duplicateEvents, 1, 1, 2, 2, [staleRefreshedCopy]);
  const repeatedObject = makeEvent('repeated-object-id', 1, 1, { intensity: 0.9, occurredAt: 100 });
  assertParity('the same object reference repeated in input follows exact forced-identity semantics', [repeatedObject, repeatedObject, other], 1, 1, 2, 3, [repeatedObject]);
  const ghost = makeEvent('ghost-not-in-input', 20, 20, { intensity: 1, occurredAt: 999 });
  assertParity('unmatched preserved row remains an accounting-excluded overlay ghost', tieEvents, 0, 2, 2, 2, [ghost]);
}

console.log('\nscenario 3: arbitrary-radius and floating-point decision-boundary exactness');
{
  function customBaseline(events, focusLat, focusLng, radius, cap) {
    return gr.selectViewportAdaptiveItems(gr.rankEventsForRender(events), {
      focusLat,
      focusLng,
      detailLevel: 2,
      viewportRadiusDegrees: radius,
      cap,
      preserve: [],
      keyOf: (item) => item.id ?? item,
    });
  }
  function customAccelerated(events, focusLat, focusLng, radius, cap) {
    const priorityOrder = core.prepareIncidentEvents(events);
    if (!priorityOrder) return null;
    const page = core.queryIncidentViewport({ focusLat, focusLng, radiusDegrees: radius, cap });
    return page ? gr.selectAdaptiveEventsFromSpatialPage(events, priorityOrder, page, { cap, preserve: [] }) : null;
  }
  function assertCustomParity(label, events, focusLat, focusLng, radius, cap) {
    const expected = customBaseline(events, focusLat, focusLng, radius, cap);
    const actual = customAccelerated(events, focusLat, focusLng, radius, cap);
    const same = Boolean(
      actual
      && JSON.stringify(selectionAccount(actual)) === JSON.stringify(selectionAccount(expected))
      && actual.selected.length === expected.selected.length
      && actual.selected.every((item, index) => item === expected.selected[index])
    );
    check(label, same, actual ? `wasm ${JSON.stringify(selectionAccount(actual))} vs js ${JSON.stringify(selectionAccount(expected))}` : 'null accelerated result');
  }

  const focusLat = 12.345678901234;
  const focusLng = 47.123456789012;
  const anchor = makeEvent('precision-anchor', 13.987654321098, 48.765432109876, { intensity: 1, occurredAt: 1000 });
  const exactRadius = gr.viewportDistanceDegrees(anchor.lat, anchor.lng, focusLat, focusLng);
  const boundaryEvents = [
    makeEvent('low-priority-inside', focusLat, focusLng, { intensity: 0.1, occurredAt: 1 }),
    anchor,
    makeEvent('precision-near-before', anchor.lat, anchor.lng + 1e-10, { intensity: 0.99, occurredAt: 999 }),
    makeEvent('precision-near-after', anchor.lat, anchor.lng - 1e-10, { intensity: 0.98, occurredAt: 998 }),
    makeEvent('far-away', -40, -100, { intensity: 0.97, occurredAt: 997 }),
  ];
  assertCustomParity('exact JavaScript-distance decision boundary survives Rust/JS one-ulp cosine differences', boundaryEvents, focusLat, focusLng, exactRadius, 3);
  assertCustomParity('one-ulp-scaled inside boundary remains exact', boundaryEvents, focusLat, focusLng, exactRadius * (1 + 1e-15), 3);
  assertCustomParity('one-ulp-scaled outside boundary remains exact', boundaryEvents, focusLat, focusLng, exactRadius * (1 - 1e-15), 3);

  const radiusEvents = makeRealisticEvents(700, 307);
  for (const radius of [0, 1e-9, 7.25, 30, 58, 179.5, 180, Infinity, -1]) {
    assertCustomParity(`arbitrary radius ${radius}`, radiusEvents, 8, 172, radius, 37);
  }
  assertCustomParity('out-of-range finite camera uses exact conservative scan', radiusEvents, 95, 540, 30, 37);

  const random = seededRandom(404);
  let randomizedParity = true;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const events = makeRealisticEvents(320, 5000 + iteration);
    const lat = (random() * 180) - 90;
    const lng = (random() * 360) - 180;
    const radius = [1.5, 7.25, 30, 58, 91, 179][iteration % 6];
    const cap = [0, 1, 17, 120][iteration % 4];
    const expected = customBaseline(events, lat, lng, radius, cap);
    const actual = customAccelerated(events, lat, lng, radius, cap);
    randomizedParity = Boolean(
      actual
      && JSON.stringify(selectionAccount(actual)) === JSON.stringify(selectionAccount(expected))
      && actual.selected.length === expected.selected.length
      && actual.selected.every((item, index) => item === expected.selected[index])
    ) && randomizedParity;
  }
  check('64 deterministic randomized radius/center/cap parity cases', randomizedParity);
}

console.log('\nscenario 4: packed category-mask and end-exclusive time-window queries');
{
  const events = makeRealisticEvents(2000, 203);
  const priorityOrder = core.prepareIncidentEvents(events);
  check('category fixture store loads', Boolean(priorityOrder));
  const focusLat = 12;
  const focusLng = 44;
  const radius = 30;
  const cap = 97;
  const timeStart = 1_760_000_000_000 + 10 * 24 * 3_600_000;
  const timeEndExclusive = timeStart + 12 * 24 * 3_600_000;
  const categoryMask = wasmModule.INCIDENT_CATEGORY_GROUP_MASKS.kinetic | wasmModule.INCIDENT_CATEGORY_GROUP_MASKS.strategic;
  const page = core.queryIncidentViewport({
    focusLat,
    focusLng,
    radiusDegrees: radius,
    cap,
    categoryMask,
    timeStart,
    timeEndExclusive,
  });
  const ranked = gr.rankEventsForRender(events);
  const inViewport = (event) => gr.viewportDistanceDegrees(event.lat, event.lng, focusLat, focusLng) <= radius;
  const passesFilters = (event) => (
    (wasmModule.INCIDENT_CATEGORY_GROUP_MASKS[event.categoryGroup] & categoryMask) !== 0
    && event.occurredAt >= timeStart
    && event.occurredAt < timeEndExclusive
  );
  const expectedSpatialCount = events.filter(inViewport).length;
  const expectedFiltered = ranked.filter((event) => inViewport(event) && passesFilters(event));
  const actualIds = page ? [...page.indices].map((index) => events[index].id) : [];
  const expectedIds = expectedFiltered.slice(0, cap).map((event) => event.id);
  check('packed category/time page indices match canonical priority/filter order', JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${actualIds.length} vs ${expectedIds.length}`);
  check('packed query header reports spatial candidates independently of filters', page?.viewportCandidates === expectedSpatialCount && page?.outsideViewport === events.length - expectedSpatialCount, JSON.stringify(page && [page.viewportCandidates, page.outsideViewport, expectedSpatialCount]));
  check('packed query header reports exact filtered match count before cap', page?.filteredMatches === expectedFiltered.length, `${page?.filteredMatches} vs ${expectedFiltered.length}`);
}

console.log('\nscenario 5: snapshot refresh reloads replace resident state without unbounded memory growth');
{
  const base = makeRealisticEvents(2048, 301);
  const memorySamples = [];
  const byteLengthSamples = [];
  let allQueriesMatched = true;
  for (let generation = 0; generation < 18; generation += 1) {
    // Simulate a refreshed chunk: fresh array and object identities, stable logical ids, and a
    // deterministic small intensity mutation that changes priority for a subset of rows.
    const refreshed = base.map((event, index) => ({
      ...event,
      intensity: Math.max(0, Math.min(1, event.intensity + ((index + generation) % 17 === 0 ? 0.001 : 0))),
    }));
    const order = core.prepareIncidentEvents(refreshed);
    const page = order ? core.queryIncidentViewport({ focusLat: 10, focusLng: 170, radiusDegrees: 30, cap: 120 }) : null;
    const composition = order && page
      ? gr.selectAdaptiveEventsFromSpatialPage(refreshed, order, page, { cap: 120, preserve: [] })
      : null;
    const baseline = gr.selectAdaptiveEvents(refreshed, 10, 170, 2, 120, []);
    allQueriesMatched = Boolean(
      composition
      && composition.selected.length === baseline.selected.length
      && composition.selected.every((item, index) => item === baseline.selected[index])
    ) && allQueriesMatched;
    memorySamples.push(core.incidentStoreMemoryBytes());
    byteLengthSamples.push(core.wasmMemoryBytes());
  }
  const firstStoreBytes = memorySamples[0] ?? 0;
  const finalStoreBytes = memorySamples[memorySamples.length - 1] ?? 0;
  const firstLinearBytes = byteLengthSamples[0] ?? 0;
  const finalLinearBytes = byteLengthSamples[byteLengthSamples.length - 1] ?? 0;
  const steadyLinearBytes = byteLengthSamples[2] ?? firstLinearBytes;
  const distinctSizes = new Set(memorySamples).size;
  check('every refreshed generation produces exact output parity', allQueriesMatched);
  check('same-size refresh generations reuse a same-size resident store', distinctSizes === 1, JSON.stringify(memorySamples));
  check('final refresh store has not grown relative to first generation', finalStoreBytes === firstStoreBytes, `${firstStoreBytes} -> ${finalStoreBytes}`);
  check('WASM linear memory reaches a flat same-size reload plateau', finalLinearBytes <= steadyLinearBytes + 64 * 1024, `samples ${JSON.stringify(byteLengthSamples)}`);
  check('linear-memory growth across all same-size refreshes is bounded by two pages', finalLinearBytes - firstLinearBytes <= 2 * 64 * 1024, `${firstLinearBytes} -> ${finalLinearBytes}`);
  check('resident store accounting is nonzero and includes fixed output arena', firstStoreBytes > 2048 * 40, `${firstStoreBytes}`);
  console.log(`  info same-size linear-memory samples: ${byteLengthSamples.join(',')} bytes; store bytes ${firstStoreBytes}`);

  const variableBase = makeRealisticEvents(4096, 331);
  const variableSamples = [];
  const sizes = [512, 2048, 1024, 4096];
  for (let generation = 0; generation < 16; generation += 1) {
    const size = sizes[generation % sizes.length];
    const slice = variableBase.slice(0, size);
    const order = core.prepareIncidentEvents(slice);
    if (!order) throw new Error('variable-size fixture failed to prepare');
    core.queryIncidentViewport({ focusLat: 0, focusLng: 179, radiusDegrees: 30, cap: 100 });
    variableSamples.push(core.wasmMemoryBytes());
  }
  const highWatermarkIndex = 3;
  const highWatermark = variableSamples[highWatermarkIndex];
  const postPeakGrowth = Math.max(...variableSamples.slice(highWatermarkIndex + 1)) - highWatermark;
  check('cyclic variable-size reloads plateau after the largest generation', postPeakGrowth <= 2 * 64 * 1024, `samples ${JSON.stringify(variableSamples)}`);
  console.log(`  info variable-size linear-memory samples: ${variableSamples.join(',')} bytes`);

  const malformed = gr.selectAdaptiveEventsFromSpatialPage(
    [makeEvent('fallback-row', 0, 0)],
    [],
    { indices: new Uint32Array(0), viewportCandidates: 0, outsideViewport: 0 },
    { cap: 10, preserve: [] },
  );
  check('malformed accelerator pages return null so callers automatically use the JS fallback', malformed === null);
}

console.log('\nscenario 6: fixed camera-path benchmarks versus canonical JavaScript fallback');
function makeDenseAdversarialEvents(count, seed = 401) {
  const random = seededRandom(seed);
  const events = [];
  for (let index = 0; index < count; index += 1) {
    events.push(makeEvent(`dense-${String(count - index).padStart(6, '0')}`, 10 + (random() - 0.5) * 18, 40 + (random() - 0.5) * 18, {
      intensity: index % 2 === 0 ? 0.75 : 0.5,
      occurredAt: 1_760_000_000_000 + (index % 16) * 3_600_000,
      categoryGroup: index % 3 === 0 ? 'kinetic' : 'security',
    }));
  }
  return events;
}

function cameraPath(centerLat, centerLng, iterations) {
  return Array.from({ length: iterations }, (_, index) => ({
    lat: centerLat + ((index % 7) - 3) * 0.021,
    lng: centerLng + ((index % 11) - 5) * 0.017,
  }));
}

function acceleratedRun(events, camera, detailLevel, cap) {
  const priorityOrder = core.prepareIncidentEvents(events);
  if (!priorityOrder) throw new Error('benchmark store unavailable');
  const page = core.queryIncidentViewport({
    focusLat: camera.lat,
    focusLng: camera.lng,
    radiusDegrees: gr.viewportRadiusDegreesForDetail(detailLevel),
    cap,
  });
  const selection = gr.selectAdaptiveEventsFromSpatialPage(events, priorityOrder, page, { cap, preserve: [] });
  return selection?.selected.length ?? 0;
}

function javascriptRun(events, camera, detailLevel, cap) {
  return gr.selectAdaptiveEvents(events, camera.lat, camera.lng, detailLevel, cap, []).selected.length;
}

function bench(label, events, centerLat, centerLng, detailLevel, cap, iterations) {
  const cameras = cameraPath(centerLat, centerLng, iterations);
  core.prepareIncidentEvents(events);
  javascriptRun(events, cameras[0], detailLevel, cap);
  acceleratedRun(events, cameras[0], detailLevel, cap);

  let jsSink = 0;
  const jsStart = performance.now();
  for (const camera of cameras) jsSink += javascriptRun(events, camera, detailLevel, cap);
  const jsMs = (performance.now() - jsStart) / iterations;

  let wasmSink = 0;
  const wasmStart = performance.now();
  for (const camera of cameras) wasmSink += acceleratedRun(events, camera, detailLevel, cap);
  const wasmMs = (performance.now() - wasmStart) / iterations;
  const parity = jsSink === wasmSink;
  const result = {
    label,
    rows: events.length,
    iterations,
    jsMs: +jsMs.toFixed(4),
    wasmMs: +wasmMs.toFixed(4),
    speedup: +(jsMs / wasmMs).toFixed(2),
    checksumParity: parity,
  };
  console.log(`  info ${label}: js ${result.jsMs} ms/query · wasm ${result.wasmMs} ms/query · ${result.speedup}x · checksum parity ${parity}`);
  check(`${label}: benchmark checksum parity`, parity, `${jsSink} vs ${wasmSink}`);
  return result;
}

const benchmarkResults = [];
{
  const realistic = makeRealisticEvents(30_000, 501);
  const indexStart = performance.now();
  const order = core.prepareIncidentEvents(realistic);
  const indexMs = performance.now() - indexStart;
  check('30k realistic benchmark store loads', Boolean(order));
  console.log(`  info one-time resident index build for 30,000 rows: ${indexMs.toFixed(2)} ms (including canonical priority permutation, typed packing, and KD construction)`);
  benchmarkResults.push(bench('realistic-equatorial-viewport', realistic, 20, 40, 2, 430, 160));
  benchmarkResults.push(bench('realistic-antimeridian-viewport', realistic, 8, 179.5, 2, 430, 160));
  benchmarkResults.push(bench('realistic-polar-viewport', realistic, 82, 0, 2, 430, 160));
  benchmarkResults.push(bench('realistic-global-unbounded', realistic, 20, 0, 0, 190, 160));

  const dense = makeDenseAdversarialEvents(16_000, 601);
  benchmarkResults.push(bench('adversarial-dense-all-candidates', dense, 10, 40, 2, 430, 160));
}

try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* temp cleanup is best-effort */ }

console.log(`\nwasm spatial validation: ${passed} passed, ${failed} failed`);
console.log(JSON.stringify({
  ok: failed === 0,
  passed,
  failed,
  benchmarks: benchmarkResults,
}, null, 2));
if (failed > 0) {
  console.error(`\nfailures:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
