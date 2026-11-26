import type { CategoryGroup, ConflictFilters, SeverityKey, TimeWindowKey } from "@/types/conflict";
import type { PlaybackMode, TemporalResolutionPreference } from "@/lib/incidentTime";
import type { GodEyeLayerToggles, GodEyeVisualMode } from "@/components/godseye/GodEyeGlobe";

/**
 * Versioned, compact operator-workspace encoding for static deployments.
 *
 * Version 1 is a URL fragment (`#s1.<base64url-json>`), not a query parameter:
 * the fragment is never sent to a static host, works unchanged below a GitHub
 * Pages base path, and does not depend on Next.js routing or a backend. Values
 * inside the JSON envelope use short keys and bit masks. Missing keys always
 * decode to the backwards-compatible defaults below; unknown keys are ignored
 * so additive future versions can coexist with this reader.
 */
export const OPERATOR_URL_STATE_VERSION = 1;
export const OPERATOR_URL_FRAGMENT_PREFIX = `s${OPERATOR_URL_STATE_VERSION}.`;
export const MAX_OPERATOR_URL_FRAGMENT_LENGTH = 1800;
export const MAX_OPERATOR_QUERY_LENGTH = 240;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_LOOKUP = new Map([...BASE64URL_ALPHABET].map((character, index) => [character, index]));

const VISUAL_MODE_ORDER: readonly GodEyeVisualMode[] = ["cinematic", "satellite"];
const TIME_WINDOW_ORDER: readonly TimeWindowKey[] = ["24h", "7d", "30d", "all"];
const CATEGORY_GROUP_ORDER: readonly CategoryGroup[] = ["kinetic", "security", "humanitarian", "political", "strategic"];
const SEVERITY_ORDER_FOR_URL: readonly SeverityKey[] = ["critical", "high", "medium", "low"];
const LAYER_ORDER: readonly (keyof GodEyeLayerToggles)[] = [
  "density",
  "beacons",
  "signals",
  "theaterLabels",
  "borders",
  "clouds",
  "orbitalAssets",
  "aircraft",
  "civilAviation",
  "maritime",
  "environmental",
  "gpsInterference",
  "internetOutages",
  "gdeltGeoNews",
  "reliefwebHumanitarian",
];
const PANEL_INSPECTOR_ORDER = ["feed", "convergence", "watch"] as const;
const PLAYBACK_MODE_ORDER: readonly PlaybackMode[] = ["step", "trailing", "cumulative"];
const PLAYBACK_RESOLUTION_ORDER: readonly TemporalResolutionPreference[] = ["auto", "hour", "sixHour", "day", "week"];
const PLAYBACK_SPEED_ORDER = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;
const PLAYBACK_TRAIL_ORDER_HOURS = [24, 72, 168, 720] as const;

const DEFAULT_TIME_WINDOW_INDEX = TIME_WINDOW_ORDER.indexOf("30d");
const DEFAULT_CATEGORY_MASK = maskForValues(["kinetic", "security", "strategic"], CATEGORY_GROUP_ORDER);
const DEFAULT_SEVERITY_MASK = maskForValues(SEVERITY_ORDER_FOR_URL, SEVERITY_ORDER_FOR_URL);
const DEFAULT_PLAYBACK_SPEED_INDEX = PLAYBACK_SPEED_ORDER.indexOf(1);
const DEFAULT_PLAYBACK_TRAIL_INDEX = PLAYBACK_TRAIL_ORDER_HOURS.indexOf(168);
const DEFAULT_PANEL_MASK = 1 | 2; // theater list + incident panel open, source status closed
const MIN_FRAME_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const MAX_FRAME_TIMESTAMP_MS = Date.UTC(2100, 0, 1);
const MAX_FRAME_INDEX = 1_000_000;

export interface OperatorCameraUrlState {
  lat: number;
  lng: number;
  altitude: number;
}

export interface OperatorPanelUrlState {
  theater: boolean;
  incident: boolean;
  source: boolean;
  inspector: (typeof PANEL_INSPECTOR_ORDER)[number];
}

export interface OperatorPlaybackUrlState {
  active: boolean;
  playing: boolean;
  mode: PlaybackMode;
  /** Zero-based frame in the deterministic playback grid, when one was captured. */
  frameIndex: number | null;
  /** Frame start in epoch milliseconds. This is preferred over the corpus-dependent index when it aligns exactly. */
  frameStart: number | null;
  speedMultiplier: number;
  resolutionPreference: TemporalResolutionPreference;
  trailHours: number;
}

