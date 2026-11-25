"use client";

import { Camera, ExternalLink, Newspaper } from "lucide-react";
import type { ConflictEvent } from "@/types/conflict";
import { useOsintSnapshot } from "@/hooks/useOsintSnapshot";

export function RegionalIntel({ event }: { event: ConflictEvent }) {
  const snapshot = useOsintSnapshot();
  const terms = [event.country, event.conflict].filter(Boolean).map((term) => term.toLowerCase());
  const regional = snapshot.news.filter((article) => terms.some((term) => article.title.toLowerCase().includes(term)));
  const articles = (regional.length > 0 ? regional : snapshot.news).slice(0, 4);

  return (
    <section className="mt-4 border-t border-white/8 pt-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
        <Newspaper className="h-3.5 w-3.5" /> Regional media access
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

      <div className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
        <Camera className="h-3.5 w-3.5" /> Visual access
      </div>
      <div className="mt-2 grid gap-2">
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
