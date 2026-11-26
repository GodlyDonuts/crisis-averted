"use client";

import { BadgeCheck, Copy, Crosshair, ExternalLink, GitMerge, MapPin, X } from "lucide-react";
import type { ConflictEvent, ConflictTheater, IncidentConvergenceCard, IncidentCorrelationConfidence, OsintSnapshot } from "@/types/conflict";
import { RegionalIntel } from "./RegionalIntel";
import { ConvergenceSection } from "./ConvergenceSection";
import { estimateEventConfidence, formatCompact, formatRelativeTime, formatUtcTime, normalizeCategory, SEVERITY_META } from "@/lib/conflictData";
import { formatUtcExact } from "@/lib/incidentTime";

interface EventDetailPanelProps {
  event: ConflictEvent;
  theater: ConflictTheater | null;
  snapshot: OsintSnapshot;
  convergenceCard?: IncidentConvergenceCard | null;
  onClose: () => void;
  onTheaterFocus: (theater: ConflictTheater) => void;
}

function precisionLabel(precision: number | null): string {
  switch (precision) {
    case 1: return "Exact site";
    case 2: return "Town level";
    case 3: return "District level";
    case 4: return "Province level";
    case 5: return "Linear feature";
    case 6: return "Country level";
    case 7: return "Offshore / airspace";
    default: return "Unspecified";
  }
}

function ucdpWherePrecisionLabel(precision: number | null | undefined): string {
  switch (precision) {
    case 1: return "exact location known";
    case 2: return "within 25 km of a known point";
    case 3: return "second-order administrative representation";
    case 4: return "first-order administrative representation";
    case 5: return "linear feature or fuzzy-area representation";
    case 6: return "country-only representation";
    case 7: return "international waters or airspace";
    default: return "unknown location precision";
  }
}

function violenceTypeLabel(type: number | null | undefined): string {
  switch (type) {
    case 1: return "state-based conflict";
    case 2: return "non-state conflict";
    case 3: return "one-sided violence";
    default: return "unknown violence type";
  }
}

function eventClarityLabel(clarity: number | null | undefined): string {
  switch (clarity) {
    case 1: return "high clarity / individually identifiable incident";
    case 2: return "lower clarity / source-reported aggregate";
    default: return "unknown event clarity";
  }
}

function datePrecisionLabel(precision: number | null | undefined): string {
  switch (precision) {
    case 1: return "exact date";
    case 2: return "2-6 day range";
    case 3: return "week range";
    case 4: return "8-30 day/month range";
    case 5: return "up-to-year range";
    default: return "unknown date precision";
  }
}

function DetailMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</p>
      <p className={`mt-1 font-mono text-sm ${accent ? "text-red-100" : "text-white/82"}`}>{value}</p>
    </div>
  );
}

export const CORRELATION_CONFIDENCE_META: Record<IncidentCorrelationConfidence, { label: string; color: string; softColor: string }> = {
  corroborated: { label: "Corroborated", color: "#30d158", softColor: "rgba(48,209,88,0.08)" },
  "single-source": { label: "Single-source", color: "rgba(255,255,255,0.45)", softColor: "rgba(255,255,255,0.04)" },
  inferred: { label: "Inferred linkage", color: "#64d2ff", softColor: "rgba(100,210,255,0.07)" },
  contested: { label: "Contested", color: "#ff8a00", softColor: "rgba(255,138,0,0.09)" },
};

const SOURCE_FAMILY_LABEL: Record<string, string> = {
  warheatmap: "WarHeatMap",
  mapofwars: "Map of Wars",
  ucdp: "UCDP",
  acled: "ACLED",
  unknown: "Unspecified",
};

