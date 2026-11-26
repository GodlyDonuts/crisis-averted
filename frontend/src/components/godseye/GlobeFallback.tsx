"use client";

import type { ConflictEvent, ConflictTheater, MilitaryAircraft } from "@/types/conflict";
import { formatRelativeTime, naturalEventColor, SEVERITY_META } from "@/lib/conflictData";
import type { OsintNaturalEvent } from "@/types/conflict";
import { AlertTriangle } from "lucide-react";

interface GlobeFallbackProps {
  events: ConflictEvent[];
  theaters: ConflictTheater[];
  militaryAircraft: MilitaryAircraft[];
  naturalEvents: OsintNaturalEvent[];
  selectedEvent: ConflictEvent | null;
  onEventSelect: (event: ConflictEvent) => void;
}

function projectX(lng: number) {
  return ((lng + 180) / 360) * 100;
}

function projectY(lat: number) {
  return ((90 - lat) / 180) * 100;
}

export function GlobeFallback({ events, theaters, militaryAircraft, naturalEvents, selectedEvent, onEventSelect }: GlobeFallbackProps) {
  const plottedEvents = events.slice(0, 140);
  return (
    <section className="absolute inset-0 overflow-hidden bg-[#050706] px-4 py-20 text-white" aria-label="Fallback incident map">
      <div className="mx-auto flex h-full max-w-6xl flex-col gap-4">
        <div className="godseye-panel flex items-center gap-3 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-300" />
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-100">Non-WebGL operations view</h1>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/42">
              GPU globe unavailable. Reporting remains accessible through the projected incident lattice.
            </p>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 border border-amber-100/15 bg-[#07100d]">
          <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(to_right,rgba(226,183,94,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(226,183,94,0.12)_1px,transparent_1px)] [background-size:10%_11.11%]" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-amber-100/20" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-amber-100/20" />
          {theaters.slice(0, 24).map((theater) => (
            <div key={theater.slug} className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-amber-100/36" style={{ left: `${projectX(theater.lng)}%`, top: `${projectY(theater.lat) - 3}%` }}>
              {theater.name}
            </div>
          ))}
          {militaryAircraft.slice(0, 80).map((aircraft) => (
            <div key={aircraft.id} title={`${aircraft.callsign} military aircraft`} className="absolute h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#b8c29a]/55" style={{ left: `${projectX(aircraft.lng)}%`, top: `${projectY(aircraft.lat)}%` }} />
          ))}
          {naturalEvents.slice(0, 50).map((event) => (
            <div key={event.id} title={event.title} className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70" style={{ left: `${projectX(event.lng)}%`, top: `${projectY(event.lat)}%`, backgroundColor: naturalEventColor(event) }} />
          ))}
          {plottedEvents.map((event) => {
            const selected = selectedEvent?.id === event.id;
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onEventSelect(event)}
                aria-label={`${event.title}, ${event.country}, ${event.severity} severity`}
                className={`absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-transform hover:scale-150 focus:outline-none focus:ring-2 focus:ring-amber-200 ${selected ? "scale-150 border-white" : "border-black/50"}`}
                style={{ left: `${projectX(event.lng)}%`, top: `${projectY(event.lat)}%`, backgroundColor: SEVERITY_META[event.severity].color }}
              />
            );
          })}
        </div>

        <ol className="godseye-panel grid gap-1 overflow-y-auto px-3 py-2 md:grid-cols-2" aria-label="Priority incident roster">
          {events.slice(0, 8).map((event) => (
            <li key={event.id}>
              <button type="button" onClick={() => onEventSelect(event)} className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-white/[0.035] focus:outline-none focus:ring-1 focus:ring-amber-200/50">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SEVERITY_META[event.severity].color }} />
                <span className="min-w-0 flex-1 truncate text-xs text-white/76">{event.title}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/36">{formatRelativeTime(event.occurredAt)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
