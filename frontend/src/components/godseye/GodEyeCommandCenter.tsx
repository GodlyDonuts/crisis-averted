"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { CategoryGroup, ConflictEvent, ConflictFilters, ConflictTheater, MilitaryAircraft, SeverityKey } from "@/types/conflict";
import {
  aggregateTheaters,
  buildTimeline,
  DEFAULT_CONFLICT_FILTERS,
  filterConflictEvents,
  summarizeEvents,
  normalizeMapOfWarsEvent,
} from "@/lib/conflictData";
import { useConflictEvents } from "@/hooks/useConflictEvents";
import { useOsintSnapshot } from "@/hooks/useOsintSnapshot";
import TopCommandBar from "./TopCommandBar";
import TheaterList from "./TheaterList";
import EventFeed from "./EventFeed";
import EventDetailPanel from "./EventDetailPanel";
import ControlDeck from "./ControlDeck";
import { MobileIntelSheet } from "./MobileIntelSheet";
import { TargetLockOverlay } from "./TargetLockOverlay";
import { AircraftDetailPanel } from "./AircraftDetailPanel";
import { SourceStatusPanel } from "./SourceStatusPanel";
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
  environmental: false,
  gpsInterference: true,
};

export default function GodEyeCommandCenter() {
  const osintSnapshot = useOsintSnapshot();
  const snapshotConflictEvents = useMemo(
    () => osintSnapshot.mapOfWarsEvents.map(normalizeMapOfWarsEvent).filter((event): event is ConflictEvent => event !== null),
    [osintSnapshot.mapOfWarsEvents]
  );
  const { events, source, loading, refreshing, error, lastUpdated, paused, setPaused, refresh } = useConflictEvents(snapshotConflictEvents);
  const [filters, setFilters] = useState<ConflictFilters>(() => createDefaultFilters());
  const [layers, setLayers] = useState<GodEyeLayerToggles>(DEFAULT_LAYERS);
  const [visualMode, setVisualMode] = useState<GodEyeVisualMode>("cinematic");
  const [autoRotate, setAutoRotate] = useState(true);
  const [tourActive, setTourActive] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<MilitaryAircraft | null>(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [theaterPanelOpen, setTheaterPanelOpen] = useState(true);
  const [incidentPanelOpen, setIncidentPanelOpen] = useState(true);
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

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((event) => event.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const selectedTheater = useMemo(() => {
    if (!selectedTheaterSlug) return null;
    return theaters.find((theater) => theater.slug === selectedTheaterSlug) ?? null;
  }, [theaters, selectedTheaterSlug]);

  const handleEventSelect = useCallback((event: ConflictEvent) => {
    setAutoRotate(false);
    setSelectedAircraft(null);
    setSelectedEventId(event.id);
    setFocusTarget({
      lat: event.lat,
      lng: event.lng,
      altitude: 0.82,
      key: `event-${event.id}-${Date.now()}`,
    });
  }, []);

  const handleAircraftSelect = useCallback((aircraft: MilitaryAircraft) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedAircraft(aircraft);
    setFocusTarget({
      lat: aircraft.lat,
      lng: aircraft.lng,
      altitude: 1.05,
      key: `aircraft-${aircraft.id}-${Date.now()}`,
    });
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

  const clearTheater = useCallback(() => {
    setSelectedTheaterSlug(null);
    setFilters((current) => ({ ...current, theater: null }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedEventId) {
        setSelectedEventId(null);
      } else if (filters.theater) {
        clearTheater();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearTheater, filters.theater, selectedEventId]);

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
      <GodEyeGlobe
        key={visualMode}
        events={visibleEvents}
        theaters={theaters}
        militaryAircraft={osintSnapshot.militaryAircraft}
        launches={osintSnapshot.launches}
        naturalEvents={osintSnapshot.naturalEvents}
        gpsInterference={osintSnapshot.gpsInterference}
        selectedEvent={selectedEvent}
        selectedTheater={selectedTheater}
        focusTarget={focusTarget}
        layers={layers}
        visualMode={visualMode}
        autoRotate={autoRotate}
        onEventSelect={handleEventSelect}
        onAircraftSelect={handleAircraftSelect}
        onTheaterSelect={handleTheaterSelect}
      />

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
            onClose={() => setSourcePanelOpen(false)}
          />
        ) : null}

        {theaterPanelOpen ? (
          <TheaterList
            theaters={theaters}
            selectedTheaterSlug={selectedTheaterSlug}
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

        {incidentPanelOpen ? (
          selectedEvent ? (
            <EventDetailPanel
              event={selectedEvent}
              theater={theaters.find((theater) => theater.slug === selectedEvent.theater) ?? null}
              snapshot={osintSnapshot}
              onClose={() => setSelectedEventId(null)}
              onTheaterFocus={isolateTheater}
            />
          ) : (
            <EventFeed
              events={visibleEvents}
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

        <ControlDeck
          timeWindow={filters.timeWindow}
          categoryGroups={filters.categoryGroups}
          severities={filters.severities}
          layers={layers}
          autoRotate={autoRotate}
          tourActive={tourActive}
          timeline={timeline}
          events={visibleEvents}
          onTimeWindowChange={handleTimeWindowChange}
          onToggleCategoryGroup={handleToggleCategoryGroup}
          onToggleSeverity={handleToggleSeverity}
          onToggleLayer={handleToggleLayer}
          onAutoRotateChange={setAutoRotate}
          onTourActiveChange={setTourActive}
        />

        <MobileIntelSheet
          events={visibleEvents}
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
