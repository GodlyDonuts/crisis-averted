"use client";

import { ExternalLink, HandHeart, X } from "lucide-react";
import type { ReliefWebIngestionMeta, ReliefWebRecord } from "@/types/conflict";

function formatUtc(value: string | null | undefined): string {
  if (!value) return "not supplied";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "not supplied";
  return `${new Date(parsed).toISOString().slice(0, 19).replace("T", " ")}Z`;
}

function kindLabel(kind: ReliefWebRecord["recordKind"]): string {
  if (kind === "disaster") return "ReliefWeb disaster index entry";
  if (kind === "situation-report") return "Situation report";
  if (kind === "appeal") return "Appeal / response plan";
  if (kind === "map-infographic") return "Map / infographic";
  return "Humanitarian report/analysis";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="border-b border-white/7 px-3 py-2 last:border-b-0"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/32">{label}</div><div className="mt-1 text-[12px] leading-relaxed text-white/72">{children}</div></div>;
}

export function ReliefWebDetailPanel({ record, meta, onClose }: { record: ReliefWebRecord; meta: ReliefWebIngestionMeta | null; onClose: () => void }) {
  const organizations = record.organizations.map((organization) => organization.shortname ?? organization.name).filter(Boolean).join(" · ") || "original source linked from ReliefWeb";
  const disasterTypes = [record.primaryType?.name, ...record.disasterTypes.map((type) => type.name)].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index).join(" · ") || "not supplied";
  const themes = record.themes.map((theme) => theme.name).filter(Boolean).join(" · ") || "not supplied";
  const countries = record.countries.map((country) => `${country.name ?? country.iso3}${country.primary ? " (primary)" : ""}`).join(" · ") || record.primaryCountry?.name || "not supplied";
  const retrieval = meta?.status === "preserved"
    ? `preserved prior build · original retrieval ${formatUtc(meta.retrievedAt)} · marked preserved ${formatUtc(meta.preservedAt)}`
    : `build-time retrieval ${formatUtc(meta?.retrievedAt)} · ${meta?.status ?? "metadata unavailable"}`;
  return (
    <aside className="godseye-panel godseye-scrollbar pointer-events-auto absolute bottom-5 right-4 z-50 max-h-[calc(100vh-7rem)] w-[390px] overflow-y-auto">
      <div className="flex items-start justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2">
          <HandHeart className="h-4 w-4 text-teal-100/70" />
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-teal-100/48">Humanitarian intelligence · not an incident</p>
            <h2 className="mt-0.5 text-sm font-semibold text-white/90">{kindLabel(record.recordKind)}</h2>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-sm border border-white/10 text-white/42 hover:text-white" aria-label="Close ReliefWeb detail"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="px-4 py-3">
        <h3 className="text-[15px] font-semibold leading-snug text-white/90">{record.title}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em]">
          {record.status ? <span className="rounded-sm border border-amber-200/18 bg-amber-300/[0.05] px-1.5 py-0.5 text-amber-100/70">{record.status}</span> : null}
          <span className="rounded-sm border border-teal-200/16 bg-teal-300/[0.045] px-1.5 py-0.5 text-teal-100/66">{record.apiResource}</span>
          {record.format?.name ? <span className="rounded-sm border border-white/10 bg-white/[0.035] px-1.5 py-0.5 text-white/50">{record.format.name}</span> : null}
        </div>
        <p className="mt-3 rounded-sm border border-cyan-200/13 bg-cyan-300/[0.035] px-2.5 py-2 text-[11px] leading-relaxed text-cyan-50/62">
          Metadata/index evidence only. This is not a verified incident, casualty report, displacement estimate, or impact footprint. Situational reports, appeals, disaster index entries, and conflict incidents remain distinct categories.
        </p>
      </div>
      <div className="border-t border-white/8 py-1">
        <Row label="Publishing organizations">{organizations}</Row>
        <Row label="Countries">{countries}</Row>
        <Row label="Disaster/type metadata">{record.linkedDisasters.map((disaster) => `${disaster.name}${disaster.glide ? ` · GLIDE ${disaster.glide}` : ""}`).join(" · ") || "not linked"}{record.glide ? ` · GLIDE ${record.glide}` : ""}{disasterTypes !== "not supplied" ? ` · ${disasterTypes}` : ""}</Row>
        <Row label="Alert/severity contract">{record.alertMetadata ? `${record.alertMetadata.status} — ${record.alertMetadata.basis}` : "No disaster alert status or humanitarian severity scale supplied; none inferred."}</Row>
        <Row label="Publisher timestamps">created {formatUtc(record.dates.created)} · changed {formatUtc(record.dates.changed)} · original {formatUtc(record.dates.original)}</Row>
        <Row label="Themes/languages">{themes} · {record.languages.map((language) => language.name ?? language.code).filter(Boolean).join(" · ") || "language not supplied"}</Row>
        <Row label="Location precision">{record.location ? `${record.location.lat.toFixed(3)}, ${record.location.lng.toFixed(3)} · ReliefWeb country centroid for ${record.location.countryName}` : "No authoritative ReliefWeb centroid available; no coordinate fabricated."}<span className="block text-white/42">{record.coordinateNote}</span></Row>
        <Row label="Ingestion/provenance">{retrieval}<span className="block text-white/42">ReliefWeb API v2, approved build-time appname redacted; serial bounded queries · {meta ? `${meta.ingestedRecordCount} records, ${meta.omittedRecordCount} omitted, ${meta.coordinateAttachedCount} centroid-placed` : "counts unavailable"}</span></Row>
        <Row label="Licensing/redistribution">{record.rights.redistributionNote}</Row>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/8 px-4 py-3">
        <a href={record.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-sm border border-teal-200/20 bg-teal-300/[0.055] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-teal-100/78 hover:bg-teal-300/[0.09]">ReliefWeb record <ExternalLink className="h-3 w-3" /></a>
        {record.originUrl ? <a href={record.originUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-sm border border-white/12 bg-white/[0.035] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/58 hover:text-white/82">Original source <ExternalLink className="h-3 w-3" /></a> : null}
        <a href="https://reliefweb.int/terms-conditions" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-sm border border-white/12 bg-white/[0.025] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/46 hover:text-white/72">Terms <ExternalLink className="h-3 w-3" /></a>
      </div>
    </aside>
  );
}
