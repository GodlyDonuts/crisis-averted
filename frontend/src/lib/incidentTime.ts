import type { ConflictEvent, IncidentOccurrenceWindow } from "@/types/conflict";

export const SECOND_MS = 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

export type TemporalResolutionKey = "hour" | "sixHour" | "day" | "week";
export type TemporalResolutionPreference = "auto" | TemporalResolutionKey;
export type PlaybackMode = "step" | "trailing" | "cumulative";

export interface TemporalResolutionSpec {
  key: TemporalResolutionKey;
  label: string;
  shortLabel: string;
  stepMs: number;
}

export const TEMPORAL_RESOLUTIONS: Record<TemporalResolutionKey, TemporalResolutionSpec> = {
  hour: { key: "hour", label: "Hour", shortLabel: "1h", stepMs: HOUR_MS },
  sixHour: { key: "sixHour", label: "Six hour", shortLabel: "6h", stepMs: 6 * HOUR_MS },
  day: { key: "day", label: "Day", shortLabel: "1d", stepMs: DAY_MS },
  week: { key: "week", label: "Week", shortLabel: "1w", stepMs: WEEK_MS },
};

const RESOLUTION_ORDER: TemporalResolutionKey[] = ["hour", "sixHour", "day", "week"];

function isFinitePositive(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp > 0;
}

function parseIsoDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createSecondOccurrenceWindow(timestamp: number): IncidentOccurrenceWindow | null {
  if (!isFinitePositive(timestamp)) return null;
  const start = Math.floor(timestamp / SECOND_MS) * SECOND_MS;
  return {
    start,
    endExclusive: start + SECOND_MS,
    precision: "second",
    basis: "publisher-second",
    label: "publisher timestamp normalized to a one-second UTC interval",
  };
}

export function createDayOccurrenceWindow(
  dayStartOrTimestamp: number,
  basis: "publisher-day" | "inferred-day",
): IncidentOccurrenceWindow | null {
  if (!isFinitePositive(dayStartOrTimestamp)) return null;
  const start = Math.floor(dayStartOrTimestamp / DAY_MS) * DAY_MS;
  return {
    start,
    endExclusive: start + DAY_MS,
    precision: "day",
    basis,
    label: basis === "publisher-day"
      ? "publisher supplies a calendar date only; the exact time inside the UTC-normalized day is unresolved"
      : "legacy timestamp falls at a UTC midnight boundary and is conservatively treated as date-only; the exact time inside the day is unresolved",
  };
}

function ucdpDatePrecisionText(datePrec: number | null | undefined): string {
  switch (datePrec) {
    case 1: return "exact calendar day known (day resolution, not a time of day)";
    case 2: return "exact day unknown within a 2-6 day range";
    case 3: return "exact day unknown within the source week";
    case 4: return "exact day unknown within an 8-30 day/month range";
    case 5: return "exact day unknown within a range longer than one month and up to one year";
    default: return "date precision unspecified by publisher";
  }
}

export function createUcdpOccurrenceWindow(
  dateStart: string | null | undefined,
  dateEnd: string | null | undefined,
  datePrec: number | null | undefined,
): IncidentOccurrenceWindow | null {
  const startDay = parseIsoDay(dateStart);
  const endDay = parseIsoDay(dateEnd);
  if (startDay === null || endDay === null || startDay > endDay) return null;
  const endExclusive = endDay + DAY_MS;
  const isSingleDay = startDay + DAY_MS === endExclusive;
  const days = Math.round((endExclusive - startDay) / DAY_MS);
  const precisionText = ucdpDatePrecisionText(datePrec);
  return {
    start: startDay,
    endExclusive,
    precision: isSingleDay ? "day" : "range",
    basis: isSingleDay ? "publisher-day" : "publisher-range",
    label: `UCDP ${precisionText}; earliest/latest possible dates are ${dateStart?.slice(0, 10) ?? "unknown"} through ${dateEnd?.slice(0, 10) ?? "unknown"} inclusive (${days} UTC-normalized day${days === 1 ? "" : "s"})`,
  };
}

