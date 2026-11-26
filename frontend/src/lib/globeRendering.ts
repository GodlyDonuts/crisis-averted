/**
 * Deterministic adaptive-rendering primitives for the Godseye globe.
 *
 * The module is intentionally independent of React and WebGL so density, projection,
 * frame-budget, and accounting behavior can be validated in Node. It never drops source
 * records: every capped selection returns exact rendered/omitted accounting for the UI.
 */

export type RenderQualityTier = "full" | "balanced" | "constrained" | "minimal";
export type RenderDetailLevel = 0 | 1 | 2;
export type RingAnimationMode = "animated" | "slow" | "static";

export interface GlobeRenderCaps {
  incidents: number;
  militaryAircraft: number;
  civilAircraft: number;
  vessels: number;
  satellites: number;
  launches: number;
  naturalEvents: number;
  gpsInterference: number;
  internetOutages: number;
  gdeltGeoNews: number;
  theaterLabels: number;
  ringBeacons: number;
  htmlAlertMarkers: number;
  signalArcs: number;
}

export interface GlobeRenderQualityProfile {
  tier: RenderQualityTier;
  detailLevel: RenderDetailLevel;
  caps: GlobeRenderCaps;
  viewportRadiusDegrees: number | null;
  pointResolution: number;
  pathResolution: number;
  ringResolution: number;
  arcCurveResolution: number;
  arcCircularResolution: number;
  labelResolution: number;
  pixelRatioCap: number;
  textureAnisotropyCap: number;
  cloudSegments: number;
  cloudOpacityScale: number;
  enableClouds: boolean;
  enableBloom: boolean;
  bloomStrengthScale: number;
  satelliteTileMaxLevel: number;
  trackSampleCount: number;
  ringAnimation: RingAnimationMode;
  htmlPulse: boolean;
  scanlines: boolean;
}

export const RENDER_QUALITY_TIERS: RenderQualityTier[] = ["full", "balanced", "constrained", "minimal"];

export function renderQualityTierIndex(tier: RenderQualityTier): number {
  return RENDER_QUALITY_TIERS.indexOf(tier);
}

/** Returns whichever tier is more resource-constrained; ordering is deterministic. */
export function moreConstrainedTier(a: RenderQualityTier, b: RenderQualityTier): RenderQualityTier {
  return renderQualityTierIndex(a) >= renderQualityTierIndex(b) ? a : b;
}

export function detailLevelForAltitude(altitude: number): RenderDetailLevel {
  if (altitude < 0.62) return 2;
  if (altitude < 1.35) return 1;
  return 0;
}

export function renderDetailLabel(detailLevel: RenderDetailLevel): string {
  if (detailLevel === 2) return "local detail";
  if (detailLevel === 1) return "regional detail";
  return "global overview";
}

const BASE_CAPS: Record<RenderDetailLevel, GlobeRenderCaps> = {
  0: {
    incidents: 190,
    militaryAircraft: 120,
    civilAircraft: 260,
    vessels: 380,
    satellites: 110,
    launches: 24,
    naturalEvents: 70,
    gpsInterference: 240,
    internetOutages: 140,
    gdeltGeoNews: 180,
    theaterLabels: 8,
    ringBeacons: 42,
    htmlAlertMarkers: 8,
    signalArcs: 22,
  },
  1: {
    incidents: 320,
    militaryAircraft: 190,
    civilAircraft: 480,
    vessels: 650,
    satellites: 110,
    launches: 24,
    naturalEvents: 70,
    gpsInterference: 380,
    internetOutages: 180,
    gdeltGeoNews: 260,
    theaterLabels: 12,
    ringBeacons: 42,
    htmlAlertMarkers: 8,
    signalArcs: 22,
  },
  2: {
    incidents: 430,
    militaryAircraft: 240,
    civilAircraft: 700,
    vessels: 900,
    satellites: 110,
    launches: 24,
    naturalEvents: 70,
    gpsInterference: 500,
    internetOutages: 240,
    gdeltGeoNews: 360,
    theaterLabels: 16,
    ringBeacons: 42,
    htmlAlertMarkers: 8,
    signalArcs: 22,
  },
};

const TIER_CAP_SCALE: Record<RenderQualityTier, number> = {
  full: 1,
  balanced: 0.72,
  constrained: 0.48,
  minimal: 0.28,
};

