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
  /** Whether signal-arc dash animation runs. Static arcs still render; only the flow animation stops. */
  animateArcs: boolean;
  vignette: boolean;
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

/**
 * Orbital propagation cadence by tier. Satellites move slowly enough that position freshness
 * below a few seconds is imperceptible at cartographic scale, while every propagation round
 * forces a particle-buffer rebake; constrained devices trade freshness for frame cost.
 */
export function satellitePropagationIntervalMs(tier: RenderQualityTier): number {
  if (tier === "minimal") return 30000;
  if (tier === "constrained") return 20000;
  return 10000;
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

/** Canonical viewport radius contract shared by the JS fallback and the WASM spatial index. */
export function viewportRadiusDegreesForDetail(detailLevel: RenderDetailLevel): number | null {
  return VIEWPORT_RADIUS_BY_DETAIL[detailLevel];
}

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
const ANIMATE_ARCS: Record<RenderQualityTier, boolean> = { full: true, balanced: true, constrained: true, minimal: false };
const VIGNETTE: Record<RenderQualityTier, boolean> = { full: true, balanced: true, constrained: true, minimal: false };

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
    animateArcs: ANIMATE_ARCS[tier],
    vignette: VIGNETTE[tier],
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
  /**
   * Optional logical-entity key used to match preserved records against the input collection.
   * Feeds refresh object identities every few minutes: without keys, a preserved record that is
   * still present in the input under a fresh object identity would render twice (once as the
   * stale preserved overlay, once as a regular viewport candidate). When a key match exists the
   * fresh input record is force-included instead, so accounting and rendering stay truthful.
   * Keys may be object identities, strings, or numbers; identity matching is the fallback.
   */
  keyOf?: (item: T) => unknown;
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
 *
 * Preservation semantics: each distinct preserved record is matched against the input first by
 * `keyOf` (when supplied) and otherwise by object identity. A matched input record is rendered
 * in place of the preserved copy — never twice — and counts as source-rendered; an unmatched
 * preserved record renders as a transparent overlay outside the input accounting.
 */
export function selectViewportAdaptiveItems<T extends GeoPointLike>(
  items: readonly T[],
  options: ViewportSelectionOptions<T>,
): AdaptiveViewportSelection<T> {
  const cap = Math.max(0, Math.floor(options.cap));
  const radius = options.viewportRadiusDegrees === undefined
    ? viewportRadiusDegreesForDetail(options.detailLevel)
    : options.viewportRadiusDegrees;
  const keyOf = options.keyOf;

  const preserved: T[] = [];
  const seenPreservedKeys = new Set<unknown>();
  for (const item of options.preserve ?? []) {
    const key = keyOf ? keyOf(item) : item;
    if (!seenPreservedKeys.has(key)) {
      seenPreservedKeys.add(key);
      preserved.push(item);
    }
  }

  const inputByKey = new Map<unknown, T>();
  if (keyOf) {
    for (const item of items) {
      const key = keyOf(item);
      if (!inputByKey.has(key)) inputByKey.set(key, item);
    }
  }
  const inputSet = keyOf ? null : new Set(items);

  // Resolve each preserved record to the record that should actually render: the fresh input
  // record when one exists for the same logical entity, otherwise the preserved copy itself.
  const forcedInputItems = new Set<T>();
  const preservedRenderOrder: T[] = [];
  for (const item of preserved) {
    const match = keyOf ? inputByKey.get(keyOf(item)) : inputSet?.has(item) ? item : undefined;
    if (match !== undefined) {
      if (!forcedInputItems.has(match)) {
        forcedInputItems.add(match);
        preservedRenderOrder.push(match);
      }
    } else {
      preservedRenderOrder.push(item);
    }
  }

  const regular: T[] = [];
  let viewportCandidates = 0;
  let outsideViewport = 0;

  for (const item of items) {
    const inViewport = radius === null
      || viewportDistanceDegrees(item.lat, item.lng, options.focusLat, options.focusLng) <= radius;
    if (inViewport) viewportCandidates += 1;
    else outsideViewport += 1;
    if (forcedInputItems.has(item)) continue;
    if (inViewport && regular.length < cap) regular.push(item);
  }

  const selected = [...preservedRenderOrder, ...regular];
  const sourceRendered = regular.length + forcedInputItems.size;
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

/**
 * Canonical incident priority comparator. The `||` chaining is deliberate: NaN intensity or
 * time differences are falsy in JavaScript and therefore fall through exactly as they did in
 * the historical render ordering. Stable array sorting then preserves input order for total ties.
 */
export function compareRenderRankedEvents<T extends RenderRankedEvent>(a: T, b: T): number {
  return (b.intensity - a.intensity)
    || (b.occurredAt - a.occurredAt)
    || String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

/** Cached incident priority order; sorting once removes per-camera O(n log n) extraction churn. */
export function rankEventsForRender<T extends RenderRankedEvent>(events: readonly T[]): T[] {
  const cached = rankedEventsCache.get(events);
  if (cached) return cached as T[];
  const ranked = [...events].sort(compareRenderRankedEvents);
  rankedEventsCache.set(events, ranked);
  return ranked;
}

/**
 * Priority order as source-array indices. This is the index-based twin of
 * `rankEventsForRender`: both use the same comparator and JavaScript's stable sort, so equal
 * keys retain source order in both representations. The WASM loader consumes this permutation
 * once and can thereafter return compact source indices without serializing incident rows.
 */
export function rankEventIndicesForRender<T extends RenderRankedEvent>(events: readonly T[]): number[] {
  return events
    .map((_, index) => index)
    .sort((a, b) => compareRenderRankedEvents(events[a], events[b]));
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
    // Incident records carry stable ids across feed refreshes; fall back to object identity.
    keyOf: (item) => item.id ?? item,
  });
}

/**
 * Compact spatial-result page returned by an accelerator. `indices` contains source-array
 * indices in canonical incident-priority order, already viewport-filtered and sliced to the
 * caller-requested cap. The two spatial counts describe the complete input, not merely the
 * returned page, so adaptive omission accounting remains exact.
 */
export interface PrioritizedIncidentSpatialPage {
  indices: ArrayLike<number>;
  viewportCandidates: number;
  outsideViewport: number;
}

export interface IncidentSpatialPageCompositionOptions<T> {
  cap: number;
  preserve?: T[];
}

/**
 * Composes a compact accelerated spatial page into the exact public selection contract.
 *
 * This function deliberately reuses the preservation/key semantics of
 * `selectViewportAdaptiveItems`: a preserved incident resolves to the first same-key input row
 * in priority order, fresh input rows replace stale preserved object identities, unmatched
 * preserved rows remain overlay ghosts, forced rows never occupy a regular cap slot, and
 * source/omitted accounting excludes ghosts. Any malformed accelerator page returns `null`
 * so callers can fall back to the canonical JavaScript scan instead of compromising semantics.
 */
export function selectAdaptiveEventsFromSpatialPage<T extends RenderRankedEvent>(
  events: readonly T[],
  priorityOrder: readonly number[],
  page: PrioritizedIncidentSpatialPage,
  options: IncidentSpatialPageCompositionOptions<T>,
): AdaptiveViewportSelection<T> | null {
  if (priorityOrder.length !== events.length) return null;
  if (!Number.isFinite(options.cap)) return null;
  if (!Number.isSafeInteger(page.viewportCandidates) || !Number.isSafeInteger(page.outsideViewport)) return null;
  if (page.viewportCandidates < 0 || page.outsideViewport < 0) return null;
  if (page.viewportCandidates + page.outsideViewport !== events.length) return null;

  const cap = Math.max(0, Math.floor(options.cap));
  const keyOf = (item: T): unknown => item.id ?? item;

  // Duplicate the generic algorithm's preserved-key de-duplication exactly.
  const preserved: T[] = [];
  const seenPreservedKeys = new Set<unknown>();
  for (const item of options.preserve ?? []) {
    const key = keyOf(item);
    if (!seenPreservedKeys.has(key)) {
      seenPreservedKeys.add(key);
      preserved.push(item);
    }
  }

  // Keys are matched in priority order, not source order. This matters only for adversarial
  // duplicate ids, and matching it keeps even those inputs byte-for-byte compatible with the
  // JavaScript fallback. When nothing is preserved the map is not built at all.
  const forcedInputIndexes = new Set<number>();
  const forcedInputItems = new Set<T>();
  const preservedRenderOrder: T[] = [];
  if (preserved.length > 0) {
    const inputIndexByKey = new Map<unknown, number>();
    for (const sourceIndex of priorityOrder) {
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= events.length) return null;
      const item = events[sourceIndex];
      const key = keyOf(item);
      if (!inputIndexByKey.has(key)) inputIndexByKey.set(key, sourceIndex);
    }

    for (const item of preserved) {
      const matchIndex = inputIndexByKey.get(keyOf(item));
      if (matchIndex !== undefined) {
        if (!forcedInputIndexes.has(matchIndex)) {
          forcedInputIndexes.add(matchIndex);
          forcedInputItems.add(events[matchIndex]);
          preservedRenderOrder.push(events[matchIndex]);
        }
      } else {
        preservedRenderOrder.push(item);
      }
    }
  }

  const regular: T[] = [];
  const seenPageIndexes = new Set<number>();
  for (let offset = 0; offset < page.indices.length; offset += 1) {
    const sourceIndex = page.indices[offset];
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= events.length) return null;
    if (forcedInputIndexes.has(sourceIndex) || forcedInputItems.has(events[sourceIndex]) || seenPageIndexes.has(sourceIndex)) continue;
    seenPageIndexes.add(sourceIndex);
    if (regular.length < cap) regular.push(events[sourceIndex]);
  }

  const selected = [...preservedRenderOrder, ...regular];
  const sourceRendered = regular.length + forcedInputItems.size;
  return {
    selected,
    total: events.length,
    rendered: selected.length,
    sourceRendered,
    omitted: Math.max(0, events.length - sourceRendered),
    viewportCandidates: page.viewportCandidates,
    outsideViewport: page.outsideViewport,
    forcedIncluded: preserved.length,
    cap,
  };
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

