/**
 * Deterministic domain-chunked OSINT snapshot publication and validation helpers.
 *
 * The compatibility monolith remains a first-class artifact for existing consumers,
 * but the manifest is the publication cursor: every chunk is atomically replaced
 * first and the manifest is atomically replaced last. A client therefore never
 * observes a new manifest pointing at a mixture of old and new chunks.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OSINT_CHUNK_LAYOUT,
  OSINT_CHUNKS_BY_ID,
  OSINT_LEGACY_SCHEMA_VERSION,
  OSINT_LEGACY_SNAPSHOT_PATH,
  OSINT_MANIFEST_PATH,
  OSINT_MANIFEST_ROOT_FIELDS,
  OSINT_MANIFEST_SCHEMA_VERSION,
  OSINT_SNAPSHOT_FIELD_ORDER,
  OSINT_SNAPSHOT_SCHEMA_VERSION,
  chunkPublicPath,
} from './osint-chunk-layout.mjs';
import { isPlainObject, sha256Buffer, sha256Text, stableStringify } from './source-governance.mjs';

function sortObjectByKeys(value) {
  const output = {};
  for (const key of Object.keys(value ?? {}).sort()) output[key] = value[key];
  return output;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sha256JsonBytes(value) {
  const text = JSON.stringify(value);
  return { text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Text(text) };
}

function collectionCount(value) {
  if (Array.isArray(value)) return value.length;
  return value === null || value === undefined ? 0 : 1;
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function compareJson(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Canonicalize only root publication ordering. Record order inside collections is
 * source/ranking semantics and is preserved byte-for-byte; deterministic chunk order,
 * collection order, root-field order, and source-key order make publication stable.
 */
export function canonicalizeSnapshotForPublication(snapshot) {
  const canonical = {};
  for (const key of OSINT_SNAPSHOT_FIELD_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    canonical[key] = key === 'sources' ? sortObjectByKeys(snapshot.sources) : snapshot[key];
  }
  return canonical;
}

function retrievalSubset(ledgerEntry) {
  if (!isPlainObject(ledgerEntry)) return null;
  return {
    retrievalState: ledgerEntry.retrievalState ?? 'unknown',
    retrievedAt: ledgerEntry.retrievedAt ?? null,
    freshness: isPlainObject(ledgerEntry.freshness) ? {
      state: ledgerEntry.freshness.state ?? 'unknown',
      ageSeconds: ledgerEntry.freshness.ageSeconds ?? null,
      basis: ledgerEntry.freshness.basis ?? null,
      warnAfterSeconds: ledgerEntry.freshness.warnAfterSeconds ?? null,
      staleAfterSeconds: ledgerEntry.freshness.staleAfterSeconds ?? null,
    } : null,
    dataVintage: isPlainObject(ledgerEntry.dataVintage) ? {
      newestRecordTimestamp: ledgerEntry.dataVintage.newestRecordTimestamp ?? null,
      timestampedRecordCount: ledgerEntry.dataVintage.timestampedRecordCount ?? 0,
    } : null,
    sourceIds: Array.isArray(ledgerEntry.sourceIds) ? [...ledgerEntry.sourceIds].sort() : [],
  };
}

function aggregateRetrieval(collectionMetadata) {
  const entries = Object.values(collectionMetadata)
    .map((entry) => entry?.retrieval)
    .filter((entry) => isPlainObject(entry));
  const retrievalTimes = entries
    .map((entry) => entry.retrievedAt)
    .filter(validIso)
    .map((value) => Date.parse(value))
    .sort((a, b) => a - b);
  const states = [...new Set(entries.map((entry) => entry.retrievalState).filter((value) => typeof value === 'string'))].sort();
  const freshnessStates = [...new Set(entries.map((entry) => entry.freshness?.state).filter((value) => typeof value === 'string'))].sort();
  return {
    earliestRetrievedAt: retrievalTimes.length > 0 ? new Date(retrievalTimes[0]).toISOString() : null,
    latestRetrievedAt: retrievalTimes.length > 0 ? new Date(retrievalTimes[retrievalTimes.length - 1]).toISOString() : null,
    retrievalStates: states,
    freshnessStates,
    preservedOrStale: freshnessStates.some((state) => state === 'preserved' || state === 'stale'),
  };
}

