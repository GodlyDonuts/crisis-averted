"use client";

import { BadgeCheck, RadioTower } from "lucide-react";
import type { ConflictEvent } from "@/types/conflict";
import { formatRelativeTime, normalizeCategory, SEVERITY_META } from "@/lib/conflictData";

interface EventFeedProps {
  events: ConflictEvent[];
  selectedEventId: string | null;
  onEventSelect: (event: ConflictEvent) => void;
}

export default function EventFeed({ events, selectedEventId, onEventSelect }: EventFeedProps) {
  const feedEvents = [...events]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, 90);

  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-[172px] right-4 top-20 z-30 hidden w-[372px] flex-col overflow-hidden xl:flex">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-100/42">Incident feed</p>
          <h2 className="mt-1 text-sm font-semibold text-white/92">Live incidents</h2>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-red-300/20 bg-red-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-red-100/78">
          <RadioTower className="h-3 w-3" />
          {events.length} in scope
        </div>
      </div>

      <div className="godseye-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {feedEvents.length === 0 ? (
          <div className="px-3 py-8 text-center font-mono text-xs uppercase tracking-[0.16em] text-white/28">
            No incidents match current filters
          </div>
        ) : feedEvents.map((event) => {
          const selected = event.id === selectedEventId;
          const severity = SEVERITY_META[event.severity];
          return (
            <button
              key={event.id}
              type="button"
              onClick={() => onEventSelect(event)}
              className={`group relative w-full border-b border-white/8 px-3 py-3 text-left transition-colors duration-150 ${selected ? "bg-amber-300/[0.075]" : "bg-transparent hover:bg-white/[0.032]"}`}
            >
              <span className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ backgroundColor: severity.color }} />
              <div className="pl-2">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
                  <span style={{ color: severity.color }}>{severity.label}</span>
                  <span className="shrink-0 text-white/30">{formatRelativeTime(event.occurredAt)}</span>
                </div>
                <h3 className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-white/88">
                  {event.title}
                </h3>
                <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-white/34">
                  <span className="truncate uppercase tracking-[0.12em]">{event.country} · {normalizeCategory(event.category)}</span>
                  {event.verified && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-amber-100/46">
                      <BadgeCheck className="h-3 w-3" />
                      Verified
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