/**
 * Resolve the occurrence interval without inventing precision. Normalized records carry an
 * explicit interval; legacy/test records are inferred only when their shape already encodes
 * one (a UCDP date range or a UTC-midnight date-only artifact). Invalid/missing times return
 * null and are excluded from playback rather than being silently placed on the timeline.
 */
export function resolveIncidentOccurrenceWindow(event: ConflictEvent): IncidentOccurrenceWindow | null {
  const explicit = event.occurrence;
  if (
    explicit
    && Number.isFinite(explicit.start)
    && Number.isFinite(explicit.endExclusive)
    && explicit.endExclusive > explicit.start
  ) {
    return explicit;
  }

  const ucdpWindow = createUcdpOccurrenceWindow(event.ucdp?.date_start, event.ucdp?.date_end, event.ucdp?.date_prec);
  if (ucdpWindow) return ucdpWindow;

  if (!isFinitePositive(event.occurredAt)) return null;
  if (event.occurredAt % DAY_MS === 0) {
    return createDayOccurrenceWindow(event.occurredAt, "inferred-day");
  }
  return createSecondOccurrenceWindow(event.occurredAt);
}

export interface IncidentTemporalCoverage {
  inputEventCount: number;
  validEventCount: number;
  invalidTimeCount: number;
  preciseCount: number;
  dayCount: number;
  rangeCount: number;
  impreciseCount: number;
  retainedReportCount: number;
  start: number;
  endExclusive: number;
  longestUncertaintyMs: number;
}

function emptyCoverage(inputEventCount: number): IncidentTemporalCoverage {
  return {
    inputEventCount,
    validEventCount: 0,
    invalidTimeCount: inputEventCount,
    preciseCount: 0,
    dayCount: 0,
    rangeCount: 0,
    impreciseCount: 0,
    retainedReportCount: 0,
    start: 0,
    endExclusive: 0,
    longestUncertaintyMs: 0,
  };
}

interface TemporalRecord {
  event: ConflictEvent;
  eventIndex: number;
  window: IncidentOccurrenceWindow;
  firstFrame: number;
  lastFrame: number;
}

function collectTemporalRecords(events: ConflictEvent[]): { records: TemporalRecord[]; coverage: IncidentTemporalCoverage } {
  const records: TemporalRecord[] = [];
  let preciseCount = 0;
  let dayCount = 0;
  let rangeCount = 0;
  let retainedReportCount = 0;
  let start = Number.POSITIVE_INFINITY;
  let endExclusive = 0;
  let longestUncertaintyMs = 0;

  events.forEach((event, eventIndex) => {
    const window = resolveIncidentOccurrenceWindow(event);
    retainedReportCount += Math.max(1, event.incident?.memberCount ?? 1);
    if (!window) return;
    records.push({ event, eventIndex, window, firstFrame: 0, lastFrame: 0 });
    if (window.precision === "second") preciseCount += 1;
    if (window.precision === "day") dayCount += 1;
    if (window.precision === "range") rangeCount += 1;
    start = Math.min(start, window.start);
    endExclusive = Math.max(endExclusive, window.endExclusive);
    longestUncertaintyMs = Math.max(longestUncertaintyMs, window.endExclusive - window.start);
  });

  if (records.length === 0) {
    return { records, coverage: emptyCoverage(events.length) };
  }

  return {
    records,
    coverage: {
      inputEventCount: events.length,
      validEventCount: records.length,
      invalidTimeCount: events.length - records.length,
      preciseCount,
      dayCount,
      rangeCount,
      impreciseCount: dayCount + rangeCount,
      retainedReportCount,
      start,
      endExclusive,
      longestUncertaintyMs,
    },
  };
}

