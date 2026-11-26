import type {
  ConflictEvent,
  ConflictFilters,
  DomainConvergenceAnalysis,
  EscalationSurgeAnalysis,
  IncidentContradiction,
  IncidentCorrelationStats,
  IncidentEvidenceMember,
  IncidentOccurrenceWindow,
  IncidentMembership,
  OsintSnapshot,
  UcdpGedEventMetadata,
  WatchEvaluationResult,
  WatchRule,
} from "@/types/conflict";
import type { OsintSnapshotRuntime } from "@/lib/osintSnapshotChunks";
import {
  encodeOperatorUrlState,
  looksLikeSecretMaterial,
  sanitizeOperatorQuery,
  OPERATOR_URL_STATE_VERSION,
  type OperatorUrlState,
} from "@/lib/operatorUrlState";

/**
 * Comprehensive analyst export bundles and evidence handoff (catalog batch 11).
 *
 * Design contract:
 * - Pure and deterministic. No DOM, no network, no randomness, no wall-clock reads inside
 *   the builders: every timestamp comes from caller-supplied inputs. Given the same input
 *   the output is byte-stable, and arrays are re-sorted on deterministic keys so even input
 *   ordering differences cannot leak into the artifact.
 * - Circular-reference safety by construction. Incident rows are projected scalar-by-scalar
 *   into fresh objects; evidence members are embedded exactly one level deep and never carry
 *   a nested evidence cluster (the correlation engine never produces one, and adversarial
 *   nesting is stripped rather than serialized). Engine-output sections (convergence, surge,
 *   watch) are cloned through a JSON round-trip guard; a section that cannot serialize is
 *   excluded with an explicit honesty note rather than crashing or partially corrupting the
 *   handoff.
 * - No fabrication. Missing inputs become explicit nulls, empty arrays, and explanatory
 *   notes — never invented values. Derived fields are limited to deterministic UTC
 *   reformatting of timestamps the input already carries, and are suffixed `Utc`.
 * - No secrets and no secret-shaped text. The operator search text is passed through the
 *   same validator the permalink codec uses; secret-shaped or control-character queries are
 *   withheld and the redaction is disclosed. Browser-local irrelevant state (watch alert
 *   dismiss/snooze lifecycle, untriggered rule definitions, transient transport positions)
 *   is excluded and the exclusions are itemized inside the bundle.
 * - Epistemic honesty. Every artifact states that the content is unverified OSINT, carries
 *   no operational authority, is statistical rather than predictive, and that convergence is
 *   co-occurrence rather than causation. Attribution/licensing caveats travel with the export.
 */

export const ANALYST_EXPORT_SCHEMA_VERSION = "godseye-analyst-export/v1";

export const ANALYST_EXPORT_UNVERIFIED_CAVEAT =
  "UNVERIFIED OSINT: every incident, cluster, signal, and alert in this export derives from public open-source reporting and automated ingestion. Content is unverified, may be incomplete, duplicated, contradicted, or wrong, and absence of evidence in this export is not evidence of absence.";

export const ANALYST_EXPORT_NO_AUTHORITY_CAVEAT =
  "NO OPERATIONAL AUTHORITY: this export is an analytical review aid only. It is not intelligence tasking, not a warning order, not a prediction, and not authority to act. Nothing in it may be used as the sole basis for any operational, targeting, or safety-critical decision.";

export const ANALYST_EXPORT_ATTRIBUTION_CAVEAT =
  "Attribution and licensing: WarHeatMap is CC BY 4.0; UCDP/Map of Wars, NASA, USGS, ADSB.lol, gpsjam.org, Launch Library, CISA, NIST NVD, FIRST EPSS, ReliefWeb/OCHA/original publishing organizations, and other public feeds retain their own terms. ReliefWeb Terms restrict redistribution/compilation; this export carries factual metadata/provenance only and no ReliefWeb narrative, attachments, or images. Geolocated news mentions are courtesy of The GDELT Project (https://www.gdeltproject.org/) — citation is required by GDELT terms of use. Redistribution of this export must preserve these attributions.";

/** Safety-valve caps. They are sized so honest corpora essentially never hit them; when they
 *  are hit the truncation is counted and disclosed rather than silent. */
export const MAX_EXPORT_INCIDENTS = 2500;
export const MAX_EXPORT_EVIDENCE_MEMBERS_PER_CLUSTER = 400;
export const MAX_EXPORT_CONVERGENCE_CARDS = 1200;
export const MAX_EXPORT_SURGE_SIGNALS = 400;
export const MAX_EXPORT_WATCH_ALERTS = 200;
export const MAX_MARKDOWN_INCIDENT_ROWS = 120;
export const MAX_MARKDOWN_EVIDENCE_MEMBERS_PER_CLUSTER = 12;
export const MAX_MARKDOWN_FINDINGS_PER_DOMAIN = 2;

/* ------------------------------------------------------------------------- */
/* UTC time formatting — every artifact timestamp is explicit UTC.            */
/* ------------------------------------------------------------------------- */

/** Strict ISO-8601 UTC string for a finite epoch-ms timestamp, null otherwise. */
export function utcIso(timestampMs: number | null | undefined): string | null {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) return null;
  return new Date(timestampMs).toISOString();
}

/** Filename-safe UTC stamp, e.g. 2026-11-26-12-00-00Z. */
export function utcFilenameStamp(timestampMs: number): string {
  const iso = utcIso(timestampMs) ?? new Date(0).toISOString();
  return `${iso.slice(0, 19).replace(/[:T]/g, "-")}Z`;
}

export function analystExportFilename(kind: "bundle-json" | "brief-markdown" | "incidents-csv", generatedAtMs: number): string {
  const stamp = utcFilenameStamp(generatedAtMs);
  switch (kind) {
    case "bundle-json": return `godseye-analyst-bundle-${stamp}.json`;
    case "brief-markdown": return `godseye-analyst-brief-${stamp}.md`;
    case "incidents-csv": return `godseye-incidents-${stamp}.csv`;
  }
}

/* ------------------------------------------------------------------------- */
/* Input types                                                                */
/* ------------------------------------------------------------------------- */

export interface AnalystExportPlaybackScope {
  active: boolean;
  playing: boolean;
  mode: string;
  frameIndex: number | null;
  frameStart: number | null;
  frameEndExclusive: number | null;
  speedMultiplier: number;
  resolutionPreference: string;
  trailHours: number;
  /** Incidents inside the current playback lens when active. Never used to narrow export scope. */
  frameEventCount: number | null;
}

export interface AnalystExportFeedProvenance {
  source: "live" | "fallback" | null;
  lastUpdated: number | null;
  error: string | null;
  correlation: IncidentCorrelationStats | null;
}

export interface AnalystExportInput {
  /** Caller-supplied generation time in epoch ms. The only clock in the system. */
  generatedAt: number;
  /** Fully-formed shareable permalink, or null when the operator state could not encode. */
  permalink: string | null;
  operatorState: OperatorUrlState;
  filters: ConflictFilters;
  playback: AnalystExportPlaybackScope | null;
  /** Filtered canonical incidents constituting the export scope. */
  events: ConflictEvent[];
  /** Canonical incidents in the loaded corpus before filtering. */
  corpusIncidentCount: number;
  feed: AnalystExportFeedProvenance;
  snapshot: OsintSnapshot;
  /** Domain-chunk load/completeness/staleness state at export time. Optional only for legacy callers/tests. */
  snapshotRuntime?: OsintSnapshotRuntime | null;
  convergence: DomainConvergenceAnalysis | null;
  /** Convergence co-occurrence disclaimer verbatim from the engine; cards carry it per-card but the analysis type does not. */
  convergenceDisclaimer?: string | null;
  surge: EscalationSurgeAnalysis | null;
  watchEvaluation: WatchEvaluationResult | null;
  watchRules: WatchRule[];
}

/* ------------------------------------------------------------------------- */
/* Small deterministic helpers                                                */
/* ------------------------------------------------------------------------- */

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Clone engine-output sections through a strict JSON round trip. Returns null when the
 * section cannot serialize (a circular or otherwise hostile structure); the caller then
 * drops the section and discloses the drop. Plain engine output never fails this guard.
 */
function cloneJsonSection<T>(value: T): T | null {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") return null;
    return JSON.parse(serialized) as T;
  } catch {
    return null;
  }
}

