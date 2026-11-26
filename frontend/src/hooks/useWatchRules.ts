"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { WatchAlert, WatchAlertState, WatchRule } from "@/types/conflict";
import {
  normalizeWatchAlertStateMap,
  normalizeWatchRule,
  normalizeWatchRules,
} from "@/lib/watchRules";

/**
 * Static local storage for analyst watch rules and alert lifecycle state. There is no
 * backend, account, sync service, or browser-notification side effect: rules remain in this
 * browser/profile. Storage is versioned and fail-open to in-memory state if localStorage is
 * unavailable or quota-limited, with the status surfaced instead of silently losing rules.
 */

export const WATCH_RULES_STORAGE_KEY = "godseye.watch-rules.v1";
export const WATCH_ALERT_STATE_STORAGE_KEY = "godseye.watch-alert-state.v1";

interface WatchStorageSnapshot {
  ready: boolean;
  rules: WatchRule[];
  alertStates: Record<string, WatchAlertState>;
  status: string | null;
}

const SERVER_SNAPSHOT: WatchStorageSnapshot = {
  ready: false,
  rules: [],
  alertStates: {},
  status: null,
};

let cachedKey: string | null = null;
let cachedMemorySource: { rules: WatchRule[]; alertStates: Record<string, WatchAlertState> } | null = null;
let cachedSnapshot: WatchStorageSnapshot = SERVER_SNAPSHOT;
let writeStatus: string | null = null;
let memoryFallback: { rules: WatchRule[]; alertStates: Record<string, WatchAlertState> } | null = null;
const listeners = new Set<() => void>();

function safeGetItem(key: string): { value: string | null; error: string | null } {
  try {
    return { value: window.localStorage.getItem(key), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "localStorage read unavailable" };
  }
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readStorageSnapshot(): WatchStorageSnapshot {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (memoryFallback) {
    if (cachedMemorySource === memoryFallback) return cachedSnapshot;
    cachedMemorySource = memoryFallback;
    cachedSnapshot = {
      ready: true,
      rules: memoryFallback.rules,
      alertStates: memoryFallback.alertStates,
      status: writeStatus ?? "localStorage unavailable; watch rules are in memory for this tab only",
    };
    return cachedSnapshot;
  }
  cachedMemorySource = null;

  const rulesRead = safeGetItem(WATCH_RULES_STORAGE_KEY);
  const statesRead = safeGetItem(WATCH_ALERT_STATE_STORAGE_KEY);
  const cacheKey = `${rulesRead.value ?? ""}\u0000${statesRead.value ?? ""}\u0000${rulesRead.error ?? ""}\u0000${statesRead.error ?? ""}\u0000${writeStatus ?? ""}`;
  if (cachedKey === cacheKey) return cachedSnapshot;

  const rulesJson = parseJson(rulesRead.value);
  const statesJson = parseJson(statesRead.value);
  const parseErrors: string[] = [];
  if (rulesJson === undefined) parseErrors.push("stored watch-rule JSON is malformed and was ignored");
  if (statesJson === undefined) parseErrors.push("stored alert-state JSON is malformed and was ignored");
  if (rulesRead.error) parseErrors.push(`rule storage read failed: ${rulesRead.error}`);
  if (statesRead.error) parseErrors.push(`alert-state storage read failed: ${statesRead.error}`);

  cachedKey = cacheKey;
  cachedSnapshot = {
    ready: true,
    rules: normalizeWatchRules(rulesJson),
    alertStates: normalizeWatchAlertStateMap(statesJson),
    status: writeStatus ?? (parseErrors.length > 0 ? parseErrors.join("; ") : null),
  };
  return cachedSnapshot;
}

function notifyListeners(): void {
  cachedKey = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === WATCH_RULES_STORAGE_KEY || event.key === WATCH_ALERT_STATE_STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getClientSnapshot(): WatchStorageSnapshot {
  return readStorageSnapshot();
}

function getServerSnapshot(): WatchStorageSnapshot {
  return SERVER_SNAPSHOT;
}

function persistSnapshot(rules: WatchRule[], alertStates: Record<string, WatchAlertState>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WATCH_RULES_STORAGE_KEY, JSON.stringify(rules));
    window.localStorage.setItem(WATCH_ALERT_STATE_STORAGE_KEY, JSON.stringify(alertStates));
    writeStatus = null;
    memoryFallback = null;
  } catch (error) {
    writeStatus = `localStorage write failed; changes are in memory for this tab only (${error instanceof Error ? error.message : "unavailable"})`;
    memoryFallback = { rules, alertStates };
  }
  notifyListeners();
}

