import type { OsintSnapshot } from "@/types/conflict";

export const OSINT_MANIFEST_SCHEMA_VERSION = "osint-snapshot-manifest/v1";
export const OSINT_SNAPSHOT_SCHEMA_VERSION = "osint-snapshot/v2-domain-chunked";

export type OsintChunkDomain =
  | "conflict"
  | "connectivity"
  | "environmental"
  | "humanitarian"
  | "orbital"
  | "transport-aviation"
  | "maritime"
  | "media-context"
  | "cyber"
  | "provenance";

export const OSINT_CHUNK_DOMAIN_ORDER: OsintChunkDomain[] = [
  "conflict",
  "connectivity",
  "environmental",
  "humanitarian",
  "orbital",
  "transport-aviation",
  "maritime",
  "media-context",
  "cyber",
  "provenance",
];

/** Evidence chunks consumed by multi-domain convergence. Conflict is the anchor corpus, not evidence. */
export const CONVERGENCE_EVIDENCE_CHUNK_DOMAINS: OsintChunkDomain[] = [
  "connectivity",
  "environmental",
  "humanitarian",
  "orbital",
  "transport-aviation",
  "maritime",
  "media-context",
];

const DOMAIN_COLLECTIONS: Record<OsintChunkDomain, (keyof OsintSnapshot)[]> = {
  conflict: ["mapOfWarsEvents", "ucdpMeta"],
  connectivity: ["internetOutages", "internetOutageMeta"],
  environmental: ["naturalEvents"],
  humanitarian: ["reliefwebRecords", "reliefwebMeta"],
  orbital: ["satellites", "launches"],
  "transport-aviation": ["militaryAircraft", "aircraft"],
  maritime: ["vessels"],
  "media-context": ["news", "gpsInterference", "webcams", "gdeltGeoNews", "gdeltGeoMeta"],
  cyber: ["cyberVulnerabilities", "cyberVulnerabilityMeta"],
  provenance: ["provenanceLedger"],
};

export interface OsintChunkRetrievalSummary {
  earliestRetrievedAt: string | null;
  latestRetrievedAt: string | null;
  retrievalStates: string[];
  freshnessStates: string[];
  preservedOrStale: boolean;
}

export interface OsintChunkReference {
  id: OsintChunkDomain;
  title: string;
  schemaVersion: string;
  path: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  priority: number;
  critical: boolean;
  dependencies: string[];
  collections: string[];
  counts: Record<string, number>;
  recordCounts: Record<string, number>;
  collectionCount: number;
  sourceIds: string[];
  retrieval: OsintChunkRetrievalSummary;
}

export interface OsintSnapshotManifest {
  schemaVersion: typeof OSINT_MANIFEST_SCHEMA_VERSION;
  snapshotSchemaVersion: typeof OSINT_SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  snapshot: {
    fetchedAt: string;
    sources: Record<string, string>;
    errors: string[];
  };
  publication: {
    ordering: string;
    deterministicOrdering: boolean;
    atomicPublication: string;
    chunkCount: number;
    totalChunkBytes: number;
    combinedSha256: string;
  };
  legacyArtifact: {
    schemaVersion: string;
    path: string;
    bytes: number;
    sha256: string;
    compatibility: string;
  };
  chunks: OsintChunkReference[];
}

export interface OsintChunkPayload {
  schemaVersion: string;
  domain: OsintChunkDomain;
  title: string;
  snapshotSchemaVersion: string;
  snapshotFetchedAt: string;
  priority: number;
  critical: boolean;
  dependencies: string[];
  collections: Record<string, unknown>;
  collectionMetadata: Record<string, {
    kind: string;
    count: number;
    contentSha256: string;
    retrieval: unknown;
  }>;
  counts: Record<string, number>;
  recordCounts: Record<string, number>;
  sourceIds: string[];
  retrieval: OsintChunkRetrievalSummary;
}