function scalarOrNull(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/* ------------------------------------------------------------------------- */
/* Incident projection — circular safety is constructive, not incidental.     */
/* ------------------------------------------------------------------------- */

export interface ExportableOccurrenceWindow {
  startMs: number;
  endExclusiveMs: number;
  startUtc: string | null;
  endExclusiveUtc: string | null;
  precision: IncidentOccurrenceWindow["precision"];
  basis: IncidentOccurrenceWindow["basis"];
  label: string;
}

export interface ExportableEvidenceMember {
  sourceFamily: string;
  correlationScore: number;
  rationale: string[];
  event: ExportableIncident;
}

export interface ExportableIncident {
  id: string;
  lat: number;
  lng: number;
  precision: number | null;
  severity: string;
  category: string;
  categoryGroup: string;
  date: string;
  occurredAtMs: number;
  occurredAtUtc: string | null;
  updatedAtMs: number;
  updatedAtUtc: string | null;
  killed: number;
  countedCasualties: number;
  displaced: number;
  country: string;
  conflict: string;
  theater: string;
  region: string;
  title: string;
  detail: string | null;
  verified: boolean;
  intensity: number;
  sourceFamily: string;
  sourceName: string | null;
  sourceUrl: string | null;
  sources: { name: string; url: string }[];
  occurrence: ExportableOccurrenceWindow | null;
  ucdp: Record<string, string | number | boolean | null> | null;
  incident: IncidentMembership | null;
  evidence: {
    clusterId: string;
    canonicalEventId: string;
    algorithmVersion: string;
    confidence: string;
    confidenceReason: string;
    sourceFamilies: string[];
    independentFamilyCount: number;
    memberCount: number;
    contradictions: IncidentContradiction[];
    members: ExportableEvidenceMember[];
    truncatedMemberCount: number;
  } | null;
}

function projectOccurrence(window: IncidentOccurrenceWindow | undefined): ExportableOccurrenceWindow | null {
  if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.endExclusive)) return null;
  return {
    startMs: window.start,
    endExclusiveMs: window.endExclusive,
    startUtc: utcIso(window.start),
    endExclusiveUtc: utcIso(window.endExclusive),
    precision: window.precision,
    basis: window.basis,
    label: typeof window.label === "string" ? window.label : "",
  };
}

function projectUcdp(ucdp: UcdpGedEventMetadata | undefined): Record<string, string | number | boolean | null> | null {
  if (!ucdp || !isPlainObject(ucdp)) return null;
  // Scalar-only projection: every UCDP GED field is scalar by schema, so nothing legitimate
  // is lost; adversarially nested objects/arrays (a circularity vector) are dropped outright
  // rather than carried as references.
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(ucdp).sort()) {
    const value = (ucdp as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (value !== null && typeof value === "object") continue;
    out[key] = scalarOrNull(value);
  }
  return out;
}

function projectMembership(membership: IncidentMembership | undefined): IncidentMembership | null {
  if (!membership || !isPlainObject(membership)) return null;
  return {
    clusterId: String(membership.clusterId ?? ""),
    canonicalEventId: String(membership.canonicalEventId ?? ""),
    isCanonical: membership.isCanonical === true,
    correlationScore: typeof membership.correlationScore === "number" ? membership.correlationScore : 0,
    confidence: membership.confidence,
    memberCount: typeof membership.memberCount === "number" ? membership.memberCount : 1,
    independentFamilyCount: typeof membership.independentFamilyCount === "number" ? membership.independentFamilyCount : 1,
    rationale: Array.isArray(membership.rationale) ? membership.rationale.filter((line): line is string => typeof line === "string") : [],
  };
}

function projectContradictions(contradictions: IncidentContradiction[] | undefined): IncidentContradiction[] {
  if (!Array.isArray(contradictions)) return [];
  return contradictions
    .filter((item) => isPlainObject(item))
    .map((item) => ({
      kind: item.kind,
      summary: typeof item.summary === "string" ? item.summary : "",
      memberEventIds: Array.isArray(item.memberEventIds)
        ? item.memberEventIds.filter((id): id is string => typeof id === "string").sort(compareStrings)
        : [],
    }))
    .sort((a, b) => compareStrings(a.kind, b.kind) || compareStrings(a.summary, b.summary));
}

/**
 * Project one incident into a fresh, acyclic export object. `embedEvidence` is true only
 * for top-level canonical rows; member rows are always projected without their own evidence
 * key, so cluster embedding is exactly one level deep by construction.
 */
export function projectIncidentForExport(event: ConflictEvent, embedEvidence: boolean): ExportableIncident {
  const sources = Array.isArray(event.sources)
    ? event.sources
      .filter((source) => isPlainObject(source) && typeof source.name === "string" && typeof source.url === "string")
      .map((source) => ({ name: source.name, url: source.url }))
    : [];

  const projected: ExportableIncident = {
    id: String(event.id ?? ""),
    lat: typeof event.lat === "number" ? event.lat : 0,
    lng: typeof event.lng === "number" ? event.lng : 0,
    precision: typeof event.precision === "number" ? event.precision : null,
    severity: String(event.severity ?? ""),
    category: String(event.category ?? ""),
    categoryGroup: String(event.categoryGroup ?? ""),
    date: String(event.date ?? ""),
    occurredAtMs: typeof event.occurredAt === "number" ? event.occurredAt : 0,
    occurredAtUtc: utcIso(event.occurredAt),
    updatedAtMs: typeof event.updatedAt === "number" ? event.updatedAt : 0,
    updatedAtUtc: utcIso(event.updatedAt),
    killed: typeof event.killed === "number" ? event.killed : 0,
    countedCasualties: typeof event.countedCasualties === "number" ? event.countedCasualties : 0,
    displaced: typeof event.displaced === "number" ? event.displaced : 0,
    country: String(event.country ?? ""),
    conflict: String(event.conflict ?? ""),
    theater: String(event.theater ?? ""),
    region: String(event.region ?? ""),
    title: String(event.title ?? ""),
    detail: typeof event.detail === "string" ? event.detail : null,
    verified: event.verified === true,
    intensity: typeof event.intensity === "number" ? event.intensity : 0,
    sourceFamily: typeof event.sourceFamily === "string" ? event.sourceFamily : "unknown",
    sourceName: typeof event.sourceName === "string" ? event.sourceName : null,
    sourceUrl: typeof event.sourceUrl === "string" ? event.sourceUrl : null,
    sources,
    occurrence: projectOccurrence(event.occurrence),
    ucdp: projectUcdp(event.ucdp),
    incident: projectMembership(event.incident),
    evidence: null,
  };

  if (!embedEvidence || !event.evidence || !isPlainObject(event.evidence)) return projected;

  const cluster = event.evidence;
  const rawMembers = Array.isArray(cluster.members) ? cluster.members : [];
  const sortedMembers = rawMembers
    .filter((member): member is IncidentEvidenceMember => isPlainObject(member) && isPlainObject(member.event))
    .sort((a, b) =>
      (typeof b.correlationScore === "number" ? b.correlationScore : 0) - (typeof a.correlationScore === "number" ? a.correlationScore : 0)
      || compareStrings(String(a.event.id ?? ""), String(b.event.id ?? ""))
    );
  const retainedMembers = sortedMembers.slice(0, MAX_EXPORT_EVIDENCE_MEMBERS_PER_CLUSTER);

  projected.evidence = {
    clusterId: String(cluster.clusterId ?? ""),
    canonicalEventId: String(cluster.canonicalEventId ?? ""),
    algorithmVersion: String(cluster.algorithmVersion ?? ""),
    confidence: String(cluster.confidence ?? ""),
    confidenceReason: typeof cluster.confidenceReason === "string" ? cluster.confidenceReason : "",
    sourceFamilies: Array.isArray(cluster.sourceFamilies) ? cluster.sourceFamilies.map(String).sort(compareStrings) : [],
    independentFamilyCount: typeof cluster.independentFamilyCount === "number" ? cluster.independentFamilyCount : 1,
    memberCount: typeof cluster.memberCount === "number" ? cluster.memberCount : retainedMembers.length + 1,
    contradictions: projectContradictions(cluster.contradictions),
    members: retainedMembers.map((member) => ({
      sourceFamily: String(member.sourceFamily ?? "unknown"),
      correlationScore: typeof member.correlationScore === "number" ? member.correlationScore : 0,
      rationale: Array.isArray(member.rationale) ? member.rationale.filter((line): line is string => typeof line === "string") : [],
      // Depth-1 embedding: member rows never carry a nested evidence key in the export.
      event: projectIncidentForExport(member.event, false),
    })),
    truncatedMemberCount: sortedMembers.length - retainedMembers.length,
  };
  return projected;
}

/* ------------------------------------------------------------------------- */
/* Permalink                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Build the shareable permalink for the current operator state. `baseUrl` is the caller's
 * origin+path+search (no trailing hash). Returns null when the state cannot encode inside
 * the fragment guardrail — the export then says so rather than fabricating a link.
 */
