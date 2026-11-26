"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  createGlobeRenderStatusStore,
  type GlobeRenderStatusStore,
  type GodEyeRenderStatus,
} from "@/lib/globeRendering";

export function useGlobeRenderStatusStore(): GlobeRenderStatusStore {
  return useMemo(() => createGlobeRenderStatusStore(), []);
}

export function useGlobeRenderStatus(store: GlobeRenderStatusStore | null | undefined): GodEyeRenderStatus | null {
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => false),
    () => store?.getSnapshot() ?? null,
    () => null,
  );
}
