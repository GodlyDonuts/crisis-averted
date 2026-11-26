"use client";

import { useState } from "react";
import { Cloud, Compass, Download, Hexagon, Newspaper, Orbit, Pause, Plane, Play, Ship, Leaf, Radio, ScanLine, Signal, Radar, SlidersHorizontal, Tags, Waypoints, WifiOff } from "lucide-react";
import type { CategoryGroup, ConflictEvent, SeverityKey, TimelineBucket, TimeWindowKey } from "@/types/conflict";
import type { GodEyeLayerToggles } from "./GodEyeGlobe";
import { CATEGORY_GROUP_META, SEVERITY_META } from "@/lib/conflictData";

interface ControlDeckProps {
  timeWindow: TimeWindowKey;
  categoryGroups: CategoryGroup[];
  severities: SeverityKey[];
  layers: GodEyeLayerToggles;
  autoRotate: boolean;
  tourActive: boolean;
  timeline: TimelineBucket[];
  events: ConflictEvent[];
  onTimeWindowChange: (window: TimeWindowKey) => void;
  onToggleCategoryGroup: (group: CategoryGroup) => void;
  onToggleSeverity: (severity: SeverityKey) => void;
  onToggleLayer: (layer: keyof GodEyeLayerToggles) => void;
  onAutoRotateChange: (value: boolean) => void;
  onTourActiveChange: (value: boolean) => void;
}

const TIME_WINDOWS: { key: TimeWindowKey; label: string }[] = [
  { key: "24h", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "ALL" },
];

const LAYER_CONTROLS: { key: keyof GodEyeLayerToggles; label: string; icon: typeof ScanLine }[] = [
  { key: "density", label: "Density", icon: Hexagon },
  { key: "beacons", label: "Beacons", icon: Radio },
  { key: "signals", label: "Signals", icon: Waypoints },
  { key: "theaterLabels", label: "Labels", icon: Tags },
  { key: "clouds", label: "Clouds", icon: Cloud },
  { key: "orbitalAssets", label: "Orbital", icon: Orbit },
  { key: "aircraft", label: "Mil air", icon: Plane },
  { key: "civilAviation", label: "Civil air", icon: Radar },
  { key: "maritime", label: "Ships", icon: Ship },
  { key: "environmental", label: "Env", icon: Leaf },
  { key: "gpsInterference", label: "GPS", icon: Signal },
  { key: "internetOutages", label: "Outages", icon: WifiOff },
  { key: "gdeltGeoNews", label: "Geo news", icon: Newspaper },
];

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportEvents(events: ConflictEvent[], format: "json" | "csv") {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  if (format === "json") {
    downloadFile(`godseye-incidents-${stamp}.json`, JSON.stringify(events, null, 2), "application/json");
    return;
  }
  const header = ["id", "occurred_utc", "lat", "lng", "severity", "category", "country", "conflict", "killed", "counted_casualties", "displaced", "precision", "verified", "title", "sources", "ucdp_release", "ucdp_code_status", "ucdp_side_a", "ucdp_side_b", "ucdp_low", "ucdp_best", "ucdp_high", "ucdp_date_start", "ucdp_date_end", "ucdp_where_prec", "ucdp_date_prec", "ucdp_source_count", "ucdp_source_article"];
  const rows = events.map((event) => [
    event.id,
    new Date(event.occurredAt).toISOString(),
    event.lat,
    event.lng,
    event.severity,
    event.category,
    event.country,
    event.conflict,
    event.killed,
    event.countedCasualties,
    event.displaced,
    event.precision,
    event.verified,
    event.title,
    event.sources.map((source) => `${source.name} ${source.url}`).join(" | "),
    event.ucdp ? `${event.ucdp.dataset_version} ${event.ucdp.dataset_release}` : "",
    event.ucdp?.code_status ?? "",
    event.ucdp?.side_a ?? "",
    event.ucdp?.side_b ?? "",
    event.ucdp?.low ?? "",
    event.ucdp?.best ?? "",
    event.ucdp?.high ?? "",
    event.ucdp?.date_start ?? "",
    event.ucdp?.date_end ?? "",
    event.ucdp?.where_prec ?? "",
    event.ucdp?.date_prec ?? "",
    event.ucdp?.number_of_sources ?? "",
    event.ucdp?.source_article ?? "",
  ].map(csvCell).join(","));
  downloadFile(`godseye-incidents-${stamp}.csv`, [header.map(csvCell).join(","), ...rows].join(String.fromCharCode(10)), "text/csv");
}

