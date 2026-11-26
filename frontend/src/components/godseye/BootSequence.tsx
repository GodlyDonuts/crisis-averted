"use client";

import { useEffect, useState } from "react";
import { Crosshair } from "lucide-react";

interface BootSequenceProps {
  loading: boolean;
  source: "live" | "fallback" | null;
}

const BOOT_LINES = [
  "LOADING PUBLIC INCIDENT REPORTS",
  "PREPARING WEBGL GLOBE RENDERER",
  "LOADING CACHED OSINT SNAPSHOT",
  "VALIDATING GEOSPATIAL ACCELERATOR",
];

export default function BootSequence({ loading, source }: BootSequenceProps) {
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumElapsed(true), 2100);
    return () => window.clearTimeout(timer);
  }, []);

  if (dismissed || (minimumElapsed && !loading)) return null;

  return (
    <button
      type="button"
      onClick={() => setDismissed(true)}
      className="absolute inset-0 z-[80] flex cursor-pointer items-center justify-center bg-[#01040a]/88 backdrop-blur-md"
      aria-label="Skip initialization sequence"
    >
      <div className="relative flex w-[min(520px,calc(100vw-3rem))] flex-col items-center px-6 py-8 text-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-amber-200/12" />
          <span className="godseye-reticle absolute inset-2 rounded-full border border-amber-200/30" />
          <span className="absolute inset-6 rounded-full border border-red-300/20" />
          <Crosshair className="h-9 w-9 text-amber-100/78" strokeWidth={1.3} />
        </div>
        <h2 className="mt-5 font-mono text-lg font-semibold uppercase tracking-[0.36em] text-white">God&apos;s Eye</h2>
        <p className="mt-2 px-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.18em] sm:text-[10px] sm:tracking-[0.28em] text-amber-100/38">Public OSINT common operating picture</p>
        <div className="mt-7 w-full space-y-2 text-left font-mono text-[9px] uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-[0.18em]">
          {BOOT_LINES.map((line, index) => {
            const active = loading || !source ? index < 3 : true;
            return (
              <div key={line} className="flex items-center justify-between border-b border-white/6 pb-2 text-white/42">
                <span className="min-w-0 pr-3">{line}</span>
                <span className={`shrink-0 ${active ? "text-amber-200/75" : "text-white/20"}`}>{active ? "SYNC" : "WAIT"}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.2em] text-white/22">Click anywhere to bypass initialization</p>
      </div>
    </button>
  );
}