function chunkCollections(snapshot, chunkSpec) {
  const collections = {};
  const collectionMetadata = {};
  const counts = {};
  const recordCounts = {};
  const sourceIds = new Set();

  for (const collection of chunkSpec.collections) {
    const key = collection.key;
    const value = snapshot[key];
    collections[key] = value;
    const count = collectionCount(value);
    counts[key] = count;
    if (collection.kind === 'records') recordCounts[key] = Array.isArray(value) ? value.length : 0;
    const contentSha256 = sha256Text(stableStringify(value));
    const ledgerEntry = collection.kind === 'records' ? snapshot.provenanceLedger?.collections?.[key] : null;
    const retrieval = retrievalSubset(ledgerEntry);
    for (const sourceId of retrieval?.sourceIds ?? []) sourceIds.add(sourceId);
    collectionMetadata[key] = {
      kind: collection.kind,
      count,
      contentSha256,
      retrieval,
    };
  }

  return { collections, collectionMetadata, counts, recordCounts, sourceIds: [...sourceIds].sort() };
}

export function buildChunkPayload(snapshot, chunkSpec) {
  const assembled = chunkCollections(snapshot, chunkSpec);
  return {
    schemaVersion: chunkSpec.schemaVersion,
    domain: chunkSpec.id,
    title: chunkSpec.title,
    snapshotSchemaVersion: OSINT_SNAPSHOT_SCHEMA_VERSION,
    snapshotFetchedAt: snapshot.fetchedAt,
    priority: chunkSpec.priority,
    critical: chunkSpec.critical,
    dependencies: [...chunkSpec.dependencies],
    externalArtifactDependencies: chunkSpec.externalArtifactDependencies.map((entry) => ({ ...entry })),
    collections: assembled.collections,
    collectionMetadata: assembled.collectionMetadata,
    counts: assembled.counts,
    recordCounts: assembled.recordCounts,
    sourceIds: assembled.sourceIds,
    retrieval: aggregateRetrieval(assembled.collectionMetadata),
  };
}

/**
 * Build all publication artifacts in memory. Nothing in the manifest depends on
 * wall-clock time beyond snapshot.fetchedAt, so identical snapshots produce
 * byte-identical artifacts.
 */
export function buildChunkedPublication(inputSnapshot) {
  const snapshot = canonicalizeSnapshotForPublication(inputSnapshot);
  const chunks = [];
  const chunkPayloads = {};

  for (const chunkSpec of OSINT_CHUNK_LAYOUT) {
    const payload = buildChunkPayload(snapshot, chunkSpec);
    const serialized = sha256JsonBytes(payload);
    chunkPayloads[chunkSpec.id] = payload;
    chunks.push({
      id: chunkSpec.id,
      title: chunkSpec.title,
      schemaVersion: chunkSpec.schemaVersion,
      path: chunkPublicPath(chunkSpec),
      relativePath: chunkSpec.fileName,
      bytes: serialized.bytes,
      sha256: serialized.sha256,
      priority: chunkSpec.priority,
      critical: chunkSpec.critical,
      dependencies: [...chunkSpec.dependencies],
      externalArtifactDependencies: chunkSpec.externalArtifactDependencies.map((entry) => ({ ...entry })),
      collections: chunkSpec.collections.map((collection) => collection.key),
      counts: payload.counts,
      recordCounts: payload.recordCounts,
      collectionCount: chunkSpec.collections.length,
      sourceIds: payload.sourceIds,
      retrieval: payload.retrieval,
    });
  }

  const legacySerialized = sha256JsonBytes(snapshot);
  const combinedSha256 = sha256Text(chunks.map((chunk) => `${chunk.id}:${chunk.sha256}`).join('\n'));
  const manifest = {
    schemaVersion: OSINT_MANIFEST_SCHEMA_VERSION,
    snapshotSchemaVersion: OSINT_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: snapshot.fetchedAt,
    snapshot: {
      fetchedAt: snapshot.fetchedAt,
      sources: sortObjectByKeys(snapshot.sources),
      errors: cloneJson(snapshot.errors ?? []),
    },
    publication: {
      ordering: 'priority-ascending-domain-layout-v1',
      deterministicOrdering: true,
      atomicPublication: 'chunks-and-compatibility-artifact-are-replaced-before-manifest; manifest is the atomic publication cursor',
      chunkCount: chunks.length,
      totalChunkBytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
      combinedSha256,
    },
    legacyArtifact: {
      schemaVersion: OSINT_LEGACY_SCHEMA_VERSION,
      path: OSINT_LEGACY_SNAPSHOT_PATH,
      bytes: legacySerialized.bytes,
      sha256: legacySerialized.sha256,
      compatibility: 'byte-for-byte reassembly of the domain chunks and manifest root metadata in the original monolithic root-field order',
    },
    chunks,
  };

  return {
    snapshot,
    manifest,
    chunks: chunkPayloads,
    chunkRefs: chunks,
    legacyText: legacySerialized.text,
    legacyBytes: legacySerialized.bytes,
    legacySha256: legacySerialized.sha256,
  };
}