export default function EventDetailPanel({ event, theater, snapshot, convergenceCard = null, onClose, onTheaterFocus }: EventDetailPanelProps) {
  const severity = SEVERITY_META[event.severity];
  const threatIndex = Math.round(event.intensity * 100);
  const confidence = estimateEventConfidence(event);
  const occurrence = event.occurrence;
  const occurrenceIsUncertain = Boolean(occurrence && occurrence.precision !== "second");
  const ucdpFatalityIntervalDiscrepancy = Boolean(
    event.ucdp
    && typeof event.ucdp.low === "number"
    && typeof event.ucdp.best === "number"
    && typeof event.ucdp.high === "number"
    && (event.ucdp.low > event.ucdp.best || event.ucdp.best > event.ucdp.high)
  );
  const ucdpHighOnlyFatalityUncertainty = Boolean(event.ucdp && event.ucdp.best === 0 && typeof event.ucdp.high === "number" && event.ucdp.high > 0);
  const copyBrief = () => {
    const brief = [
      `INCIDENT BRIEF — ${event.title}`,
      `DTG: ${formatUtcTime(event.occurredAt)}`,
      ...(occurrence ? [
        `OCCURRENCE WINDOW: ${formatUtcExact(occurrence.start)} → ${formatUtcExact(occurrence.endExclusive)} end-exclusive · ${occurrence.label}`,
      ] : []),
      `LOCATION: ${event.lat.toFixed(4)}, ${event.lng.toFixed(4)} (${event.country})`,
      `CATEGORY/SEVERITY: ${normalizeCategory(event.category)} / ${event.severity}`,
      `REPORTED KILLED: ${event.killed}; COUNTED CASUALTIES: ${event.countedCasualties}; DISPLACED: ${event.displaced}`,
      `PRIORITY SCORE: ${threatIndex}/100; CONFIDENCE: ${confidence.score}/100 (${confidence.label})`,
      ...(event.incident ? [
        `CORROBORATION: ${event.incident.confidence} — ${event.incident.memberCount} retained report(s) across ${event.incident.independentFamilyCount} independent source family/families`,
      ] : []),
      ...(event.evidence && event.evidence.contradictions.length > 0 ? [
        `CONTRADICTIONS: ${event.evidence.contradictions.map((item) => item.summary).join(" | ")}`,
      ] : []),
      `SOURCES: ${event.sources.map((source) => `${source.name} ${source.url}`).join(" | ") || "none supplied"}`,
      ...(event.ucdp ? [
        `UCDP RECORD: ${event.ucdp.id} (${event.ucdp.relid || "relid unavailable"}) · release ${event.ucdp.dataset_version} · status ${event.ucdp.code_status || "unknown"}`,
        `UCDP ACTORS: ${event.ucdp.side_a || "unknown side A"} vs ${event.ucdp.side_b || "unknown side B"}`,
        `UCDP FATALITIES: low ${event.ucdp.low ?? "unknown"} / best ${event.ucdp.best ?? "unknown"} / high ${event.ucdp.high ?? "unknown"}; window ${event.ucdp.date_start || "unknown"} to ${event.ucdp.date_end || "unknown"}`,
      ] : []),
      "CAVEAT: Public OSINT; not independently confirmed unless explicitly stated by sources.",
    ].join("\n");
    void navigator.clipboard?.writeText(brief);
  };

  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-3 left-3 right-3 top-auto z-40 flex max-h-[68vh] w-auto flex-col overflow-hidden xl:bottom-[172px] xl:left-auto xl:right-4 xl:top-20 xl:max-h-none xl:w-[372px]">
      <div className="relative border-b border-white/8 px-4 py-4">
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${severity.color}, transparent)` }} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ borderColor: `${severity.color}55`, backgroundColor: severity.softColor, color: severity.color }}>
                {severity.label}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/48">
                {normalizeCategory(event.category)}
              </span>
              {event.verified && (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/54">
                  <BadgeCheck className="h-3.5 w-3.5" /> {event.ucdp?.dataset_release.includes("candidate") ? "UCDP clear" : "Verified"}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug text-white/94">{event.title}</h2>
          </div>
          <button
            type="button"
            onClick={copyBrief}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
            aria-label="Copy incident brief"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
            aria-label="Close event detail"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="godseye-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-sm border border-amber-200/12 bg-amber-300/[0.045] p-3">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-amber-100/44">
            <span>Priority score · heuristic</span>
            <span>{threatIndex}/100</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full" style={{ width: `${threatIndex}%`, backgroundColor: severity.color }} />
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-white/34">
            <span>{formatRelativeTime(event.occurredAt)}</span>
            <span>{formatUtcTime(event.occurredAt)}</span>
          </div>
          {occurrence ? (
            <div className={`mt-2 rounded-sm border px-2 py-1.5 font-mono text-[9px] uppercase leading-relaxed tracking-[0.08em] ${occurrenceIsUncertain ? "border-sky-200/12 bg-sky-300/[0.045] text-sky-100/54" : "border-white/8 bg-white/[0.025] text-white/34"}`}>
              <p>Occurrence window: {formatUtcExact(occurrence.start)} → {formatUtcExact(occurrence.endExclusive)} end-exclusive</p>
              <p className="mt-0.5 normal-case tracking-normal text-white/38">{occurrence.label}</p>
            </div>
          ) : null}
          <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/28">
            Severity, recency, casualties, displacement, precision, and verification contribute to this score.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <DetailMetric label="Reported killed" value={event.killed > 0 ? formatCompact(event.killed) : "None reported"} accent={event.killed > 0} />
          <DetailMetric label="Counted casualties" value={event.countedCasualties > 0 ? formatCompact(event.countedCasualties) : "--"} />
          <DetailMetric label="Displaced" value={event.displaced > 0 ? formatCompact(event.displaced) : "--"} />
          <DetailMetric label="Geo precision" value={event.ucdp ? ucdpWherePrecisionLabel(event.ucdp.where_prec) : precisionLabel(event.precision)} />
          <DetailMetric label="Confidence" value={`${confidence.score}/100 ${confidence.label}`} accent={confidence.label === "low"} />
        </div>

        <div className="mt-4 rounded-sm border border-white/8 bg-white/[0.022] p-3.5">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-100/50" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white/86">{event.country}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/34">
                {event.lat.toFixed(4)}° / {event.lng.toFixed(4)}°
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/56">{event.conflict}</p>
              {theater && (
                <button
                  type="button"
                  onClick={() => onTheaterFocus(theater)}
                  className="mt-3 inline-flex items-center gap-2 rounded-sm border border-amber-200/18 bg-amber-300/[0.07] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/76 transition hover:border-amber-200/35 hover:text-white"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  Isolate theater
                </button>
              )}
            </div>
          </div>
        </div>

        {event.ucdp && (
          <div className="mt-4 rounded-sm border border-sky-200/10 bg-sky-300/[0.035] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-sky-100/48">
                Official UCDP {event.ucdp.dataset_release.includes("candidate") ? "Candidate" : "GED"} record
              </p>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/34">{event.ucdp.code_status || "status unknown"}</span>
            </div>
            <div className="mt-3 space-y-2.5 text-[12px] leading-relaxed text-white/60">
              <p>
                <span className="text-white/34">Event:</span> {event.ucdp.id} · {event.ucdp.relid || "relid unavailable"} · release {event.ucdp.dataset_version} ({event.ucdp.dataset_release})
              </p>
              <p>
                <span className="text-white/34">Violence:</span> {violenceTypeLabel(event.ucdp.type_of_violence)} · {event.ucdp.dyad_name || "dyad unavailable"}
              </p>
              <p>
                <span className="text-white/34">Resolution:</span> {eventClarityLabel(event.ucdp.event_clarity)}
              </p>
              <p>
                <span className="text-white/34">Actors:</span> {event.ucdp.side_a || "unknown side A"} (ID {event.ucdp.side_a_new_id ?? "unknown"}) vs {event.ucdp.side_b || "unknown side B"} (ID {event.ucdp.side_b_new_id ?? "unknown"})
              </p>
              <p>
                <span className="text-white/34">Fatalities:</span> low {event.ucdp.low ?? "unknown"} / best {event.ucdp.best ?? "unknown"} / high {event.ucdp.high ?? "unknown"} · side A {event.ucdp.deaths_a ?? 0}, side B {event.ucdp.deaths_b ?? 0}, civilians {event.ucdp.deaths_civilians ?? 0}, unknown status {event.ucdp.deaths_unknown ?? 0}
              </p>
              {ucdpFatalityIntervalDiscrepancy && (
                <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-amber-100/48">
                  Published candidate interval is internally inconsistent; values are preserved rather than silently corrected.
                </p>
              )}
              {ucdpHighOnlyFatalityUncertainty && (
                <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-amber-100/48">
                  Only the high fatality estimate is positive; reporting supports at least one death, but attribution or source reliability remains uncertain.
                </p>
              )}
              <p>
                <span className="text-white/34">Time:</span> {event.ucdp.date_start || "unknown"} → {event.ucdp.date_end || "unknown"} · {datePrecisionLabel(event.ucdp.date_prec)}
              </p>
              <p>
                <span className="text-white/34">Location:</span> {event.ucdp.where_description || event.ucdp.where_coordinates || "location unavailable"} · {ucdpWherePrecisionLabel(event.ucdp.where_prec)} · {event.ucdp.adm_2 || event.ucdp.adm_1 || event.ucdp.country || "administration unavailable"}
              </p>
              <p>
                <span className="text-white/34">Provenance:</span> {event.ucdp.number_of_sources && event.ucdp.number_of_sources > 0 ? `${event.ucdp.number_of_sources} source(s)` : "source count unavailable"} · {event.ucdp.source_office || "source office unavailable"} · original attribution: {event.ucdp.source_original || "unavailable"}
              </p>
              {event.ucdp.dataset_release.includes("candidate") && (
                <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-sky-100/38">
                  Candidate coding is preliminary and may be revised, reclassified, or omitted from the final annual GED.
                </p>
              )}
              {event.ucdp.source_article && (
                <p className="max-h-28 overflow-y-auto rounded-sm border border-white/8 bg-black/18 p-2 font-mono text-[10px] leading-relaxed text-white/42">
                  {event.ucdp.source_article}
                </p>
              )}
            </div>
          </div>
        )}

        {event.incident && (
          <div className="mt-4 rounded-sm border border-white/8 bg-white/[0.022] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/38">
                <GitMerge className="h-3.5 w-3.5" /> Evidence cluster
              </p>
              {(() => {
                const meta = CORRELATION_CONFIDENCE_META[event.incident.confidence];
                return (
                  <span
                    className="rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
                    style={{ borderColor: `${meta.color}55`, backgroundColor: meta.softColor, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                );
              })()}
            </div>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/52">
              {event.evidence?.confidenceReason ?? "No additional report met the deterministic correlation threshold; absence of corroboration is a coverage statement, not a dismissal."}
            </p>
            {event.evidence && (
              <>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                  {event.evidence.memberCount} reports retained in full across {event.evidence.independentFamilyCount} independent source {event.evidence.independentFamilyCount === 1 ? "family" : "families"} — correlation never deletes source records
                </p>
                {event.evidence.contradictions.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    {event.evidence.contradictions.map((contradiction) => (
                      <p key={`${contradiction.kind}-${contradiction.memberEventIds.join("-")}`} className="rounded-sm border border-amber-200/14 bg-amber-300/[0.05] px-2.5 py-2 font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.08em] text-amber-100/62">
                        {contradiction.kind} contradiction — {contradiction.summary}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-3 space-y-2">
                  {event.evidence.members.map((member) => (
                    <details key={member.event.id} className="rounded-sm border border-white/8 bg-black/18 px-2.5 py-2">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded-sm border border-white/12 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/56">
                            {SOURCE_FAMILY_LABEL[member.sourceFamily] ?? member.sourceFamily}
                          </span>
                          <span className="font-mono text-[9px] text-white/32">score {member.correlationScore.toFixed(2)}</span>
                        </div>
                        <p className="mt-1.5 text-[11.5px] leading-snug text-white/66">{member.event.title}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
                          {formatRelativeTime(member.event.occurredAt)} · {member.event.killed > 0 ? `${member.event.killed} reported killed` : "no positive toll"} · correlation rationale inside
                        </p>
                      </summary>
                      <div className="mt-2 space-y-1 border-l border-white/10 pl-2.5">
                        {member.rationale.map((line) => (
                          <p key={line} className="font-mono text-[9px] leading-relaxed text-white/40">{line}</p>
                        ))}
                        {member.event.sourceUrl && (
                          <a href={member.event.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-sky-100/50 underline decoration-sky-100/20 underline-offset-2 hover:text-sky-100/80">
                            {member.event.sourceName || "source record"} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </>
            )}
            <p className="mt-2.5 font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.1em] text-white/24">
              Deterministic correlation {event.evidence?.algorithmVersion ?? "incident-correlation-v1"}: spatial, temporal, actor, title/location, fatality, and source-identity evidence only. Linkage is an evidence-preserving inference, never a claim of identity.
            </p>
          </div>
        )}

        <ConvergenceSection card={convergenceCard} event={event} />

        <RegionalIntel event={event} snapshot={snapshot} />

        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">Source chain</p>
          <div className="mt-2 space-y-2">
            {event.sources.length === 0 ? (
              <p className="rounded-sm border border-white/8 bg-white/[0.02] px-3 py-3 text-sm text-white/36">No public source links supplied for this incident.</p>
            ) : event.sources.map((source) => (
              <a
                key={`${source.name}-${source.url}`}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between gap-3 rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5 transition hover:border-amber-200/22 hover:bg-amber-300/[0.045]"
              >
                <span className="truncate text-sm text-white/68 group-hover:text-white/88">{source.name}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/26 group-hover:text-amber-100/70" />
              </a>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-sm border border-amber-200/10 bg-amber-300/[0.035] p-3 font-mono text-[10px] leading-relaxed uppercase tracking-[0.12em] text-amber-100/42">
          OSINT incident data may be incomplete, corrected, or merged as reporting improves. Casualty fields reflect source reports rather than independent confirmation.
        </div>
      </div>
    </aside>
  );
}
