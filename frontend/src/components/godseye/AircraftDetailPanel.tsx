"use client";

import { Plane, X } from "lucide-react";
import type { MilitaryAircraft } from "@/types/conflict";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</p>
      <p className="mt-1 font-mono text-sm text-white/82">{value}</p>
    </div>
  );
}

export function AircraftDetailPanel({ aircraft, onClose }: { aircraft: MilitaryAircraft; onClose: () => void }) {
  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-[172px] right-4 top-20 z-40 hidden w-[344px] flex-col overflow-hidden xl:flex">
      <div className="border-b border-white/8 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#b8c29a]">
              <Plane className="h-4 w-4" /> Military aircraft
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white/94">{aircraft.callsign}</h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-white/36">
              {aircraft.aircraftType || "Unknown type"} {aircraft.registration ? `· ${aircraft.registration}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-white/45 hover:text-white" aria-label="Close aircraft detail">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Altitude" value={aircraft.altitude ? `${aircraft.altitude.toLocaleString()} ft` : "Unknown"} />
          <Metric label="Ground speed" value={aircraft.speed ? `${Math.round(aircraft.speed)} kt` : "Unknown"} />
          <Metric label="Track" value={aircraft.track !== null ? `${Math.round(aircraft.track)}°` : "Unknown"} />
          <Metric label="Squawk" value={aircraft.squawk || "None"} />
          <Metric label="Latitude" value={`${aircraft.lat.toFixed(4)}°`} />
          <Metric label="Longitude" value={`${aircraft.lng.toFixed(4)}°`} />
        </div>
        <div className="rounded-sm border border-white/8 bg-white/[0.022] p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/34">Track interpretation</p>
          <p className="mt-2 text-sm leading-relaxed text-white/58">
            Position and vector derive from the latest public ADS-B military aircraft snapshot. The projected line estimates current heading over a short horizon; it is not a confirmed flight plan or operational intent.
          </p>
        </div>
        <a href="https://www.adsb.lol/" target="_blank" rel="noreferrer" className="block rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5 text-sm text-white/58 hover:text-white/88">
          Open ADSB.lol public aircraft network
        </a>
      </div>
    </aside>
  );
}
