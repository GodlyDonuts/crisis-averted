import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const IODA_EVENTS_API_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events';
const IODA_API_BASE_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
const IODA_ENTITY_TYPES = ['country', 'region'];
const IODA_LOOKBACK_SECONDS = 24 * 60 * 60;
const IODA_EXTEND_WINDOW_SECONDS = 24 * 60 * 60;
const IODA_PAGE_LIMIT = 1000;
const IODA_MAX_PAGES_PER_ENTITY_TYPE = 3;
const IODA_REFERENCE_FILE = join(root, 'scripts', 'natural-earth-reference-points.json');
const IODA_LIMITATIONS = 'IODA detections describe macroscopic Internet connectivity change, not causal attribution, intent, a proven shutdown, or the connectivity of any particular user or facility. Coordinates are broad Natural Earth reference placements rather than outage origins or spatial footprints. An empty result is not an all-clear; an end equal to the query horizon is clipped/ambiguous and establishes neither recovery nor continuing outage.';

function unixSecondsToIso(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function createIodaQueryWindow() {
  const until = Math.floor(Date.now() / 1000);
  const from = until - IODA_LOOKBACK_SECONDS;
  return {
    from,
    until,
    fromIso: unixSecondsToIso(from),
    untilIso: unixSecondsToIso(until),
    lookbackSeconds: IODA_LOOKBACK_SECONDS,
    extendWindowSeconds: IODA_EXTEND_WINDOW_SECONDS,
  };
}

function createIodaUnavailableMeta(queryWindow) {
  return {
    status: 'unavailable',
    provider: 'Georgia Tech Internet Outage Detection and Analysis (IODA)',
    apiBaseUrl: IODA_API_BASE_URL,
    queryWindow,
    entityTypes: [...IODA_ENTITY_TYPES],
    format: 'ioda',
    overall: false,
    includeAlerts: false,
    pageLimit: IODA_PAGE_LIMIT,
    maxPagesPerEntityType: IODA_MAX_PAGES_PER_ENTITY_TYPE,
    fetchedEventCount: 0,
    countryEventCount: 0,
    regionEventCount: 0,
    geolocatedEventCount: 0,
    omittedEventCount: 0,
    omittedByReason: {
      invalidEventContract: 0,
      missingCoordinateReference: 0,
    },
    requestUrls: [],
    coordinateReference: 'Natural Earth v5.1.2 country label coordinates and admin-1 reference latitude/longitude attributes',
    caveat: IODA_LIMITATIONS,
  };
}

function buildIodaEventsUrl(entityType, queryWindow, page) {
  const url = new URL(IODA_EVENTS_API_URL);
  url.searchParams.set('from', String(queryWindow.from));
  url.searchParams.set('until', String(queryWindow.until));
  url.searchParams.set('entityType', entityType);
  url.searchParams.set('format', 'ioda');
  url.searchParams.set('overall', 'false');
  url.searchParams.set('includeAlerts', 'false');
  url.searchParams.set('orderBy', 'time/desc');
  url.searchParams.set('limit', String(IODA_PAGE_LIMIT));
  url.searchParams.set('page', String(page));
  url.searchParams.set('extendWindow', String(IODA_EXTEND_WINDOW_SECONDS));
  return url;
}

async function fetchIodaEntityEvents(entityType, queryWindow) {
  const events = [];
  const requestUrls = [];
  for (let page = 0; page < IODA_MAX_PAGES_PER_ENTITY_TYPE; page += 1) {
    const url = buildIodaEventsUrl(entityType, queryWindow, page);
    requestUrls.push(url.toString());
    const payload = await getJson(url, 26000);
    if (payload.error) throw new Error(`IODA ${entityType} page ${page}: ${payload.error}`);
    if (payload.type !== 'outages.events' || !Array.isArray(payload.data)) throw new Error(`IODA ${entityType} page ${page}: unexpected response contract`);
    events.push(...payload.data);
    if (payload.data.length < IODA_PAGE_LIMIT) break;
  }
  return { events, requestUrls };
}

function loadNaturalEarthReferencePoints() {
  const payload = JSON.parse(readFileSync(IODA_REFERENCE_FILE, 'utf8'));
  if (payload.schemaVersion !== 1 || !payload.countries || !payload.regions) throw new Error('Natural Earth reference-point file has an unexpected contract');
  return payload;
}

function validIodaEventContract(event, entityType) {
  return Boolean(
    event &&
    typeof event === 'object' &&
    event.entity?.type === entityType &&
    typeof event.entity.code === 'string' && event.entity.code.length > 0 &&
    typeof event.entity.name === 'string' && event.entity.name.length > 0 &&
    Number.isInteger(event.from) && event.from > 0 &&
    Number.isInteger(event.until) && event.until > 0 &&
    event.from <= event.until &&
    Number.isFinite(event.score) && event.score >= 0 &&
    (event.datasource == null || typeof event.datasource === 'string') &&
    (event.method == null || typeof event.method === 'string')
  );
}

function resolveIodaCoordinates(event, referencePoints) {
  if (event.entity.type === 'country') {
    const reference = referencePoints.countries[event.entity.code];
    if (!reference) return null;
    return {
      lat: reference.lat,
      lng: reference.lng,
      coordinatePrecision: 'country-reference',
      coordinateNote: 'Country-scope IODA detection plotted at a Natural Earth cartographic reference point. This is symbolic country-level placement, not an outage origin, asset location, centroid of impact, or spatial footprint.',
    };
  }

  const regionId = event.entity.attrs?.ne_region_id == null ? null : String(event.entity.attrs.ne_region_id);
  const reference = regionId ? referencePoints.regions[regionId] : null;
  if (!reference) return null;
  return {
    lat: reference.lat,
    lng: reference.lng,
    coordinatePrecision: 'region-reference',
    coordinateNote: 'Region-scope IODA detection plotted at a Natural Earth admin-1 reference coordinate. This is broad regional placement, not an outage origin, asset location, centroid of impact, or spatial footprint.',
    naturalEarthRegionId: regionId,
  };
}

function normalizeIodaOutageEvent(event, queryWindow, referencePoints) {
  const coordinates = resolveIodaCoordinates(event, referencePoints);
  if (!coordinates) return null;
  const attrs = event.entity.attrs ?? {};
  const countryCode = event.entity.type === 'country'
    ? event.entity.code
    : typeof attrs.country_code === 'string' ? attrs.country_code : null;
  const countryName = event.entity.type === 'country'
    ? event.entity.name
    : typeof attrs.country_name === 'string' ? attrs.country_name : null;
  return {
    entityType: event.entity.type,
    entityCode: event.entity.code,
    entityName: event.entity.name,
    countryCode,
    countryName,
    naturalEarthRegionId: coordinates.naturalEarthRegionId ?? null,
    lat: coordinates.lat,
    lng: coordinates.lng,
    coordinatePrecision: coordinates.coordinatePrecision,
    coordinateNote: coordinates.coordinateNote,
    from: event.from,
    until: event.until,
    score: event.score,
    datasource: event.datasource ?? null,
    method: event.method ?? null,
    fromBeforeQueryWindow: event.from < queryWindow.from,
    untilEqualsQueryHorizon: event.until === queryWindow.until,
  };
}

async function collectIodaOutages(queryWindow) {
  const referencePoints = loadNaturalEarthReferencePoints();
  const requestUrls = [];
  const rawEvents = [];
  const perTypeCounts = { country: 0, region: 0 };

  for (const entityType of IODA_ENTITY_TYPES) {
    const pageResult = await fetchIodaEntityEvents(entityType, queryWindow);
    rawEvents.push(...pageResult.events.map((event) => ({ entityType, event })));
    perTypeCounts[entityType] = pageResult.events.length;
    requestUrls.push(...pageResult.requestUrls);
  }

  let invalidEventContract = 0;
  let missingCoordinateReference = 0;
  const outages = [];
  for (const { entityType, event } of rawEvents) {
    if (!validIodaEventContract(event, entityType)) {
      invalidEventContract += 1;
      continue;
    }
    const outage = normalizeIodaOutageEvent(event, queryWindow, referencePoints);
    if (!outage) {
      missingCoordinateReference += 1;
      continue;
    }
    outages.push(outage);
  }

  return {
    outages,
    meta: {
      ...createIodaUnavailableMeta(queryWindow),
      status: 'ok',
      fetchedEventCount: rawEvents.length,
      countryEventCount: perTypeCounts.country,
      regionEventCount: perTypeCounts.region,
      geolocatedEventCount: outages.length,
      omittedEventCount: invalidEventContract + missingCoordinateReference,
      omittedByReason: {
        invalidEventContract,
        missingCoordinateReference,
      },
      requestUrls,
    },
  };
}

let previousSnapshot = {};
try { if (existsSync(outFile)) previousSnapshot = JSON.parse(readFileSync(outFile, 'utf8')); } catch {}

const iodaQueryWindow = createIodaQueryWindow();
const result = { fetchedAt: new Date().toISOString(), sources: {}, militaryAircraft: [], aircraft: [], vessels: [], satellites: [], news: [], launches: [], naturalEvents: [], gpsInterference: [], mapOfWarsEvents: [], webcams: [], cyberVulnerabilities: [], internetOutages: [], internetOutageMeta: createIodaUnavailableMeta(iodaQueryWindow), errors: [] };

try {
  const ioda = await collectIodaOutages(iodaQueryWindow);
  result.internetOutages = ioda.outages;
  result.internetOutageMeta = ioda.meta;
  result.sources.internetOutages = `IODA v2 outage events (country/region, explicit Unix-second window ${iodaQueryWindow.from}-${iodaQueryWindow.until}) + Natural Earth reference coordinates`;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(`IODA: ${message}`);
  if (previousSnapshot.internetOutageMeta && Array.isArray(previousSnapshot.internetOutages)) {
    result.internetOutages = previousSnapshot.internetOutages;
    result.internetOutageMeta = {
      ...previousSnapshot.internetOutageMeta,
      status: 'preserved',
      preservedAt: result.fetchedAt,
      statusDetail: `Transient IODA/ingestion failure; prior snapshot retained. ${message}`,
    };
    result.sources.internetOutages = 'IODA v2 outage events (prior build-time snapshot preserved after transient ingestion failure)';
    result.errors.push('internetOutages: transient failure; preserved previous snapshot');
  } else {
    result.internetOutageMeta = {
      ...createIodaUnavailableMeta(iodaQueryWindow),
      statusDetail: message,
    };
    result.sources.internetOutages = 'IODA v2 outage events unavailable during build';
  }
}

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


function shipTypeLabel(type) {
  if (type >= 70 && type < 80) return 'Cargo';
  if (type >= 80 && type < 90) return 'Tanker';
  if (type >= 60 && type < 70) return 'Passenger';
  if (type === 35) return 'Military / government';
  if (type === 55) return 'Law enforcement';
  if (type === 51) return 'Search and rescue';
  if (type === 52 || type === 31 || type === 32) return 'Tug / towing';
  if (type === 30) return 'Fishing';
  if (type >= 40 && type < 50) return 'High-speed craft';
  return type ? `AIS type ${type}` : 'Unspecified vessel';
}

function navigationStatusLabel(status) {
  return {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted maneuverability',
    4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
    11: 'Power-driven vessel towing astern', 12: 'Power-driven vessel pushing ahead', 14: 'AIS-SART active', 15: 'Undefined',
  }[status] || 'Unknown status';
}

function inferAircraftOperatorClass(callsign) {
  const prefix = (callsign || '').trim().slice(0, 3).toUpperCase();
  if (['FDX', 'UPS', 'CLX', 'GTI', 'CKS', 'ABX', 'ATN', 'BCS', 'DHK', 'GEC', 'CKK', 'CAO', 'RUN', 'NCA', 'ANA'].includes(prefix)) return 'cargo-inferred';
  if (/^(RCH|REACH|CFC|RRR|ASY|AFD|BAF|GAF|IAM|MMF|NATO|UAF|PLF|SVF|TUAF)/.test((callsign || '').trim().toUpperCase())) return 'military/government-inferred';
  return 'civil/commercial';
}

try {
  const payload = await getJson('https://opensky-network.org/api/states/all', 32000);
  const militaryHexes = new Set(result.militaryAircraft.map((aircraft) => String(aircraft.id).toLowerCase()));
  result.aircraft = (payload.states ?? [])
    .filter((state) => state[5] != null && state[6] != null && state[8] !== true)
    .filter((state) => !militaryHexes.has(String(state[0]).toLowerCase()))
    .sort((a, b) => (Number(b[7]) || 0) - (Number(a[7]) || 0))
    .slice(0, 1200)
    .map((state) => {
      const callsign = (state[1] || 'UNKNOWN').trim() || 'UNKNOWN';
      return {
        id: String(state[0]),
        callsign,
        originCountry: state[2] || null,
        lat: state[6],
        lng: state[5],
        altitude: typeof state[7] === 'number' ? Math.round(state[7] * 3.28084) : null,
        speed: typeof state[9] === 'number' ? Math.round(state[9] * 1.94384) : null,
        track: typeof state[10] === 'number' ? state[10] : null,
        verticalRate: typeof state[11] === 'number' ? Math.round(state[11] * 196.85) : null,
        squawk: state[14] || null,
        operatorClass: inferAircraftOperatorClass(callsign),
        lastContact: state[4] ? new Date(state[4] * 1000).toISOString() : null,
      };
    });
  result.sources.aircraft = 'OpenSky Network live state vectors (anonymous public snapshot)';
} catch (error) { result.errors.push(`OpenSky: ${error.message}`); }


async function collectAisStreamVessels(apiKey) {
  if (!apiKey || typeof WebSocket !== 'function') return [];
  return new Promise((resolve) => {
    const vessels = new Map();
    const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const finish = () => {
      try { socket.close(); } catch {}
      resolve([...vessels.values()]);
    };
    const timer = setTimeout(finish, 10000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-75, -180], [75, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    });
    socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.MessageType !== 'PositionReport') return;
        const report = payload.Message?.PositionReport ?? {};
        const meta = payload.MetaData ?? {};
        const mmsi = report.UserID || meta.MMSI;
        const lat = report.Latitude ?? meta.Latitude;
        const lng = report.Longitude ?? meta.Longitude;
        if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        vessels.set(String(mmsi), {
          id: String(mmsi), mmsi, imo: null,
          name: (meta.ShipName || `MMSI ${mmsi}`).trim(),
          callSign: meta.CallSign || null,
          destination: meta.Destination || null,
          shipType: meta.ShipType || null,
          vesselClass: shipTypeLabel(meta.ShipType),
          navigationStatus: navigationStatusLabel(report.NavigationalStatus),
          lat, lng,
          speed: typeof report.Sog === 'number' ? report.Sog : null,
          course: typeof report.Cog === 'number' ? report.Cog : null,
          heading: typeof report.TrueHeading === 'number' && report.TrueHeading < 360 ? report.TrueHeading : null,
          timestamp: meta.time_utc || null,
          source: 'AISStream global AIS',
        });
      } catch {}
    });
    socket.addEventListener('error', finish);
    socket.addEventListener('close', () => { clearTimeout(timer); resolve([...vessels.values()]); });
  });
}

