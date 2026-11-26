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
import { useIncidentPlayback, type IncidentPlaybackRestoreState } from "@/hooks/useIncidentPlayback";
import { useOsintSnapshot } from "@/hooks/useOsintSnapshot";
import { useDomainConvergence } from "@/hooks/useDomainConvergence";
import { useWatchRules } from "@/hooks/useWatchRules";
import { useOperatorUrlStateSync } from "@/hooks/useOperatorUrlStateSync";
import { useGlobeRenderStatusStore } from "@/hooks/useGlobeRenderStatus";
import { analyzeEscalationSurge } from "@/lib/escalationSurge";
import { evaluateWatchRules } from "@/lib/watchRules";
import { measureIncidentTemporalCoverage } from "@/lib/incidentTime";
import { buildAnalystExportArtifacts, buildShareablePermalink, type AnalystExportArtifacts } from "@/lib/analystExport";
import { CONVERGENCE_DISCLAIMER } from "@/lib/domainConvergence";
import {
  DEFAULT_OPERATOR_LAYERS,
  type OperatorCameraUrlState,
  type OperatorUrlState,
} from "@/lib/operatorUrlState";
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

const DEFAULT_LAYERS: GodEyeLayerToggles = DEFAULT_OPERATOR_LAYERS;
const EMPTY_SNAPSHOT_CONFLICT_EVENTS: ConflictEvent[] = [];

function describeOsintRuntime(runtime: ReturnType<typeof useOsintSnapshot>["runtime"]): { message: string; tone: "loading" | "warning" | "error" } | null {
  const progress = `${runtime.usableChunkCount}/${runtime.totalChunkCount || "?"}`;
  if (runtime.phase === "critical-loading" || runtime.phase === "manifest-loading") {
    return { message: `OSINT lattice ${progress} — critical conflict/context chunks loading; heavy transport/media not yet requested`, tone: "loading" };
  }
  if (runtime.phase === "background-loading") {
    return { message: `critical conflict/context ready — ${progress} domain chunks usable; pending layers are loading, not zero coverage`, tone: "loading" };
  }
  if (runtime.phase === "degraded") {
    return { message: `OSINT lattice degraded — ${runtime.error ?? "one or more chunks failed"}; retained rows are marked stale, never fresh`, tone: "warning" };
  }
  if (runtime.phase === "failed") {
    return { message: `OSINT lattice unavailable — ${runtime.error ?? "manifest and compatibility artifact failed"}`, tone: "error" };
  }
  if (runtime.stale) return { message: "domain chunks complete — source-defined preserved/stale collections disclosed in source status", tone: "warning" };
  return null;
}

