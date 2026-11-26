import type {
  ConflictEvent,
  EscalationAnalysisWindow,
  EscalationEvidenceRef,
  EscalationGroupKind,
  EscalationMetricSet,
  EscalationRatioBounds,
  EscalationSignal,
  EscalationSignalLevel,
  EscalationSurgeAnalysis,
  EscalationSurgeStats,
  IncidentCorrelationConfidence,
  IncidentOccurrenceWindow,
  SeverityKey,
} from "@/types/conflict";
import {
  DAY_MS,
  measureIncidentTemporalCoverage,
  resolveIncidentOccurrenceWindow,
} from "@/lib/incidentTime";

/**
 * Deterministic escalation-surge indicators (catalog batch 8).
 *
 * Design contract:
 * - Statistical indicator, never prediction. The engine measures change inside the loaded,
 *   already-correlated incident corpus. It does not forecast escalation, certify danger,
 *   infer intent, or claim operational warning authority.
 * - Canonical incidents, not duplicate reports. Input events are expected to have passed
 *   through incident correlation; corroboration metrics use only the correlation metadata
 *   carried by those canonical incidents.
 * - Source time uncertainty remains visible. An incident whose occurrence interval is wholly
 *   inside a period is definite; any intersecting interval is possible. Boundary-crossing
 *   incidents can therefore be possible in both recent and baseline periods. Rates are
 *   reported as bounded ranges instead of a false point estimate.
 * - No recency-weighted intensity. Some ingest paths include recency in their display
 *   intensity, which would structurally favor the recent window. This engine recomputes
 *   intensity only from severity, casualty measure, and displacement.
 * - Novelty means "not observed in the loaded baseline", not unprecedented in reality.
 *   Sparse source coverage, ingestion caps, and reporting lag can all create apparent novelty.
 */

export const SURGE_ALGORITHM_VERSION = "escalation-surge-v1";

export const SURGE_INDICATOR_DISCLAIMER =
  "Escalation-surge output is a deterministic statistical indicator of change inside the loaded incident corpus. It is not a prediction, not a verified operational warning, and not evidence that future escalation will occur. Counts affected by source time uncertainty are ranges; absence of a signal is not evidence of absence.";

const DEFAULT_RECENT_HOURS = 72;
const DEFAULT_BASELINE_DAYS = 21;
const RATIO_SCORE_CAP = 8;

const SEVERITY_RANK: Record<SeverityKey, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface EscalationSurgeOptions {
  /** Evaluation horizon. Passing the data fetch time keeps one loaded corpus stable. */
  now?: number;
  recentHours?: number;
  baselineDays?: number;
}

interface PreparedIncident {
  event: ConflictEvent;
  window: IncidentOccurrenceWindow;
  weight: number;
  casualtyMeasure: number;
  independentFamilyCount: number;
  evidenceReportCount: number;
  correlationConfidence: IncidentCorrelationConfidence | null;
  corroborated: boolean;
  contested: boolean;
  facetKey: string;
  facetLabel: string;
}

interface PeriodStat {
  definiteCount: number;
  possibleCount: number;
  boundaryAmbiguousCount: number;
  definiteIntensity: number;
  possibleIntensity: number;
  corroboratedPossibleCount: number;
  contestedPossibleCount: number;
  independentFamilySumPossible: number;
  definiteIncidents: PreparedIncident[];
  possibleIncidents: PreparedIncident[];
  possibleFacets: Set<string>;
  possibleFacetLabels: Map<string, string>;
}

