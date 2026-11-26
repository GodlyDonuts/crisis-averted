"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { CategoryGroup, ConflictEvent, ConflictFilters, ConflictTheater, EscalationSignal, MilitaryAircraft, OsintAircraft, OsintVessel, SeverityKey } from "@/types/conflict";
import {
  aggregateTheaters,
  buildTimeline,
  DEFAULT_CONFLICT_FILTERS,
  filterConflictEvents,
  summarizeEvents,
  normalizeMapOfWarsEvent,
} from "@/lib/conflictData";
import { useConflictEvents } from "@/hooks/useConflictEvents";
import { useIncidentPlayback } from "@/hooks/useIncidentPlayback";
import { useOsintSnapshot } from "@/hooks/useOsintSnapshot";
import { useDomainConvergence } from "@/hooks/useDomainConvergence";
import { useWatchRules } from "@/hooks/useWatchRules";
import { analyzeEscalationSurge } from "@/lib/escalationSurge";
import { evaluateWatchRules } from "@/lib/watchRules";
import { measureIncidentTemporalCoverage } from "@/lib/incidentTime";
import TopCommandBar from "./TopCommandBar";
import TheaterList from "./TheaterList";
import EventFeed from "./EventFeed";
import EventDetailPanel from "./EventDetailPanel";
import ControlDeck from "./ControlDeck";
import { MobileIntelSheet } from "./MobileIntelSheet";
import { MapLegend } from "./MapLegend";
import { TargetLockOverlay } from "./TargetLockOverlay";
import { AircraftDetailPanel } from "./AircraftDetailPanel";
import { TransportDetailPanel } from "./TransportDetailPanel";
import { SourceStatusPanel } from "./SourceStatusPanel";
import { GlobeFallback } from "./GlobeFallback";
import { ConvergenceInspector } from "./ConvergenceInspector";
import { WatchCenter } from "./WatchCenter";
import BootSequence from "./BootSequence";
import type { GodEyeFocusTarget, GodEyeLayerToggles, GodEyeVisualMode } from "./GodEyeGlobe";

const GodEyeGlobe = dynamic(() => import("./GodEyeGlobe"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#01040a]" />,
});

function createDefaultFilters(): ConflictFilters {
  return {
    ...DEFAULT_CONFLICT_FILTERS,
    categoryGroups: [...DEFAULT_CONFLICT_FILTERS.categoryGroups],
    severities: [...DEFAULT_CONFLICT_FILTERS.severities],
  };
}

const DEFAULT_LAYERS: GodEyeLayerToggles = {
  density: true,
  beacons: true,
  signals: true,
  theaterLabels: true,
  borders: true,
  clouds: true,
  orbitalAssets: false,
  aircraft: true,
  civilAviation: true,
  maritime: true,
  environmental: false,
  gpsInterference: true,
  internetOutages: true,
  gdeltGeoNews: true,
};