export function measureIncidentTemporalCoverage(events: ConflictEvent[]): IncidentTemporalCoverage {
  return collectTemporalRecords(events).coverage;
}

function floorToResolution(timestamp: number, resolution: TemporalResolutionKey): number {
  const date = new Date(timestamp);
  if (resolution === "week") {
    const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    return dayStart - mondayOffset * DAY_MS;
  }
  if (resolution === "day") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  if (resolution === "sixHour") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(date.getUTCHours() / 6) * 6);
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
}

function ceilToResolution(timestamp: number, resolution: TemporalResolutionKey): number {
  const floor = floorToResolution(timestamp, resolution);
  if (floor === timestamp) return timestamp;
  return floor + TEMPORAL_RESOLUTIONS[resolution].stepMs;
}

function countAlignedFrames(domainStart: number, domainEndExclusive: number, resolution: TemporalResolutionKey): number {
  return Math.max(1, Math.ceil((domainEndExclusive - domainStart) / TEMPORAL_RESOLUTIONS[resolution].stepMs));
}

export function chooseAutomaticResolution(spanMs: number, targetFrames = 96): TemporalResolutionKey {
  for (const key of RESOLUTION_ORDER) {
    if (Math.ceil(spanMs / TEMPORAL_RESOLUTIONS[key].stepMs) <= targetFrames) return key;
  }
  return "week";
}

export interface BuildTemporalAnalysisOptions {
  resolution?: TemporalResolutionPreference;
  targetFrames?: number;
  /** Manual resolutions that would produce more frames than this are coerced back to auto so the histogram remains legible. */
  maxManualFrames?: number;
}

export interface TemporalFrameAggregate {
  index: number;
  key: string;
  label: string;
  start: number;
  endExclusive: number;
  /** Unique incidents whose uncertainty window starts in this frame. Every valid incident is counted exactly once across the histogram. */
  startCount: number;
  startImpreciseCount: number;
  startCriticalCount: number;
  /** Interval memberships intersecting this frame. Imprecise windows can contribute to multiple frames; this is exposure, not a unique-incident total. */
  activeCount: number;
  activeImpreciseCount: number;
  activeCriticalCount: number;
  activeCorroboratedCount: number;
  activeContestedCount: number;
  activeEvidenceReportCount: number;
}

export interface IncidentTemporalAnalysis {
  events: ConflictEvent[];
  coverage: IncidentTemporalCoverage;
  requestedResolution: TemporalResolutionPreference;
  resolution: TemporalResolutionKey;
  resolutionCoerced: boolean;
  resolutionNotice: string | null;
  stepMs: number;
  domainStart: number;
  domainEndExclusive: number;
  frameCount: number;
  frames: TemporalFrameAggregate[];
  /** Compressed sparse row membership matrix: row offsets per frame, event indices per intersecting uncertainty window. */
  membershipOffsets: Uint32Array;
  membershipIndices: Uint32Array;
  byStartIndices: Uint32Array;
  sortedStarts: Float64Array;
  startRankByEventIndex: Uint32Array;
  maxStartCount: number;
  totalMembershipCount: number;
}

function emptyAnalysis(events: ConflictEvent[], requestedResolution: TemporalResolutionPreference): IncidentTemporalAnalysis {
  const coverage = emptyCoverage(events.length);
  return {
    events,
    coverage,
    requestedResolution,
    resolution: "day",
    resolutionCoerced: false,
    resolutionNotice: null,
    stepMs: DAY_MS,
    domainStart: 0,
    domainEndExclusive: 0,
    frameCount: 0,
    frames: [],
    membershipOffsets: new Uint32Array(0),
    membershipIndices: new Uint32Array(0),
    byStartIndices: new Uint32Array(0),
    sortedStarts: new Float64Array(0),
    startRankByEventIndex: new Uint32Array(0),
    maxStartCount: 0,
    totalMembershipCount: 0,
  };
}

