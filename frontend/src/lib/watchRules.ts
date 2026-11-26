import type {
  CategoryGroup,
  ConflictEvent,
  EscalationAnalysisWindow,
  EscalationEvidenceRef,
  EscalationSignal,
  EscalationSurgeAnalysis,
  IncidentOccurrenceWindow,
  SeverityKey,
  WatchAlert,
  WatchAlertEmphasis,
  WatchAlertState,
  WatchEvaluationResult,
  WatchEvaluationStats,
  WatchRule,
  WatchRuleConditionKind,
  WatchRuleEvaluation,
  WatchRuleTimeWindow,
} from "@/types/conflict";
import { DAY_MS, resolveIncidentOccurrenceWindow } from "@/lib/incidentTime";
import {
  analyzeEscalationSurge,
  escalationIncidentWeight,
  SURGE_INDICATOR_DISCLAIMER,
} from "@/lib/escalationSurge";

/**
 * Analyst-defined watch rules (catalog batch 8).
 *
 * The rule engine is deliberately constrained: analysts choose interpretable presets,
 * thresholds, trailing windows, and scope filters rather than free-form expressions. Event
 * rules trigger only on definite in-window membership (the whole source-supported uncertainty
 * interval fits inside the trailing window after impossible future time is clipped). Possible
 * boundary memberships remain visible in explanations but never satisfy a trigger.
 *
 * Alerts are local, in-app, non-destructive review aids. This module has no browser
 * notification side effects and no backend dependency.
 */

export const WATCH_RULE_ENGINE_VERSION = "analyst-watch-rules-v1";

export const WATCH_RULE_DISCLAIMER =
  "Analyst watch alerts are local deterministic statistical triggers over the loaded incident corpus. They are review aids only — not predictions, not verified operational warnings, and not authority to act. Dismissal or snoozing never alters incident evidence.";

export const WATCH_WINDOW_MS: Record<WatchRuleTimeWindow, number> = {
  "24h": 24 * 36e5,
  "72h": 72 * 36e5,
  "7d": 7 * DAY_MS,
};

export interface WatchConditionPreset {
  kind: WatchRuleConditionKind;
  label: string;
  shortLabel: string;
  description: string;
  thresholdLabel: string;
  defaultThreshold: number;
  minThreshold: number;
  maxThreshold: number;
  step: number;
  defaultWindow: WatchRuleTimeWindow;
  usesWindow: boolean;
}

export const WATCH_CONDITION_PRESETS: WatchConditionPreset[] = [
  {
    kind: "incident-count",
    label: "Incident count reaches threshold",
    shortLabel: "Incident count",
    description: "Triggers when the definite in-window incident count reaches the selected threshold. Boundary-uncertain incidents are shown but cannot trigger it.",
    thresholdLabel: "incidents",
    defaultThreshold: 3,
    minThreshold: 1,
    maxThreshold: 500,
    step: 1,
    defaultWindow: "72h",
    usesWindow: true,
  },
  {
    kind: "casualty-impact",
    label: "Casualty measure reaches threshold",
    shortLabel: "Casualty measure",
    description: "Triggers when the non-duplicating casualty measure (max of reported killed and counted casualties per incident) reaches the threshold in definite in-window incidents.",
    thresholdLabel: "casualty measure",
    defaultThreshold: 10,
    minThreshold: 1,
    maxThreshold: 10000,
    step: 1,
    defaultWindow: "72h",
    usesWindow: true,
  },
  {
    kind: "corroborated-incident",
    label: "Independent corroboration reaches threshold",
    shortLabel: "Corroboration",
    description: "Triggers when any definite in-window canonical incident is corroborated by at least the selected number of independent source families.",
    thresholdLabel: "independent families",
    defaultThreshold: 2,
    minThreshold: 2,
    maxThreshold: 5,
    step: 1,
    defaultWindow: "72h",
    usesWindow: true,
  },
  {
    kind: "surge-level",
    label: "Escalation-surge indicator appears",
    shortLabel: "Surge indicator",
    description: "Triggers when deterministic theater/region surge analysis produces at least the selected statistical indicator level for the filtered scope.",
    thresholdLabel: "minimum level",
    defaultThreshold: 1,
    minThreshold: 1,
    maxThreshold: 2,
    step: 1,
    defaultWindow: "72h",
    usesWindow: false,
  },
];