type TaggedGlobeObject<T extends object, Kind extends string> = T & { objectKind: Kind };
const globeObjectKindCache = new WeakMap<object, Map<string, object>>();
const globeObjectSourceCache = new WeakMap<object, object>();

/**
 * Stable object identity across viewport-density recomputation; inputs are immutable
 * snapshot/filter records. globe.gl digests layers by object identity, so reusing the tagged
 * record avoids rebuilding unchanged meshes. The source record is recoverable through
 * `untagGlobeObject`, which keeps rendering concerns out of selection/inspection state.
 */
export function tagGlobeObject<T extends object, Kind extends string>(item: T, objectKind: Kind): TaggedGlobeObject<T, Kind> {
  let byKind = globeObjectKindCache.get(item);
  if (!byKind) {
    byKind = new Map();
    globeObjectKindCache.set(item, byKind);
  }
  const cached = byKind.get(objectKind);
  if (cached) return cached as TaggedGlobeObject<T, Kind>;
  const tagged = Object.assign({}, item, { objectKind }) as TaggedGlobeObject<T, Kind>;
  byKind.set(objectKind, tagged);
  globeObjectSourceCache.set(tagged, item);
  return tagged;
}

/**
 * Recovers the original source record for a tagged globe object. Selection callbacks must hand
 * source records — not render-tagged copies — to parents, or preservation matching, detail
 * panels, and permalink/export state would accumulate rendering artifacts and duplicate work.
 * Untagged input is returned unchanged.
 */
