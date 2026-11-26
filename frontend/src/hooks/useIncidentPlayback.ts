"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictEvent } from "@/types/conflict";
import {
  buildIncidentTemporalAnalysis,
  collectPlaybackEvents,
  summarizePlaybackEvents,
  HOUR_MS,
  type IncidentTemporalAnalysis,
  type PlaybackEventSummary,
  type PlaybackExtraction,
  type PlaybackMode,
  type TemporalResolutionPreference,
} from "@/lib/incidentTime";

export const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;
export const PLAYBACK_TRAIL_OPTIONS_HOURS = [24, 72, 24 * 7, 24 * 30] as const;

export interface IncidentPlaybackController {
  active: boolean;
  playing: boolean;
  mode: PlaybackMode;
  speedMultiplier: number;
  resolutionPreference: TemporalResolutionPreference;
  trailHours: number;
  trailingFrames: number;
  analysis: IncidentTemporalAnalysis;
  frameIndex: number;
  frame: IncidentTemporalAnalysis["frames"][number] | null;
  extraction: PlaybackExtraction | null;
  events: ConflictEvent[];
  eventSummary: PlaybackEventSummary;
  reducedMotion: boolean;
  dataTimePerWallSecondMs: number;
  toggleActive: () => void;
  togglePlaying: () => void;
  pause: () => void;
  seekFrame: (frameIndex: number) => void;
  stepFrames: (delta: number) => void;
  jumpToStart: () => void;
  jumpToEnd: () => void;
  reset: () => void;
  setMode: (mode: PlaybackMode) => void;
  setSpeedMultiplier: (speed: number) => void;
  cycleSpeed: (direction: -1 | 1) => void;
  setResolutionPreference: (resolution: TemporalResolutionPreference) => void;
  setTrailHours: (hours: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a"));
}

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return reducedMotion;
}

/**
 * Deterministic incident playback controller. Wall-clock timing only decides when the
 * controller advances; every emitted position is snapped to the analysis frame grid, so the
 * same frame index always produces the same incident membership. No event positions or times
 * are interpolated.
 */