export type OsintChunkLoadStatus = "pending" | "loading" | "loaded" | "error" | "degraded";

export interface OsintChunkRuntimeState {
  id: OsintChunkDomain;
  title: string;
  status: OsintChunkLoadStatus;
  critical: boolean;
  priority: number;
  path: string;
  bytes: number;
  sha256: string;
  collections: string[];
  counts: Record<string, number>;
  retrieval: OsintChunkRetrievalSummary | null;
  error: string | null;
  retainedFromPrevious: boolean;
  stale: boolean;
  loadedAt: number | null;
}

export type OsintSnapshotLoadPhase =
  | "idle"
  | "manifest-loading"
  | "critical-loading"
  | "background-loading"
  | "complete"
  | "degraded"
  | "failed";

export interface OsintSnapshotRuntime {
  phase: OsintSnapshotLoadPhase;
  manifestLoaded: boolean;
  criticalReady: boolean;
  criticalComplete: boolean;
  evidencePending: boolean;
  complete: boolean;
  stale: boolean;
  error: string | null;
  refreshInProgress: boolean;
  lastCheckedAt: number | null;
  lastCompletedAt: number | null;
  snapshotFetchedAt: string | null;
  chunks: Partial<Record<OsintChunkDomain, OsintChunkRuntimeState>>;
  loadedChunkCount: number;
  usableChunkCount: number;
  totalChunkCount: number;
  loadedBytes: number;
  totalBytes: number;
  integrity: "pending" | "verified" | "unavailable" | "failed";
}

export type LoadedOsintSnapshot = OsintSnapshot & { runtime: OsintSnapshotRuntime };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function collectionCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value === null || value === undefined ? 0 : 1;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!isObject(value)) return {};
  const output: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 0) output[key] = item;
  }
  return output;
}

function asRetrievalSummary(value: unknown): OsintChunkRetrievalSummary {
  const input = isObject(value) ? value : {};
  return {
    earliestRetrievedAt: validIso(input.earliestRetrievedAt) ? input.earliestRetrievedAt : null,
    latestRetrievedAt: validIso(input.latestRetrievedAt) ? input.latestRetrievedAt : null,
    retrievalStates: asStringArray(input.retrievalStates),
    freshnessStates: asStringArray(input.freshnessStates),
    preservedOrStale: input.preservedOrStale === true,
  };
}