const MIN_CAPS: GlobeRenderCaps = {
  incidents: 30,
  militaryAircraft: 12,
  civilAircraft: 25,
  vessels: 25,
  satellites: 12,
  launches: 4,
  naturalEvents: 10,
  gpsInterference: 20,
  internetOutages: 12,
  gdeltGeoNews: 20,
  theaterLabels: 4,
  ringBeacons: 6,
  htmlAlertMarkers: 2,
  signalArcs: 6,
};

function scaleCaps(base: GlobeRenderCaps, tier: RenderQualityTier): GlobeRenderCaps {
  const scale = TIER_CAP_SCALE[tier];
  return {
    incidents: Math.max(MIN_CAPS.incidents, Math.round(base.incidents * scale)),
    militaryAircraft: Math.max(MIN_CAPS.militaryAircraft, Math.round(base.militaryAircraft * scale)),
    civilAircraft: Math.max(MIN_CAPS.civilAircraft, Math.round(base.civilAircraft * scale)),
    vessels: Math.max(MIN_CAPS.vessels, Math.round(base.vessels * scale)),
    satellites: Math.max(MIN_CAPS.satellites, Math.round(base.satellites * scale)),
    launches: Math.max(MIN_CAPS.launches, Math.round(base.launches * scale)),
    naturalEvents: Math.max(MIN_CAPS.naturalEvents, Math.round(base.naturalEvents * scale)),
    gpsInterference: Math.max(MIN_CAPS.gpsInterference, Math.round(base.gpsInterference * scale)),
    internetOutages: Math.max(MIN_CAPS.internetOutages, Math.round(base.internetOutages * scale)),
    gdeltGeoNews: Math.max(MIN_CAPS.gdeltGeoNews, Math.round(base.gdeltGeoNews * scale)),
    theaterLabels: Math.max(MIN_CAPS.theaterLabels, Math.round(base.theaterLabels * scale)),
    ringBeacons: Math.max(MIN_CAPS.ringBeacons, Math.round(base.ringBeacons * scale)),
    htmlAlertMarkers: Math.max(MIN_CAPS.htmlAlertMarkers, Math.round(base.htmlAlertMarkers * scale)),
    signalArcs: Math.max(MIN_CAPS.signalArcs, Math.round(base.signalArcs * scale)),
  };
}

const VIEWPORT_RADIUS_BY_DETAIL: Record<RenderDetailLevel, number | null> = {
  0: null,
  1: 58,
  2: 30,
};

const POINT_RESOLUTION: Record<RenderQualityTier, number> = { full: 9, balanced: 8, constrained: 6, minimal: 5 };
const PATH_RESOLUTION: Record<RenderQualityTier, number> = { full: 2, balanced: 2, constrained: 1, minimal: 1 };
const RING_RESOLUTION: Record<RenderQualityTier, number> = { full: 32, balanced: 24, constrained: 16, minimal: 12 };
const ARC_CURVE_RESOLUTION: Record<RenderQualityTier, number> = { full: 28, balanced: 20, constrained: 14, minimal: 10 };
const ARC_CIRCULAR_RESOLUTION: Record<RenderQualityTier, number> = { full: 8, balanced: 6, constrained: 5, minimal: 4 };
const LABEL_RESOLUTION: Record<RenderQualityTier, number> = { full: 3, balanced: 3, constrained: 2, minimal: 2 };
const PIXEL_RATIO_CAP: Record<RenderQualityTier, number> = { full: 2, balanced: 1.5, constrained: 1.25, minimal: 1 };
const TEXTURE_ANISOTROPY_CAP: Record<RenderQualityTier, number> = { full: 8, balanced: 4, constrained: 2, minimal: 1 };
const CLOUD_SEGMENTS: Record<RenderQualityTier, number> = { full: 56, balanced: 40, constrained: 28, minimal: 0 };
const CLOUD_OPACITY_SCALE: Record<RenderQualityTier, number> = { full: 1, balanced: 0.75, constrained: 0.5, minimal: 0 };
const BLOOM_STRENGTH_SCALE: Record<RenderQualityTier, number> = { full: 1, balanced: 0.65, constrained: 0, minimal: 0 };
const SATELLITE_TILE_MAX_LEVEL: Record<RenderQualityTier, number> = { full: 17, balanced: 12, constrained: 9, minimal: 7 };
const TRACK_SAMPLE_COUNT: Record<RenderQualityTier, number> = { full: 8, balanced: 6, constrained: 5, minimal: 4 };
const RING_ANIMATION: Record<RenderQualityTier, RingAnimationMode> = { full: "animated", balanced: "animated", constrained: "slow", minimal: "static" };
const HTML_PULSE: Record<RenderQualityTier, boolean> = { full: true, balanced: true, constrained: false, minimal: false };
const SCANLINES: Record<RenderQualityTier, boolean> = { full: true, balanced: true, constrained: false, minimal: false };

