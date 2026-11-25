import { assetPath } from "@/lib/assets";
import type { ConflictEvent, MilitaryAircraft } from "@/types/conflict";

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc(size: number): number;
  wasm_dealloc(ptr: number, size: number): void;
  select_regional_events(input: number, len: number, focusLat: number, focusLng: number, altitude: number, output: number, cap: number): number;
  aircraft_tracks(input: number, len: number, output: number): number;
}

export interface AircraftTrackGeometry {
  sourceIndex: number;
  points: [number, number, number][];
}

export interface GodseyeWasmCore {
  selectRegionalEvents(events: ConflictEvent[], focusLat: number, focusLng: number, altitude: number): number[];
  aircraftTrackGeometry(aircraft: MilitaryAircraft[]): AircraftTrackGeometry[];
}

let corePromise: Promise<GodseyeWasmCore | null> | null = null;

export function loadGodseyeWasm(): Promise<GodseyeWasmCore | null> {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    try {
      const response = await fetch(assetPath("/wasm/godseye-core.wasm"));
      if (!response.ok) return null;
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
      const exports = instance.exports as unknown as WasmExports;

      const copyIn = (values: Float64Array): { ptr: number; bytes: number } => {
        const bytes = values.byteLength;
        const ptr = exports.wasm_alloc(bytes);
        new Float64Array(exports.memory.buffer, ptr, values.length).set(values);
        return { ptr, bytes };
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
            input[offset + 4] = event.severity === "critical" ? 4 : event.severity === "high" ? 3 : event.severity === "medium" ? 2 : 1;
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
      };
    } catch {
      return null;
    }
  })();
  return corePromise;
}
