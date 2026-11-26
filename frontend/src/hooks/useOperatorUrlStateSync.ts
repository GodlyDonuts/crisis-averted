"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeOperatorUrlState,
  parseOperatorUrlState,
  type OperatorUrlState,
} from "@/lib/operatorUrlState";

export interface OperatorUrlApplyContext {
  reason: "initial" | "hashchange";
  recognized: boolean;
  valid: boolean;
  issues: string[];
}

export interface OperatorShareFeedback {
  kind: "copied" | "error";
  message: string;
}

interface UseOperatorUrlStateSyncOptions {
  /** Applies a decoded workspace snapshot. Must be resilient to being called after mount. */
  applyState: (state: OperatorUrlState, context: OperatorUrlApplyContext) => void;
  /** Builds the latest workspace snapshot at write time; refs are permitted for non-rendering camera state. */
  buildState: () => OperatorUrlState;
  /** Optional truthfulness gate. While it returns false, inbound state is never overwritten by a partially restored workspace. */
  canSync?: () => boolean;
}

const MINIMUM_WRITE_INTERVAL_MS = 800;
const IDLE_WRITE_DELAY_MS = 180;

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.insetInlineStart = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard fallback was rejected");
}

/**
 * Hash-based URL synchronization for the static command center.
 *
 * The synchronizer deliberately uses `history.replaceState` only. Operator controls
 * therefore never fill the session history with hundreds of filter/playback/camera
 * entries, and the browser Back button keeps its normal document-navigation meaning.
 * Writes are throttled with a trailing update: continuous playback or camera motion
 * cannot create a render/write feedback loop, while the copy control always forces
 * one synchronous write before reading the final permalink.
 */
export function useOperatorUrlStateSync({ applyState, buildState, canSync }: UseOperatorUrlStateSyncOptions) {
  const applyStateRef = useRef(applyState);
  const buildStateRef = useRef(buildState);
  const canSyncRef = useRef(canSync);
  const readyRef = useRef(false);
  const writeTimerRef = useRef<number | null>(null);
  const writeNowRef = useRef<(() => boolean) | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const lastWriteAtRef = useRef(-100_000);
  const [shareFeedback, setShareFeedback] = useState<OperatorShareFeedback | null>(null);
  const [urlNotice, setUrlNotice] = useState<string | null>(null);

  useEffect(() => {
    applyStateRef.current = applyState;
    buildStateRef.current = buildState;
    canSyncRef.current = canSync;
  });

  const writeNow = useCallback((): boolean => {
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (!readyRef.current || typeof window === "undefined") return false;

    if (canSyncRef.current && !canSyncRef.current()) {
      // A shared link must never be overwritten by half-restored state (for example,
      // playback frame zero while the requested frame is still being resolved). Retry
      // at a small bounded cadence; restoration completion or user interaction will
      // already be causing renders that keep the callback refs current.
      writeTimerRef.current = window.setTimeout(() => {
        writeTimerRef.current = null;
        writeNowRef.current?.();
      }, 250);
      return false;
    }

    const fragment = encodeOperatorUrlState(buildStateRef.current());
    if (!fragment) return false;
    const nextHash = `#${fragment}`;
    if (window.location.hash !== nextHash) {
      // Preserve the existing path, query, and history state verbatim. This is what
      // makes the mechanism safe beneath a GitHub Pages basePath/static export.
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${nextHash}`,
      );
    }
    lastWriteAtRef.current = performance.now();
    return true;
  }, []);

  useEffect(() => {
    writeNowRef.current = writeNow;
  }, [writeNow]);

  const scheduleSync = useCallback(() => {
    if (!readyRef.current || writeTimerRef.current !== null) return;
    const sinceLastWrite = performance.now() - lastWriteAtRef.current;
    const delay = sinceLastWrite >= MINIMUM_WRITE_INTERVAL_MS
      ? IDLE_WRITE_DELAY_MS
      : Math.max(220, MINIMUM_WRITE_INTERVAL_MS - sinceLastWrite);
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = null;
      writeNow();
    }, delay);
  }, [writeNow]);

  useEffect(() => {
    const showUrlNotice = (message: string | null) => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      setUrlNotice(message);
      if (message) {
        noticeTimerRef.current = window.setTimeout(() => {
          noticeTimerRef.current = null;
          setUrlNotice(null);
        }, 7000);
      }
    };

    const restoreFromLocation = (reason: OperatorUrlApplyContext["reason"]) => {
      const parsed = parseOperatorUrlState(window.location.hash, window.location.search);
      applyStateRef.current(parsed.state, {
        reason,
        recognized: parsed.recognized,
        valid: parsed.valid,
        issues: parsed.issues,
      });
      if (!parsed.valid) {
        showUrlNotice("The shared-state link was malformed or unsupported, so the safe default workspace was restored.");
      } else {
        showUrlNotice(null);
      }
    };

    restoreFromLocation("initial");
    readyRef.current = true;
    scheduleSync();

    const onHashChange = () => {
      restoreFromLocation("hashchange");
      scheduleSync();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    };
  }, [scheduleSync]);

  const copyPermalink = useCallback(async () => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }

    if (!writeNow()) {
      setShareFeedback({
        kind: "error",
        message: "Workspace state is still being restored safely or cannot be encoded yet. Try again in a moment.",
      });
    } else {
      try {
        await copyTextToClipboard(window.location.href);
        setShareFeedback({
          kind: "copied",
          message: "Permalink copied. It restores public view, filters, panels, playback frame, and camera when drift is paused; secret-like search text is withheld.",
        });
      } catch {
        setShareFeedback({
          kind: "error",
          message: "Copy failed. The address-bar URL already contains the same public state hash; copy it manually.",
        });
      }
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setShareFeedback(null);
    }, 5200);
  }, [writeNow]);

  useEffect(() => () => {
    if (writeTimerRef.current !== null) window.clearTimeout(writeTimerRef.current);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  return {
    scheduleSync,
    writeNow,
    copyPermalink,
    shareFeedback,
    urlNotice,
  };
}