function frameLabel(start: number, resolution: TemporalResolutionKey): string {
  const date = new Date(start);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  if (resolution === "hour") return `${month}/${day} ${hour}:00`;
  if (resolution === "sixHour") return `${month}/${day} ${hour}:00`;
  if (resolution === "week") return `week of ${month}/${day}`;
  return `${month}/${day}`;
}

export function buildIncidentTemporalAnalysis(
  events: ConflictEvent[],
  options: BuildTemporalAnalysisOptions = {},
): IncidentTemporalAnalysis {
  const requestedResolution = options.resolution ?? "auto";
  const { records, coverage } = collectTemporalRecords(events);
  if (records.length === 0) return emptyAnalysis(events, requestedResolution);

  const targetFrames = Math.max(16, options.targetFrames ?? 96);
  const maxManualFrames = Math.max(targetFrames, options.maxManualFrames ?? 240);
  const rawSpanMs = Math.max(1, coverage.endExclusive - coverage.start);
  let resolution = requestedResolution === "auto"
    ? chooseAutomaticResolution(rawSpanMs, targetFrames)
    : requestedResolution;
  let resolutionCoerced = false;
  let resolutionNotice: string | null = null;

  if (requestedResolution !== "auto") {
    const requestedFrameCount = Math.ceil(rawSpanMs / TEMPORAL_RESOLUTIONS[requestedResolution].stepMs);
    if (requestedFrameCount > maxManualFrames) {
      resolution = chooseAutomaticResolution(rawSpanMs, targetFrames);
      resolutionCoerced = resolution !== requestedResolution;
      resolutionNotice = `${TEMPORAL_RESOLUTIONS[requestedResolution].label} resolution would create ${requestedFrameCount.toLocaleString()} frames; using ${TEMPORAL_RESOLUTIONS[resolution].label.toLowerCase()} resolution so dense coverage remains legible`;
    }
  }

  const stepMs = TEMPORAL_RESOLUTIONS[resolution].stepMs;
  const domainStart = floorToResolution(coverage.start, resolution);
  let domainEndExclusive = ceilToResolution(coverage.endExclusive, resolution);
  if (domainEndExclusive <= domainStart) domainEndExclusive = domainStart + stepMs;
  const frameCount = countAlignedFrames(domainStart, domainEndExclusive, resolution);

  const orderedRecords = [...records].sort((a, b) =>
    (a.window.start - b.window.start)
    || (a.window.endExclusive - b.window.endExclusive)
    || a.event.id.localeCompare(b.event.id)
    || (a.eventIndex - b.eventIndex)
  );

  const membershipCounts = new Uint32Array(frameCount);
  const startCounts = new Uint32Array(frameCount);
  const startImpreciseCounts = new Uint32Array(frameCount);
  const startCriticalCounts = new Uint32Array(frameCount);
  const activeImpreciseCounts = new Uint32Array(frameCount);
  const activeCriticalCounts = new Uint32Array(frameCount);
  const activeCorroboratedCounts = new Uint32Array(frameCount);
  const activeContestedCounts = new Uint32Array(frameCount);
  const activeEvidenceReportCounts = new Uint32Array(frameCount);
  let totalMembershipCount = 0;

  for (const record of orderedRecords) {
    const firstFrame = Math.min(frameCount - 1, Math.max(0, Math.floor((record.window.start - domainStart) / stepMs)));
    const lastFrame = Math.min(frameCount - 1, Math.max(0, Math.floor((record.window.endExclusive - 1 - domainStart) / stepMs)));
    record.firstFrame = firstFrame;
    record.lastFrame = Math.max(firstFrame, lastFrame);
    const frameSpan = record.lastFrame - firstFrame + 1;
    totalMembershipCount += frameSpan;

    const imprecise = record.window.precision !== "second" ? 1 : 0;
    const critical = record.event.severity === "critical" ? 1 : 0;
    const corroborated = record.event.incident?.confidence === "corroborated" ? 1 : 0;
    const contested = record.event.incident?.confidence === "contested" ? 1 : 0;
    const evidenceReports = Math.max(1, record.event.incident?.memberCount ?? 1);

    startCounts[firstFrame] += 1;
    startImpreciseCounts[firstFrame] += imprecise;
    startCriticalCounts[firstFrame] += critical;

    for (let frame = firstFrame; frame <= record.lastFrame; frame += 1) {
      membershipCounts[frame] += 1;
      activeImpreciseCounts[frame] += imprecise;
      activeCriticalCounts[frame] += critical;
      activeCorroboratedCounts[frame] += corroborated;
      activeContestedCounts[frame] += contested;
      activeEvidenceReportCounts[frame] += evidenceReports;
    }
  }

  const membershipOffsets = new Uint32Array(frameCount + 1);
  for (let frame = 0; frame < frameCount; frame += 1) {
    membershipOffsets[frame + 1] = membershipOffsets[frame] + membershipCounts[frame];
  }
  const membershipIndices = new Uint32Array(totalMembershipCount);
  const fillCursor = new Uint32Array(frameCount);
  for (const record of orderedRecords) {
    for (let frame = record.firstFrame; frame <= record.lastFrame; frame += 1) {
      const destination = membershipOffsets[frame] + fillCursor[frame];
      membershipIndices[destination] = record.eventIndex;
      fillCursor[frame] += 1;
    }
  }

  const byStartIndices = new Uint32Array(orderedRecords.length);
  const sortedStarts = new Float64Array(orderedRecords.length);
  const startRankByEventIndex = new Uint32Array(events.length);
  orderedRecords.forEach((record, rank) => {
    byStartIndices[rank] = record.eventIndex;
    sortedStarts[rank] = record.window.start;
    startRankByEventIndex[record.eventIndex] = rank;
  });

  const frames: TemporalFrameAggregate[] = [];
  let maxStartCount = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = domainStart + frame * stepMs;
    maxStartCount = Math.max(maxStartCount, startCounts[frame]);
    frames.push({
      index: frame,
      key: `${resolution}-${start}`,
      label: frameLabel(start, resolution),
      start,
      endExclusive: start + stepMs,
      startCount: startCounts[frame],
      startImpreciseCount: startImpreciseCounts[frame],
      startCriticalCount: startCriticalCounts[frame],
      activeCount: membershipCounts[frame],
      activeImpreciseCount: activeImpreciseCounts[frame],
      activeCriticalCount: activeCriticalCounts[frame],
      activeCorroboratedCount: activeCorroboratedCounts[frame],
      activeContestedCount: activeContestedCounts[frame],
      activeEvidenceReportCount: activeEvidenceReportCounts[frame],
    });
  }

  return {
    events,
    coverage,
    requestedResolution,
    resolution,
    resolutionCoerced,
    resolutionNotice,
    stepMs,
    domainStart,
    domainEndExclusive,
    frameCount,
    frames,
    membershipOffsets,
    membershipIndices,
    byStartIndices,
    sortedStarts,
    startRankByEventIndex,
    maxStartCount,
    totalMembershipCount,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lowerBound(sorted: Float64Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export interface PlaybackExtraction {
  mode: PlaybackMode;
  frameIndex: number;
  frame: TemporalFrameAggregate;
  effectiveStart: number;
  effectiveEndExclusive: number;
  frameQuantized: boolean;
  eventIndices: number[];
  events: ConflictEvent[];
}

export function collectPlaybackEvents(
  analysis: IncidentTemporalAnalysis,
  requestedFrameIndex: number,
  mode: PlaybackMode,
  trailingFrames = 1,
): PlaybackExtraction | null {
  if (analysis.frameCount === 0) return null;
  const frameIndex = clamp(Math.trunc(requestedFrameIndex), 0, analysis.frameCount - 1);
  const frame = analysis.frames[frameIndex];
  let eventIndices: number[] = [];
  let firstFrame = frameIndex;

  if (mode === "cumulative") {
    const startedCount = lowerBound(analysis.sortedStarts, frame.endExclusive);
    eventIndices = Array.from(analysis.byStartIndices.slice(0, startedCount));
  } else if (mode === "step") {
    const offset = analysis.membershipOffsets[frameIndex];
    const end = analysis.membershipOffsets[frameIndex + 1];
    eventIndices = Array.from(analysis.membershipIndices.slice(offset, end));
  } else {
    firstFrame = Math.max(0, frameIndex - Math.max(1, Math.trunc(trailingFrames)) + 1);
    const seen = new Uint8Array(analysis.events.length);
    const collected: number[] = [];
    for (let index = firstFrame; index <= frameIndex; index += 1) {
      const offset = analysis.membershipOffsets[index];
      const end = analysis.membershipOffsets[index + 1];
      for (let cursor = offset; cursor < end; cursor += 1) {
        const eventIndex = analysis.membershipIndices[cursor];
        if (seen[eventIndex]) continue;
        seen[eventIndex] = 1;
        collected.push(eventIndex);
      }
    }
    collected.sort((a, b) => analysis.startRankByEventIndex[a] - analysis.startRankByEventIndex[b]);
    eventIndices = collected;
  }

  return {
    mode,
    frameIndex,
    frame,
    effectiveStart: mode === "cumulative" ? analysis.coverage.start : analysis.frames[firstFrame].start,
    effectiveEndExclusive: frame.endExclusive,
    frameQuantized: mode === "trailing",
    eventIndices,
    events: eventIndices.map((eventIndex) => analysis.events[eventIndex]),
  };
}

export interface PlaybackEventSummary {
  count: number;
  criticalCount: number;
  highCount: number;
  uncertainTimeCount: number;
  corroboratedCount: number;
  contestedCount: number;
  inferredCount: number;
  singleSourceCount: number;
  retainedReportCount: number;
}

export function summarizePlaybackEvents(events: ConflictEvent[]): PlaybackEventSummary {
  const summary: PlaybackEventSummary = {
    count: events.length,
    criticalCount: 0,
    highCount: 0,
    uncertainTimeCount: 0,
    corroboratedCount: 0,
    contestedCount: 0,
    inferredCount: 0,
    singleSourceCount: 0,
    retainedReportCount: 0,
  };
  for (const event of events) {
    if (event.severity === "critical") summary.criticalCount += 1;
    if (event.severity === "high") summary.highCount += 1;
    const occurrence = resolveIncidentOccurrenceWindow(event);
    if (occurrence && occurrence.precision !== "second") summary.uncertainTimeCount += 1;
    if (event.incident?.confidence === "corroborated") summary.corroboratedCount += 1;
    if (event.incident?.confidence === "contested") summary.contestedCount += 1;
    if (event.incident?.confidence === "inferred") summary.inferredCount += 1;
    if (event.incident?.confidence === "single-source") summary.singleSourceCount += 1;
    summary.retainedReportCount += Math.max(1, event.incident?.memberCount ?? 1);
  }
  return summary;
}

export function formatUtcExact(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "unknown";
  return `${new Date(timestamp).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s";
  if (durationMs % WEEK_MS === 0) return `${durationMs / WEEK_MS}w`;
  if (durationMs % DAY_MS === 0) return `${durationMs / DAY_MS}d`;
  if (durationMs % HOUR_MS === 0) return `${durationMs / HOUR_MS}h`;
  if (durationMs % (60 * 1000) === 0) return `${durationMs / (60 * 1000)}m`;
  if (durationMs >= DAY_MS) return `${(durationMs / DAY_MS).toFixed(1)}d`;
  if (durationMs >= HOUR_MS) return `${(durationMs / HOUR_MS).toFixed(1)}h`;
  return `${Math.round(durationMs / 1000)}s`;
}