export default function ControlDeck({
  timeWindow,
  categoryGroups,
  severities,
  layers,
  autoRotate,
  tourActive,
  timeline,
  events,
  onTimeWindowChange,
  onToggleCategoryGroup,
  onToggleSeverity,
  onToggleLayer,
  onAutoRotateChange,
  onTourActiveChange,
}: ControlDeckProps) {
  const maxCount = Math.max(1, ...timeline.map((bucket) => bucket.count));
  const [layersOpen, setLayersOpen] = useState(false);
  const activeLayerCount = Object.values(layers).filter(Boolean).length;

  return (
    <div className="godseye-panel pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(780px,calc(100vw-2rem))] -translate-x-1/2 overflow-visible">
      <div className="hidden border-b border-white/8 px-3 pb-1 pt-2 sm:block">
        <div className="flex h-5 items-end gap-[2px]">
          {timeline.map((bucket) => {
            const height = Math.max(4, Math.round((bucket.count / maxCount) * 18));
            return (
              <div
                key={bucket.key}
                title={`${bucket.key}: ${bucket.count} incidents, ${bucket.critical} critical`}
                className="relative flex-1 rounded-t-sm bg-amber-300/18 transition hover:bg-amber-200/50"
                style={{ height }}
              >
                {bucket.critical > 0 && (
                  <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-sm bg-red-400/90" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 px-2.5 py-2">
        <div className="godseye-scrollbar flex items-center justify-start gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
          {(Object.keys(CATEGORY_GROUP_META) as CategoryGroup[]).map((group) => {
            const active = categoryGroups.includes(group);
            const meta = CATEGORY_GROUP_META[group];
            return (
              <button
                key={group}
                type="button"
                title={meta.description}
                onClick={() => onToggleCategoryGroup(group)}
                aria-pressed={active}
                className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] transition ${active ? "border-white/16 bg-white/[0.055] text-white/82" : "border-white/8 bg-white/[0.015] text-white/28 hover:text-white/52"}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? meta.color : "rgba(255,255,255,0.18)" }} />
                {meta.label}
              </button>
            );
          })}

          <div className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />

          <div className="flex items-center gap-1">
            {(Object.keys(SEVERITY_META) as SeverityKey[]).map((severity) => {
              const active = severities.includes(severity);
              const meta = SEVERITY_META[severity];
              return (
                <button
                  key={severity}
                  type="button"
                  title={`${active ? "Hide" : "Show"} ${meta.label}`}
                  onClick={() => onToggleSeverity(severity)}
                  aria-pressed={active}
                  aria-label={`${active ? "Hide" : "Show"} ${meta.label} severity incidents`}
                  className={`h-8 w-8 rounded-sm border transition ${active ? "border-white/14 bg-white/[0.05]" : "border-white/8 bg-white/[0.015] opacity-38"}`}
                >
                  <span className="mx-auto block h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="godseye-scrollbar flex items-center justify-start gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
          <div className="flex overflow-hidden rounded-sm border border-white/10">
            {TIME_WINDOWS.map((windowOption) => (
              <button
                key={windowOption.key}
                type="button"
                onClick={() => onTimeWindowChange(windowOption.key)}
                className={`h-8 px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${timeWindow === windowOption.key ? "bg-amber-300/18 text-amber-100" : "bg-white/[0.025] text-white/42 hover:text-white/72"}`}
              >
                {windowOption.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onAutoRotateChange(!autoRotate)}
            aria-pressed={autoRotate}
            className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${autoRotate ? "border-amber-200/25 bg-amber-300/[0.09] text-amber-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
          >
            {autoRotate ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            Drift
          </button>

          <button
            type="button"
            onClick={() => onTourActiveChange(!tourActive)}
            aria-pressed={tourActive}
            title="Cycle priority theaters with cinematic target locks"
            className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${tourActive ? "border-red-300/30 bg-red-400/[0.11] text-red-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
          >
            <Compass className="h-3.5 w-3.5" />
            Tour
          </button>

          <div className="flex overflow-hidden rounded-sm border border-white/10">
            <button
              type="button"
              onClick={() => exportEvents(events, "json")}
              className="flex h-8 items-center gap-1.5 bg-white/[0.025] px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/46 transition hover:text-white/72"
              title="Export filtered incidents as JSON"
            >
              <Download className="h-3.5 w-3.5" /> JSON
            </button>
            <button
              type="button"
              onClick={() => exportEvents(events, "csv")}
              className="flex h-8 items-center gap-1.5 border-l border-white/10 bg-white/[0.025] px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/46 transition hover:text-white/72"
              title="Export filtered incidents as CSV"
            >
              CSV
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setLayersOpen((open) => !open)}
              aria-expanded={layersOpen}
              className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${layersOpen ? "border-amber-200/30 bg-amber-300/[0.1] text-amber-100" : "border-white/10 bg-white/[0.025] text-white/46 hover:text-white/72"}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Layers
              <span className="rounded-sm bg-white/[0.07] px-1 text-[9px] text-white/52">{activeLayerCount}</span>
            </button>
            {layersOpen ? (
              <div className="godseye-panel fixed inset-x-3 bottom-36 z-50 grid grid-cols-2 gap-1.5 p-2 sm:absolute sm:inset-x-auto sm:bottom-10 sm:right-0 sm:w-[330px]">
                {LAYER_CONTROLS.map((layer) => {
                  const Icon = layer.icon;
                  const active = layers[layer.key];
                  return (
                    <button
                      key={layer.key}
                      type="button"
                      onClick={() => onToggleLayer(layer.key)}
                      className={`flex h-9 items-center gap-2 rounded-sm border px-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] transition ${active ? "border-amber-200/24 bg-amber-300/[0.08] text-amber-100/86" : "border-white/8 bg-white/[0.018] text-white/34 hover:text-white/62"}`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {layer.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