export interface OperatorUrlState {
  visualMode: GodEyeVisualMode;
  layers: GodEyeLayerToggles;
  filters: ConflictFilters;
  selectedEventId: string | null;
  /** Automatic intelligence-refresh pause state, not temporal playback transport state. */
  refreshPaused: boolean;
  panels: OperatorPanelUrlState;
  playback: OperatorPlaybackUrlState;
  /** Optional camera center. Absence means "no fixed camera constraint", not a fabricated default. */
  camera: OperatorCameraUrlState | null;
}

/** Mirrors the command-center default layer composition. */
export const DEFAULT_OPERATOR_LAYERS: GodEyeLayerToggles = {
  density: true,
  beacons: true,
  signals: true,
  theaterLabels: true,
  borders: true,
  clouds: true,
  orbitalAssets: false,
  aircraft: true,
  civilAviation: true,
  maritime: true,
  environmental: false,
  gpsInterference: true,
  internetOutages: true,
  gdeltGeoNews: true,
  reliefwebHumanitarian: true,
};

export function createDefaultOperatorUrlState(): OperatorUrlState {
  return {
    visualMode: "cinematic",
    layers: { ...DEFAULT_OPERATOR_LAYERS },
    filters: {
      timeWindow: "30d",
      categoryGroups: ["kinetic", "security", "strategic"],
      severities: ["critical", "high", "medium", "low"],
      theater: null,
      query: "",
    },
    selectedEventId: null,
    refreshPaused: false,
    panels: {
      theater: true,
      incident: true,
      source: false,
      inspector: "feed",
    },
    playback: {
      active: false,
      playing: false,
      mode: "trailing",
      frameIndex: null,
      frameStart: null,
      speedMultiplier: 1,
      resolutionPreference: "auto",
      trailHours: 168,
    },
    camera: null,
  };
}

function maskForValues<T extends string>(values: readonly T[], order: readonly T[]): number {
  let mask = 0;
  const unique = new Set(values);
  order.forEach((value, index) => {
    if (unique.has(value)) mask |= 1 << index;
  });
  return mask;
}

function valuesForMask<T extends string>(mask: number, order: readonly T[]): T[] {
  return order.filter((_, index) => (mask & (1 << index)) !== 0);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;
    output += BASE64URL_ALPHABET[(combined >> 18) & 63];
    output += BASE64URL_ALPHABET[(combined >> 12) & 63];
    if (index + 1 < bytes.length) output += BASE64URL_ALPHABET[(combined >> 6) & 63];
    if (index + 2 < bytes.length) output += BASE64URL_ALPHABET[combined & 63];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of value) {
    const digit = BASE64URL_LOOKUP.get(character);
    if (digit === undefined) return null;
    accumulator = (accumulator << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  // Reject non-canonical trailing bits so a hostile or hand-edited payload cannot
  // encode multiple byte streams that look superficially similar.
  if (accumulator !== 0) return null;
  return Uint8Array.from(bytes);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerInRange(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function enumIndex(value: unknown, count: number): number | null {
  return integerInRange(value, 0, count - 1);
}

function validTheaterSlug(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,95}$/.test(value) ? value : null;
}

function validEventId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,160}$/.test(value) ? value : null;
}

/**
 * Conservative detector for credential-shaped text. It is not a data-loss-prevention
 * product; it is a final safety net because the permalink feature must never become
 * a convenient exfiltration vector for tokens typed into the wrong field.
 */
export function looksLikeSecretMaterial(value: string): boolean {
  return (
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value) ||
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value) ||
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value) ||
    /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{10,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/.test(value) ||
    /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i.test(value) ||
    /\b(?:api[_-]?key|token|access[_-]?token|auth[_-]?token|secret|password|passwd|bearer)\s*[:=]\s*\S+/i.test(value)
  );
}

export function sanitizeOperatorQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > MAX_OPERATOR_QUERY_LENGTH) return null;
  // Control characters make links difficult to inspect and are never meaningful in
  // the single-line incident search control.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return null;
  if (looksLikeSecretMaterial(normalized)) return null;
  return normalized;
}

function normalizeLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function sanitizedCamera(value: unknown): OperatorCameraUrlState | null {
  if (!isObjectRecord(value)) return null;
  const { lat, lng, altitude } = value;
  if (
    typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lng !== "number" || !Number.isFinite(lng) ||
    typeof altitude !== "number" || !Number.isFinite(altitude) || altitude < 0.15 || altitude > 5
  ) {
    return null;
  }
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(normalizeLongitude(lng) * 1000) / 1000,
    altitude: Math.round(altitude * 1000) / 1000,
  };
}

