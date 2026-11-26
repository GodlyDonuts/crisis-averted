"use client";

import { useState } from "react";
import { Copy, Network } from "lucide-react";
import type { ConflictEvent, ConvergenceClassification, IncidentConvergenceCard } from "@/types/conflict";
import { buildConvergenceAnalystSummary, DOMAIN_DISPLAY } from "@/lib/domainConvergence";

export const CONVERGENCE_CLASSIFICATION_META: Record<ConvergenceClassification, { label: string; color: string; softColor: string }> = {
  corroboration: { label: "Corroboration", color: "#30d158", softColor: "rgba(48,209,88,0.09)" },
  correlation: { label: "Correlation", color: "#64d2ff", softColor: "rgba(100,210,255,0.08)" },
  coincidence: { label: "Coincidence", color: "rgba(255,255,255,0.5)", softColor: "rgba(255,255,255,0.045)" },
};

interface ConvergenceSectionProps {
  card: IncidentConvergenceCard | null;
  event: ConflictEvent;
}

/**
 * Drill-down convergence section inside the incident detail panel. Renders per-domain
 * alignments with full factor rationale, distances, times, provenance, evidence gaps,
 * uncertainty, and the copyable analyst summary. When the incident has no card, the
 * honest empty state explains what that means — and what it does not mean.
 */
export function ConvergenceSection({ card, event }: ConvergenceSectionProps) {
  const [copied, setCopied] = useState(false);

  const copySummary = () => {
    if (!card) return;
    void navigator.clipboard?.writeText(buildConvergenceAnalystSummary(card, event)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  if (!card) {
    return (
      <div className="mt-4 rounded-sm border border-white/8 bg-white/[0.018] p-3.5">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/38">
          <Network className="h-3.5 w-3.5" /> Multi-domain convergence
        </p>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/46">
          No spatial-temporal overlap with any loaded evidence domain inside the deterministic gates — GNSS interference, aviation, AIS vessels, launches, environmental events, connectivity outages, or media attention.
        </p>
        <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/26">
          Absence of convergence is not evidence of absence: evidence domains cover only the recent snapshot era, and coverage gaps are documented in the convergence inspector.
        </p>
      </div>
    );
  }

  const meta = CONVERGENCE_CLASSIFICATION_META[card.classification];

  return (
    <div className="mt-4 rounded-sm border border-white/8 bg-white/[0.022] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/38">
          <Network className="h-3.5 w-3.5" /> Multi-domain convergence
        </p>
        <div className="flex items-center gap-1.5">
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
            style={{ borderColor: `${meta.color}55`, backgroundColor: meta.softColor, color: meta.color }}
          >
            {meta.label}
          </span>
          <button
            type="button"
            onClick={copySummary}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-white/10 text-white/42 transition hover:border-white/22 hover:text-white"
            aria-label="Copy convergence analyst summary"
            title="Copy convergence analyst summary"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
        <span>index {card.convergenceIndex}/100 · ranking device, not a probability</span>
        <span>{card.independentFamilyCount} independent {card.independentFamilyCount === 1 ? "family" : "families"}</span>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-white/52">{card.classificationReason}</p>
      {copied ? <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-200/60">analyst summary copied</p> : null}

      <div className="mt-3 space-y-2">
        {card.domains.map((alignment) => {
          const display = DOMAIN_DISPLAY[alignment.domain];
          return (
            <details key={alignment.domain} className="rounded-sm border border-white/8 bg-black/18 px-2.5 py-2" open={alignment.qualifies}>
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${alignment.qualifies ? alignment.independent ? "border-emerald-200/25 bg-emerald-300/[0.07] text-emerald-100/78" : "border-sky-200/20 bg-sky-300/[0.06] text-sky-100/66" : "border-white/12 bg-white/[0.04] text-white/46"}`}>
                    {display.shortLabel}
                  </span>
                  <span className="font-mono text-[9px] text-white/32">
                    {alignment.qualifies ? (alignment.independent ? "qualifies as independent evidence" : "aligns — derivative context") : "overlap only · coincidence-class"}
                  </span>
                  <span className="font-mono text-[9px] text-white/32">best {alignment.bestScore.toFixed(2)} · {alignment.findingCount} obs</span>
                </div>
                <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/30">{display.label} · measurement family: {alignment.family}</p>
              </summary>
              <div className="mt-2 space-y-2 border-l border-white/10 pl-2.5">
                {alignment.findings.map((finding) => (
                  <div key={finding.observationId} className="rounded-sm border border-white/6 bg-white/[0.015] p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] text-white/72">{finding.label}</p>
                      <span className="shrink-0 font-mono text-[9px] text-white/34">score {finding.score.toFixed(2)}</span>
                    </div>
                    {finding.detail ? <p className="mt-0.5 truncate font-mono text-[9px] text-white/34">{finding.detail}</p> : null}
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-white/38">
                      {finding.effectiveDistanceKm} km effective · {finding.distanceKm} km raw · {finding.timeGapHours} h time gap
                    </p>
                    <div className="mt-1.5 space-y-1">
                      {finding.rationale.map((line) => (
                        <p key={line} className="font-mono text-[9px] leading-relaxed text-white/40">{line}</p>
                      ))}
                    </div>
                    <p className="mt-1.5 font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.08em] text-white/28">
                      {finding.provenance.source}{finding.provenance.observedAt ? ` · observed ${finding.provenance.observedAt}` : ""}
                    </p>
                    {finding.provenance.note ? (
                      <p className="mt-0.5 font-mono text-[8.5px] leading-relaxed text-white/28">{finding.provenance.note}</p>
                    ) : null}
                    {finding.url ? (
                      <a href={finding.url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[9px] uppercase tracking-[0.1em] text-sky-100/50 underline decoration-sky-100/20 underline-offset-2 hover:text-sky-100/80">
                        source record
                      </a>
                    ) : null}
                  </div>
                ))}
                {alignment.coverageNote ? (
                  <p className="font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.08em] text-white/26">coverage: {alignment.coverageNote}</p>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>

      {card.evidenceGaps.length > 0 ? (
        <div className="mt-3 rounded-sm border border-amber-200/12 bg-amber-300/[0.04] px-2.5 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-amber-100/46">Evidence gaps — domains that could not be evaluated</p>
          <div className="mt-1.5 space-y-1">
            {card.evidenceGaps.map((gap) => (
              <p key={gap.domain} className="font-mono text-[9px] leading-relaxed text-amber-100/38">
                {DOMAIN_DISPLAY[gap.domain].label}: {gap.reason}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-1">
        {card.uncertaintyNotes.map((note) => (
          <p key={note} className="font-mono text-[8.5px] leading-relaxed text-white/30">· {note}</p>
        ))}
      </div>

      <p className="mt-2.5 font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.1em] text-white/24">
        {card.disclaimer} Deterministic convergence {card.algorithmVersion}.
      </p>
    </div>
  );
}