const CATEGORY_GROUPS: CategoryGroup[] = ["kinetic", "security", "humanitarian", "political", "strategic"];
const SEVERITIES: SeverityKey[] = ["critical", "high", "medium", "low"];
const CONDITION_KINDS: WatchRuleConditionKind[] = ["incident-count", "casualty-impact", "corroborated-incident", "surge-level"];
const WINDOWS: WatchRuleTimeWindow[] = ["24h", "72h", "7d"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function presetForKind(kind: WatchRuleConditionKind): WatchConditionPreset {
  return WATCH_CONDITION_PRESETS.find((preset) => preset.kind === kind) ?? WATCH_CONDITION_PRESETS[0];
}

/** Tolerant static-storage normalization. Malformed rules are dropped rather than repaired invisibly. */
export function normalizeWatchRule(value: unknown): WatchRule | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = stringOrNull(record.id);
  if (!id) return null;
  const conditionRecord = asRecord(record.condition);
  const filtersRecord = asRecord(record.filters);
  const kind = CONDITION_KINDS.includes(conditionRecord?.kind as WatchRuleConditionKind)
    ? conditionRecord?.kind as WatchRuleConditionKind
    : null;
  if (!kind) return null;
  const preset = presetForKind(kind);
  const threshold = clamp(
    Math.round(finiteNumber(conditionRecord?.threshold, preset.defaultThreshold)),
    preset.minThreshold,
    preset.maxThreshold,
  );
  const window = WINDOWS.includes(conditionRecord?.window as WatchRuleTimeWindow)
    ? conditionRecord?.window as WatchRuleTimeWindow
    : preset.defaultWindow;
  const surgeLevel = conditionRecord?.surgeLevel === "surge-indicator" ? "surge-indicator" : "watch-indicator";
  const categoryGroups = Array.isArray(filtersRecord?.categoryGroups)
    ? filtersRecord.categoryGroups.filter((group): group is CategoryGroup => CATEGORY_GROUPS.includes(group as CategoryGroup))
    : [];
  const severities = Array.isArray(filtersRecord?.severities)
    ? filtersRecord.severities.filter((severity): severity is SeverityKey => SEVERITIES.includes(severity as SeverityKey))
    : [];

  return {
    id,
    version: 1,
    name: stringOrNull(record.name) ?? "Untitled watch rule",
    enabled: record.enabled !== false,
    createdAt: finiteNumber(record.createdAt, 0),
    updatedAt: finiteNumber(record.updatedAt, finiteNumber(record.createdAt, 0)),
    condition: { kind, threshold, window, surgeLevel },
    filters: {
      theater: stringOrNull(filtersRecord?.theater),
      region: stringOrNull(filtersRecord?.region),
      country: stringOrNull(filtersRecord?.country),
      category: stringOrNull(filtersRecord?.category),
      categoryGroups: [...new Set(categoryGroups)],
      severities: [...new Set(severities)],
    },
  };
}

export function normalizeWatchRules(value: unknown): WatchRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rules: WatchRule[] = [];
  for (const item of value) {
    const rule = normalizeWatchRule(item);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    rules.push(rule);
  }
  return rules.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function normalizeWatchAlertStateMap(value: unknown): Record<string, WatchAlertState> {
  const record = asRecord(value);
  if (!record) return {};
  const states: Record<string, WatchAlertState> = {};
  for (const [fingerprint, raw] of Object.entries(record)) {
    const item = asRecord(raw);
    if (!item || !fingerprint) continue;
    const ruleId = stringOrNull(item.ruleId);
    if (!ruleId) continue;
    states[fingerprint] = {
      fingerprint,
      ruleId,
      firstSeenAt: finiteNumber(item.firstSeenAt, 0),
      lastSeenAt: finiteNumber(item.lastSeenAt, 0),
      dismissedAt: typeof item.dismissedAt === "number" && Number.isFinite(item.dismissedAt) ? item.dismissedAt : null,
      snoozedUntil: typeof item.snoozedUntil === "number" && Number.isFinite(item.snoozedUntil) ? item.snoozedUntil : null,
    };
  }
  return states;
}

