#!/usr/bin/env node
/**
 * Deterministic validation harness for catalog batch 10 (URL-persisted operator state).
 *
 * The harness transpiles the pure TypeScript codec with the repository-pinned compiler,
 * then verifies exact compact encodings, Unicode round-trips, backwards-compatible
 * defaults, legacy `?mode=satellite` links, hostile/malformed payload validation,
 * length guardrails, camera quantization, playback envelopes, and secret-material
 * redaction. No wall clock, network, browser, or random input is used.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import assert from 'assert';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = path.join(repoRoot, 'frontend');
const typescript = require(path.join(frontendDir, 'node_modules', 'typescript'));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-url-state-'));
const sourcePath = path.join(frontendDir, 'src', 'lib', 'operatorUrlState.ts');
const transpiled = typescript.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: {
    target: typescript.ScriptTarget.ES2020,
    module: typescript.ModuleKind.ES2020,
    isolatedModules: true,
  },
  fileName: 'operatorUrlState.ts',
}).outputText;
const modulePath = path.join(tempDir, 'operatorUrlState.mjs');
fs.writeFileSync(modulePath, transpiled);
const codec = await import(`file://${modulePath.replace(/\\/g, '/')}`);

const {
  OPERATOR_URL_FRAGMENT_PREFIX,
  MAX_OPERATOR_URL_FRAGMENT_LENGTH,
  MAX_OPERATOR_QUERY_LENGTH,
  createDefaultOperatorUrlState,
  encodeOperatorUrlState,
  parseOperatorUrlState,
  looksLikeSecretMaterial,
} = codec;

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
function wireFragment(object) {
  return `#${OPERATOR_URL_FRAGMENT_PREFIX}${Buffer.from(JSON.stringify(object), 'utf8').toString('base64url')}`;
}

console.log('\nscenario 1: compact versioned defaults and deterministic rich-state round-trip');
{
  const defaults = createDefaultOperatorUrlState();
  const encodedDefaults = encodeOperatorUrlState(defaults);
  check('default workspace has the exact compact empty-envelope encoding', encodedDefaults === 's1.e30', encodedDefaults ?? 'null');
  const parsedDefaults = parseOperatorUrlState(`#${encodedDefaults}`, '');
  check('default envelope is recognized and valid', parsedDefaults.recognized && parsedDefaults.valid);
  assert.deepStrictEqual(parsedDefaults.state, defaults);
  check('default round-trip is field-for-field exact', true);

  const rich = createDefaultOperatorUrlState();
  rich.visualMode = 'satellite';
  rich.layers.density = false;
  rich.layers.clouds = false;
  rich.layers.orbitalAssets = true;
  rich.layers.environmental = true;
  rich.filters.timeWindow = '7d';
  rich.filters.categoryGroups = ['kinetic', 'strategic'];
  rich.filters.severities = ['critical', 'medium'];
  rich.filters.theater = 'russia-ukraine-war';
  rich.filters.query = 'Kyiv drones — Буча';
  rich.selectedEventId = 'ucdp:12345';
  rich.refreshPaused = true;
  rich.panels = { theater: false, incident: true, source: true, inspector: 'convergence' };
  rich.playback = {
    active: true,
    playing: true,
    mode: 'cumulative',
    frameIndex: 42,
    frameStart: Date.UTC(2026, 0, 15, 12, 0, 0),
    speedMultiplier: 4,
    resolutionPreference: 'day',
    trailHours: 72,
  };
  rich.camera = { lat: 50.123, lng: 30.234, altitude: 0.823 };

  const first = encodeOperatorUrlState(rich);
  const second = encodeOperatorUrlState(rich);
  check('rich workspace serialization is byte deterministic', first === second, `${first} vs ${second}`);
  check('rich workspace stays comfortably inside the fragment guardrail', Boolean(first) && first.length < 650, `${first?.length}`);
  const parsedRich = parseOperatorUrlState(`#${first}`, '');
  check('rich workspace fragment is recognized and valid', parsedRich.recognized && parsedRich.valid);
  assert.deepStrictEqual(parsedRich.state, rich);
  check('rich workspace round-trip is field-for-field exact', true);
}

console.log('\nscenario 2: backwards-compatible defaults, additive fields, and legacy mode query');
{
  const unknownFuture = parseOperatorUrlState(wireFragment({ m: 1, futureFeature: { nested: ['ignored'] } }), '');
  check('unknown additive fields are ignored without invalidating known state', unknownFuture.valid && unknownFuture.state.visualMode === 'satellite');
  const emptyObject = parseOperatorUrlState(wireFragment({}), '');
  assert.deepStrictEqual(emptyObject.state, createDefaultOperatorUrlState());
  check('empty object restores exact v1 defaults', true);

  const legacy = parseOperatorUrlState('', '?mode=satellite');
  check('legacy ?mode=satellite query still selects satellite mode', legacy.legacyModeApplied && legacy.state.visualMode === 'satellite');
  const hashWins = parseOperatorUrlState(wireFragment({}), '?mode=satellite');
  check('versioned hash takes precedence over legacy mode query', !hashWins.legacyModeApplied && hashWins.state.visualMode === 'cinematic');
  const unrelatedHash = parseOperatorUrlState('#legend', '?mode=satellite');
  check('unrelated anchors do not count as malformed operator payloads', unrelatedHash.valid && !unrelatedHash.recognized && unrelatedHash.state.visualMode === 'satellite');
  const futureVersion = parseOperatorUrlState('#s2.e30', '');
  check('future operator schema versions are recognized as unsupported rather than misparsed', futureVersion.recognized && !futureVersion.valid && futureVersion.state.visualMode === 'cinematic');
}

console.log('\nscenario 3: hostile and malformed payloads fail closed without throwing');
{
  const invalidInputs = [
    ['empty payload', '#s1.'],
    ['illegal base64url characters', '#s1.***'],
    ['non-canonical trailing bits', '#s1.e31'],
    ['non-object JSON', wireFragment([])],
    ['invalid UTF-8', `#${OPERATOR_URL_FRAGMENT_PREFIX}${Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url')}`],
    ['oversize fragment', `#${OPERATOR_URL_FRAGMENT_PREFIX}${'A'.repeat(MAX_OPERATOR_URL_FRAGMENT_LENGTH)}`],
  ];
  for (const [label, fragment] of invalidInputs) {
    let result = null;
    let threw = false;
    try {
      result = parseOperatorUrlState(fragment, '');
    } catch {
      threw = true;
    }
    check(`${label} is rejected without throwing`, !threw && result && !result.valid, threw ? 'threw' : JSON.stringify(result?.issues));
    check(`${label} falls back to safe defaults`, result && result.state.visualMode === 'cinematic' && result.state.filters.timeWindow === '30d');
  }

  const hostile = parseOperatorUrlState(wireFragment({
    q: 'A'.repeat(1000),
    th: '../../..',
    ev: 'javascript:alert(1)',
    c: [999999, 0, 0],
    pb: { f: Number.MAX_SAFE_INTEGER, s: 99, p: 42, ft: -1 },
    pn: 999,
    pi: 99,
    cg: -1,
    sv: 99999,
    tw: 99,
    m: 99,
  }), '');
  check('hostile field values are dropped while the JSON envelope remains parseable', hostile.valid);
  check('hostile free text, slug, event id, and camera do not enter restored state', hostile.state.filters.query === '' && hostile.state.filters.theater === null && hostile.state.selectedEventId === null && hostile.state.camera === null);
  check('hostile masks and enum indexes retain safe defaults', hostile.state.visualMode === 'cinematic' && hostile.state.filters.timeWindow === '30d' && hostile.state.filters.categoryGroups.join(',') === 'kinetic,security,strategic' && hostile.state.panels.inspector === 'feed');
  check('hostile playback numbers retain safe defaults', hostile.state.playback.active && !hostile.state.playback.playing && hostile.state.playback.speedMultiplier === 1 && hostile.state.playback.frameIndex === null && hostile.state.playback.frameStart === null);
}

console.log('\nscenario 4: validation and quantization edge cases');
{
  const state = createDefaultOperatorUrlState();
  state.camera = { lat: 35.12349, lng: 190.45651, altitude: 1.23449 };
  const encoded = encodeOperatorUrlState(state);
  const parsed = parseOperatorUrlState(`#${encoded}`, '');
  check('longitude is normalized across the antimeridian', parsed.state.camera?.lng === -169.543, JSON.stringify(parsed.state.camera));
  check('camera coordinates are quantized to deterministic millidegrees', parsed.state.camera?.lat === 35.123 && parsed.state.camera?.altitude === 1.234, JSON.stringify(parsed.state.camera));

  const invalidCamera = createDefaultOperatorUrlState();
  invalidCamera.camera = { lat: 91, lng: 0, altitude: 1 };
  check('out-of-range camera latitude is omitted rather than clamped into a false position', parseOperatorUrlState(`#${encodeOperatorUrlState(invalidCamera)}`, '').state.camera === null);

  const unicode = createDefaultOperatorUrlState();
  unicode.filters.query = 'إدلب —  — Kyiv';
  const unicodeRoundTrip = parseOperatorUrlState(`#${encodeOperatorUrlState(unicode)}`, '');
  check('Unicode search state round-trips exactly', unicodeRoundTrip.state.filters.query === unicode.filters.query, unicodeRoundTrip.state.filters.query);

  const control = parseOperatorUrlState(wireFragment({ q: 'kyiv\n<script>' }), '');
  check('control-character search text is rejected', control.state.filters.query === '');

  const frameMilliseconds = parseOperatorUrlState(wireFragment({ pb: { f: 7, ft: 1767225600123 } }), '');
  check('playback frame index and epoch-millisecond frame start decode exactly', frameMilliseconds.state.playback.frameIndex === 7 && frameMilliseconds.state.playback.frameStart === 1767225600123, JSON.stringify(frameMilliseconds.state.playback));
}

console.log('\nscenario 5: secret-looking search text never enters a permalink');
{
  const samples = [
    'token=abc123456789',
    'api_key: abc123456789',
    'Bearer abcdefghijklmnop',
    'AKIAABCDEFGHIJKLMNOP',
    'eyJaaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc',
    'sk-abcdefgh123456789',
    '-----BEGIN PRIVATE KEY-----',
  ];
  for (const sample of samples) {
    check(`secret detector recognizes ${sample.slice(0, 18)}`, looksLikeSecretMaterial(sample));
    const state = createDefaultOperatorUrlState();
    state.filters.query = sample;
    const encoded = encodeOperatorUrlState(state);
    const parsed = parseOperatorUrlState(`#${encoded}`, '');
    check('secret-looking query is withheld from encoded and decoded state', parsed.state.filters.query === '', parsed.state.filters.query);
  }
  const benign = createDefaultOperatorUrlState();
  benign.filters.query = 'tokenization research';
  const benignParsed = parseOperatorUrlState(`#${encodeOperatorUrlState(benign)}`, '');
  check('benign non-secret search text is preserved', benignParsed.state.filters.query === 'tokenization research');
}

console.log('\nscenario 6: serialization length guardrails remain deterministic at maximum field sizes');
{
  const maxed = createDefaultOperatorUrlState();
  maxed.filters.query = 'q'.repeat(MAX_OPERATOR_QUERY_LENGTH);
  maxed.selectedEventId = `ev-${'x'.repeat(157)}`;
  maxed.filters.theater = `t${'-theater'.repeat(11)}`;
  const encoded = encodeOperatorUrlState(maxed);
  check('maximum-size valid state remains encodable', Boolean(encoded), 'encode returned null');
  check('maximum-size valid state remains inside the fragment guardrail', Boolean(encoded) && encoded.length <= MAX_OPERATOR_URL_FRAGMENT_LENGTH, `${encoded?.length}`);
  const parsed = parseOperatorUrlState(`#${encoded}`, '');
  check('maximum-size valid state round-trips without truncation', parsed.state.filters.query.length === MAX_OPERATOR_QUERY_LENGTH && parsed.state.selectedEventId === maxed.selectedEventId, `${parsed.state.filters.query.length}/${parsed.state.selectedEventId}`);

  const deterministic = Array.from({ length: 100 }, () => encodeOperatorUrlState(maxed));
  check('one hundred repeated serializations are byte-identical', deterministic.every((value) => value === encoded));
}

console.log(`\noperator URL-state validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nfailures:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
