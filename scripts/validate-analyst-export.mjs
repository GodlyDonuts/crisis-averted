#!/usr/bin/env node
/**
 * Deterministic validation harness for catalog batch 11 (comprehensive analyst export
 * bundles and evidence handoff).
 *
 * What it does:
 *  1. Transpiles the frontend TypeScript export/codec/temporal/surge/watch modules with the
 *     repository's pinned typescript compiler, rewriting @/ aliases onto a temp module graph.
 *  2. Runs fixture assertions for schema shape, circular-reference safety under adversarial
 *     input, citation/URL preservation across every section, deterministic byte-stable
 *     ordering under input reordering, safety-cap size behavior with honest truncation,
 *     secret-shaped search-text redaction, UTC filename/content timestamps, playback/filter/
 *     operator scope recording, permalink construction, and no-fabrication behavior on
 *     empty inputs.
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyst-export-'));

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
const operatorUrlStatePath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'operatorUrlState.ts'),
  'operatorUrlState.mjs',
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
const exportPath = transpileModule(
  path.join(frontendDir, 'src', 'lib', 'analystExport.ts'),
  'analystExport.mjs',
  { '@/lib/operatorUrlState': './operatorUrlState.mjs' },
);

const incidentTime = await import(pathToFileURL(incidentTimePath).href);
const operatorUrlState = await import(pathToFileURL(operatorUrlStatePath).href);
const surge = await import(pathToFileURL(surgePath).href);
const watch = await import(pathToFileURL(watchPath).href);
const incidentCorrelation = await import(pathToFileURL(correlationPath).href);
const conflictData = await import(pathToFileURL(conflictDataPath).href);
const analystExport = await import(pathToFileURL(exportPath).href);

const {
  ANALYST_EXPORT_SCHEMA_VERSION,
  ANALYST_EXPORT_UNVERIFIED_CAVEAT,
  ANALYST_EXPORT_NO_AUTHORITY_CAVEAT,
  MAX_EXPORT_INCIDENTS,
  MAX_MARKDOWN_INCIDENT_ROWS,
  analystExportFilename,
  buildAnalystExportArtifacts,
  buildAnalystExportBundle,
  buildShareablePermalink,
  projectIncidentForExport,
  utcFilenameStamp,
  utcIso,
} = analystExport;
const { analyzeEscalationSurge } = surge;
const { evaluateWatchRules, normalizeWatchRule } = watch;
const { createSecondOccurrenceWindow } = incidentTime;

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

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0); // 2026-11-26T12:00:00.000Z fixed for determinism
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
    sources: [
      { name: 'FixtureWire', url: `https://example.test/${id}` },
      { name: 'FixtureMirror', url: `https://mirror.example.test/${id}` },
    ],
    intensity: 0.5,
    sourceFamily: 'warheatmap',
    occurrence: createSecondOccurrenceWindow(NOW - HOUR),
    incident: membership(),
    ...overrides,
  };
}

function makeClusteredCorpus() {
  // Canonical incident A with a two-member evidence cluster (warheatmap + ucdp families),
  // a fatality contradiction, and ordered rationale; plus one singleton incident D.
  const memberB = makeEvent({
    id: 'wh-report-b',
    sourceFamily: 'warheatmap',
    killed: 12,
    countedCasualties: 12,
    title: 'Strike hits Kharkiv convoy',
    occurredAt: NOW - 5 * HOUR,
    updatedAt: NOW - 5 * HOUR,
  });
  const memberC = makeEvent({
    id: 'ucdp:991',
    sourceFamily: 'ucdp',
    killed: 3,
    countedCasualties: 3,
    title: 'Kharkiv convoy attack',
    occurredAt: NOW - 5 * HOUR,
    updatedAt: NOW - 5 * HOUR,
    ucdp: {
      id: 991, relid: 'TEST-1', year: 2026, active_year: true, code_status: 'Clear',
      type_of_violence: 1, conflict_new_id: 1, conflict_name: 'Russia-Ukraine War',
      dyad_new_id: 1, dyad_name: 'test dyad', side_a_new_id: 1, side_a: 'Government of Russia',
      side_b_new_id: 2, side_b: 'Government of Ukraine', number_of_sources: 2,
      source_article: 'FixtureNews', source_office: 'FixtureDesk', source_date: '2026-11-21',
      source_headline: 'convoy struck', source_original: 'fixture original attribution',
      where_prec: 2, where_coordinates: 'Kharkiv', where_description: 'Kharkiv city',
      adm_1: 'Kharkiv', adm_2: null, priogrid_gid: 1, country: 'Ukraine', country_id: 1,
      region: 'Europe', event_clarity: 1, date_prec: 1, date_start: '2026-11-21', date_end: '2026-11-21',
      deaths_a: 0, deaths_b: 3, deaths_civilians: 0, deaths_unknown: 0, low: 3, best: 3, high: 5,
      gwnoa: null, gwnob: null, dataset_version: '25.1', dataset_release: 'candidate',
    },
  });
  const canonicalA = makeEvent({
    id: 'canonical-a',
    sourceFamily: 'mapofwars',
    killed: 12,
    countedCasualties: 12,
    title: 'Kharkiv convoy strike',
    occurredAt: NOW - 5 * HOUR,
    updatedAt: NOW - 5 * HOUR,
    incident: {
      clusterId: 'inc:canonical-a',
      canonicalEventId: 'canonical-a',
      isCanonical: true,
      correlationScore: 1,
      confidence: 'contested',
      memberCount: 3,
      independentFamilyCount: 3,
      rationale: ['selected as canonical representative: highest deterministic quality score among 3 linked reports'],
    },
    evidence: {
      clusterId: 'inc:canonical-a',
      canonicalEventId: 'canonical-a',
      algorithmVersion: 'incident-correlation-v1',
      confidence: 'contested',
      confidenceReason: 'linked reports materially disagree (fatalities); contradictions are preserved, not resolved',
      sourceFamilies: ['mapofwars', 'ucdp', 'warheatmap'],
      independentFamilyCount: 3,
      memberCount: 3,
      contradictions: [
        {
          kind: 'fatalities',
          summary: 'reported fatalities range from 3 (ucdp) to 12 (warheatmap) — a 4.0x spread across linked reports',
          memberEventIds: ['ucdp:991', 'wh-report-b'],
        },
      ],
      members: [
        {
          event: { ...memberB, incident: { clusterId: 'inc:canonical-a', canonicalEventId: 'canonical-a', isCanonical: false, correlationScore: 0.82, confidence: 'contested', memberCount: 3, independentFamilyCount: 3, rationale: ['spatial: 1.2 km apart, inside the 10 km full-evidence radius', 'temporal: time windows overlap'] } },
          sourceFamily: 'warheatmap',
          correlationScore: 0.82,
          rationale: ['spatial: 1.2 km apart, inside the 10 km full-evidence radius', 'temporal: time windows overlap'],
        },
        {
          event: { ...memberC, incident: { clusterId: 'inc:canonical-a', canonicalEventId: 'canonical-a', isCanonical: false, correlationScore: 0.71, confidence: 'contested', memberCount: 3, independentFamilyCount: 3, rationale: ['spatial: 2.8 km apart, inside the 10 km full-evidence radius', 'fatalities: 3 vs 12 killed (ratio 4.0)'] } },
          sourceFamily: 'ucdp',
          correlationScore: 0.71,
          rationale: ['spatial: 2.8 km apart, inside the 10 km full-evidence radius', 'fatalities: 3 vs 12 killed (ratio 4.0)'],
        },
      ],
    },
  });
  const singletonD = makeEvent({
    id: 'singleton-d',
    title: 'Border post shelling',
    occurredAt: NOW - 30 * HOUR,
    updatedAt: NOW - 30 * HOUR,
    killed: 0,
  });
  return [canonicalA, singletonD];
}

function makeConvergenceAnalysis(anchorId) {
  return {
    algorithmVersion: 'domain-convergence-v1',
    cards: [
      {
        eventId: anchorId,
        algorithmVersion: 'domain-convergence-v1',
        classification: 'corroboration',
        classificationReason: 'spatial-temporal alignments qualified in 2 independent non-media measurement families',
        convergenceIndex: 71,
        independentFamilyCount: 2,
        qualifyingDomainCount: 2,
        domains: [
          {
            domain: 'ais-vessel',
            family: 'maritime-ais',
            independent: true,
            bestScore: 0.66,
            qualifies: true,
            findingCount: 1,
            qualifyingFindingCount: 1,
            findings: [
              {
                observationId: 'vessel-1',
                domain: 'ais-vessel',
                family: 'maritime-ais',
                label: 'FIXTURE MERCHANT',
                detail: 'cargo vessel',
                url: null,
                distanceKm: 18.2,
                effectiveDistanceKm: 18.2,
                timeGapHours: 1.5,
                score: 0.66,
                qualifies: true,
                countsAsEvidence: true,
                factors: [{ key: 'spatial', score: 0.8, weight: 0.4, rationale: 'inside 25km' }],
                rationale: ['vessel inside spatial gate'],
                provenance: { source: 'Fintraffic Digitraffic AIS', url: 'https://meri.digitraffic.fi', observedAt: new Date(NOW - 6 * HOUR).toISOString(), note: null },
              },
            ],
            coverageNote: 'regional AIS coverage only',
          },
        ],
        independentFamilies: ['maritime-ais', 'network-measurement'],
        evidenceGaps: [{ domain: 'space-launch', reason: 'no launch observations loaded' }],
        uncertaintyNotes: ['fixture uncertainty note'],
        disclaimer: 'Convergence is co-occurrence, not causation. These classifications describe evidence geometry only — never causality, intent, operational relationships, or attribution. Absence of convergence is not evidence of absence.',
      },
    ],
    gaps: [{ domain: 'media-attention', reason: 'GDELT feed empty in fixture' }],
    globalNotes: ['fixture global note'],
    stats: { algorithmVersion: 'domain-convergence-v1', cardCount: 1 },
  };
}

function makeSnapshot() {
  return {
    fetchedAt: '2026-11-26T05:38:06.897Z',
    sources: {
      mapOfWars: 'Map of Wars public event lattice (build-time cache)',
      gdeltGeoNews: 'GDELT GKG 2.1 fifteen-minute feeds — geolocated conflict-news media mentions, not verified incidents',
    },
    militaryAircraft: [],
    aircraft: [],
    vessels: [],
    satellites: [],
    news: [],
    launches: [],
    naturalEvents: [],
    gpsInterference: [],
    mapOfWarsEvents: [],
    webcams: [],
    cyberVulnerabilities: [],
    cyberVulnerabilityMeta: null,
    internetOutages: [],
    internetOutageMeta: null,
    ucdpMeta: {
      status: 'ok', provider: 'UCDP', resource: 'gedevents', version: '25.1', datasetRelease: 'candidate',
      caveat: 'fixture ucdp caveat', preservedAt: '2026-11-20T00:00:00.000Z', requestUrls: ['https://ucdpapi.pcr.uu.se/api/gedevents'],
    },
    gdeltGeoMeta: {
      status: 'ok', provider: 'GDELT', attribution: 'GDELT terms of use require citation: The GDELT Project (https://www.gdeltproject.org/)',
      caveat: 'fixture gdelt caveat', requestUrls: [],
    },
    gdeltGeoNews: [],
    errors: ['Fixture degraded source: test outage'],
  };
}

function makeOperatorState(queryText = '') {
  const state = operatorUrlState.createDefaultOperatorUrlState();
  state.filters.query = queryText;
  state.filters.theater = 'russia-ukraine-war';
  return state;
}

function makeInput(overrides = {}) {
  const events = overrides.events ?? makeClusteredCorpus();
  const surgeEvents = events;
  const surgeAnalysis = analyzeEscalationSurge(surgeEvents, { now: NOW });
  const rule = normalizeWatchRule({
    id: 'rule-fixture',
    version: 1,
    name: 'Fixture kinetic watch',
    enabled: true,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    condition: { kind: 'incident-count', threshold: 1, window: '72h', surgeLevel: 'watch-indicator' },
    filters: { theater: 'russia-ukraine-war', region: null, country: null, category: null, categoryGroups: [], severities: [] },
  });
  const watchEvaluation = evaluateWatchRules(surgeEvents, [rule], surgeAnalysis, { now: NOW });
  const operatorState = makeOperatorState(overrides.query ?? '');
  return {
    generatedAt: NOW,
    permalink: buildShareablePermalink(operatorState, 'https://intel.example.test/crisis-averted/'),
    operatorState,
    filters: {
      timeWindow: '30d',
      categoryGroups: ['kinetic', 'security', 'strategic'],
      severities: ['critical', 'high', 'medium', 'low'],
      theater: 'russia-ukraine-war',
      query: overrides.query ?? '',
    },
    playback: overrides.playback === undefined ? {
      active: true,
      playing: false,
      mode: 'trailing',
      frameIndex: 4,
      frameStart: NOW - 4 * HOUR,
      frameEndExclusive: NOW - 3 * HOUR,
      speedMultiplier: 2,
      resolutionPreference: 'hour',
      trailHours: 72,
      frameEventCount: 1,
    } : overrides.playback,
    events,
    corpusIncidentCount: overrides.corpusIncidentCount ?? 9,
    feed: {
      source: 'live',
      lastUpdated: NOW - 60000,
      error: null,
      correlation: {
        algorithmVersion: 'incident-correlation-v1',
        inputRecordCount: 4,
        exactDuplicateRecordCount: 0,
        correlationEligibleRecordCount: 4,
        ineligibleRecordCount: 0,
        incidentCount: 2,
        multiMemberClusterCount: 1,
        correlatedEvidenceRecordCount: 2,
        contestedClusterCount: 1,
        corroboratedClusterCount: 0,
        inferredClusterCount: 0,
        singleSourceClusterCount: 1,
        candidatePairCount: 3,
        evaluatedPairCount: 3,
        elapsedMs: 1.5,
      },
    },
    snapshot: makeSnapshot(),
    convergence: overrides.convergence === undefined ? makeConvergenceAnalysis('canonical-a') : overrides.convergence,
    convergenceDisclaimer: 'Convergence is co-occurrence, not causation. These classifications describe evidence geometry only — never causality, intent, operational relationships, or attribution. Absence of convergence is not evidence of absence.',
    surge: surgeAnalysis,
    watchEvaluation,
    watchRules: [rule],
    ...overrides.inputOverrides,
  };
}

console.log('\nscenario 1: schema shape, version metadata, caveats, and UTC timestamps');
{
  const artifacts = buildAnalystExportArtifacts(makeInput());
  const bundle = artifacts.bundle;
  check('schema version is the versioned export identifier', bundle.schemaVersion === ANALYST_EXPORT_SCHEMA_VERSION && bundle.schemaVersion === 'godseye-analyst-export/v1', bundle.schemaVersion);
  check('generatedAtUtc is strict ISO UTC', bundle.generatedAtUtc === '2026-11-26T12:00:00.000Z', bundle.generatedAtUtc);
  const requiredTopLevel = ['schemaVersion', 'generatedAtUtc', 'generator', 'caveats', 'permalink', 'scope', 'provenance', 'incidents', 'convergenceCards', 'convergenceContext', 'surge', 'watch', 'exclusions', 'truncation', 'exportContents'];
  check('all required top-level schema keys are present', requiredTopLevel.every((key) => key in bundle), requiredTopLevel.filter((key) => !(key in bundle)).join(','));
  check('unverified-OSINT caveat is present verbatim in bundle', bundle.caveats.unverifiedOsint.includes('UNVERIFIED OSINT'));
  check('no-operational-authority caveat is present verbatim in bundle', bundle.caveats.noOperationalAuthority.includes('NO OPERATIONAL AUTHORITY'));
  check('statistical-not-predictive caveat carried from surge engine', typeof bundle.caveats.statisticalNotPredictive === 'string' && bundle.caveats.statisticalNotPredictive.includes('not a prediction'));
  check('convergence-not-causal caveat is carried', typeof bundle.caveats.convergenceNotCausal === 'string' && bundle.caveats.convergenceNotCausal.includes('co-occurrence, not causation'));
  check('watch review-aid caveat is carried', typeof bundle.caveats.watchReviewAidOnly === 'string' && bundle.caveats.watchReviewAidOnly.includes('not verified operational warnings'));
  check('attribution/licensing caveat names CC BY 4.0 and GDELT citation', bundle.caveats.attributionLicensing.includes('CC BY 4.0') && bundle.caveats.attributionLicensing.includes('gdeltproject.org'));
  check('algorithm version metadata spans correlation/convergence/surge/watch/url-state', Boolean(bundle.generator.algorithmVersions.incidentCorrelation) && Boolean(bundle.generator.algorithmVersions.domainConvergence) && Boolean(bundle.generator.algorithmVersions.escalationSurge) && Boolean(bundle.generator.algorithmVersions.watchRules) && bundle.generator.algorithmVersions.operatorUrlState === 1, JSON.stringify(bundle.generator.algorithmVersions));
  check('JSON round-trips as a parseable artifact', (() => { try { JSON.parse(artifacts.json); return true; } catch { return false; } })());
  check('markdown states unverified OSINT and no operational authority', artifacts.markdown.includes('UNVERIFIED OSINT') && artifacts.markdown.includes('NO OPERATIONAL AUTHORITY'));
  check('csv preamble states unverified OSINT and no operational authority before the header', artifacts.csv.indexOf('UNVERIFIED OSINT') < artifacts.csv.indexOf('"id","occurred_utc"') && artifacts.csv.includes('NO OPERATIONAL AUTHORITY'));
  check('filename stamps are UTC-marked and deterministic', artifacts.filenames.bundleJson === 'godseye-analyst-bundle-2026-11-26-12-00-00Z.json' && artifacts.filenames.briefMarkdown.endsWith('Z.md') && artifacts.filenames.incidentsCsv.endsWith('Z.csv'), artifacts.filenames.bundleJson);
  check('utcFilenameStamp emits Z-suffixed UTC stamps', utcFilenameStamp(NOW) === '2026-11-26-12-00-00Z', utcFilenameStamp(NOW));
  check('utcIso emits strict UTC ISO or null', utcIso(NOW) === '2026-11-26T12:00:00.000Z' && utcIso(-5) === null && utcIso(NaN) === null);
  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  check('occurrence windows carry ISO UTC derivatives', isoPattern.test(bundle.incidents[0].occurrence.startUtc) && isoPattern.test(bundle.incidents[0].occurrence.endExclusiveUtc), JSON.stringify(bundle.incidents[0].occurrence));
}

console.log('\nscenario 2: evidence-cluster memberships, rationales, contradictions, and citations survive intact');
{
  const { bundle, markdown, json } = buildAnalystExportArtifacts(makeInput());
  const canonical = bundle.incidents.find((incident) => incident.id === 'canonical-a');
  check('clustered canonical incident is exported', Boolean(canonical));
  check('evidence cluster carries both member reports with families', canonical?.evidence?.members.length === 2 && canonical.evidence.members.map((m) => m.sourceFamily).sort().join(',') === 'ucdp,warheatmap');
  check('member pairwise correlation scores are preserved', canonical?.evidence?.members.some((m) => m.correlationScore === 0.82) && canonical?.evidence?.members.some((m) => m.correlationScore === 0.71));
  check('member rationale lines are preserved verbatim and ordered', canonical?.evidence?.members[0].rationale[0].includes('spatial:') && canonical?.evidence?.members[0].rationale.length === 2, JSON.stringify(canonical?.evidence?.members[0].rationale));
  check('contradiction record is preserved with kind, summary, member ids', canonical?.evidence?.contradictions.length === 1 && canonical.evidence.contradictions[0].kind === 'fatalities' && canonical.evidence.contradictions[0].memberEventIds.includes('ucdp:991'));
  check('confidence reason is preserved', canonical?.evidence?.confidenceReason.includes('contradictions are preserved'));
  check('every incident citation URL survives in JSON', bundle.incidents.every((incident) => incident.sources.every((source) => json.includes(source.url))));
  check('every embedded member citation URL survives in JSON', (canonical?.evidence?.members ?? []).every((member) => member.event.sources.every((source) => json.includes(source.url))));
  check('canonical incident citations render in markdown brief', markdown.includes('https://example.test/canonical-a') && markdown.includes('https://mirror.example.test/canonical-a'));
  check('member citations render in markdown evidence section', markdown.includes('https://example.test/wh-report-b') && markdown.includes('https://example.test/ucdp:991'));
  check('ucdp metadata is preserved in projection', canonical?.evidence?.members.find((m) => m.event.id === 'ucdp:991')?.event.ucdp?.side_a === 'Government of Russia');
  check('convergence card for in-scope anchor is included with provenance url', bundle.convergenceCards.length === 1 && json.includes('https://meri.digitraffic.fi'), `${bundle.convergenceCards.length}`);
  check('convergence findings render in markdown with source', markdown.includes('Fintraffic Digitraffic AIS'));
  check('surge signals carry evidence reference URLs into the bundle', json.includes('https://example.test/canonical-a') && bundle.surge.included);
  check('watch alerts are included with evidence references and rule definitions', bundle.watch.included && bundle.watch.alerts.length >= 1 && bundle.watch.triggeredRuleDefinitions.length === 1, `alerts=${bundle.watch.alerts.length} rules=${bundle.watch.triggeredRuleDefinitions.length}`);
  check('watch evidence reference URLs survive in markdown', markdown.includes('https://example.test/'));
  check('snapshot retrieval timestamps are recorded', bundle.provenance.retrievalTimestampsUtc.snapshotFetched === '2026-11-26T05:38:06.897Z' && bundle.provenance.retrievalTimestampsUtc.ucdpPreserved === '2026-11-20T00:00:00.000Z', JSON.stringify(bundle.provenance.retrievalTimestampsUtc));
  check('ingestion provenance meta for ucdp/gdelt travels with the export', bundle.provenance.snapshot.ucdpMeta?.caveat === 'fixture ucdp caveat' && bundle.provenance.snapshot.gdeltGeoMeta?.attribution.includes('gdeltproject.org'));
  check('degraded source errors are disclosed', bundle.provenance.snapshot.errors.some((line) => line.includes('Fixture degraded source')));
}

console.log('\nscenario 3: circular-reference safety is constructive under adversarial input');
{
  // Adversarial 1: member event is the canonical object itself (direct self-cycle).
  const selfCyclic = makeEvent({ id: 'self-cyclic' });
  selfCyclic.evidence = {
    clusterId: 'inc:self-cyclic',
    canonicalEventId: 'self-cyclic',
    algorithmVersion: 'incident-correlation-v1',
    confidence: 'inferred',
    confidenceReason: 'adversarial fixture',
    sourceFamilies: ['warheatmap'],
    independentFamilyCount: 1,
    memberCount: 2,
    contradictions: [],
    members: [{ event: selfCyclic, sourceFamily: 'warheatmap', correlationScore: 0.9, rationale: ['cycle test'] }],
  };
  let artifacts = null;
  let threw = false;
  try {
    artifacts = buildAnalystExportArtifacts(makeInput({ events: [selfCyclic] }));
  } catch (error) {
    threw = error;
  }
  check('self-referential evidence cluster exports without throwing or hanging', !threw, threw ? String(threw).slice(0, 120) : '');
  check('self-referential export JSON parses cleanly', artifacts ? (() => { try { JSON.parse(artifacts.json); return true; } catch { return false; } })() : false);
  const projected = artifacts?.bundle.incidents.find((incident) => incident.id === 'self-cyclic');
  check('member embedding is exactly one level deep — member evidence is structurally null', projected?.evidence?.members?.[0] && projected.evidence.members[0].event.evidence === null, JSON.stringify(projected?.evidence?.members?.[0]?.event?.evidence));
  check('member self-projection still carries core evidence fields', projected?.evidence?.members?.[0]?.event?.id === 'self-cyclic' && projected?.evidence?.members?.[0]?.rationale?.[0] === 'cycle test');

  // Adversarial 2: deep mutual cycle across two fabricated member rows plus cyclic ucdp/detail objects.
  const mutualA = makeEvent({ id: 'mutual-a' });
  const mutualB = makeEvent({ id: 'mutual-b' });
  mutualA.evidence = {
    clusterId: 'inc:mutual-a', canonicalEventId: 'mutual-a', algorithmVersion: 'x', confidence: 'inferred', confidenceReason: 'x',
    sourceFamilies: ['warheatmap'], independentFamilyCount: 1, memberCount: 2, contradictions: [],
    members: [{ event: mutualB, sourceFamily: 'warheatmap', correlationScore: 0.5, rationale: [] }],
  };
  mutualB.evidence = {
    clusterId: 'inc:mutual-b', canonicalEventId: 'mutual-b', algorithmVersion: 'x', confidence: 'inferred', confidenceReason: 'x',
    sourceFamilies: ['warheatmap'], independentFamilyCount: 1, memberCount: 2, contradictions: [],
    members: [{ event: mutualA, sourceFamily: 'warheatmap', correlationScore: 0.5, rationale: [] }],
  };
  mutualA.ucdp = { circular: null };
  mutualA.ucdp.circular = mutualA.ucdp;
  let artifacts2 = null;
  let threw2 = false;
  try {
    artifacts2 = buildAnalystExportArtifacts(makeInput({ events: [mutualA, mutualB] }));
  } catch (error) {
    threw2 = error;
  }
  check('mutually-circular member rows export without throwing', !threw2, threw2 ? String(threw2).slice(0, 120) : '');
  check('mutually-circular export JSON parses cleanly', artifacts2 ? (() => { try { JSON.parse(artifacts2.json); return true; } catch { return false; } })() : false);
  const projectedMutualB = artifacts2?.bundle.incidents.find((incident) => incident.id === 'mutual-b');
  check('adversarial nested evidence inside member rows is stripped', projectedMutualB?.evidence?.members?.[0] && projectedMutualB.evidence.members[0].event.evidence === null);
  const projectedMutualA = artifacts2?.bundle.incidents.find((incident) => incident.id === 'mutual-a');
  check('circular non-schema ucdp sub-objects are scalar-projected away', projectedMutualA && JSON.stringify(projectedMutualA.ucdp) !== null && !JSON.stringify(projectedMutualA.ucdp).includes('circular'));

  // Adversarial 3: engine-output section with a true JSON cycle is excluded with disclosure, not a crash.
  const cyclicCard = { eventId: 'canonical-a' };
  cyclicCard.self = cyclicCard;
  const cyclicConvergence = { algorithmVersion: 'domain-convergence-v1', cards: [cyclicCard], gaps: [], globalNotes: [], stats: {} };
  const artifacts3 = buildAnalystExportArtifacts(makeInput({ convergence: cyclicConvergence }));
  check('cyclic convergence section is excluded rather than crashing the export', artifacts3.bundle.convergenceContext.included === false && artifacts3.bundle.convergenceCards.length === 0);
  check('convergence exclusion is disclosed honestly', artifacts3.bundle.convergenceContext.note.includes('excluded') && artifacts3.bundle.exclusions.some((line) => line.includes('serialization safety guard')));
  check('export still parses when a section is cyclically hostile', (() => { try { JSON.parse(artifacts3.json); return true; } catch { return false; } })());
}

console.log('\nscenario 4: deterministic ordering is byte-stable under input reordering');
{
  // Determinism is validated given identical engine output: one shared input object, with
  // only the incident array order permuted. (Engine runtime statistics such as elapsedMs are
  // truthful per-pass measurements inside the input, not something the export may rewrite.)
  const events = makeClusteredCorpus();
  const sharedInput = makeInput({ events });
  const forward = buildAnalystExportArtifacts(sharedInput);
  const reversed = buildAnalystExportArtifacts({ ...sharedInput, events: [...events].reverse() });
  check('JSON artifact is byte-identical under input reordering', forward.json === reversed.json);
  check('markdown artifact is byte-identical under input reordering', forward.markdown === reversed.markdown);
  check('csv artifact is byte-identical under input reordering', forward.csv === reversed.csv);
  const repeated = Array.from({ length: 20 }, () => buildAnalystExportArtifacts(sharedInput).json);
  check('twenty repeated builds are byte-identical', repeated.every((value) => value === forward.json));
  const occurrences = forward.bundle.incidents.map((incident) => incident.occurredAtMs);
  check('incidents sort occurred-desc with id tiebreak', occurrences.every((value, index) => index === 0 || occurrences[index - 1] >= value), JSON.stringify(occurrences));
  const memberScores = forward.bundle.incidents.find((i) => i.id === 'canonical-a')?.evidence?.members.map((m) => m.correlationScore) ?? [];
  check('evidence members sort by score descending', memberScores.every((value, index) => index === 0 || memberScores[index - 1] >= value), JSON.stringify(memberScores));
}

console.log('\nscenario 5: secret-shaped search text is withheld with disclosure, never exported');
{
  const secretQuery = 'token=abc123456789';
  const artifacts = buildAnalystExportArtifacts(makeInput({ query: secretQuery }));
  check('secret-shaped query is absent from filter scope', artifacts.bundle.scope.filters.query === null && artifacts.bundle.scope.filters.queryWithheld === true);
  check('query redaction is disclosed with reasoning', typeof artifacts.bundle.scope.filters.queryNote === 'string' && artifacts.bundle.scope.filters.queryNote.includes('secret-shaped'));
  check('secret-shaped query text appears nowhere in any artifact', !artifacts.json.includes(secretQuery) && !artifacts.markdown.includes(secretQuery) && !artifacts.csv.includes(secretQuery));
  check('permalink fragment also withholds the secret-shaped query', artifacts.bundle.permalink.url && !artifacts.bundle.permalink.url.includes('abc123456789'), artifacts.bundle.permalink.url ?? 'null');
  const benign = buildAnalystExportArtifacts(makeInput({ query: 'Kyiv drones' }));
  check('benign search text is preserved in scope', benign.bundle.scope.filters.query === 'Kyiv drones' && benign.bundle.scope.filters.queryWithheld === false);
  const controlChars = buildAnalystExportArtifacts(makeInput({ query: 'kyiv\n<script>' }));
  check('control-character query is withheld with non-secret reasoning', controlChars.bundle.scope.filters.query === null && controlChars.bundle.scope.filters.queryNote.includes('control characters'));
}

console.log('\nscenario 6: filter/playback/operator scope and permalink are recorded faithfully');
{
  const artifacts = buildAnalystExportArtifacts(makeInput());
  const scope = artifacts.bundle.scope;
  check('filter scope records time window, groups, severities, theater', scope.filters.timeWindow === '30d' && scope.filters.categoryGroups.includes('kinetic') && scope.filters.severities.length === 4 && scope.filters.theater === 'russia-ukraine-war');
  check('playback lens state is recorded with UTC frame conversion', scope.playback?.active === true && scope.playback.frameStartUtc === utcIso(NOW - 4 * HOUR) && scope.playback.frameEndExclusiveUtc === utcIso(NOW - 3 * HOUR), JSON.stringify(scope.playback));
  check('playback scope note states export is not narrowed by the lens', scope.playback?.scopeNote.includes('NOT just the visible playback frame'));
  check('operator scope records layers/panels/visual mode', scope.operator.visualMode === 'cinematic' && scope.operator.enabledLayers.length > 0 && typeof scope.operator.panels.inspector === 'string');
  check('incident counts are honest', scope.incidentCounts.exportedIncidents === 2 && scope.incidentCounts.inScopeIncidents === 2 && scope.incidentCounts.corpusIncidents === 9 && scope.incidentCounts.exportedEvidenceMembers === 2, JSON.stringify(scope.incidentCounts));
  check('permalink is a well-formed fragment URL restoring the workspace', artifacts.bundle.permalink.url?.startsWith('https://intel.example.test/crisis-averted/#s1.'), artifacts.bundle.permalink.url ?? 'null');
  const encodedFragment = artifacts.bundle.permalink.url?.split('#')[1] ?? '';
  const parsed = operatorUrlState.parseOperatorUrlState(`#${encodedFragment}`, '');
  check('permalink round-trips to the exported operator scope', parsed.valid && parsed.state.filters.theater === 'russia-ukraine-war', JSON.stringify(parsed.issues));
  check('permalink note discloses what it restores', artifacts.bundle.permalink.note.includes('restores public view'));
  check('null baseUrl yields no fabricated permalink', buildShareablePermalink(operatorUrlState.createDefaultOperatorUrlState(), '') === null);

  const inactive = buildAnalystExportArtifacts(makeInput({ playback: null }));
  check('absent playback is explicit null rather than fabricated', inactive.bundle.scope.playback === null);
}

console.log('\nscenario 7: size behavior — safety caps engage with honest truncation accounting');
{
  // Synthetic corpus larger than the incident cap with fat clusters.
  const bigEvents = [];
  for (let index = 0; index < MAX_EXPORT_INCIDENTS + 40; index += 1) {
    bigEvents.push(makeEvent({
      id: `bulk-${String(index).padStart(5, '0')}`,
      occurredAt: NOW - index * HOUR,
      updatedAt: NOW - index * HOUR,
      title: `Bulk incident ${index}`,
    }));
  }
  const big = buildAnalystExportArtifacts(makeInput({ events: bigEvents }));
  check('incident cap is enforced exactly', big.bundle.incidents.length === MAX_EXPORT_INCIDENTS, String(big.bundle.incidents.length));
  check('truncation count matches dropped incidents honestly', big.bundle.truncation.incidentsDropped === 40 && big.bundle.truncation.truncated === true, JSON.stringify(big.bundle.truncation));
  check('truncation notes disclose the cap and remediation', big.bundle.truncation.notes.some((line) => line.includes('safety cap') && line.includes('narrow the filter scope')));
  check('markdown discloses summarized row count', big.markdown.includes(`Showing ${MAX_MARKDOWN_INCIDENT_ROWS} of ${MAX_EXPORT_INCIDENTS}`), '');
  check('markdown incident rows are capped', (big.markdown.match(/### \d+\./g) ?? []).length <= MAX_MARKDOWN_INCIDENT_ROWS + 40, String((big.markdown.match(/### \d+\./g) ?? []).length));
  check('json byte size remains linear and bounded for capped input', big.jsonBytes < 30 * 1024 * 1024, `${(big.jsonBytes / 1048576).toFixed(1)}MB`);
  check('csv row count matches exported incidents plus preamble/header', big.csv.split('\n').length === MAX_EXPORT_INCIDENTS + 5, String(big.csv.split('\n').length));

  // Cluster with more members than the per-cluster cap.
  const fatMembers = [];
  for (let index = 0; index < 410; index += 1) {
    const member = makeEvent({ id: `fat-member-${index}`, occurredAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR });
    fatMembers.push({ event: member, sourceFamily: 'warheatmap', correlationScore: 0.5, rationale: ['fat cluster fixture'] });
  }
  const fatCanonical = makeEvent({ id: 'fat-canonical', occurredAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR });
  fatCanonical.evidence = {
    clusterId: 'inc:fat-canonical', canonicalEventId: 'fat-canonical', algorithmVersion: 'x', confidence: 'inferred', confidenceReason: 'fat fixture',
    sourceFamilies: ['warheatmap'], independentFamilyCount: 1, memberCount: 411, contradictions: [], members: fatMembers,
  };
  const fat = buildAnalystExportArtifacts(makeInput({ events: [fatCanonical] }));
  const fatEvidence = fat.bundle.incidents[0]?.evidence;
  check('per-cluster member cap engages', fatEvidence?.members.length === 400, String(fatEvidence?.members.length));
  check('dropped members are counted and disclosed', fatEvidence?.truncatedMemberCount === 10 && fat.bundle.truncation.evidenceMembersDropped === 10 && fat.bundle.truncation.notes.some((line) => line.includes('evidence member')));
  check('membership counts remain complete despite member truncation', fatEvidence?.memberCount === 411);

  // Untruncated small export explicitly states no truncation.
  const small = buildAnalystExportArtifacts(makeInput());
  check('untruncated export states that no truncation occurred', small.bundle.truncation.truncated === false && small.bundle.truncation.notes.some((line) => line.includes('no truncation occurred')));
}

console.log('\nscenario 8: empty/missing inputs degrade to explicit absence, never fabrication');
{
  const emptyInput = makeInput({
    events: [],
    convergence: null,
    inputOverrides: {
      surge: null,
      watchEvaluation: null,
      playback: null,
      permalink: null,
    },
  });
  const artifacts = buildAnalystExportArtifacts(emptyInput);
  check('empty incident scope exports as an empty array, not an error', Array.isArray(artifacts.bundle.incidents) && artifacts.bundle.incidents.length === 0);
  check('missing convergence analysis is explicit with not-a-negative-finding language', artifacts.bundle.convergenceContext.included === false && artifacts.bundle.convergenceContext.note.includes('absence is explicit'));
  check('missing surge analysis is explicit', artifacts.bundle.surge.included === false && artifacts.bundle.surge.note.includes('absence is explicit'));
  check('missing watch evaluation is explicit', artifacts.bundle.watch.included === false && artifacts.bundle.watch.note.includes('absence is explicit'));
  check('missing permalink is null with an honest note, not a fabricated link', artifacts.bundle.permalink.url === null && artifacts.bundle.permalink.note.includes('no permalink is included'));
  check('markdown still renders as a valid caveat-led document', artifacts.markdown.includes('UNVERIFIED OSINT') && artifacts.markdown.includes('End of brief'));
  check('exclusions inventory is present and itemized', artifacts.bundle.exclusions.length >= 5);
  check('export contents inventory explains exactly what is inside', artifacts.bundle.exportContents.length >= 5 && artifacts.bundle.exportContents.some((line) => line.includes('evidence-cluster')));
}

console.log('\nscenario 9: projection fidelity — no fabricated fields, no dropped schema fields');
{
  const event = makeEvent({ id: 'fidelity-check', detail: 'fixture detail text', precision: 2 });
  delete event.evidence;
  const projected = projectIncidentForExport(event, true);
  const internalKeys = ['id', 'lat', 'lng', 'severity', 'category', 'categoryGroup', 'date', 'killed', 'countedCasualties', 'displaced', 'country', 'conflict', 'theater', 'region', 'title', 'verified', 'intensity'];
  check('all scalar schema fields are projected', internalKeys.every((key) => projected[key] !== undefined), internalKeys.filter((key) => projected[key] === undefined).join(','));
  check('detail text survives projection', projected.detail === 'fixture detail text');
  check('null detail is null, not fabricated', projectIncidentForExport(makeEvent({ id: 'null-detail', detail: null }), true).detail === null);
  check('missing optional occurrence projects to null not a fabricated window', projectIncidentForExport({ ...makeEvent({ id: 'no-occ' }), occurrence: undefined }, true).occurrence === null);
  check('missing ucdp projects to null not a fabricated record', projected.ucdp === null);
  check('projection never carries evidence when embedEvidence is false', !('evidence' in projectIncidentForExport(event, false)) || projectIncidentForExport(event, false).evidence === null);
  check('epoch-ms and UTC-iso timestamps are consistent reformatting', projected.occurredAtUtc === new Date(projected.occurredAtMs).toISOString());
}

console.log('\nreal-data smoke: committed fallback incident cache');
{
  const fallbackPath = path.join(frontendDir, 'public', 'data', 'conflict-fallback.json');
  const payload = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  const normalized = (payload.events ?? []).map(conflictData.normalizeWarHeatmapEvent).filter(Boolean);
  const realNow = Date.now();
  const correlated = incidentCorrelation.correlateConflictEvents(normalized, { now: realNow }).incidents;
  const surgeAnalysis = analyzeEscalationSurge(correlated, { now: realNow });
  const evaluation = evaluateWatchRules(correlated, [], surgeAnalysis, { now: realNow });
  const input = makeInput({
    events: correlated,
    corpusIncidentCount: correlated.length,
    inputOverrides: { surge: surgeAnalysis, watchEvaluation: evaluation, watchRules: [] },
  });
  const started = Date.now();
  const artifacts = buildAnalystExportArtifacts(input);
  const elapsed = Date.now() - started;
  check('real corpus exports without truncation beyond the safety cap', artifacts.bundle.incidents.length === Math.min(correlated.length, MAX_EXPORT_INCIDENTS), `${artifacts.bundle.incidents.length}/${correlated.length}`);
  check('real export JSON round-trips', (() => { try { JSON.parse(artifacts.json); return true; } catch { return false; } })());
  check('real export preserves member embedding depth of exactly one', artifacts.bundle.incidents.every((incident) => (incident.evidence?.members ?? []).every((member) => member.event.evidence === null)));
  check('real export deterministic under input reversal', (() => {
    const reversedInput = makeInput({ events: [...correlated].reverse(), corpusIncidentCount: correlated.length, inputOverrides: { surge: surgeAnalysis, watchEvaluation: evaluation, watchRules: [] } });
    return buildAnalystExportArtifacts(reversedInput).json === artifacts.json;
  })());
  check('real export completes in reasonable time', elapsed < 20000, `${elapsed}ms`);
  const clustered = artifacts.bundle.incidents.filter((incident) => incident.evidence && incident.evidence.members.length > 0);
  const citationsPreserved = clustered.every((incident) => incident.evidence.members.every((member) => member.event.sources.every((source) => artifacts.json.includes(source.url))));
  check('every member citation URL in the real corpus survives serialization', citationsPreserved);
  console.log(`  info real-data: incidents=${artifacts.bundle.incidents.length}, clustered=${clustered.length}, json=${(artifacts.jsonBytes / 1048576).toFixed(2)}MB, markdown=${(artifacts.markdownBytes / 1024).toFixed(0)}KB, csv=${(artifacts.csvBytes / 1024).toFixed(0)}KB, truncated=${artifacts.bundle.truncation.truncated}, elapsed=${elapsed}ms`);
}

console.log(`\nanalyst export validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nfailures:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
