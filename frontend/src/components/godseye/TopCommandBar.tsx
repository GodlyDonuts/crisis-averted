"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Crosshair, Globe2, Radio, RefreshCw, Satellite, Search } from "lucide-react";
import type { ConflictSummary } from "@/types/conflict";
import type { GodEyeVisualMode } from "./GodEyeGlobe";
import { formatCompact, formatRelativeTime } from "@/lib/conflictData";

interface TopCommandBarProps {
  summary: ConflictSummary;
  source: "live" | "fallback" | null;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: number | null;
  query: string;
  visualMode: GodEyeVisualMode;
  onQueryChange: (query: string) => void;
  onVisualModeChange: (mode: GodEyeVisualMode) => void;
  onRefresh: () => void;
  sourcePanelOpen: boolean;
  onToggleSourcePanel: () => void;
}

function useUtcClock(): string {
  const [time, setTime] = useState("--:--:--");
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toISOString().slice(11, 19));
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);
  return time;
}

export default function TopCommandBar({
  summary,
  source,
  loading,
  refreshing,
  lastUpdated,
  query,
  visualMode,
  onQueryChange,
  onVisualModeChange,
  onRefresh,
  sourcePanelOpen,
  onToggleSourcePanel,
}: TopCommandBarProps) {
  const utcTime = useUtcClock();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="pointer-events-auto absolute left-0 right-0 top-0 z-40 border-b border-amber-300/10 bg-[#02060d]/78 backdrop-blur-xl">
      <div className="grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-amber-300/30 bg-amber-400/10 shadow-[0_0_22px_rgba(214,168,79,0.1)]">
            <Crosshair className="h-5 w-5 text-amber-200" strokeWidth={1.7} />
            <span className="absolute inset-0 rounded-full border border-amber-200/10" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-sm font-semibold tracking-[0.28em] text-white sm:text-base">GOD&apos;S EYE</h1>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${source === "live" ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200" : "border-amber-300/25 bg-amber-400/10 text-amber-200"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${source === "live" ? "bg-emerald-300" : "bg-amber-300"} ${loading ? "animate-pulse" : ""}`} />
                {source === "live" ? "Live" : source === "fallback" ? "Cached" : "Init"}
              </span>
            </div>
            <p className="mt-0.5 hidden truncate font-mono text-[10px] uppercase tracking-[0.22em] text-amber-100/38 sm:block">
              PUBLIC OSINT · NOT FOR OPERATIONAL USE
            </p>
          </div>
        </div>

        <div className="hidden items-center justify-center gap-5 font-mono text-[11px] uppercase tracking-[0.16em] text-white/48 md:flex">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-amber-200/70" />
            <span>{formatCompact(summary.totalEvents)} incidents</span>
          </div>
          <div className="text-red-200/78">{formatCompact(summary.criticalEvents)} critical</div>
          <div>{formatCompact(summary.activeTheaters)} theaters</div>
          <div className="text-amber-100/70">UTC {utcTime}</div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <label className="relative hidden w-[280px] items-center lg:flex">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-amber-100/35" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search incidents, countries or theaters…"
              className="h-10 w-full rounded-sm border border-amber-200/12 bg-white/[0.035] pl-9 pr-14 font-mono text-xs text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/35 focus:bg-amber-400/[0.055]"
            />
            <kbd className="pointer-events-none absolute right-2 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-white/35">Ctrl K</kbd>
          </label>

          <div className="hidden overflow-hidden rounded-sm border border-white/10 sm:flex">
            <button
              type="button"
              onClick={() => onVisualModeChange("cinematic")}
              className={`flex h-10 items-center gap-2 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition ${visualMode === "cinematic" ? "bg-amber-300/16 text-amber-100" : "bg-white/[0.025] text-white/42 hover:text-white/70"}`}
              title="Operational day/night Earth"
            >
              <Globe2 className="h-4 w-4" />
              Operational
            </button>
            <button
              type="button"
              onClick={() => onVisualModeChange("satellite")}
              className={`flex h-10 items-center gap-2 border-l border-white/10 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition ${visualMode === "satellite" ? "bg-amber-300/16 text-amber-100" : "bg-white/[0.025] text-white/42 hover:text-white/70"}`}
              title="Satellite imagery mode"
            >
              <Satellite className="h-4 w-4" />
              Sat
            </button>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="flex h-10 w-10 items-center justify-center rounded-sm border border-white/10 bg-white/[0.03] text-white/55 transition hover:border-amber-200/25 hover:text-amber-100"
            title={lastUpdated ? `Last updated ${formatRelativeTime(lastUpdated)}` : "Refresh intelligence"}
            aria-label="Refresh intelligence"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>

          <button
            type="button"
            onClick={onToggleSourcePanel}
            className={`hidden h-10 items-center gap-2 rounded-sm border px-3 font-mono text-[10px] uppercase tracking-[0.18em] transition xl:flex ${sourcePanelOpen ? "border-amber-200/30 bg-amber-300/[0.1] text-amber-100" : "border-amber-200/12 bg-amber-300/[0.055] text-amber-100/62 hover:text-amber-50"}`}
          >
            <Radio className="h-3.5 w-3.5" />
            Public intel
          </button>
        </div>
      </div>
    </header>
  );
}
