"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConflictEvents } from "@/lib/conflictData";
import type { ConflictEvent } from "@/types/conflict";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

interface ConflictEventsState {
  events: ConflictEvent[];
  source: "live" | "fallback" | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  refresh: () => Promise<void>;
}

export function useConflictEvents(snapshotEvents: ConflictEvent[] = []): ConflictEventsState {
  const [events, setEvents] = useState<ConflictEvent[]>([]);
  const [source, setSource] = useState<"live" | "fallback" | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    setRefreshing(true);
    try {
      const result = await loadConflictEvents(snapshotEvents);
      if (!mountedRef.current || requestId !== requestSeqRef.current) return;
      setEvents(result.events);
      setSource(result.source);
      setError(result.error);
      setLastUpdated(result.fetchedAt);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Unable to refresh conflict intelligence");
    } finally {
      if (!mountedRef.current || requestId !== requestSeqRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [snapshotEvents]);

  useEffect(() => {
    mountedRef.current = true;
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const interval = paused ? 0 : window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refresh, paused]);

  return { events, source, loading, refreshing, error, lastUpdated, paused, setPaused, refresh };
}
