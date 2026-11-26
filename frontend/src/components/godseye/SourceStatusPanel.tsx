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


function newestAge(values: Array<string | null | undefined>): string {
  const newest = values.reduce((latest, value) => {
    const time = value ? Date.parse(value) : 0;
    return Number.isFinite(time) && time > latest ? time : latest;
  }, 0);
  return newest ? formatRelativeTime(newest) : "no timestamps";
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
  const outageMeta = snapshot.internetOutageMeta;
  const outageWindowEnd = outageMeta?.queryWindow.until ? formatRelativeTime(outageMeta.queryWindow.until * 1000) : "unknown";
  const outageValue = outageMeta
    ? `${snapshot.internetOutages.length} mapped/${outageMeta.fetchedEventCount} fetched · ${outageMeta.status}`
    : `${snapshot.internetOutages.length} mapped · metadata unavailable`;
  const ucdpMeta = snapshot.ucdpMeta;
  const ucdpValue = ucdpMeta
    ? ucdpMeta.status === "ok"
      ? `${ucdpMeta.mergedEventCount} merged/${ucdpMeta.fetchedEventCount} fetched · ok`
      : ucdpMeta.preservedPriorEventCount > 0
        ? `${ucdpMeta.preservedPriorEventCount} preserved · ${ucdpMeta.status}`
        : ucdpMeta.status
    : "metadata unavailable";
  return (
    <aside className="godseye-panel godseye-scrollbar pointer-events-auto absolute right-4 top-[4.5rem] z-50 hidden max-h-[calc(100vh-5.5rem)] w-[360px] overflow-y-auto xl:block">
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
        <Row label="Civil aviation tracks" value={`${snapshot.aircraft.length} · newest ${newestAge(snapshot.aircraft.map((item) => item.lastContact))}`} />
        <Row label="AIS vessels" value={`${snapshot.vessels.length} · newest ${newestAge(snapshot.vessels.map((item) => item.timestamp))}`} />
        <Row label="Tracked satellites" value={String(snapshot.satellites.length)} />
        <Row label="News articles" value={String(snapshot.news.length)} />
        <Row label="Launch pads" value={String(snapshot.launches.length)} />
        <Row label="Natural events" value={String(snapshot.naturalEvents.length)} />
        <Row label="GPS interference cells" value={String(snapshot.gpsInterference.length)} />
        <Row label="IODA outage detections" value={outageValue} warn={outageMeta?.status !== "ok"} />
        <Row label="IODA query window" value={`${outageMeta ? `${Math.round(outageMeta.queryWindow.lookbackSeconds / 3600)}h ending ${outageWindowEnd}` : "not loaded"}`} />
        <Row label="Map of Wars records" value={String(snapshot.mapOfWarsEvents.length)} />
        <Row label="UCDP official events" value={ucdpValue} warn={ucdpMeta?.status !== "ok"} />
        <Row label="UCDP release" value={ucdpMeta ? `${ucdpMeta.version} · ${ucdpMeta.datasetRelease}` : "not loaded"} />
        <Row label="Known exploited CVEs" value={String(snapshot.cyberVulnerabilities.length)} />
        <Row label="Webcam metadata" value={snapshot.webcams.length > 0 ? String(snapshot.webcams.length) : "key not configured"} warn={snapshot.webcams.length === 0} />
      </div>

      <div className="border-t border-white/8 px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
          <Activity className="h-3.5 w-3.5" /> Cyber exploitation watch
        </div>
        <div className="mt-2 space-y-1.5">
          {snapshot.cyberVulnerabilities.slice(0, 3).map((item) => (
            <div key={item.cveId} className="text-[11px] leading-snug text-white/58">
              <span className="font-mono text-amber-100/70">{item.cveId}</span> · {item.vendor || "Unknown vendor"} {item.product || ""} · {item.dateAdded || "date unavailable"}
            </div>
          ))}
          {snapshot.cyberVulnerabilities.length === 0 && <p className="text-[11px] text-white/34">CISA KEV collection unavailable.</p>}
        </div>
      </div>

      {outageMeta ? (
        <div className="border-t border-white/8 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
            <Activity className="h-3.5 w-3.5" /> IODA outage evidence
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/54">
            Unix window {outageMeta.queryWindow.from}–{outageMeta.queryWindow.until}; {outageMeta.countryEventCount} country and {outageMeta.regionEventCount} region records fetched, {outageMeta.omittedEventCount} omitted when not defensibly geolocatable. Coordinates are coarse Natural Earth reference placements, not outage origins or footprints.
            {outageMeta.status === "preserved" ? " Current ingest degraded; prior build-time snapshot retained." : ""}
          </p>
        </div>
      ) : null}

      {ucdpMeta ? (
        <div className="border-t border-white/8 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
            <Activity className="h-3.5 w-3.5" /> UCDP GED evidence
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/54">
            Fixed version {ucdpMeta.version} ({ucdpMeta.datasetRelease}); {ucdpMeta.ingestedEventCount} high-value records selected from {ucdpMeta.validEventCount} valid/{ucdpMeta.fetchedEventCount} fetched rows, with {ucdpMeta.omittedEventCount} bounded omissions accounted. Authentication uses only a build-time x-ucdp-access-token header. Candidate rows are preliminary and retain per-event review status, actors, precision codes, date ranges, source references, and low/best/high fatalities.
            {ucdpMeta.status === "unconfigured" ? " Token not configured; no new official ingest occurred." : ""}
            {ucdpMeta.status === "degraded" ? " Current ingest degraded; prior authenticated records are retained when available." : ""}
          </p>
        </div>
      ) : null}

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

      <div className="border-t border-white/8 px-4 py-3">
        <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-white/30">
          Attribution and licensing: WarHeatMap is CC BY 4.0; UCDP/Map of Wars, GDELT, NASA, USGS, ADSB.lol, gpsjam.org, Launch Library, CISA, and other public feeds retain their own terms. Reports are unverified operational leads, not confirmed facts.
        </p>
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