try {
  const headers = { 'Digitraffic-User': 'GodseyeOSINT public command center/1.0', Accept: 'application/json' };
  const [locations, vessels] = await Promise.all([
    getJson('https://meri.digitraffic.fi/api/ais/v1/locations', 24000, headers),
    getJson('https://meri.digitraffic.fi/api/ais/v1/vessels', 24000, headers),
  ]);
  const metadata = new Map((Array.isArray(vessels) ? vessels : []).map((vessel) => [String(vessel.mmsi), vessel]));
  result.vessels = (locations.features ?? [])
    .map((feature) => {
      const properties = feature.properties ?? {};
      const vessel = metadata.get(String(properties.mmsi)) ?? {};
      const lng = feature.geometry?.coordinates?.[0];
      const lat = feature.geometry?.coordinates?.[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: String(properties.mmsi),
        mmsi: properties.mmsi,
        imo: vessel.imo || null,
        name: vessel.name || `MMSI ${properties.mmsi}`,
        callSign: vessel.callSign || null,
        destination: vessel.destination || null,
        shipType: vessel.shipType || null,
        vesselClass: shipTypeLabel(vessel.shipType),
        navigationStatus: navigationStatusLabel(properties.navStat),
        lat,
        lng,
        speed: typeof properties.sog === 'number' ? properties.sog : null,
        course: typeof properties.cog === 'number' ? properties.cog : null,
        heading: typeof properties.heading === 'number' && properties.heading < 360 ? properties.heading : null,
        timestamp: properties.timestampExternal ? new Date(properties.timestampExternal).toISOString() : null,
        source: 'Fintraffic Digitraffic AIS',
      };
    })
    .filter(Boolean)
    .slice(0, 1100);
  result.sources.vessels = 'Fintraffic Digitraffic AIS (Finnish/Baltic regional coverage)';
} catch (error) { result.errors.push(`Digitraffic AIS: ${error.message}`); }


