#!/usr/bin/env node
/**
 * Focused domain-chunk publication harness.
 *
 * This deliberately does not fetch the network. It validates the committed static
 * artifacts byte-for-byte: schema/count/hash integrity, exact monolith reassembly,
 * deterministic priority order, critical-first byte reduction, and browser/native
 * compatibility publication invariants.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { validateChunkedPublicationDirectory } from './lib/osint-chunked-publication.mjs';
import { OSINT_CHUNK_LAYOUT } from './lib/osint-chunk-layout.mjs';

const root = process.cwd();
const dataDir = join(root, 'frontend/public/data');
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
function assertUsable() {
  if (!existsSync(join(dataDir, 'osint/manifest.json'))) throw new Error('frontend/public/data/osint/manifest.json missing; run scripts/build-osint-snapshot.mjs');
}

try {
  assertUsable();
  const publication = validateChunkedPublicationDirectory(dataDir);
  const { manifest } = publication;

  check('publication has no schema/count/hash/reassembly errors', publication.errors.length === 0, publication.errors.join('; '));
  check('domain chunks reassemble byte-exactly to compatibility monolith', publication.reassemblyEqual);
  check('legacy compatibility monolith is still published', existsSync(join(dataDir, 'osint-snapshot.json')));

  if (manifest) {
    const layoutIds = OSINT_CHUNK_LAYOUT.map((entry) => entry.id);
    const manifestIds = manifest.chunks.map((chunk) => chunk.id);
    check('manifest contains every canonical domain exactly once in layout order', JSON.stringify(manifestIds) === JSON.stringify(layoutIds), `${manifestIds.join(',')} != ${layoutIds.join(',')}`);

    const priorities = manifest.chunks.map((chunk) => chunk.priority);
    const sortedPriorities = [...priorities].sort((a, b) => a - b);
    check('publication priority ordering is deterministic ascending order', JSON.stringify(priorities) === JSON.stringify(sortedPriorities), priorities.join(','));

    const critical = manifest.chunks.filter((chunk) => chunk.critical);
    const background = manifest.chunks.filter((chunk) => !chunk.critical);
    check('critical wave contains conflict/connectivity/environmental', ['conflict', 'connectivity', 'environmental'].every((id) => critical.some((chunk) => chunk.id === id)));
    check('heavy transport/media chunks are not critical', ['transport-aviation', 'media-context', 'maritime'].every((id) => !critical.some((chunk) => chunk.id === id)));
    check('every critical chunk has lower priority than every heavy background chunk', Math.max(...critical.map((chunk) => chunk.priority)) < Math.min(...background.map((chunk) => chunk.priority)));

    const criticalBytes = critical.reduce((sum, chunk) => sum + chunk.bytes, 0);
    const legacyBytes = statSync(join(dataDir, 'osint-snapshot.json')).size;
    const firstUsefulBytes = criticalBytes + statSync(join(dataDir, 'osint/manifest.json')).size;
    const firstUsefulRatio = firstUsefulBytes / legacyBytes;
    check('critical first-useful payload is materially smaller than monolith', firstUsefulRatio < 0.4, `${firstUsefulBytes}/${legacyBytes} bytes (${(firstUsefulRatio * 100).toFixed(1)}%)`);
    check('manifest stays compact relative to the monolith', statSync(join(dataDir, 'osint/manifest.json')).size < legacyBytes * 0.01, `${statSync(join(dataDir, 'osint/manifest.json')).size} bytes`);

    for (const chunk of manifest.chunks) {
      const file = join(dataDir, 'osint', chunk.relativePath);
      check(`chunk ${chunk.id} exists on disk with manifest byte count`, existsSync(file) && statSync(file).size === chunk.bytes);
    }

    const browserConstants = readFileSync(join(root, 'frontend/src/lib/osintSnapshotChunks.ts'), 'utf8');
    check('browser loader declares the same canonical domain order', layoutIds.every((id) => browserConstants.includes(`"${id}"`)));
    const browserHook = readFileSync(join(root, 'frontend/src/hooks/useOsintSnapshot.ts'), 'utf8');
    check('browser loader gates heavy requests behind critical settlement', browserHook.includes('await Promise.allSettled(critical.map') && browserHook.indexOf('await Promise.allSettled(critical.map') < browserHook.indexOf('await Promise.allSettled(background.map'));
    check('browser loader distinguishes pending/error/degraded from empty coverage', ['"pending"', '"error"', '"degraded"'].every((fragment) => browserConstants.includes(fragment)));
    check('browser loader verifies manifest byte counts and SHA-256', browserHook.includes('byte-count drift') && browserHook.includes('SHA-256 drift'));

    // Execute the actual browser chunk-state module through the TypeScript compiler's
    // transpiler. This is a deterministic unit harness for degradation semantics, not a
    // source-text-only smoke test.
    const frontendRequire = createRequire(join(root, 'frontend/package.json'));
    const ts = frontendRequire('typescript');
    const transpiled = ts.transpileModule(browserConstants, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: 'osintSnapshotChunks.ts',
    }).outputText;
    const moduleFixture = { exports: {} };
    new Function('module', 'exports', 'require', transpiled)(moduleFixture, moduleFixture.exports, frontendRequire);
    const browserLib = moduleFixture.exports;
    const browserManifest = browserLib.validateOsintSnapshotManifest(manifest);
    check('browser runtime validator accepts the committed manifest', browserManifest.errors.length === 0, browserManifest.errors.join('; '));
    const conflictReference = manifest.chunks.find((chunk) => chunk.id === 'conflict');
    const conflictValidation = browserLib.validateChunkPayload(publication.chunks.conflict, conflictReference, manifest);
    check('browser runtime validator accepts the real conflict chunk and counts', conflictValidation.errors.length === 0, conflictValidation.errors.join('; '));
    const tamperedConflict = structuredClone(publication.chunks.conflict);
    tamperedConflict.counts.mapOfWarsEvents += 1;
    check('browser runtime validator rejects collection count drift', browserLib.validateChunkPayload(tamperedConflict, conflictReference, manifest).errors.some((message) => message.includes('count drift')));
    const shell = browserLib.createSnapshotShell(manifest);
    const assembled = browserLib.applyChunkToSnapshot(shell, conflictValidation.payload);
    check('partial application keeps unloaded domains empty without mutating conflict rows', assembled.mapOfWarsEvents.length === conflictValidation.payload.counts.mapOfWarsEvents && assembled.vessels.length === 0);

    const terminalStates = {};
    for (const reference of manifest.chunks) terminalStates[reference.id] = browserLib.createRuntimeState(reference, 'loaded');
    terminalStates.maritime = { ...terminalStates.maritime, status: 'error', error: 'simulated fetch failure', stale: true };
    const degradedRuntime = browserLib.deriveRuntime({ manifest, chunkStates: terminalStates, integrity: 'verified' });
    check('failed terminal chunk degrades runtime without blocking other domains', degradedRuntime.phase === 'degraded' && degradedRuntime.usableChunkCount === manifest.chunks.length - 1 && degradedRuntime.evidencePending === false);
    const pendingStates = {};
    for (const reference of manifest.chunks) pendingStates[reference.id] = browserLib.createRuntimeState(reference, 'loaded');
    pendingStates['transport-aviation'] = { ...pendingStates['transport-aviation'], status: 'loading' };
    const pendingRuntime = browserLib.deriveRuntime({ manifest, chunkStates: pendingStates, integrity: 'pending' });
    check('pending evidence chunk is explicit pending state rather than zero coverage', pendingRuntime.phase === 'background-loading' && pendingRuntime.evidencePending === true && pendingRuntime.complete === false);
    const legacyRuntime = browserLib.createLegacyRuntime({ ...browserLib.createEmptyOsintSnapshot(), fetchedAt: manifest.generatedAt }, 'simulated missing manifest', 123);
    check('legacy monolith fallback is explicit degraded compatibility mode', legacyRuntime.phase === 'degraded' && legacyRuntime.stale === true && legacyRuntime.integrity === 'unavailable');
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`osint-chunks: ${checks.length - failed.length}/${checks.length} checks passed`);
  for (const entry of checks) console.log(`  ${entry.ok ? 'ok' : 'FAIL'} ${entry.name}${entry.detail && !entry.ok ? ` — ${entry.detail}` : ''}`);
  if (manifest) {
    const legacyBytes = statSync(join(dataDir, 'osint-snapshot.json')).size;
    const totalChunkBytes = manifest.publication.totalChunkBytes;
    const criticalBytes = manifest.chunks.filter((chunk) => chunk.critical).reduce((sum, chunk) => sum + chunk.bytes, 0) + statSync(join(dataDir, 'osint/manifest.json')).size;
    console.log(`osint-chunks: legacy=${legacyBytes} bytes; total-chunks=${totalChunkBytes} bytes (${((totalChunkBytes / legacyBytes - 1) * 100).toFixed(2)}% envelope overhead); critical-first=${criticalBytes} bytes (${((1 - criticalBytes / legacyBytes) * 100).toFixed(1)}% reduction before heavy domains)`);
  }
  if (failed.length > 0) process.exit(1);
} catch (error) {
  console.error(`osint-chunks harness failed: ${error.message}`);
  process.exit(1);
}