export function globeRenderQualityProfile(tier: RenderQualityTier, detailLevel: RenderDetailLevel): GlobeRenderQualityProfile {
  return {
    tier,
    detailLevel,
    caps: scaleCaps(BASE_CAPS[detailLevel], tier),
    viewportRadiusDegrees: VIEWPORT_RADIUS_BY_DETAIL[detailLevel],
    pointResolution: POINT_RESOLUTION[tier],
    pathResolution: PATH_RESOLUTION[tier],
    ringResolution: RING_RESOLUTION[tier],
    arcCurveResolution: ARC_CURVE_RESOLUTION[tier],
    arcCircularResolution: ARC_CIRCULAR_RESOLUTION[tier],
    labelResolution: LABEL_RESOLUTION[tier],
    pixelRatioCap: PIXEL_RATIO_CAP[tier],
    textureAnisotropyCap: TEXTURE_ANISOTROPY_CAP[tier],
    cloudSegments: CLOUD_SEGMENTS[tier],
    cloudOpacityScale: CLOUD_OPACITY_SCALE[tier],
    enableClouds: tier !== "minimal",
    enableBloom: tier === "full" || tier === "balanced",
    bloomStrengthScale: BLOOM_STRENGTH_SCALE[tier],
    satelliteTileMaxLevel: SATELLITE_TILE_MAX_LEVEL[tier],
    trackSampleCount: TRACK_SAMPLE_COUNT[tier],
    ringAnimation: RING_ANIMATION[tier],
    htmlPulse: HTML_PULSE[tier],
    scanlines: SCANLINES[tier],
  };
}

/**
 * Camera-distance-aware pixel ratio. The altitude thresholds preserve the previous
 * interaction contract, while the tier cap prevents high-DPI/mobile devices from
 * multiplying fragment work beyond the adaptive budget.
 */
export function resolveAdaptivePixelRatio(devicePixelRatio: number, altitude: number, tier: RenderQualityTier): number {
  const altitudeCap = altitude < 0.62 ? 2 : altitude < 1.35 ? 1.6 : 1.25;
  const ratio = Math.min(devicePixelRatio || 1, altitudeCap, PIXEL_RATIO_CAP[tier]);
  return Math.max(0.75, Math.round(ratio * 20) / 20);
}

/** Lower anisotropic filtering at overview distances and raise it for local detail. */
export function resolveTextureAnisotropy(tier: RenderQualityTier, detailLevel: RenderDetailLevel, maxHardwareAnisotropy: number): number {
  const detailScale = detailLevel === 2 ? 1 : detailLevel === 1 ? 0.75 : 0.5;
  const desired = TEXTURE_ANISOTROPY_CAP[tier] * detailScale;
  return Math.max(1, Math.min(maxHardwareAnisotropy, Math.round(desired)));
}

export interface DeviceQualityHints {
  coarsePointer?: boolean;
  narrowViewport?: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  saveData?: boolean;
}

/** Deterministic initial device tier. Runtime adaptation can only degrade and then recover up to this ceiling. */
export function detectDeviceQualityTier(hints: DeviceQualityHints): RenderQualityTier {
  const cores = hints.hardwareConcurrency ?? 8;
  const memory = hints.deviceMemory ?? 8;
  if (hints.saveData || cores <= 2 || memory <= 2) return "constrained";
  if (hints.coarsePointer || hints.narrowViewport || cores <= 4 || memory <= 4) return "balanced";
  return "full";
}

export interface GeoPointLike {
  lat: number;
  lng: number;
}