if (process.env.AISSTREAM_API_KEY) {
  try {
    const streamVessels = await collectAisStreamVessels(process.env.AISSTREAM_API_KEY);
    if (streamVessels.length > 0) {
      const merged = new Map(result.vessels.map((vessel) => [String(vessel.mmsi), vessel]));
      for (const vessel of streamVessels) merged.set(String(vessel.mmsi), vessel);
      result.vessels = [...merged.values()].slice(0, 1600);
      result.sources.vessels = `AISStream global AIS + Fintraffic Digitraffic regional AIS (${streamVessels.length} streamed positions)`;
    }
  } catch (error) { result.errors.push(`AISStream: ${error.message}`); }
} else {
  result.errors.push('AISStream: AISSTREAM_API_KEY not configured; using keyless Digitraffic Baltic coverage only');
}


try {
  const groups = [['military', 36], ['stations', 12], ['gps-ops', 32], ['weather', 20]];
  const satellites = [];
  for (const [group, limit] of groups) {
    try {
      const text = await getText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, 18000);
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (let index = 0; index + 2 < lines.length && satellites.length < 100; index += 1) {
        if (!lines[index + 1]?.startsWith('1 ') || !lines[index + 2]?.startsWith('2 ')) continue;
        const name = lines[index];
        const line1 = lines[index + 1];
        const line2 = lines[index + 2];
        const catalog = line1.slice(2, 7).trim();
        satellites.push({ id: catalog, name, group, catalogNumber: Number(catalog), line1, line2, epoch: line1.slice(18, 32).trim() });
        index += 2;
        if (satellites.filter((item) => item.group === group).length >= limit) break;
      }
    } catch (error) { result.errors.push(`CelesTrak ${group}: ${error.message}`); }
  }
  result.satellites = satellites;
  result.sources.satellites = 'CelesTrak public NORAD TLE groups (military, stations, GPS, weather)';
} catch (error) { result.errors.push(`CelesTrak: ${error.message}`); }

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
  const [eonet, usgs, gdacs, noaaAlerts] = await Promise.all([
    getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40'),
    getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson'),
    getJson('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventtypes=EQ,TC,FL,VO,DR,WF&alertlevel=Red;Orange&format=json', 18000),
    getJson('https://api.weather.gov/alerts/active?status=actual&message_type=alert', 18000),
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
  const gdacsTypeNames = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };
  const gdacsEvents = (gdacs.features ?? []).map((feature) => {
    const properties = feature.properties ?? {};
    const type = properties.eventtype || 'event';
    const alertLevel = properties.episodealertlevel || properties.alertlevel || 'Orange';
    if (!['Red', 'Orange'].includes(alertLevel)) return null;
    return {
      id: `gdacs-${properties.eventid}-${properties.episodeid}`,
      title: properties.name || properties.eventname || 'GDACS disaster alert',
      category: `GDACS ${alertLevel} ${gdacsTypeNames[type] || 'disaster'}`,
      kind: String(type).toLowerCase(),
      lat: feature.geometry?.coordinates?.[1],
      lng: feature.geometry?.coordinates?.[0],
      occurredAt: properties.fromdate || properties.datemodified || null,
      magnitude: properties.episodealertscore ?? properties.alertscore ?? null,
      magnitudeUnit: 'alert score',
      url: properties.url?.report || properties.url?.details || null,
    };
  }).filter(Boolean).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).slice(0, 30);
  const weatherAlerts = (noaaAlerts.features ?? []).map((feature) => {
    const properties = feature.properties ?? {};
    const geometry = feature.geometry;
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const first = geometry.type === 'Point' ? geometry.coordinates : geometry.type === 'Polygon' ? geometry.coordinates[0]?.[0] : geometry.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0]?.[0] : null;
    if (!Array.isArray(first)) return null;
    return {
      id: `noaa-${properties.id || properties.event}-${first[0]}`,
      title: `${properties.event || 'Weather alert'} — ${properties.headline || properties.areaDesc || 'United States'}`,
      category: `NOAA ${properties.severity || 'weather'} alert`,
      kind: 'weather',
      lat: first[1], lng: first[0],
      occurredAt: properties.onset || properties.sent || null,
      magnitude: null,
      magnitudeUnit: null,
      url: properties['@id'] || null,
    };
  }).filter(Boolean).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).slice(0, 35);
  const seenNaturalIds = new Set();
  result.naturalEvents = [...earthquakes, ...eonetEvents, ...gdacsEvents, ...weatherAlerts]
    .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))
    .filter((event) => {
      const key = `${event.kind}-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (seenNaturalIds.has(key)) return false;
      seenNaturalIds.add(key);
      return true;
    })
    .slice(0, 90);
  result.sources.naturalEvents = 'NASA EONET + USGS earthquakes + GDACS red/orange alerts + NOAA active weather alerts';
} catch (error) { result.errors.push(`Natural events: ${error.message}`); }



if (process.env.FIRMS_MAP_KEY) {
  try {
    const csv = await getText(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/world/1`, 30000);
    const lines = csv.trim().split(String.fromCharCode(10));
    const fires = lines.slice(1).map((line) => {
      const columns = line.split(',');
      const lat = Number(columns[0]);
      const lng = Number(columns[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const acqDate = columns[5] || '';
      const acqTime = String(columns[6] || '').padStart(4, '0');
      const frp = Number(columns[12]);
      return {
        id: `firms-${lat}-${lng}-${acqDate}-${acqTime}`,
        title: `VIIRS active fire detection${Number.isFinite(frp) ? ` — ${frp.toFixed(1)} MW FRP` : ''}`,
        category: 'NASA FIRMS active fire',
        kind: 'wildfire',
        lat, lng,
        occurredAt: acqDate ? new Date(`${acqDate}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00Z`).toISOString() : null,
        magnitude: Number.isFinite(frp) ? frp : null,
        magnitudeUnit: 'MW FRP',
        url: 'https://firms.modaps.eosdis.nasa.gov/',
      };
    }).filter(Boolean).sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0)).slice(0, 180);
    result.naturalEvents = [...result.naturalEvents, ...fires]
      .filter((event, index, array) => array.findIndex((candidate) => candidate.id === event.id) === index)
      .slice(0, 130);
    result.sources.firms = 'NASA FIRMS VIIRS S-NPP near-real-time active fires';
  } catch (error) { result.errors.push(`NASA FIRMS: ${error.message}`); }
} else {
  result.errors.push('NASA FIRMS: FIRMS_MAP_KEY not configured; active-fire layer unavailable');
}

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


