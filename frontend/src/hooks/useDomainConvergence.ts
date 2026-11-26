"use client";

import { useMemo } from "react";
import type { ConflictEvent, DomainConvergenceAnalysis, IncidentConvergenceCard, OsintSnapshot } from "@/types/conflict";
import { analyzeDomainConvergence } from "@/lib/domainConvergence";

export interface DomainConvergenceResult {
  analysis: DomainConvergenceAnalysis;
  cardsByEventId: Map<string, IncidentConvergenceCard>;
}

/**
 * Memoized multi-domain convergence analysis over the current filter scope. The engine is
 * deterministic and pure — recomputation happens only when the scoped incidents or the
 * evidence snapshot actually change. Playback needs no rewinding here: transport positions
 * carry honest observation instants and the temporal gates correctly exclude them for
 * historical incidents, so playback correctness is emergent rather than interpolated.
 */
export function useDomainConvergence(events: ConflictEvent[], snapshot: OsintSnapshot): DomainConvergenceResult {
  const analysis = useMemo(
    () => analyzeDomainConvergence(events, snapshot),
    [events, snapshot],
  );
  const cardsByEventId = useMemo(() => {
    const map = new Map<string, IncidentConvergenceCard>();
    for (const card of analysis.cards) map.set(card.eventId, card);
    return map;
  }, [analysis]);
  return useMemo(() => ({ analysis, cardsByEventId }), [analysis, cardsByEventId]);
}