export default function GodEyeCommandCenter() {
  const osintSnapshot = useOsintSnapshot();
  const snapshotConflictEvents = useMemo(
    () => osintSnapshot.mapOfWarsEvents.map(normalizeMapOfWarsEvent).filter((event): event is ConflictEvent => event !== null),
    [osintSnapshot.mapOfWarsEvents]
  );
  const { events, source, loading, refreshing, error, lastUpdated, correlation, paused, setPaused, refresh } = useConflictEvents(snapshotConflictEvents);
  const {
    ready: watchStorageReady,
    rules: watchRules,
    alertStates: watchAlertStates,
    status: watchStorageStatus,
    upsertRule: upsertWatchRule,
    toggleRule: toggleWatchRule,
    dismissAlert: dismissWatchAlert,
    snoozeAlert: snoozeWatchAlert,
    restoreAlert: restoreWatchAlert,
  } = useWatchRules();
  const [filters, setFilters] = useState<ConflictFilters>(() => createDefaultFilters());
  const [layers, setLayers] = useState<GodEyeLayerToggles>(DEFAULT_LAYERS);
  const [visualMode, setVisualMode] = useState<GodEyeVisualMode>("cinematic");
  const [autoRotate, setAutoRotate] = useState(() => typeof window === "undefined" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [tourActive, setTourActive] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<MilitaryAircraft | null>(null);
  const [selectedCivilAircraft, setSelectedCivilAircraft] = useState<OsintAircraft | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<OsintVessel | null>(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [globeUnavailable, setGlobeUnavailable] = useState(false);
  const [theaterPanelOpen, setTheaterPanelOpen] = useState(true);
  const [incidentPanelOpen, setIncidentPanelOpen] = useState(true);
  const [convergenceOpen, setConvergenceOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [selectedTheaterSlug, setSelectedTheaterSlug] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<GodEyeFocusTarget | null>(null);


  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setAutoRotate(false);
        setTourActive(false);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const applyInitialMode = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("mode") === "satellite") {
        setVisualMode("satellite");
      }
    }, 0);
    return () => window.clearTimeout(applyInitialMode);
  }, []);

  const scopeFilters = useMemo(() => ({ ...filters, theater: null }), [filters]);
  const scopeEvents = useMemo(() => filterConflictEvents(events, scopeFilters), [events, scopeFilters]);
  const theaters = useMemo(() => aggregateTheaters(scopeEvents), [scopeEvents]);
  const visibleEvents = useMemo(() => {
    if (!filters.theater) return scopeEvents;
    return scopeEvents.filter((event) => event.theater === filters.theater);
  }, [scopeEvents, filters.theater]);
  const summary = useMemo(() => summarizeEvents(visibleEvents), [visibleEvents]);
  const timeline = useMemo(() => buildTimeline(visibleEvents, 30), [visibleEvents]);
  const corpusCoverage = useMemo(() => measureIncidentTemporalCoverage(events), [events]);
  // Escalation analysis intentionally uses the full correlated corpus rather than the user's
  // time-window/category lens, so an interactive filter cannot erase its own baseline. The
  // analysis horizon is the data fetch time; one loaded corpus therefore has stable output.
  const surgeAnalysis = useMemo(
    () => analyzeEscalationSurge(events, lastUpdated ? { now: lastUpdated } : {}),
    [events, lastUpdated],
  );
  const watchEvaluation = useMemo(
    () => evaluateWatchRules(events, watchRules, surgeAnalysis, { now: surgeAnalysis.analysisEnd }),
    [events, watchRules, surgeAnalysis],
  );
  const surgeSignalCount = useMemo(
    () => surgeAnalysis.signals.filter((signal) => signal.isSignal).length,
    [surgeAnalysis.signals],
  );
  const surgeSignalsByTheater = useMemo(() => {
    const map = new Map<string, EscalationSignal>();
    for (const signal of surgeAnalysis.signals) {
      if (signal.groupKind === "theater") map.set(signal.groupKey, signal);
    }
    return map;
  }, [surgeAnalysis.signals]);
  const playback = useIncidentPlayback(visibleEvents);
  // Playback is a temporal lens on map/feed rendering only: theater aggregation,
  // filter state, export scope, tour behavior, and the command summary continue to
  // describe the full filtered scope rather than being destructively rewritten.
  const temporalEvents = playback.active ? playback.events : visibleEvents;
  const globePlaybackFrame = useMemo(() => {
    if (!playback.active || !playback.frame) return null;
    return { start: playback.frame.start, endExclusive: playback.frame.endExclusive, mode: playback.mode };
  }, [playback.active, playback.frame, playback.mode]);
  const pausePlayback = playback.pause;

  // Multi-domain convergence is computed over the full filter scope (not the playback
  // frame): the engine's temporal gates already align evidence honestly in time, so a
  // historical playback frame cannot manufacture anachronistic aviation/AIS alignments.
  // The inspector then applies the playback lens as a display filter over card membership.
  const convergence = useDomainConvergence(visibleEvents, osintSnapshot);
  const eventsById = useMemo(() => {
    const map = new Map<string, ConflictEvent>();
    for (const event of visibleEvents) map.set(event.id, event);
    return map;
  }, [visibleEvents]);
  const convergenceCards = useMemo(() => {
    if (!playback.active) return convergence.analysis.cards;
    const inFrame = new Set(temporalEvents.map((event) => event.id));
    return convergence.analysis.cards.filter((card) => inFrame.has(card.eventId));
  }, [playback.active, convergence.analysis.cards, temporalEvents]);
  const selectedConvergenceCard = useMemo(() => {
    if (!selectedEventId) return null;
    return convergence.cardsByEventId.get(selectedEventId) ?? null;
  }, [convergence.cardsByEventId, selectedEventId]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((event) => event.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const selectedTheater = useMemo(() => {
    if (!selectedTheaterSlug) return null;
    return theaters.find((theater) => theater.slug === selectedTheaterSlug) ?? null;
  }, [theaters, selectedTheaterSlug]);

  const handleGlobeRenderFailure = useCallback(() => setGlobeUnavailable(true), []);

  const handleEventSelect = useCallback((event: ConflictEvent) => {
    setAutoRotate(false);
    pausePlayback();
    setSelectedAircraft(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(null);
    setSelectedEventId(event.id);
    setFocusTarget({
      lat: event.lat,
      lng: event.lng,
      altitude: 0.82,
      key: `event-${event.id}-${Date.now()}`,
    });
  }, [pausePlayback]);

  const handleAircraftSelect = useCallback((aircraft: MilitaryAircraft) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(null);
    setSelectedAircraft(aircraft);
    setFocusTarget({
      lat: aircraft.lat,
      lng: aircraft.lng,
      altitude: 1.05,
      key: `aircraft-${aircraft.id}-${Date.now()}`,
    });
  }, []);

  const handleCivilAircraftSelect = useCallback((aircraft: OsintAircraft) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedAircraft(null);
    setSelectedVessel(null);
    setSelectedCivilAircraft(aircraft);
    setFocusTarget({ lat: aircraft.lat, lng: aircraft.lng, altitude: 1.0, key: `civil-${aircraft.id}-${Date.now()}` });
  }, []);

  const handleVesselSelect = useCallback((vessel: OsintVessel) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedAircraft(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(vessel);
    setFocusTarget({ lat: vessel.lat, lng: vessel.lng, altitude: 0.72, key: `vessel-${vessel.id}-${Date.now()}` });
  }, []);

  const handleTheaterSelect = useCallback((theater: ConflictTheater) => {
    setAutoRotate(false);
    const alreadySelected = filters.theater === theater.slug;
    setSelectedEventId(null);
    setSelectedAircraft(null);
    setSelectedTheaterSlug(alreadySelected ? null : theater.slug);
    setFilters((current) => ({
      ...current,
      theater: alreadySelected ? null : theater.slug,
    }));
    if (!alreadySelected) {
      setFocusTarget({
        lat: theater.lat,
        lng: theater.lng,
        altitude: 1.34,
        key: `theater-${theater.slug}-${Date.now()}`,
      });
    }
  }, [filters.theater]);

  const isolateTheater = useCallback((theater: ConflictTheater) => {
    setSelectedEventId(null);
    setSelectedTheaterSlug(theater.slug);
    setFilters((current) => ({ ...current, theater: theater.slug }));
    setFocusTarget({
      lat: theater.lat,
      lng: theater.lng,
      altitude: 1.34,
      key: `theater-${theater.slug}-${Date.now()}`,
    });
  }, []);

  const focusTheaterBySlug = useCallback((slug: string) => {
    const normalized = slug.trim().toLowerCase().replace(/\s+/g, " ");
    const theater = theaters.find((item) => item.slug === slug || item.slug.trim().toLowerCase().replace(/\s+/g, " ") === normalized);
    if (theater) isolateTheater(theater);
  }, [theaters, isolateTheater]);

  const clearTheater = useCallback(() => {
    setSelectedTheaterSlug(null);
    setFilters((current) => ({ ...current, theater: null }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (selectedEventId) {
        setSelectedEventId(null);
      } else if (watchOpen) {
        setWatchOpen(false);
      } else if (convergenceOpen) {
        setConvergenceOpen(false);
      } else if (filters.theater) {
        clearTheater();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearTheater, convergenceOpen, filters.theater, selectedEventId, watchOpen]);

  const handleTimeWindowChange = useCallback((timeWindow: ConflictFilters["timeWindow"]) => {
    setFilters((current) => ({ ...current, timeWindow }));
  }, []);

  const handleToggleCategoryGroup = useCallback((group: CategoryGroup) => {
    setFilters((current) => ({
      ...current,
      categoryGroups: current.categoryGroups.includes(group)
        ? current.categoryGroups.filter((item) => item !== group)
        : [...current.categoryGroups, group],
    }));
  }, []);

  const handleToggleSeverity = useCallback((severity: SeverityKey) => {
    setFilters((current) => ({
      ...current,
      severities: current.severities.includes(severity)
        ? current.severities.filter((item) => item !== severity)
        : [...current.severities, severity],
    }));
  }, []);

  const handleQueryChange = useCallback((query: string) => {
    setFilters((current) => ({ ...current, query }));
  }, []);

  const handleToggleLayer = useCallback((layer: keyof GodEyeLayerToggles) => {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }, []);

  const handleToggleWatch = useCallback(() => {
    if (!watchOpen) {
      setConvergenceOpen(false);
      setIncidentPanelOpen(true);
    }
    setWatchOpen((open) => !open);
  }, [watchOpen]);

  const handleToggleConvergence = useCallback(() => {
    if (!convergenceOpen) {
      setWatchOpen(false);
      setIncidentPanelOpen(true);
    }
    setConvergenceOpen((open) => !open);
  }, [convergenceOpen]);

  const theatersRef = useRef(theaters);
  useEffect(() => {
    theatersRef.current = theaters;
  }, [theaters]);

  useEffect(() => {
    if (!tourActive) return undefined;
    const tourTheaters = theatersRef.current.slice(0, 10);
    if (tourTheaters.length === 0) return undefined;
    let index = 0;
    const focusTheater = () => {
      const theater = tourTheaters[index % tourTheaters.length];
      index += 1;
      setSelectedEventId(null);
      setSelectedTheaterSlug(theater.slug);
      setFilters((current) => ({ ...current, theater: theater.slug }));
      setFocusTarget({
        lat: theater.lat,
        lng: theater.lng,
        altitude: 1.24,
        key: `tour-${theater.slug}-${Date.now()}`,
      });
    };
    const initial = window.setTimeout(focusTheater, 500);
    const interval = window.setInterval(focusTheater, 9000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [tourActive]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#01040a] text-white">
      {globeUnavailable ? (
        <GlobeFallback
          events={temporalEvents}
          theaters={theaters}
          militaryAircraft={osintSnapshot.militaryAircraft}
          naturalEvents={osintSnapshot.naturalEvents}
          selectedEvent={selectedEvent}
          onEventSelect={handleEventSelect}
        />
      ) : (
        <GodEyeGlobe
          key={visualMode}
          events={temporalEvents}
          theaters={theaters}
          militaryAircraft={osintSnapshot.militaryAircraft}
          aircraft={osintSnapshot.aircraft}
          vessels={osintSnapshot.vessels}
          satellites={osintSnapshot.satellites}
          launches={osintSnapshot.launches}
          naturalEvents={osintSnapshot.naturalEvents}
          gpsInterference={osintSnapshot.gpsInterference}
          internetOutages={osintSnapshot.internetOutages}
          gdeltGeoNews={osintSnapshot.gdeltGeoNews}
          selectedEvent={selectedEvent}
          selectedTheater={selectedTheater}
          focusTarget={focusTarget}
          layers={layers}
          visualMode={visualMode}
          autoRotate={autoRotate}
          playbackFrame={globePlaybackFrame}
          reducedMotion={playback.reducedMotion}
          onEventSelect={handleEventSelect}
          onAircraftSelect={handleAircraftSelect}
          onCivilAircraftSelect={handleCivilAircraftSelect}
          onVesselSelect={handleVesselSelect}
          onTheaterSelect={handleTheaterSelect}
          onRenderFailure={handleGlobeRenderFailure}
        />
      )}

      <div className="pointer-events-none absolute inset-0 z-20">
        <TopCommandBar
          summary={summary}
          source={source}
          loading={loading}
          refreshing={refreshing}
          paused={paused}
          lastUpdated={lastUpdated}
          query={filters.query}
          visualMode={visualMode}
          onQueryChange={handleQueryChange}
          onVisualModeChange={setVisualMode}
          onRefresh={() => { void refresh(); }}
          onTogglePause={() => setPaused(!paused)}
          sourcePanelOpen={sourcePanelOpen}
          onToggleSourcePanel={() => setSourcePanelOpen((open) => !open)}
        />

        {sourcePanelOpen ? (
          <SourceStatusPanel
            snapshot={osintSnapshot}
            conflictSource={source}
            conflictError={error}
            lastUpdated={lastUpdated}
            correlation={correlation}
            onClose={() => setSourcePanelOpen(false)}
          />
        ) : null}

        {theaterPanelOpen ? (
          <TheaterList
            theaters={theaters}
            selectedTheaterSlug={selectedTheaterSlug}
            surgeSignalsByTheater={surgeSignalsByTheater}
            onTheaterSelect={handleTheaterSelect}
            onClearTheater={clearTheater}
          />
        ) : null}

        <button
          type="button"
          onClick={() => setTheaterPanelOpen((open) => !open)}
          className={`pointer-events-auto absolute top-24 z-50 hidden h-14 w-6 items-center justify-center rounded-sm border border-white/10 bg-[#050806]/78 text-white/38 backdrop-blur transition hover:border-amber-200/25 hover:text-amber-100 xl:flex ${theaterPanelOpen ? "left-[340px]" : "left-3"}`}
          aria-label={theaterPanelOpen ? "Collapse theater panel" : "Expand theater panel"}
        >
          {theaterPanelOpen ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>

        {selectedEvent ? <TargetLockOverlay event={selectedEvent} /> : null}

        {selectedAircraft && !selectedEvent ? (
          <AircraftDetailPanel aircraft={selectedAircraft} onClose={() => setSelectedAircraft(null)} />
        ) : null}

        {(selectedCivilAircraft || selectedVessel) && !selectedEvent ? (
          <TransportDetailPanel
            aircraft={selectedCivilAircraft}
            vessel={selectedVessel}
            onClose={() => { setSelectedCivilAircraft(null); setSelectedVessel(null); }}
          />
        ) : null}

        {incidentPanelOpen ? (
          selectedEvent ? (
            <EventDetailPanel
              event={selectedEvent}
              theater={theaters.find((theater) => theater.slug === selectedEvent.theater) ?? null}
              snapshot={osintSnapshot}
              convergenceCard={selectedConvergenceCard}
              onClose={() => setSelectedEventId(null)}
              onTheaterFocus={isolateTheater}
            />
          ) : watchOpen ? (
            <WatchCenter
              events={events}
              surgeAnalysis={surgeAnalysis}
              evaluation={watchEvaluation}
              rules={watchRules}
              alertStates={watchAlertStates}
              storageReady={watchStorageReady}
              storageStatus={watchStorageStatus}
              onUpsertRule={upsertWatchRule}
              onToggleRule={toggleWatchRule}
              onDismissAlert={dismissWatchAlert}
              onSnoozeAlert={snoozeWatchAlert}
              onRestoreAlert={restoreWatchAlert}
              onSelectEvent={handleEventSelect}
              onFocusTheater={focusTheaterBySlug}
              onClose={() => setWatchOpen(false)}
            />
          ) : convergenceOpen ? (
            <ConvergenceInspector
              analysis={convergence.analysis}
              cards={convergenceCards}
              scopeCardCount={convergence.analysis.cards.length}
              playbackActive={playback.active}
              eventsById={eventsById}
              onSelectEvent={handleEventSelect}
              onClose={() => setConvergenceOpen(false)}
            />
          ) : (
            <EventFeed
              events={temporalEvents}
              selectedEventId={selectedEventId}
              onEventSelect={handleEventSelect}
            />
          )
        ) : null}

        <button
          type="button"
          onClick={() => setIncidentPanelOpen((open) => !open)}
          className={`pointer-events-auto absolute top-24 z-50 hidden h-14 w-6 items-center justify-center rounded-sm border border-white/10 bg-[#050806]/78 text-white/38 backdrop-blur transition hover:border-amber-200/25 hover:text-amber-100 xl:flex ${incidentPanelOpen ? "right-[394px]" : "right-3"}`}
          aria-label={incidentPanelOpen ? "Collapse incident panel" : "Expand incident panel"}
        >
          {incidentPanelOpen ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>

        <MapLegend />

        <ControlDeck
          timeWindow={filters.timeWindow}
          categoryGroups={filters.categoryGroups}
          severities={filters.severities}
          layers={layers}
          autoRotate={autoRotate}
          tourActive={tourActive}
          timeline={timeline}
          events={visibleEvents}
          playback={playback}
          corpusCoverage={corpusCoverage}
          convergenceOpen={convergenceOpen}
          convergenceCardCount={convergenceCards.length}
          watchOpen={watchOpen}
          watchAlertCount={watchEvaluation.stats.triggeredRuleCount}
          surgeSignalCount={surgeSignalCount}
          onTimeWindowChange={handleTimeWindowChange}
          onToggleCategoryGroup={handleToggleCategoryGroup}
          onToggleSeverity={handleToggleSeverity}
          onToggleLayer={handleToggleLayer}
          onToggleConvergence={handleToggleConvergence}
          onToggleWatch={handleToggleWatch}
          onAutoRotateChange={setAutoRotate}
          onTourActiveChange={setTourActive}
        />

        <MobileIntelSheet
          events={temporalEvents}
          theaters={theaters}
          selectedEvent={selectedEvent}
          selectedTheater={selectedTheater}
          onEventSelect={handleEventSelect}
          onTheaterSelect={(theater) => {
            if (theater) handleTheaterSelect(theater);
            else clearTheater();
          }}
        />

        <a
          href="https://warheatmap.app/"
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto absolute bottom-[154px] right-4 z-20 hidden rounded-md border border-white/8 bg-black/35 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/28 backdrop-blur-sm transition hover:border-amber-200/20 hover:text-amber-100/60 md:block"
        >
          OSINT: WarHeatMap · MapOfWars/UCDP · CC BY 4.0
        </a>

        {error && source === "fallback" && (
          <div className="pointer-events-auto absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-sm border border-amber-300/20 bg-amber-400/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/76 backdrop-blur-md">
            Live feed unavailable — using cached intelligence snapshot
          </div>
        )}
      </div>

      <BootSequence loading={loading} source={source} />
    </main>
  );
}
