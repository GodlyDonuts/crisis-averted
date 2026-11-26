import type {
  CategoryGroup,
  ConflictEvent,
  ConflictFilters,
  ConflictSource,
  ConflictSourceFamily,
  ConflictSummary,
  ConflictTheater,
  IncidentCorrelationStats,
  MapOfWarsRawEvent,
  SeverityKey,
  TimelineBucket,
  TimeWindowKey,
  WarHeatmapRawEvent,
} from "@/types/conflict";
import { assetPath } from "@/lib/assets";
import { correlateConflictEvents } from "@/lib/incidentCorrelation";
import { createDayOccurrenceWindow, createSecondOccurrenceWindow, createUcdpOccurrenceWindow } from "@/lib/incidentTime";

const LIVE_EVENTS_URL = "https://warheatmap.app/functions/eventsLite";
const FALLBACK_EVENTS_URL = assetPath("/data/conflict-fallback.json");

export const DEFAULT_CONFLICT_FILTERS: ConflictFilters = {
  timeWindow: "30d",
  categoryGroups: ["kinetic", "security", "strategic"],
  severities: ["critical", "high", "medium", "low"],
  theater: null,
  query: "",
};

export const SEVERITY_ORDER: SeverityKey[] = ["critical", "high", "medium", "low"];

export const SEVERITY_META: Record<SeverityKey, { label: string; color: string; softColor: string; rank: number }> = {
  critical: { label: "Critical", color: "#ff2d55", softColor: "rgba(255,45,85,0.16)", rank: 4 },
  high: { label: "High", color: "#ff8a00", softColor: "rgba(255,138,0,0.15)", rank: 3 },
  medium: { label: "Medium", color: "#ffd166", softColor: "rgba(255,209,102,0.14)", rank: 2 },
  low: { label: "Low", color: "#36d399", softColor: "rgba(54,211,153,0.13)", rank: 1 },
};

export const CATEGORY_GROUP_META: Record<CategoryGroup, { label: string; color: string; description: string }> = {
  kinetic: { label: "Kinetic", color: "#ff3b30", description: "Strikes, battles, missiles, explosions" },
  security: { label: "Security", color: "#ff9f0a", description: "Terrorism, assassinations, border incidents" },
  strategic: { label: "Strategic", color: "#64d2ff", description: "Naval, cyber, nuclear and infrastructure activity" },
  humanitarian: { label: "Humanitarian", color: "#30d158", description: "Civilian impact, displacement and relief" },
  political: { label: "Political", color: "#bf5af2", description: "Diplomacy, sanctions, protests and coups" },
};

const CATEGORY_GROUP_MAP: Record<string, CategoryGroup> = {
  airstrike: "kinetic",
  ground_battle: "kinetic",
  missile: "kinetic",
  explosion: "kinetic",
  terrorism: "security",
  assassination: "security",
  border_crossing: "security",
  protest: "political",
  coup: "political",
  diplomacy: "political",
  sanctions: "political",
  humanitarian: "humanitarian",
  migration: "humanitarian",
  naval: "strategic",
  infrastructure: "strategic",
  organized_violence: "kinetic",
  cyber: "strategic",
  nuclear: "strategic",
  other: "security",
};


function slugifyTheater(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "global";
}

