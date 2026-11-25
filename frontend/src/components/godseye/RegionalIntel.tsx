"use client";

import { useEffect, useState } from "react";
import { Camera, ExternalLink, Newspaper } from "lucide-react";
import type { ConflictEvent } from "@/types/conflict";

interface Article { title: string; url: string; source: string; publishedAt: string | null }
interface Webcam { id?: number; title: string; image: string | null; link: string | null }

export function RegionalIntel({ event }: { event: ConflictEvent }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [webcams, setWebcams] = useState<Webcam[]>([]);
  const [status, setStatus] = useState("Scanning regional intelligence…");

  useEffect(() => {
    let cancelled = false;
    const query = encodeURIComponent(`${event.country} AND (war OR conflict OR attack OR military OR explosion)`);
    const scan = window.setTimeout(() => {
      setArticles([]); setWebcams([]); setStatus("Scanning regional intelligence…");
      Promise.allSettled([
        fetch(`/api/osint/news?q=${query}`).then((r) => r.json()),
        fetch(`/api/osint/webcams?lat=${event.lat}&lng=${event.lng}`).then((r) => r.json()),
      ]).then(([news, cams]) => {
        if (cancelled) return;
        if (news.status === "fulfilled") setArticles(news.value.articles ?? []);
        if (cams.status === "fulfilled") setWebcams(cams.value.webcams ?? []);
        setStatus("");
      });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(scan); };
  }, [event]);

  return (
    <section className="mt-4 border-t border-white/8 pt-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
        <Newspaper className="h-3.5 w-3.5" /> Regional media access
      </div>
      {status ? <p className="mt-2 text-sm text-white/38">{status}</p> : null}
      <div className="mt-2 space-y-2">
        {articles.slice(0, 4).map((article) => (
          <a key={article.url} href={article.url} target="_blank" rel="noreferrer" className="group block rounded-sm border border-white/8 bg-white/[0.022] px-3 py-2.5 hover:border-amber-200/25">
            <span className="line-clamp-2 text-sm leading-snug text-white/72 group-hover:text-white/92">{article.title}</span>
            <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.14em] text-white/28">{article.source}</span>
          </a>
        ))}
        {articles.length === 0 && !status ? <p className="text-sm text-white/34">No live regional articles available from the public news endpoint.</p> : null}
      </div>

      <div className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-white/34">
        <Camera className="h-3.5 w-3.5" /> Nearby visual access
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {webcams.slice(0, 4).map((cam) => (
          <a key={cam.id ?? cam.title} href={cam.link ?? cam.image ?? "#"} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-sm border border-white/8 bg-white/[0.025]">
            {cam.image ? <img src={cam.image} alt={cam.title} className="aspect-video w-full object-cover opacity-80 transition group-hover:opacity-100" /> : null}
            <span className="block truncate px-2 py-1.5 text-[11px] text-white/56">{cam.title}</span>
          </a>
        ))}
      </div>
      {webcams.length === 0 && !status ? (
        <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`live webcam ${event.country}`)}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-between rounded-sm border border-white/8 bg-white/[0.025] px-3 py-2.5 text-sm text-white/58 hover:text-white/88">
          Open live-camera search <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </section>
  );
}