function validPlaybackFrameIndex(value: unknown): number | null {
  return integerInRange(value, 0, MAX_FRAME_INDEX);
}

function validPlaybackFrameStart(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_FRAME_TIMESTAMP_MS && value < MAX_FRAME_TIMESTAMP_MS
    ? Math.round(value)
    : null;
}

function fixedOrderValue<T extends string | number>(value: T, order: readonly T[], fallback: T): T {
  return order.includes(value) ? value : fallback;
}

/** Encode state as the fragment body (without the leading `#`), or null when guardrails are exceeded. */
export function encodeOperatorUrlState(input: OperatorUrlState): string | null {
  const defaults = createDefaultOperatorUrlState();
  const wire: Record<string, unknown> = {};

  const visualMode = fixedOrderValue(input.visualMode, VISUAL_MODE_ORDER, defaults.visualMode);
  const visualModeIndex = VISUAL_MODE_ORDER.indexOf(visualMode);
  if (visualModeIndex !== 0) wire.m = visualModeIndex;

  const layers = { ...defaults.layers, ...input.layers };
  const layerMask = maskForValues(LAYER_ORDER.filter((key) => Boolean(layers[key])), LAYER_ORDER);
  const defaultLayerMask = maskForValues(LAYER_ORDER.filter((key) => Boolean(defaults.layers[key])), LAYER_ORDER);
  if (layerMask !== defaultLayerMask) wire.l = layerMask;

  const timeWindow = fixedOrderValue(input.filters.timeWindow, TIME_WINDOW_ORDER, defaults.filters.timeWindow);
  const timeWindowIndex = TIME_WINDOW_ORDER.indexOf(timeWindow);
  if (timeWindowIndex !== DEFAULT_TIME_WINDOW_INDEX) wire.tw = timeWindowIndex;

  const categoryGroups = CATEGORY_GROUP_ORDER.filter((group) => input.filters.categoryGroups.includes(group));
  const categoryMask = maskForValues(categoryGroups, CATEGORY_GROUP_ORDER);
  if (categoryMask !== DEFAULT_CATEGORY_MASK) wire.cg = categoryMask;

  const severities = SEVERITY_ORDER_FOR_URL.filter((severity) => input.filters.severities.includes(severity));
  const severityMask = maskForValues(severities, SEVERITY_ORDER_FOR_URL);
  if (severityMask !== DEFAULT_SEVERITY_MASK) wire.sv = severityMask;

  const theater = validTheaterSlug(input.filters.theater);
  if (theater) wire.th = theater;

  const query = sanitizeOperatorQuery(input.filters.query);
  if (query) wire.q = query;

  const selectedEventId = validEventId(input.selectedEventId);
  if (selectedEventId) wire.ev = selectedEventId;

  if (input.refreshPaused === true) wire.rp = 1;

  const panels = { ...defaults.panels, ...input.panels };
  const panelMask = (panels.theater ? 1 : 0) | (panels.incident ? 2 : 0) | (panels.source ? 4 : 0);
  if (panelMask !== DEFAULT_PANEL_MASK) wire.pn = panelMask;
  const inspector = fixedOrderValue(panels.inspector, PANEL_INSPECTOR_ORDER, defaults.panels.inspector);
  const inspectorIndex = PANEL_INSPECTOR_ORDER.indexOf(inspector);
  if (inspectorIndex !== 0) wire.pi = inspectorIndex;

  if (input.playback.active === true) {
    const playbackWire: Record<string, unknown> = {};
    const mode = fixedOrderValue(input.playback.mode, PLAYBACK_MODE_ORDER, defaults.playback.mode);
    const modeIndex = PLAYBACK_MODE_ORDER.indexOf(mode);
    if (modeIndex !== PLAYBACK_MODE_ORDER.indexOf(defaults.playback.mode)) playbackWire.m = modeIndex;
    if (input.playback.playing === true) playbackWire.p = 1;

    const speed = fixedOrderValue(input.playback.speedMultiplier, PLAYBACK_SPEED_ORDER, defaults.playback.speedMultiplier);
    const speedIndex = PLAYBACK_SPEED_ORDER.indexOf(speed as (typeof PLAYBACK_SPEED_ORDER)[number]);
    if (speedIndex !== DEFAULT_PLAYBACK_SPEED_INDEX) playbackWire.s = speedIndex;

    const resolution = fixedOrderValue(input.playback.resolutionPreference, PLAYBACK_RESOLUTION_ORDER, defaults.playback.resolutionPreference);
    const resolutionIndex = PLAYBACK_RESOLUTION_ORDER.indexOf(resolution);
    if (resolutionIndex !== 0) playbackWire.r = resolutionIndex;

    const trailHours = fixedOrderValue(input.playback.trailHours, PLAYBACK_TRAIL_ORDER_HOURS, defaults.playback.trailHours);
    const trailIndex = PLAYBACK_TRAIL_ORDER_HOURS.indexOf(trailHours as (typeof PLAYBACK_TRAIL_ORDER_HOURS)[number]);
    if (trailIndex !== DEFAULT_PLAYBACK_TRAIL_INDEX) playbackWire.tr = trailIndex;

    const frameIndex = validPlaybackFrameIndex(input.playback.frameIndex);
    if (frameIndex !== null) playbackWire.f = frameIndex;
    const frameStart = validPlaybackFrameStart(input.playback.frameStart);
    if (frameStart !== null) playbackWire.ft = frameStart;
    wire.pb = playbackWire;
  }

  const camera = sanitizedCamera(input.camera);
  if (camera) {
    wire.c = [
      Math.round(camera.lat * 1000),
      Math.round(camera.lng * 1000),
      Math.round(camera.altitude * 1000),
    ];
  }

  const json = JSON.stringify(wire);
  const fragment = `${OPERATOR_URL_FRAGMENT_PREFIX}${encodeBase64Url(new TextEncoder().encode(json))}`;
  return fragment.length <= MAX_OPERATOR_URL_FRAGMENT_LENGTH ? fragment : null;
}