/** Equirectangular viewport distance with antimeridian wrapping, matching the globe's local-radius approximation. */
export function viewportDistanceDegrees(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const meanLat = ((aLat + bLat) / 2) * Math.PI / 180;
  const dLat = aLat - bLat;
  const wrappedLngDiff = ((aLng - bLng + 540) % 360) - 180;
  const dLng = wrappedLngDiff * Math.cos(meanLat);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export interface ViewportSelectionOptions<T> {
  focusLat: number;
  focusLng: number;
  detailLevel: RenderDetailLevel;
  cap: number;
  viewportRadiusDegrees?: number | null;
  /** Objects that must remain inspectable even when outside the cap or viewport, such as the current selection. */
  preserve?: T[];
}

export interface AdaptiveViewportSelection<T> {
  selected: T[];
  total: number;
  rendered: number;
  /** Rendered records that belong to the input collection; external overlay preserves do not inflate this count. */
  sourceRendered: number;
  omitted: number;
  viewportCandidates: number;
  outsideViewport: number;
  forcedIncluded: number;
  cap: number;
}

/**
 * Selects the first viewport-relevant records in the caller-supplied priority order.
 * The algorithm is deliberately deterministic: no sampling, randomness, or silent dropping.
 */
export function selectViewportAdaptiveItems<T extends GeoPointLike>(
  items: readonly T[],
  options: ViewportSelectionOptions<T>,
): AdaptiveViewportSelection<T> {
  const cap = Math.max(0, Math.floor(options.cap));
  const radius = options.viewportRadiusDegrees === undefined
    ? VIEWPORT_RADIUS_BY_DETAIL[options.detailLevel]
    : options.viewportRadiusDegrees;
  const preserved: T[] = [];
  const preservedSet = new Set<T>();
  for (const item of options.preserve ?? []) {
    if (!preservedSet.has(item)) {
      preservedSet.add(item);
      preserved.push(item);
    }
  }

  const inputSet = new Set(items);
  let forcedPresentInInput = 0;
  for (const item of preserved) if (inputSet.has(item)) forcedPresentInInput += 1;

  const regular: T[] = [];
  let viewportCandidates = 0;
  let outsideViewport = 0;

  for (const item of items) {
    const inViewport = radius === null
      || viewportDistanceDegrees(item.lat, item.lng, options.focusLat, options.focusLng) <= radius;
    if (inViewport) viewportCandidates += 1;
    else outsideViewport += 1;
    if (preservedSet.has(item)) continue;
    if (inViewport && regular.length < cap) regular.push(item);
  }

  const selected = [...preserved, ...regular];
  const sourceRendered = regular.length + forcedPresentInInput;
  return {
    selected,
    total: items.length,
    rendered: selected.length,
    sourceRendered,
    omitted: Math.max(0, items.length - sourceRendered),
    viewportCandidates,
    outsideViewport,
    forcedIncluded: preserved.length,
    cap,
  };
}

export interface RenderRankedEvent extends GeoPointLike {
  id?: string;
  intensity: number;
  occurredAt: number;
}

const rankedEventsCache = new WeakMap<object, unknown[]>();

/** Cached incident priority order; sorting once removes per-camera O(n log n) extraction churn. */
export function rankEventsForRender<T extends RenderRankedEvent>(events: readonly T[]): T[] {
  const cached = rankedEventsCache.get(events);
  if (cached) return cached as T[];
  const ranked = [...events].sort((a, b) =>
    (b.intensity - a.intensity)
    || (b.occurredAt - a.occurredAt)
    || String(a.id ?? "").localeCompare(String(b.id ?? ""))
  );
  rankedEventsCache.set(events, ranked);
  return ranked;
}

export function selectAdaptiveEvents<T extends RenderRankedEvent>(
  events: readonly T[],
  focusLat: number,
  focusLng: number,
  detailLevel: RenderDetailLevel,
  cap: number,
  preserve?: T[],
): AdaptiveViewportSelection<T> {
  return selectViewportAdaptiveItems(rankEventsForRender(events), {
    focusLat,
    focusLng,
    detailLevel,
    cap,
    preserve,
  });
}

export interface TrackProjectionInput extends GeoPointLike {
  track: number | null | undefined;
  speed: number | null | undefined;
}

export interface TrackProjectionOptions {
  minSpeed: number;
  horizonHours: number;
  sampleCount: number;
  maximumDistanceNm?: number;
  baseAltitude?: number;
  altitudeGain?: number;
}

/**
 * Great-circle dead-reckoning samples. With sampleCount=8 this is byte-for-byte the
 * historical eight-point interpolation; lower counts use the same endpoints deterministically.
 */
export function projectTrackPoints<T extends TrackProjectionInput>(
  item: T,
  options: TrackProjectionOptions,
): [number, number, number][] | null {
  if (typeof item.track !== "number" || typeof item.speed !== "number" || item.speed <= options.minSpeed) return null;
  const sampleCount = Math.max(2, Math.floor(options.sampleCount));
  const distanceNm = Math.min(options.maximumDistanceNm ?? 260, item.speed * options.horizonHours);
  const angularDistance = distanceNm / 3440.065;
  const bearing = (item.track * Math.PI) / 180;
  const lat1 = (item.lat * Math.PI) / 180;
  const lng1 = (item.lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  const endLat = (lat2 * 180) / Math.PI;
  let endLng = ((lng2 * 180) / Math.PI + 540) % 360 - 180;
  if (Math.abs(endLng - item.lng) > 180) endLng = item.lng;
  const baseAltitude = options.baseAltitude ?? 0.018;
  const altitudeGain = options.altitudeGain ?? 0.004;
  const points: [number, number, number][] = [];
  for (let step = 0; step < sampleCount; step += 1) {
    const t = step / (sampleCount - 1);
    points.push([
      item.lat + (endLat - item.lat) * t,
      item.lng + (endLng - item.lng) * t,
      baseAltitude + t * altitudeGain,
    ]);
  }
  return points;
}

const trackProjectionCache = new WeakMap<object, Map<string, [number, number, number][] | null>>();

/** Weak-keyed immutable-input projection cache shared across camera-density changes. */
export function cachedTrackProjectionFor<T extends object>(
  owner: T,
  input: TrackProjectionInput,
  options: TrackProjectionOptions,
): [number, number, number][] | null {
  const key = [
    input.lat,
    input.lng,
    input.track ?? "x",
    input.speed ?? "x",
    options.minSpeed,
    options.horizonHours,
    options.sampleCount,
    options.maximumDistanceNm ?? 260,
    options.baseAltitude ?? 0.018,
    options.altitudeGain ?? 0.004,
  ].join(":");
  let forItem = trackProjectionCache.get(owner);
  if (!forItem) {
    forItem = new Map();
    trackProjectionCache.set(owner, forItem);
  }
  if (!forItem.has(key)) forItem.set(key, projectTrackPoints(input, options));
  return forItem.get(key) ?? null;
}

export function cachedTrackProjection<T extends TrackProjectionInput>(
  item: T,
  options: TrackProjectionOptions,
): [number, number, number][] | null {
  return cachedTrackProjectionFor(item, item, options);
}

/** Deterministically resamples a fixed polyline while preserving both endpoints. */
export function resampleTrackPoints(points: readonly [number, number, number][], sampleCount: number): [number, number, number][] {
  const target = Math.max(2, Math.floor(sampleCount));
  if (points.length <= target) return [...points];
  const result: [number, number, number][] = [];
  for (let index = 0; index < target; index += 1) {
    const sourceIndex = Math.round((index / (target - 1)) * (points.length - 1));
    result.push(points[sourceIndex]);
  }
  return result;
}

export interface BatchedParticleEntry<T> {
  item: T;
  kind: string;
  color: string;
  size: number;
}

export interface BatchedParticleGroup<T> extends Array<T> {
  particleKey: string;
  particleKind: string;
  particleColor: string;
  particleSize: number;
}

/** Groups same-visual records so globe.gl can render each group as one THREE.Points buffer. */
export function createBatchedParticleGroups<T>(entries: readonly BatchedParticleEntry<T>[]): BatchedParticleGroup<T>[] {
  const groups: BatchedParticleGroup<T>[] = [];
  const byKey = new Map<string, BatchedParticleGroup<T>>();
  for (const entry of entries) {
    const size = Math.round(entry.size * 1000) / 1000;
    const key = `${entry.kind}|${entry.color}|${size.toFixed(3)}`;
    let group = byKey.get(key);
    if (!group) {
      group = [] as unknown as BatchedParticleGroup<T>;
      group.particleKey = key;
      group.particleKind = entry.kind;
      group.particleColor = entry.color;
      group.particleSize = size;
      byKey.set(key, group);
      groups.push(group);
    }
    group.push(entry.item);
  }
  return groups;
}

/** Converts the cylinder radius unit used by globe.gl points into approximate world-unit point-sprite size. */
export function particleSizeForPointRadius(radiusDegrees: number): number {
  const globeRadius = 100;
  const cylinderDiameter = radiusDegrees * 2 * ((2 * Math.PI * globeRadius) / 360);
  return Math.max(0.055, Math.round(cylinderDiameter * 1.15 * 1000) / 1000);
}

export interface RenderedCountAccount {
  total: number;
  rendered: number;
  omitted: number;
  viewportCandidates?: number;
  outsideViewport?: number;
  cap?: number;
  forcedIncluded?: number;
}

export function accountFromSelection<T>(selection: AdaptiveViewportSelection<T>): RenderedCountAccount {
  return {
    total: selection.total,
    rendered: selection.rendered,
    omitted: selection.omitted,
    viewportCandidates: selection.viewportCandidates,
    outsideViewport: selection.outsideViewport,
    cap: selection.cap,
    forcedIncluded: selection.forcedIncluded,
  };
}

export function accountForCappedLayer(total: number, rendered: number, cap: number): RenderedCountAccount {
  return {
    total,
    rendered,
    omitted: Math.max(0, total - rendered),
    cap,
  };
}

export type RenderAccountKey =
  | "incidents"
  | "militaryAircraft"
  | "civilAircraft"
  | "vessels"
  | "satellites"
  | "launches"
  | "naturalEvents"
  | "gpsInterference"
  | "internetOutages"
  | "gdeltGeoNews"
  | "ringBeacons"
  | "htmlAlertMarkers";

export const RENDER_ACCOUNT_KEYS: RenderAccountKey[] = [
  "incidents",
  "militaryAircraft",
  "civilAircraft",
  "vessels",
  "satellites",
  "launches",
  "naturalEvents",
  "gpsInterference",
  "internetOutages",
  "gdeltGeoNews",
  "ringBeacons",
  "htmlAlertMarkers",
];

export interface GodEyeRenderStatus {
  qualityTier: RenderQualityTier;
  runtimeQualityTier: RenderQualityTier;
  detailLevel: RenderDetailLevel;
  detailLabel: string;
  reducedEffects: boolean;
  pixelRatio: number;
  frameP80Ms: number | null;
  frameWindows: number;
  adaptationLabel: string;
  batchingLabel: string;
  accounts: Record<RenderAccountKey, RenderedCountAccount>;
  renderedTotal: number;
  omittedTotal: number;
}

export function summarizeRenderAccounts(accounts: Record<RenderAccountKey, RenderedCountAccount>): { renderedTotal: number; omittedTotal: number } {
  let renderedTotal = 0;
  let omittedTotal = 0;
  for (const key of RENDER_ACCOUNT_KEYS) {
    renderedTotal += accounts[key]?.rendered ?? 0;
    omittedTotal += accounts[key]?.omitted ?? 0;
  }
  return { renderedTotal, omittedTotal };
}

function semanticStatusKey(status: GodEyeRenderStatus): string {
  return JSON.stringify([
    status.qualityTier,
    status.runtimeQualityTier,
    status.detailLevel,
    status.reducedEffects,
    status.pixelRatio,
    status.frameP80Ms === null ? null : Math.round(status.frameP80Ms * 10) / 10,
    status.frameWindows,
    status.adaptationLabel,
    status.batchingLabel,
    RENDER_ACCOUNT_KEYS.map((key) => {
      const account = status.accounts[key];
      return [
        account.total,
        account.rendered,
        account.omitted,
        account.viewportCandidates ?? -1,
        account.outsideViewport ?? -1,
        account.cap ?? -1,
        account.forcedIncluded ?? -1,
      ];
    }),
  ]);
}

export interface GlobeRenderStatusStore {
  getSnapshot: () => GodEyeRenderStatus | null;
  subscribe: (listener: () => void) => () => void;
  publish: (status: GodEyeRenderStatus) => boolean;
}

/** Tiny external store so high-frequency render diagnostics do not re-render the command-center tree. */
export function createGlobeRenderStatusStore(): GlobeRenderStatusStore {
  let snapshot: GodEyeRenderStatus | null = null;
  let snapshotKey = "";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(status) {
      const nextKey = semanticStatusKey(status);
      if (nextKey === snapshotKey) return false;
      snapshot = status;
      snapshotKey = nextKey;
      for (const listener of listeners) listener();
      return true;
    },
  };
}

export interface FrameBudgetTransition {
  previousTier: RenderQualityTier;
  tier: RenderQualityTier;
  reason: "over-budget" | "recovered";
  p80Ms: number;
  windowsCompleted: number;
}

export interface FrameBudgetSnapshot {
  tier: RenderQualityTier;
  p80Ms: number | null;
  windowsCompleted: number;
  overBudgetWindows: number;
  goodWindows: number;
}

/**
 * Fixed-window deterministic frame-budget controller. Given the same frame-delta sequence
 * it always emits the same tier transitions; there is no random backoff or wall-clock state.
 */
export class FrameBudgetController {
  private readonly initialTier: RenderQualityTier;
  private readonly targetFrameMs: number;
  private readonly windowFrames: number;
  private readonly warmupFrames: number;
  private tier: RenderQualityTier;
  private frameCount = 0;
  private windowDeltas: number[] = [];
  private windowsCompleted = 0;
  private windowsSinceChange = 0;
  private overBudgetWindows = 0;
  private goodWindows = 0;
  private lastP80Ms: number | null = null;

  constructor(options: { initialTier: RenderQualityTier; targetFrameMs?: number; windowFrames?: number; warmupFrames?: number }) {
    this.initialTier = options.initialTier;
    this.tier = options.initialTier;
    this.targetFrameMs = options.targetFrameMs ?? 16.67;
    this.windowFrames = Math.max(8, Math.floor(options.windowFrames ?? 60));
    this.warmupFrames = Math.max(0, Math.floor(options.warmupFrames ?? 30));
  }

  sample(deltaMs: number): FrameBudgetTransition | null {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;
    this.frameCount += 1;
    if (this.frameCount <= this.warmupFrames) return null;
    this.windowDeltas.push(deltaMs);
    if (this.windowDeltas.length < this.windowFrames) return null;

    const ordered = [...this.windowDeltas].sort((a, b) => a - b);
    const p80 = ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * 0.8))];
    this.windowDeltas = [];
    this.windowsCompleted += 1;
    this.windowsSinceChange += 1;
    this.lastP80Ms = p80;

    const overBudget = p80 > this.targetFrameMs * 1.25;
    const severelyOverBudget = p80 > this.targetFrameMs * 1.8;
    const comfortablyGood = p80 < this.targetFrameMs * 0.72;
    this.overBudgetWindows = overBudget ? this.overBudgetWindows + 1 : 0;
    this.goodWindows = comfortablyGood ? this.goodWindows + 1 : 0;

    const currentIndex = renderQualityTierIndex(this.tier);
    if ((severelyOverBudget || this.overBudgetWindows >= 2) && currentIndex < RENDER_QUALITY_TIERS.length - 1) {
      const previousTier = this.tier;
      this.tier = RENDER_QUALITY_TIERS[currentIndex + 1];
      this.windowsSinceChange = 0;
      this.overBudgetWindows = 0;
      this.goodWindows = 0;
      return { previousTier, tier: this.tier, reason: "over-budget", p80Ms: p80, windowsCompleted: this.windowsCompleted };
    }

    const initialIndex = renderQualityTierIndex(this.initialTier);
    if (this.goodWindows >= 4 && currentIndex > initialIndex && this.windowsSinceChange >= 2) {
      const previousTier = this.tier;
      this.tier = RENDER_QUALITY_TIERS[currentIndex - 1];
      this.windowsSinceChange = 0;
      this.overBudgetWindows = 0;
      this.goodWindows = 0;
      return { previousTier, tier: this.tier, reason: "recovered", p80Ms: p80, windowsCompleted: this.windowsCompleted };
    }

    return null;
  }

  snapshot(): FrameBudgetSnapshot {
    return {
      tier: this.tier,
      p80Ms: this.lastP80Ms,
      windowsCompleted: this.windowsCompleted,
      overBudgetWindows: this.overBudgetWindows,
      goodWindows: this.goodWindows,
    };
  }
}