export function buildShareablePermalink(operatorState: OperatorUrlState, baseUrl: string): string | null {
  const fragment = encodeOperatorUrlState(operatorState);
  if (!fragment) return null;
  const base = typeof baseUrl === "string" ? baseUrl.replace(/#.*$/, "") : "";
  if (!base) return null;
  return `${base}#${fragment}`;
}

/* ------------------------------------------------------------------------- */
/* Bundle assembly                                                            */
/* ------------------------------------------------------------------------- */

export interface AnalystExportTruncation {
  truncated: boolean;
  incidentsDropped: number;
  convergenceCardsDropped: number;
  surgeSignalsDropped: number;
  watchAlertsDropped: number;
  evidenceMembersDropped: number;
  notes: string[];
}

export interface AnalystExportBundle {
  schemaVersion: typeof ANALYST_EXPORT_SCHEMA_VERSION;
  generatedAtUtc: string;
  generator: {
    application: string;
    artifactKind: string;
    clientSideOnly: boolean;
    algorithmVersions: Record<string, string | number>;
  };
  caveats: {
    unverifiedOsint: string;
    noOperationalAuthority: string;
    statisticalNotPredictive: string | null;
    convergenceNotCausal: string | null;
    watchReviewAidOnly: string | null;
    attributionLicensing: string;
  };
  permalink: {
    url: string | null;
    fragmentSchemaVersion: number;
    note: string;
  };
  scope: {
    filters: {
      timeWindow: string;
      categoryGroups: string[];
      severities: string[];
      theater: string | null;
      query: string | null;
      queryWithheld: boolean;
      queryNote: string | null;
    };
    operator: {
      visualMode: string;
      enabledLayers: string[];
      refreshPaused: boolean;
      selectedEventId: string | null;
      panels: { theater: boolean; incident: boolean; source: boolean; inspector: string };
      camera: { lat: number; lng: number; altitude: number } | null;
    };
    playback: (AnalystExportPlaybackScope & {
      frameStartUtc: string | null;
      frameEndExclusiveUtc: string | null;
      scopeNote: string;
    }) | null;
    incidentCounts: {
      exportedIncidents: number;
      inScopeIncidents: number;
      corpusIncidents: number;
      exportedEvidenceMembers: number;
    };
  };
  provenance: {
    feed: {
      source: string;
      fetchedAtUtc: string | null;
      error: string | null;
    };
    correlation: IncidentCorrelationStats | null;
    snapshot: {
      fetchedAt: string;
      sources: Record<string, string>;
      errors: string[];
      domainCounts: Record<string, number>;
      domainChunkCompleteness: unknown;
      ucdpMeta: unknown;
      gdeltGeoMeta: unknown;
      internetOutageMeta: unknown;
      cyberVulnerabilityMeta: unknown;
      reliefwebMeta: unknown;
      droppedSections: string[];
    };
    retrievalTimestampsUtc: Record<string, string | null>;
  };
  incidents: ExportableIncident[];
  convergenceCards: unknown[];
  convergenceContext: {
    included: boolean;
    algorithmVersion: string | null;
    analysisGaps: unknown[];
    globalNotes: string[];
    stats: unknown;
    note: string;
  };
  surge: {
    included: boolean;
    algorithmVersion: string | null;
    analysisEndUtc: string | null;
    recentWindow: { startUtc: string | null; endExclusiveUtc: string | null; label: string } | null;
    baselineWindow: { startUtc: string | null; endExclusiveUtc: string | null; label: string } | null;
    signals: unknown[];
    signalCount: number;
    totalSignalCount: number;
    globalNotes: string[];
    stats: unknown;
    disclaimer: string | null;
    note: string;
  };
  watch: {
    included: boolean;
    algorithmVersion: string | null;
    evaluatedAtUtc: string | null;
    alerts: unknown[];
    evaluations: unknown[];
    triggeredRuleDefinitions: unknown[];
    stats: unknown;
    disclaimer: string | null;
    note: string;
  };
  exclusions: string[];
  truncation: AnalystExportTruncation;
  exportContents: string[];
}

function sortObjectByKeys<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort(compareStrings)) out[key] = record[key];
  return out;
}

function sanitizedQueryNote(rawQuery: string): { query: string | null; withheld: boolean; note: string | null } {
  const trimmed = (rawQuery ?? "").trim();
  if (!trimmed) return { query: null, withheld: false, note: null };
  const sanitized = sanitizeOperatorQuery(rawQuery);
  if (sanitized) return { query: sanitized, withheld: false, note: null };
  if (looksLikeSecretMaterial(trimmed)) {
    return {
      query: null,
      withheld: true,
      note: "the active search text matched secret-shaped patterns (tokens, keys, bearer material) and was withheld from this export exactly as it is withheld from permalinks; the filter scope it produced is still visible in the incident rows themselves",
    };
  }
  return {
    query: null,
    withheld: true,
    note: "the active search text was withheld because it was over-length or contained control characters; the filter scope it produced is still visible in the incident rows themselves",
  };
}

function sortSignalsDesc(signals: unknown[]): unknown[] {
  return [...signals].sort((a, b) => {
    const sa = a as { indicatorScore?: number; evidenceSupport?: number; id?: string };
    const sb = b as { indicatorScore?: number; evidenceSupport?: number; id?: string };
    return (typeof sb.indicatorScore === "number" ? sb.indicatorScore : 0) - (typeof sa.indicatorScore === "number" ? sa.indicatorScore : 0)
      || (typeof sb.evidenceSupport === "number" ? sb.evidenceSupport : 0) - (typeof sa.evidenceSupport === "number" ? sa.evidenceSupport : 0)
      || compareStrings(String(sa.id ?? ""), String(sb.id ?? ""));
  });
}

function sortAlerts(alerts: unknown[]): unknown[] {
  const emphasisRank = (value: unknown): number => {
    const emphasis = (value as { emphasis?: string })?.emphasis;
    return emphasis === "elevated" ? 0 : 1;
  };
  return [...alerts].sort((a, b) =>
    emphasisRank(a) - emphasisRank(b)
    || compareStrings(String((a as { fingerprint?: string })?.fingerprint ?? ""), String((b as { fingerprint?: string })?.fingerprint ?? ""))
  );
}

function sortConvergenceCards(cards: unknown[]): unknown[] {
  return [...cards].sort((a, b) => {
    const ca = a as { convergenceIndex?: number; eventId?: string };
    const cb = b as { convergenceIndex?: number; eventId?: string };
    return (typeof cb.convergenceIndex === "number" ? cb.convergenceIndex : 0) - (typeof ca.convergenceIndex === "number" ? ca.convergenceIndex : 0)
      || compareStrings(String(ca.eventId ?? ""), String(cb.eventId ?? ""));
  });
}

function windowIso(window: { start: number; endExclusive: number; label: string } | undefined): { startUtc: string | null; endExclusiveUtc: string | null; label: string } | null {
  if (!window) return null;
  return {
    startUtc: utcIso(window.start),
    endExclusiveUtc: utcIso(window.endExclusive),
    label: typeof window.label === "string" ? window.label : "",
  };
}

