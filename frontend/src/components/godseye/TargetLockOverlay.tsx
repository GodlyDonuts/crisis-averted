"use client";

import type { ConflictEvent } from "@/types/conflict";
import { SEVERITY_META } from "@/lib/conflictData";

interface TargetLockOverlayProps {
  event: ConflictEvent;
}

export function TargetLockOverlay({ event }: TargetLockOverlayProps) {
  const severity = SEVERITY_META[event.severity];

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 hidden -translate-x-1/2 -translate-y-1/2 md:block" aria-hidden="true">
      <div className="relative h-40 w-40 opacity-85">
        <span className="absolute left-0 top-0 h-8 w-8 border-l border-t border-cyan-200/60" />
        <span className="absolute right-0 top-0 h-8 w-8 border-r border-t border-cyan-200/60" />
        <span className="absolute bottom-0 left-0 h-8 w-8 border-b border-l border-cyan-200/60" />
        <span className="absolute bottom-0 right-0 h-8 w-8 border-b border-r border-cyan-200/60" />
        <span className="godseye-reticle absolute inset-7 rounded-full border border-cyan-200/28" />
        <span className="absolute left-1/2 top-1/2 h-px w-7 -translate-x-1/2 bg-cyan-100/35" />
        <span className="absolute left-1/2 top-1/2 h-7 w-px -translate-y-1/2 bg-cyan-100/35" />
        <span
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ backgroundColor: severity.color, boxShadow: `0 0 18px ${severity.color}` }}
        />
      </div>
      <div className="absolute left-1/2 top-full mt-1 w-max -translate-x-1/2 text-center font-mono text-[9px] uppercase tracking-[0.24em] text-cyan-100/58">
        <div style={{ color: severity.color }}>Target lock / {event.severity}</div>
        <div className="mt-1 text-white/35">{event.lat.toFixed(3)}° / {event.lng.toFixed(3)}°</div>
      </div>
    </div>
  );
}