/** Write chunks first, compatibility artifacts second, and the manifest cursor last. */
export function writeChunkedPublication({ publication, dataDir, writeTextAtomic }) {
  const writes = [];
  for (const chunkSpec of OSINT_CHUNK_LAYOUT) {
    const payload = publication.chunks[chunkSpec.id];
    const path = join(dataDir, 'osint', chunkSpec.fileName);
    const text = JSON.stringify(payload);
    writeTextAtomic(path, text);
    writes.push({ path: chunkPublicPath(chunkSpec), bytes: Buffer.byteLength(text, 'utf8'), role: 'domain-chunk', id: chunkSpec.id });
  }
  writeTextAtomic(join(dataDir, 'osint-snapshot.json'), publication.legacyText);
  writes.push({ path: OSINT_LEGACY_SNAPSHOT_PATH, bytes: publication.legacyBytes, role: 'compatibility-monolith', id: 'legacy' });
  const manifestText = JSON.stringify(publication.manifest);
  writeTextAtomic(join(dataDir, 'osint', 'manifest.json'), manifestText);
  writes.push({ path: OSINT_MANIFEST_PATH, bytes: Buffer.byteLength(manifestText, 'utf8'), role: 'manifest-cursor', id: 'manifest' });
  return writes;
}

export function reassembleSnapshotFromChunks(manifest, chunkPayloads) {
  const errors = [];
  if (!isPlainObject(manifest)) return { snapshot: null, errors: ['manifest is not an object'] };
  if (!isPlainObject(manifest.snapshot)) errors.push('manifest snapshot root metadata missing');
  const snapshot = {};
  for (const key of OSINT_SNAPSHOT_FIELD_ORDER) {
    if (OSINT_MANIFEST_ROOT_FIELDS.includes(key)) {
      if (key === 'fetchedAt') snapshot[key] = manifest.snapshot?.fetchedAt;
      else if (key === 'sources') snapshot[key] = sortObjectByKeys(manifest.snapshot?.sources ?? {});
      else if (key === 'errors') snapshot[key] = cloneJson(manifest.snapshot?.errors ?? []);
      continue;
    }
    const owner = OSINT_CHUNK_LAYOUT.find((chunkSpec) => chunkSpec.collections.some((collection) => collection.key === key));
    if (!owner) {
      errors.push(`no domain owner for root field ${key}`);
      continue;
    }
    const payload = chunkPayloads?.[owner.id];
    if (!isPlainObject(payload)) {
      errors.push(`domain chunk ${owner.id} missing`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(payload.collections ?? {}, key)) {
      errors.push(`domain chunk ${owner.id} missing collection ${key}`);
      continue;
    }
    snapshot[key] = payload.collections[key];
  }
  return { snapshot: errors.length > 0 ? null : snapshot, errors };
}

function validateManifestShape(manifest, errors) {
  if (!isPlainObject(manifest)) {
    errors.push('manifest is not an object');
    return;
  }
  if (manifest.schemaVersion !== OSINT_MANIFEST_SCHEMA_VERSION) errors.push(`manifest schemaVersion must be ${OSINT_MANIFEST_SCHEMA_VERSION}`);
  if (manifest.snapshotSchemaVersion !== OSINT_SNAPSHOT_SCHEMA_VERSION) errors.push(`manifest snapshotSchemaVersion must be ${OSINT_SNAPSHOT_SCHEMA_VERSION}`);
  if (!validIso(manifest.generatedAt)) errors.push('manifest generatedAt missing or invalid');
  if (!isPlainObject(manifest.snapshot)) errors.push('manifest snapshot metadata missing');
  else {
    if (manifest.snapshot.fetchedAt !== manifest.generatedAt) errors.push('manifest snapshot fetchedAt does not match generatedAt');
    if (!isPlainObject(manifest.snapshot.sources)) errors.push('manifest snapshot sources missing');
    if (!Array.isArray(manifest.snapshot.errors) || manifest.snapshot.errors.some((line) => typeof line !== 'string')) errors.push('manifest snapshot errors must be a string array');
  }
  if (!isPlainObject(manifest.publication)) errors.push('manifest publication metadata missing');
  else {
    if (manifest.publication.deterministicOrdering !== true) errors.push('manifest does not declare deterministic ordering');
    if (manifest.publication.chunkCount !== OSINT_CHUNK_LAYOUT.length) errors.push('manifest chunkCount does not match canonical layout');
    if (!validSha(manifest.publication.combinedSha256)) errors.push('manifest combined chunk hash malformed');
  }
  if (!isPlainObject(manifest.legacyArtifact)) errors.push('manifest legacy artifact metadata missing');
  else {
    if (manifest.legacyArtifact.schemaVersion !== OSINT_LEGACY_SCHEMA_VERSION) errors.push('legacy artifact schema version mismatch');
    if (manifest.legacyArtifact.path !== OSINT_LEGACY_SNAPSHOT_PATH) errors.push('legacy artifact path mismatch');
    if (!Number.isInteger(manifest.legacyArtifact.bytes) || manifest.legacyArtifact.bytes <= 0) errors.push('legacy artifact byte count invalid');
    if (!validSha(manifest.legacyArtifact.sha256)) errors.push('legacy artifact hash malformed');
  }
  if (!Array.isArray(manifest.chunks)) {
    errors.push('manifest chunks missing or not an array');
    return;
  }
  if (manifest.chunks.length !== OSINT_CHUNK_LAYOUT.length) errors.push(`manifest has ${manifest.chunks.length} chunks; canonical layout requires ${OSINT_CHUNK_LAYOUT.length}`);
  const seen = new Set();
  manifest.chunks.forEach((entry, index) => {
    const label = `manifest.chunks[${index}]${entry?.id ? `:${entry.id}` : ''}`;
    if (!isPlainObject(entry)) {
      errors.push(`${label} is not an object`);
      return;
    }
    const expected = OSINT_CHUNKS_BY_ID[entry.id];
    if (!expected) {
      errors.push(`${label} unknown domain id`);
      return;
    }
    if (seen.has(entry.id)) errors.push(`${label} duplicate domain id`);
    seen.add(entry.id);
    if (OSINT_CHUNK_LAYOUT[index]?.id !== entry.id) errors.push(`${label} is out of deterministic publication order`);
    if (entry.schemaVersion !== expected.schemaVersion) errors.push(`${label} schemaVersion mismatch`);
    if (entry.path !== chunkPublicPath(expected)) errors.push(`${label} canonical path mismatch`);
    if (entry.relativePath !== expected.fileName) errors.push(`${label} relative path mismatch`);
    if (entry.priority !== expected.priority || entry.critical !== expected.critical) errors.push(`${label} priority/critical metadata mismatch`);
    if (!compareJson(entry.dependencies, [...expected.dependencies])) errors.push(`${label} dependencies mismatch canonical layout`);
    if (!compareJson(entry.collections, expected.collections.map((collection) => collection.key))) errors.push(`${label} collection assignment mismatch`);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) errors.push(`${label} invalid byte count`);
    if (!validSha(entry.sha256)) errors.push(`${label} malformed artifact hash`);
    if (!isPlainObject(entry.counts) || !isPlainObject(entry.recordCounts)) errors.push(`${label} missing counts/recordCounts`);
    if (!isPlainObject(entry.retrieval)) errors.push(`${label} missing retrieval summary`);
    else {
      if (!(entry.retrieval.earliestRetrievedAt === null || validIso(entry.retrieval.earliestRetrievedAt))) errors.push(`${label} invalid earliest retrieval timestamp`);
      if (!(entry.retrieval.latestRetrievedAt === null || validIso(entry.retrieval.latestRetrievedAt))) errors.push(`${label} invalid latest retrieval timestamp`);
      if (typeof entry.retrieval.preservedOrStale !== 'boolean') errors.push(`${label} missing preserved/stale truth flag`);
    }
  });
}

