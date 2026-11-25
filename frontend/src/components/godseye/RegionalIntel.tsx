"use client";

import { Camera, ExternalLink, Newspaper, Satellite } from "lucide-react";
import type { ConflictEvent, OsintSnapshot } from "@/types/conflict";

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function RegionalIntel({ event, snapshot }: { event: ConflictEvent; snapshot: OsintSnapshot }) {
  const countryTerm = event.country.toLowerCase();
  const conflictTerms = event.conflict.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 4).slice(0, 4);
  const scoredArticles = snapshot.news.map((article) => {
    const haystack = `${article.title} ${article.source}`.toLowerCase();
    let score = 0;
    if (countryTerm.length > 3 && haystack.includes(countryTerm)) score += 5;
    for (const term of conflictTerms) if (haystack.includes(term)) score += 2;
    return { article, score };
  });
  const regionalArticles = scoredArticles.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).map((entry) => entry.article);
  const usingRegionalArticles = regionalArticles.length > 0;
  const articles = (usingRegionalArticles ? regionalArticles : snapshot.news).slice(0, usingRegionalArticles ? 4 : 2);

  const nearbyWebcams = snapshot.webcams
    .map((webcam) => ({ webcam, distance: distanceKm(event.lat, event.lng, webcam.lat, webcam.lng) }))
    .filter((entry) => entry.distance < 350)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  return (
    <section className="mt-4 border-t border-white/8 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
          <Newspaper className="h-3.5 w-3.5" /> Regional media access
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/24">
          {usingRegionalArticles ? "location matched" : "global context"}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {articles.length > 0 ? articles.map((article) => (
          <a key={article.url} href={article.url} target="_blank" rel="noreferrer" className="group block rounded-sm border border-white/8 bg-white/[0.022] px-3 py-2.5 hover:border-amber-200/25">
            <span className="line-clamp-2 text-sm leading-snug text-white/72 group-hover:text-white/92">{article.title}</span>
            <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-white/28">{article.source}</span>
          </a>
        )) : (
          <p className="text-sm text-white/34">Regional articles will appear after the next intelligence snapshot refresh.</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
          <Camera className="h-3.5 w-3.5" /> Visual access
        </div>
        {nearbyWebcams.length > 0 && <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-amber-100/38">{nearbyWebcams.length} nearby</span>}
      </div>

      {nearbyWebcams.length > 0 && (
        <div className="mt-2 space-y-2">
          {nearbyWebcams.map(({ webcam, distance }) => (
            <a key={webcam.id} href={webcam.detailUrl || webcam.playerUrl || undefined} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-3 rounded-sm border border-white/8 bg-white/[0.024] px-3 py-2.5 hover:border-amber-200/25">
              <span className="min-w-0">
                <span className="block truncate text-sm text-white/72 group-hover:text-white/92">{webcam.title}</span>
                <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/28">
                  {[webcam.city, webcam.region, webcam.country].filter(Boolean).join(" · ")} · {Math.round(distance)} km
                </span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/26 group-hover:text-amber-100/70" />
            </a>
          ))}
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/24">Camera metadata provided by Windy Webcams</p>
        </div>
      )}

      <div className="mt-2 grid gap-2">
        <a href={`https://www.google.com/maps/@?api=1&map_action=map&center=${event.lat},${event.lng}&zoom=8&basemap=satellite`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5 text-sm text-white/58 hover:text-white/88">
          <span className="inline-flex items-center gap-2"><Satellite className="h-3.5 w-3.5" /> Satellite map access</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`live webcam ${event.country}`)}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5 text-sm text-white/58 hover:text-white/88">
          Live camera search <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={`https://news.google.com/search?q=${encodeURIComponent(`${event.country} conflict`)}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5 text-sm text-white/58 hover:text-white/88">
          Regional news search <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </section>
  );
}