export function validateOsintSnapshotManifest(value: unknown): { manifest: OsintSnapshotManifest | null; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(value)) return { manifest: null, errors: ["manifest is not an object"] };
  if (value.schemaVersion !== OSINT_MANIFEST_SCHEMA_VERSION) errors.push("unsupported manifest schemaVersion");
  if (value.snapshotSchemaVersion !== OSINT_SNAPSHOT_SCHEMA_VERSION) errors.push("unsupported snapshot schemaVersion");
  if (!validIso(value.generatedAt)) errors.push("manifest generatedAt is invalid");
  if (!isObject(value.snapshot) || !validIso(value.snapshot.fetchedAt) || !isObject(value.snapshot.sources) || !Array.isArray(value.snapshot.errors)) {
    errors.push("manifest snapshot root metadata is malformed");
  }
  if (!isObject(value.publication) || value.publication.deterministicOrdering !== true || !validSha(value.publication.combinedSha256)) {
    errors.push("manifest publication ordering/integrity metadata is malformed");
  }
  if (!Array.isArray(value.chunks) || value.chunks.length === 0) {
    errors.push("manifest chunks missing");
  }

  const chunks: OsintChunkReference[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.chunks)) {
    value.chunks.forEach((raw, index) => {
      const label = `manifest.chunks[${index}]`;
      if (!isObject(raw) || !isNonEmptyString(raw.id) || !OSINT_CHUNK_DOMAIN_ORDER.includes(raw.id as OsintChunkDomain)) {
        errors.push(`${label} has an unknown domain id`);
        return;
      }
      const id = raw.id as OsintChunkDomain;
      if (seen.has(id)) errors.push(`${label} duplicates ${id}`);
      seen.add(id);
      const expectedSchema = `osint-domain-chunk/${id}/v1`;
      if (raw.schemaVersion !== expectedSchema) errors.push(`${label} schemaVersion drift`);
      if (!isNonEmptyString(raw.path) || !isNonEmptyString(raw.relativePath) || !validSha(raw.sha256) || typeof raw.bytes !== "number" || raw.bytes <= 0) {
        errors.push(`${label} path/byte/hash metadata malformed`);
      }
      if (typeof raw.priority !== "number" || typeof raw.critical !== "boolean") errors.push(`${label} priority metadata malformed`);
      if (!Array.isArray(raw.collections) || raw.collections.some((item) => typeof item !== "string")) errors.push(`${label} collection list malformed`);
      chunks.push({
        id,
        title: isNonEmptyString(raw.title) ? raw.title : id,
        schemaVersion: isNonEmptyString(raw.schemaVersion) ? raw.schemaVersion : expectedSchema,
        path: isNonEmptyString(raw.path) ? raw.path : `data/osint/${id}.v1.json`,
        relativePath: isNonEmptyString(raw.relativePath) ? raw.relativePath : `${id}.v1.json`,
        bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
        sha256: validSha(raw.sha256) ? raw.sha256 : "",
        priority: typeof raw.priority === "number" ? raw.priority : 999,
        critical: raw.critical === true,
        dependencies: asStringArray(raw.dependencies),
        collections: asStringArray(raw.collections),
        counts: asNumberRecord(raw.counts),
        recordCounts: asNumberRecord(raw.recordCounts),
        collectionCount: typeof raw.collectionCount === "number" ? raw.collectionCount : asStringArray(raw.collections).length,
        sourceIds: asStringArray(raw.sourceIds),
        retrieval: asRetrievalSummary(raw.retrieval),
      });
    });
  }
  for (const id of OSINT_CHUNK_DOMAIN_ORDER) {
    if (!seen.has(id)) errors.push(`manifest missing canonical domain ${id}`);
  }
  if (chunks.length > 1) {
    const priorities = chunks.map((chunk) => chunk.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    if (priorities.join(",") !== sorted.join(",")) errors.push("manifest chunks are not in deterministic priority order");
  }
  if (errors.length > 0) return { manifest: null, errors: [...new Set(errors)] };
  return { manifest: value as unknown as OsintSnapshotManifest, errors: [] };
}

export function validateChunkPayload(value: unknown, reference: OsintChunkReference, manifest: OsintSnapshotManifest): { payload: OsintChunkPayload | null; errors: string[] } {
  const errors: string[] = [];
  const label = `chunk ${reference.id}`;
  if (!isObject(value)) return { payload: null, errors: [`${label} is not an object`] };
  if (value.schemaVersion !== reference.schemaVersion) errors.push(`${label} schemaVersion drift`);
  if (value.domain !== reference.id) errors.push(`${label} domain mismatch`);
  if (value.snapshotSchemaVersion !== OSINT_SNAPSHOT_SCHEMA_VERSION) errors.push(`${label} unsupported snapshot schema`);
  if (value.snapshotFetchedAt !== manifest.generatedAt) errors.push(`${label} retrieval timestamp does not match manifest`);
  if (!isObject(value.collections) || !isObject(value.counts)) {
    errors.push(`${label} collections or counts missing`);
    return { payload: null, errors };
  }
  const expectedCollections = DOMAIN_COLLECTIONS[reference.id];
  for (const key of expectedCollections) {
    if (!Object.prototype.hasOwnProperty.call(value.collections, key)) errors.push(`${label} missing collection ${key}`);
    const count = collectionCount(value.collections[key]);
    const declared = isObject(value.counts) && typeof value.counts[key] === "number" ? value.counts[key] : null;
    if (declared !== count) errors.push(`${label} count drift for ${key}`);
    if (reference.counts[key] !== count) errors.push(`${label} manifest count drift for ${key}`);
  }
  if (errors.length > 0) return { payload: null, errors };
  return { payload: value as unknown as OsintChunkPayload, errors: [] };
}

