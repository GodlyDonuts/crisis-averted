export type SeverityKey = "critical" | "high" | "medium" | "low";

export type CategoryGroup =
  | "kinetic"
  | "security"
  | "humanitarian"
  | "political"
  | "strategic";

export type TimeWindowKey = "24h" | "7d" | "30d" | "all";

export interface ConflictSource {
  name: string;
  url: string;
}

export interface ConflictEvent {
  id: string;
  lat: number;
  lng: number;
  precision: number | null;
  severity: SeverityKey;
  category: string;
  categoryGroup: CategoryGroup;
  date: string;
  occurredAt: number;
  updatedAt: number;
  killed: number;
  countedCasualties: number;
  displaced: number;
  country: string;
  conflict: string;
  theater: string;
  region: string;
  title: string;
  verified: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
  sources: ConflictSource[];
  intensity: number;
}

export interface ConflictTheater {
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  eventCount: number;
  recentEventCount: number;
  criticalCount: number;
  highCount: number;
  killed: number;
  displaced: number;
  intensity: number;
  latestAt: number;
  categories: Record<string, number>;
  topEvents: ConflictEvent[];
}

export interface ConflictFilters {
  timeWindow: TimeWindowKey;
  categoryGroups: CategoryGroup[];
  severities: SeverityKey[];
  theater: string | null;
  query: string;
}

export interface ConflictSummary {
  totalEvents: number;
  criticalEvents: number;
  highEvents: number;
  kineticEvents: number;
  humanitarianEvents: number;
  reportedKilled: number;
  reportedDisplaced: number;
  activeTheaters: number;
  latestEventAt: number;
}

export interface TimelineBucket {
  key: string;
  label: string;
  start: number;
  count: number;
  critical: number;
  intensity: number;
}

export interface WarHeatmapRawEvent {
  i?: string;
  la?: number;
  lo?: number;
  p?: number | null;
  s?: string;
  c?: string;
  d?: string;
  t?: string | null;
  k?: number | null;
  u?: number | null;
  x?: number | null;
  n?: string | null;
  cf?: string | null;
  dp?: number | null;
  ti?: string | null;
  r?: string | null;
  v?: boolean;
  sn?: string | null;
  su?: string | null;
  sc?: { name?: string; url?: string }[];
  et?: number | null;
}

export interface MilitaryAircraft {
  id: string;
  callsign: string;
  registration: string | null;
  aircraftType: string | null;
  lat: number;
  lng: number;
  altitude: number | null;
  speed: number | null;
  track: number | null;
  squawk: string | null;
}

export interface OsintNewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface OsintLaunch {
  id: string;
  name: string;
  provider: string | null;
  location: string | null;
  lat: number;
  lng: number;
  net: string | null;
  url: string | null;
}

export interface OsintSnapshot {
  fetchedAt: string;
  sources: Record<string, string>;
  militaryAircraft: MilitaryAircraft[];
  news: OsintNewsArticle[];
  launches: OsintLaunch[];
  naturalEvents: OsintNaturalEvent[];
  errors: string[];
}

export interface OsintNaturalEvent {
  id: string;
  title: string;
  category: string;
  kind: string;
  lat: number;
  lng: number;
  occurredAt: string | null;
  magnitude: number | null;
  magnitudeUnit: string | null;
  url: string | null;
}