export function useIncidentPlayback(scopeEvents: ConflictEvent[]): IncidentPlaybackController {
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mode, setModeState] = useState<PlaybackMode>("trailing");
  const [speedMultiplier, setSpeedMultiplierState] = useState(1);
  const [resolutionPreference, setResolutionPreferenceState] = useState<TemporalResolutionPreference>("auto");
  const [trailHours, setTrailHoursState] = useState(24 * 7);
  const [cursor, setCursor] = useState<number | null>(null);

  const analysis = useMemo(
    () => buildIncidentTemporalAnalysis(scopeEvents, { resolution: resolutionPreference }),
    [scopeEvents, resolutionPreference],
  );

  const frameIndex = useMemo(() => {
    if (analysis.frameCount === 0) return 0;
    const time = cursor ?? analysis.domainStart;
    return clamp(Math.floor((time - analysis.domainStart) / analysis.stepMs), 0, analysis.frameCount - 1);
  }, [analysis.frameCount, analysis.domainStart, analysis.stepMs, cursor]);

  const frame = analysis.frames[frameIndex] ?? null;
  const trailingFrames = useMemo(
    () => Math.max(1, Math.ceil((trailHours * HOUR_MS) / Math.max(1, analysis.stepMs))),
    [analysis.stepMs, trailHours],
  );

  const extraction = useMemo(() => {
    if (!active) return null;
    return collectPlaybackEvents(analysis, frameIndex, mode, trailingFrames);
  }, [active, analysis, frameIndex, mode, trailingFrames]);

  const events = useMemo(() => extraction?.events ?? [], [extraction]);
  const eventSummary = useMemo(() => summarizePlaybackEvents(events), [events]);

  const seekFrame = useCallback((requestedFrame: number) => {
    if (analysis.frameCount === 0) return;
    const nextFrame = clamp(Math.trunc(requestedFrame), 0, analysis.frameCount - 1);
    setCursor(analysis.domainStart + nextFrame * analysis.stepMs);
  }, [analysis.frameCount, analysis.domainStart, analysis.stepMs]);

  const stepFrames = useCallback((delta: number) => {
    if (analysis.frameCount === 0 || !Number.isFinite(delta)) return;
    setCursor((current) => {
      const baseIndex = current === null || !Number.isFinite(current)
        ? frameIndex
        : clamp(Math.floor((current - analysis.domainStart) / analysis.stepMs), 0, analysis.frameCount - 1);
      const nextFrame = clamp(baseIndex + Math.trunc(delta), 0, analysis.frameCount - 1);
      return analysis.domainStart + nextFrame * analysis.stepMs;
    });
  }, [analysis.frameCount, analysis.domainStart, analysis.stepMs, frameIndex]);

  const jumpToStart = useCallback(() => {
    if (analysis.frameCount === 0) return;
    setCursor(analysis.domainStart);
  }, [analysis.frameCount, analysis.domainStart]);

  const jumpToEnd = useCallback(() => {
    if (analysis.frameCount === 0) return;
    setCursor(analysis.domainStart + (analysis.frameCount - 1) * analysis.stepMs);
  }, [analysis.frameCount, analysis.domainStart, analysis.stepMs]);

  const pause = useCallback(() => setPlaying(false), []);

  const togglePlaying = useCallback(() => {
    if (analysis.frameCount === 0) return;
    if (!playing && frameIndex >= analysis.frameCount - 1) {
      setCursor(analysis.domainStart);
    }
    setPlaying((current) => !current);
  }, [analysis.frameCount, analysis.domainStart, frameIndex, playing]);

  const toggleActive = useCallback(() => {
    if (active) {
      setPlaying(false);
      setActive(false);
      return;
    }
    if (cursor === null) setCursor(analysis.domainStart);
    setActive(true);
  }, [active, analysis.domainStart, cursor]);

  const reset = useCallback(() => {
    setPlaying(false);
    if (analysis.frameCount > 0) setCursor(analysis.domainStart);
  }, [analysis.frameCount, analysis.domainStart]);

  const setMode = useCallback((nextMode: PlaybackMode) => setModeState(nextMode), []);
  const setSpeedMultiplier = useCallback((speed: number) => {
    if (PLAYBACK_SPEED_OPTIONS.some((option) => option === speed)) setSpeedMultiplierState(speed);
  }, []);
  const setResolutionPreference = useCallback((resolution: TemporalResolutionPreference) => {
    setResolutionPreferenceState(resolution);
  }, []);
  const setTrailHours = useCallback((hours: number) => {
    if (PLAYBACK_TRAIL_OPTIONS_HOURS.some((option) => option === hours)) setTrailHoursState(hours);
  }, []);

  const cycleSpeed = useCallback((direction: -1 | 1) => {
    const index = PLAYBACK_SPEED_OPTIONS.findIndex((option) => option === speedMultiplier);
    const nextIndex = clamp((index === -1 ? 2 : index) + direction, 0, PLAYBACK_SPEED_OPTIONS.length - 1);
    setSpeedMultiplierState(PLAYBACK_SPEED_OPTIONS[nextIndex]);
  }, [speedMultiplier]);

  const cursorRef = useRef<number | null>(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);


  useEffect(() => {
    if (!active || !playing || analysis.frameCount === 0) return undefined;

    let animationFrame = 0;
    let lastTick = performance.now();
    let lastCommit = lastTick;
    let stepCarry = 0;
    const maxFrame = analysis.frameCount - 1;
    const minimumCommitMs = reducedMotion ? 240 : speedMultiplier >= 8 ? 120 : speedMultiplier >= 2 ? 80 : 40;

    const tick = (now: number) => {
      // Cap resumption deltas so returning from a throttled background tab causes one bounded,
      // reviewable jump rather than an opaque leap across the corpus.
      const elapsedSeconds = Math.min(0.5, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      stepCarry += elapsedSeconds * speedMultiplier;

      if (now - lastCommit >= minimumCommitMs) {
        const steps = Math.floor(stepCarry);
        if (steps > 0) {
          stepCarry -= steps;
          lastCommit = now;
          const currentTime = cursorRef.current ?? analysis.domainStart;
          const currentFrame = clamp(Math.floor((currentTime - analysis.domainStart) / analysis.stepMs), 0, maxFrame);
          const nextFrame = Math.min(maxFrame, currentFrame + steps);
          if (nextFrame !== currentFrame) {
            const nextTime = analysis.domainStart + nextFrame * analysis.stepMs;
            cursorRef.current = nextTime;
            setCursor(nextTime);
          }
          if (nextFrame >= maxFrame) setPlaying(false);
        }
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [active, playing, analysis.frameCount, analysis.domainStart, analysis.stepMs, speedMultiplier, reducedMotion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return;
      // Space remains the native activation key for a focused button/link; arrows, Home/End,
      // and speed keys still work globally after a transport button retains focus.
      if (event.key === " " && isActivationTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        toggleActive();
        return;
      }
      if (!active) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlaying();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepFrames(event.shiftKey ? -10 : -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepFrames(event.shiftKey ? 10 : 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        jumpToStart();
      } else if (event.key === "End") {
        event.preventDefault();
        jumpToEnd();
      } else if (event.key === "[") {
        event.preventDefault();
        cycleSpeed(-1);
      } else if (event.key === "]") {
        event.preventDefault();
        cycleSpeed(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, toggleActive, togglePlaying, stepFrames, jumpToStart, jumpToEnd, cycleSpeed]);

  return {
    active,
    playing,
    mode,
    speedMultiplier,
    resolutionPreference,
    trailHours,
    trailingFrames,
    analysis,
    frameIndex,
    frame,
    extraction,
    events,
    eventSummary,
    reducedMotion,
    dataTimePerWallSecondMs: analysis.stepMs * speedMultiplier,
    toggleActive,
    togglePlaying,
    pause,
    seekFrame,
    stepFrames,
    jumpToStart,
    jumpToEnd,
    reset,
    setMode,
    setSpeedMultiplier,
    cycleSpeed,
    setResolutionPreference,
    setTrailHours,
  };
}