export function createEmptyOsintSnapshot(): OsintSnapshot {
  return {
    fetchedAt: "",
    sources: {},
    provenanceLedger: null,
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
    ucdpMeta: null,
    gdeltGeoNews: [],
    gdeltGeoMeta: null,
    reliefwebRecords: [],
    reliefwebMeta: null,
    errors: [],
  };
}

export function createSnapshotShell(manifest: OsintSnapshotManifest): OsintSnapshot {
  return {
    ...createEmptyOsintSnapshot(),
    fetchedAt: manifest.snapshot.fetchedAt,
    sources: { ...manifest.snapshot.sources },
    errors: [...manifest.snapshot.errors],
  };
}

export function applyChunkToSnapshot(snapshot: OsintSnapshot, payload: OsintChunkPayload): OsintSnapshot {
  const next: OsintSnapshot = { ...snapshot };
  const mutable = next as unknown as Record<string, unknown>;
  for (const key of DOMAIN_COLLECTIONS[payload.domain]) {
    if (Object.prototype.hasOwnProperty.call(payload.collections, key)) mutable[key] = payload.collections[key];
  }
  return next;
}

export function createRuntimeState(reference: OsintChunkReference, status: OsintChunkLoadStatus = "pending"): OsintChunkRuntimeState {
  return {
    id: reference.id,
    title: reference.title,
    status,
    critical: reference.critical,
    priority: reference.priority,
    path: reference.path,
    bytes: reference.bytes,
    sha256: reference.sha256,
    collections: [...reference.collections],
    counts: { ...reference.counts },
    retrieval: reference.retrieval,
    error: null,
    retainedFromPrevious: false,
    stale: reference.retrieval.preservedOrStale,
    loadedAt: null,
  };
}

export function deriveRuntime({
  manifest,
  chunkStates,
  refreshInProgress = false,
  lastCheckedAt = null,
  lastCompletedAt = null,
  externalError = null,
  integrity = "pending",
}: {
  manifest: OsintSnapshotManifest | null;
  chunkStates: Partial<Record<OsintChunkDomain, OsintChunkRuntimeState>>;
  refreshInProgress?: boolean;
  lastCheckedAt?: number | null;
  lastCompletedAt?: number | null;
  externalError?: string | null;
  integrity?: OsintSnapshotRuntime["integrity"];
}): OsintSnapshotRuntime {
  const states = Object.values(chunkStates).filter((state): state is OsintChunkRuntimeState => Boolean(state));
  const totalChunkCount = manifest?.chunks.length ?? states.length;
  const usableStates = states.filter((state) => state.status === "loaded" || state.status === "degraded");
  const loadedStates = states.filter((state) => state.status === "loaded");
  const errorStates = states.filter((state) => state.status === "error" || state.status === "degraded");
  const criticalReferences = manifest?.chunks.filter((chunk) => chunk.critical) ?? [];
  const conflictState = chunkStates.conflict;
  const criticalReady = conflictState?.status === "loaded" || conflictState?.status === "degraded";
  const criticalComplete = criticalReferences.length > 0 && criticalReferences.every((reference) => {
    const status = chunkStates[reference.id]?.status;
    return status === "loaded" || status === "degraded" || status === "error";
  });
  const allTerminal = totalChunkCount > 0 && states.length >= totalChunkCount && states.every((state) => state.status === "loaded" || state.status === "degraded" || state.status === "error");
  const complete = totalChunkCount > 0 && usableStates.length === totalChunkCount;
  const evidencePending = CONVERGENCE_EVIDENCE_CHUNK_DOMAINS.some((domain) => {
    const status = chunkStates[domain]?.status;
    return status === undefined || status === "pending" || status === "loading";
  });
  const firstError = externalError ?? errorStates.map((state) => state.error).find((value): value is string => Boolean(value)) ?? null;
  const stale = states.some((state) => state.stale || state.status === "degraded") || Boolean(externalError && usableStates.length > 0);
  let phase: OsintSnapshotLoadPhase = "idle";
  if (!manifest) phase = externalError ? "failed" : "manifest-loading";
  else if (!allTerminal) phase = criticalReady ? "background-loading" : "critical-loading";
  else if (complete && errorStates.length === 0 && !externalError) phase = "complete";
  else if (usableStates.length > 0) phase = "degraded";
  else phase = "failed";

  return {
    phase,
    manifestLoaded: manifest !== null,
    criticalReady,
    criticalComplete,
    evidencePending,
    complete,
    stale,
    error: firstError,
    refreshInProgress,
    lastCheckedAt,
    lastCompletedAt,
    snapshotFetchedAt: manifest?.generatedAt ?? null,
    chunks: chunkStates,
    loadedChunkCount: loadedStates.length,
    usableChunkCount: usableStates.length,
    totalChunkCount,
    loadedBytes: loadedStates.reduce((sum, state) => sum + state.bytes, 0),
    totalBytes: manifest?.publication.totalChunkBytes ?? states.reduce((sum, state) => sum + state.bytes, 0),
    integrity,
  };
}