export function createDefaultWatchRule(id: string, now: number): WatchRule {
  const preset = WATCH_CONDITION_PRESETS[0];
  return {
    id,
    version: 1,
    name: "New watch rule",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    condition: {
      kind: preset.kind,
      threshold: preset.defaultThreshold,
      window: preset.defaultWindow,
      surgeLevel: "watch-indicator",
    },
    filters: {
      theater: null,
      region: null,
      country: null,
      category: null,
      categoryGroups: [],
      severities: [],
    },
  };
}

export function watchRuleMatchesEvent(rule: WatchRule, event: ConflictEvent): boolean {
  const filters = rule.filters;
  if (filters.theater && normalizeKey(event.theater) !== normalizeKey(filters.theater)) return false;
  if (filters.region && normalizeKey(event.region) !== normalizeKey(filters.region)) return false;
  if (filters.country && normalizeKey(event.country) !== normalizeKey(filters.country)) return false;
  if (filters.category && event.category !== filters.category) return false;
  if (filters.categoryGroups.length > 0 && !filters.categoryGroups.includes(event.categoryGroup)) return false;
  if (filters.severities.length > 0 && !filters.severities.includes(event.severity)) return false;
  return true;
}

function hasNarrowingFilters(rule: WatchRule): boolean {
  return Boolean(rule.filters.theater)
    || Boolean(rule.filters.region)
    || Boolean(rule.filters.country)
    || Boolean(rule.filters.category)
    || rule.filters.categoryGroups.length > 0
    || rule.filters.severities.length > 0;
}

export function describeWatchRule(rule: WatchRule): string {
  const preset = presetForKind(rule.condition.kind);
  const condition = rule.condition.kind === "surge-level"
    ? `${preset.shortLabel} at ${rule.condition.surgeLevel === "surge-indicator" ? "surge" : "watch"} level or stronger`
    : `${preset.shortLabel} ≥ ${rule.condition.threshold} ${preset.thresholdLabel} in ${rule.condition.window}`;
  const scope: string[] = [];
  if (rule.filters.theater) scope.push(`theater ${rule.filters.theater}`);
  if (rule.filters.region) scope.push(`region ${rule.filters.region}`);
  if (rule.filters.country) scope.push(`country ${rule.filters.country}`);
  if (rule.filters.category) scope.push(`category ${rule.filters.category.replace(/_/g, " ")}`);
  if (rule.filters.categoryGroups.length > 0) scope.push(`groups ${rule.filters.categoryGroups.join("+")}`);
  if (rule.filters.severities.length > 0) scope.push(`severities ${rule.filters.severities.join("+")}`);
  return `${condition} · ${scope.length > 0 ? scope.join(" · ") : "all geography/categories/severities"}`;
}

function casualtyMeasureForEvent(event: ConflictEvent): number {
  const counted = Number.isFinite(event.countedCasualties) && event.countedCasualties > 0 ? event.countedCasualties : 0;
  const killed = Number.isFinite(event.killed) && event.killed > 0 ? event.killed : 0;
  return Math.max(counted, killed);
}

