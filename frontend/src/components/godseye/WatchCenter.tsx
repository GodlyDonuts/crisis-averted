"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Binoculars,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  CategoryGroup,
  ConflictEvent,
  EscalationSignal,
  EscalationSignalLevel,
  EscalationSurgeAnalysis,
  SeverityKey,
  WatchAlert,
  WatchAlertState,
  WatchEvaluationResult,
  WatchRule,
  WatchRuleConditionKind,
  WatchRuleTimeWindow,
} from "@/types/conflict";
import { buildSurgeAnalystSummary, formatRatioBounds } from "@/lib/escalationSurge";
import {
  buildWatchAlertSummary,
  createDefaultWatchRule,
  describeWatchRule,
  getWatchAlertLifecycle,
  normalizeWatchRule,
  presetForKind,
  WATCH_CONDITION_PRESETS,
  type WatchAlertLifecycle,
} from "@/lib/watchRules";
import { CATEGORY_GROUP_META, formatCompact, SEVERITY_META } from "@/lib/conflictData";

interface SelectOption {
  value: string;
  label: string;
}

interface WatchCenterProps {
  events: ConflictEvent[];
  surgeAnalysis: EscalationSurgeAnalysis;
  evaluation: WatchEvaluationResult;
  rules: WatchRule[];
  alertStates: Record<string, WatchAlertState>;
  storageReady: boolean;
  storageStatus: string | null;
  onUpsertRule: (rule: WatchRule) => void;
  onToggleRule: (ruleId: string) => void;
  onDismissAlert: (alert: WatchAlert) => void;
  onSnoozeAlert: (alert: WatchAlert, hours: number) => void;
  onRestoreAlert: (alert: WatchAlert) => void;
  onSelectEvent: (event: ConflictEvent) => void;
  onFocusTheater: (theaterSlug: string) => void;
  onClose: () => void;
}

type WatchTab = "alerts" | "surge" | "rules";

const SIGNAL_META: Record<EscalationSignalLevel, { label: string; text: string; border: string; bg: string }> = {
  "surge-indicator": {
    label: "Surge indicator",
    text: "text-red-100",
    border: "border-red-300/28",
    bg: "bg-red-400/[0.09]",
  },
  "watch-indicator": {
    label: "Watch indicator",
    text: "text-amber-100",
    border: "border-amber-200/26",
    bg: "bg-amber-300/[0.08]",
  },
  "uncertain-change": {
    label: "Uncertain change",
    text: "text-sky-100",
    border: "border-sky-200/22",
    bg: "bg-sky-300/[0.07]",
  },
  "no-signal": {
    label: "No signal",
    text: "text-white/45",
    border: "border-white/10",
    bg: "bg-white/[0.03]",
  },
  "insufficient-evidence": {
    label: "Insufficient evidence",
    text: "text-white/38",
    border: "border-white/10",
    bg: "bg-white/[0.025]",
  },
};

function utcIso(timestamp: number): string {
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown";
}

function downloadFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("clipboard unavailable");
}

