import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(root, 'frontend/public/data/osint-snapshot.json');
mkdirSync(dirname(outFile), { recursive: true });

async function getJson(url, timeout = 14000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GodseyeOSINT/1.0 (+https://github.com/GodlyDonuts/crisis-averted)', ...extraHeaders },
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function getText(url, timeout = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 GodseyeOSINT/1.0' } });
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseRssItems(xml, limit = 30) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map((match) => {
    const item = match[1];
    const pick = (tag) => { const start = item.indexOf(`<${tag}>`); const end = item.indexOf(`</${tag}>`, start); return start < 0 || end < 0 ? "" : decodeXml(item.slice(start + tag.length + 2, end).replace(/<!\[CDATA\[|\]\]>/g, "").trim()); };
    return { title: pick('title'), url: pick('link'), source: pick('source') || 'Google News', publishedAt: pick('pubDate') || null };
  }).filter((article) => article.title && article.url);
}

const result = { fetchedAt: new Date().toISOString(), sources: {}, militaryAircraft: [], news: [], launches: [], naturalEvents: [], gpsInterference: [], mapOfWarsEvents: [], webcams: [], errors: [] };

try {
  const payload = await getJson('https://api.adsb.lol/v2/mil');
  result.militaryAircraft = (payload.ac ?? [])
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .slice(0, 420)
    .map((a) => ({
      id: a.hex || `${a.lat}-${a.lon}`,
      callsign: (a.flight || 'MILITARY').trim(),
      registration: a.r || null,
      aircraftType: a.t || null,
      lat: a.lat,
      lng: a.lon,
      altitude: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      speed: typeof a.gs === 'number' ? a.gs : null,
      track: typeof a.track === 'number' ? a.track : null,
      squawk: a.squawk || null,
    }));
  result.sources.militaryAircraft = 'adsb.lol /v2/mil';
} catch (error) { result.errors.push(`adsb.lol: ${error.message}`); }

try {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', '(war OR conflict OR airstrike OR missile OR military)');
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('maxrecords', '30');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'hybridrel');
  const payload = await getJson(url);
  result.news = (payload.articles ?? []).filter((a) => a.title && a.url).map((a) => ({
    title: a.title,
    url: a.url,
    source: a.domain || 'GDELT',
    publishedAt: a.seendate || null,
  }));
  result.sources.news = 'GDELT DOC 2.0 artlist';
} catch (error) { result.errors.push(`GDELT: ${error.message}`); }

if (result.news.length === 0) {
  try {
    const xml = await getText('https://news.google.com/rss/search?q=war%20OR%20conflict%20OR%20airstrike%20OR%20missile&hl=en-US&gl=US&ceid=US:en');
    result.news = parseRssItems(xml, 30);
    result.sources.news = 'Google News RSS conflict query';
  } catch (error) { result.errors.push(`Google News RSS: ${error.message}`); }
}

try {
  const payload = await getJson('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=detailed', 26000);
  result.launches = (payload.results ?? []).map((launch) => ({
    id: launch.id,
    name: launch.name,
    provider: launch.launch_service_provider?.name || null,
    location: launch.pad?.location?.name || launch.pad?.name || null,
    lat: launch.pad?.latitude ? Number(launch.pad.latitude) : null,
    lng: launch.pad?.longitude ? Number(launch.pad.longitude) : null,
    net: launch.net || null,
    url: launch.url || null,
  })).filter((launch) => Number.isFinite(launch.lat) && Number.isFinite(launch.lng));
  result.sources.launches = 'Launch Library 2';
} catch (error) { result.errors.push(`Launch Library: ${error.message}`); }


try {
  const [eonet, usgs] = await Promise.all([
    getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40'),
    getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson'),
  ]);
  const eonetEvents = (eonet.events ?? []).map((event) => {
    const geometry = [...(event.geometry ?? [])].reverse().find((g) => Array.isArray(g.coordinates));
    if (!geometry) return null;
    const coords = geometry.type === 'Polygon' ? geometry.coordinates[0]?.[0] : geometry.coordinates;
    if (!Array.isArray(coords)) return null;
    return {
      id: event.id,
      title: event.title,
      category: event.categories?.[0]?.title || 'Natural event',
      kind: (event.categories?.[0]?.id || 'natural').toLowerCase(),
      lat: coords[1], lng: coords[0],
      occurredAt: geometry.date || null,
      magnitude: geometry.magnitudeValue || null,
      magnitudeUnit: geometry.magnitudeUnit || null,
      url: event.sources?.[0]?.url || event.link || null,
    };
  }).filter(Boolean);
  const earthquakes = (usgs.features ?? []).map((feature) => ({
    id: `usgs-${feature.id}`,
    title: feature.properties?.title || 'Significant earthquake',
    category: 'Earthquake', kind: 'earthquake',
    lat: feature.geometry?.coordinates?.[1], lng: feature.geometry?.coordinates?.[0],
    occurredAt: feature.properties?.time ? new Date(feature.properties.time).toISOString() : null,
    magnitude: feature.properties?.mag || null, magnitudeUnit: 'M',
    url: feature.properties?.url || null,
  })).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng));
  result.naturalEvents = [...earthquakes, ...eonetEvents].filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).slice(0, 70);
  result.sources.naturalEvents = 'NASA EONET + USGS significant earthquakes';
} catch (error) { result.errors.push(`Natural events: ${error.message}`); }


