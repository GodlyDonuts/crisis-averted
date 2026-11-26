"use client";

import { X, Plane, Ship, ExternalLink } from "lucide-react";
import type { OsintAircraft, OsintVessel } from "@/types/conflict";
import { formatRelativeTime } from "@/lib/conflictData";

function Metric({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="border-b border-white/7 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">{label}</p>
      <p className="mt-0.5 text-xs text-white/76">{value == null || value === "" ? "Unavailable" : value}</p>
    </div>
  );
}

export function TransportDetailPanel({ aircraft, vessel, onClose }: { aircraft: OsintAircraft | null; vessel: OsintVessel | null; onClose: () => void }) {
  const subject = aircraft || vessel;
  if (!subject) return null;
  const isAircraft = Boolean(aircraft);
  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-4 left-3 right-3 z-40 max-h-[48dvh] overflow-y-auto xl:bottom-auto xl:left-auto xl:right-4 xl:top-[4.5rem] xl:w-[350px] xl:max-h-[calc(100dvh-6rem)]" role="complementary" aria-label={isAircraft ? "Aircraft detail" : "Vessel detail"}>
      <div className="flex items-start justify-between border-b border-white/8 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {isAircraft ? <Plane className="h-4.5 w-4.5 shrink-0 text-[#9fb7a8]" /> : <Ship className="h-4.5 w-4.5 shrink-0 text-[#7da6a1]" />}
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/34">{isAircraft ? aircraft?.operatorClass : vessel?.vesselClass}</p>
            <h2 className="truncate text-sm font-semibold text-white/90">{isAircraft ? aircraft?.callsign : vessel?.name}</h2>
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-sm border border-white/10 text-white/42 hover:text-white" aria-label="Close transport detail">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2">
        {isAircraft && aircraft ? (
          <>
            <Metric label="ICAO24" value={aircraft.id} />
            <Metric label="Origin" value={aircraft.originCountry} />
            <Metric label="Altitude" value={aircraft.altitude ? `${aircraft.altitude.toLocaleString()} ft` : null} />
            <Metric label="Speed" value={aircraft.speed ? `${aircraft.speed} kt` : null} />
            <Metric label="Track" value={aircraft.track != null ? `${Math.round(aircraft.track)}°` : null} />
            <Metric label="Vertical rate" value={aircraft.verticalRate != null ? `${aircraft.verticalRate} ft/min` : null} />
            <Metric label="Squawk" value={aircraft.squawk} />
            <Metric label="Last contact" value={aircraft.lastContact ? formatRelativeTime(Date.parse(aircraft.lastContact)) : null} />
          </>
        ) : vessel ? (
          <>
            <Metric label="MMSI" value={vessel.mmsi} />
            <Metric label="IMO" value={vessel.imo} />
            <Metric label="Call sign" value={vessel.callSign} />
            <Metric label="Destination" value={vessel.destination} />
            <Metric label="Speed" value={vessel.speed != null ? `${vessel.speed.toFixed(1)} kt` : null} />
            <Metric label="Course" value={vessel.course != null ? `${Math.round(vessel.course)}°` : null} />
            <Metric label="Status" value={vessel.navigationStatus} />
            <Metric label="Reported" value={vessel.timestamp ? formatRelativeTime(Date.parse(vessel.timestamp)) : null} />
          </>
        ) : null}
      </div>
      <div className="border-t border-white/8 px-4 py-3">
        <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-white/32">
          {isAircraft
            ? "OpenSky Network public state vector. Cargo/operator class is inferred from callsign and must be treated as unconfirmed."
            : "Fintraffic Digitraffic AIS. Coverage is regional to Finnish/Baltic waters; absence elsewhere is not evidence of no vessel traffic."}
        </p>
        {vessel && (
          <a href={`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${vessel.mmsi}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-100/62 hover:text-amber-50">
            External vessel lookup <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </aside>
  );
}
