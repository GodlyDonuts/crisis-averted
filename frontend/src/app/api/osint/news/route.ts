import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "conflict";
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "8");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "hybridrel");

  try {
    const response = await fetch(url, { headers: { "User-Agent": "GodseyeOSINT/1.0" }, next: { revalidate: 300 } });
    if (!response.ok) return NextResponse.json({ articles: [], error: `GDELT ${response.status}` }, { status: 200 });
    const payload = await response.json() as { articles?: { title?: string; url?: string; domain?: string; seendate?: string }[] };
    return NextResponse.json({
      articles: (payload.articles ?? []).filter((a) => a.title && a.url).map((a) => ({
        title: a.title, url: a.url, source: a.domain || "GDELT", publishedAt: a.seendate || null,
      })),
    });
  } catch {
    return NextResponse.json({ articles: [], error: "News service unavailable" }, { status: 200 });
  }
}