interface GroupAccumulator {
  kind: EscalationGroupKind;
  key: string;
  labelCounts: Map<string, number>;
  incidents: PreparedIncident[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeGroupKey(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || fallback;
}

function casualtyMeasure(event: ConflictEvent): number {
  // countedCasualties can include killed depending on source semantics. Taking the maximum
  // is a conservative non-duplicating casualty measure; adding them could double-count deaths.
  return Math.max(finiteNonNegative(event.countedCasualties), finiteNonNegative(event.killed));
}

/**
 * Source-intrinsic casualty/severity intensity. The formula deliberately excludes recency,
 * verification, geoprecision, and ingest display boosts so temporal comparisons are not
 * structurally biased toward the recent window.
 */
export function escalationIncidentWeight(event: ConflictEvent): number {
  const severityComponent = SEVERITY_RANK[event.severity] / 4;
  const casualties = Math.min(1000, casualtyMeasure(event));
  const casualtyComponent = Math.log1p(casualties) / Math.log1p(1000);
  const displaced = Math.min(100000, finiteNonNegative(event.displaced));
  const displacementComponent = Math.log1p(displaced) / Math.log1p(100000);
  return round3(clamp01(severityComponent * 0.55 + casualtyComponent * 0.35 + displacementComponent * 0.1));
}

function incidentFacet(event: ConflictEvent): { key: string; label: string } {
  const latCell = Number.isFinite(event.lat) ? Math.floor(event.lat) : "unk";
  const lngCell = Number.isFinite(event.lng) ? Math.floor(event.lng) : "unk";
  const category = event.category || "unclassified";
  return {
    key: `${category}@${latCell}:${lngCell}`,
    label: `${category.replace(/_/g, " ")} near ${latCell}°, ${lngCell}°`,
  };
}

function prepareIncident(event: ConflictEvent, analysisEnd: number): PreparedIncident | null | "future" {
  const sourceWindow = resolveIncidentOccurrenceWindow(event);
  if (!sourceWindow) return null;
  if (sourceWindow.start >= analysisEnd) return "future";
  const endExclusive = Math.min(sourceWindow.endExclusive, analysisEnd);
  if (endExclusive <= sourceWindow.start) return "future";
  const window: IncidentOccurrenceWindow = {
    ...sourceWindow,
    endExclusive,
  };
  const facet = incidentFacet(event);
  const independentFamilyCount = Math.max(1, event.incident?.independentFamilyCount ?? 1);
  const evidenceReportCount = Math.max(1, event.incident?.memberCount ?? 1);
  const correlationConfidence = event.incident?.confidence ?? null;
  return {
    event,
    window,
    weight: escalationIncidentWeight(event),
    casualtyMeasure: casualtyMeasure(event),
    independentFamilyCount,
    evidenceReportCount,
    correlationConfidence,
    corroborated: correlationConfidence === "corroborated",
    contested: correlationConfidence === "contested",
    facetKey: facet.key,
    facetLabel: facet.label,
  };
}

function emptyPeriodStat(): PeriodStat {
  return {
    definiteCount: 0,
    possibleCount: 0,
    boundaryAmbiguousCount: 0,
    definiteIntensity: 0,
    possibleIntensity: 0,
    corroboratedPossibleCount: 0,
    contestedPossibleCount: 0,
    independentFamilySumPossible: 0,
    definiteIncidents: [],
    possibleIncidents: [],
    possibleFacets: new Set<string>(),
    possibleFacetLabels: new Map<string, string>(),
  };
}

function intersectsPeriod(incident: PreparedIncident, start: number, endExclusive: number): boolean {
  return incident.window.start < endExclusive && incident.window.endExclusive > start;
}

function definiteInPeriod(incident: PreparedIncident, start: number, endExclusive: number): boolean {
  return incident.window.start >= start && incident.window.endExclusive <= endExclusive;
}

function accumulatePeriod(stat: PeriodStat, incident: PreparedIncident, start: number, endExclusive: number): void {
  if (!intersectsPeriod(incident, start, endExclusive)) return;
  const definite = definiteInPeriod(incident, start, endExclusive);
  stat.possibleCount += 1;
  stat.possibleIntensity += incident.weight;
  stat.possibleIncidents.push(incident);
  stat.possibleFacets.add(incident.facetKey);
  stat.possibleFacetLabels.set(incident.facetKey, incident.facetLabel);
  if (incident.corroborated) stat.corroboratedPossibleCount += 1;
  if (incident.contested) stat.contestedPossibleCount += 1;
  stat.independentFamilySumPossible += incident.independentFamilyCount;
  if (definite) {
    stat.definiteCount += 1;
    stat.definiteIntensity += incident.weight;
    stat.definiteIncidents.push(incident);
  } else {
    stat.boundaryAmbiguousCount += 1;
  }
}

function undefinedRatio(): EscalationRatioBounds {
  return { defined: false, lower: null, upper: null, lowerUnbounded: false, upperUnbounded: false };
}

/**
 * Interval arithmetic for rate ratios. No smoothing or pseudocounts are inserted: when a
 * denominator can be zero the corresponding bound is explicitly unbounded/undefined.
 */
export function boundedRateRatio(
  currentDefiniteRate: number,
  currentPossibleRate: number,
  baselineDefiniteRate: number,
  baselinePossibleRate: number,
): EscalationRatioBounds {
  if (currentPossibleRate <= 0 && baselinePossibleRate <= 0) return undefinedRatio();
  const lowerUnbounded = currentDefiniteRate > 0 && baselinePossibleRate <= 0;
  const upperUnbounded = currentPossibleRate > 0 && baselineDefiniteRate <= 0;
  const lower = currentDefiniteRate <= 0
    ? 0
    : baselinePossibleRate > 0
      ? currentDefiniteRate / baselinePossibleRate
      : null;
  const upper = currentPossibleRate <= 0
    ? 0
    : baselineDefiniteRate > 0
      ? currentPossibleRate / baselineDefiniteRate
      : null;
  return {
    defined: true,
    lower: lower === null ? null : round3(lower),
    upper: upper === null ? null : round3(upper),
    lowerUnbounded,
    upperUnbounded,
  };
}

function ratioComponent(value: number | null, unbounded: boolean): number {
  if (unbounded) return 1;
  if (value === null || value <= 1) return 0;
  return clamp01(Math.log2(Math.min(RATIO_SCORE_CAP, value)) / Math.log2(RATIO_SCORE_CAP));
}

/** Evidence score for an increase, weighted toward the conservative lower bound. */
export function ratioEvidenceScore(bounds: EscalationRatioBounds): number {
  if (!bounds.defined) return 0;
  return round3(clamp01(
    ratioComponent(bounds.lower, bounds.lowerUnbounded) * 0.7
    + ratioComponent(bounds.upper, bounds.upperUnbounded) * 0.3,
  ));
}

function ratioSuggestsIncrease(bounds: EscalationRatioBounds, threshold = 1.35): boolean {
  if (!bounds.defined) return false;
  return bounds.lowerUnbounded
    || bounds.upperUnbounded
    || (bounds.lower ?? 0) >= threshold
    || (bounds.upper ?? 0) >= threshold;
}

function formatFiniteRatio(value: number): string {
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}x`;
}

/** Human-readable ratio interval used in both UI and evidence export. */
export function formatRatioBounds(bounds: EscalationRatioBounds): string {
  if (!bounds.defined) return "undefined (no measurable activity in either window)";
  const lower = bounds.lowerUnbounded
    ? "unbounded"
    : bounds.lower === null
      ? "undefined"
      : formatFiniteRatio(bounds.lower);
  const upper = bounds.upperUnbounded
    ? "unbounded"
    : bounds.upper === null
      ? "undefined"
      : formatFiniteRatio(bounds.upper);
  if (lower === upper) return lower;
  return `${lower} to ${upper}`;
}

function compareIncidents(a: PreparedIncident, b: PreparedIncident): number {
  return (b.weight - a.weight)
    || (b.event.occurredAt - a.event.occurredAt)
    || a.event.id.localeCompare(b.event.id);
}

function evidenceRef(incident: PreparedIncident, temporalMembership: "definite" | "possible"): EscalationEvidenceRef {
  const event = incident.event;
  return {
    eventId: event.id,
    title: event.title,
    occurredAt: event.occurredAt,
    theater: event.theater,
    region: event.region,
    country: event.country,
    category: event.category,
    severity: event.severity,
    casualtyMeasure: incident.casualtyMeasure,
    temporalMembership,
    correlationConfidence: incident.correlationConfidence,
    independentFamilyCount: incident.independentFamilyCount,
    evidenceReportCount: incident.evidenceReportCount,
    evidenceMemberEventIds: (event.evidence?.members ?? []).map((member) => member.event.id).sort(),
    sourceName: event.sourceName ?? event.sources[0]?.name ?? null,
    sourceUrl: event.sourceUrl ?? event.sources[0]?.url ?? null,
  };
}

function collectEvidenceRefs(recent: PeriodStat, limit = 5): EscalationEvidenceRef[] {
  const definiteIds = new Set(recent.definiteIncidents.map((incident) => incident.event.id));
  const definite = [...recent.definiteIncidents].sort(compareIncidents);
  const possibleOnly = recent.possibleIncidents
    .filter((incident) => !definiteIds.has(incident.event.id))
    .sort(compareIncidents);
  const refs: EscalationEvidenceRef[] = [];
  for (const incident of definite) {
    if (refs.length >= limit) break;
    refs.push(evidenceRef(incident, "definite"));
  }
  for (const incident of possibleOnly) {
    if (refs.length >= limit) break;
    refs.push(evidenceRef(incident, "possible"));
  }
  return refs;
}

function share(part: number, whole: number): number | null {
  return whole > 0 ? round3(part / whole) : null;
}

function positiveDeltaScore(delta: number | null, scale: number): number {
  if (delta === null || delta <= 0) return 0;
  return clamp01(delta / scale);
}

function groupLabel(labelCounts: Map<string, number>, fallback: string): string {
  return [...labelCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback;
}

function addToGroup(groups: Map<string, GroupAccumulator>, kind: EscalationGroupKind, incident: PreparedIncident): void {
  const rawKey = kind === "theater" ? incident.event.theater : incident.event.region;
  const key = normalizeGroupKey(rawKey, kind === "theater" ? "unknown-theater" : "unknown-region");
  const mapKey = `${kind}:${key}`;
  let group = groups.get(mapKey);
  if (!group) {
    group = { kind, key, labelCounts: new Map<string, number>(), incidents: [] };
    groups.set(mapKey, group);
  }
  const label = kind === "theater"
    ? (incident.event.conflict || incident.event.theater || "Unknown theater")
    : (incident.event.region || "Unknown region");
  group.labelCounts.set(label, (group.labelCounts.get(label) ?? 0) + 1);
  group.incidents.push(incident);
}

function temporalCertainty(stat: PeriodStat): number {
  return stat.possibleCount > 0 ? stat.definiteCount / stat.possibleCount : 0;
}

function buildMetrics(
  recent: PeriodStat,
  baseline: PeriodStat,
  recentDays: number,
  baselineDays: number,
): EscalationMetricSet {
  const currentRatePerDay = {
    definite: round3(recent.definiteCount / recentDays),
    possible: round3(recent.possibleCount / recentDays),
  };
  const baselineRatePerDay = {
    definite: round3(baseline.definiteCount / baselineDays),
    possible: round3(baseline.possibleCount / baselineDays),
  };
  const currentIntensityPerDay = {
    definite: round3(recent.definiteIntensity / recentDays),
    possible: round3(recent.possibleIntensity / recentDays),
  };
  const baselineIntensityPerDay = {
    definite: round3(baseline.definiteIntensity / baselineDays),
    possible: round3(baseline.possibleIntensity / baselineDays),
  };
  const corroboratedShareCurrent = share(recent.corroboratedPossibleCount, recent.possibleCount);
  const corroboratedShareBaseline = share(baseline.corroboratedPossibleCount, baseline.possibleCount);
  const contestedShareCurrent = share(recent.contestedPossibleCount, recent.possibleCount);
  const contestedShareBaseline = share(baseline.contestedPossibleCount, baseline.possibleCount);
  const novelIncidents = recent.definiteIncidents.filter((incident) => !baseline.possibleFacets.has(incident.facetKey));
  const novelLabels = [...new Set(novelIncidents.map((incident) => incident.facetLabel))].sort();

  return {
    currentDefiniteCount: recent.definiteCount,
    currentPossibleCount: recent.possibleCount,
    baselineDefiniteCount: baseline.definiteCount,
    baselinePossibleCount: baseline.possibleCount,
    currentRatePerDay,
    baselineRatePerDay,
    incidentRateRatio: boundedRateRatio(
      recent.definiteCount / recentDays,
      recent.possibleCount / recentDays,
      baseline.definiteCount / baselineDays,
      baseline.possibleCount / baselineDays,
    ),
    currentIntensityPerDay,
    baselineIntensityPerDay,
    intensityRatio: boundedRateRatio(
      recent.definiteIntensity / recentDays,
      recent.possibleIntensity / recentDays,
      baseline.definiteIntensity / baselineDays,
      baseline.possibleIntensity / baselineDays,
    ),
    corroboratedShareCurrent,
    corroboratedShareBaseline,
    corroboratedShareDelta: corroboratedShareCurrent !== null && corroboratedShareBaseline !== null
      ? round3(corroboratedShareCurrent - corroboratedShareBaseline)
      : null,
    contestedShareCurrent,
    contestedShareBaseline,
    meanIndependentFamiliesCurrent: recent.possibleCount > 0
      ? round3(recent.independentFamilySumPossible / recent.possibleCount)
      : null,
    meanIndependentFamiliesBaseline: baseline.possibleCount > 0
      ? round3(baseline.independentFamilySumPossible / baseline.possibleCount)
      : null,
    novelCurrentCount: novelIncidents.length,
    novelFacetShare: recent.definiteCount > 0 ? round3(novelIncidents.length / recent.definiteCount) : 0,
    novelFacetExamples: novelLabels.slice(0, 4),
    onsetVsBaseline: baseline.possibleCount === 0 && recent.definiteCount > 0,
    currentBoundaryAmbiguousCount: recent.boundaryAmbiguousCount,
    baselineBoundaryAmbiguousCount: baseline.boundaryAmbiguousCount,
  };
}

function computeEvidenceSupport(
  recent: PeriodStat,
  baseline: PeriodStat,
  metrics: EscalationMetricSet,
  baselineCoverageRatio: number,
): number {
  const totalPossible = recent.possibleCount + baseline.possibleCount;
  const temporalSupport = totalPossible > 0
    ? ((temporalCertainty(recent) * recent.possibleCount) + (temporalCertainty(baseline) * baseline.possibleCount)) / totalPossible
    : 0;
  const volumeSupport = clamp01(
    Math.min(1, recent.definiteCount / 3) * 0.5
    + Math.min(1, baseline.definiteCount / 12) * 0.5,
  );
  const meanFamilies = metrics.meanIndependentFamiliesCurrent ?? 1;
  const corroborationSupport = recent.possibleCount > 0
    ? clamp01(0.35 + Math.min(1, (meanFamilies - 1) / 2) * 0.65)
    : 0.2;
  const contestedPenalty = Math.max(metrics.contestedShareCurrent ?? 0, metrics.contestedShareBaseline ?? 0) * 0.25;
  const support = clamp01(
    temporalSupport * 0.3
    + clamp01(baselineCoverageRatio) * 0.25
    + volumeSupport * 0.3
    + corroborationSupport * 0.15,
  ) * (1 - contestedPenalty);
  return Math.round(clamp01(support) * 100);
}

function buildExplanations(
  groupKind: EscalationGroupKind,
  groupLabelText: string,
  metrics: EscalationMetricSet,
  evidenceSupport: number,
): string[] {
  const lines = [
    `rate: recent incident tempo is ${metrics.currentDefiniteCount} definite / ${metrics.currentPossibleCount} possible (${metrics.currentRatePerDay.definite.toFixed(2)}–${metrics.currentRatePerDay.possible.toFixed(2)}/day) versus ${metrics.baselineDefiniteCount} definite / ${metrics.baselinePossibleCount} possible baseline (${metrics.baselineRatePerDay.definite.toFixed(2)}–${metrics.baselineRatePerDay.possible.toFixed(2)}/day); feasible acceleration bounds are ${formatRatioBounds(metrics.incidentRateRatio)}.`,
    `intensity: severity/casualty-weighted intensity tempo is ${metrics.currentIntensityPerDay.definite.toFixed(2)}–${metrics.currentIntensityPerDay.possible.toFixed(2)}/day versus baseline ${metrics.baselineIntensityPerDay.definite.toFixed(2)}–${metrics.baselineIntensityPerDay.possible.toFixed(2)}/day; feasible acceleration bounds are ${formatRatioBounds(metrics.intensityRatio)}.`,
  ];
  if (metrics.corroboratedShareDelta !== null) {
    lines.push(`corroboration: corroborated share changed by ${metrics.corroboratedShareDelta >= 0 ? "+" : ""}${Math.round(metrics.corroboratedShareDelta * 100)} percentage points (${Math.round((metrics.corroboratedShareCurrent ?? 0) * 100)}% recent versus ${Math.round((metrics.corroboratedShareBaseline ?? 0) * 100)}% baseline); mean independent source families are ${metrics.meanIndependentFamiliesCurrent?.toFixed(2) ?? "--"} recent versus ${metrics.meanIndependentFamiliesBaseline?.toFixed(2) ?? "--"} baseline.`);
  } else {
    lines.push("corroboration: change is undefined because at least one window has no possible incidents; corroboration absence is not treated as evidence against activity.");
  }
  lines.push(`novelty: ${metrics.novelCurrentCount} of ${metrics.currentDefiniteCount} definite recent incidents have a category + 1° cell facet absent even from possible baseline membership${metrics.novelFacetExamples.length > 0 ? ` (examples: ${metrics.novelFacetExamples.slice(0, 2).join("; ")})` : ""}.`);
  lines.push(`scope: ${groupKind} '${groupLabelText}' evidence-support index ${evidenceSupport}/100 (a deterministic coverage/volume/corroboration cue, not a probability).`);
  return lines;
}

function buildUncertaintyNotes(metrics: EscalationMetricSet, baselineCoverageRatio: number): string[] {
  const notes: string[] = [];
  if (metrics.currentBoundaryAmbiguousCount > 0 || metrics.baselineBoundaryAmbiguousCount > 0) {
    notes.push(`${metrics.currentBoundaryAmbiguousCount} recent and ${metrics.baselineBoundaryAmbiguousCount} baseline possible memberships are boundary-ambiguous because publisher time uncertainty crosses a window edge; they are excluded from definite counts and cannot fabricate a robust increase.`);
  }
  if (baselineCoverageRatio < 0.98) {
    notes.push(`the observed corpus overlaps only ${Math.round(baselineCoverageRatio * 100)}% of the nominal baseline window; baseline silence may reflect ingestion coverage rather than inactivity.`);
  }
  if ((metrics.contestedShareCurrent ?? 0) > 0) {
    notes.push(`${Math.round((metrics.contestedShareCurrent ?? 0) * 100)}% of possible recent incidents are contested in their correlation clusters; casualty/actor/location disagreement remains visible instead of being resolved.`);
  }
  if (metrics.corroboratedShareDelta !== null && Math.abs(metrics.corroboratedShareDelta) >= 0.05) {
    notes.push("corroboration-share change can reflect source ingestion, reporting lag, or correlation coverage rather than operational change; it is evidence context, not proof of escalation.");
  }
  if (metrics.onsetVsBaseline) {
    notes.push("baseline onset means no incident uncertainty window intersects the loaded baseline for this scope; this is novelty within the corpus, not proof that the area was truly inactive.");
  }
  if (metrics.currentDefiniteCount < 3 || metrics.baselineDefiniteCount < 3) {
    notes.push(`small definite-count support (${metrics.currentDefiniteCount} recent, ${metrics.baselineDefiniteCount} baseline) makes rate ratios fragile; classification is capped unless stronger definite evidence is present.`);
  }
  return notes;
}

function levelRank(level: EscalationSignalLevel): number {
  switch (level) {
    case "surge-indicator": return 4;
    case "watch-indicator": return 3;
    case "uncertain-change": return 2;
    case "no-signal": return 1;
    default: return 0;
  }
}

/**
 * Analyze theater and region escalation indicators over a trailing recent window and a
 * preceding baseline. Given the same events and `now`, all classifications, scores, ordering,
 * explanations, and evidence references are deterministic.
 */
export function analyzeEscalationSurge(events: ConflictEvent[], options: EscalationSurgeOptions = {}): EscalationSurgeAnalysis {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const analysisEnd = Number.isFinite(options.now) && (options.now ?? 0) > 0 ? Math.trunc(options.now ?? 0) : Date.now();
  const recentHours = Math.max(6, options.recentHours ?? DEFAULT_RECENT_HOURS);
  const baselineDays = Math.max(3, options.baselineDays ?? DEFAULT_BASELINE_DAYS);
  const recentMs = recentHours * 36e5;
  const baselineMs = baselineDays * DAY_MS;
  const recentWindow: EscalationAnalysisWindow = {
    start: analysisEnd - recentMs,
    endExclusive: analysisEnd,
    label: `${recentHours}h recent window`,
  };
  const baselineWindow: EscalationAnalysisWindow = {
    start: analysisEnd - recentMs - baselineMs,
    endExclusive: analysisEnd - recentMs,
    label: `${baselineDays}d preceding baseline`,
  };

  const temporalCoverage = measureIncidentTemporalCoverage(events);
  const prepared: PreparedIncident[] = [];
  let invalidTimeCount = 0;
  let futureExcludedCount = 0;
  let corpusStart = Number.POSITIVE_INFINITY;
  let corpusEndExclusive = 0;

  for (const event of events) {
    const incident = prepareIncident(event, analysisEnd);
    if (incident === null) {
      invalidTimeCount += 1;
      continue;
    }
    if (incident === "future") {
      futureExcludedCount += 1;
      continue;
    }
    prepared.push(incident);
    corpusStart = Math.min(corpusStart, incident.window.start);
    corpusEndExclusive = Math.max(corpusEndExclusive, incident.window.endExclusive);
  }

  if (prepared.length === 0) {
    corpusStart = 0;
    corpusEndExclusive = 0;
  }

  const observedBaselineOverlap = prepared.length === 0
    ? 0
    : Math.max(0, Math.min(baselineWindow.endExclusive, corpusEndExclusive) - Math.max(baselineWindow.start, corpusStart));
  const baselineCoverageRatio = round3(clamp01(observedBaselineOverlap / baselineMs));

  const groups = new Map<string, GroupAccumulator>();
  for (const incident of prepared) {
    addToGroup(groups, "theater", incident);
    addToGroup(groups, "region", incident);
  }

  const recentDays = recentMs / DAY_MS;
  const signals: EscalationSignal[] = [];
  let boundaryAmbiguousMembershipCount = 0;

  const sortedGroups = [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  for (const group of sortedGroups) {
    const recent = emptyPeriodStat();
    const baseline = emptyPeriodStat();
    for (const incident of group.incidents) {
      accumulatePeriod(recent, incident, recentWindow.start, recentWindow.endExclusive);
      accumulatePeriod(baseline, incident, baselineWindow.start, baselineWindow.endExclusive);
    }
    boundaryAmbiguousMembershipCount += recent.boundaryAmbiguousCount + baseline.boundaryAmbiguousCount;
    const metrics = buildMetrics(recent, baseline, recentDays, baselineDays);
    const rateScore = ratioEvidenceScore(metrics.incidentRateRatio);
    const intensityScore = ratioEvidenceScore(metrics.intensityRatio);
    const familyDelta = metrics.meanIndependentFamiliesCurrent !== null && metrics.meanIndependentFamiliesBaseline !== null
      ? metrics.meanIndependentFamiliesCurrent - metrics.meanIndependentFamiliesBaseline
      : null;
    const corroborationScore = round3(Math.max(
      positiveDeltaScore(metrics.corroboratedShareDelta, 0.25),
      positiveDeltaScore(familyDelta, 0.75),
    ));
    const noveltyScore = round3(clamp01(metrics.novelFacetShare * 0.75 + (metrics.onsetVsBaseline ? 0.25 : 0)));
    const evidenceSupport = computeEvidenceSupport(recent, baseline, metrics, baselineCoverageRatio);
    const indicatorScore = Math.round(100 * clamp01(
      rateScore * 0.34
      + intensityScore * 0.34
      + corroborationScore * 0.12
      + noveltyScore * 0.2,
    ));
    const positiveEvidence = rateScore > 0.12
      || intensityScore > 0.12
      || noveltyScore >= 0.5
      || ratioSuggestsIncrease(metrics.incidentRateRatio)
      || ratioSuggestsIncrease(metrics.intensityRatio);

    // Small-count ratio explosions are not allowed to masquerade as robust escalation.
    // A surge needs at least three definite current incidents and a minimally populated
    // definite baseline (or four current incidents in a true loaded-corpus onset). Watch is
    // deliberately one step weaker; anything smaller remains an uncertain-change card.
    const sufficientForSurge = metrics.currentDefiniteCount >= 3
      && (metrics.baselineDefiniteCount >= 3 || (metrics.onsetVsBaseline && metrics.currentDefiniteCount >= 4));
    const sufficientForWatch = metrics.currentDefiniteCount >= 2
      && (metrics.baselineDefiniteCount >= 2 || (metrics.onsetVsBaseline && metrics.currentDefiniteCount >= 3));

    let level: EscalationSignalLevel;
    if (recent.possibleCount === 0 && baseline.possibleCount === 0) {
      level = "insufficient-evidence";
    } else if (indicatorScore >= 60 && sufficientForSurge && evidenceSupport >= 45) {
      level = "surge-indicator";
    } else if (indicatorScore >= 35 && sufficientForWatch && evidenceSupport >= 25) {
      level = "watch-indicator";
    } else if (recent.possibleCount > 0 && positiveEvidence) {
      level = "uncertain-change";
    } else {
      level = "no-signal";
    }

    const label = groupLabel(group.labelCounts, group.key);
    const explanations = buildExplanations(group.kind, label, metrics, evidenceSupport);
    const uncertaintyNotes = buildUncertaintyNotes(metrics, baselineCoverageRatio);
    signals.push({
      id: `surge:${group.kind}:${group.key}`,
      algorithmVersion: SURGE_ALGORITHM_VERSION,
      groupKind: group.kind,
      groupKey: group.key,
      groupLabel: label,
      level,
      isSignal: level === "surge-indicator" || level === "watch-indicator" || level === "uncertain-change",
      indicatorScore,
      evidenceSupport,
      rateScore,
      intensityScore,
      corroborationScore,
      noveltyScore,
      metrics,
      explanations,
      uncertaintyNotes,
      evidenceRefs: collectEvidenceRefs(recent),
      disclaimer: SURGE_INDICATOR_DISCLAIMER,
    });
  }

  signals.sort((a, b) =>
    (levelRank(b.level) - levelRank(a.level))
    || (b.indicatorScore - a.indicatorScore)
    || (b.evidenceSupport - a.evidenceSupport)
    || a.groupKind.localeCompare(b.groupKind)
    || a.groupKey.localeCompare(b.groupKey),
  );

  const elapsedMs = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - started) * 100) / 100;
  const stats: EscalationSurgeStats = {
    algorithmVersion: SURGE_ALGORITHM_VERSION,
    inputIncidentCount: events.length,
    invalidTimeCount,
    futureExcludedCount,
    analyzedIncidentCount: prepared.length,
    retainedEvidenceReportCount: temporalCoverage.retainedReportCount,
    theaterGroupCount: signals.filter((signal) => signal.groupKind === "theater").length,
    regionGroupCount: signals.filter((signal) => signal.groupKind === "region").length,
    surgeIndicatorCount: signals.filter((signal) => signal.level === "surge-indicator").length,
    watchIndicatorCount: signals.filter((signal) => signal.level === "watch-indicator").length,
    uncertainChangeCount: signals.filter((signal) => signal.level === "uncertain-change").length,
    insufficientEvidenceCount: signals.filter((signal) => signal.level === "insufficient-evidence").length,
    boundaryAmbiguousMembershipCount,
    elapsedMs,
  };

  return {
    algorithmVersion: SURGE_ALGORITHM_VERSION,
    analysisEnd,
    recentWindow,
    baselineWindow,
    baselineCoverageRatio,
    corpusStart,
    corpusEndExclusive,
    signals,
    globalNotes: [
      `windowing: the recent window is the trailing ${recentHours} hours and the baseline is the preceding ${baselineDays} days, both ending at the caller-supplied analysis time.`,
      "temporal bounds: definite means the whole source-supported occurrence uncertainty interval fits inside the window after clipping impossible future time; possible means any intersection. Boundary-crossing incidents can be possible in both windows and are never silently assigned.",
      "intensity formula: 55% severity rank + 35% casualty measure log-capped at 1,000 + 10% displacement log-capped at 100,000; recency and verification display boosts are excluded so baseline comparisons are not structurally biased.",
      "evidence-support index: 30% temporal definiteness + 25% observed baseline coverage + 30% evidence volume + 15% corroboration quality, discounted when contested clusters are present. It is a transparency cue, not a probability.",
      "novelty means a category + 1° cell facet is absent from the loaded baseline for the same scope. It does not mean the activity is unprecedented in reality.",
      `corpus temporal coverage: ${temporalCoverage.validEventCount}/${temporalCoverage.inputEventCount} incidents have resolvable occurrence windows; ${temporalCoverage.impreciseCount} use day/range precision.`,
    ],
    stats,
    disclaimer: SURGE_INDICATOR_DISCLAIMER,
  };
}

/** Copyable analyst digest with evidence references and explicit epistemic limits. */
export function buildSurgeAnalystSummary(signal: EscalationSignal): string {
  const lines = [
    `ESCALATION SURGE INDICATOR — STATISTICAL SIGNAL, NOT A PREDICTION`,
    `scope: ${signal.groupKind} ${signal.groupLabel} (${signal.groupKey})`,
    `level: ${signal.level}; indicator index ${signal.indicatorScore}/100; evidence-support index ${signal.evidenceSupport}/100`,
    `metric scores: rate ${Math.round(signal.rateScore * 100)}%, intensity ${Math.round(signal.intensityScore * 100)}%, corroboration ${Math.round(signal.corroborationScore * 100)}%, novelty ${Math.round(signal.noveltyScore * 100)}%`,
    "",
    "deterministic explanations:",
    ...signal.explanations.map((line) => `- ${line}`),
  ];
  if (signal.uncertaintyNotes.length > 0) {
    lines.push("", "uncertainty/caveats:", ...signal.uncertaintyNotes.map((line) => `- ${line}`));
  }
  lines.push("", "evidence references:");
  if (signal.evidenceRefs.length === 0) {
    lines.push("- no definite or possible recent evidence references retained");
  } else {
    for (const ref of signal.evidenceRefs) {
      lines.push(`- ${ref.eventId} [${ref.temporalMembership}] ${ref.title} | ${ref.severity}/${ref.category} | casualty measure ${ref.casualtyMeasure} | families ${ref.independentFamilyCount} | reports ${ref.evidenceReportCount} | ${ref.sourceName ?? "source unavailable"} ${ref.sourceUrl ?? ""}`.trim());
      if (ref.evidenceMemberEventIds.length > 0) lines.push(`  correlated member report ids: ${ref.evidenceMemberEventIds.join(", ")}`);
    }
  }
  lines.push("", signal.disclaimer, `algorithm: ${signal.algorithmVersion}`);
  return lines.join("\n");
}
