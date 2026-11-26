"use client";

import { BadgeCheck, Crosshair, ExternalLink, MapPin, X } from "lucide-react";
import type { ConflictEvent, ConflictTheater, OsintSnapshot } from "@/types/conflict";
import { RegionalIntel } from "./RegionalIntel";
import { formatCompact, formatRelativeTime, formatUtcTime, normalizeCategory, SEVERITY_META } from "@/lib/conflictData";

interface EventDetailPanelProps {
  event: ConflictEvent;
  theater: ConflictTheater | null;
  snapshot: OsintSnapshot;
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

function DetailMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</p>
      <p className={`mt-1 font-mono text-sm ${accent ? "text-red-100" : "text-white/82"}`}>{value}</p>
    </div>
  );
}

export default function EventDetailPanel({ event, theater, snapshot, onClose, onTheaterFocus }: EventDetailPanelProps) {
  const severity = SEVERITY_META[event.severity];
  const threatIndex = Math.round(event.intensity * 100);

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
                  <BadgeCheck className="h-3.5 w-3.5" /> Verified
                </span>
              )}
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug text-white/94">{event.title}</h2>
          </div>
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
            <span>Priority score</span>
            <span>{threatIndex}/100</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full" style={{ width: `${threatIndex}%`, backgroundColor: severity.color }} />
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-white/34">
            <span>{formatRelativeTime(event.occurredAt)}</span>
            <span>{formatUtcTime(event.occurredAt)}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <DetailMetric label="Reported killed" value={event.killed > 0 ? formatCompact(event.killed) : "None reported"} accent={event.killed > 0} />
          <DetailMetric label="Counted casualties" value={event.countedCasualties > 0 ? formatCompact(event.countedCasualties) : "--"} />
          <DetailMetric label="Displaced" value={event.displaced > 0 ? formatCompact(event.displaced) : "--"} />
          <DetailMetric label="Geo precision" value={precisionLabel(event.precision)} />
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
