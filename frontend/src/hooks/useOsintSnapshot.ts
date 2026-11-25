"use client";

import { useEffect, useState } from "react";
import type { OsintSnapshot } from "@/types/conflict";
import { assetPath } from "@/lib/assets";

const EMPTY_SNAPSHOT: OsintSnapshot = {
  fetchedAt: "",
  sources: {},
  militaryAircraft: [],
  news: [],
  launches: [],
  naturalEvents: [],
  gpsInterference: [],
  mapOfWarsEvents: [],
  webcams: [],
  errors: [],
};

export function useOsintSnapshot(): OsintSnapshot {
  const [snapshot, setSnapshot] = useState<OsintSnapshot>(EMPTY_SNAPSHOT);
  useEffect(() => {
    let cancelled = false;
    fetch(assetPath("/data/osint-snapshot.json"), { cache: "no-store" })
      .then((response) => response.ok ? response.json() : EMPTY_SNAPSHOT)
      .then((payload) => { if (!cancelled) setSnapshot({ ...EMPTY_SNAPSHOT, ...payload }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return snapshot;
}
