"use client";

import { Activity, AlertTriangle, Database, X } from "lucide-react";
import type { NvdConfiguration, NvdCvssMetric, OsintSnapshot } from "@/types/conflict";
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

const CVSS_VERSION_RANK: Record<NvdCvssMetric["metricSet"], number> = {
  cvssMetricV40: 4,
  cvssMetricV31: 3,
  cvssMetricV30: 2,
  cvssMetricV2: 1,
};

const CVSS_VERSION_LABEL: Record<NvdCvssMetric["metricSet"], string> = {
  cvssMetricV40: "4.0",
  cvssMetricV31: "3.1",
  cvssMetricV30: "3.0",
  cvssMetricV2: "2.0",
};

function selectDisplayCvssMetric(metrics: NvdCvssMetric[] | undefined): NvdCvssMetric | null {
  if (!metrics?.length) return null;
  return metrics.slice().sort((a, b) => {
    const primaryDelta = Number(b.type === "Primary") - Number(a.type === "Primary");
    if (primaryDelta !== 0) return primaryDelta;
    const versionDelta = CVSS_VERSION_RANK[b.metricSet] - CVSS_VERSION_RANK[a.metricSet];
    if (versionDelta !== 0) return versionDelta;
    return (b.baseScore ?? -1) - (a.baseScore ?? -1);
  })[0] ?? null;
}

function collectCpeCriteria(configurations: NvdConfiguration[] | undefined, cap = 3): string[] {
  const criteria: string[] = [];
  const visit = (node: NvdConfiguration["nodes"][number]) => {
    for (const match of node.cpeMatch) {
      if (criteria.length < cap) criteria.push(match.criteria);
    }
    node.nodes.forEach(visit);
  };
  for (const configuration of configurations ?? []) {
    configuration.nodes.forEach(visit);
  }
  return criteria;
}

function countCpeMatches(configurations: NvdConfiguration[] | undefined): number {
  const countNode = (node: NvdConfiguration["nodes"][number]): number => node.cpeMatch.length + node.nodes.reduce((sum, child) => sum + countNode(child), 0);
  return (configurations ?? []).reduce((sum, configuration) => sum + configuration.nodes.reduce((nodeSum, node) => nodeSum + countNode(node), 0), 0);
}

function urlHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return "reference"; }
}