function evidenceRefForEvent(event: ConflictEvent, temporalMembership: "definite" | "possible"): EscalationEvidenceRef {
  const independentFamilyCount = Math.max(1, event.incident?.independentFamilyCount ?? 1);
  const evidenceReportCount = Math.max(1, event.incident?.memberCount ?? 1);
  return {
    eventId: event.id,
    title: event.title,
    occurredAt: event.occurredAt,
    theater: event.theater,
    region: event.region,
    country: event.country,
    category: event.category,
    severity: event.severity,
    casualtyMeasure: casualtyMeasureForEvent(event),
    temporalMembership,
    correlationConfidence: event.incident?.confidence ?? null,
    independentFamilyCount,
    evidenceReportCount,
    evidenceMemberEventIds: (event.evidence?.members ?? []).map((member) => member.event.id).sort(),
    sourceName: event.sourceName ?? event.sources[0]?.name ?? null,
    sourceUrl: event.sourceUrl ?? event.sources[0]?.url ?? null,
  };
}

interface TimedEventMatch {
  event: ConflictEvent;
  window: IncidentOccurrenceWindow;
  definite: boolean;
}

function compareEventsForEvidence(a: ConflictEvent, b: ConflictEvent): number {
  return (escalationIncidentWeight(b) - escalationIncidentWeight(a))
    || (b.occurredAt - a.occurredAt)
    || a.id.localeCompare(b.id);
}

function collectWindowMatches(
  events: ConflictEvent[],
  rule: WatchRule,
  start: number,
  endExclusive: number,
): { definite: TimedEventMatch[]; possibleOnly: TimedEventMatch[]; invalidTimeCount: number } {
  const definite: TimedEventMatch[] = [];
  const possibleOnly: TimedEventMatch[] = [];
  let invalidTimeCount = 0;
  for (const event of events) {
    if (!watchRuleMatchesEvent(rule, event)) continue;
    const sourceWindow = resolveIncidentOccurrenceWindow(event);
    if (!sourceWindow) {
      invalidTimeCount += 1;
      continue;
    }
    if (sourceWindow.start >= endExclusive) continue;
    const clippedEnd = Math.min(sourceWindow.endExclusive, endExclusive);
    if (clippedEnd <= sourceWindow.start) continue;
    const window: IncidentOccurrenceWindow = { ...sourceWindow, endExclusive: clippedEnd };
    if (!intersects(window, start, endExclusive)) continue;
    const isDefinite = window.start >= start && window.endExclusive <= endExclusive;
    const match = { event, window, definite: isDefinite };
    if (isDefinite) definite.push(match);
    else possibleOnly.push(match);
  }
  definite.sort((a, b) => compareEventsForEvidence(a.event, b.event));
  possibleOnly.sort((a, b) => compareEventsForEvidence(a.event, b.event));
  return { definite, possibleOnly, invalidTimeCount };
}

function intersects(window: IncidentOccurrenceWindow, start: number, endExclusive: number): boolean {
  return window.start < endExclusive && window.endExclusive > start;
}