function validateChunkPayloadShape({ payload, reference, manifest, chunkText, errors }) {
  const label = `chunk:${reference.id}`;
  if (!isPlainObject(payload)) {
    errors.push(`${label} is not a JSON object`);
    return;
  }
  if (payload.schemaVersion !== reference.schemaVersion) errors.push(`${label} schemaVersion drift: payload ${payload.schemaVersion ?? 'missing'} but manifest ${reference.schemaVersion}`);
  if (payload.domain !== reference.id) errors.push(`${label} domain mismatch`);
  if (payload.snapshotSchemaVersion !== OSINT_SNAPSHOT_SCHEMA_VERSION) errors.push(`${label} snapshot schema version mismatch`);
  if (payload.snapshotFetchedAt !== manifest.generatedAt) errors.push(`${label} snapshot retrieval timestamp does not match manifest`);
  if (!compareJson(payload.dependencies, reference.dependencies)) errors.push(`${label} dependency metadata drift`);
  if (!isPlainObject(payload.collections) || !isPlainObject(payload.counts) || !isPlainObject(payload.collectionMetadata)) {
    errors.push(`${label} missing collections/counts/collection metadata`);
    return;
  }
  const expectedKeys = reference.collections;
  const actualKeys = Object.keys(payload.collections);
  if (!compareJson(actualKeys, expectedKeys)) errors.push(`${label} collection key order/assignment drift (${actualKeys.join(',') || 'none'} vs ${expectedKeys.join(',')})`);
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload.collections, key)) {
      errors.push(`${label} missing collection ${key}`);
      continue;
    }
    const value = payload.collections[key];
    const expectedCount = collectionCount(value);
    if (payload.counts[key] !== expectedCount) errors.push(`${label} count drift for ${key}: payload declares ${payload.counts[key]} but contains ${expectedCount}`);
    if (reference.counts?.[key] !== expectedCount) errors.push(`${label} manifest count drift for ${key}: manifest declares ${reference.counts?.[key]} but chunk contains ${expectedCount}`);
    const metadata = payload.collectionMetadata[key];
    if (!isPlainObject(metadata)) {
      errors.push(`${label} missing collection metadata for ${key}`);
      continue;
    }
    if (metadata.count !== expectedCount) errors.push(`${label} collection metadata count drift for ${key}`);
    const contentSha256 = sha256Text(stableStringify(value));
    if (metadata.contentSha256 !== contentSha256) errors.push(`${label} content hash drift for ${key}`);
    if (metadata.retrieval !== null && !isPlainObject(metadata.retrieval)) errors.push(`${label} malformed retrieval metadata for ${key}`);
  }
  if (chunkText !== null) {
    const bytes = Buffer.byteLength(chunkText, 'utf8');
    if (bytes !== reference.bytes) errors.push(`${label} byte-count drift: file is ${bytes}, manifest declares ${reference.bytes}`);
    const sha256 = sha256Text(chunkText);
    if (sha256 !== reference.sha256) errors.push(`${label} artifact hash drift: file sha256 ${sha256}, manifest declares ${reference.sha256}`);
  }
}