function apiAge(value: string | null): string {
  return value ? formatRelativeTime(Date.parse(value)) : "no live retrieval";
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
  const gdeltGeoMeta = snapshot.gdeltGeoMeta;
  const gdeltGeoValue = gdeltGeoMeta
    ? gdeltGeoMeta.status === "ok"
      ? `${gdeltGeoMeta.ingestedMentionCount} mapped/${gdeltGeoMeta.conflictThemeRowCount} conflict rows · ok`
      : gdeltGeoMeta.status === "preserved"
        ? `${snapshot.gdeltGeoNews.length} preserved · ${gdeltGeoMeta.status}`
        : gdeltGeoMeta.status
    : `${snapshot.gdeltGeoNews.length} mapped · metadata unavailable`;
  const cyberMeta = snapshot.cyberVulnerabilityMeta;
  const cyberValue = cyberMeta
    ? `${snapshot.cyberVulnerabilities.length} KEV · NVD ${cyberMeta.nvd.enrichedCveCount}/${cyberMeta.nvd.requestedCveCount} · ${cyberMeta.status}`
    : `${snapshot.cyberVulnerabilities.length} · metadata unavailable`;
  const epssValue = cyberMeta
    ? `${cyberMeta.epss.enrichedCveCount}/${cyberMeta.epss.requestedCveCount} scored · ${cyberMeta.epss.status}`
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
        <Row label="GDELT geo news" value={gdeltGeoValue} warn={gdeltGeoMeta?.status !== "ok"} />
        <Row label="GDELT geo omissions" value={gdeltGeoMeta ? `${gdeltGeoMeta.omittedMentionCount} accounted · ${gdeltGeoMeta.uniqueArticleCount} articles/${gdeltGeoMeta.uniqueLocationCount} locations` : "not loaded"} />
        <Row label="UCDP official events" value={ucdpValue} warn={ucdpMeta?.status !== "ok"} />
        <Row label="UCDP release" value={ucdpMeta ? `${ucdpMeta.version} · ${ucdpMeta.datasetRelease}` : "not loaded"} />
        <Row label="Known exploited CVEs" value={cyberValue} warn={cyberMeta?.status !== "ok"} />
        <Row label="EPSS scoring" value={epssValue} warn={cyberMeta?.epss.status !== "ok"} />
        <Row label="Webcam metadata" value={snapshot.webcams.length > 0 ? String(snapshot.webcams.length) : "key not configured"} warn={snapshot.webcams.length === 0} />
      </div>

      <div className="border-t border-white/8 px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
          <Activity className="h-3.5 w-3.5" /> Cyber exploitation watch
        </div>
        <div className="mt-2 space-y-2">
          {snapshot.cyberVulnerabilities.slice(0, 3).map((item) => {
            const metric = selectDisplayCvssMetric(item.nvd?.metrics);
            const description = item.nvd?.descriptions.find((entry) => entry.lang === "en") ?? item.nvd?.descriptions[0] ?? null;
            const cweIds = [...new Set((item.nvd?.weaknesses ?? []).map((weakness) => weakness.id))].slice(0, 4);
            const cpeSamples = collectCpeCriteria(item.nvd?.configurations, 2);
            const cpeCount = countCpeMatches(item.nvd?.configurations);
            const omittedEvidence = item.nvd ? [
              item.nvd.truncation.referencesOmitted > 0 ? `+${item.nvd.truncation.referencesOmitted} refs` : null,
              item.nvd.truncation.cpeMatchesOmitted > 0 ? `+${item.nvd.truncation.cpeMatchesOmitted} CPEs` : null,
              item.nvd.truncation.configurationsOmitted > 0 ? `+${item.nvd.truncation.configurationsOmitted} configs` : null,
            ].filter(Boolean).join(" · ") : "";
            return (
              <div key={item.cveId} className="rounded-sm border border-white/7 bg-white/[0.018] px-2 py-1.5 text-[11px] leading-snug text-white/58">
                <div>
                  <span className="font-mono text-amber-100/70">{item.cveId}</span> · {item.vendor || "vendor not supplied"} {item.product || ""} · KEV {item.dateAdded || "date unavailable"}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {metric ? (
                    <span className="rounded-sm border border-red-200/15 bg-red-300/[0.055] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-red-100/70">
                      CVSS {CVSS_VERSION_LABEL[metric.metricSet]} {metric.baseScore?.toFixed(1) ?? "score n/a"}{metric.baseSeverity ? ` ${metric.baseSeverity}` : ""}
                    </span>
                  ) : <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/28">NVD metrics not supplied</span>}
                  {item.epss ? (
                    <span className="rounded-sm border border-cyan-200/15 bg-cyan-300/[0.045] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-cyan-100/68">
                      EPSS {(item.epss.score * 100).toFixed(1)}% · p{Math.round(item.epss.percentile * 100)}
                    </span>
                  ) : <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/28">EPSS not supplied</span>}
                  {cweIds.map((cwe) => <span key={cwe} className="rounded-sm border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-white/44">{cwe}</span>)}
                </div>
                {item.nvd ? (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.13em] text-white/38 hover:text-white/62">
                      NVD evidence · retrieved {apiAge(item.nvd.retrievedAt)}
                    </summary>
                    <div className="mt-1.5 space-y-1.5 border-l border-white/8 pl-2">
                      {description ? <p className="leading-relaxed text-white/52">{description.value}</p> : <p className="text-white/34">NVD supplied no English or alternate-language description in the retained evidence.</p>}
                      {metric?.vectorString ? <p className="break-all font-mono text-[9px] leading-relaxed text-white/36">{metric.vectorString}</p> : null}
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
                        Published {item.nvd.published ? apiAge(item.nvd.published) : "not supplied"} · modified {item.nvd.lastModified ? apiAge(item.nvd.lastModified) : "not supplied"} · {cpeCount} bounded CPE matches
                      </p>
                      {item.nvd.references.length > 0 ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {item.nvd.references.slice(0, 2).map((reference) => (
                            <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer" className="font-mono text-[9px] uppercase tracking-[0.1em] text-cyan-100/46 underline decoration-cyan-100/20 underline-offset-2 hover:text-cyan-100/75">
                              {urlHostname(reference.url)}
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {cpeSamples.map((cpe, index) => <p key={`${cpe}-${index}`} className="break-all font-mono text-[9px] text-white/28">{cpe}</p>)}
                      {omittedEvidence ? <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-amber-100/40">Bounded omissions: {omittedEvidence}</p> : null}
                    </div>
                  </details>
                ) : <p className="mt-1 text-[10px] text-white/34">No authoritative NVD evidence retained for this CVE; absence is explicit, not zero risk.</p>}
              </div>
            );
          })}
          {snapshot.cyberVulnerabilities.length === 0 && <p className="text-[11px] text-white/34">CISA KEV collection unavailable.</p>}
          {cyberMeta ? (
            <details className="rounded-sm border border-white/8 bg-white/[0.025] px-2 py-1.5">
              <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.14em] text-white/38 hover:text-white/62">Cyber provenance, cache, omissions</summary>
              <div className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-white/48">
                <p>
                  KEV catalog {cyberMeta.kev.catalogVersion || "version not supplied"} retrieved {apiAge(cyberMeta.kev.retrievedAt)}; {cyberMeta.kev.selectedRecordCount}/{cyberMeta.kev.validRecordCount} valid records selected with {cyberMeta.kev.omittedRecordCount} bounded omissions ({cyberMeta.kev.omittedByReason.selectionCap} selection cap, {cyberMeta.kev.omittedByReason.invalidRecord} invalid, {cyberMeta.kev.omittedByReason.duplicateCveId} duplicates).
                </p>
                <p>
                  NVD CVE 2.0 uses cveIds batches at serial concurrency 1 with a {Math.round(cyberMeta.nvd.configuredMinRequestIntervalMs / 100) / 10}s minimum inter-request gap; API key configured: {cyberMeta.nvd.apiKeyConfigured ? "yes (secret never serialized)" : "no"}. Requests {cyberMeta.nvd.successfulRequestCount}/{cyberMeta.nvd.requestAttemptCount} successful, {cyberMeta.nvd.retryCount} retries, {cyberMeta.nvd.throttledResponseCount} throttled responses. Cache: {cyberMeta.nvd.freshCacheHitCount} fresh hits, {cyberMeta.nvd.negativeCacheHitCount} negative hits, {cyberMeta.nvd.staleCacheHitCount} stale fallbacks, {cyberMeta.nvd.priorSnapshotHitCount} prior-snapshot fallbacks; live retrieval {apiAge(cyberMeta.nvd.retrievedAt)}. NVD omissions: {cyberMeta.nvd.omittedByReason.missingNvdRecord} missing, {cyberMeta.nvd.omittedByReason.invalidNvdRecord} invalid, {cyberMeta.nvd.omittedByReason.requestFailed} request failures, {cyberMeta.nvd.omittedByReason.notAttempted} not attempted.
                </p>
                <p>
                  EPSS is FIRST&apos;s probability estimate, not exploitation evidence: {cyberMeta.epss.enrichedCveCount}/{cyberMeta.epss.requestedCveCount} scored, {cyberMeta.epss.omittedCveCount} omissions ({cyberMeta.epss.omittedByReason.missingEpssRecord} missing, {cyberMeta.epss.omittedByReason.invalidEpssRecord} invalid, {cyberMeta.epss.omittedByReason.requestFailed} request failures, {cyberMeta.epss.omittedByReason.notAttempted} not attempted). Cache file status {cyberMeta.cache.status}; original retrieval timestamps are preserved whenever cached or prior evidence is used.
                </p>
              </div>
            </details>
          ) : null}
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

      {gdeltGeoMeta ? (
        <div className="border-t border-white/8 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/34">
            <Activity className="h-3.5 w-3.5" /> GDELT geolocated conflict news
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/54">
            {gdeltGeoMeta.slotsIngested.length} fifteen-minute GKG slots ingested ({gdeltGeoMeta.rowsScanned.toLocaleString()} rows scanned), {gdeltGeoMeta.ingestedMentionCount} mentions mapped across {gdeltGeoMeta.uniqueLocationCount} locations and {gdeltGeoMeta.uniqueArticleCount} articles. Omissions accounted: {gdeltGeoMeta.omittedByReason.notProximalToConflictTheme} beyond the {gdeltGeoMeta.proximityChars}-character theme-proximity window, {gdeltGeoMeta.omittedByReason.duplicateMention} duplicates, {gdeltGeoMeta.omittedByReason.invalidCoordinates} invalid coordinates, {gdeltGeoMeta.omittedByReason.selectionCap} over the selection cap; {gdeltGeoMeta.countryLevelMentionCount} country-level mentions out of scope by design. Points are places mentioned in news text near automated conflict-theme tags — media attention, never verified incidents. Headlines attached for {gdeltGeoMeta.titleEnrichedArticleCount} articles{gdeltGeoMeta.titleEnrichment.status === "ok" ? " via DOC API cross-reference" : "; DOC API title enrichment unavailable"}.
            {gdeltGeoMeta.status === "preserved" ? " Current ingest degraded; prior build-time snapshot retained." : ""}
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
          Attribution and licensing: WarHeatMap is CC BY 4.0; UCDP/Map of Wars, NASA, USGS, ADSB.lol, gpsjam.org, Launch Library, CISA, NIST NVD, FIRST EPSS, and other public feeds retain their own terms. Geolocated news mentions are courtesy of{" "}
          <a href="https://www.gdeltproject.org/" target="_blank" rel="noreferrer" className="text-white/46 underline decoration-white/20 underline-offset-2 hover:text-white/70">The GDELT Project</a>{" "}
          (citation required by GDELT terms of use). Reports are unverified operational leads, not confirmed facts.
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