/** Stable non-cryptographic local fingerprint. It intentionally changes when triggering evidence materially changes. */
export function stableWatchFingerprint(parts: string[]): string {
  const input = parts.join("\u001f");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + index;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `wa-${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function selectEvidenceRefs(definite: TimedEventMatch[], possibleOnly: TimedEventMatch[], limit = 6): EscalationEvidenceRef[] {
  const refs: EscalationEvidenceRef[] = [];
  for (const match of definite) {
    if (refs.length >= limit) break;
    refs.push(evidenceRefForEvent(match.event, "definite"));
  }
  for (const match of possibleOnly) {
    if (refs.length >= limit) break;
    refs.push(evidenceRefForEvent(match.event, "possible"));
  }
  return refs;
}

function filterDescription(rule: WatchRule): string {
  return `rule scope: ${describeWatchRule(rule)}. Empty filter sets mean all values; no incident is hidden or altered by evaluation.`;
}

function evaluateEventRule(
  rule: WatchRule,
  events: ConflictEvent[],
  now: number,
): WatchRuleEvaluation {
  const windowMs = WATCH_WINDOW_MS[rule.condition.window];
  const window: EscalationAnalysisWindow = {
    start: now - windowMs,
    endExclusive: now,
    label: `${rule.condition.window} trailing window`,
  };
  const { definite, possibleOnly, invalidTimeCount } = collectWindowMatches(events, rule, window.start, window.endExclusive);
  const definiteCount = definite.length;
  const possibleCount = definiteCount + possibleOnly.length;
  const casualtyImpact = definite.reduce((sum, match) => sum + casualtyMeasureForEvent(match.event), 0);
  const maxIndependentFamilies = Math.max(0, ...definite.map((match) => Math.max(1, match.event.incident?.independentFamilyCount ?? 1)));
  const criticalCount = definite.filter((match) => match.event.severity === "critical").length;
  const preset = presetForKind(rule.condition.kind);

  let triggered = false;
  let observedText = "";
  if (rule.condition.kind === "incident-count") {
    triggered = definiteCount >= rule.condition.threshold;
    observedText = `${definiteCount} definite incidents versus threshold ${rule.condition.threshold}`;
  } else if (rule.condition.kind === "casualty-impact") {
    triggered = casualtyImpact >= rule.condition.threshold;
    observedText = `casualty measure ${casualtyImpact} versus threshold ${rule.condition.threshold}`;
  } else if (rule.condition.kind === "corroborated-incident") {
    triggered = maxIndependentFamilies >= rule.condition.threshold;
    observedText = `maximum independent source families ${maxIndependentFamilies || 0} versus threshold ${rule.condition.threshold}`;
  }

  const explanations = [
    filterDescription(rule),
    `temporal trigger: ${definiteCount} definite incidents inside the ${rule.condition.window} trailing window; ${possibleCount} are possible when boundary-uncertain records are included. Only definite membership can satisfy the trigger.`,
    `condition: ${observedText}. ${preset.description}`,
  ];
  if (possibleOnly.length > 0) {
    explanations.push(`${possibleOnly.length} matching incident${possibleOnly.length === 1 ? "" : "s"} cross the window boundary or have uncertainty extending beyond the analysis horizon; they remain visible as possible evidence but do not trigger the rule.`);
  }
  if (invalidTimeCount > 0) {
    explanations.push(`${invalidTimeCount} matching record${invalidTimeCount === 1 ? "" : "s"} lacked a resolvable occurrence window and were excluded rather than guessed.`);
  }

  if (!triggered) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      enabled: true,
      triggered: false,
      explanation: `not triggered: ${observedText}`,
      definiteIncidentCount: definiteCount,
      possibleIncidentCount: possibleCount,
      alert: null,
    };
  }

  const evidenceRefs = selectEvidenceRefs(definite, possibleOnly);
  const evidenceIds = evidenceRefs.map((ref) => ref.eventId).sort();
  const emphasis: WatchAlertEmphasis = criticalCount > 0
    || (rule.condition.kind === "incident-count" && definiteCount >= rule.condition.threshold * 2)
    || (rule.condition.kind === "casualty-impact" && casualtyImpact >= rule.condition.threshold * 1.5)
    || (rule.condition.kind === "corroborated-incident" && maxIndependentFamilies > rule.condition.threshold)
    ? "elevated"
    : "standard";
  const title = rule.condition.kind === "incident-count"
    ? `${rule.name}: ${definiteCount} incidents in ${rule.condition.window}`
    : rule.condition.kind === "casualty-impact"
      ? `${rule.name}: casualty measure ${casualtyImpact} in ${rule.condition.window}`
      : `${rule.name}: ${maxIndependentFamilies}-family corroboration in ${rule.condition.window}`;
  const fingerprint = stableWatchFingerprint([
    rule.id,
    describeWatchRule(rule),
    rule.condition.window,
    ...evidenceIds,
  ]);

  const alert: WatchAlert = {
    fingerprint,
    algorithmVersion: WATCH_RULE_ENGINE_VERSION,
    ruleId: rule.id,
    ruleName: rule.name,
    conditionKind: rule.condition.kind,
    emphasis,
    triggeredAt: now,
    title,
    summary: `${observedText}; ${definiteCount} definite / ${possibleCount} possible matching incidents in the trailing ${rule.condition.window} window.`,
    explanations,
    evidenceRefs,
    definiteIncidentCount: definiteCount,
    possibleIncidentCount: possibleCount,
    boundaryAmbiguousCount: possibleOnly.length,
    window,
    surgeSignalIds: [],
    disclaimer: WATCH_RULE_DISCLAIMER,
  };

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    enabled: true,
    triggered: true,
    explanation: `triggered: ${observedText}`,
    definiteIncidentCount: definiteCount,
    possibleIncidentCount: possibleCount,
    alert,
  };
}

function signalLevelAtLeast(signal: EscalationSignal, threshold: WatchRule["condition"]["surgeLevel"]): boolean {
  if (threshold === "surge-indicator") return signal.level === "surge-indicator";
  return signal.level === "surge-indicator" || signal.level === "watch-indicator";
}

function mergeEvidenceRefs(signals: EscalationSignal[], limit = 6): EscalationEvidenceRef[] {
  const refs: EscalationEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    for (const ref of signal.evidenceRefs) {
      if (refs.length >= limit) break;
      if (seen.has(ref.eventId)) continue;
      seen.add(ref.eventId);
      refs.push(ref);
    }
    if (refs.length >= limit) break;
  }
  return refs;
}

function evaluateSurgeRule(
  rule: WatchRule,
  events: ConflictEvent[],
  baseAnalysis: EscalationSurgeAnalysis,
  now: number,
): WatchRuleEvaluation {
  const filteredEvents = events.filter((event) => watchRuleMatchesEvent(rule, event));
  const narrow = hasNarrowingFilters(rule);
  const recentHours = (baseAnalysis.recentWindow.endExclusive - baseAnalysis.recentWindow.start) / 36e5;
  const baselineDays = (baseAnalysis.baselineWindow.endExclusive - baseAnalysis.baselineWindow.start) / DAY_MS;
  const analysis = narrow
    ? analyzeEscalationSurge(filteredEvents, { now, recentHours, baselineDays })
    : baseAnalysis;

  let candidates = analysis.signals.filter((signal) => signal.isSignal);
  if (rule.filters.theater) {
    const theaterKey = normalizeKey(rule.filters.theater);
    candidates = candidates.filter((signal) => signal.groupKind === "theater" && signal.groupKey === theaterKey);
  } else if (rule.filters.region) {
    const regionKey = normalizeKey(rule.filters.region);
    candidates = candidates.filter((signal) => signal.groupKind === "region" && signal.groupKey === regionKey);
  }
  const triggeredSignals = candidates.filter((signal) => signalLevelAtLeast(signal, rule.condition.surgeLevel));

  const window: EscalationAnalysisWindow = analysis.recentWindow;

  if (triggeredSignals.length === 0) {
    const strongest = candidates[0] ?? analysis.signals.find((signal) => signal.isSignal) ?? null;
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      enabled: true,
      triggered: false,
      explanation: strongest
        ? `not triggered: strongest matching signal is ${strongest.level} (${strongest.groupKind} ${strongest.groupLabel}); required ${rule.condition.surgeLevel === "surge-indicator" ? "surge" : "watch"} level or stronger`
        : `not triggered: no watch/surge signal in the filtered scope${filteredEvents.length === 0 ? " (no incidents match the filters)" : ""}`,
      definiteIncidentCount: 0,
      possibleIncidentCount: 0,
      alert: null,
    };
  }

  const evidenceRefs = mergeEvidenceRefs(triggeredSignals);
  const evidenceIds = evidenceRefs.map((ref) => ref.eventId).sort();
  const strongest = triggeredSignals[0];
  // Counts shown on the alert belong to the strongest scope only. Theater and region scopes
  // can contain the same incidents, so summing across scopes would double-count evidence.
  const definiteCount = strongest.metrics.currentDefiniteCount;
  const possibleCount = strongest.metrics.currentPossibleCount;
  const boundaryCount = strongest.metrics.currentBoundaryAmbiguousCount;
  const hasSurge = triggeredSignals.some((signal) => signal.level === "surge-indicator");
  const explanations = [
    filterDescription(rule),
    `surge trigger: ${triggeredSignals.length} ${triggeredSignals.length === 1 ? "scope" : "scopes"} meet ${rule.condition.surgeLevel === "surge-indicator" ? "surge" : "watch"} level or stronger inside the filtered corpus. Strongest: ${strongest.groupKind} ${strongest.groupLabel} at ${strongest.level}, indicator index ${strongest.indicatorScore}/100, evidence support ${strongest.evidenceSupport}/100.`,
    `counts shown below belong to the strongest scope only; nested theater/region signals can share the same canonical incidents and are never summed as independent evidence.`,
    ...strongest.explanations.slice(0, 3),
    "the surge inputs are statistical indicators over bounded temporal membership; this alert is not a forecast and does not verify operational escalation.",
  ];
  if (boundaryCount > 0) {
    explanations.push(`${boundaryCount} possible recent memberships in the strongest scope are boundary-ambiguous and remain outside definite counts.`);
  }

  const fingerprint = stableWatchFingerprint([
    rule.id,
    describeWatchRule(rule),
    ...triggeredSignals.map((signal) => signal.id).sort(),
    ...evidenceIds,
  ]);
  const title = triggeredSignals.length === 1
    ? `${rule.name}: ${strongest.level} in ${strongest.groupLabel}`
    : `${rule.name}: ${triggeredSignals.length} surge/watch scopes`;
  const alert: WatchAlert = {
    fingerprint,
    algorithmVersion: WATCH_RULE_ENGINE_VERSION,
    ruleId: rule.id,
    ruleName: rule.name,
    conditionKind: "surge-level",
    emphasis: hasSurge ? "elevated" : "standard",
    triggeredAt: now,
    title,
    summary: `${triggeredSignals.length} scope${triggeredSignals.length === 1 ? "" : "s"} meet ${rule.condition.surgeLevel === "surge-indicator" ? "surge" : "watch"} level or stronger; strongest is ${strongest.groupLabel} at indicator index ${strongest.indicatorScore}/100.`,
    explanations,
    evidenceRefs,
    definiteIncidentCount: definiteCount,
    possibleIncidentCount: possibleCount,
    boundaryAmbiguousCount: boundaryCount,
    window,
    surgeSignalIds: triggeredSignals.map((signal) => signal.id),
    disclaimer: `${WATCH_RULE_DISCLAIMER} ${SURGE_INDICATOR_DISCLAIMER}`,
  };

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    enabled: true,
    triggered: true,
    explanation: `triggered: ${triggeredSignals.length} scope${triggeredSignals.length === 1 ? "" : "s"} at required surge level`,
    definiteIncidentCount: definiteCount,
    possibleIncidentCount: possibleCount,
    alert,
  };
}

export interface EvaluateWatchRulesOptions {
  now?: number;
}

/** Evaluate every enabled local rule deterministically against canonical incidents and surge analysis. */
export function evaluateWatchRules(
  events: ConflictEvent[],
  rules: WatchRule[],
  surgeAnalysis: EscalationSurgeAnalysis,
  options: EvaluateWatchRulesOptions = {},
): WatchEvaluationResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = Number.isFinite(options.now) && (options.now ?? 0) > 0
    ? Math.trunc(options.now ?? 0)
    : surgeAnalysis.analysisEnd || Date.now();
  const orderedRules = [...rules].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const evaluations: WatchRuleEvaluation[] = [];

  for (const rule of orderedRules) {
    if (!rule.enabled) {
      evaluations.push({
        ruleId: rule.id,
        ruleName: rule.name,
        enabled: false,
        triggered: false,
        explanation: "disabled: rule is retained locally but not evaluated",
        definiteIncidentCount: 0,
        possibleIncidentCount: 0,
        alert: null,
      });
      continue;
    }
    evaluations.push(rule.condition.kind === "surge-level"
      ? evaluateSurgeRule(rule, events, surgeAnalysis, now)
      : evaluateEventRule(rule, events, now));
  }

  const alerts = evaluations
    .map((evaluation) => evaluation.alert)
    .filter((alert): alert is WatchAlert => alert !== null)
    .sort((a, b) =>
      (a.emphasis === b.emphasis ? 0 : a.emphasis === "elevated" ? -1 : 1)
      || a.ruleName.localeCompare(b.ruleName)
      || a.fingerprint.localeCompare(b.fingerprint),
    );
  const elapsedMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - started) * 100) / 100;
  const stats: WatchEvaluationStats = {
    algorithmVersion: WATCH_RULE_ENGINE_VERSION,
    ruleCount: rules.length,
    enabledRuleCount: rules.filter((rule) => rule.enabled).length,
    disabledRuleCount: rules.filter((rule) => !rule.enabled).length,
    triggeredRuleCount: alerts.length,
    evaluatedEventCount: events.length,
    elapsedMs,
  };
  return {
    algorithmVersion: WATCH_RULE_ENGINE_VERSION,
    evaluatedAt: now,
    alerts,
    evaluations,
    stats,
    disclaimer: WATCH_RULE_DISCLAIMER,
  };
}

export type WatchAlertLifecycle = "active" | "snoozed" | "dismissed";

/** Lifecycle is presentation-only: suppressed alerts remain exportable/restorable and incident data is never changed. */
export function getWatchAlertLifecycle(
  alert: WatchAlert,
  state: WatchAlertState | null | undefined,
  now: number,
): WatchAlertLifecycle {
  if (!state) return "active";
  if (state.dismissedAt !== null) return "dismissed";
  if (state.snoozedUntil !== null && state.snoozedUntil > now) return "snoozed";
  return "active";
}

/** Copyable alert digest with evidence references and explicit non-authority language. */
export function buildWatchAlertSummary(alert: WatchAlert): string {
  const lines = [
    "ANALYST WATCH ALERT — LOCAL STATISTICAL TRIGGER, NOT AN OPERATIONAL WARNING",
    `rule: ${alert.ruleName} (${alert.ruleId})`,
    `title: ${alert.title}`,
    `triggered at: ${new Date(alert.triggeredAt).toISOString()}`,
    `window: ${new Date(alert.window.start).toISOString()} through ${new Date(alert.window.endExclusive).toISOString()} (end exclusive)`,
    `counts: ${alert.definiteIncidentCount} definite / ${alert.possibleIncidentCount} possible; ${alert.boundaryAmbiguousCount} boundary-ambiguous`,
    `emphasis: ${alert.emphasis} (presentation priority only)`,
    "",
    "transparent trigger explanations:",
    ...alert.explanations.map((line) => `- ${line}`),
    "",
    "evidence references:",
  ];
  if (alert.evidenceRefs.length === 0) {
    lines.push("- no evidence references retained");
  } else {
    for (const ref of alert.evidenceRefs) {
      lines.push(`- ${ref.eventId} [${ref.temporalMembership}] ${ref.title} | ${ref.theater}/${ref.region}/${ref.country} | ${ref.severity}/${ref.category} | casualty measure ${ref.casualtyMeasure} | families ${ref.independentFamilyCount} | reports ${ref.evidenceReportCount} | ${ref.sourceName ?? "source unavailable"} ${ref.sourceUrl ?? ""}`.trim());
      if (ref.evidenceMemberEventIds.length > 0) lines.push(`  correlated member report ids: ${ref.evidenceMemberEventIds.join(", ")}`);
    }
  }
  if (alert.surgeSignalIds.length > 0) {
    lines.push("", `surge signal ids: ${alert.surgeSignalIds.join(", ")}`);
  }
  lines.push("", alert.disclaimer, `algorithm: ${alert.algorithmVersion}`, `fingerprint: ${alert.fingerprint}`);
  return lines.join("\n");
}