export function createInitialRuntime(): OsintSnapshotRuntime {
  return deriveRuntime({ manifest: null, chunkStates: {}, integrity: "pending" });
}

export function createLegacyRuntime(snapshot: OsintSnapshot, detail: string, checkedAt: number): OsintSnapshotRuntime {
  const states: Partial<Record<OsintChunkDomain, OsintChunkRuntimeState>> = {};
  for (const domain of OSINT_CHUNK_DOMAIN_ORDER) {
    states[domain] = {
      id: domain,
      title: domain,
      status: "degraded",
      critical: domain === "conflict" || domain === "connectivity" || domain === "environmental",
      priority: OSINT_CHUNK_DOMAIN_ORDER.indexOf(domain) * 10,
      path: "data/osint-snapshot.json",
      bytes: 0,
      sha256: "",
      collections: DOMAIN_COLLECTIONS[domain].map(String),
      counts: {},
      retrieval: null,
      error: detail,
      retainedFromPrevious: false,
      stale: true,
      loadedAt: checkedAt,
    };
  }
  const runtime = deriveRuntime({
    manifest: {
      schemaVersion: OSINT_MANIFEST_SCHEMA_VERSION,
      snapshotSchemaVersion: OSINT_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: snapshot.fetchedAt,
      snapshot: { fetchedAt: snapshot.fetchedAt, sources: snapshot.sources, errors: snapshot.errors },
      publication: {
        ordering: "legacy-monolith-fallback",
        deterministicOrdering: true,
        atomicPublication: "compatibility monolith loaded because the domain manifest was unavailable",
        chunkCount: OSINT_CHUNK_DOMAIN_ORDER.length,
        totalChunkBytes: 0,
        combinedSha256: "0".repeat(64),
      },
      legacyArtifact: {
        schemaVersion: "osint-snapshot/v1-monolithic-compatibility",
        path: "data/osint-snapshot.json",
        bytes: 0,
        sha256: "0".repeat(64),
        compatibility: "legacy fallback",
      },
      chunks: [],
    },
    chunkStates: states,
    externalError: detail,
    lastCheckedAt: checkedAt,
    lastCompletedAt: checkedAt,
    integrity: "unavailable",
  });
  return { ...runtime, phase: snapshot.fetchedAt ? "degraded" : "failed", complete: Boolean(snapshot.fetchedAt), totalChunkCount: OSINT_CHUNK_DOMAIN_ORDER.length };
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", buffer.slice(0));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
