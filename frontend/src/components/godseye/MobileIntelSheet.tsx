"use client";

import { useState } from "react";
import { Activity, ChevronDown, Layers3, X } from "lucide-react";
import type { ConflictEvent, ConflictTheater } from "@/types/conflict";
import { SEVERITY_META, formatRelativeTime } from "@/lib/conflictData";

interface MobileIntelSheetProps {
  events: ConflictEvent[];
  theaters: ConflictTheater[];
  selectedEvent: ConflictEvent | null;
  selectedTheater: ConflictTheater | null;
  onEventSelect: (event: ConflictEvent) => void;
  onTheaterSelect: (theater: ConflictTheater | null) => void;
}

export function MobileIntelSheet({
  events,
  theaters,
  selectedEvent,
  selectedTheater,
  onEventSelect,
  onTheaterSelect,
}: MobileIntelSheetProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"feed" | "theaters">("feed");

  return (
    <div className="pointer-events-auto xl:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-[4.7rem] z-40 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-[#07111dcc] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        <Layers3 className="h-4 w-4" /> Intel
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close intelligence panel"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <section className="godseye-panel absolute inset-x-0 bottom-0 flex h-[72vh] flex-col overflow-hidden rounded-t-3xl border-x-0 border-b-0">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-cyan-200/70">
                <Activity className="h-4 w-4" /> Intelligence lattice
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-white/10 p-2 text-slate-300"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-white/10 p-3">
              {(["feed", "theaters"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`rounded-xl border px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] ${
                    tab === item
                      ? "border-cyan-300/45 bg-cyan-400/12 text-cyan-100"
                      : "border-white/10 bg-white/[0.03] text-slate-400"
                  }`}
                >
                  {item === "feed" ? `Feed ${events.length}` : `Theaters ${theaters.length}`}
                </button>
              ))}
            </div>

            <div className="godseye-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
              {tab === "feed" ? (
                <div className="space-y-2">
                  {events.slice(0, 80).map((event) => {
                    const meta = SEVERITY_META[event.severity];
                    const active = selectedEvent?.id === event.id;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => {
                          onEventSelect(event);
                          setOpen(false);
                        }}
                        className={`w-full rounded-xl border p-3 text-left ${
                          active ? "border-cyan-300/50 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em]">
                          <span style={{ color: meta.color }}>{event.severity}</span>
                          <span className="text-slate-500">{formatRelativeTime(event.occurredAt)}</span>
                        </div>
                        <div className="text-sm font-semibold leading-snug text-slate-100">{event.title}</div>
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {event.country} · {event.category.replace("_", " ")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedTheater ? (
                    <button
                      type="button"
                      onClick={() => onTheaterSelect(null)}
                      className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-red-100"
                    >
                      <ChevronDown className="h-4 w-4" /> Clear theater isolation
                    </button>
                  ) : null}
                  {theaters.slice(0, 60).map((theater, index) => {
                    const active = selectedTheater?.slug === theater.slug;
                    return (
                      <button
                        key={theater.slug}
                        type="button"
                        onClick={() => {
                          onTheaterSelect(active ? null : theater);
                          setOpen(false);
                        }}
                        className={`w-full rounded-xl border p-3 text-left ${
                          active ? "border-cyan-300/50 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-1 font-mono text-[10px] text-cyan-300/70">{String(index + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-100">{theater.name}</span>
                            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              {theater.region} · {theater.eventCount} events · {theater.criticalCount} critical
                            </span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
