import { assetPath } from "@/lib/assets";
import { rankEventIndicesForRender, viewportDistanceDegrees } from "@/lib/globeRendering";
import type { CategoryGroup, ConflictEvent, MilitaryAircraft } from "@/types/conflict";

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc(size: number): number;
  wasm_dealloc(ptr: number, size: number): void;
  select_regional_events(input: number, len: number, focusLat: number, focusLng: number, altitude: number, output: number, cap: number): number;
  aircraft_tracks(input: number, len: number, output: number): number;
  incident_store_create(input: number, len: number): number;
  incident_store_destroy(store: number): void;
  incident_store_query_viewport(
    store: number,
    focusLat: number,
    focusLng: number,
    radiusDegrees: number,
    cap: number,
    categoryMask: number,
    timeStart: number,
    timeEndExclusive: number,
  ): number;
  incident_store_output_ptr(store: number): number;
  incident_store_len(store: number): number;
  incident_store_memory_bytes(store: number): number;
}

export interface AircraftTrackGeometry {
  sourceIndex: number;
  points: [number, number, number][];
}

/** Category bits packed into the resident WASM incident columns. */
export const INCIDENT_CATEGORY_GROUP_MASKS: Record<CategoryGroup, number> = {
  kinetic: 1 << 0,
  security: 1 << 1,
  humanitarian: 1 << 2,
  political: 1 << 3,
  strategic: 1 << 4,
};

export interface IncidentViewportQueryOptions {
  focusLat: number;
  focusLng: number;
  /** `null` is the unbounded global viewport. In WASM it is encoded as NaN because the ABI is numeric. */
  radiusDegrees: number | null;
  cap: number;
  /** Zero disables category filtering; otherwise a row passes when its packed group bits intersect this mask. */
  categoryMask?: number;
  /** NaN disables either temporal bound. Times are exact epoch milliseconds stored as f64. */
  timeStart?: number;
  timeEndExclusive?: number;
}

export interface IncidentViewportPage {
  /**
   * Compact source-row indices in canonical priority order. This is a view into WASM linear
   * memory and is intentionally not copied row-by-row; it remains valid only until the next
   * incident query on this core. The composing selection consumes it synchronously.
   */
  indices: Uint32Array;
  viewportCandidates: number;
  outsideViewport: number;
  filteredMatches: number;
  written: number;
}

export interface GodseyeWasmCore {
  selectRegionalEvents(events: ConflictEvent[], focusLat: number, focusLng: number, altitude: number): number[];
  aircraftTrackGeometry(aircraft: MilitaryAircraft[]): AircraftTrackGeometry[];
  /**
   * Replaces the resident incident store when the immutable incident array identity changes.
   * Returns the canonical priority permutation on success, or null when the host must use the
   * JavaScript fallback. A refresh with a new array can never alias rows from a prior snapshot.
   */
  prepareIncidentEvents(events: readonly ConflictEvent[]): readonly number[] | null;
  incidentStoreMatches(events: readonly ConflictEvent[]): boolean;
  queryIncidentViewport(options: IncidentViewportQueryOptions): IncidentViewportPage | null;
  incidentStoreMemoryBytes(): number;
  /** Total linear-memory bytes for the underlying WASM instance; useful for reload/leak diagnostics. */
  wasmMemoryBytes(): number;
}

const INCIDENT_INPUT_STRIDE_F64 = 8;
const MAX_INCIDENTS_FOR_WASM = 1_000_000;
const INCIDENT_OUTPUT_HEADER_U32S = 6;
const INCIDENT_OUTPUT_ABI_VERSION = 2;
const INCIDENT_OUTPUT_BOUNDARY_FLAG = 0x8000_0000;
const INCIDENT_OUTPUT_FILTER_PASS_FLAG = 0x4000_0000;
const INCIDENT_OUTPUT_INDEX_MASK = 0x3fff_ffff;

