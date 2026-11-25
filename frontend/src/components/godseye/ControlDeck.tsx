"use client";

import { useState } from "react";
import { Cloud, Compass, Hexagon, Orbit, Pause, Plane, Play, Leaf, Radio, ScanLine, Signal, SlidersHorizontal, Tags, Waypoints } from "lucide-react";
import type { CategoryGroup, SeverityKey, TimelineBucket, TimeWindowKey } from "@/types/conflict";
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
  { key: "aircraft", label: "Air", icon: Plane },
  { key: "environmental", label: "Env", icon: Leaf },
  { key: "gpsInterference", label: "GPS", icon: Signal },
];

export default function ControlDeck({
  timeWindow,
  categoryGroups,
  severities,
  layers,
  autoRotate,
  tourActive,
  timeline,
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
            className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${autoRotate ? "border-amber-200/25 bg-amber-300/[0.09] text-amber-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
          >
            {autoRotate ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            Drift
          </button>

          <button
            type="button"
            onClick={() => onTourActiveChange(!tourActive)}
            title="Cycle priority theaters with cinematic target locks"
            className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${tourActive ? "border-red-300/30 bg-red-400/[0.11] text-red-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
          >
            <Compass className="h-3.5 w-3.5" />
            Tour
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setLayersOpen((open) => !open)}
              className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${layersOpen ? "border-amber-200/30 bg-amber-300/[0.1] text-amber-100" : "border-white/10 bg-white/[0.025] text-white/46 hover:text-white/72"}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Layers
              <span className="rounded-sm bg-white/[0.07] px-1 text-[9px] text-white/52">{activeLayerCount}</span>
            </button>
            {layersOpen ? (
              <div className="godseye-panel absolute bottom-10 right-0 z-50 grid w-[330px] grid-cols-2 gap-1.5 p-2">
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