if (process.env.ACLED_API_KEY && process.env.ACLED_EMAIL) {
  try {
    const url = new URL('https://api.acleddata.com/acled/read');
    url.searchParams.set('key', process.env.ACLED_API_KEY);
    url.searchParams.set('email', process.env.ACLED_EMAIL);
    url.searchParams.set('limit', '1200');
    url.searchParams.set('fields', 'event_id_cnty|event_date|time_precision|event_type|sub_event_type|actor1|actor2|country|admin1|admin2|location|latitude|longitude|geo_precision|source|notes|fatalities');
    url.searchParams.set('sort', 'event_date DESC');
    const payload = await getJson(url, 32000);
    const acledEvents = (payload.data ?? []).map((event) => {
      const lat = Number(event.latitude);
      const lon = Number(event.longitude);
      const occurred = Date.parse(`${event.event_date}T00:00:00Z`);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(occurred)) return null;
      const fatalities = Number(event.fatalities) || 0;
      return {
        id: `acled-${event.event_id_cnty}`,
        kind: 'battle',
        lat, lon,
        title: `${event.event_type || 'Political violence'} — ${event.location || event.admin1 || event.country || 'unknown location'}`,
        detail: `${event.sub_event_type || 'Unspecified subevent'} · ${event.actor1 || 'Unknown actor'}${event.actor2 ? ` vs ${event.actor2}` : ''} · ${fatalities} reported fatalities`,
        level: fatalities >= 50 ? 5 : fatalities >= 10 ? 4 : fatalities >= 1 ? 3 : 2,
        ts: Math.floor(occurred / 1000),
        source: 'ACLED',
        note: event.notes || null,
        url: 'https://acleddata.com/',
      };
    }).filter(Boolean);
    const merged = new Map(result.mapOfWarsEvents.map((event) => [String(event.id), event]));
    for (const event of acledEvents) merged.set(String(event.id), event);
    result.mapOfWarsEvents = [...merged.values()].slice(0, 2800);
    result.sources.acled = `ACLED authenticated political violence API (${acledEvents.length} records)`;
  } catch (error) { result.errors.push(`ACLED: ${error.message}`); }
} else {
  result.errors.push('ACLED: ACLED_API_KEY/ACLED_EMAIL not configured; authenticated political-violence enrichment unavailable');
}

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