function severityRank(event: ConflictEvent): number {
  if (event.severity === "critical") return 4;
  if (event.severity === "high") return 3;
  if (event.severity === "medium") return 2;
  return 1;
}

function finiteStoreCap(cap: number, len: number): number {
  if (Number.isNaN(cap)) return 0;
  if (cap === Infinity) return len;
  if (cap === -Infinity) return 0;
  return Math.max(0, Math.min(len, Math.floor(cap)));
}

function createCore(exports: WasmExports): GodseyeWasmCore {
  const copyIn = (values: Float64Array): { ptr: number; bytes: number } => {
    const bytes = values.byteLength;
    const ptr = exports.wasm_alloc(bytes);
    if (bytes > 0 && ptr === 0) throw new Error("WASM allocation failed");
    new Float64Array(exports.memory.buffer, ptr, values.length).set(values);
    return { ptr, bytes };
  };

  let incidentStore = 0;
  let incidentStoreLength = 0;
  let incidentSource: readonly ConflictEvent[] | null = null;
  let incidentPriorityOrder: readonly number[] | null = null;

  const destroyIncidentStore = () => {
    if (incidentStore !== 0) exports.incident_store_destroy(incidentStore);
    incidentStore = 0;
    incidentStoreLength = 0;
    incidentSource = null;
    incidentPriorityOrder = null;
  };

  return {
    selectRegionalEvents(events, focusLat, focusLng, altitude) {
      if (events.length === 0) return [];
      const input = new Float64Array(events.length * 5);
      events.forEach((event, index) => {
        const offset = index * 5;
        input[offset] = event.lat;
        input[offset + 1] = event.lng;
        input[offset + 2] = event.intensity;
        input[offset + 3] = event.occurredAt;
        input[offset + 4] = severityRank(event);
      });
      const inputAlloc = copyIn(input);
      const outputBytes = events.length * 4;
      const outputPtr = exports.wasm_alloc(outputBytes);
      try {
        const count = exports.select_regional_events(inputAlloc.ptr, events.length, focusLat, focusLng, altitude, outputPtr, events.length);
        return Array.from(new Uint32Array(exports.memory.buffer, outputPtr, count));
      } finally {
        exports.wasm_dealloc(inputAlloc.ptr, inputAlloc.bytes);
        exports.wasm_dealloc(outputPtr, outputBytes);
      }
    },

    aircraftTrackGeometry(aircraft) {
      if (aircraft.length === 0) return [];
      const count = Math.min(aircraft.length, 240);
      const input = new Float64Array(count * 4);
      for (let index = 0; index < count; index += 1) {
        const item = aircraft[index];
        input[index * 4] = item.lat;
        input[index * 4 + 1] = item.lng;
        input[index * 4 + 2] = item.track ?? Number.NaN;
        input[index * 4 + 3] = item.speed ?? 0;
      }
      const inputAlloc = copyIn(input);
      const outputBytes = count * 25 * 8;
      const outputPtr = exports.wasm_alloc(outputBytes);
      try {
        const written = exports.aircraft_tracks(inputAlloc.ptr, count, outputPtr);
        const values = new Float64Array(exports.memory.buffer, outputPtr, written * 25);
        const tracks: AircraftTrackGeometry[] = [];
        for (let row = 0; row < written; row += 1) {
          const base = row * 25;
          const points: [number, number, number][] = [];
          for (let step = 0; step < 8; step += 1) {
            points.push([values[base + 1 + step * 3], values[base + 2 + step * 3], values[base + 3 + step * 3]]);
          }
          tracks.push({ sourceIndex: values[base], points });
        }
        return tracks;
      } finally {
        exports.wasm_dealloc(inputAlloc.ptr, inputAlloc.bytes);
        exports.wasm_dealloc(outputPtr, outputBytes);
      }
    },

    prepareIncidentEvents(events) {
      if (incidentSource === events && incidentStore !== 0) return incidentPriorityOrder;
      if (events.length > MAX_INCIDENTS_FOR_WASM) {
        destroyIncidentStore();
        return null;
      }

      let inputAlloc: { ptr: number; bytes: number } | null = null;
      try {
        const priorityOrder = rankEventIndicesForRender(events);
        const input = new Float64Array(events.length * INCIDENT_INPUT_STRIDE_F64);
        const categoryCodes = new Map<string, number>();
        let nextCategoryCode = 1;
        for (const [priority, sourceIndex] of priorityOrder.entries()) {
          const event = events[sourceIndex];
          let categoryCode = categoryCodes.get(event.category);
          if (categoryCode === undefined) {
            categoryCode = nextCategoryCode;
            nextCategoryCode = nextCategoryCode < 0xffff_ffff ? nextCategoryCode + 1 : 1;
            categoryCodes.set(event.category, categoryCode);
          }
          const offset = sourceIndex * INCIDENT_INPUT_STRIDE_F64;
          input[offset] = event.lat;
          input[offset + 1] = event.lng;
          input[offset + 2] = event.intensity;
          input[offset + 3] = event.occurredAt;
          input[offset + 4] = INCIDENT_CATEGORY_GROUP_MASKS[event.categoryGroup] ?? 0;
          input[offset + 5] = categoryCode;
          input[offset + 6] = severityRank(event);
          input[offset + 7] = priority;
        }

        inputAlloc = copyIn(input);
        // Destroy before creating the replacement so same-size snapshot refreshes reuse the
        // allocator's existing linear-memory pages instead of growing the memory every cycle.
        // Keeping the old store is not a valid fallback: its indices would denote stale rows.
        destroyIncidentStore();
        const nextStore = exports.incident_store_create(inputAlloc.ptr, events.length);
        if (nextStore === 0) return null;
        incidentStore = nextStore;
        incidentStoreLength = events.length;
        incidentSource = events;
        incidentPriorityOrder = priorityOrder;
        return priorityOrder;
      } catch {
        destroyIncidentStore();
        return null;
      } finally {
        if (inputAlloc) exports.wasm_dealloc(inputAlloc.ptr, inputAlloc.bytes);
      }
    },

    incidentStoreMatches(events) {
      return incidentStore !== 0 && incidentSource === events;
    },

    queryIncidentViewport(options) {
      if (incidentStore === 0) return null;
      try {
        const cap = finiteStoreCap(options.cap, incidentStoreLength);
        const radius = options.radiusDegrees === null ? Number.NaN : options.radiusDegrees;
        const written = exports.incident_store_query_viewport(
          incidentStore,
          options.focusLat,
          options.focusLng,
          radius,
          cap,
          (options.categoryMask ?? 0) >>> 0,
          options.timeStart ?? Number.NaN,
          options.timeEndExclusive ?? Number.NaN,
        );
        const outputPtr = exports.incident_store_output_ptr(incidentStore);
        if (outputPtr === 0 || outputPtr % 4 !== 0) return null;
        const words = new Uint32Array(exports.memory.buffer, outputPtr, written + INCIDENT_OUTPUT_HEADER_U32S);
        if (
          words[3] !== written
          || words[4] !== incidentStoreLength
          || words[5] !== INCIDENT_OUTPUT_ABI_VERSION
          || words[0] + words[1] > incidentStoreLength
        ) return null;

        const definiteSpatial = words[0];
        const uncertainSpatial = words[1];
        const definiteFiltered = words[2];

        // The common path has no rows in the floating-point uncertainty skin. Its page is already
        // exact and can be returned as a zero-copy view without even compacting flags in place.
        if (uncertainSpatial === 0) {
          return {
            indices: words.subarray(INCIDENT_OUTPUT_HEADER_U32S, INCIDENT_OUTPUT_HEADER_U32S + written),
            viewportCandidates: definiteSpatial,
            outsideViewport: incidentStoreLength - definiteSpatial,
            filteredMatches: definiteFiltered,
            written,
          };
        }
        if (!incidentSource) return null;

        // Rust marks rows whose distance is within its conservative libm/rounding skin, plus all
        // finite out-of-range coordinates and hostile focus/radius rows. Adjudicate only those
        // compact flagged entries with the canonical JavaScript metric. Accepted indices are
        // compacted in place inside the reusable WASM output arena, so even this exactness path
        // does not serialize incident rows or allocate a per-query JS index array.
        let exactWritten = 0;
        let acceptedBoundary = 0;
        let acceptedBoundaryFiltered = 0;
        for (let read = 0; read < written; read += 1) {
          const encoded = words[INCIDENT_OUTPUT_HEADER_U32S + read];
          const sourceIndex = encoded & INCIDENT_OUTPUT_INDEX_MASK;
          if (sourceIndex >= incidentStoreLength) return null;
          const isBoundary = (encoded & INCIDENT_OUTPUT_BOUNDARY_FLAG) !== 0;
          const filterPasses = (encoded & INCIDENT_OUTPUT_FILTER_PASS_FLAG) !== 0;

          if (!isBoundary) {
            // Definite rows are emitted only when they pass the optional filter; they are raw
            // source indices without flag bits.
            if (exactWritten < cap) {
              words[INCIDENT_OUTPUT_HEADER_U32S + exactWritten] = sourceIndex;
              exactWritten += 1;
            }
            continue;
          }

          const event = incidentSource[sourceIndex];
          if (!event) return null;
          const spatialPasses = options.radiusDegrees === null
            || viewportDistanceDegrees(event.lat, event.lng, options.focusLat, options.focusLng) <= options.radiusDegrees;
          if (!spatialPasses) continue;
          acceptedBoundary += 1;
          if (!filterPasses) continue;
          acceptedBoundaryFiltered += 1;
          if (exactWritten < cap) {
            words[INCIDENT_OUTPUT_HEADER_U32S + exactWritten] = sourceIndex;
            exactWritten += 1;
          }
        }

        const viewportCandidates = definiteSpatial + acceptedBoundary;
        if (viewportCandidates > incidentStoreLength) return null;
        return {
          indices: words.subarray(INCIDENT_OUTPUT_HEADER_U32S, INCIDENT_OUTPUT_HEADER_U32S + exactWritten),
          viewportCandidates,
          outsideViewport: incidentStoreLength - viewportCandidates,
          filteredMatches: definiteFiltered + acceptedBoundaryFiltered,
          written: exactWritten,
        };
      } catch {
        // A trap or memory-contract failure must never corrupt operator rendering. Drop the
        // store so subsequent frames deterministically use the JavaScript implementation.
        destroyIncidentStore();
        return null;
      }
    },

    incidentStoreMemoryBytes() {
      return incidentStore === 0 ? 0 : exports.incident_store_memory_bytes(incidentStore);
    },

    wasmMemoryBytes() {
      return exports.memory.buffer.byteLength;
    },
  };
}

/** Instantiate a core directly from bytes; exported so deterministic harnesses test the exact production wrapper. */
export async function instantiateGodseyeWasmCore(bytes: ArrayBuffer): Promise<GodseyeWasmCore | null> {
  try {
    const { instance } = await WebAssembly.instantiate(bytes);
    return createCore(instance.exports as unknown as WasmExports);
  } catch {
    return null;
  }
}

let corePromise: Promise<GodseyeWasmCore | null> | null = null;

export function loadGodseyeWasm(): Promise<GodseyeWasmCore | null> {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    try {
      const response = await fetch(assetPath("/wasm/godseye-core.wasm"));
      if (!response.ok) return null;
      return await instantiateGodseyeWasmCore(await response.arrayBuffer());
    } catch {
      return null;
    }
  })();
  return corePromise;
}