function decodeWireState(wire: Record<string, unknown>): OperatorUrlState {
  const state = createDefaultOperatorUrlState();

  const visualModeIndex = wire.m === undefined ? null : enumIndex(wire.m, VISUAL_MODE_ORDER.length);
  if (visualModeIndex !== null) state.visualMode = VISUAL_MODE_ORDER[visualModeIndex];

  const layerMask = wire.l === undefined ? null : integerInRange(wire.l, 0, (1 << LAYER_ORDER.length) - 1);
  if (layerMask !== null) {
    const enabled = new Set(valuesForMask(layerMask, LAYER_ORDER));
    for (const key of LAYER_ORDER) state.layers[key] = enabled.has(key);
  }

  const timeWindowIndex = wire.tw === undefined ? null : enumIndex(wire.tw, TIME_WINDOW_ORDER.length);
  if (timeWindowIndex !== null) state.filters.timeWindow = TIME_WINDOW_ORDER[timeWindowIndex];

  const categoryMask = wire.cg === undefined ? null : integerInRange(wire.cg, 0, (1 << CATEGORY_GROUP_ORDER.length) - 1);
  if (categoryMask !== null) state.filters.categoryGroups = valuesForMask(categoryMask, CATEGORY_GROUP_ORDER);

  const severityMask = wire.sv === undefined ? null : integerInRange(wire.sv, 0, (1 << SEVERITY_ORDER_FOR_URL.length) - 1);
  if (severityMask !== null) state.filters.severities = valuesForMask(severityMask, SEVERITY_ORDER_FOR_URL);

  const theater = validTheaterSlug(wire.th);
  if (theater) state.filters.theater = theater;

  const query = sanitizeOperatorQuery(wire.q);
  if (query) state.filters.query = query;

  const eventId = validEventId(wire.ev);
  if (eventId) state.selectedEventId = eventId;

  if (wire.rp === 1) state.refreshPaused = true;

  const panelMask = wire.pn === undefined ? null : integerInRange(wire.pn, 0, 7);
  if (panelMask !== null) {
    state.panels.theater = (panelMask & 1) !== 0;
    state.panels.incident = (panelMask & 2) !== 0;
    state.panels.source = (panelMask & 4) !== 0;
  }
  const inspectorIndex = wire.pi === undefined ? null : enumIndex(wire.pi, PANEL_INSPECTOR_ORDER.length);
  if (inspectorIndex !== null) state.panels.inspector = PANEL_INSPECTOR_ORDER[inspectorIndex];

  if (isObjectRecord(wire.pb)) {
    state.playback.active = true;
    const modeIndex = wire.pb.m === undefined ? null : enumIndex(wire.pb.m, PLAYBACK_MODE_ORDER.length);
    if (modeIndex !== null) state.playback.mode = PLAYBACK_MODE_ORDER[modeIndex];
    state.playback.playing = wire.pb.p === 1;

    const speedIndex = wire.pb.s === undefined ? null : enumIndex(wire.pb.s, PLAYBACK_SPEED_ORDER.length);
    if (speedIndex !== null) state.playback.speedMultiplier = PLAYBACK_SPEED_ORDER[speedIndex];

    const resolutionIndex = wire.pb.r === undefined ? null : enumIndex(wire.pb.r, PLAYBACK_RESOLUTION_ORDER.length);
    if (resolutionIndex !== null) state.playback.resolutionPreference = PLAYBACK_RESOLUTION_ORDER[resolutionIndex];

    const trailIndex = wire.pb.tr === undefined ? null : enumIndex(wire.pb.tr, PLAYBACK_TRAIL_ORDER_HOURS.length);
    if (trailIndex !== null) state.playback.trailHours = PLAYBACK_TRAIL_ORDER_HOURS[trailIndex];

    state.playback.frameIndex = validPlaybackFrameIndex(wire.pb.f);
    state.playback.frameStart = integerInRange(
      wire.pb.ft,
      MIN_FRAME_TIMESTAMP_MS,
      MAX_FRAME_TIMESTAMP_MS - 1,
    );
  }

  if (Array.isArray(wire.c) && wire.c.length === 3) {
    const latMilli = integerInRange(wire.c[0], -90_000, 90_000);
    const lngMilli = integerInRange(wire.c[1], -180_000, 180_000);
    const altitudeMilli = integerInRange(wire.c[2], 150, 5_000);
    if (latMilli !== null && lngMilli !== null && altitudeMilli !== null) {
      state.camera = {
        lat: latMilli / 1000,
        lng: lngMilli / 1000,
        altitude: altitudeMilli / 1000,
      };
    }
  }

  return state;
}