/** Validate a complete artifact set already loaded into memory. */
export function validateChunkedPublicationObjects({ manifest, chunkPayloads, chunkTexts = null, legacyText = null, legacySnapshot = null }) {
  const errors = [];
  const warnings = [];
  validateManifestShape(manifest, errors);
  if (errors.length > 0) return { errors, warnings, reassembled: null, reassemblyEqual: false };

  const references = new Map((manifest.chunks ?? []).map((entry) => [entry.id, entry]));
  for (const chunkSpec of OSINT_CHUNK_LAYOUT) {
    const reference = references.get(chunkSpec.id);
    if (!reference) {
      errors.push(`manifest missing domain chunk ${chunkSpec.id}`);
      continue;
    }
    const payload = chunkPayloads?.[chunkSpec.id];
    validateChunkPayloadShape({
      payload,
      reference,
      manifest,
      chunkText: chunkTexts?.[chunkSpec.id] ?? null,
      errors,
    });
  }

  const reassembly = reassembleSnapshotFromChunks(manifest, chunkPayloads);
  errors.push(...reassembly.errors.map((message) => `reassembly: ${message}`));
  let reassemblyEqual = false;
  if (reassembly.snapshot) {
    const canonicalReassembly = canonicalizeSnapshotForPublication(reassembly.snapshot);
    if (legacySnapshot) {
      reassemblyEqual = compareJson(canonicalReassembly, canonicalizeSnapshotForPublication(legacySnapshot));
      if (!reassemblyEqual) errors.push('reassembly equivalence failed: chunks do not reproduce the compatibility monolith');
    }
    if (legacyText !== null) {
      const textEqual = JSON.stringify(canonicalReassembly) === legacyText;
      if (!textEqual) errors.push('reassembly byte-equivalence failed: canonical JSON differs from osint-snapshot.json');
      const legacyBytes = Buffer.byteLength(legacyText, 'utf8');
      if (legacyBytes !== manifest.legacyArtifact.bytes) errors.push(`legacy artifact byte-count drift: file is ${legacyBytes}, manifest declares ${manifest.legacyArtifact.bytes}`);
      const legacySha256 = sha256Text(legacyText);
      if (legacySha256 !== manifest.legacyArtifact.sha256) errors.push(`legacy artifact hash drift: file sha256 ${legacySha256}, manifest declares ${manifest.legacyArtifact.sha256}`);
      reassemblyEqual = reassemblyEqual || textEqual;
    }
    const expectedCombined = sha256Text((manifest.chunks ?? []).map((chunk) => `${chunk.id}:${chunk.sha256}`).join('\n'));
    if (expectedCombined !== manifest.publication.combinedSha256) errors.push('manifest combined chunk hash does not match ordered chunk hashes');
  }
  return { errors, warnings, reassembled: reassembly.snapshot, reassemblyEqual };
}

