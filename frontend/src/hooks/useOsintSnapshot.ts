"use client";

import { useEffect, useRef, useState } from "react";
import type { OsintSnapshot } from "@/types/conflict";
import { assetPath } from "@/lib/assets";
import {
  applyChunkToSnapshot,
  createEmptyOsintSnapshot,
  createInitialRuntime,
  createLegacyRuntime,
  createRuntimeState,
  createSnapshotShell,
  deriveRuntime,
  sha256Hex,
  validateChunkPayload,
  validateOsintSnapshotManifest,
  type LoadedOsintSnapshot,
  type OsintChunkDomain,
  type OsintChunkPayload,
  type OsintChunkReference,
  type OsintChunkRuntimeState,
  type OsintSnapshotManifest,
  type OsintSnapshotRuntime,
} from "@/lib/osintSnapshotChunks";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface ChunkRecord {
  reference: OsintChunkReference;
  state: OsintChunkRuntimeState;
  payload: OsintChunkPayload | null;
}

interface RuntimeControls {
  refreshInProgress: boolean;
  lastCheckedAt: number | null;
  lastCompletedAt: number | null;
  externalError: string | null;
  integrity: OsintSnapshotRuntime["integrity"];
}

async function fetchJsonNoStore(path: string): Promise<unknown> {
  const response = await fetch(assetPath(path), { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stateMap(records: Partial<Record<OsintChunkDomain, ChunkRecord>>) {
  const output: Partial<Record<OsintChunkDomain, OsintChunkRuntimeState>> = {};
  for (const [domain, record] of Object.entries(records) as [OsintChunkDomain, ChunkRecord][]) {
    output[domain] = record.state;
  }
  return output;
}

/**
 * Lazy, priority-ordered OSINT snapshot loader.
 *
 * Correctness rules:
 * - the manifest is the only publication cursor;
 * - conflict/connectivity/environmental chunks complete before any heavy background
 *   chunk is requested, so transport/media never compete with the critical first paint;
 * - every chunk is byte-count and SHA-256 checked when WebCrypto is available;
 * - a failed refresh never silently discards a previously consistent snapshot. Retained
 *   rows are explicitly marked degraded/stale rather than being presented as fresh;
 * - initial absent chunks remain empty and visibly pending — zero rows are never used
 *   to claim negative coverage while a domain is still loading.
 */
export function useOsintSnapshot(): LoadedOsintSnapshot {
  const [snapshot, setSnapshot] = useState<LoadedOsintSnapshot>(() => ({
    ...createEmptyOsintSnapshot(),
    runtime: createInitialRuntime(),
  }));
  const snapshotDataRef = useRef<OsintSnapshot>(createEmptyOsintSnapshot());
  const manifestRef = useRef<OsintSnapshotManifest | null>(null);
  const recordsRef = useRef<Partial<Record<OsintChunkDomain, ChunkRecord>>>({});
  const runtimeControlsRef = useRef<RuntimeControls>({
    refreshInProgress: false,
    lastCheckedAt: null,
    lastCompletedAt: null,
    externalError: null,
    integrity: "pending",
  });
  const legacyModeRef = useRef(false);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const cycleSeqRef = useRef(0);

  useEffect(() => {
    cancelledRef.current = false;

    const publish = (controlsOverride: Partial<RuntimeControls> = {}) => {
      if (cancelledRef.current) return;
      const controls = { ...runtimeControlsRef.current, ...controlsOverride };
      runtimeControlsRef.current = controls;
      const runtime = deriveRuntime({
        manifest: manifestRef.current,
        chunkStates: stateMap(recordsRef.current),
        refreshInProgress: controls.refreshInProgress,
        lastCheckedAt: controls.lastCheckedAt,
        lastCompletedAt: controls.lastCompletedAt,
        externalError: controls.externalError,
        integrity: controls.integrity,
      });
      const next = { ...snapshotDataRef.current, runtime };
      setSnapshot(next);
    };

    const publishLegacy = (detail: string, failed: boolean) => {
      if (cancelledRef.current) return;
      const checkedAt = Date.now();
      const runtime = createLegacyRuntime(snapshotDataRef.current, detail, checkedAt);
      if (failed && !snapshotDataRef.current.fetchedAt) runtime.phase = "failed";
      setSnapshot({ ...snapshotDataRef.current, runtime });
    };

    const reconcileRecords = (manifest: OsintSnapshotManifest) => {
      const prior = recordsRef.current;
      const next: Partial<Record<OsintChunkDomain, ChunkRecord>> = {};
      for (const reference of manifest.chunks) {
        const previous = prior[reference.id];
        const state = createRuntimeState(reference, "pending");
        if (previous?.payload) {
          // Rows remain visible while their replacement is fetched, but every chunk
          // state explicitly says they are retained rather than part of the new fetch.
          state.retainedFromPrevious = true;
          state.stale = true;
        }
        next[reference.id] = {
          reference,
          state,
          payload: previous?.payload ?? null,
        };
      }
      recordsRef.current = next;
      // Integrity is per generation/retry, not a sticky process-global failure: a later
      // verified generation can recover, while any new hash mismatch still fails closed.
      runtimeControlsRef.current.integrity = "pending";

      const shell = createSnapshotShell(manifest);
      let assembled: OsintSnapshot = shell;
      for (const record of Object.values(next)) {
        if (record.payload) assembled = applyChunkToSnapshot(assembled, record.payload);
      }
      snapshotDataRef.current = assembled;
    };

    const loadChunk = async (domain: OsintChunkDomain, cycle: number) => {
      const record = recordsRef.current[domain];
      if (!record) return;
      record.state = { ...record.state, status: "loading", error: null };
      publish();
      try {
        const response = await fetch(assetPath(`/${record.reference.path}`), { cache: "no-store", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== record.reference.bytes) {
          throw new Error(`byte-count drift: received ${buffer.byteLength}, manifest declares ${record.reference.bytes}`);
        }
        const digest = await sha256Hex(buffer);
        const integrityAvailable = digest !== null;
        if (digest && digest !== record.reference.sha256) {
          runtimeControlsRef.current.integrity = "failed";
          throw new Error("SHA-256 drift between chunk bytes and manifest");
        }
        if (!integrityAvailable && runtimeControlsRef.current.integrity !== "failed") {
          runtimeControlsRef.current.integrity = "unavailable";
        }
        const text = new TextDecoder().decode(buffer);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new Error(`invalid JSON: ${errorMessage(error)}`);
        }
        if (!manifestRef.current) throw new Error("manifest disappeared during chunk load");
        const validation = validateChunkPayload(parsed, record.reference, manifestRef.current);
        if (!validation.payload) throw new Error(validation.errors.join("; "));
        if (cancelledRef.current || cycle !== cycleSeqRef.current) return;
        record.payload = validation.payload;
        record.state = {
          ...record.state,
          status: "loaded",
          error: null,
          retainedFromPrevious: false,
          stale: record.reference.retrieval.preservedOrStale,
          loadedAt: Date.now(),
        };
        snapshotDataRef.current = applyChunkToSnapshot(snapshotDataRef.current, validation.payload);
        publish();
      } catch (error) {
        if (cancelledRef.current || cycle !== cycleSeqRef.current) return;
        const message = errorMessage(error);
        const retained = record.payload !== null;
        record.state = {
          ...record.state,
          status: retained ? "degraded" : "error",
          error: message,
          retainedFromPrevious: retained,
          stale: true,
          loadedAt: retained ? record.state.loadedAt : null,
        };
        publish();
      }
    };

    const loadLegacyFallback = async (manifestError: string) => {
      try {
        const payload = await fetchJsonNoStore("/data/osint-snapshot.json") as Partial<OsintSnapshot>;
        if (cancelledRef.current) return;
        legacyModeRef.current = true;
        snapshotDataRef.current = { ...createEmptyOsintSnapshot(), ...payload };
        publishLegacy(`domain manifest unavailable (${manifestError}); compatibility monolith loaded instead`, false);
      } catch (legacyError) {
        if (cancelledRef.current) return;
        const detail = `domain manifest unavailable (${manifestError}); compatibility monolith also failed (${errorMessage(legacyError)})`;
        if (snapshotDataRef.current.fetchedAt) publishLegacy(detail, false);
        else publishLegacy(detail, true);
      }
    };

    const runCycle = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const cycle = ++cycleSeqRef.current;
      runtimeControlsRef.current = {
        ...runtimeControlsRef.current,
        refreshInProgress: true,
        externalError: null,
      };
      publish();
      try {
        let manifest: OsintSnapshotManifest;
        try {
          const manifestPayload = await fetchJsonNoStore("/data/osint/manifest.json");
          const validation = validateOsintSnapshotManifest(manifestPayload);
          if (!validation.manifest) throw new Error(validation.errors.join("; "));
          manifest = validation.manifest;
        } catch (error) {
          await loadLegacyFallback(errorMessage(error));
          return;
        }
        if (cancelledRef.current || cycle !== cycleSeqRef.current) return;
        legacyModeRef.current = false;
        const unchanged = manifestRef.current
          && manifestRef.current.generatedAt === manifest.generatedAt
          && manifestRef.current.publication.combinedSha256 === manifest.publication.combinedSha256;
        manifestRef.current = manifest;
        runtimeControlsRef.current.lastCheckedAt = Date.now();
        const terminalFailureNeedsRetry = Object.values(recordsRef.current).some((record) => record.state.status === "error" || record.state.status === "degraded");
        if (unchanged && !terminalFailureNeedsRetry && Object.keys(recordsRef.current).length === manifest.chunks.length) {
          publish({ refreshInProgress: false, lastCompletedAt: Date.now(), externalError: null });
          return;
        }

        reconcileRecords(manifest);
        publish();
        const ordered = [...manifest.chunks].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
        const critical = ordered.filter((reference) => reference.critical);
        const background = ordered.filter((reference) => !reference.critical);

        // Bandwidth priority is real, not cosmetic: no heavy transport/media request is
        // even created until every critical conflict/context request has settled.
        await Promise.allSettled(critical.map((reference) => loadChunk(reference.id, cycle)));
        if (cancelledRef.current || cycle !== cycleSeqRef.current) return;
        publish();
        await Promise.allSettled(background.map((reference) => loadChunk(reference.id, cycle)));
        if (cancelledRef.current || cycle !== cycleSeqRef.current) return;
        const allLoaded = Object.values(recordsRef.current).length === manifest.chunks.length
          && Object.values(recordsRef.current).every((record) => record.state.status === "loaded");
        const integrity = runtimeControlsRef.current.integrity === "failed"
          ? "failed"
          : allLoaded
            ? (runtimeControlsRef.current.integrity === "unavailable" ? "unavailable" : "verified")
            : runtimeControlsRef.current.integrity === "unavailable" ? "unavailable" : "pending";
        publish({ refreshInProgress: false, lastCompletedAt: Date.now(), externalError: null, integrity });
      } catch (error) {
        if (!cancelledRef.current && cycle === cycleSeqRef.current) {
          publish({ refreshInProgress: false, externalError: errorMessage(error) });
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void runCycle();
    const interval = window.setInterval(() => { void runCycle(); }, REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      cycleSeqRef.current += 1;
      window.clearInterval(interval);
    };
  }, []);

  return snapshot;
}