function exportAlerts(
  alerts: WatchAlert[],
  states: Record<string, WatchAlertState>,
  format: "json" | "csv",
  now: number,
): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  if (format === "json") {
    const payload = {
      exportedAt: new Date().toISOString(),
      caveat: "Local analyst watch alerts: statistical triggers, not predictions or verified operational warnings.",
      alerts: alerts.map((alert) => ({
        ...alert,
        lifecycle: getWatchAlertLifecycle(alert, states[alert.fingerprint], now),
      })),
    };
    downloadFile(`godseye-watch-alerts-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
    return;
  }
  const header = [
    "fingerprint", "rule", "condition", "emphasis", "lifecycle", "triggered_utc", "window_start_utc", "window_end_exclusive_utc",
    "definite_incidents", "possible_incidents", "boundary_ambiguous", "summary", "explanations", "evidence_event_ids", "evidence_member_ids", "source_references", "surge_signal_ids", "disclaimer",
  ];
  const rows = alerts.map((alert) => [
    alert.fingerprint,
    alert.ruleName,
    alert.conditionKind,
    alert.emphasis,
    getWatchAlertLifecycle(alert, states[alert.fingerprint], now),
    new Date(alert.triggeredAt).toISOString(),
    new Date(alert.window.start).toISOString(),
    new Date(alert.window.endExclusive).toISOString(),
    alert.definiteIncidentCount,
    alert.possibleIncidentCount,
    alert.boundaryAmbiguousCount,
    alert.summary,
    alert.explanations.join(" | "),
    alert.evidenceRefs.map((ref) => ref.eventId).join(" | "),
    alert.evidenceRefs.flatMap((ref) => ref.evidenceMemberEventIds).join(" | "),
    alert.evidenceRefs.map((ref) => `${ref.sourceName ?? "source unavailable"} ${ref.sourceUrl ?? ""}`.trim()).join(" | "),
    alert.surgeSignalIds.join(" | "),
    alert.disclaimer,
  ].map(csvCell).join(","));
  downloadFile(`godseye-watch-alerts-${stamp}.csv`, [header.map(csvCell).join(","), ...rows].join("\n"), "text/csv");
}

function exportSurgeSignals(signals: EscalationSignal[]): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const payload = {
    exportedAt: new Date().toISOString(),
    caveat: "Escalation-surge output is a statistical indicator of change inside the loaded corpus, not a prediction or operational warning.",
    signals,
  };
  downloadFile(`godseye-surge-indicators-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function optionListWithCurrent(options: SelectOption[], current: string | null): SelectOption[] {
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: `${current} (not in current corpus)` }, ...options];
}

interface RuleBuilderProps {
  draft: WatchRule;
  theaterOptions: SelectOption[];
  regionOptions: SelectOption[];
  countryOptions: SelectOption[];
  categoryOptions: SelectOption[];
  onChange: (rule: WatchRule) => void;
  onSave: () => void;
  onCancel: () => void;
}