export function buildAnalystExportBundle(input: AnalystExportInput): AnalystExportBundle {
  const generatedAtMs = typeof input.generatedAt === "number" && Number.isFinite(input.generatedAt) ? input.generatedAt : 0;
  const generatedAtUtc = utcIso(generatedAtMs) ?? new Date(0).toISOString();
  const truncation: AnalystExportTruncation = {
    truncated: false,
    incidentsDropped: 0,
    convergenceCardsDropped: 0,
    surgeSignalsDropped: 0,
    watchAlertsDropped: 0,
    evidenceMembersDropped: 0,
    notes: [],
  };
  const sectionIssues: string[] = [];

  // --- Incidents: deterministic ordering, explicit projection, hard cap with disclosure.
  const orderedEvents = [...input.events].sort((a, b) =>
    (typeof b.occurredAt === "number" ? b.occurredAt : 0) - (typeof a.occurredAt === "number" ? a.occurredAt : 0)
    || compareStrings(String(a.id ?? ""), String(b.id ?? ""))
  );
  const retainedEvents = orderedEvents.slice(0, MAX_EXPORT_INCIDENTS);
  truncation.incidentsDropped = orderedEvents.length - retainedEvents.length;
  if (truncation.incidentsDropped > 0) {
    truncation.notes.push(`${truncation.incidentsDropped} in-scope incidents exceeded the ${MAX_EXPORT_INCIDENTS}-incident bundle safety cap and were omitted oldest-last after deterministic ordering; narrow the filter scope to export them`);
  }
  const incidents = retainedEvents.map((event) => projectIncidentForExport(event, true));
  let exportedEvidenceMembers = 0;
  for (const incident of incidents) {
    if (!incident.evidence) continue;
    exportedEvidenceMembers += incident.evidence.members.length;
    truncation.evidenceMembersDropped += incident.evidence.truncatedMemberCount;
  }
  if (truncation.evidenceMembersDropped > 0) {
    truncation.notes.push(`${truncation.evidenceMembersDropped} evidence member reports exceeded the ${MAX_EXPORT_EVIDENCE_MEMBERS_PER_CLUSTER}-member per-cluster safety cap; membership counts and contradiction records remain complete`);
  }

  // --- Convergence cards: only cards anchored on exported incidents, JSON-guard cloned.
  const exportedIds = new Set(incidents.map((incident) => incident.id));
  let convergenceCards: unknown[] = [];
  let convergenceContext: AnalystExportBundle["convergenceContext"];
  if (!input.convergence) {
    convergenceContext = {
      included: false,
      algorithmVersion: null,
      analysisGaps: [],
      globalNotes: [],
      stats: null,
      note: "convergence analysis was not loaded when this export was produced; absence is explicit, not a negative finding",
    };
  } else {
    const clonedCards = cloneJsonSection(input.convergence.cards);
    if (!clonedCards) {
      convergenceContext = {
        included: false,
        algorithmVersion: input.convergence.algorithmVersion ?? null,
        analysisGaps: [],
        globalNotes: [],
        stats: null,
        note: "convergence cards could not be serialized safely and were excluded rather than partially exported",
      };
      sectionIssues.push("convergence cards failed the serialization safety guard and were excluded");
    } else {
      const relevant = sortConvergenceCards(clonedCards.filter((card) => exportedIds.has(String((card as { eventId?: string })?.eventId ?? ""))));
      const retained = relevant.slice(0, MAX_EXPORT_CONVERGENCE_CARDS);
      truncation.convergenceCardsDropped = relevant.length - retained.length;
      if (truncation.convergenceCardsDropped > 0) {
        truncation.notes.push(`${truncation.convergenceCardsDropped} convergence cards exceeded the ${MAX_EXPORT_CONVERGENCE_CARDS}-card safety cap and were omitted weakest-first`);
      }
      convergenceCards = retained;
      convergenceContext = {
        included: true,
        algorithmVersion: input.convergence.algorithmVersion ?? null,
        analysisGaps: cloneJsonSection(input.convergence.gaps) ?? [],
        globalNotes: Array.isArray(input.convergence.globalNotes) ? [...input.convergence.globalNotes].sort(compareStrings) : [],
        stats: cloneJsonSection(input.convergence.stats),
        note: "cards are restricted to anchors inside the exported incident scope; convergence is co-occurrence geometry, never causality — a card absent for an exported incident means no in-gate spatial-temporal overlap was found, which is not evidence of absence",
      };
    }
  }

  // --- Surge signals: only indicator-bearing signals, cloned and deterministically ordered.
  let surge: AnalystExportBundle["surge"];
  if (!input.surge) {
    surge = {
      included: false,
      algorithmVersion: null,
      analysisEndUtc: null,
      recentWindow: null,
      baselineWindow: null,
      signals: [],
      signalCount: 0,
      totalSignalCount: 0,
      globalNotes: [],
      stats: null,
      disclaimer: null,
      note: "escalation-surge analysis was not loaded when this export was produced; absence is explicit, not a negative finding",
    };
  } else {
    const clonedSignals = cloneJsonSection(input.surge.signals);
    if (!clonedSignals) {
      surge = {
        included: false,
        algorithmVersion: input.surge.algorithmVersion ?? null,
        analysisEndUtc: utcIso(input.surge.analysisEnd),
        recentWindow: null,
        baselineWindow: null,
        signals: [],
        signalCount: 0,
        totalSignalCount: 0,
        globalNotes: [],
        stats: null,
        disclaimer: input.surge.disclaimer ?? null,
        note: "surge signals could not be serialized safely and were excluded rather than partially exported",
      };
      sectionIssues.push("surge signals failed the serialization safety guard and were excluded");
    } else {
      const indicatorSignals = sortSignalsDesc(clonedSignals.filter((signal) => (signal as { isSignal?: boolean })?.isSignal === true));
      const retainedSignals = indicatorSignals.slice(0, MAX_EXPORT_SURGE_SIGNALS);
      truncation.surgeSignalsDropped = indicatorSignals.length - retainedSignals.length;
      if (truncation.surgeSignalsDropped > 0) {
        truncation.notes.push(`${truncation.surgeSignalsDropped} surge signals exceeded the ${MAX_EXPORT_SURGE_SIGNALS}-signal safety cap`);
      }
      surge = {
        included: true,
        algorithmVersion: input.surge.algorithmVersion ?? null,
        analysisEndUtc: utcIso(input.surge.analysisEnd),
        recentWindow: windowIso(input.surge.recentWindow),
        baselineWindow: windowIso(input.surge.baselineWindow),
        signals: retainedSignals,
        signalCount: retainedSignals.length,
        totalSignalCount: clonedSignals.length,
        globalNotes: Array.isArray(input.surge.globalNotes) ? [...input.surge.globalNotes] : [],
        stats: cloneJsonSection(input.surge.stats),
        disclaimer: input.surge.disclaimer ?? null,
        note: "surge output is a deterministic statistical indicator over the full loaded corpus, evaluated independently of the interactive filter scope; only indicator-bearing theater/region groups (surge, watch, uncertain-change) are included — quiet and insufficient-evidence groups are omitted as noise, which is not evidence of absence",
      };
    }
  }

  // --- Watch alerts: deterministic recomputed alerts plus the rule definitions that produced them.
  let watch: AnalystExportBundle["watch"];
  if (!input.watchEvaluation) {
    watch = {
      included: false,
      algorithmVersion: null,
      evaluatedAtUtc: null,
      alerts: [],
      evaluations: [],
      triggeredRuleDefinitions: [],
      stats: null,
      disclaimer: null,
      note: "watch-rule evaluation was not loaded when this export was produced; absence is explicit, not a negative finding",
    };
  } else {
    const clonedAlerts = cloneJsonSection(input.watchEvaluation.alerts);
    const clonedEvaluations = cloneJsonSection(input.watchEvaluation.evaluations);
    if (!clonedAlerts || !clonedEvaluations) {
      watch = {
        included: false,
        algorithmVersion: input.watchEvaluation.algorithmVersion ?? null,
        evaluatedAtUtc: utcIso(input.watchEvaluation.evaluatedAt),
        alerts: [],
        evaluations: [],
        triggeredRuleDefinitions: [],
        stats: null,
        disclaimer: input.watchEvaluation.disclaimer ?? null,
        note: "watch evaluation output could not be serialized safely and was excluded rather than partially exported",
      };
      sectionIssues.push("watch evaluation output failed the serialization safety guard and was excluded");
    } else {
      const orderedAlerts = sortAlerts(clonedAlerts);
      const retainedAlerts = orderedAlerts.slice(0, MAX_EXPORT_WATCH_ALERTS);
      truncation.watchAlertsDropped = orderedAlerts.length - retainedAlerts.length;
      if (truncation.watchAlertsDropped > 0) {
        truncation.notes.push(`${truncation.watchAlertsDropped} watch alerts exceeded the ${MAX_EXPORT_WATCH_ALERTS}-alert safety cap`);
      }
      const triggeredRuleIds = new Set(retainedAlerts.map((alert) => String((alert as { ruleId?: string })?.ruleId ?? "")));
      const triggeredRules = input.watchRules
        .filter((rule) => triggeredRuleIds.has(rule.id))
        .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.id, b.id));
      const clonedRules = cloneJsonSection(triggeredRules) ?? [];
      const orderedEvaluations = [...clonedEvaluations].sort((a, b) =>
        compareStrings(String((a as { ruleName?: string })?.ruleName ?? ""), String((b as { ruleName?: string })?.ruleName ?? ""))
        || compareStrings(String((a as { ruleId?: string })?.ruleId ?? ""), String((b as { ruleId?: string })?.ruleId ?? ""))
      );
      watch = {
        included: true,
        algorithmVersion: input.watchEvaluation.algorithmVersion ?? null,
        evaluatedAtUtc: utcIso(input.watchEvaluation.evaluatedAt),
        alerts: retainedAlerts,
        evaluations: orderedEvaluations,
        triggeredRuleDefinitions: clonedRules,
        stats: cloneJsonSection(input.watchEvaluation.stats),
        disclaimer: input.watchEvaluation.disclaimer ?? null,
        note: "alerts are deterministic statistical triggers recomputed over the loaded corpus. Full rule definitions are included only for rules that triggered; evaluations summarize every rule checked. Browser-local dismiss/snooze lifecycle state is deliberately excluded because it never alters evidence",
      };
    }
  }

  // --- Scope.
  const queryInfo = sanitizedQueryNote(input.filters?.query ?? "");
  const enabledLayers = Object.entries(input.operatorState.layers ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key)
    .sort(compareStrings);
  const playbackScope = input.playback
    ? {
      ...input.playback,
      frameStartUtc: utcIso(input.playback.frameStart),
      frameEndExclusiveUtc: utcIso(input.playback.frameEndExclusive),
      scopeNote: input.playback.active
        ? "temporal playback was active as a display lens; this export deliberately covers the full filtered incident scope, NOT just the visible playback frame — the frame parameters are recorded here so the lens can be reproduced"
        : "temporal playback was inactive; the export covers the full filtered incident scope",
    }
    : null;

  // --- Provenance.
  const snapshot = input.snapshot;
  const droppedSnapshotSections: string[] = [];
  const cloneMeta = (value: unknown, label: string): unknown => {
    if (value == null) return null;
    const cloned = cloneJsonSection(value);
    if (cloned === null) droppedSnapshotSections.push(label);
    return cloned;
  };
  const domainCounts: Record<string, number> = {};
  const countDomains: [string, unknown][] = [
    ["militaryAircraft", snapshot?.militaryAircraft],
    ["civilAircraft", snapshot?.aircraft],
    ["vessels", snapshot?.vessels],
    ["satellites", snapshot?.satellites],
    ["newsArticles", snapshot?.news],
    ["launches", snapshot?.launches],
    ["naturalEvents", snapshot?.naturalEvents],
    ["gpsInterferenceCells", snapshot?.gpsInterference],
    ["mapOfWarsRecords", snapshot?.mapOfWarsEvents],
    ["webcams", snapshot?.webcams],
    ["cyberVulnerabilities", snapshot?.cyberVulnerabilities],
    ["internetOutages", snapshot?.internetOutages],
    ["gdeltGeoNewsMentions", snapshot?.gdeltGeoNews],
    ["reliefwebHumanitarianRecords", snapshot?.reliefwebRecords],
  ];
  for (const [key, value] of countDomains) {
    domainCounts[key] = Array.isArray(value) ? value.length : 0;
  }
  const retrievalTimestamps: Record<string, string | null> = {
    incidentFeedFetched: utcIso(input.feed.lastUpdated),
    snapshotFetched: typeof snapshot?.fetchedAt === "string" && snapshot.fetchedAt ? snapshot.fetchedAt : null,
    ucdpPreserved: typeof snapshot?.ucdpMeta?.preservedAt === "string" ? snapshot.ucdpMeta.preservedAt : null,
    gdeltGeoPreserved: typeof snapshot?.gdeltGeoMeta?.preservedAt === "string" ? snapshot.gdeltGeoMeta.preservedAt : null,
    reliefwebRetrieved: typeof snapshot?.reliefwebMeta?.retrievedAt === "string" ? snapshot.reliefwebMeta.retrievedAt : null,
    reliefwebPreserved: typeof snapshot?.reliefwebMeta?.preservedAt === "string" ? snapshot.reliefwebMeta.preservedAt : null,
    internetOutagePreserved: typeof snapshot?.internetOutageMeta?.preservedAt === "string" ? snapshot.internetOutageMeta.preservedAt : null,
    cyberKevRetrieved: typeof snapshot?.cyberVulnerabilityMeta?.kev?.retrievedAt === "string" ? snapshot.cyberVulnerabilityMeta.kev.retrievedAt : null,
    cyberNvdRetrieved: typeof snapshot?.cyberVulnerabilityMeta?.nvd?.retrievedAt === "string" ? snapshot.cyberVulnerabilityMeta.nvd.retrievedAt : null,
    cyberEpssRetrieved: typeof snapshot?.cyberVulnerabilityMeta?.epss?.retrievedAt === "string" ? snapshot.cyberVulnerabilityMeta.epss.retrievedAt : null,
    cyberCachePreserved: typeof snapshot?.cyberVulnerabilityMeta?.preservedAt === "string" ? snapshot.cyberVulnerabilityMeta.preservedAt : null,
  };
  const sortedRetrieval: Record<string, string | null> = {};
  for (const key of Object.keys(retrievalTimestamps).sort(compareStrings)) sortedRetrieval[key] = retrievalTimestamps[key];

  const snapshotRuntime = input.snapshotRuntime ?? null;
  const domainChunkCompleteness = snapshotRuntime ? {
    phase: snapshotRuntime.phase,
    complete: snapshotRuntime.complete,
    criticalReady: snapshotRuntime.criticalReady,
    criticalComplete: snapshotRuntime.criticalComplete,
    evidencePending: snapshotRuntime.evidencePending,
    stale: snapshotRuntime.stale,
    error: snapshotRuntime.error,
    integrity: snapshotRuntime.integrity,
    usableChunkCount: snapshotRuntime.usableChunkCount,
    totalChunkCount: snapshotRuntime.totalChunkCount,
    loadedBytes: snapshotRuntime.loadedBytes,
    totalBytes: snapshotRuntime.totalBytes,
    chunks: Object.values(snapshotRuntime.chunks)
      .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
      .map((chunk) => ({
        id: chunk.id,
        status: chunk.status,
        critical: chunk.critical,
        stale: chunk.stale,
        retainedFromPrevious: chunk.retainedFromPrevious,
        bytes: chunk.bytes,
        sha256: chunk.sha256,
        collections: [...chunk.collections].sort(compareStrings),
        counts: sortObjectByKeys({ ...chunk.counts }),
        retrieval: cloneJsonSection(chunk.retrieval),
        error: chunk.error,
      })),
    interpretation: "pending or error chunk states mean absent rows are unknown/unavailable rather than negative coverage; degraded means prior rows were retained and are explicitly stale",
  } : null;

  const algorithmVersions: Record<string, string | number> = {
    exportSchema: ANALYST_EXPORT_SCHEMA_VERSION,
    operatorUrlState: OPERATOR_URL_STATE_VERSION,
  };
  if (input.feed.correlation?.algorithmVersion) algorithmVersions.incidentCorrelation = input.feed.correlation.algorithmVersion;
  if (input.convergence?.algorithmVersion) algorithmVersions.domainConvergence = input.convergence.algorithmVersion;
  if (input.surge?.algorithmVersion) algorithmVersions.escalationSurge = input.surge.algorithmVersion;
  if (input.watchEvaluation?.algorithmVersion) algorithmVersions.watchRules = input.watchEvaluation.algorithmVersion;

  const exclusions = [
    "transient transport positions (military/civil aviation, AIS vessels, satellites) are snapshot-instant observations and are not exported as rows; where they aligned with an exported incident their provenance, distances, and factor rationale survive inside convergence card findings",
    "raw news articles, launch schedules, natural-event rows, webcam indexes, GPS-interference cells, outage records, cyber vulnerability records, and ReliefWeb humanitarian metadata records are not exported as rows; their ingestion provenance, counts, retrieval timestamps, and caveats are included and aligned observations survive inside convergence findings",
    "browser-local watch alert lifecycle state (dismiss/snooze timestamps) is excluded: it is personal workflow state that never alters evidence, and non-triggered watch rule definitions remain local to the originating browser profile",
    "evidence members are embedded exactly one level deep; nested evidence clusters cannot exist by correlation design and any adversarially nested structure is structurally stripped rather than serialized",
    "playback is a temporal display lens only; it never narrows the exported incident scope (the lens parameters are recorded for reproduction)",
    "no secrets, tokens, or API keys are present in this bundle; ingestion provenance records carry configuration-presence booleans only, and secret-shaped search text is withheld with disclosure",
    ...sectionIssues,
  ];

  const exportContents = [
    "filtered canonical incidents with occurrence windows (epoch ms + UTC ISO), severity/category/casualty fields, verification state, and full citation URL lists",
    "full evidence-cluster memberships for correlated incidents: per-member source family, pairwise correlation score, ordered rationale lines, embedded member report rows, and contradiction records with member ids",
    "active filter scope (time window, category groups, severities, theater, disclosed search text), operator scope (visual mode, layers, panels, refresh state, camera when fixed), and playback lens state",
    "source and provenance metadata: feed origin and fetch time, correlation pass statistics, snapshot retrieval timestamps, per-domain record counts, ingestion meta for UCDP/GDELT/IODA/ReliefWeb/cyber sources, and degraded-source errors",
    "convergence cards anchored on exported incidents with classification reasoning, per-domain findings, factor scores, evidence gaps, and provenance URLs",
    "surge/watch output: indicator-bearing escalation signals and triggered watch alerts with evidence references, explanations, uncertainty notes, windows, and disclaimers",
    "shareable permalink restoring the exact operator workspace, schema/version metadata for every algorithm, attribution/licensing caveats, and itemized exclusions",
  ];

  truncation.truncated = truncation.incidentsDropped > 0
    || truncation.convergenceCardsDropped > 0
    || truncation.surgeSignalsDropped > 0
    || truncation.watchAlertsDropped > 0
    || truncation.evidenceMembersDropped > 0;
  if (!truncation.truncated) truncation.notes.push("no truncation occurred: every in-scope incident, evidence member, convergence card, surge signal, and watch alert is present in full");

  return {
    schemaVersion: ANALYST_EXPORT_SCHEMA_VERSION,
    generatedAtUtc,
    generator: {
      application: "God's Eye OSINT command center (crisis-averted static client)",
      artifactKind: "analyst evidence handoff bundle",
      clientSideOnly: true,
      algorithmVersions,
    },
    caveats: {
      unverifiedOsint: ANALYST_EXPORT_UNVERIFIED_CAVEAT,
      noOperationalAuthority: ANALYST_EXPORT_NO_AUTHORITY_CAVEAT,
      statisticalNotPredictive: input.surge?.disclaimer ?? null,
      convergenceNotCausal: typeof input.convergenceDisclaimer === "string" && input.convergenceDisclaimer
        ? input.convergenceDisclaimer
        : input.convergence?.cards.find((card) => typeof card?.disclaimer === "string" && card.disclaimer)?.disclaimer ?? null,
      watchReviewAidOnly: input.watchEvaluation?.disclaimer ?? null,
      attributionLicensing: ANALYST_EXPORT_ATTRIBUTION_CAVEAT,
    },
    permalink: {
      url: input.permalink,
      fragmentSchemaVersion: OPERATOR_URL_STATE_VERSION,
      note: input.permalink
        ? "the permalink restores public view, layers, filters, panels, playback frame, refresh-pause state, and camera when drift is paused; it is URL-fragment state only and carries no credentials"
        : "the operator workspace could not be encoded inside the permalink length guardrail at export time, so no permalink is included rather than a truncated or misleading one",
    },
    scope: {
      filters: {
        timeWindow: String(input.filters?.timeWindow ?? ""),
        categoryGroups: Array.isArray(input.filters?.categoryGroups) ? [...input.filters.categoryGroups].map(String).sort(compareStrings) : [],
        severities: Array.isArray(input.filters?.severities) ? [...input.filters.severities].map(String).sort(compareStrings) : [],
        theater: typeof input.filters?.theater === "string" && input.filters.theater ? input.filters.theater : null,
        query: queryInfo.query,
        queryWithheld: queryInfo.withheld,
        queryNote: queryInfo.note,
      },
      operator: {
        visualMode: String(input.operatorState.visualMode ?? ""),
        enabledLayers,
        refreshPaused: input.operatorState.refreshPaused === true,
        selectedEventId: typeof input.operatorState.selectedEventId === "string" ? input.operatorState.selectedEventId : null,
        panels: {
          theater: input.operatorState.panels?.theater === true,
          incident: input.operatorState.panels?.incident === true,
          source: input.operatorState.panels?.source === true,
          inspector: String(input.operatorState.panels?.inspector ?? "feed"),
        },
        camera: input.operatorState.camera && Number.isFinite(input.operatorState.camera.lat)
          ? { lat: input.operatorState.camera.lat, lng: input.operatorState.camera.lng, altitude: input.operatorState.camera.altitude }
          : null,
      },
      playback: playbackScope,
      incidentCounts: {
        exportedIncidents: incidents.length,
        inScopeIncidents: orderedEvents.length,
        corpusIncidents: typeof input.corpusIncidentCount === "number" ? input.corpusIncidentCount : orderedEvents.length,
        exportedEvidenceMembers,
      },
    },
    provenance: {
      feed: {
        source: input.feed.source ?? "unknown",
        fetchedAtUtc: utcIso(input.feed.lastUpdated),
        error: typeof input.feed.error === "string" && input.feed.error ? input.feed.error : null,
      },
      correlation: input.feed.correlation ? cloneJsonSection(input.feed.correlation) : null,
      snapshot: {
        fetchedAt: typeof snapshot?.fetchedAt === "string" ? snapshot.fetchedAt : "",
        sources: sortObjectByKeys(typeof snapshot?.sources === "object" && snapshot.sources ? { ...snapshot.sources } : {}),
        errors: Array.isArray(snapshot?.errors) ? snapshot.errors.filter((line): line is string => typeof line === "string").sort(compareStrings) : [],
        domainCounts,
        domainChunkCompleteness,
        ucdpMeta: cloneMeta(snapshot?.ucdpMeta ?? null, "ucdpMeta"),
        gdeltGeoMeta: cloneMeta(snapshot?.gdeltGeoMeta ?? null, "gdeltGeoMeta"),
        internetOutageMeta: cloneMeta(snapshot?.internetOutageMeta ?? null, "internetOutageMeta"),
        cyberVulnerabilityMeta: cloneMeta(snapshot?.cyberVulnerabilityMeta ?? null, "cyberVulnerabilityMeta"),
        reliefwebMeta: cloneMeta(snapshot?.reliefwebMeta ?? null, "reliefwebMeta"),
        droppedSections: droppedSnapshotSections.sort(compareStrings),
      },
      retrievalTimestampsUtc: sortedRetrieval,
    },
    incidents,
    convergenceCards,
    convergenceContext,
    surge,
    watch,
    exclusions,
    truncation,
    exportContents,
  };
}