export function untagGlobeObject<T extends object>(item: T): T {
  return (globeObjectSourceCache.get(item) as T | undefined) ?? item;
}

export interface RenderedCountAccount {
  total: number;
  rendered: number;
  omitted: number;
  viewportCandidates?: number;
  outsideViewport?: number;
  cap?: number;
  forcedIncluded?: number;
  /**
   * Operator layer-toggle state at publish time. Accounts always describe the adaptive pipeline
   * (what would render with the layer enabled); summaries and UI use this flag to avoid claiming
   * that objects in a toggled-off layer are on screen.
   */
  layerEnabled?: boolean;
}

/** Attaches the operator layer-toggle state to an adaptive account without altering its pipeline numbers. */
export function accountWithLayerEnabled(account: RenderedCountAccount, layerEnabled: boolean): RenderedCountAccount {
  return { ...account, layerEnabled };
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
  | "htmlAlertMarkers"
  | "theaterLabels"
  | "signalArcs";

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
  "theaterLabels",
  "signalArcs",
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

/**
 * Totals objects actually on screen. Layers the operator toggled off contribute nothing:
 * their adaptive pipeline still computes selections, but claiming those objects as rendered
 * (or their culling as adaptive omission) would misstate what the render shows.
 */
export function summarizeRenderAccounts(accounts: Record<RenderAccountKey, RenderedCountAccount>): { renderedTotal: number; omittedTotal: number } {
  let renderedTotal = 0;
  let omittedTotal = 0;
  for (const key of RENDER_ACCOUNT_KEYS) {
    const account = accounts[key];
    if (!account || account.layerEnabled === false) continue;
    renderedTotal += account.rendered;
    omittedTotal += account.omitted;
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
        account.layerEnabled === false ? 0 : 1,
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
