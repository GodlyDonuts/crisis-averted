import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lng = request.nextUrl.searchParams.get("lng");
  const key = process.env.WINDY_WEBCAMS_KEY || process.env.NEXT_PUBLIC_WINDY_WEBCAMS_KEY;
  if (!lat || !lng) return NextResponse.json({ webcams: [], error: "Missing coordinates" });
  if (!key) return NextResponse.json({ webcams: [], configured: false, error: "Set WINDY_WEBCAMS_KEY for nearby webcam imagery" });

  const url = new URL("https://api.windy.com/webcams/api/v3/webcams");
  url.searchParams.set("nearby", `${lat},${lng},120`);
  url.searchParams.set("limit", "4");
  url.searchParams.set("include", "images,player,location");
  try {
    const response = await fetch(url, { headers: { "x-windy-api-key": key }, next: { revalidate: 300 } });
    if (!response.ok) return NextResponse.json({ webcams: [], configured: true, error: `Windy ${response.status}` });
    const payload = await response.json() as { webcams?: { webcamId?: number; title?: string; images?: { current?: { preview?: string } }; player?: { day?: { link?: string } } }[] };
    return NextResponse.json({ configured: true, webcams: (payload.webcams ?? []).map((cam) => ({
      id: cam.webcamId, title: cam.title || "Nearby webcam", image: cam.images?.current?.preview || null, link: cam.player?.day?.link || null,
    })).filter((cam) => cam.image || cam.link) });
  } catch {
    return NextResponse.json({ webcams: [], configured: true, error: "Webcam service unavailable" });
  }
}