try {
  const payload = await getJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', 18000);
  result.cyberVulnerabilities = (payload.vulnerabilities ?? [])
    .slice()
    .sort((a, b) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')))
    .slice(0, 30)
    .map((item) => ({
      cveId: item.cveID,
      vendor: item.vendorProject || null,
      product: item.product || null,
      name: item.vulnerabilityName || 'Known exploited vulnerability',
      dateAdded: item.dateAdded || null,
      dueDate: item.dueDate || null,
      ransomwareUse: item.knownRansomwareCampaignUse || 'Unknown',
      requiredAction: item.requiredAction || null,
    }))
    .filter((item) => item.cveId);
  result.sources.cyberVulnerabilities = 'CISA Known Exploited Vulnerabilities catalog';
} catch (error) { result.errors.push(`CISA KEV: ${error.message}`); }

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


function validateCoordinate(item, label, errors) {
  if (!Number.isFinite(item.lat) || item.lat < -90 || item.lat > 90 || !Number.isFinite(item.lng) || item.lng < -180 || item.lng > 180) {
    errors.push(`${label}:${item.id || item.name || item.title || item.entityName || 'unknown'} invalid coordinate`);
  }
}

function validateNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateSnapshot(snapshot) {
  const errors = [];
  for (const key of ['militaryAircraft', 'aircraft', 'vessels', 'satellites', 'news', 'launches', 'naturalEvents', 'gpsInterference', 'mapOfWarsEvents', 'cyberVulnerabilities', 'internetOutages']) {
    if (!Array.isArray(snapshot[key])) errors.push(`${key} missing or not an array`);
  }
  for (const item of snapshot.militaryAircraft ?? []) validateCoordinate(item, 'militaryAircraft', errors);
  for (const item of snapshot.aircraft ?? []) validateCoordinate(item, 'aircraft', errors);
  for (const item of snapshot.vessels ?? []) validateCoordinate(item, 'vessels', errors);
  for (const item of snapshot.launches ?? []) validateCoordinate(item, 'launches', errors);
  for (const item of snapshot.naturalEvents ?? []) validateCoordinate(item, 'naturalEvents', errors);
  for (const item of snapshot.internetOutages ?? []) validateCoordinate(item, 'internetOutages', errors);
  for (const item of snapshot.internetOutages ?? []) {
    const label = `internetOutages:${item.entityType || 'unknown'}:${item.entityCode || 'unknown'}`;
    if (!['country', 'region'].includes(item.entityType)) errors.push(`${label} invalid entityType`);
    if (!item.entityCode || !item.entityName) errors.push(`${label} missing entity identity`);
    if (!['country-reference', 'region-reference'].includes(item.coordinatePrecision)) errors.push(`${label} invalid coordinate precision`);
    if ((item.entityType === 'country' && item.coordinatePrecision !== 'country-reference') || (item.entityType === 'region' && item.coordinatePrecision !== 'region-reference')) errors.push(`${label} coordinate precision/entity mismatch`);
    if (typeof item.coordinateNote !== 'string' || item.coordinateNote.length < 30 || !item.coordinateNote.includes('not an outage origin')) errors.push(`${label} missing uncertainty coordinate note`);
    if (!Number.isInteger(item.from) || !Number.isInteger(item.until) || item.from <= 0 || item.until <= 0 || item.from > item.until) errors.push(`${label} invalid Unix-second event window`);
    if (!Number.isFinite(item.score) || item.score < 0) errors.push(`${label} invalid IODA score`);
    if (item.datasource !== null && typeof item.datasource !== 'string') errors.push(`${label} invalid datasource`);
    if (item.method !== null && typeof item.method !== 'string') errors.push(`${label} invalid method`);
    if (item.countryCode !== null && typeof item.countryCode !== 'string') errors.push(`${label} invalid countryCode`);
    if (item.countryName !== null && typeof item.countryName !== 'string') errors.push(`${label} invalid countryName`);
    if (item.naturalEarthRegionId !== null && typeof item.naturalEarthRegionId !== 'string') errors.push(`${label} invalid Natural Earth region id`);
    if (typeof item.fromBeforeQueryWindow !== 'boolean' || typeof item.untilEqualsQueryHorizon !== 'boolean') errors.push(`${label} invalid query-window uncertainty flags`);
  }
  const outageMeta = snapshot.internetOutageMeta;
  if (!outageMeta || typeof outageMeta !== 'object') {
    errors.push('internetOutageMeta missing or not an object');
  } else {
    if (!['ok', 'preserved', 'unavailable'].includes(outageMeta.status)) errors.push('internetOutageMeta invalid status');
    const window = outageMeta.queryWindow;
    if (!window || !Number.isInteger(window.from) || !Number.isInteger(window.until) || window.from <= 0 || window.from >= window.until) errors.push('internetOutageMeta invalid explicit Unix-second query window');
    if (!Number.isInteger(window?.lookbackSeconds) || window.lookbackSeconds <= 0 || !Number.isInteger(window?.extendWindowSeconds) || window.extendWindowSeconds < 0) errors.push('internetOutageMeta invalid lookback/extendWindow seconds');
    if (!Array.isArray(outageMeta.entityTypes) || !outageMeta.entityTypes.includes('country') || !outageMeta.entityTypes.includes('region')) errors.push('internetOutageMeta invalid entityTypes');
    for (const key of ['fetchedEventCount', 'countryEventCount', 'regionEventCount', 'geolocatedEventCount', 'omittedEventCount']) {
      if (!validateNonNegativeInteger(outageMeta[key])) errors.push(`internetOutageMeta invalid ${key}`);
    }
    if (validateNonNegativeInteger(outageMeta.fetchedEventCount) && outageMeta.fetchedEventCount !== outageMeta.countryEventCount + outageMeta.regionEventCount) errors.push('internetOutageMeta entity count mismatch');
    if (validateNonNegativeInteger(outageMeta.fetchedEventCount) && outageMeta.fetchedEventCount !== outageMeta.geolocatedEventCount + outageMeta.omittedEventCount) errors.push('internetOutageMeta geolocation count mismatch');
    if (!validateNonNegativeInteger(outageMeta.omittedByReason?.invalidEventContract) || !validateNonNegativeInteger(outageMeta.omittedByReason?.missingCoordinateReference)) errors.push('internetOutageMeta invalid omission reasons');
    if (outageMeta.geolocatedEventCount !== (snapshot.internetOutages ?? []).length) errors.push('internetOutageMeta geolocated count does not match internetOutages');
    if (!Array.isArray(outageMeta.requestUrls)) {
      errors.push('internetOutageMeta requestUrls missing or not an array');
    } else if (outageMeta.status === 'ok') {
      if (outageMeta.requestUrls.length === 0) errors.push('internetOutageMeta missing auditable request URLs');
      for (const url of outageMeta.requestUrls) {
        if (!url.includes(`from=${window?.from}`) || !url.includes(`until=${window?.until}`) || !url.includes('format=ioda') || !url.includes('overall=false')) errors.push('internetOutageMeta request URL lacks explicit window/format');
      }
    }
    if (typeof outageMeta.caveat !== 'string' || !outageMeta.caveat.includes('not an all-clear')) errors.push('internetOutageMeta missing uncertainty caveat');
  }
  for (const item of snapshot.satellites ?? []) {
    if (!item.line1?.startsWith('1 ') || !item.line2?.startsWith('2 ') || !item.name || !item.catalogNumber) errors.push(`satellites:${item.id || 'unknown'} invalid TLE contract`);
  }
  for (const item of snapshot.news ?? []) {
    if (!item.title || !/^https?:\/\//.test(item.url || '')) errors.push(`news:${item.title || 'unknown'} invalid article contract`);
  }
  if (!snapshot.fetchedAt || Number.isNaN(Date.parse(snapshot.fetchedAt))) errors.push('fetchedAt invalid');
  if (errors.length > 0) throw new Error(`Snapshot contract validation failed: ${errors.slice(0, 8).join('; ')}`);
}

for (const key of ['militaryAircraft', 'aircraft', 'vessels', 'satellites', 'news', 'launches', 'naturalEvents', 'gpsInterference', 'mapOfWarsEvents', 'cyberVulnerabilities']) {
  if (result[key].length === 0 && Array.isArray(previousSnapshot[key]) && previousSnapshot[key].length > 0) {
    result[key] = previousSnapshot[key];
    result.errors.push(`${key}: transiently empty; preserved previous snapshot`);
  }
}

validateSnapshot(result);
writeFileSync(outFile, JSON.stringify(result));
console.log(`osint snapshot: ${result.militaryAircraft.length} military aircraft, ${result.aircraft.length} civil aircraft, ${result.vessels.length} vessels, ${result.satellites.length} satellites, ${result.news.length} articles, ${result.launches.length} launches, ${result.naturalEvents.length} natural events, ${result.gpsInterference.length} gps interference cells, ${result.mapOfWarsEvents.length} map-of-wars events, ${result.webcams.length} webcams, ${result.internetOutages.length} IODA outage detections (${result.internetOutageMeta.status})`);