function parseMapOfWarsFatalities(detail: string | undefined): number {
  if (!detail) return 0;
  const patterns = [/†\s*(\d+)/, /•\s*(\d+)/, /(\d+)\s+reported fatalities/i];
  for (const pattern of patterns) {
    const value = Number(detail.match(pattern)?.[1]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function nonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeMapOfWarsEvent(raw: MapOfWarsRawEvent): ConflictEvent | null {
  if (!raw.id || typeof raw.lat !== "number" || typeof raw.lon !== "number" || !Number.isFinite(raw.ts)) return null;
  if (raw.kind !== "battle") return null;
  const title = raw.title || "Unnamed contact";
  const ucdp = raw.ucdp;
  const country = ucdp?.country || (title.includes(",") ? title.split(",").pop()?.trim() || "Unknown" : "Unknown");
  const parsedFatalities = parseMapOfWarsFatalities(raw.detail);
  const casualties = nonNegativeNumber(ucdp?.best) ?? parsedFatalities;
  const uncertaintyAwareFatalities = ucdp ? Math.max(casualties, (ucdp.high ?? 0) > 0 ? 1 : 0) : casualties;
  const severity: SeverityKey = uncertaintyAwareFatalities >= 25 ? "critical" : uncertaintyAwareFatalities >= 5 || (raw.level ?? 1) >= 3 ? "high" : uncertaintyAwareFatalities > 0 ? "medium" : "low";
  const category = ucdp ? "organized_violence" : "ground_battle";
  const occurredAt = Math.round((raw.ts ?? 0) * 1000);
  const conflict = ucdp?.conflict_name || (country !== "Unknown" ? `${country} conflict` : "Unresolved conflict zone");
  const theater = slugifyTheater(conflict);
  const recencyBoost = clamp01(1 - Math.max(0, (Date.now() - occurredAt) / 36e5) / (24 * 30));
  const intensity = clamp01(SEVERITY_META[severity].rank / 4 * 0.58 + clamp01(Math.log10(1 + uncertaintyAwareFatalities) / 2.5) * 0.25 + recencyBoost * 0.17);
  const rawUcdpIdMatch = raw.id.match(/^ucdp:(\d+)$/);
  const canonicalUcdpId = ucdp?.id ?? (rawUcdpIdMatch ? Number(rawUcdpIdMatch[1]) : null);
  // Publisher-family tagging feeds cross-source correlation: canonical UCDP ids (nested official
  // metadata or lattice ids) are curated UCDP content; ACLED rows carry their own id namespace;
  // everything else in the lattice is Map of Wars editorial records.
  const sourceFamily: ConflictSourceFamily = canonicalUcdpId ? "ucdp" : raw.id.startsWith("acled-") || raw.source === "ACLED" ? "acled" : "mapofwars";
  const occurrence = createUcdpOccurrenceWindow(ucdp?.date_start, ucdp?.date_end, ucdp?.date_prec)
    ?? (occurredAt % (24 * 36e5) === 0
      ? createDayOccurrenceWindow(occurredAt, "inferred-day")
      : createSecondOccurrenceWindow(occurredAt));
  return {
    id: canonicalUcdpId ? `ucdp:${canonicalUcdpId}` : `mow-${raw.id}`, lat: raw.lat, lng: raw.lon, precision: ucdp?.where_prec ?? null, severity, category,
    categoryGroup: CATEGORY_GROUP_MAP[category] ?? "security", date: ucdp?.date_end || new Date(occurredAt).toISOString().slice(0, 10), occurredAt,
    updatedAt: occurredAt, killed: casualties, countedCasualties: casualties, displaced: 0, country, conflict, theater,
    region: ucdp?.region || "Global", title: raw.note || title, detail: raw.detail || null, verified: ucdp ? ucdp.code_status?.toLowerCase() === "clear" : raw.source === "UCDP", sourceName: raw.source || null, sourceUrl: raw.url || null,
    sources: raw.url ? [{ name: raw.source || "Map of Wars", url: raw.url }] : [], intensity, sourceFamily,
    ...(occurrence ? { occurrence } : {}),
    ...(ucdp ? { ucdp } : {}),
  };
}

const severityFromCode = (code: string | undefined): SeverityKey => {
  switch (code) {
    case "c": return "critical";
    case "h": return "high";
    case "m": return "medium";
    default: return "low";
  }
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function normalizeCategory(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeTheaterName(slugOrName: string): string {
  return slugOrName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bScs\b/g, "SCS")
    .replace(/\bM23\b/g, "M23");
}

function parseEventDate(date: string | undefined): number {
  if (!date) return 0;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return Date.UTC(year, month - 1, day);
}

function safeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeWarHeatmapEvent(raw: WarHeatmapRawEvent): ConflictEvent | null {
  if (!raw.i || typeof raw.la !== "number" || typeof raw.lo !== "number") return null;
  if (!Number.isFinite(raw.la) || !Number.isFinite(raw.lo)) return null;

  const severity = severityFromCode(raw.s);
  const category = raw.c || "other";
  const hasPublisherTimestamp = typeof raw.et === "number" && Number.isFinite(raw.et) && raw.et > 0;
  const occurredAt = hasPublisherTimestamp ? (raw.et ?? 0) * 1000 : parseEventDate(raw.d);
  const occurrence = hasPublisherTimestamp
    ? createSecondOccurrenceWindow(occurredAt)
    : createDayOccurrenceWindow(occurredAt, "publisher-day");
  const updatedAt = raw.u ? raw.u * 1000 : occurredAt;
  const killed = Math.max(0, safeNumber(raw.k));
  const countedCasualties = Math.max(0, safeNumber(raw.x));
  const displaced = Math.max(0, safeNumber(raw.dp));
  const recencyHours = occurredAt ? Math.max(0, (Date.now() - occurredAt) / 36e5) : 720;
  const recencyBoost = clamp01(1 - recencyHours / (24 * 30));
  const casualtyBoost = clamp01(Math.log10(1 + Math.min(killed, 1000)) / 3);
  const displacementBoost = clamp01(Math.log10(1 + Math.min(displaced, 100000)) / 5);
  const precisionBoost = raw.p ? clamp01((7 - raw.p) / 7) * 0.08 : 0;
  const verificationBoost = raw.v ? 0.08 : 0;
  const severityWeight = SEVERITY_META[severity].rank / 4;
  const intensity = clamp01(
    severityWeight * 0.52 +
    casualtyBoost * 0.2 +
    displacementBoost * 0.1 +
    recencyBoost * 0.16 +
    precisionBoost +
    verificationBoost
  );

  const sources: ConflictSource[] = (raw.sc ?? [])
    .filter((source): source is { name: string; url: string } => Boolean(source.name && source.url))
    .slice(0, 4)
    .map((source) => ({ name: source.name, url: source.url }));

  if (raw.sn && raw.su && !sources.some((source) => source.url === raw.su)) {
    sources.unshift({ name: raw.sn, url: raw.su });
  }

  const theater = raw.t || raw.cf || raw.n || "global";

  return {
    id: raw.i,
    lat: raw.la,
    lng: raw.lo,
    precision: typeof raw.p === "number" ? raw.p : null,
    severity,
    category,
    categoryGroup: CATEGORY_GROUP_MAP[category] ?? "security",
    date: raw.d || "unknown",
    occurredAt,
    updatedAt,
    killed,
    countedCasualties,
    displaced,
    country: raw.n || "Unknown",
    conflict: raw.cf || normalizeTheaterName(theater),
    theater,
    region: raw.r || "Global",
    title: raw.ti || "Untitled incident",
    verified: Boolean(raw.v),
    sourceName: raw.sn || null,
    sourceUrl: raw.su || null,
    sources,
    intensity,
    sourceFamily: "warheatmap",
    ...(occurrence ? { occurrence } : {}),
  };
}

/**
 * Canonical incident assembly. The pre-batch-5 implementation silently dropped rows whose
 * normalized title, day, and 35 km fix coincided — destroying potentially independent reports
 * with no provenance. The correlation pass replaces that behavior: every record is retained,
 * probable duplicates become evidence members of a canonical incident with deterministic
 * rationale, and the statistics of the pass are exposed for source-status transparency.
 */
function correlateWithCap(events: ConflictEvent[], cap: number): { events: ConflictEvent[]; correlation: IncidentCorrelationStats } {
  const correlated = correlateConflictEvents(events);
  return { events: correlated.incidents.slice(0, cap), correlation: correlated.stats };
}

export interface ConflictDataResult {
  events: ConflictEvent[];
  source: "live" | "fallback";
  error: string | null;
  fetchedAt: number;
  correlation: IncidentCorrelationStats;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadConflictEvents(snapshotEvents: ConflictEvent[] = []): Promise<ConflictDataResult> {
  const fetchedAt = Date.now();
  const [warHeatmap] = await Promise.allSettled([
    fetchJsonWithTimeout(LIVE_EVENTS_URL, 14000),
  ]);

  const events: ConflictEvent[] = [...snapshotEvents];
  const errors: string[] = [];
  let liveEventCount = 0;
  if (warHeatmap.status === "fulfilled" && Array.isArray(warHeatmap.value)) {
    const liveEvents = warHeatmap.value.map((raw) => normalizeWarHeatmapEvent(raw as WarHeatmapRawEvent)).filter((event): event is ConflictEvent => event !== null);
    liveEventCount = liveEvents.length;
    events.push(...liveEvents);
  } else if (warHeatmap.status === "rejected") errors.push(`WarHeatMap: ${warHeatmap.reason instanceof Error ? warHeatmap.reason.message : "unavailable"}`);

  if (liveEventCount > 0) {
    return { ...correlateWithCap(events, 2600), source: "live", error: errors.join(" · ") || null, fetchedAt };
  }
  if (events.length > 0) {
    return { ...correlateWithCap(events, 2600), source: "fallback", error: errors.join(" · ") || "Using cached OSINT snapshot", fetchedAt };
  }

  try {
    const payload = await fetchJsonWithTimeout(FALLBACK_EVENTS_URL, 8000) as { events?: WarHeatmapRawEvent[] };
    const fallbackEvents = (payload.events ?? []).map(normalizeWarHeatmapEvent).filter((event): event is ConflictEvent => event !== null);
    return { ...correlateWithCap([...fallbackEvents, ...snapshotEvents], 2600), source: "fallback", error: errors.join(" · ") || "Live feeds unavailable", fetchedAt };
  } catch (fallbackError) {
    return {
      events: [],
      source: "fallback",
      error: fallbackError instanceof Error ? fallbackError.message : "Unable to load conflict data",
      fetchedAt,
      correlation: correlateConflictEvents([]).stats,
    };
  }
}

export function classifyAircraftRole(aircraftType: string | null | undefined): { label: string; color: string } {
  const type = (aircraftType || "").toUpperCase();
  if (/^(KC|K35|K46|K10|A330|A3M|MMRT)/.test(type)) return { label: "Tanker", color: "#e2b75e" };
  if (/^(E2|E3|E7|E11|RC|R135|U2|P8|RQ|MQ|GLEX|JSTARS)/.test(type)) return { label: "ISR / surveillance", color: "#8fb8d8" };
  if (/^(B1|B2|B52|TU95|TU160)/.test(type)) return { label: "Strategic bomber", color: "#ff6b6b" };
  if (/^(F15|F16|F18|FA18|F22|F35|EF|MIG|SU|J10|J20)/.test(type)) return { label: "Combat aircraft", color: "#f2f0df" };
  if (/^(C5|C17|C130|C30J|A400|AN124|IL76|C2|C12|C32|C37|C40)/.test(type)) return { label: "Transport / logistics", color: "#b8c29a" };
  if (/^(H60|UH|HH|CH|AH|H64|V22)/.test(type)) return { label: "Rotary / tiltrotor", color: "#9ec78f" };
  return { label: "Military aviation", color: "#b8c29a" };
}

export function naturalEventColor(event: { category?: string; kind?: string }): string {
  const category = (event.category || "").toLowerCase();
  const kind = (event.kind || "").toLowerCase();
  if (category.includes("red")) return "#ff5c5c";
  if (category.includes("orange")) return "#ff9f2e";
  if (kind.includes("tc") || category.includes("cyclone")) return "#9d7bea";
  if (kind.includes("fl") || category.includes("flood")) return "#5aa7ff";
  if (kind.includes("dr") || category.includes("drought")) return "#e2b75e";
  if (kind.includes("wf") || category.includes("wildfire")) return "#ff6b45";
  if (kind.includes("vo") || category.includes("volcano")) return "#ff7a59";
  if (kind.includes("eq") || category.includes("earthquake")) return "#ff9f2e";
  return "#30d158";
}

export function getTimeWindowHours(timeWindow: TimeWindowKey): number {
  switch (timeWindow) {
    case "24h": return 24;
    case "7d": return 24 * 7;
    case "30d": return 24 * 30;
    case "all": return Infinity;
  }
}

export function filterConflictEvents(events: ConflictEvent[], filters: ConflictFilters): ConflictEvent[] {
  const hours = getTimeWindowHours(filters.timeWindow);
  const cutoff = Number.isFinite(hours) ? Date.now() - hours * 36e5 : 0;
  const query = filters.query.trim().toLowerCase();

  return events.filter((event) => {
    if (event.occurredAt < cutoff) return false;
    if (!filters.categoryGroups.includes(event.categoryGroup)) return false;
    if (!filters.severities.includes(event.severity)) return false;
    if (filters.theater && event.theater !== filters.theater) return false;
    if (query) {
      const haystack = `${event.title} ${event.country} ${event.conflict} ${event.region} ${event.category}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function estimateEventConfidence(event: ConflictEvent): { score: number; label: "low" | "moderate" | "high" } {
  const precisionScore = event.precision === null ? 0.35 : event.precision <= 2 ? 1 : event.precision <= 4 ? 0.65 : 0.3;
  const documentedSourceCount = event.ucdp?.number_of_sources && event.ucdp.number_of_sources > 0 ? event.ucdp.number_of_sources : event.sources.length;
  const sourceScore = Math.min(1, documentedSourceCount / 3);
  const verificationScore = event.verified ? 1 : 0.25;
  const specificityScore = event.countedCasualties > 0 || event.displaced > 0 ? 0.8 : 0.5;
  const score = Math.round((precisionScore * 0.24 + sourceScore * 0.28 + verificationScore * 0.34 + specificityScore * 0.14) * 100);
  return { score, label: score >= 70 ? "high" : score >= 45 ? "moderate" : "low" };
}

export function summarizeEvents(events: ConflictEvent[]): ConflictSummary {
  const theaterCasualties = new Map<string, number>();
  const theaterDisplacement = new Map<string, number>();

  for (const event of events) {
    theaterCasualties.set(event.theater, (theaterCasualties.get(event.theater) ?? 0) + event.countedCasualties);
    theaterDisplacement.set(event.theater, Math.max(theaterDisplacement.get(event.theater) ?? 0, event.displaced));
  }

  return {
    totalEvents: events.length,
    criticalEvents: events.filter((event) => event.severity === "critical").length,
    highEvents: events.filter((event) => event.severity === "high").length,
    kineticEvents: events.filter((event) => event.categoryGroup === "kinetic").length,
    humanitarianEvents: events.filter((event) => event.categoryGroup === "humanitarian").length,
    reportedKilled: [...theaterCasualties.values()].reduce((sum, value) => sum + value, 0),
    reportedDisplaced: [...theaterDisplacement.values()].reduce((sum, value) => sum + value, 0),
    activeTheaters: new Set(events.map((event) => event.theater)).size,
    latestEventAt: Math.max(0, ...events.map((event) => event.occurredAt)),
  };
}

export function aggregateTheaters(events: ConflictEvent[]): ConflictTheater[] {
  const groups = new Map<string, ConflictEvent[]>();
  for (const event of events) {
    const existing = groups.get(event.theater) ?? [];
    existing.push(event);
    groups.set(event.theater, existing);
  }

  const now = Date.now();
  const theaters = [...groups.entries()].map(([slug, group]) => {
    let weightTotal = 0;
    let latTotal = 0;
    let lngTotal = 0;
    let rawIntensity = 0;
    const categories: Record<string, number> = {};

    for (const event of group) {
      const weight = 0.4 + event.intensity;
      weightTotal += weight;
      latTotal += event.lat * weight;
      lngTotal += event.lng * weight;
      rawIntensity += event.intensity;
      categories[event.category] = (categories[event.category] ?? 0) + 1;
    }

    const representativeName = group.find((event) => event.conflict)?.conflict || normalizeTheaterName(slug);
    const sortedEvents = [...group].sort((a, b) => (b.intensity - a.intensity) || (b.occurredAt - a.occurredAt));
    const recent72hWeight = group
      .filter((event) => now - event.occurredAt <= 3 * 24 * 36e5)
      .reduce((sum, event) => sum + event.intensity + Math.min(event.countedCasualties, 100) / 100, 0);
    const priorFourDayWeight = group
      .filter((event) => now - event.occurredAt > 3 * 24 * 36e5 && now - event.occurredAt <= 7 * 24 * 36e5)
      .reduce((sum, event) => sum + event.intensity + Math.min(event.countedCasualties, 100) / 100, 0);
    const comparableBaseline = priorFourDayWeight * 0.75;
    const momentum = recent72hWeight / Math.max(0.5, comparableBaseline);
    const trend = momentum >= 1.45 ? "escalating" : momentum <= 0.65 ? "cooling" : "stable";

    return {
      slug,
      name: representativeName,
      region: group[0]?.region || "Global",
      lat: latTotal / Math.max(weightTotal, 1),
      lng: lngTotal / Math.max(weightTotal, 1),
      eventCount: group.length,
      recentEventCount: group.filter((event) => now - event.occurredAt <= 7 * 24 * 36e5).length,
      criticalCount: group.filter((event) => event.severity === "critical").length,
      highCount: group.filter((event) => event.severity === "high").length,
      killed: group.reduce((sum, event) => sum + event.countedCasualties, 0),
      displaced: Math.max(0, ...group.map((event) => event.displaced)),
      intensity: rawIntensity,
      momentum,
      trend,
      latestAt: Math.max(0, ...group.map((event) => event.occurredAt)),
      categories,
      topEvents: sortedEvents.slice(0, 5),
    } satisfies ConflictTheater;
  });

  const maxIntensity = Math.max(1, ...theaters.map((theater) => theater.intensity));
  return theaters
    .map((theater) => ({ ...theater, intensity: theater.intensity / maxIntensity }))
    .sort((a, b) => (b.intensity - a.intensity) || (b.eventCount - a.eventCount));
}

export function buildTimeline(events: ConflictEvent[], days = 30): TimelineBucket[] {
  const now = new Date();
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const buckets: TimelineBucket[] = [];

  for (let index = days - 1; index >= 0; index--) {
    const start = utcToday - index * 24 * 36e5;
    const date = new Date(start);
    buckets.push({
      key: date.toISOString().slice(0, 10),
      label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      start,
      count: 0,
      critical: 0,
      intensity: 0,
    });
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const event of events) {
    const key = new Date(event.occurredAt).toISOString().slice(0, 10);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.intensity += event.intensity;
    if (event.severity === "critical") bucket.critical += 1;
  }

  return buckets;
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "unknown";
  const delta = Date.now() - timestamp;
  const future = delta < 0;
  const abs = Math.abs(delta);
  const minutes = Math.floor(abs / 60000);
  if (minutes < 1) return future ? "imminent" : "just now";
  if (minutes < 60) return `${minutes}m ${future ? "ahead" : "ago"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${future ? "ahead" : "ago"}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ${future ? "ahead" : "ago"}`;
  const months = Math.floor(days / 30);
  return `${months}mo ${future ? "ahead" : "ago"}`;
}

export function formatUtcTime(timestamp: number): string {
  if (!timestamp) return "--";
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
