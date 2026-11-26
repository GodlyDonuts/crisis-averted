#!/usr/bin/env node
/**
 * Deterministic source-governance validation and publication gate (catalog batch 17).
 *
 * The gate is intentionally truthful rather than legally overconfident:
 * - malformed registry/ledger structure, missing required attribution, registry drift,
 *   impossible collection/count/timestamp accounting, exact configured secrets, and
 *   high-confidence keyed-browser exposure are hard failures;
 * - unknown licenses and restricted/unclear redistribution posture are reported as review
 *   findings, never converted into a false "compliant" or "noncompliant" legal verdict;
 * - an explicit registry bulkPublicExport="prohibited" with emitted rows is a hard failure.
 *
 * It also runs a no-network adversarial self-test before inspecting the real artifacts.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  LEDGER_SCHEMA_VERSION,
  STATIC_ARTIFACT_COLLECTIONS,
  buildSnapshotProvenanceLedger,
  configuredConnectorSecretValues,
  detectKeyedBrowserExposure,
  loadSourceRegistry,
  redistributionReviewFindings,
  scanSecretShapedMaterial,
  sha256Buffer,
  stableStringify,
  validateSnapshotGovernance,
  validateSourceRegistry,
} from './lib/source-governance.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const selfTestEnabled = !args.has('--no-self-test');
const snapshotPath = resolve(root, 'frontend/public/data/osint-snapshot.json');
const publicDataDir = resolve(root, 'frontend/public/data');
const artifactRoot = resolve(root, 'frontend/out');
const registryPath = resolve(root, 'scripts/source-registry.json');
const publicRegistryPath = join(publicDataDir, 'source-registry.json');
const masterLedgerPath = join(publicDataDir, 'provenance-ledger.json');
const reportPath = join(artifactRoot, 'data', 'source-governance-report.json');

const errors = [];
const warnings = [];
const selfTests = [];
function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function checkSelfTest(name, condition, detail = '') {
  selfTests.push({ name, passed: Boolean(condition), detail });
  if (!condition) fail(`self-test failed: ${name}${detail ? ` — ${detail}` : ''}`);
}
function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`${label} unreadable or invalid JSON: ${error.message}`); return null; }
}

function runSelfTests(registry, snapshot) {
  if (!selfTestEnabled) return;
  const temp = mkdtempSync(join(tmpdir(), 'source-governance-harness-'));
  try {
    // 1. Adversarial secret-shaped samples are detected without printing their values.
    const exact = 'harnessExactSecret_1234567890';
    const secretFile = join(temp, 'secrets.json');
    const aws = 'AKIAIOSFODNN7EXAMPLE';
    const github = 'ghp_abcdefghijklmnopqrstuvwxyzABCDE12345';
    const queryToken = 'abcdef1234567890abcdef';
    writeFileSync(secretFile, JSON.stringify({
      aws,
      github,
      exact,
      nested: `https://example.test/path?accessToken=${queryToken}`,
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart',
      pem: '-----BEGIN PRIVATE KEY-----',
    }));
    const scan = scanSecretShapedMaterial({ paths: [temp], root: temp, secretValues: [exact] });
    const ids = new Set(scan.findings.map((finding) => finding.patternId));
    checkSelfTest('adversarial AWS/GitHub/JWT/private-key/query-token shapes are detected', ['aws-access-key', 'github-token', 'jwt-like-token', 'private-key-block', 'secret-query-parameter'].every((id) => ids.has(id)), [...ids].join(','));
    checkSelfTest('exact configured secret is detected by fingerprint only', scan.findings.some((finding) => finding.patternId === 'exact-configured-secret'));
    checkSelfTest('secret scan findings never serialize raw secret values', !JSON.stringify(scan.findings).includes(exact) && !JSON.stringify(scan.findings).includes(queryToken));

    // Legitimate high-entropy operational data must not be treated as secret material merely
    // because it is long or encoded. This keeps the scanner high-confidence and reviewable.
    const benignFile = join(temp, 'benign-operational-data.txt');
    writeFileSync(benignFile, [
      '1 25544U 98067A   26001.00000000  .00002182  00000-0  40868-4 0  9992',
      '2 25544  51.6416 247.4627 0006703  69.9862  25.2906 15.49560532432129',
      'sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'public-id=CVE-2026-0001 H3=8928342e20fffff',
    ].join('\n'));
    const benignScan = scanSecretShapedMaterial({ paths: [benignFile], root: temp, secretValues: [] });
    checkSelfTest('TLEs, hashes, and public identifiers do not trigger the high-confidence scanner', benignScan.findings.length === 0, JSON.stringify(benignScan.findings));

    // Browser exposure fixtures fail closed for both non-public env access and keyed-host fetches.
    const fixtureSrc = join(temp, 'src');
    mkdirSync(fixtureSrc, { recursive: true });
    writeFileSync(join(fixtureSrc, 'exposure.ts'), 'const key = process.env.WINDY_WEBCAMS_KEY; void fetch("https://api.windy.com/webcams/api/v3/webcams", { headers: { key } });');
    const exposureFixture = detectKeyedBrowserExposure({ registry, frontendSrcDir: fixtureSrc, artifactRoot: join(temp, 'out-does-not-exist'), root: temp });
    checkSelfTest('keyed endpoint plus non-public env access in browser source blocks publication', exposureFixture.errors.some((finding) => finding.patternId === 'non-public-process-env-in-client-source') && exposureFixture.errors.some((finding) => finding.sourceId === 'windy-webcams'));

    // 2. Required/requested attribution removal is a hard validation failure.
    if (snapshot?.provenanceLedger) {
      const missingAttribution = structuredClone(snapshot);
      let changed = false;
      for (const collection of Object.values(missingAttribution.provenanceLedger.collections)) {
        for (const source of collection.sources) {
          if (!changed && ['required', 'requested'].includes(source.attribution.requirement)) {
            source.attribution.text = '';
            changed = true;
          }
        }
      }
      checkSelfTest('fixture contains required/requested attribution to mutate', changed);
      const attributionValidation = validateSnapshotGovernance(missingAttribution, registry);
      checkSelfTest('missing required attribution blocks publication', attributionValidation.errors.some((message) => message.includes('missing required/requested attribution')));

      // 3. Registry/ledger drift is a hard failure.
      const drifted = structuredClone(snapshot);
      const first = drifted.provenanceLedger.collections.militaryAircraft;
      first.sourceIds = ['unregistered-source'];
      const driftValidation = validateSnapshotGovernance(drifted, registry);
      checkSelfTest('registry drift or unregistered source coverage blocks publication', driftValidation.errors.some((message) => message.includes('registry coverage drift') || message.includes('not present in canonical source registry')));

      // 4. Explicitly unknown licenses are reported, not silently converted into legality or illegality.
      const unknownValidation = validateSnapshotGovernance(snapshot, registry);
      checkSelfTest('unknown licenses are truthful review findings rather than automatic schema failures', unknownValidation.warnings.some((message) => message.includes('license explicitly unknown')) && !unknownValidation.errors.some((message) => message.includes('license explicitly unknown')));
      checkSelfTest('real snapshot coverage is structurally complete', Object.keys(snapshot.provenanceLedger.collections).length === 13 && Object.values(snapshot.provenanceLedger.collections).every((collection) => Array.isArray(collection.sourceIds) && collection.sourceIds.length > 0 && Array.isArray(collection.sources) && collection.sources.length === collection.sourceIds.length));
    }

    // 5. An explicit prohibited redistribution marker is a hard failure when rows are emitted.
    if (snapshot?.provenanceLedger) {
      const prohibitedRegistry = structuredClone(registry);
      prohibitedRegistry.sources.find((source) => source.id === 'adsb-lol-military').redistribution.bulkPublicExport = 'prohibited';
      const prohibitedValidation = validateSnapshotGovernance(snapshot, prohibitedRegistry);
      checkSelfTest('explicitly prohibited bulk export blocks publication when rows exist', prohibitedValidation.errors.some((message) => message.includes('explicitly prohibited bulk export')));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function validateMasterLedger(master, registry, snapshot) {
  if (!master) return;
  if (master.schemaVersion !== LEDGER_SCHEMA_VERSION) fail('master provenance ledger schemaVersion mismatch');
  if (master.registryVersion !== registry.registryVersion) fail('master provenance ledger does not match canonical registry version');
  if (!String(master.legalPosition ?? '').includes('not legal advice')) fail('master provenance ledger missing legal-position disclaimer');
  if (stableStringify(master.collections) !== stableStringify(snapshot?.provenanceLedger?.collections)) fail('master provenance ledger collections differ from snapshot ledger');
  for (const [collection, spec] of Object.entries(STATIC_ARTIFACT_COLLECTIONS)) {
    const entry = master.artifacts?.[collection];
    if (!entry || entry.present !== true) {
      fail(`${collection} master artifact ledger entry missing or marked absent`);
      continue;
    }
    const file = join(root, spec.artifactPath);
    if (!existsSync(file)) {
      fail(`${collection} artifact file missing at ${spec.artifactPath}`);
      continue;
    }
    const buffer = readFileSync(file);
    if (entry.sha256 !== sha256Buffer(buffer)) fail(`${collection} artifact hash in ledger does not match public artifact`);
    const payload = JSON.parse(buffer.toString('utf8'));
    const count = collection === 'conflictFallback' ? payload.events?.length : payload.features?.length;
    if (entry.recordCount !== count) fail(`${collection} artifact ledger record count mismatch`);
    if (collection === 'conflictFallback' && !String(entry.artifactLicenseDeclaration ?? '').includes('CC BY 4.0')) fail('conflictFallback missing embedded CC BY 4.0 license declaration');
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) fail(`${collection} artifact provenance sources missing`);
  }
}

const { registry, text: canonicalRegistryText } = loadSourceRegistry(registryPath);
const registryValidation = validateSourceRegistry(registry);
errors.push(...registryValidation.errors.map((message) => `registry: ${message}`));
warnings.push(...registryValidation.warnings.map((message) => `registry review: ${message}`));

const snapshot = readJson(snapshotPath, 'osint snapshot');
let governanceValidation = { errors: ['snapshot unavailable'], warnings: [] };
if (snapshot) {
  governanceValidation = validateSnapshotGovernance(snapshot, registry);
  errors.push(...governanceValidation.errors.map((message) => `snapshot governance: ${message}`));
  warnings.push(...governanceValidation.warnings.map((message) => `snapshot governance review: ${message}`));
}

if (!existsSync(publicRegistryPath)) fail('public source-registry.json missing beside static data');
else if (readFileSync(publicRegistryPath, 'utf8').trim() !== canonicalRegistryText.trim()) fail('public source-registry.json differs from canonical scripts/source-registry.json');

// The static export copies rather than transforms data files. Refuse publication if the
// artifact tree contains stale or divergent governance/data files even when public/ is valid.
if (existsSync(artifactRoot)) {
  for (const name of ['osint-snapshot.json', 'source-registry.json', 'provenance-ledger.json', 'conflict-fallback.json', 'ne_110m_admin_0_countries.geojson']) {
    const publicFile = join(publicDataDir, name);
    const artifactFile = join(artifactRoot, 'data', name);
    if (!existsSync(artifactFile)) fail(`frontend/out is missing data/${name}`);
    else if (sha256Buffer(readFileSync(artifactFile)) !== sha256Buffer(readFileSync(publicFile))) fail(`frontend/out data/${name} is stale or diverges from frontend/public/data/${name}`);
  }
}

const master = existsSync(masterLedgerPath) ? readJson(masterLedgerPath, 'master provenance ledger') : null;
if (!master) fail('public provenance-ledger.json missing beside static data');
else validateMasterLedger(master, registry, snapshot);

runSelfTests(registry, snapshot);

const scanTargets = [publicDataDir];
if (existsSync(artifactRoot)) scanTargets.push(artifactRoot);
const secretScan = scanSecretShapedMaterial({
  paths: scanTargets,
  root,
  secretValues: configuredConnectorSecretValues(process.env),
});
for (const finding of secretScan.findings) {
  fail(`secret-shaped material in client-visible artifact: ${finding.file}:${finding.line}:${finding.column} pattern=${finding.patternId} sha256:${finding.secretFingerprint} length=${finding.matchLength}`);
}
for (const missing of secretScan.missingPaths) warn(`scan target missing: ${missing}`);

const exposure = detectKeyedBrowserExposure({ registry, frontendSrcDir: join(root, 'frontend/src'), artifactRoot, root });
for (const finding of exposure.errors) {
  fail(`keyed-source browser exposure risk: ${finding.file}:${finding.line}:${finding.column} ${finding.sourceId ?? finding.patternId} ${finding.host ?? finding.envVar ?? ''}`);
}
for (const finding of exposure.warnings.slice(0, 30)) {
  warn(`informational keyed-endpoint string (not itself a failure): ${finding.file}:${finding.line} ${finding.sourceId} ${finding.host}`);
}

const reviewFindings = snapshot?.provenanceLedger ? redistributionReviewFindings(snapshot.provenanceLedger) : [];
for (const finding of reviewFindings) {
  warn(`redistribution/license review: ${finding.collection}/${finding.sourceId} license=${finding.licenseStatus} redistribution=${finding.redistributionStatus} bulk=${finding.bulkPublicExport} risk=${finding.publicStaticRisk}`);
}

const report = {
  schemaVersion: 'source-governance-report/v1',
  generatedAt: new Date().toISOString(),
  legalPosition: 'Automated audit report only. Unknown or restricted redistribution entries are review findings, not legal compliance or infringement determinations.',
  status: errors.length > 0 ? 'failed' : 'passed-with-truthful-review-findings',
  errors,
  warnings,
  selfTests,
  registry: {
    schemaVersion: registry.schemaVersion,
    registryVersion: registry.registryVersion,
    sourceCount: registry.sources.length,
  },
  snapshot: snapshot?.provenanceLedger ? {
    fetchedAt: snapshot.fetchedAt,
    collectionCount: Object.keys(snapshot.provenanceLedger.collections).length,
    summary: snapshot.provenanceLedger.summary,
  } : null,
  secretScan: {
    filesScanned: secretScan.filesScanned,
    bytesScanned: secretScan.bytesScanned,
    findingCount: secretScan.findings.length,
    skippedFiles: secretScan.skippedFiles,
    findings: secretScan.findings,
  },
  keyedBrowserExposure: {
    keyedSourceIds: exposure.keyedSourceIds,
    errorCount: exposure.errors.length,
    warningCount: exposure.warnings.length,
    errors: exposure.errors,
    warnings: exposure.warnings,
  },
  redistributionReviewFindings: reviewFindings,
};

if (existsSync(artifactRoot)) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report));
}

console.log(`source-governance: ${selfTests.filter((test) => test.passed).length}/${selfTests.length} self-tests passed; ${secretScan.filesScanned} files/${secretScan.bytesScanned} bytes scanned; ${reviewFindings.length} redistribution/license review findings; ${exposure.errors.length} keyed-exposure errors`);
for (const test of selfTests) console.log(`  ${test.passed ? 'ok' : 'FAIL'} ${test.name}`);
for (const message of warnings.slice(0, 30)) console.warn(`review: ${message}`);
if (warnings.length > 30) console.warn(`review: ... ${warnings.length - 30} additional findings in report`);
if (errors.length > 0) {
  for (const message of errors.slice(0, 30)) console.error(`gate: ${message}`);
  if (errors.length > 30) console.error(`gate: ... ${errors.length - 30} additional errors in report`);
  process.exit(1);
}
console.log(`source-governance: publication gate passed without claiming legal compliance; report ${existsSync(artifactRoot) ? reportPath : 'not written (artifact root absent)'}`);