export interface OperatorUrlParseResult {
  state: OperatorUrlState;
  /** Whether this fragment was recognized as an operator-state fragment. */
  recognized: boolean;
  /** False when a recognized payload was malformed, oversize, non-canonical, or not a JSON object. */
  valid: boolean;
  /** Whether the pre-v1 `?mode=satellite` compatibility path supplied the visual mode. */
  legacyModeApplied: boolean;
  /** Safe, non-sensitive diagnostics; payloads themselves are never echoed. */
  issues: string[];
}

function applyLegacyVisualMode(state: OperatorUrlState, search: string): boolean {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const mode = new URLSearchParams(normalizedSearch).get("mode");
  if (mode === "satellite") {
    state.visualMode = "satellite";
    return true;
  }
  return false;
}

/** Parse a `location.hash`/`location.search` pair without throwing, even for hostile input. */
export function parseOperatorUrlState(hashValue: string, search = ""): OperatorUrlParseResult {
  const fallback = createDefaultOperatorUrlState();
  const issues: string[] = [];
  const hash = hashValue.startsWith("#") ? hashValue.slice(1) : hashValue;

  if (!hash || !hash.startsWith(OPERATOR_URL_FRAGMENT_PREFIX)) {
    if (/^s\d+\./.test(hash)) {
      issues.push("operator state fragment uses an unsupported schema version");
      return { state: fallback, recognized: true, valid: false, legacyModeApplied: false, issues };
    }
    return {
      state: fallback,
      recognized: false,
      valid: true,
      legacyModeApplied: applyLegacyVisualMode(fallback, search),
      issues,
    };
  }

  if (hash.length > MAX_OPERATOR_URL_FRAGMENT_LENGTH) {
    issues.push("operator state fragment exceeds the length guardrail");
    return { state: fallback, recognized: true, valid: false, legacyModeApplied: false, issues };
  }

  const payload = hash.slice(OPERATOR_URL_FRAGMENT_PREFIX.length);
  const bytes = decodeBase64Url(payload);
  if (!bytes) {
    issues.push("operator state payload is not canonical base64url");
    return { state: fallback, recognized: true, valid: false, legacyModeApplied: false, issues };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    issues.push("operator state payload is not valid UTF-8 JSON");
    return { state: fallback, recognized: true, valid: false, legacyModeApplied: false, issues };
  }

  if (!isObjectRecord(parsed)) {
    issues.push("operator state payload is not a JSON object");
    return { state: fallback, recognized: true, valid: false, legacyModeApplied: false, issues };
  }

  return {
    state: decodeWireState(parsed),
    recognized: true,
    valid: true,
    legacyModeApplied: false,
    issues,
  };
}