/* ------------------------------------------------------------------------- */
/* Artifacts: deterministic JSON serialization + markdown brief + CSV rows    */
/* ------------------------------------------------------------------------- */

export interface AnalystExportArtifacts {
  bundle: AnalystExportBundle;
  json: string;
  markdown: string;
  csv: string;
  jsonBytes: number;
  markdownBytes: number;
  csvBytes: number;
  filenames: {
    bundleJson: string;
    briefMarkdown: string;
    incidentsCsv: string;
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function citationLine(sources: { name: string; url: string }[]): string[] {
  return sources.map((source) => `${source.name} — ${source.url}`);
}

function mdBullet(lines: string[], indent: string, items: string[]): void {
  for (const item of items) lines.push(`${indent}- ${item}`);
}

function evidenceRefMarkdown(ref: unknown): string {
  const typed = ref as {
    eventId?: string; title?: string; temporalMembership?: string; severity?: string; category?: string;
    casualtyMeasure?: number; independentFamilyCount?: number; evidenceReportCount?: number;
    sourceName?: string | null; sourceUrl?: string | null; evidenceMemberEventIds?: string[];
  };
  const parts = [
    `\`${typed.eventId ?? "unknown"}\``,
    `[${typed.temporalMembership ?? "unknown"}]`,
    String(typed.title ?? ""),
    `| ${typed.severity ?? "?"}/${typed.category ?? "?"}`,
    `| casualty measure ${typed.casualtyMeasure ?? 0}`,
    `| families ${typed.independentFamilyCount ?? 1}`,
    `| reports ${typed.evidenceReportCount ?? 1}`,
    `| ${typed.sourceName ?? "source unavailable"}${typed.sourceUrl ? ` — ${typed.sourceUrl}` : ""}`,
  ];
  let line = parts.join(" ");
  if (Array.isArray(typed.evidenceMemberEventIds) && typed.evidenceMemberEventIds.length > 0) {
    line += ` (correlated member report ids: ${[...typed.evidenceMemberEventIds].sort(compareStrings).join(", ")})`;
  }
  return line;
}

/** Analyst-readable Markdown brief. The JSON bundle is the full-fidelity artifact; the
 *  brief deliberately caps its incident rows and says so wherever it summarizes. */
export function buildAnalystExportMarkdown(bundle: AnalystExportBundle): string {
  const lines: string[] = [];
  lines.push(`# God's Eye analyst export — unverified OSINT evidence handoff`);
  lines.push("");
  lines.push(`- generated (UTC): ${bundle.generatedAtUtc}`);
  lines.push(`- schema: \`${bundle.schemaVersion}\` · client-side artifact, no backend dependency`);
  lines.push(`- incidents in scope: ${bundle.scope.incidentCounts.exportedIncidents} exported of ${bundle.scope.incidentCounts.inScopeIncidents} in-scope (${bundle.scope.incidentCounts.corpusIncidents} in loaded corpus) · ${bundle.scope.incidentCounts.exportedEvidenceMembers} embedded evidence member report${bundle.scope.incidentCounts.exportedEvidenceMembers === 1 ? "" : "s"}`);
  if (bundle.permalink.url) lines.push(`- shareable permalink: ${bundle.permalink.url}`);
  else lines.push(`- shareable permalink: none — ${bundle.permalink.note}`);
  lines.push("");
  lines.push("## Caveats — read before use");
  lines.push("");
  lines.push(`> ${bundle.caveats.unverifiedOsint}`);
  lines.push(">");
  lines.push(`> ${bundle.caveats.noOperationalAuthority}`);
  if (bundle.caveats.statisticalNotPredictive) {
    lines.push(">");
    lines.push(`> ${bundle.caveats.statisticalNotPredictive}`);
  }
  if (bundle.caveats.convergenceNotCausal) {
    lines.push(">");
    lines.push(`> ${bundle.caveats.convergenceNotCausal}`);
  }
  if (bundle.caveats.watchReviewAidOnly) {
    lines.push(">");
    lines.push(`> ${bundle.caveats.watchReviewAidOnly}`);
  }
  lines.push(">");
  lines.push(`> ${bundle.caveats.attributionLicensing}`);
  lines.push("");

  lines.push("## Export scope and reproduction");
  lines.push("");
  const filters = bundle.scope.filters;
  lines.push(`- time window: ${filters.timeWindow} · category groups: ${filters.categoryGroups.join(", ") || "none"} · severities: ${filters.severities.join(", ") || "none"}`);
  lines.push(`- theater: ${filters.theater ?? "all theaters"}`);
  if (filters.query) lines.push(`- search text: "${filters.query}"`);
  if (filters.queryWithheld) lines.push(`- search text: withheld — ${filters.queryNote}`);
  lines.push(`- operator: visual mode ${bundle.scope.operator.visualMode}, layers [${bundle.scope.operator.enabledLayers.join(", ")}], refresh ${bundle.scope.operator.refreshPaused ? "paused" : "live"}, inspector panel ${bundle.scope.operator.panels.inspector}`);
  if (bundle.scope.operator.camera) {
    lines.push(`- camera: lat ${bundle.scope.operator.camera.lat}, lng ${bundle.scope.operator.camera.lng}, altitude ${bundle.scope.operator.camera.altitude}`);
  } else {
    lines.push("- camera: no fixed camera constraint (drift active or unconstrained)");
  }
  if (bundle.scope.playback) {
    const playback = bundle.scope.playback;
    lines.push(`- playback lens: ${playback.active ? `active (${playback.mode}, frame ${playback.frameIndex ?? "unresolved"} ${playback.frameStartUtc ?? "?"} through ${playback.frameEndExclusiveUtc ?? "?"}, ${playback.speedMultiplier}x, trail ${playback.trailHours}h, ${playback.frameEventCount ?? 0} incidents in frame)` : "inactive"}`);
    lines.push(`  - ${playback.scopeNote}`);
  } else {
    lines.push("- playback lens: not engaged");
  }
  lines.push("");

  lines.push("## Provenance and retrieval timestamps (UTC)");
  lines.push("");
  lines.push(`- incident feed: ${bundle.provenance.feed.source}${bundle.provenance.feed.fetchedAtUtc ? ` fetched ${bundle.provenance.feed.fetchedAtUtc}` : " (fetch time unavailable)"}${bundle.provenance.feed.error ? ` · degraded: ${bundle.provenance.feed.error}` : ""}`);
  if (bundle.provenance.correlation) {
    const correlation = bundle.provenance.correlation;
    lines.push(`- correlation pass (\`${correlation.algorithmVersion}\`): ${correlation.incidentCount} canonical incidents from ${correlation.inputRecordCount} records · ${correlation.multiMemberClusterCount} evidence clusters · ${correlation.correlatedEvidenceRecordCount} retained member reports · ${correlation.corroboratedClusterCount} corroborated / ${correlation.inferredClusterCount} inferred / ${correlation.contestedClusterCount} contested · ${correlation.exactDuplicateRecordCount} exact re-ingestions collapsed`);
  }
  lines.push(`- snapshot fetchedAt: ${bundle.provenance.snapshot.fetchedAt || "not loaded"}`);
  for (const [key, value] of Object.entries(bundle.provenance.retrievalTimestampsUtc)) {
    lines.push(`  - ${key}: ${value ?? "not supplied"}`);
  }
  if (Object.keys(bundle.provenance.snapshot.sources).length > 0) {
    lines.push("- registered public endpoints:");
    for (const [key, value] of Object.entries(bundle.provenance.snapshot.sources)) {
      lines.push(`  - ${key}: ${value}`);
    }
  }
  if (bundle.provenance.snapshot.errors.length > 0) {
    lines.push(`- degraded snapshot sources: ${bundle.provenance.snapshot.errors.join(" · ")}`);
  }
  lines.push("");

  lines.push("## Incidents");
  lines.push("");
  const total = bundle.incidents.length;
  const shown = bundle.incidents.slice(0, MAX_MARKDOWN_INCIDENT_ROWS);
  lines.push(`Showing ${shown.length} of ${total} exported incidents. The JSON bundle is the full-fidelity artifact: every exported incident, every evidence member report, and every rationale line is present there without summarization.`);
  lines.push("");
  shown.forEach((incident, index) => {
    lines.push(`### ${index + 1}. ${incident.title}`);
    lines.push("");
    lines.push(`- id: \`${incident.id}\` · ${incident.severity}/${incident.category} (${incident.categoryGroup}) · verified flag: ${incident.verified ? "yes" : "no"}`);
    lines.push(`- occurred: ${incident.occurredAtUtc ?? "time unavailable"}${incident.occurrence ? ` · source-supported window ${incident.occurrence.startUtc ?? "?"} through ${incident.occurrence.endExclusiveUtc ?? "?"} (end exclusive, ${incident.occurrence.precision}/${incident.occurrence.basis}: ${incident.occurrence.label})` : " · no resolvable occurrence window"}`);
    lines.push(`- location: lat ${incident.lat}, lng ${incident.lng} (precision ${incident.precision ?? "unavailable"}) · ${incident.country} · ${incident.region} · theater ${incident.theater} · conflict: ${incident.conflict}`);
    lines.push(`- reported impact: ${incident.killed} killed / ${incident.countedCasualties} counted casualties / ${incident.displaced} displaced — unverified source claims, not confirmed figures`);
    if (incident.detail) lines.push(`- detail: ${incident.detail}`);
    if (incident.sources.length > 0) {
      lines.push("- citations:");
      mdBullet(lines, "  ", citationLine(incident.sources));
    } else {
      lines.push("- citations: none supplied by the publisher — an explicit evidence gap, not verification");
    }
    if (incident.ucdp) {
      const ucdp = incident.ucdp;
      lines.push(`- UCDP GED: dataset ${ucdp.dataset_version ?? "?"} (${ucdp.dataset_release ?? "?"}) · code status ${ucdp.code_status ?? "?"} · side A ${ucdp.side_a ?? "?"} vs side B ${ucdp.side_b ?? "?"} · fatalities low/best/high ${ucdp.low ?? "?"}/${ucdp.best ?? "?"}/${ucdp.high ?? "?"} · sources ${ucdp.number_of_sources ?? "?"} · ${ucdp.source_article ?? "no source article supplied"}`);
    }
    if (incident.incident) {
      lines.push(`- correlation: ${incident.incident.confidence} · ${incident.incident.independentFamilyCount} independent famil${incident.incident.independentFamilyCount === 1 ? "y" : "ies"} · ${incident.incident.memberCount} report${incident.incident.memberCount === 1 ? "" : "s"} in cluster \`${incident.incident.clusterId}\``);
    }
    if (incident.evidence) {
      const evidence = incident.evidence;
      lines.push(`- evidence cluster (\`${evidence.algorithmVersion}\`): ${evidence.confidence} — ${evidence.confidenceReason}`);
      if (evidence.contradictions.length > 0) {
        lines.push("  - contradictions (preserved, never resolved):");
        for (const contradiction of evidence.contradictions) {
          lines.push(`    - ${contradiction.kind}: ${contradiction.summary} [members: ${contradiction.memberEventIds.join(", ")}]`);
        }
      }
      const membersShown = evidence.members.slice(0, MAX_MARKDOWN_EVIDENCE_MEMBERS_PER_CLUSTER);
      lines.push(`  - member reports (showing ${membersShown.length} of ${evidence.members.length}${evidence.truncatedMemberCount > 0 ? `, ${evidence.truncatedMemberCount} more truncated by the bundle safety cap` : ""}; full detail in JSON):`);
      for (const member of membersShown) {
        lines.push(`    - \`${member.event.id}\` [${member.sourceFamily}] pairwise score ${Math.round(member.correlationScore * 1000) / 1000} · ${member.event.occurredAtUtc ?? "time unavailable"} · ${member.event.title}`);
        for (const rationale of member.rationale) {
          lines.push(`      - ${rationale}`);
        }
        const memberCitations = citationLine(member.event.sources);
        if (memberCitations.length > 0) {
          lines.push(`      - citations: ${memberCitations.join(" · ")}`);
        }
      }
    }
    lines.push("");
  });
  if (total > shown.length) {
    lines.push(`_ ${total - shown.length} further exported incidents are present in the JSON bundle only._`);
    lines.push("");
  }

  lines.push("## Multi-domain convergence cards");
  lines.push("");
  if (!bundle.convergenceContext.included) {
    lines.push(bundle.convergenceContext.note);
  } else if (bundle.convergenceCards.length === 0) {
    lines.push("No exported incident anchored a convergence card: no in-gate spatial-temporal overlap was found. This is not evidence of absence.");
  } else {
    lines.push(`${bundle.convergenceCards.length} card(s) anchored on exported incidents. Co-occurrence geometry only — never causality, intent, or attribution.`);
    lines.push("");
    for (const cardValue of bundle.convergenceCards) {
      const card = cardValue as {
        eventId?: string; classification?: string; classificationReason?: string; convergenceIndex?: number;
        independentFamilyCount?: number; domains?: { domain?: string; family?: string; bestScore?: number; qualifies?: boolean; findingCount?: number; coverageNote?: string | null; findings?: { label?: string; distanceKm?: number; timeGapHours?: number; score?: number; qualifies?: boolean; url?: string | null; provenance?: { source?: string; url?: string | null } }[] }[];
        evidenceGaps?: { domain?: string; reason?: string }[]; uncertaintyNotes?: string[];
      };
      lines.push(`### incident \`${card.eventId ?? "unknown"}\` — ${card.classification ?? "unclassified"} (index ${card.convergenceIndex ?? 0})`);
      lines.push(`- ${card.classificationReason ?? ""}`);
      for (const domain of card.domains ?? []) {
        lines.push(`- ${domain.domain ?? "?"} [${domain.family ?? "?"}] best score ${domain.bestScore ?? 0}${domain.qualifies ? " (qualifying)" : ""} across ${domain.findingCount ?? 0} finding(s)${domain.coverageNote ? ` — coverage caveat: ${domain.coverageNote}` : ""}`);
        for (const finding of (domain.findings ?? []).slice(0, MAX_MARKDOWN_FINDINGS_PER_DOMAIN)) {
          lines.push(`  - ${finding.label ?? "observation"} · ${Math.round((finding.distanceKm ?? 0) * 10) / 10} km / ${Math.round((finding.timeGapHours ?? 0) * 10) / 10} h gap · score ${finding.score ?? 0}${finding.qualifies ? " qualifying" : ""}${finding.provenance?.source ? ` · source ${finding.provenance.source}` : ""}${finding.provenance?.url || finding.url ? ` — ${finding.provenance?.url ?? finding.url}` : ""}`);
        }
      }
      if ((card.evidenceGaps ?? []).length > 0) {
        lines.push(`- evidence gaps: ${(card.evidenceGaps ?? []).map((gap) => `${gap.domain ?? "?"} (${gap.reason ?? "unevaluable"})`).join("; ")}`);
      }
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## Escalation-surge indicators — statistical, never predictive");
  lines.push("");
  if (!bundle.surge.included) {
    lines.push(bundle.surge.note);
  } else if (bundle.surge.signals.length === 0) {
    lines.push(`No theater/region group carried a surge/watch/uncertain-change indicator across ${bundle.surge.totalSignalCount} evaluated groups. Absence of a signal is not evidence of absence.`);
  } else {
    lines.push(`${bundle.surge.signalCount} indicator-bearing group(s) of ${bundle.surge.totalSignalCount} evaluated. Windows: recent ${bundle.surge.recentWindow?.startUtc ?? "?"} through ${bundle.surge.recentWindow?.endExclusiveUtc ?? "?"}; baseline ${bundle.surge.baselineWindow?.startUtc ?? "?"} through ${bundle.surge.baselineWindow?.endExclusiveUtc ?? "?"} (ends exclusive).`);
    lines.push("");
    for (const signalValue of bundle.surge.signals) {
      const signal = signalValue as {
        id?: string; groupKind?: string; groupLabel?: string; level?: string; indicatorScore?: number; evidenceSupport?: number;
        explanations?: string[]; uncertaintyNotes?: string[]; evidenceRefs?: unknown[];
      };
      lines.push(`### ${signal.level ?? "?"} — ${signal.groupKind ?? "?"} ${signal.groupLabel ?? "?"} (index ${signal.indicatorScore ?? 0}/100, evidence support ${signal.evidenceSupport ?? 0}/100)`);
      for (const explanation of (signal.explanations ?? []).slice(0, 6)) lines.push(`- ${explanation}`);
      if ((signal.uncertaintyNotes ?? []).length > 0) {
        for (const note of (signal.uncertaintyNotes ?? []).slice(0, 4)) lines.push(`- uncertainty: ${note}`);
      }
      if ((signal.evidenceRefs ?? []).length > 0) {
        lines.push("- evidence references:");
        for (const ref of (signal.evidenceRefs ?? []).slice(0, 6)) {
          lines.push(`  - ${evidenceRefMarkdown(ref)}`);
        }
      }
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## Analyst watch alerts — local statistical triggers, not operational warnings");
  lines.push("");
  if (!bundle.watch.included) {
    lines.push(bundle.watch.note);
  } else if (bundle.watch.alerts.length === 0) {
    lines.push("No watch rule triggered in the current evaluation. Evaluations of every rule checked are in the JSON bundle.");
  } else {
    for (const alertValue of bundle.watch.alerts) {
      const alert = alertValue as {
        title?: string; ruleName?: string; emphasis?: string; triggeredAt?: number; window?: { start?: number; endExclusive?: number };
        definiteIncidentCount?: number; possibleIncidentCount?: number; summary?: string; explanations?: string[]; evidenceRefs?: unknown[]; disclaimer?: string; fingerprint?: string;
      };
      lines.push(`### ${alert.title ?? "watch alert"} [${alert.emphasis ?? "standard"}]`);
      lines.push(`- rule: ${alert.ruleName ?? "?"} · fingerprint \`${alert.fingerprint ?? "?"}\` · counts ${alert.definiteIncidentCount ?? 0} definite / ${alert.possibleIncidentCount ?? 0} possible`);
      if (alert.summary) lines.push(`- ${alert.summary}`);
      for (const explanation of (alert.explanations ?? []).slice(0, 5)) lines.push(`  - ${explanation}`);
      if ((alert.evidenceRefs ?? []).length > 0) {
        lines.push("- evidence references:");
        for (const ref of (alert.evidenceRefs ?? []).slice(0, 6)) {
          lines.push(`  - ${evidenceRefMarkdown(ref)}`);
        }
      }
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## Exclusions, truncation, and artifact inventory");
  lines.push("");
  lines.push("This export contains:");
  mdBullet(lines, "", bundle.exportContents);
  lines.push("");
  lines.push("Deliberately excluded:");
  mdBullet(lines, "", bundle.exclusions);
  lines.push("");
  lines.push("Truncation accounting:");
  mdBullet(lines, "", bundle.truncation.notes);
  lines.push("");
  lines.push(`_End of brief. Schema \`${bundle.schemaVersion}\`; generated ${bundle.generatedAtUtc}. Unverified OSINT — no operational authority._`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- */
/* CSV artifact — flat filtered incident rows with a caveat preamble.         */
/* ------------------------------------------------------------------------- */

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export const INCIDENT_CSV_HEADER = ["id", "occurred_utc", "occurrence_start_utc", "occurrence_end_exclusive_utc", "occurrence_precision", "occurrence_basis", "lat", "lng", "severity", "category", "country", "conflict", "killed", "counted_casualties", "displaced", "precision", "verified", "title", "sources", "ucdp_release", "ucdp_code_status", "ucdp_side_a", "ucdp_side_b", "ucdp_low", "ucdp_best", "ucdp_high", "ucdp_date_start", "ucdp_date_end", "ucdp_where_prec", "ucdp_date_prec", "ucdp_source_count", "ucdp_source_article", "source_family", "canonical_incident_id", "correlation_confidence", "evidence_report_count", "independent_family_count", "contradiction_kinds", "evidence_member_ids"];

export function incidentCsvRow(incident: ExportableIncident): string {
  return csvRow([
    incident.id,
    incident.occurredAtUtc ?? "",
    incident.occurrence?.startUtc ?? "",
    incident.occurrence?.endExclusiveUtc ?? "",
    incident.occurrence?.precision ?? "",
    incident.occurrence?.basis ?? "",
    incident.lat,
    incident.lng,
    incident.severity,
    incident.category,
    incident.country,
    incident.conflict,
    incident.killed,
    incident.countedCasualties,
    incident.displaced,
    incident.precision ?? "",
    incident.verified,
    incident.title,
    incident.sources.map((source) => `${source.name} ${source.url}`).join(" | "),
    incident.ucdp ? `${incident.ucdp.dataset_version ?? ""} ${incident.ucdp.dataset_release ?? ""}`.trim() : "",
    incident.ucdp?.code_status ?? "",
    incident.ucdp?.side_a ?? "",
    incident.ucdp?.side_b ?? "",
    incident.ucdp?.low ?? "",
    incident.ucdp?.best ?? "",
    incident.ucdp?.high ?? "",
    incident.ucdp?.date_start ?? "",
    incident.ucdp?.date_end ?? "",
    incident.ucdp?.where_prec ?? "",
    incident.ucdp?.date_prec ?? "",
    incident.ucdp?.number_of_sources ?? "",
    incident.ucdp?.source_article ?? "",
    incident.sourceFamily,
    incident.incident?.canonicalEventId ?? "",
    incident.incident?.confidence ?? "",
    incident.incident?.memberCount ?? "",
    incident.incident?.independentFamilyCount ?? "",
    (incident.evidence?.contradictions ?? []).map((contradiction) => contradiction.kind).join("+"),
    (incident.evidence?.members ?? []).map((member) => member.event.id).join(" | "),
  ]);
}

/** CSV rows share the bundle's deterministic incident ordering and carry the same caveats
 *  as `#`-prefixed preamble lines before the header row. */
export function buildIncidentCsv(incidents: ExportableIncident[], generatedAtUtc: string): string {
  const preamble = [
    `# ${ANALYST_EXPORT_UNVERIFIED_CAVEAT}`,
    `# ${ANALYST_EXPORT_NO_AUTHORITY_CAVEAT}`,
    `# ${ANALYST_EXPORT_ATTRIBUTION_CAVEAT}`,
    `# schema ${ANALYST_EXPORT_SCHEMA_VERSION} · generated ${generatedAtUtc} · flat filtered incident rows in deterministic order (occurred desc, id asc); the JSON bundle is the full-fidelity artifact`,
  ].map((line) => csvCell(line));
  return [
    ...preamble,
    csvRow(INCIDENT_CSV_HEADER),
    ...incidents.map(incidentCsvRow),
  ].join("\n");
}

export function buildAnalystExportArtifacts(input: AnalystExportInput): AnalystExportArtifacts {
  const bundle = buildAnalystExportBundle(input);
  const json = JSON.stringify(bundle, null, 2);
  const markdown = buildAnalystExportMarkdown(bundle);
  const csv = buildIncidentCsv(bundle.incidents, bundle.generatedAtUtc);
  return {
    bundle,
    json,
    markdown,
    csv,
    jsonBytes: byteLength(json),
    markdownBytes: byteLength(markdown),
    csvBytes: byteLength(csv),
    filenames: {
      bundleJson: analystExportFilename("bundle-json", input.generatedAt),
      briefMarkdown: analystExportFilename("brief-markdown", input.generatedAt),
      incidentsCsv: analystExportFilename("incidents-csv", input.generatedAt),
    },
  };
}