function RuleBuilder({
  draft,
  theaterOptions,
  regionOptions,
  countryOptions,
  categoryOptions,
  onChange,
  onSave,
  onCancel,
}: RuleBuilderProps) {
  const preset = presetForKind(draft.condition.kind);
  const patchFilters = (patch: Partial<WatchRule["filters"]>) => {
    onChange({ ...draft, filters: { ...draft.filters, ...patch } });
  };
  const patchCondition = (patch: Partial<WatchRule["condition"]>) => {
    onChange({ ...draft, condition: { ...draft.condition, ...patch } });
  };
  const toggleCategoryGroup = (group: CategoryGroup) => {
    const next = draft.filters.categoryGroups.includes(group)
      ? draft.filters.categoryGroups.filter((item) => item !== group)
      : [...draft.filters.categoryGroups, group];
    patchFilters({ categoryGroups: next });
  };
  const toggleSeverity = (severity: SeverityKey) => {
    const next = draft.filters.severities.includes(severity)
      ? draft.filters.severities.filter((item) => item !== severity)
      : [...draft.filters.severities, severity];
    patchFilters({ severities: next });
  };

  return (
    <form
      className="space-y-3 border-b border-white/8 bg-white/[0.025] px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-white/88">Watch-rule builder</h3>
          <p className="mt-1 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/30">
            constrained presets · transparent deterministic triggers
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-white/10 text-white/44 transition hover:border-white/24 hover:text-white"
          aria-label="Cancel watch-rule editing"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="block">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/36">Rule name</span>
        <input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[12px] text-white/84 outline-none transition focus:border-amber-200/35"
          placeholder="e.g. Ukraine kinetic casualty watch"
        />
      </label>

      <label className="block">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/36">Condition preset</span>
        <select
          value={draft.condition.kind}
          onChange={(event) => {
            const kind = event.target.value as WatchRuleConditionKind;
            const nextPreset = presetForKind(kind);
            onChange({
              ...draft,
              condition: {
                ...draft.condition,
                kind,
                threshold: nextPreset.defaultThreshold,
                window: nextPreset.defaultWindow,
              },
            });
          }}
          className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[12px] text-white/84 outline-none transition focus:border-amber-200/35"
        >
          {WATCH_CONDITION_PRESETS.map((option) => (
            <option key={option.kind} value={option.kind}>{option.label}</option>
          ))}
        </select>
      </label>
      <p className="font-mono text-[9px] leading-relaxed tracking-[0.04em] text-white/32">{preset.description}</p>

      <div className="grid grid-cols-2 gap-2">
        {draft.condition.kind !== "surge-level" ? (
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/36">{preset.thresholdLabel}</span>
            <input
              type="number"
              min={preset.minThreshold}
              max={preset.maxThreshold}
              step={preset.step}
              value={draft.condition.threshold}
              onChange={(event) => patchCondition({ threshold: Number(event.target.value) })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[12px] text-white/84 outline-none transition focus:border-amber-200/35"
            />
          </label>
        ) : (
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/36">Minimum signal</span>
            <select
              value={draft.condition.surgeLevel}
              onChange={(event) => patchCondition({ surgeLevel: event.target.value as WatchRule["condition"]["surgeLevel"] })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[12px] text-white/84 outline-none transition focus:border-amber-200/35"
            >
              <option value="watch-indicator">watch or surge</option>
              <option value="surge-indicator">surge only</option>
            </select>
          </label>
        )}

        {preset.usesWindow ? (
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/36">Trailing window</span>
            <select
              value={draft.condition.window}
              onChange={(event) => patchCondition({ window: event.target.value as WatchRuleTimeWindow })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[12px] text-white/84 outline-none transition focus:border-amber-200/35"
            >
              <option value="24h">24 hours</option>
              <option value="72h">72 hours</option>
              <option value="7d">7 days</option>
            </select>
          </label>
        ) : (
          <div className="rounded-sm border border-white/8 px-2 py-1.5 font-mono text-[9px] uppercase leading-relaxed tracking-[0.08em] text-white/30">
            uses fixed 72h surge window + 21d baseline
          </div>
        )}
      </div>

      <fieldset className="space-y-2 rounded-sm border border-white/8 px-2 py-2">
        <legend className="px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/36">Scope filters</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">Theater</span>
            <select
              value={draft.filters.theater ?? ""}
              onChange={(event) => patchFilters({ theater: event.target.value || null })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[11px] text-white/78 outline-none focus:border-amber-200/35"
            >
              <option value="">All theaters</option>
              {optionListWithCurrent(theaterOptions, draft.filters.theater).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">Region</span>
            <select
              value={draft.filters.region ?? ""}
              onChange={(event) => patchFilters({ region: event.target.value || null })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[11px] text-white/78 outline-none focus:border-amber-200/35"
            >
              <option value="">All regions</option>
              {optionListWithCurrent(regionOptions, draft.filters.region).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">Country</span>
            <select
              value={draft.filters.country ?? ""}
              onChange={(event) => patchFilters({ country: event.target.value || null })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[11px] text-white/78 outline-none focus:border-amber-200/35"
            >
              <option value="">All countries</option>
              {optionListWithCurrent(countryOptions, draft.filters.country).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">Category</span>
            <select
              value={draft.filters.category ?? ""}
              onChange={(event) => patchFilters({ category: event.target.value || null })}
              className="mt-1 h-8 w-full rounded-sm border border-white/10 bg-black/24 px-2 text-[11px] text-white/78 outline-none focus:border-amber-200/35"
            >
              <option value="">All categories</option>
              {optionListWithCurrent(categoryOptions, draft.filters.category).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">Category groups (none selected = all)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.keys(CATEGORY_GROUP_META) as CategoryGroup[]).map((group) => {
              const active = draft.filters.categoryGroups.includes(group);
              return (
                <button
                  key={group}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleCategoryGroup(group)}
                  className={`rounded-sm border px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] transition ${active ? "border-amber-200/26 bg-amber-300/[0.09] text-amber-100" : "border-white/8 bg-white/[0.02] text-white/34 hover:text-white/60"}`}
                >
                  {CATEGORY_GROUP_META[group].label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">Severities (none selected = all)</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.keys(SEVERITY_META) as SeverityKey[]).map((severity) => {
              const active = draft.filters.severities.includes(severity);
              return (
                <button
                  key={severity}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleSeverity(severity)}
                  className={`rounded-sm border px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] transition ${active ? "border-white/24 bg-white/[0.07] text-white/84" : "border-white/8 bg-white/[0.02] text-white/34 hover:text-white/60"}`}
                >
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ backgroundColor: SEVERITY_META[severity].color }} />
                  {SEVERITY_META[severity].label}
                </button>
              );
            })}
          </div>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-white/54">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
          className="h-3.5 w-3.5 accent-amber-300"
        />
        Rule enabled
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-sm border border-white/10 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/44 transition hover:border-white/20 hover:text-white/74"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 rounded-sm border border-amber-200/30 bg-amber-300/[0.12] px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/[0.18]"
        >
          Save local rule
        </button>
      </div>
    </form>
  );
}

interface AlertCardProps {
  alert: WatchAlert;
  lifecycle: WatchAlertLifecycle;
  state: WatchAlertState | undefined;
  eventsById: Map<string, ConflictEvent>;
  onCopy: (text: string, label: string) => void;
  onDismiss: (alert: WatchAlert) => void;
  onSnooze: (alert: WatchAlert, hours: number) => void;
  onRestore: (alert: WatchAlert) => void;
  onSelectEvent: (event: ConflictEvent) => void;
}

function WatchAlertCard({
  alert,
  lifecycle,
  state,
  eventsById,
  onCopy,
  onDismiss,
  onSnooze,
  onRestore,
  onSelectEvent,
}: AlertCardProps) {
  const suppressed = lifecycle !== "active";
  return (
    <article className={`border-b border-white/8 px-3 py-3 ${alert.emphasis === "elevated" ? "bg-red-400/[0.045]" : "bg-amber-300/[0.028]"} ${suppressed ? "opacity-68" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
            <span className={`rounded-sm border px-1.5 py-0.5 ${alert.emphasis === "elevated" ? "border-red-300/28 bg-red-400/[0.09] text-red-100" : "border-amber-200/22 bg-amber-300/[0.07] text-amber-100/82"}`}>
              {alert.emphasis} emphasis
            </span>
            <span className="rounded-sm border border-white/10 bg-white/[0.035] px-1.5 py-0.5 text-white/42">{lifecycle}</span>
          </div>
          <h3 className="mt-1.5 text-[13px] font-semibold leading-snug text-white/88">{alert.title}</h3>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">triggered {utcIso(alert.triggeredAt)}</p>
        </div>
        <button
          type="button"
          onClick={() => onCopy(buildWatchAlertSummary(alert), "alert summary")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/44 transition hover:border-white/24 hover:text-white"
          aria-label={`Copy evidence summary for ${alert.ruleName}`}
          title="Copy evidence summary"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-white/62">{alert.summary}</p>

      <details className="mt-2 rounded-sm border border-white/8 bg-black/16 px-2 py-1.5">
        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-amber-100/58">Why this triggered</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-white/56">
          {alert.explanations.map((line) => <li key={line}>{line}</li>)}
        </ol>
      </details>

      <details className="mt-2 rounded-sm border border-white/8 bg-black/16 px-2 py-1.5">
        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-amber-100/58">
          Evidence references ({alert.evidenceRefs.length})
        </summary>
        <div className="mt-2 space-y-1.5">
          {alert.evidenceRefs.map((ref) => {
            const event = eventsById.get(ref.eventId) ?? null;
            return (
              <div key={`${alert.fingerprint}-${ref.eventId}`} className="rounded-sm border border-white/8 bg-white/[0.025] px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={!event}
                    onClick={() => { if (event) onSelectEvent(event); }}
                    className="min-w-0 flex-1 text-left text-[11px] leading-snug text-white/72 transition enabled:hover:text-amber-100 disabled:opacity-60"
                  >
                    <span className="block truncate">{ref.title}</span>
                    <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-[0.08em] text-white/30">
                      {ref.eventId} · {ref.temporalMembership} · {ref.independentFamilyCount} families · casualty {formatCompact(ref.casualtyMeasure)}
                    </span>
                  </button>
                  {ref.sourceUrl ? (
                    <a
                      href={ref.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/38 transition hover:border-sky-200/25 hover:text-sky-100"
                      aria-label={`Open source for ${ref.title}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </details>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {lifecycle === "active" ? (
          <>
            <button
              type="button"
              onClick={() => onSnooze(alert, 1)}
              className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
            >
              Snooze 1h
            </button>
            <button
              type="button"
              onClick={() => onSnooze(alert, 24)}
              className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
            >
              Snooze 24h
            </button>
            <button
              type="button"
              onClick={() => onDismiss(alert)}
              className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-red-300/24 hover:text-red-100/82"
            >
              Dismiss
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onRestore(alert)}
            className="flex items-center gap-1 rounded-sm border border-emerald-200/20 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-emerald-100/70 transition hover:border-emerald-200/34"
          >
            <RotateCcw className="h-3 w-3" /> Restore
          </button>
        )}
        {state?.snoozedUntil && lifecycle === "snoozed" ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/30">until {utcIso(state.snoozedUntil)}</span>
        ) : null}
      </div>
    </article>
  );
}

interface SurgeSignalCardProps {
  signal: EscalationSignal;
  eventsById: Map<string, ConflictEvent>;
  onCopy: (text: string, label: string) => void;
  onSelectEvent: (event: ConflictEvent) => void;
  onFocusTheater: (theaterSlug: string) => void;
}

function SurgeSignalCard({ signal, eventsById, onCopy, onSelectEvent, onFocusTheater }: SurgeSignalCardProps) {
  const meta = SIGNAL_META[signal.level];
  return (
    <article className={`border-b border-white/8 px-3 py-3 ${meta.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em]">
            <span className={`rounded-sm border px-1.5 py-0.5 ${meta.border} ${meta.text}`}>{meta.label}</span>
            <span className="rounded-sm border border-white/10 bg-black/16 px-1.5 py-0.5 text-white/38">{signal.groupKind}</span>
          </div>
          <h3 className="mt-1.5 truncate text-[13px] font-semibold text-white/88">{signal.groupLabel}</h3>
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] text-white/44">
          <p>idx {signal.indicatorScore}</p>
          <p className="mt-0.5 text-white/28">support {signal.evidenceSupport}</p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[9px] text-white/38">
        <span className="rounded-sm bg-black/18 px-1.5 py-1" title={`Feasible incident-rate acceleration bounds: ${formatRatioBounds(signal.metrics.incidentRateRatio)}`}>rate {Math.round(signal.rateScore * 100)}%</span>
        <span className="rounded-sm bg-black/18 px-1.5 py-1" title={`Feasible intensity acceleration bounds: ${formatRatioBounds(signal.metrics.intensityRatio)}`}>intensity {Math.round(signal.intensityScore * 100)}%</span>
        <span className="rounded-sm bg-black/18 px-1.5 py-1">corrob {Math.round(signal.corroborationScore * 100)}%</span>
        <span className="rounded-sm bg-black/18 px-1.5 py-1">novelty {Math.round(signal.noveltyScore * 100)}%</span>
      </div>

      <p className="mt-2 line-clamp-2 font-mono text-[9px] leading-relaxed text-white/34">{signal.explanations[0]}</p>

      <details className="mt-2 rounded-sm border border-white/8 bg-black/16 px-2 py-1.5">
        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.12em] text-amber-100/58">Metric explanation + evidence</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[11px] leading-relaxed text-white/56">
          {signal.explanations.map((line) => <li key={line}>{line}</li>)}
        </ol>
        {signal.uncertaintyNotes.length > 0 ? (
          <div className="mt-2 border-t border-white/8 pt-2">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-sky-100/52">Uncertainty notes</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-white/50">
              {signal.uncertaintyNotes.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="mt-2 space-y-1.5 border-t border-white/8 pt-2">
          {signal.evidenceRefs.map((ref) => {
            const event = eventsById.get(ref.eventId) ?? null;
            return (
              <button
                key={`${signal.id}-${ref.eventId}`}
                type="button"
                disabled={!event}
                onClick={() => { if (event) onSelectEvent(event); }}
                className="block w-full rounded-sm border border-white/8 bg-white/[0.025] px-2 py-1.5 text-left transition enabled:hover:border-amber-200/24 disabled:opacity-60"
              >
                <span className="block truncate text-[11px] text-white/72">{ref.title}</span>
                <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-[0.08em] text-white/30">
                  {ref.eventId} · {ref.temporalMembership} · {ref.independentFamilyCount} families · casualty {formatCompact(ref.casualtyMeasure)}
                </span>
              </button>
            );
          })}
        </div>
      </details>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onCopy(buildSurgeAnalystSummary(signal), "surge signal summary")}
          className="flex items-center gap-1 rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
        {signal.groupKind === "theater" ? (
          <button
            type="button"
            onClick={() => onFocusTheater(signal.groupKey)}
            className="rounded-sm border border-amber-200/18 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-amber-100/64 transition hover:border-amber-200/32 hover:text-amber-100"
          >
            Focus theater
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Combined surge/watch workbench. The panel intentionally uses in-app alerts only. It never
 * invokes the browser Notification API and never presents itself as an operational warning system.
 */
export function WatchCenter({
  events,
  surgeAnalysis,
  evaluation,
  rules,
  alertStates,
  storageReady,
  storageStatus,
  onUpsertRule,
  onToggleRule,
  onDismissAlert,
  onSnoozeAlert,
  onRestoreAlert,
  onSelectEvent,
  onFocusTheater,
  onClose,
}: WatchCenterProps) {
  const [activeTab, setActiveTab] = useState<WatchTab>("alerts");
  const [surgeScope, setSurgeScope] = useState<"all" | "theater" | "region">("all");
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [editingRule, setEditingRule] = useState<WatchRule | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.clearInterval(interval);
      if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const eventsById = useMemo(() => {
    const map = new Map<string, ConflictEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);

  const optionData = useMemo(() => {
    const theaters = new Map<string, string>();
    const regions = new Map<string, string>();
    const countries = new Map<string, string>();
    const categories = new Map<string, string>();
    for (const event of events) {
      if (event.theater && !theaters.has(event.theater)) theaters.set(event.theater, event.conflict || event.theater);
      if (event.region && !regions.has(event.region)) regions.set(event.region, event.region);
      if (event.country && !countries.has(event.country)) countries.set(event.country, event.country);
      if (event.category && !categories.has(event.category)) categories.set(event.category, event.category.replace(/_/g, " "));
    }
    const toOptions = (map: Map<string, string>) => [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
    return {
      theaters: toOptions(theaters),
      regions: toOptions(regions),
      countries: toOptions(countries),
      categories: toOptions(categories),
    };
  }, [events]);

  const evaluationByRuleId = useMemo(() => {
    const map = new Map<string, WatchEvaluationResult["evaluations"][number]>();
    for (const item of evaluation.evaluations) map.set(item.ruleId, item);
    return map;
  }, [evaluation.evaluations]);

  const alertRows = useMemo(() => evaluation.alerts.map((alert) => ({
    alert,
    state: alertStates[alert.fingerprint],
    lifecycle: getWatchAlertLifecycle(alert, alertStates[alert.fingerprint], now),
  })), [evaluation.alerts, alertStates, now]);
  const activeAlertCount = alertRows.filter((row) => row.lifecycle === "active").length;
  const visibleAlertRows = showSuppressed ? alertRows : alertRows.filter((row) => row.lifecycle === "active");

  const signalRows = useMemo(() => surgeAnalysis.signals
    .filter((signal) => signal.isSignal)
    .filter((signal) => surgeScope === "all" || signal.groupKind === surgeScope)
    .slice(0, 14), [surgeAnalysis.signals, surgeScope]);

  const copyText = useCallback((text: string, label: string) => {
    void writeClipboard(text)
      .then(() => setCopyNotice(`${label} copied`))
      .catch(() => setCopyNotice(`${label} copy failed — clipboard unavailable`));
    if (copyTimeoutRef.current !== null) window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => setCopyNotice(null), 2400);
  }, []);

  const startNewRule = useCallback(() => {
    const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    setEditingRule(createDefaultWatchRule(`local-watch-${Date.now().toString(36)}-${random}`, Date.now()));
    setActiveTab("rules");
  }, []);

  const saveEditingRule = useCallback(() => {
    if (!editingRule) return;
    const preset = presetForKind(editingRule.condition.kind);
    const fallbackName = `${preset.shortLabel} watch`;
    const normalized = normalizeWatchRule({
      ...editingRule,
      name: editingRule.name.trim() || fallbackName,
      updatedAt: Date.now(),
    });
    if (!normalized) return;
    onUpsertRule(normalized);
    setEditingRule(null);
  }, [editingRule, onUpsertRule]);

  const activeSignalCount = surgeAnalysis.signals.filter((signal) => signal.isSignal).length;

  return (
    <aside
      className="godseye-panel pointer-events-auto fixed inset-x-3 bottom-[172px] top-20 z-30 flex flex-col overflow-hidden xl:absolute xl:inset-x-auto xl:bottom-[172px] xl:right-4 xl:top-20 xl:w-[392px]"
      aria-labelledby="watch-center-title"
    >
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-100/42">Analyst watch</p>
          <h2 id="watch-center-title" className="mt-1 text-sm font-semibold text-white/92">Surge indicators + local rules</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/78" aria-live="polite">
            <Binoculars className="h-3 w-3" />
            {activeAlertCount} active
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
            aria-label="Close analyst watch center"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-white/8 px-4 py-2.5">
        <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/32">
          statistical indicators, not predictions · in-app local alerts only · no operational warning authority
        </p>
        {copyNotice ? (
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-100/70" aria-live="polite">{copyNotice}</p>
        ) : null}
      </div>

      <div className="flex border-b border-white/8 px-2 pt-2" role="tablist" aria-label="Watch center sections">
        {([
          ["alerts", `Alerts ${evaluation.stats.triggeredRuleCount}`],
          ["surge", `Surge ${activeSignalCount}`],
          ["rules", `Rules ${rules.length}`],
        ] as [WatchTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`watch-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-t-sm border-b px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${activeTab === tab ? "border-amber-200/60 bg-amber-300/[0.07] text-amber-100" : "border-transparent text-white/36 hover:text-white/64"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="godseye-scrollbar min-h-0 flex-1 overflow-y-auto">
        {activeTab === "alerts" ? (
          <div id="watch-panel-alerts" role="tabpanel">
            <div className="flex flex-wrap items-center gap-1.5 border-b border-white/8 px-3 py-2">
              <button
                type="button"
                onClick={() => exportAlerts(evaluation.alerts, alertStates, "json", now)}
                className="flex items-center gap-1 rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
              >
                <Download className="h-3 w-3" /> JSON
              </button>
              <button
                type="button"
                onClick={() => exportAlerts(evaluation.alerts, alertStates, "csv", now)}
                className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => copyText(visibleAlertRows.map((row) => buildWatchAlertSummary(row.alert)).join("\n\n---\n\n") || "No active analyst watch alerts.", "visible alert digest")}
                className="flex items-center gap-1 rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
              >
                <Copy className="h-3 w-3" /> Copy visible
              </button>
              <button
                type="button"
                aria-pressed={showSuppressed}
                onClick={() => setShowSuppressed((value) => !value)}
                className={`ml-auto rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] transition ${showSuppressed ? "border-sky-200/25 bg-sky-300/[0.08] text-sky-100/78" : "border-white/10 text-white/42 hover:text-white/70"}`}
              >
                {showSuppressed ? "Showing suppressed" : "Show suppressed"}
              </button>
            </div>

            {visibleAlertRows.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/28">
                  {evaluation.alerts.length === 0 ? "No enabled watch rule is currently triggered" : "All triggered alerts are dismissed or snoozed"}
                </p>
                <p className="mx-auto mt-3 max-w-[300px] font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/22">
                  Alerts never delete or alter incident evidence. Suppressed alerts remain available for review and export.
                </p>
              </div>
            ) : visibleAlertRows.map((row) => (
              <WatchAlertCard
                key={row.alert.fingerprint}
                alert={row.alert}
                lifecycle={row.lifecycle}
                state={row.state}
                eventsById={eventsById}
                onCopy={copyText}
                onDismiss={onDismissAlert}
                onSnooze={onSnoozeAlert}
                onRestore={onRestoreAlert}
                onSelectEvent={onSelectEvent}
              />
            ))}
          </div>
        ) : null}

        {activeTab === "surge" ? (
          <div id="watch-panel-surge" role="tabpanel">
            <div className="border-b border-white/8 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(["all", "theater", "region"] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={surgeScope === scope}
                    onClick={() => setSurgeScope(scope)}
                    className={`rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] transition ${surgeScope === scope ? "border-amber-200/28 bg-amber-300/[0.09] text-amber-100" : "border-white/10 text-white/42 hover:text-white/70"}`}
                  >
                    {scope}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => exportSurgeSignals(signalRows)}
                  className="ml-auto flex items-center gap-1 rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/46 transition hover:border-white/20 hover:text-white/78"
                >
                  <Download className="h-3 w-3" /> Export
                </button>
              </div>
              <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.08em] text-white/28">
                {surgeAnalysis.recentWindow.label} vs {surgeAnalysis.baselineWindow.label} · corpus baseline overlap {Math.round(surgeAnalysis.baselineCoverageRatio * 100)}%
              </p>
            </div>

            {signalRows.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/28">No surge/watch change indicators in this scope</p>
                <p className="mx-auto mt-3 max-w-[310px] font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/22">
                  This is a null statistical result inside the loaded corpus, not evidence that escalation is absent or impossible.
                </p>
              </div>
            ) : signalRows.map((signal) => (
              <SurgeSignalCard
                key={signal.id}
                signal={signal}
                eventsById={eventsById}
                onCopy={copyText}
                onSelectEvent={onSelectEvent}
                onFocusTheater={onFocusTheater}
              />
            ))}
          </div>
        ) : null}

        {activeTab === "rules" ? (
          <div id="watch-panel-rules" role="tabpanel">
            <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2.5">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/32">
                  local static storage · {storageReady ? "ready" : "loading"}
                </p>
                {storageStatus ? <p className="mt-1 font-mono text-[9px] leading-relaxed text-amber-100/58">{storageStatus}</p> : null}
              </div>
              <button
                type="button"
                onClick={startNewRule}
                className="flex h-8 items-center gap-1.5 rounded-sm border border-amber-200/28 bg-amber-300/[0.1] px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-amber-100 transition hover:bg-amber-300/[0.16]"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </div>

            {editingRule ? (
              <RuleBuilder
                draft={editingRule}
                theaterOptions={optionData.theaters}
                regionOptions={optionData.regions}
                countryOptions={optionData.countries}
                categoryOptions={optionData.categories}
                onChange={setEditingRule}
                onSave={saveEditingRule}
                onCancel={() => setEditingRule(null)}
              />
            ) : null}

            {rules.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/28">No analyst watch rules defined</p>
                <p className="mx-auto mt-3 max-w-[310px] font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/22">
                  Create a constrained local preset to watch incident counts, casualty measure, corroboration, or surge indicators. Nothing is sent to a backend.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/8">
                {rules.map((rule) => {
                  const ruleEvaluation = evaluationByRuleId.get(rule.id);
                  return (
                    <article key={rule.id} className={`px-3 py-3 ${rule.enabled ? "" : "opacity-62"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-[13px] font-semibold text-white/86">{rule.name}</h3>
                          <p className="mt-1 font-mono text-[9px] uppercase leading-relaxed tracking-[0.08em] text-white/32">
                            {describeWatchRule(rule)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRule({ ...rule, filters: { ...rule.filters, categoryGroups: [...rule.filters.categoryGroups], severities: [...rule.filters.severities] }, condition: { ...rule.condition } });
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/42 transition hover:border-white/22 hover:text-white"
                          aria-label={`Edit ${rule.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          aria-pressed={rule.enabled}
                          onClick={() => onToggleRule(rule.id)}
                          className={`rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] transition ${rule.enabled ? "border-emerald-200/24 bg-emerald-300/[0.07] text-emerald-100/76" : "border-white/10 bg-white/[0.025] text-white/38 hover:text-white/64"}`}
                        >
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <span className={`rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] ${ruleEvaluation?.triggered ? "border-amber-200/24 bg-amber-300/[0.07] text-amber-100/78" : "border-white/8 text-white/30"}`}>
                          {ruleEvaluation?.triggered ? "Triggered" : rule.enabled ? "Not triggered" : "Retained off"}
                        </span>
                      </div>
                      {ruleEvaluation ? (
                        <p className="mt-2 font-mono text-[9px] leading-relaxed text-white/34">{ruleEvaluation.explanation}</p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/8 px-4 py-2.5">
        <p className="font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.1em] text-white/24">
          <Gauge className="mr-1 inline h-3 w-3 align-[-2px]" />
          deterministic {surgeAnalysis.algorithmVersion} + {evaluation.algorithmVersion} · local static storage only · no browser notifications requested or sent
        </p>
      </div>
    </aside>
  );
}
