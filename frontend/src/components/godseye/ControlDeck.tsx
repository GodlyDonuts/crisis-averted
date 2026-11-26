"use client";

import { useEffect, useRef, useState } from "react";
import { Binoculars, Clock3, Cloud, Compass, Download, FileJson, FileText, HandHeart, Hexagon, Network, Newspaper, Orbit, Pause, Plane, Play, Sheet, Ship, Leaf, Radio, ScanLine, Signal, Radar, SlidersHorizontal, Tags, Waypoints, WifiOff, X } from "lucide-react";
import type { CategoryGroup, ConflictEvent, SeverityKey, TimelineBucket, TimeWindowKey } from "@/types/conflict";
import type { IncidentTemporalCoverage } from "@/lib/incidentTime";
import type { IncidentPlaybackController } from "@/hooks/useIncidentPlayback";
import type { AnalystExportArtifacts } from "@/lib/analystExport";
import type { GodEyeLayerToggles } from "./GodEyeGlobe";
import IncidentPlaybackPanel from "./IncidentPlaybackPanel";
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
  playback: IncidentPlaybackController;
  corpusCoverage: IncidentTemporalCoverage;
  convergenceOpen?: boolean;
  convergenceCardCount?: number;
  /** Convergence cards across the full filter scope (export coverage), as opposed to the playback-lens-filtered badge count. */
  convergenceScopeCardCount?: number;
  convergenceEvidencePending?: boolean;
  /** Export is enabled only when every domain chunk is usable; otherwise counts/provenance would silently describe partial coverage. */
  snapshotReadyForExport?: boolean;
  snapshotStatusLabel?: string | null;
  watchOpen?: boolean;
  watchAlertCount?: number;
  surgeSignalCount?: number;
  /** Builds the full analyst export bundle artifacts on demand (pure, deterministic given the workspace state). */
  buildAnalystExport?: () => AnalystExportArtifacts;
  onTimeWindowChange: (window: TimeWindowKey) => void;
  onToggleCategoryGroup: (group: CategoryGroup) => void;
  onToggleSeverity: (severity: SeverityKey) => void;
  onToggleLayer: (layer: keyof GodEyeLayerToggles) => void;
  onToggleConvergence?: () => void;
  onToggleWatch?: () => void;
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
  { key: "reliefwebHumanitarian", label: "Relief", icon: HandHeart },
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
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
  playback,
  corpusCoverage,
  convergenceOpen = false,
  convergenceCardCount = 0,
  convergenceScopeCardCount,
  convergenceEvidencePending = false,
  snapshotReadyForExport = true,
  snapshotStatusLabel = null,
  watchOpen = false,
  watchAlertCount = 0,
  surgeSignalCount = 0,
  buildAnalystExport,
  onTimeWindowChange,
  onToggleCategoryGroup,
  onToggleSeverity,
  onToggleLayer,
  onToggleConvergence,
  onToggleWatch,
  onAutoRotateChange,
  onTourActiveChange,
}: ControlDeckProps) {
  const maxCount = Math.max(1, ...timeline.map((bucket) => bucket.count));
  const [layersOpen, setLayersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportFirstActionRef = useRef<HTMLButtonElement>(null);
  const activeLayerCount = Object.values(layers).filter(Boolean).length;
  const evidenceClusterCount = events.filter((event) => (event.evidence?.members?.length ?? 0) > 0).length;

  useEffect(() => {
    if (!exportOpen) return undefined;
    const focusTimeout = window.setTimeout(() => exportFirstActionRef.current?.focus(), 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setExportOpen(false);
        exportTriggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimeout);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [exportOpen]);

  const runExport = (format: "json" | "markdown" | "csv") => {
    if (!snapshotReadyForExport) {
      setExportStatus({ kind: "error", message: `export withheld until all OSINT domain chunks are terminal — ${snapshotStatusLabel ?? "snapshot still loading"}; partial counts would be coverage fiction` });
      return;
    }
    if (!buildAnalystExport) {
      setExportStatus({ kind: "error", message: "export builder unavailable — workspace still initializing" });
      return;
    }
    try {
      const artifacts = buildAnalystExport();
      if (format === "json") {
        downloadFile(artifacts.filenames.bundleJson, artifacts.json, "application/json");
        setExportStatus({ kind: "ok", message: `downloaded ${artifacts.filenames.bundleJson} (${formatBytes(artifacts.jsonBytes)}) — full-fidelity evidence handoff` });
      } else if (format === "markdown") {
        downloadFile(artifacts.filenames.briefMarkdown, artifacts.markdown, "text/markdown");
        setExportStatus({ kind: "ok", message: `downloaded ${artifacts.filenames.briefMarkdown} (${formatBytes(artifacts.markdownBytes)}) — analyst-readable brief` });
      } else {
        downloadFile(artifacts.filenames.incidentsCsv, artifacts.csv, "text/csv");
        setExportStatus({ kind: "ok", message: `downloaded ${artifacts.filenames.incidentsCsv} (${formatBytes(artifacts.csvBytes)}) — flat incident rows with caveat preamble` });
      }
    } catch (error) {
      setExportStatus({ kind: "error", message: `export failed safely: ${error instanceof Error ? error.message : "unknown error"} — nothing was partially written` });
    }
  };

  return (
    <div className={`godseye-panel pointer-events-auto absolute bottom-4 left-1/2 z-40 -translate-x-1/2 overflow-visible ${playback.active ? "w-[min(920px,calc(100vw-2rem))]" : "w-[min(780px,calc(100vw-2rem))]"}`}>
      {playback.active ? (
        <IncidentPlaybackPanel playback={playback} corpusCoverage={corpusCoverage} />
      ) : (
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
      )}

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
            onClick={playback.toggleActive}
            aria-pressed={playback.active}
            title="Deterministic incident temporal playback (keyboard: T)"
            className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${playback.active ? "border-sky-200/30 bg-sky-300/[0.1] text-sky-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
          >
            <Clock3 className="h-3.5 w-3.5" />
            Time
          </button>

          {onToggleConvergence ? (
            <button
              type="button"
              onClick={onToggleConvergence}
              aria-pressed={convergenceOpen}
              title="Multi-domain convergence inspector — explainable co-occurrence evidence, never causality"
              className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${convergenceOpen ? "border-emerald-200/30 bg-emerald-300/[0.1] text-emerald-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
            >
              <Network className="h-3.5 w-3.5" />
              Conv
              {convergenceEvidencePending ? (
                <span className="rounded-sm bg-white/[0.07] px-1 text-[9px] text-white/52" title="Evidence chunks loading; count withheld">…</span>
              ) : convergenceCardCount > 0 ? (
                <span className="rounded-sm bg-white/[0.07] px-1 text-[9px] text-white/52">{convergenceCardCount}</span>
              ) : null}
            </button>
          ) : null}

          {onToggleWatch ? (
            <button
              type="button"
              onClick={onToggleWatch}
              aria-pressed={watchOpen}
              title="Analyst watch center — local statistical surge indicators and rules, never predictions or operational warnings"
              className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${watchOpen ? "border-amber-200/30 bg-amber-300/[0.1] text-amber-100" : "border-white/10 bg-white/[0.025] text-white/42 hover:text-white/72"}`}
            >
              <Binoculars className="h-3.5 w-3.5" />
              Watch
              {watchAlertCount > 0 ? (
                <span className="rounded-sm bg-red-400/18 px-1 text-[9px] text-red-100/78">{watchAlertCount}</span>
              ) : surgeSignalCount > 0 ? (
                <span className="rounded-sm bg-white/[0.07] px-1 text-[9px] text-white/52">{surgeSignalCount}</span>
              ) : null}
            </button>
          ) : null}

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

          <div className="relative">
            <button
              ref={exportTriggerRef}
              type="button"
              onClick={() => { setExportOpen((open) => !open); setExportStatus(null); setLayersOpen(false); }}
              aria-expanded={exportOpen}
              aria-haspopup="dialog"
              aria-label="Open analyst export panel — evidence handoff bundles in JSON, Markdown, or CSV with full provenance, citations, and caveats"
              title="Analyst export — full evidence handoff bundle (JSON), readable brief (Markdown), or flat rows (CSV); UTC filenames, unverified-OSINT and no-operational-authority caveats included"
              className={`flex h-8 items-center gap-1.5 rounded-sm border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition ${exportOpen ? "border-emerald-200/30 bg-emerald-300/[0.1] text-emerald-100" : "border-white/10 bg-white/[0.025] text-white/46 hover:text-white/72"}`}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            {exportOpen ? (
              <div
                role="dialog"
                aria-modal="false"
                aria-label="Analyst export contents and formats"
                className="godseye-panel fixed inset-x-3 bottom-36 z-50 max-h-[min(30rem,calc(100vh-12rem))] overflow-y-auto p-3 godseye-scrollbar sm:absolute sm:inset-x-auto sm:bottom-10 sm:right-0 sm:w-[430px]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[13px] font-semibold text-white/88">Analyst export — evidence handoff</h2>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/32">
                      {events.length} filtered incidents · {evidenceClusterCount} evidence clusters · {convergenceScopeCardCount ?? convergenceCardCount} convergence cards · {surgeSignalCount} surge signals · {watchAlertCount} watch alerts
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setExportOpen(false); exportTriggerRef.current?.focus(); }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/44 transition hover:border-white/24 hover:text-white"
                    aria-label="Close export panel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 space-y-1 border-t border-white/8 pt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.08em] text-white/36">
                  <p>Every format includes: filtered canonical incidents with UTC occurrence windows · full evidence-cluster members with pairwise scores, rationale lines, and preserved contradictions · convergence cards for in-scope anchors · surge signals and triggered watch alerts with evidence references · filter/playback/operator scope · provenance and retrieval timestamps · citations/URLs · attribution and schema versions · shareable permalink.</p>
                  <p className="text-amber-100/46">Unverified OSINT — no operational authority. Secret-shaped search text is withheld. Local dismiss/snooze state never leaves the browser.</p>
                </div>

                <div className="mt-2.5 space-y-1.5">
                  <button
                    ref={exportFirstActionRef}
                    type="button"
                    onClick={() => runExport("json")}
                    className="flex w-full items-center gap-2.5 rounded-sm border border-emerald-200/22 bg-emerald-300/[0.07] px-2.5 py-2 text-left transition hover:border-emerald-200/38 hover:bg-emerald-300/[0.12]"
                  >
                    <FileJson className="h-4 w-4 shrink-0 text-emerald-100/80" />
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-100/90">JSON bundle — full fidelity</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-white/46">Complete evidence handoff: every incident, member report, rationale, contradiction, card, signal, alert, provenance record, citation, and caveat. Machine-readable, schema-versioned.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runExport("markdown")}
                    className="flex w-full items-center gap-2.5 rounded-sm border border-white/10 bg-white/[0.025] px-2.5 py-2 text-left transition hover:border-white/22 hover:bg-white/[0.05]"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-white/60" />
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-white/78">Markdown brief — analyst readable</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-white/46">Caveat-led readable digest of the same bundle. Incidents summarized to the first 120 rows with per-cluster member caps; the JSON bundle remains the full-fidelity artifact.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runExport("csv")}
                    className="flex w-full items-center gap-2.5 rounded-sm border border-white/10 bg-white/[0.025] px-2.5 py-2 text-left transition hover:border-white/22 hover:bg-white/[0.05]"
                  >
                    <Sheet className="h-4 w-4 shrink-0 text-white/60" />
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-white/78">CSV rows — flat incident table</span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-white/46">Spreadsheet-ready filtered incident rows (occurrence windows, UCDP fields, correlation state, member ids) with #-prefixed caveat preamble. No embedded evidence members — use JSON for the full cluster handoff.</span>
                    </span>
                  </button>
                </div>

                <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/28">
                  Filenames and content use UTC timestamps. Export scope is the full filtered incident set — never narrowed by the playback lens; playback state is recorded for reproduction.
                </p>

                {exportStatus ? (
                  <p role={exportStatus.kind === "error" ? "alert" : "status"} className={`mt-2 rounded-sm border px-2 py-1.5 font-mono text-[9px] uppercase leading-relaxed tracking-[0.09em] ${exportStatus.kind === "error" ? "border-red-300/24 bg-red-400/10 text-red-100/80" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100/76"}`}>
                    {exportStatus.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => { setLayersOpen((open) => !open); setExportOpen(false); }}
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