function updateStoredSnapshot(update: (current: WatchStorageSnapshot) => { rules: WatchRule[]; alertStates: Record<string, WatchAlertState> }): void {
  const current = readStorageSnapshot();
  const next = update(current);
  persistSnapshot(next.rules, next.alertStates);
}

export interface WatchRuleStore {
  ready: boolean;
  rules: WatchRule[];
  alertStates: Record<string, WatchAlertState>;
  status: string | null;
  upsertRule: (rule: WatchRule) => void;
  toggleRule: (ruleId: string) => void;
  dismissAlert: (alert: WatchAlert) => void;
  snoozeAlert: (alert: WatchAlert, hours: number) => void;
  restoreAlert: (alert: WatchAlert) => void;
}

export function useWatchRules(): WatchRuleStore {
  const snapshot = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  const upsertRule = useCallback((rule: WatchRule) => {
    updateStoredSnapshot((current) => {
      const now = Date.now();
      const normalized = normalizeWatchRule({ ...rule, updatedAt: now });
      if (!normalized) return { rules: current.rules, alertStates: current.alertStates };
      const index = current.rules.findIndex((item) => item.id === normalized.id);
      const rules = [...current.rules];
      if (index >= 0) rules[index] = normalized;
      else rules.push(normalized);
      rules.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return { rules, alertStates: current.alertStates };
    });
  }, []);

  const toggleRule = useCallback((ruleId: string) => {
    updateStoredSnapshot((current) => ({
      rules: current.rules.map((rule) => rule.id === ruleId ? { ...rule, enabled: !rule.enabled, updatedAt: Date.now() } : rule),
      alertStates: current.alertStates,
    }));
  }, []);

  const dismissAlert = useCallback((alert: WatchAlert) => {
    updateStoredSnapshot((current) => {
      const now = Date.now();
      const existing = current.alertStates[alert.fingerprint];
      return {
        rules: current.rules,
        alertStates: {
          ...current.alertStates,
          [alert.fingerprint]: {
            fingerprint: alert.fingerprint,
            ruleId: alert.ruleId,
            firstSeenAt: existing?.firstSeenAt || alert.triggeredAt,
            lastSeenAt: now,
            dismissedAt: now,
            snoozedUntil: null,
          },
        },
      };
    });
  }, []);

  const snoozeAlert = useCallback((alert: WatchAlert, hours: number) => {
    updateStoredSnapshot((current) => {
      const now = Date.now();
      const boundedHours = Math.min(24 * 30, Math.max(1, hours));
      const existing = current.alertStates[alert.fingerprint];
      return {
        rules: current.rules,
        alertStates: {
          ...current.alertStates,
          [alert.fingerprint]: {
            fingerprint: alert.fingerprint,
            ruleId: alert.ruleId,
            firstSeenAt: existing?.firstSeenAt || alert.triggeredAt,
            lastSeenAt: now,
            dismissedAt: null,
            snoozedUntil: now + boundedHours * 36e5,
          },
        },
      };
    });
  }, []);

  const restoreAlert = useCallback((alert: WatchAlert) => {
    updateStoredSnapshot((current) => {
      const now = Date.now();
      const existing = current.alertStates[alert.fingerprint];
      return {
        rules: current.rules,
        alertStates: {
          ...current.alertStates,
          [alert.fingerprint]: {
            fingerprint: alert.fingerprint,
            ruleId: alert.ruleId,
            firstSeenAt: existing?.firstSeenAt || alert.triggeredAt,
            lastSeenAt: now,
            dismissedAt: null,
            snoozedUntil: null,
          },
        },
      };
    });
  }, []);

  return {
    ready: snapshot.ready,
    rules: snapshot.rules,
    alertStates: snapshot.alertStates,
    status: snapshot.status,
    upsertRule,
    toggleRule,
    dismissAlert,
    snoozeAlert,
    restoreAlert,
  };
}