export default function GodEyeCommandCenter() {
  const osintSnapshot = useOsintSnapshot();
  const osintRuntime = osintSnapshot.runtime;
  const snapshotConflictEvents = useMemo(
    () => {
      const normalized = osintSnapshot.mapOfWarsEvents.map(normalizeMapOfWarsEvent).filter((event): event is ConflictEvent => event !== null);
      // Stable empty identity: pending chunk shells must not restart the independent conflict-feed loader.
      return normalized.length > 0 ? normalized : EMPTY_SNAPSHOT_CONFLICT_EVENTS;
    },
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
  const [reducedEffects, setReducedEffects] = useState(false);
  const globeRenderStatusStore = useGlobeRenderStatusStore();
  const [theaterPanelOpen, setTheaterPanelOpen] = useState(true);
  const [incidentPanelOpen, setIncidentPanelOpen] = useState(true);
  const [convergenceOpen, setConvergenceOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [selectedTheaterSlug, setSelectedTheaterSlug] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<GodEyeFocusTarget | null>(null);
  const cameraRef = useRef<OperatorCameraUrlState | null>(null);
  const focusSequenceRef = useRef(0);
  const urlRestoreSequenceRef = useRef(0);
  const pendingSpatialRestoreRef = useRef<{ eventId: string | null; theater: string | null } | null>(null);
  const pendingPlaybackRestoreRef = useRef<IncidentPlaybackRestoreState | null>(null);
  const playbackRestoreAcknowledgedRef = useRef(false);
  const loadingRef = useRef(loading);


  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setAutoRotate(false);
        setTourActive(false);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  // Legacy ?mode=satellite links are interpreted by the versioned operator-state
  // decoder in useOperatorUrlStateSync below; no separate query parser is needed here.

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
  const convergence = useDomainConvergence(visibleEvents, osintSnapshot, osintRuntime.evidencePending);
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

  const restorePlayback = playback.restore;
  const playbackActive = playback.active;
  const playbackPlaying = playback.playing;
  const playbackMode = playback.mode;
  const playbackFrameIndex = playback.frameIndex;
  const playbackFrameStart = playback.frame?.start ?? null;
  const playbackSpeedMultiplier = playback.speedMultiplier;
  const playbackResolutionPreference = playback.resolutionPreference;
  const playbackTrailHours = playback.trailHours;
  const playbackRestoring = playback.restoring;

  const focusCamera = useCallback((lat: number, lng: number, altitude: number, keyPrefix: string) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(altitude)) return;
    focusSequenceRef.current += 1;
    const camera = { lat, lng, altitude };
    cameraRef.current = camera;
    setFocusTarget({
      ...camera,
      key: `${keyPrefix}-${focusSequenceRef.current}`,
    });
  }, []);

  const applyOperatorState = useCallback((nextState: OperatorUrlState) => {
    // Tour mode is a transient guided transition, not shareable workspace truth; a
    // permalink always restores a stable operator-controlled view.
    setTourActive(false);
    setVisualMode(nextState.visualMode);
    setLayers({ ...nextState.layers });
    setFilters({
      timeWindow: nextState.filters.timeWindow,
      categoryGroups: [...nextState.filters.categoryGroups],
      severities: [...nextState.filters.severities],
      theater: nextState.filters.theater,
      query: nextState.filters.query,
    });
    setSelectedTheaterSlug(nextState.filters.theater);
    setSelectedEventId(nextState.selectedEventId);
    setSelectedAircraft(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(null);
    setSourcePanelOpen(nextState.panels.source);
    setTheaterPanelOpen(nextState.panels.theater);
    setIncidentPanelOpen(nextState.panels.incident);
    setConvergenceOpen(nextState.panels.inspector === "convergence");
    setWatchOpen(nextState.panels.inspector === "watch");
    setPaused(nextState.refreshPaused);

    const playbackSnapshot = { ...nextState.playback };
    pendingPlaybackRestoreRef.current = playbackSnapshot;
    if (!loadingRef.current) {
      restorePlayback(playbackSnapshot);
      // Inactive playback is restored synchronously; active playback remains pending
      // until the playback hook reports that frame-grid resolution has completed.
      if (!playbackSnapshot.active) pendingPlaybackRestoreRef.current = null;
    }

    if (nextState.camera) {
      // A fixed shared camera would immediately lie if drift were still enabled.
      setAutoRotate(false);
      pendingSpatialRestoreRef.current = null;
      urlRestoreSequenceRef.current += 1;
      cameraRef.current = { ...nextState.camera };
      setFocusTarget({
        ...nextState.camera,
        key: `url-camera-${urlRestoreSequenceRef.current}`,
      });
    } else {
      // Older v1 links and links copied while drift is active carry no fixed camera
      // constraint. Derive a useful focus from the selected event/theater once data arrives.
      pendingSpatialRestoreRef.current = {
        eventId: nextState.selectedEventId,
        theater: nextState.filters.theater,
      };
    }
  }, [restorePlayback, setPaused]);

  const buildOperatorState = useCallback((): OperatorUrlState => ({
    visualMode,
    layers: { ...layers },
    filters: {
      timeWindow: filters.timeWindow,
      categoryGroups: [...filters.categoryGroups],
      severities: [...filters.severities],
      theater: filters.theater,
      query: filters.query,
    },
    selectedEventId,
    refreshPaused: paused,
    panels: {
      theater: theaterPanelOpen,
      incident: incidentPanelOpen,
      source: sourcePanelOpen,
      inspector: watchOpen ? "watch" : convergenceOpen ? "convergence" : "feed",
    },
    playback: {
      active: playbackActive,
      playing: playbackActive && playbackPlaying,
      mode: playbackMode,
      frameIndex: playbackActive ? playbackFrameIndex : null,
      frameStart: playbackActive ? playbackFrameStart : null,
      speedMultiplier: playbackSpeedMultiplier,
      resolutionPreference: playbackResolutionPreference,
      trailHours: playbackTrailHours,
    },
    // Continuously persisting a drifting camera would churn the URL and still be
    // non-reproducible. A camera center is encoded only once the operator pauses drift.
    camera: !autoRotate && !tourActive ? cameraRef.current : null,
  }), [
    autoRotate,
    convergenceOpen,
    filters,
    incidentPanelOpen,
    layers,
    paused,
    playbackActive,
    playbackFrameIndex,
    playbackFrameStart,
    playbackMode,
    playbackPlaying,
    playbackResolutionPreference,
    playbackSpeedMultiplier,
    playbackTrailHours,
    selectedEventId,
    sourcePanelOpen,
    theaterPanelOpen,
    tourActive,
    visualMode,
    watchOpen,
  ]);

  const {
    scheduleSync: scheduleOperatorUrlSync,
    copyPermalink,
    shareFeedback,
    urlNotice,
  } = useOperatorUrlStateSync({
    applyState: applyOperatorState,
    buildState: buildOperatorState,
    canSync: () => (
      !loadingRef.current
      && pendingPlaybackRestoreRef.current === null
      && pendingSpatialRestoreRef.current === null
      && !playbackRestoring
    ),
  });

  // Analyst export bundle assembly is deliberately click-time rather than memoized: the
  // artifact must describe the exact workspace state at the moment of handoff, including a
  // freshly encoded permalink. The library builders are pure and deterministic; the only
  // clock input is the generation timestamp passed here.
  const buildExportArtifacts = useCallback((): AnalystExportArtifacts => {
    const operatorState = buildOperatorState();
    const baseUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const permalink = buildShareablePermalink(operatorState, baseUrl);
    return buildAnalystExportArtifacts({
      generatedAt: Date.now(),
      permalink,
      operatorState,
      filters: {
        timeWindow: filters.timeWindow,
        categoryGroups: [...filters.categoryGroups],
        severities: [...filters.severities],
        theater: filters.theater,
        query: filters.query,
      },
      playback: {
        active: playbackActive,
        playing: playbackActive && playbackPlaying,
        mode: playbackMode,
        frameIndex: playbackActive ? playbackFrameIndex : null,
        frameStart: playbackActive ? playbackFrameStart : null,
        frameEndExclusive: playbackActive && playback.frame ? playback.frame.endExclusive : null,
        speedMultiplier: playbackSpeedMultiplier,
        resolutionPreference: playbackResolutionPreference,
        trailHours: playbackTrailHours,
        frameEventCount: playbackActive ? temporalEvents.length : null,
      },
      events: visibleEvents,
      corpusIncidentCount: events.length,
      feed: { source, lastUpdated, error, correlation },
      snapshot: osintSnapshot,
      snapshotRuntime: osintRuntime,
      convergence: convergence.analysis,
      convergenceDisclaimer: CONVERGENCE_DISCLAIMER,
      surge: surgeAnalysis,
      watchEvaluation,
      watchRules,
    });
  }, [
    buildOperatorState,
    convergence.analysis,
    correlation,
    error,
    events.length,
    filters,
    lastUpdated,
    osintRuntime,
    osintSnapshot,
    playback.frame,
    playbackActive,
    playbackFrameIndex,
    playbackFrameStart,
    playbackMode,
    playbackPlaying,
    playbackResolutionPreference,
    playbackSpeedMultiplier,
    playbackTrailHours,
    source,
    surgeAnalysis,
    temporalEvents.length,
    visibleEvents,
    watchEvaluation,
    watchRules,
  ]);

  useEffect(() => {
    loadingRef.current = loading;
    if (loading) return;
    const pendingPlayback = pendingPlaybackRestoreRef.current;
    if (!pendingPlayback) return;
    restorePlayback(pendingPlayback);
    if (!pendingPlayback.active) pendingPlaybackRestoreRef.current = null;
  }, [loading, restorePlayback]);

  useEffect(() => {
    if (playbackRestoring && pendingPlaybackRestoreRef.current) {
      playbackRestoreAcknowledgedRef.current = true;
      return;
    }
    if (!playbackRestoring && playbackRestoreAcknowledgedRef.current) {
      playbackRestoreAcknowledgedRef.current = false;
      pendingPlaybackRestoreRef.current = null;
    }
  }, [playbackRestoring]);

  useEffect(() => {
    if (loading) return;
    const pendingSpatial = pendingSpatialRestoreRef.current;
    if (!pendingSpatial) return;
    pendingSpatialRestoreRef.current = null;

    if (pendingSpatial.eventId) {
      const event = events.find((item) => item.id === pendingSpatial.eventId);
      if (event) focusCamera(event.lat, event.lng, 0.82, `url-event-${event.id}`);
      return;
    }
    if (pendingSpatial.theater) {
      const theater = theaters.find((item) => item.slug === pendingSpatial.theater);
      if (theater) focusCamera(theater.lat, theater.lng, 1.34, `url-theater-${theater.slug}`);
    }
  }, [events, theaters, loading, focusCamera]);

  // React state changes are coalesced by the synchronizer. The timer is intentionally
  // not reset for every playback frame/camera movement, so continuous interaction gets
  // a trailing write at a bounded cadence instead of a history or render storm.
  useEffect(() => {
    scheduleOperatorUrlSync();
  }, [
    scheduleOperatorUrlSync,
    visualMode,
    layers,
    filters,
    selectedEventId,
    focusTarget,
    paused,
    sourcePanelOpen,
    theaterPanelOpen,
    incidentPanelOpen,
    convergenceOpen,
    watchOpen,
    playbackActive,
    playbackPlaying,
    playbackMode,
    playbackFrameIndex,
    playbackFrameStart,
    playbackSpeedMultiplier,
    playbackResolutionPreference,
    playbackTrailHours,
    playbackRestoring,
    loading,
    autoRotate,
    tourActive,
  ]);

  const handleCameraChange = useCallback((camera: OperatorCameraUrlState) => {
    cameraRef.current = camera;
    if (!autoRotate && !tourActive) scheduleOperatorUrlSync();
  }, [autoRotate, scheduleOperatorUrlSync, tourActive]);

  const getInitialCamera = useCallback(() => cameraRef.current, []);

  const handleGlobeRenderStatus = useCallback((status: Parameters<typeof globeRenderStatusStore.publish>[0]) => {
    globeRenderStatusStore.publish(status);
  }, [globeRenderStatusStore]);
  const handleGlobeRenderFailure = useCallback(() => setGlobeUnavailable(true), []);

  const handleEventSelect = useCallback((event: ConflictEvent) => {
    setAutoRotate(false);
    pausePlayback();
    setSelectedAircraft(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(null);
    setSelectedEventId(event.id);
    focusCamera(event.lat, event.lng, 0.82, `event-${event.id}`);
  }, [focusCamera, pausePlayback]);

  const handleAircraftSelect = useCallback((aircraft: MilitaryAircraft) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(null);
    setSelectedAircraft(aircraft);
    focusCamera(aircraft.lat, aircraft.lng, 1.05, `aircraft-${aircraft.id}`);
  }, [focusCamera]);

  const handleCivilAircraftSelect = useCallback((aircraft: OsintAircraft) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedAircraft(null);
    setSelectedVessel(null);
    setSelectedCivilAircraft(aircraft);
    focusCamera(aircraft.lat, aircraft.lng, 1.0, `civil-${aircraft.id}`);
  }, [focusCamera]);

  const handleVesselSelect = useCallback((vessel: OsintVessel) => {
    setAutoRotate(false);
    setSelectedEventId(null);
    setSelectedAircraft(null);
    setSelectedCivilAircraft(null);
    setSelectedVessel(vessel);
    focusCamera(vessel.lat, vessel.lng, 0.72, `vessel-${vessel.id}`);
  }, [focusCamera]);

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
      focusCamera(theater.lat, theater.lng, 1.34, `theater-${theater.slug}`);
    }
  }, [filters.theater, focusCamera]);

  const isolateTheater = useCallback((theater: ConflictTheater) => {
    setSelectedEventId(null);
    setSelectedTheaterSlug(theater.slug);
    setFilters((current) => ({ ...current, theater: theater.slug }));
    focusCamera(theater.lat, theater.lng, 1.34, `theater-${theater.slug}`);
  }, [focusCamera]);

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
      focusCamera(theater.lat, theater.lng, 1.24, `tour-${theater.slug}`);
    };
    const initial = window.setTimeout(focusTheater, 500);
    const interval = window.setInterval(focusTheater, 9000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [tourActive, focusCamera]);

  const osintStatus = describeOsintRuntime(osintRuntime);
  const snapshotReadyForExport = osintRuntime.complete && !osintRuntime.evidencePending;

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
          getInitialCamera={getInitialCamera}
          layers={layers}
          visualMode={visualMode}
          autoRotate={autoRotate}
          playbackFrame={globePlaybackFrame}
          reducedMotion={playback.reducedMotion}
          reducedEffects={reducedEffects}
          selectedMilitaryAircraft={selectedAircraft}
          selectedCivilAircraft={selectedCivilAircraft}
          selectedVessel={selectedVessel}
          onRenderStatus={handleGlobeRenderStatus}
          onEventSelect={handleEventSelect}
          onAircraftSelect={handleAircraftSelect}
          onCivilAircraftSelect={handleCivilAircraftSelect}
          onVesselSelect={handleVesselSelect}
          onTheaterSelect={handleTheaterSelect}
          onCameraChange={handleCameraChange}
          onRenderFailure={handleGlobeRenderFailure}
        />
      )}

      <div className="pointer-events-none absolute inset-0 z-20">
        {osintStatus ? (
          <div role="status" className={`pointer-events-auto absolute left-1/2 top-[4.35rem] z-30 w-[min(43rem,calc(100vw-2rem))] -translate-x-1/2 rounded-sm border px-3 py-1.5 text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.13em] backdrop-blur-md ${osintStatus.tone === "error" ? "border-red-300/24 bg-red-400/10 text-red-100/78" : osintStatus.tone === "warning" ? "border-amber-300/20 bg-amber-400/10 text-amber-100/76" : "border-cyan-300/18 bg-cyan-400/[0.075] text-cyan-100/72"}`}>
            {osintStatus.message}
          </div>
        ) : null}
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
          onCopyPermalink={() => { void copyPermalink(); }}
          shareFeedback={shareFeedback}
        />

        {sourcePanelOpen ? (
          <SourceStatusPanel
            snapshot={osintSnapshot}
            snapshotRuntime={osintRuntime}
            conflictSource={source}
            conflictError={error}
            lastUpdated={lastUpdated}
            correlation={correlation}
            renderStatusStore={globeRenderStatusStore}
            reducedEffects={reducedEffects}
            onReducedEffectsChange={setReducedEffects}
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
              evidencePending={convergence.evidencePending}
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
          convergenceScopeCardCount={convergence.analysis.cards.length}
          convergenceEvidencePending={convergence.evidencePending}
          snapshotReadyForExport={snapshotReadyForExport}
          snapshotStatusLabel={osintStatus?.message ?? null}
          watchOpen={watchOpen}
          watchAlertCount={watchEvaluation.stats.triggeredRuleCount}
          surgeSignalCount={surgeSignalCount}
          buildAnalystExport={buildExportArtifacts}
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

        {urlNotice ? (
          <div role="status" className="pointer-events-auto absolute left-1/2 top-20 z-30 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-sm border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-sky-100/78 backdrop-blur-md">
            {urlNotice}
          </div>
        ) : null}

        {error && source === "fallback" && (
          <div className={`pointer-events-auto absolute left-1/2 z-30 -translate-x-1/2 rounded-sm border border-amber-300/20 bg-amber-400/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-100/76 backdrop-blur-md ${urlNotice ? "top-32" : "top-20"}`}>
            Live feed unavailable — using cached intelligence snapshot
          </div>
        )}
      </div>

      <BootSequence loading={loading} source={source} />
    </main>
  );
}
