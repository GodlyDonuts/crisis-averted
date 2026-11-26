"use client";

import { Copy, Network, X } from "lucide-react";
import type { ConflictEvent, DomainConvergenceAnalysis, IncidentConvergenceCard } from "@/types/conflict";
import { buildConvergenceAnalystSummary, DOMAIN_DISPLAY } from "@/lib/domainConvergence";
import { CONVERGENCE_CLASSIFICATION_META } from "./ConvergenceSection";

interface ConvergenceInspectorProps {
  analysis: DomainConvergenceAnalysis;
  /** True while evidence chunks are still loading; zero cards must not be read as absence. */
  evidencePending?: boolean;
  /** Cards already scoped to the current filter/playback lens, strongest first. */
  cards: IncidentConvergenceCard[];
  /** Total cards in the full filter scope before the playback lens was applied. */
  scopeCardCount: number;
  playbackActive: boolean;
  eventsById: Map<string, ConflictEvent>;
  onSelectEvent: (event: ConflictEvent) => void;
  onClose: () => void;
}

/**
 * Focused convergence inspector: ranks incident convergence cards across the current
 * scope, exposes classification mix, evidence gaps, and per-card copyable analyst
 * summaries. Selecting a card opens the incident drill-down with full factor rationale.
 */
export function ConvergenceInspector({ analysis, evidencePending = false, cards, scopeCardCount, playbackActive, eventsById, onSelectEvent, onClose }: ConvergenceInspectorProps) {
  const stats = analysis.stats;
  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-[172px] right-4 top-20 z-30 hidden w-[372px] flex-col overflow-hidden xl:flex">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-100/42">Convergence inspector</p>
          <h2 className="mt-1 text-sm font-semibold text-white/92">Multi-domain co-occurrence</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-sky-300/20 bg-sky-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-sky-100/78">
            <Network className="h-3 w-3" />
            {evidencePending ? "…" : cards.length}{!evidencePending && playbackActive && scopeCardCount !== cards.length ? `/${scopeCardCount}` : ""} cards
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-white/45 transition hover:border-white/20 hover:text-white"
            aria-label="Close convergence inspector"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-white/8 px-4 py-2.5">
        <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/30">
          {evidencePending
            ? "evidence chunks in flight — classification counts withheld"
            : `corroboration ${stats.corroborationCount} · correlation ${stats.correlationCount} · coincidence ${stats.coincidenceCount}`}
          {playbackActive ? " · playback lens active" : ""}
        </p>
        <p className="mt-1 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/24">
          co-occurrence geometry only — never causality or attribution{!evidencePending && analysis.gaps.length > 0 ? ` · ${analysis.gaps.length} domain${analysis.gaps.length === 1 ? "" : "s"} unevaluable (evidence gaps)` : ""}
        </p>
      </div>

      <div className="godseye-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {cards.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/28">
              {evidencePending ? "Evidence chunks still loading" : `No convergence cards in current scope${playbackActive ? " or playback frame" : ""}`}
            </p>
            <p className="mx-auto mt-3 max-w-[280px] font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-white/22">
              {evidencePending
                ? "Transport, maritime, orbital, environmental, connectivity, and media evidence is still arriving. Zero cards are not a coverage claim until every evidence chunk is terminal."
                : "Evidence domains cover the recent snapshot era; older incidents honestly produce no convergence. Absence of convergence is not evidence of absence."}
            </p>
          </div>
        ) : cards.map((card) => {
          const event = eventsById.get(card.eventId) ?? null;
          const meta = CONVERGENCE_CLASSIFICATION_META[card.classification];
          return (
            <div key={card.eventId} className="group relative border-b border-white/8">
              <button
                type="button"
                onClick={() => { if (event) onSelectEvent(event); }}
                className="w-full px-3 py-3 text-left transition-colors duration-150 hover:bg-white/[0.032]"
              >
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
                  <span style={{ color: meta.color }}>{meta.label}</span>
                  <span className="shrink-0 text-white/30">index {card.convergenceIndex}</span>
                </div>
                <h3 className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-white/86">
                  {event?.title ?? card.eventId}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {card.domains.map((alignment) => (
                    <span
                      key={alignment.domain}
                      className={`rounded-sm border px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] ${alignment.qualifies ? alignment.independent ? "border-emerald-200/25 bg-emerald-300/[0.07] text-emerald-100/72" : "border-sky-200/20 bg-sky-300/[0.05] text-sky-100/60" : "border-white/10 bg-white/[0.03] text-white/34"}`}
                      title={`${DOMAIN_DISPLAY[alignment.domain].label}: ${alignment.qualifies ? alignment.independent ? "qualifies as independent evidence" : "aligns as derivative context" : "overlap only, coincidence-class"} · best score ${alignment.bestScore.toFixed(2)} · ${alignment.findingCount} observation(s)`}
                    >
                      {DOMAIN_DISPLAY[alignment.domain].shortLabel}{alignment.qualifies ? "*" : ""}
                    </span>
                  ))}
                  <span className="ml-auto font-mono text-[9px] text-white/26">
                    {card.independentFamilyCount} ind. {card.independentFamilyCount === 1 ? "family" : "families"}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 font-mono text-[9px] leading-relaxed text-white/34">
                  {card.classificationReason}
                </p>
              </button>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(buildConvergenceAnalystSummary(card, event)); }}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-sm border border-white/10 bg-black/30 text-white/38 opacity-0 transition hover:border-white/24 hover:text-white group-hover:opacity-100"
                aria-label="Copy convergence analyst summary"
                title="Copy convergence analyst summary"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/8 px-4 py-2.5">
        <p className="font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.1em] text-white/24">
          deterministic {analysis.algorithmVersion} · * qualifies as evidence · transport positions are snapshot instants and never rewound
        </p>
      </div>
    </aside>
  );
}
