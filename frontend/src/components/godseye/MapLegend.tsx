import { HandHeart, Plane, Radar, Ship, Signal, Leaf, Newspaper, Circle } from "lucide-react";
import { SEVERITY_META } from "@/lib/conflictData";

export function MapLegend() {
  return (
    <aside className="godseye-panel pointer-events-auto absolute bottom-[104px] left-4 z-30 hidden w-52 px-3 py-2.5 xl:block" aria-label="Map legend">
      <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber-100/42">Legend</p>
      <div className="mt-2 space-y-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-white/48">
        {Object.values(SEVERITY_META).map((severity) => (
          <div key={severity.label} className="flex items-center gap-2">
            <Circle className="h-2.5 w-2.5 fill-current" style={{ color: severity.color }} />
            <span>{severity.label} report</span>
          </div>
        ))}
        <div className="flex items-center gap-2 text-[#b8c29a]">
          <Plane className="h-3 w-3" />
          <span>Military aircraft</span>
        </div>
        <div className="flex items-center gap-2 text-[#9fb7a8]">
          <Radar className="h-3 w-3" />
          <span>Civil aviation</span>
        </div>
        <div className="flex items-center gap-2 text-[#7da6a1]">
          <Ship className="h-3 w-3" />
          <span>AIS vessels</span>
        </div>
        <div className="flex items-center gap-2 text-orange-200/78">
          <Signal className="h-3 w-3" />
          <span>GNSS interference</span>
        </div>
        <div className="flex items-center gap-2 text-emerald-200/72">
          <Leaf className="h-3 w-3" />
          <span>Environmental</span>
        </div>
        <div className="flex items-center gap-2 text-[#9fb0c9]" title="Places mentioned in news text near automated conflict-theme tags — media attention, never verified incidents">
          <Newspaper className="h-3 w-3" />
          <span>Geo news mentions</span>
        </div>
        <div className="flex items-center gap-2 text-[#7dd8d0]" title="ReliefWeb humanitarian disaster/report metadata at symbolic country centroids — never verified incident points">
          <HandHeart className="h-3 w-3" />
          <span>ReliefWeb metadata</span>
        </div>
      </div>
    </aside>
  );
}
