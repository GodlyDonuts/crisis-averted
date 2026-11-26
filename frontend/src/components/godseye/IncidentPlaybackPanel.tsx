"use client";

import { CalendarClock, Info, Pause, Play, RotateCcw, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import type { IncidentTemporalCoverage, PlaybackMode, TemporalResolutionPreference } from "@/lib/incidentTime";
import { formatDurationMs, formatUtcExact, TEMPORAL_RESOLUTIONS } from "@/lib/incidentTime";
import { PLAYBACK_SPEED_OPTIONS, PLAYBACK_TRAIL_OPTIONS_HOURS, type IncidentPlaybackController } from "@/hooks/useIncidentPlayback";

interface IncidentPlaybackPanelProps {
  playback: IncidentPlaybackController;
  corpusCoverage: IncidentTemporalCoverage;
}

const MODE_OPTIONS: { key: PlaybackMode; label: string; description: string }[] = [
  { key: "step", label: "Frame", description: "Only uncertainty windows intersecting the current frame" },
  { key: "trailing", label: "Trailing", description: "Sliding trailing window, quantized to visible frames" },
  { key: "cumulative", label: "Cumulative", description: "All windows whose start has been reached through the current frame" },
];

const RESOLUTION_OPTIONS: { key: TemporalResolutionPreference; label: string }[] = [
  { key: "auto", label: "Auto resolution" },
  { key: "hour", label: "Hour" },
  { key: "sixHour", label: "Six hours" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
];

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralValue}`;
}

function coverageText(coverage: IncidentTemporalCoverage): string {
  if (coverage.validEventCount === 0) return "no source-valid incident times";
  return `${formatUtcExact(coverage.start)} → ${formatUtcExact(coverage.endExclusive)} end-exclusive`;
}

export default function IncidentPlaybackPanel({ playback, corpusCoverage }: IncidentPlaybackPanelProps) {
  const { analysis, frame, eventSummary } = playback;
  const resolution = TEMPORAL_RESOLUTIONS[analysis.resolution];
  const maxStartCount = Math.max(1, analysis.maxStartCount);
  const effectiveTrailMs = playback.trailingFrames * analysis.stepMs;
  const speedLabel = `${playback.speedMultiplier}× · ${formatDurationMs(playback.dataTimePerWallSecondMs)} data / wall-second`;
  const modeLabel = MODE_OPTIONS.find((option) => option.key === playback.mode)?.label ?? playback.mode;
  const hasFrames = analysis.frameCount > 0 && frame !== null;

  return (
    <section
      aria-label="Deterministic incident temporal playback"
      className="godseye-scrollbar max-h-[44vh] overflow-y-auto border-b border-white/8 px-3 pb-2 pt-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 text-amber-100/62" />
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-100/48">Temporal playback</p>
            {playback.reducedMotion ? (
              <span className="rounded-sm border border-sky-200/15 bg-sky-300/[0.055] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-sky-100/58">
                reduced motion
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/36">
            {hasFrames ? `frame ${(playback.frameIndex + 1).toLocaleString()}/${analysis.frameCount.toLocaleString()} · ${resolution.shortLabel} deterministic steps` : "no valid incident times in filtered scope"}
          </p>
        </div>
        {hasFrames ? (
          <div className="text-right font-mono leading-tight">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/34">current frame UTC</p>
            <p className="mt-0.5 text-[11px] text-amber-50/86">
              <time dateTime={new Date(frame.start).toISOString()}>{formatUtcExact(frame.start)}</time>
            </p>
            <p className="text-[9.5px] text-white/38">
              → <time dateTime={new Date(frame.endExclusive).toISOString()}>{formatUtcExact(frame.endExclusive)}</time> end-exclusive
            </p>
          </div>
        ) : null}
      </div>

      {hasFrames ? (
        <>
          <div className="mt-2 flex h-12 items-end overflow-hidden rounded-sm border border-white/8 bg-black/18 px-[3px] pb-[3px] pt-[5px]" style={{ gap: analysis.frameCount > 140 ? 0 : 1 }}>
            {analysis.frames.map((bucket) => {
              const preciseCount = Math.max(0, bucket.startCount - bucket.startImpreciseCount);
              const preciseShare = bucket.startCount > 0 ? (preciseCount / bucket.startCount) * 100 : 0;
              const impreciseShare = bucket.startCount > 0 ? (bucket.startImpreciseCount / bucket.startCount) * 100 : 0;
              const scaledHeight = bucket.startCount > 0
                ? Math.max(9, Math.sqrt(bucket.startCount / maxStartCount) * 88)
                : 4;
              const selected = bucket.index === playback.frameIndex;
              return (
                <button
                  key={bucket.key}
                  type="button"
                  tabIndex={-1}
                  onClick={() => playback.seekFrame(bucket.index)}
                  aria-label={`Seek to frame starting ${formatUtcExact(bucket.start)}`}
                  title={`${formatUtcExact(bucket.start)} → ${formatUtcExact(bucket.endExclusive)}\n${plural(bucket.startCount, "incident")} start here (${bucket.startImpreciseCount} uncertain-time) · ${plural(bucket.activeCount, "active window membership", "active window memberships")}\n${bucket.startCriticalCount} critical starts · ${bucket.activeCorroboratedCount} corroborated active · click to seek`}
                  className={`relative min-w-0 flex-1 rounded-t-[2px] transition-colors ${selected ? "bg-white/[0.09] outline outline-1 outline-amber-200/72" : "bg-white/[0.025] hover:bg-white/[0.07]"}`}
                  style={{ height: `${scaledHeight}%`, opacity: bucket.startCount === 0 ? 0.34 : 1 }}
                >
                  <span className="flex h-full flex-col-reverse overflow-hidden rounded-t-[2px]">
                    <span className="block w-full bg-amber-300/58" style={{ height: `${preciseShare}%` }} />
                    <span className="block w-full bg-sky-300/48" style={{ height: `${impreciseShare}%` }} />
                  </span>
                  {bucket.startCriticalCount > 0 ? <span className="absolute inset-x-0 top-0 h-[3px] bg-red-400/90" /> : null}
                </button>
              );
            })}
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, analysis.frameCount - 1)}
            step={1}
            value={playback.frameIndex}
            onChange={(event) => playback.seekFrame(Number(event.target.value))}
            aria-label="Scrub incident playback frame"
            aria-valuetext={`Frame ${playback.frameIndex + 1} of ${analysis.frameCount}, ${formatUtcExact(frame.start)} to ${formatUtcExact(frame.endExclusive)} UTC, end exclusive`}
            className="mt-1.5 h-3 w-full cursor-ew-resize [accent-color:#e2b75e]"
          />

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <div className="flex overflow-hidden rounded-sm border border-white/10" role="group" aria-label="Playback transport controls">
              <button type="button" onClick={playback.jumpToStart} className="flex h-8 w-8 items-center justify-center bg-white/[0.025] text-white/48 transition hover:text-white/82" aria-label="Jump to first frame">
                <SkipBack className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => playback.stepFrames(-1)} className="flex h-8 w-8 items-center justify-center border-l border-white/10 bg-white/[0.025] text-white/48 transition hover:text-white/82" aria-label="Step one frame backward">
                <StepBack className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={playback.togglePlaying}
                aria-pressed={playback.playing}
                className={`flex h-8 w-9 items-center justify-center border-l border-white/10 transition ${playback.playing ? "bg-amber-300/[0.16] text-amber-100" : "bg-white/[0.025] text-white/58 hover:text-white"}`}
                aria-label={playback.playing ? "Pause incident playback" : "Play incident playback"}
              >
                {playback.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => playback.stepFrames(1)} className="flex h-8 w-8 items-center justify-center border-l border-white/10 bg-white/[0.025] text-white/48 transition hover:text-white/82" aria-label="Step one frame forward">
                <StepForward className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={playback.jumpToEnd} className="flex h-8 w-8 items-center justify-center border-l border-white/10 bg-white/[0.025] text-white/48 transition hover:text-white/82" aria-label="Jump to last frame">
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>

            <button type="button" onClick={playback.reset} className="flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 bg-white/[0.025] text-white/42 transition hover:text-white/76" aria-label="Reset playback to first frame and pause">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            <label className="flex h-8 items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.025] px-2 font-mono text-[9px] uppercase tracking-[0.11em] text-white/42">
              Speed
              <select
                value={playback.speedMultiplier}
                onChange={(event) => playback.setSpeedMultiplier(Number(event.target.value))}
                className="h-7 bg-transparent font-mono text-[10px] text-white/76 outline-none [&>option]:bg-[#080b09]"
                aria-label={`Playback speed; currently ${speedLabel}`}
              >
                {PLAYBACK_SPEED_OPTIONS.map((speed) => (
                  <option key={speed} value={speed}>{speed}×</option>
                ))}
              </select>
            </label>

            <label className="flex h-8 items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.025] px-2 font-mono text-[9px] uppercase tracking-[0.11em] text-white/42">
              Mode
              <select
                value={playback.mode}
                onChange={(event) => playback.setMode(event.target.value as PlaybackMode)}
                className="h-7 bg-transparent font-mono text-[10px] text-white/76 outline-none [&>option]:bg-[#080b09]"
                aria-label="Playback accumulation mode"
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>

            {playback.mode === "trailing" ? (
              <label className="flex h-8 items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.025] px-2 font-mono text-[9px] uppercase tracking-[0.11em] text-white/42">
                Trail
                <select
                  value={playback.trailHours}
                  onChange={(event) => playback.setTrailHours(Number(event.target.value))}
                  className="h-7 bg-transparent font-mono text-[10px] text-white/76 outline-none [&>option]:bg-[#080b09]"
                  aria-label={`Nominal trailing window; effective quantized window is ${formatDurationMs(effectiveTrailMs)}`}
                >
                  {PLAYBACK_TRAIL_OPTIONS_HOURS.map((hours) => (
                    <option key={hours} value={hours}>{formatDurationMs(hours * 60 * 60 * 1000)}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="flex h-8 items-center gap-1.5 rounded-sm border border-white/10 bg-white/[0.025] px-2 font-mono text-[9px] uppercase tracking-[0.11em] text-white/42">
              Time res
              <select
                value={playback.resolutionPreference}
                onChange={(event) => playback.setResolutionPreference(event.target.value as TemporalResolutionPreference)}
                className="h-7 bg-transparent font-mono text-[10px] text-white/76 outline-none [&>option]:bg-[#080b09]"
                aria-label={`Temporal aggregation resolution; actual resolution is ${resolution.label}`}
              >
                {RESOLUTION_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>

            <span className="rounded-sm border border-amber-200/12 bg-amber-300/[0.045] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-amber-100/56" title="Speed multiplies deterministic frame steps; at high speed multiple frames are committed per render tick rather than interpolated.">
              {speedLabel}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/38">
            <span>{plural(eventSummary.count, "incident")} in {modeLabel.toLowerCase()} view</span>
            <span className="text-sky-100/48">{plural(eventSummary.uncertainTimeCount, "uncertain-time window")}</span>
            <span>{plural(eventSummary.retainedReportCount, "retained report")}</span>
            <span className="text-emerald-200/52">{eventSummary.corroboratedCount} corroborated</span>
            <span className={eventSummary.contestedCount > 0 ? "text-orange-200/64" : ""}>{eventSummary.contestedCount} contested</span>
            {playback.mode === "trailing" ? <span>effective trail {formatDurationMs(effectiveTrailMs)} frame-quantized</span> : null}
          </div>

          {analysis.resolutionNotice ? (
            <p className="mt-1 font-mono text-[9px] uppercase leading-relaxed tracking-[0.1em] text-amber-100/52">
              {analysis.resolutionNotice}
            </p>
          ) : null}

          <div className="mt-1 space-y-0.5 font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.08em] text-white/30">
            <p>
              Filtered scope: {coverageText(analysis.coverage)} · {analysis.coverage.preciseCount.toLocaleString()} second-resolution · {analysis.coverage.impreciseCount.toLocaleString()} day/range uncertain{analysis.coverage.invalidTimeCount > 0 ? ` · ${analysis.coverage.invalidTimeCount.toLocaleString()} invalid-time excluded` : ""}
            </p>
            <p className="hidden sm:block">
              Loaded corpus: {coverageText(corpusCoverage)} · {plural(corpusCoverage.validEventCount, "canonical incident")} · longest uncertainty {formatDurationMs(corpusCoverage.longestUncertaintyMs)}
            </p>
          </div>

          <details className="mt-1 rounded-sm border border-white/8 bg-white/[0.018] px-2 py-1.5">
            <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/42">
              <Info className="h-3 w-3" /> Time semantics and keyboard controls
            </summary>
            <div className="mt-1.5 space-y-1 font-mono text-[9px] leading-relaxed tracking-[0.04em] text-white/38">
              <p>
                Exact-time records are assigned only to the frame containing their publisher timestamp. Day and multi-day records are uncertainty intervals: they can appear in every frame their source-supported window intersects, are rendered dimmer while the current frame intersects that unresolved window, and are never interpolated to invented times or positions.
              </p>
              <p>
                Histogram bars count each incident exactly once at its interval start; amber is second-resolution evidence and blue is day/range uncertainty. Tooltips separately report active interval memberships, so imprecise spillover is not mistaken for unique incident volume. Playback composes with the existing time-window, severity, category, theater, and search filters without rewriting them.
              </p>
              <p>
                Keyboard: T toggles playback, Space play/pause, ←/→ step frames, Shift+←/→ ten frames, Home/End jump, [ and ] change speed. Controls are native buttons, selects, and a range scrubber. Reduced-motion users are never autoplayed, and high-speed updates remain discrete frame commits.
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className="mt-3 rounded-sm border border-white/8 bg-white/[0.02] px-3 py-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/34">No incidents with valid source time remain in the filtered scope</p>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/24"> broaden the time window or filters; invalid timestamps are excluded rather than fabricated</p>
        </div>
      )}
    </section>
  );
}
