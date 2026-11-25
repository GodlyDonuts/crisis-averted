"use client";

import { Activity, AlertTriangle, Database, X } from "lucide-react";
import type { OsintSnapshot } from "@/types/conflict";
import { formatRelativeTime } from "@/lib/conflictData";

interface SourceStatusPanelProps {
  snapshot: OsintSnapshot;
  conflictSource: "live" | "fallback" | null;
  conflictError: string | null;
  lastUpdated: number | null;
  onClose: () => void;
}

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/7 px-3 py-2 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/34">{label}</span>
      <span className={`text-right font-mono text-[11px] ${warn ? "text-amber-100/78" : "text-white/72"}`}>{value}</span>
    </div>
  );
}

export function SourceStatusPanel({ snapshot, conflictSource, conflictError, lastUpdated, onClose }: SourceStatusPanelProps) {
  const snapshotAge = snapshot.fetchedAt ? formatRelativeTime(Date.parse(snapshot.fetchedAt)) : "not loaded";
  return (
    <aside className="godseye-panel pointer-events-auto absolute right-4 top-[4.5rem] z-50 hidden w-[360px] overflow-hidden xl:block">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-amber-100/60" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/36">Public intelligence lattice</p>
            <h2 className="mt-0.5 text-sm font-semibold text-white/90">Source status</h2>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-sm border border-white/10 text-white/42 hover:text-white" aria-label="Close source status">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-2 py-2">
        <Row label="Conflict feeds" value={conflictSource === "live" ? `Live · ${lastUpdated ? formatRelativeTime(lastUpdated) : "syncing"}` : "Cached fallback"} warn={conflictSource !== "live"} />
        <Row label="Snapshot age" value={snapshotAge} />
        <Row label="Military aircraft" value={String(snapshot.militaryAircraft.length)} />
        <Row label="News articles" value={String(snapshot.news.length)} />
        <Row label="Launch pads" value={String(snapshot.launches.length)} />
        <Row label="Natural events" value={String(snapshot.naturalEvents.length)} />
        <Row label="GPS interference cells" value={String(snapshot.gpsInterference.length)} />
      </div>

      <div className="border-t border-white/8 px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
          <Activity className="h-3.5 w-3.5" /> Registered public endpoints
        </div>
        <div className="mt-2 space-y-1.5">
          {Object.entries(snapshot.sources).map(([key, value]) => (
            <div key={key} className="flex items-start justify-between gap-3 text-[11px]">
              <span className="font-mono uppercase tracking-[0.1em] text-white/30">{key}</span>
              <span className="text-right text-white/58">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {(snapshot.errors.length > 0 || conflictError) && (
        <div className="border-t border-amber-200/10 bg-amber-300/[0.035] px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-100/56">
            <AlertTriangle className="h-3.5 w-3.5" /> Degraded sources
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-50/54">
            {[conflictError, ...snapshot.errors].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}
    </aside>
  );
}
