"use client";

import { ChevronRight, Flame, X } from "lucide-react";
import type { ConflictTheater } from "@/types/conflict";
import { formatCompact, formatRelativeTime, normalizeCategory } from "@/lib/conflictData";

interface TheaterListProps {
  theaters: ConflictTheater[];
  selectedTheaterSlug: string | null;
  onTheaterSelect: (theater: ConflictTheater) => void;
  onClearTheater: () => void;
}

function dominantCategory(theater: ConflictTheater): string {
  const entries = Object.entries(theater.categories).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ? normalizeCategory(entries[0][0]) : "Unclassified";
}

export default function TheaterList({ theaters, selectedTheaterSlug, onTheaterSelect, onClearTheater }: TheaterListProps) {
  const selectedTheater = theaters.find((theater) => theater.slug === selectedTheaterSlug) ?? null;

  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-[172px] left-4 top-20 z-30 hidden w-[318px] flex-col overflow-hidden xl:flex">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-100/42">Priority theaters</p>
          <h2 className="mt-1 text-sm font-semibold text-white/92">Target priority deck</h2>
        </div>
        {selectedTheaterSlug && (
          <button
            type="button"
            onClick={onClearTheater}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/45 transition hover:border-red-300/30 hover:text-red-100"
            aria-label="Clear theater filter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {selectedTheater && (
        <div className="border-b border-cyan-200/12 bg-cyan-300/[0.045] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-cyan-50">{selectedTheater.name}</p>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-100/38">Theater isolated</p>
            </div>
            <span className="rounded-full border border-cyan-200/20 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/62">
              {Math.round(selectedTheater.intensity * 100)} idx
            </span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-[10px] text-white/52">
            <div>
              <p className="text-white/28">Events</p>
              <p className="mt-0.5 text-white/82">{formatCompact(selectedTheater.eventCount)}</p>
            </div>
            <div>
              <p className="text-white/28">Critical</p>
              <p className="mt-0.5 text-red-100/82">{formatCompact(selectedTheater.criticalCount)}</p>
            </div>
            <div>
              <p className="text-white/28">Casualties</p>
              <p className="mt-0.5 text-white/82">{formatCompact(selectedTheater.killed)}</p>
            </div>
            <div>
              <p className="text-white/28">Displaced</p>
              <p className="mt-0.5 text-white/82">{formatCompact(selectedTheater.displaced)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="godseye-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {theaters.length === 0 ? (
          <div className="px-3 py-8 text-center font-mono text-xs uppercase tracking-[0.16em] text-white/28">
            No active theaters in filter
          </div>
        ) : theaters.slice(0, 18).map((theater, index) => {
          const selected = theater.slug === selectedTheaterSlug;
          const intensityPct = Math.max(5, Math.round(theater.intensity * 100));
          return (
            <button
              key={theater.slug}
              type="button"
              onClick={() => onTheaterSelect(theater)}
              className={`group mb-1.5 w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${selected ? "border-cyan-200/40 bg-cyan-300/[0.10] shadow-[0_0_30px_rgba(34,211,238,0.08)]" : "border-transparent bg-white/[0.018] hover:border-white/10 hover:bg-white/[0.045]"}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[10px] ${selected ? "bg-cyan-200/16 text-cyan-100" : "bg-white/[0.045] text-white/35"}`}>
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[13px] font-medium text-white/88">{theater.name}</h3>
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition ${selected ? "text-cyan-100" : "text-white/20 group-hover:text-white/42"}`} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/34">
                    <span className="truncate">{theater.region}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(theater.latestAt)}</span>
                  </div>

                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.065]">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${selected ? "bg-cyan-200" : "bg-gradient-to-r from-cyan-300/60 via-orange-300/70 to-red-400/80"}`}
                      style={{ width: `${intensityPct}%` }}
                    />
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-white/38">
                    <span>{formatCompact(theater.eventCount)} evt</span>
                    <span className={theater.criticalCount > 0 ? "text-red-200/78" : ""}>{formatCompact(theater.criticalCount)} crit</span>
                    <span className="truncate text-right">{dominantCategory(theater)}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="border-t border-white/8 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/28">
        <span className="inline-flex items-center gap-1.5"><Flame className="h-3 w-3 text-orange-200/60" /> Ranked by intensity, recency and casualty signal</span>
      </div>
    </aside>
  );
}