/** Read and validate the deployed-layout artifact set rooted at frontend/public/data. */
export function validateChunkedPublicationDirectory(dataDir) {
  const errors = [];
  const warnings = [];
  const readJsonArtifact = (path, label) => {
    try {
      return { text: readFileSync(path, 'utf8'), payload: null, parseError: null };
    } catch (error) {
      errors.push(`${label} unreadable: ${error.message}`);
      return { text: null, payload: null, parseError: error.message };
    }
  };

  const manifestPath = join(dataDir, 'osint', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { errors: [`chunk manifest missing at ${OSINT_MANIFEST_PATH}`], warnings, manifest: null, chunks: {}, reassembled: null, reassemblyEqual: false };
  }
  const manifestArtifact = readJsonArtifact(manifestPath, 'chunk manifest');
  let manifest = null;
  try { manifest = manifestArtifact.text ? JSON.parse(manifestArtifact.text) : null; }
  catch (error) { errors.push(`chunk manifest invalid JSON: ${error.message}`); }

  const chunkPayloads = {};
  const chunkTexts = {};
  if (manifest) {
    for (const chunkSpec of OSINT_CHUNK_LAYOUT) {
      const file = join(dataDir, 'osint', chunkSpec.fileName);
      if (!existsSync(file)) {
        errors.push(`domain chunk missing at ${chunkPublicPath(chunkSpec)}`);
        continue;
      }
      const artifact = readJsonArtifact(file, `domain chunk ${chunkSpec.id}`);
      chunkTexts[chunkSpec.id] = artifact.text;
      if (artifact.text) {
        try { chunkPayloads[chunkSpec.id] = JSON.parse(artifact.text); }
        catch (error) { errors.push(`domain chunk ${chunkSpec.id} invalid JSON: ${error.message}`); }
      }
    }
  }

  const legacyPath = join(dataDir, 'osint-snapshot.json');
  let legacyText = null;
  let legacySnapshot = null;
  if (!existsSync(legacyPath)) errors.push(`compatibility monolith missing at ${OSINT_LEGACY_SNAPSHOT_PATH}`);
  else {
    const legacyArtifact = readJsonArtifact(legacyPath, 'compatibility monolith');
    legacyText = legacyArtifact.text;
    if (legacyText) {
      try { legacySnapshot = JSON.parse(legacyText); }
      catch (error) { errors.push(`compatibility monolith invalid JSON: ${error.message}`); }
    }
  }

  const validation = manifest
    ? validateChunkedPublicationObjects({ manifest, chunkPayloads, chunkTexts, legacyText, legacySnapshot })
    : { errors, warnings, reassembled: null, reassemblyEqual: false };
  return {
    errors: [...errors, ...validation.errors],
    warnings: [...warnings, ...validation.warnings],
    manifest,
    chunks: chunkPayloads,
    chunkTexts,
    legacyText,
    legacySnapshot,
    reassembled: validation.reassembled,
    reassemblyEqual: validation.reassemblyEqual,
  };
}

export function hashArtifactBytes(buffer) {
  return sha256Buffer(buffer);
}