try {
  const payload = await getJson('https://mapofwars.org/api/events', 24000);
  result.mapOfWarsEvents = (payload.events ?? [])
    .filter((event) => ['battle', 'ship', 'outage', 'activation', 'launch'].includes(event.kind) && Number.isFinite(event.lat) && Number.isFinite(event.lon) && event.id && event.ts)
    .slice(0, 1800)
    .map((event) => ({
      id: event.id, kind: event.kind, lat: event.lat, lon: event.lon, title: event.title,
      detail: event.detail, level: event.level, ts: event.ts, source: event.source,
      note: event.note, url: event.url,
    }));
  result.sources.mapOfWars = 'Map of Wars public event lattice (build-time cache)';
} catch (error) { result.errors.push(`Map of Wars: ${error.message}`); }

try {
  const manifest = await getText('https://gpsjam.org/data/manifest.csv', 20000);
  const rows = manifest.trim().split(String.fromCharCode(10));
  const latestDate = rows[rows.length - 1].split(',')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate)) throw new Error('Unexpected gpsjam manifest');
  const csv = await getText(`https://gpsjam.org/data/${latestDate}-h3_4.csv`, 24000);
  result.gpsInterference = csv.trim().split(String.fromCharCode(10)).slice(1).map((line) => {
    const [hex, goodRaw, badRaw] = line.split(',');
    const good = Number(goodRaw), bad = Number(badRaw), total = good + bad;
    if (!hex || !Number.isFinite(total) || total < 3 || bad <= 0) return null;
    const affectedShare = bad / total;
    if (affectedShare < 0.02) return null;
    return {
      hex, goodAircraft: good, badAircraft: bad, aircraftCount: total, affectedShare,
      level: affectedShare > 0.1 ? 'high' : affectedShare > 0.04 ? 'medium' : 'low',
    };
  }).filter(Boolean).sort((a, b) => b.affectedShare - a.affectedShare).slice(0, 500);
  result.sources.gpsInterference = `gpsjam.org daily H3 interference (${latestDate})`;
} catch (error) { result.errors.push(`gpsjam.org: ${error.message}`); }

if (process.env.WINDY_WEBCAMS_KEY) {
  try {
    const regions = [
      [49.0, 32.0], [31.5, 34.8], [15.5, 32.5], [15.0, 43.0], [23.8, 121.0],
      [38.0, 127.5], [56.8, 24.5], [33.5, 44.3], [48.7, 44.5], [36.2, 37.1],
    ];
    const responses = await Promise.allSettled(regions.map(([lat, lng]) => getJson(
      `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lng},250&limit=12&include=categories,location,player,urls`,
      16000,
      { 'x-windy-api-key': process.env.WINDY_WEBCAMS_KEY },
    )));
    const unique = new Map();
    for (const response of responses) {
      if (response.status !== 'fulfilled') continue;
      for (const webcam of response.value.webcams ?? []) {
        const lat = webcam.location?.latitude, lng = webcam.location?.longitude;
        if (!webcam.webcamId || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        unique.set(String(webcam.webcamId), {
          id: String(webcam.webcamId), title: webcam.title || 'Public webcam', lat, lng,
          city: webcam.location?.city || null, region: webcam.location?.region || null,
          country: webcam.location?.country || null, status: webcam.status || null,
          categories: (webcam.categories ?? []).map((category) => category.name).filter(Boolean).slice(0, 3),
          detailUrl: webcam.urls?.detail || null, playerUrl: webcam.player?.day || webcam.player?.lifetime || null,
        });
      }
    }
    result.webcams = [...unique.values()].slice(0, 160);
    result.sources.webcams = 'Windy Webcams API v3 metadata (configure WINDY_WEBCAMS_KEY)';
  } catch (error) { result.errors.push(`Windy Webcams: ${error.message}`); }
}

writeFileSync(outFile, JSON.stringify(result));
console.log(`osint snapshot: ${result.militaryAircraft.length} aircraft, ${result.news.length} articles, ${result.launches.length} launches, ${result.naturalEvents.length} natural events, ${result.gpsInterference.length} gps interference cells, ${result.mapOfWarsEvents.length} map-of-wars events, ${result.webcams.length} webcams`);
