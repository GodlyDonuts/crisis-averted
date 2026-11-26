"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeInstance } from "globe.gl";
import { cellToBoundary, cellToLatLng } from "h3-js";
import { loadGodseyeWasm, type GodseyeWasmCore } from "@/lib/godseyeWasm";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Line,
  LineLoop,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  OctahedronGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from "three";
import { assetPath } from "@/lib/assets";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { ConflictEvent, ConflictTheater, GdeltGeoNewsMention, IodaInternetOutage, MilitaryAircraft, OsintAircraft, OsintLaunch, OsintNaturalEvent, OsintSatellite, OsintVessel, GpsInterferenceCell, SeverityKey } from "@/types/conflict";
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec } from "satellite.js";
import { classifyAircraftRole, escapeHtml, formatRelativeTime, naturalEventColor, normalizeCategory, normalizeTheaterName, SEVERITY_META } from "@/lib/conflictData";
import { formatUtcExact, resolveIncidentOccurrenceWindow, type PlaybackMode } from "@/lib/incidentTime";
import {
  FrameBudgetController,
  accountForCappedLayer,
  accountFromSelection,
  accountWithLayerEnabled,
  cachedTrackProjectionFor,
  createBatchedParticleGroups,
  detectDeviceQualityTier,
  detailLevelForAltitude,
  globeRenderQualityProfile,
  moreConstrainedTier,
  particleSizeForPointRadius,
  renderDetailLabel,
  resampleTrackPoints,
  resolveAdaptivePixelRatio,
  resolveTextureAnisotropy,
  satellitePropagationIntervalMs,
  selectAdaptiveEvents,
  selectViewportAdaptiveItems,
  summarizeRenderAccounts,
  tagGlobeObject,
  untagGlobeObject,
  type BatchedParticleEntry,
  type GodEyeRenderStatus,
  type RenderQualityTier,
} from "@/lib/globeRendering";

export type GodEyeVisualMode = "cinematic" | "satellite";

export interface GodEyeLayerToggles {
  density: boolean;
  beacons: boolean;
  signals: boolean;
  theaterLabels: boolean;
  borders: boolean;
  clouds: boolean;
  orbitalAssets: boolean;
  aircraft: boolean;
  civilAviation: boolean;
  maritime: boolean;
  environmental: boolean;
  gpsInterference: boolean;
  internetOutages: boolean;
  gdeltGeoNews: boolean;
}

export interface GodEyeCameraState {
  lat: number;
  lng: number;
  altitude: number;
}

export interface GodEyeFocusTarget extends GodEyeCameraState {
  key: string;
}

export interface GodEyePlaybackFrame {
  start: number;
  endExclusive: number;
  mode: PlaybackMode;
}

interface GodEyeGlobeProps {
  events: ConflictEvent[];
  theaters: ConflictTheater[];
  militaryAircraft: MilitaryAircraft[];
  aircraft: OsintAircraft[];
  vessels: OsintVessel[];
  satellites: OsintSatellite[];
  launches: OsintLaunch[];
  naturalEvents: OsintNaturalEvent[];
  gpsInterference: GpsInterferenceCell[];
  internetOutages: IodaInternetOutage[];
  gdeltGeoNews: GdeltGeoNewsMention[];
  selectedEvent: ConflictEvent | null;
  selectedTheater: ConflictTheater | null;
  focusTarget: GodEyeFocusTarget | null;
  /** Supplies the camera center when a globe instance is constructed (notably after a rendering-mode remount). A getter lets the parent keep camera motion out of React rendering. */
  getInitialCamera?: () => GodEyeCameraState | null;
  layers: GodEyeLayerToggles;
  visualMode: GodEyeVisualMode;
  autoRotate: boolean;
  playbackFrame?: GodEyePlaybackFrame | null;
  reducedMotion?: boolean;
  /** Operator-controlled effects reduction. Adaptive frame-budget protection remains active regardless. */
  reducedEffects?: boolean;
  selectedMilitaryAircraft?: MilitaryAircraft | null;
  selectedCivilAircraft?: OsintAircraft | null;
  selectedVessel?: OsintVessel | null;
  onRenderStatus?: (status: GodEyeRenderStatus) => void;
  onEventSelect: (event: ConflictEvent) => void;
  onAircraftSelect: (aircraft: MilitaryAircraft) => void;
  onCivilAircraftSelect: (aircraft: OsintAircraft) => void;
  onVesselSelect: (vessel: OsintVessel) => void;
  onTheaterSelect: (theater: ConflictTheater) => void;
  /** Raw globe center notifications. Consumers must throttle/persist outside React if they use this for URL state. */
  onCameraChange?: (camera: GodEyeCameraState) => void;
  onRenderFailure?: () => void;
}

interface CountryFeature {
  type: string;
  properties: {
    NAME?: string;
    ADMIN?: string;
    ISO_A3?: string;
    [key: string]: unknown;
  };
  geometry: unknown;
}

interface InternetOutageMarker {
  key: string;
  entityType: IodaInternetOutage["entityType"];
  entityCode: string;
  entityName: string;
  countryCode: string | null;
  countryName: string | null;
  lat: number;
  lng: number;
  coordinatePrecision: IodaInternetOutage["coordinatePrecision"];
  coordinateNote: string;
  events: IodaInternetOutage[];
  datasourceMethods: string[];
}

interface GdeltNewsLocationMarker {
  key: string;
  lat: number;
  lng: number;
  locationName: string;
  coordinatePrecision: GdeltGeoNewsMention["coordinatePrecision"];
  locationType: number;
  mentions: GdeltGeoNewsMention[];
  articles: GdeltGeoNewsMention[];
  themes: string[];
  latestSlotTime: string;
}

type GlobePointObject =
  | (ConflictEvent & { objectKind: "event" })
  | (MilitaryAircraft & { objectKind: "aircraft" })
  | (OsintAircraft & { objectKind: "civilAircraft" })
  | (OsintVessel & { objectKind: "vessel" })
  | (OsintSatellite & { objectKind: "satellite"; altitudeKm: number })
  | (OsintLaunch & { objectKind: "launch" })
  | (OsintNaturalEvent & { objectKind: "natural" })
  | (InternetOutageMarker & { objectKind: "internetOutage" })
  | (GdeltNewsLocationMarker & { objectKind: "gdeltNews" });

interface SignalArc {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  severity: SeverityKey;
  altitude: number;
}

interface BorderPath {
  points: [number, number, number][];
  intensity: number;
  kind?: "border" | "aircraft" | "gps" | "internetOutage";
  tooltip?: string;
  trackColor?: string;
}

type GeoJsonPosition = [number, number];
type GeoJsonPolygonCoordinates = GeoJsonPosition[][] | GeoJsonPosition[][][];

function borderPathsFromFeature(feature: CountryFeature): Omit<BorderPath, "intensity">[] {
  const geometry = feature.geometry as { type?: string; coordinates?: GeoJsonPolygonCoordinates } | null;
  if (!geometry?.type || !geometry.coordinates) return [];

  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates as GeoJsonPosition[][]]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates as GeoJsonPosition[][][]
      : [];

  return polygons.flatMap((polygon) =>
    polygon.map((ring) => ({
      points: ring.map(([lng, lat]) => [lat, lng, 0.004] as [number, number, number]),
    }))
  );
}

const GLOBE_RADIUS_ALTITUDE = 0.012;
const ESRI_WORLD_IMAGERY_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics";

function normalizeCountryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

const COUNTRY_SYNONYMS: Record<string, string> = {
  russia: "russianfederation",
  syria: "syrianarabrepublic",
  iran: "iranislamicrepublicof",
  venezuela: "venezuelabolivarianrepublicof",
  vietnam: "vietnam",
  laos: "laopeoplesdemocraticrepublic",
  northkorea: "koreademocraticpeoplesrepublicof",
  southkorea: "korearepublicof",
  moldova: "moldovarepublicof",
  tanzania: "tanzaniaunitedrepublicof",
  congo: "congo",
  drc: "democraticrepublicofthecongo",
  democraticrepublicofcongo: "democraticrepublicofthecongo",
  ivorycoast: "cotedivoire",
  czechia: "czechrepublic",
  egypt: "egyptarabrepublicof",
};

function solarPositionAt(date: Date): [number, number] {
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const equationOfTime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(gamma) -
    0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) -
    0.040849 * Math.sin(2 * gamma)
  );
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const utcMinutes = utcHours * 60;
  const solarTime = (utcMinutes + equationOfTime + 1440) % 1440;
  const hourAngle = solarTime / 4 - 180;
  return [-hourAngle, declination * 180 / Math.PI];
}

function createDayNightMaterial(dayTexture: Texture, nightTexture: Texture, waterTexture: Texture, bumpTexture: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      nightTexture: { value: nightTexture },
      waterTexture: { value: waterTexture },
      bumpTexture: { value: bumpTexture },
      sunPosition: { value: new Vector2() },
      globeRotation: { value: new Vector2() },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #define PI 3.141592653589793
      uniform sampler2D dayTexture;
      uniform sampler2D nightTexture;
      uniform sampler2D waterTexture;
      uniform sampler2D bumpTexture;
      uniform vec2 sunPosition;
      uniform vec2 globeRotation;
      varying vec3 vNormal;
      varying vec2 vUv;

      float toRad(in float a) {
        return a * PI / 180.0;
      }

      vec3 polarToCartesian(in vec2 c) {
        float theta = toRad(90.0 - c.x);
        float phi = toRad(90.0 - c.y);
        return vec3(
          sin(phi) * cos(theta),
          cos(phi),
          sin(phi) * sin(theta)
        );
      }

      void main() {
        float invLon = toRad(globeRotation.x);
        float invLat = -toRad(globeRotation.y);
        mat3 rotX = mat3(
          1.0, 0.0, 0.0,
          0.0, cos(invLat), -sin(invLat),
          0.0, sin(invLat), cos(invLat)
        );
        mat3 rotY = mat3(
          cos(invLon), 0.0, sin(invLon),
          0.0, 1.0, 0.0,
          -sin(invLon), 0.0, cos(invLon)
        );
        vec3 rotatedSunDirection = rotX * rotY * polarToCartesian(sunPosition);
        float intensity = dot(normalize(vNormal), normalize(rotatedSunDirection));
        vec4 dayColor = texture2D(dayTexture, vUv);
        vec4 nightColor = texture2D(nightTexture, vUv);
        float blendFactor = smoothstep(-0.11, 0.13, intensity);

        float waterMask = texture2D(waterTexture, vUv).r;
        float elevation = texture2D(bumpTexture, vUv).r;
        vec3 dayRgb = dayColor.rgb * vec3(0.94, 0.93, 0.9) * (0.82 + elevation * 0.1);
        vec3 nightRgb = nightColor.rgb * vec3(1.16, 0.94, 0.68) * 1.5;
        vec3 color = mix(nightRgb, dayRgb, blendFactor);

        float sunlit = max(intensity, 0.0);
        float oceanGlint = pow(sunlit, 22.0) * waterMask * blendFactor;
        color += vec3(0.34, 0.52, 0.72) * oceanGlint * 0.42;

        float terminator = smoothstep(-0.22, 0.0, intensity) * (1.0 - smoothstep(0.0, 0.22, intensity));
        color += vec3(0.08, 0.12, 0.20) * terminator;
        color = pow(color, vec3(0.96));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}


function disposeDayNightMaterial(material: ShaderMaterial | null) {
  if (!material) return;
  for (const uniform of Object.values(material.uniforms)) {
    const value = uniform.value as unknown;
    if (value && typeof value === "object" && "dispose" in value && typeof (value as { dispose?: unknown }).dispose === "function") {
      (value as { dispose: () => void }).dispose();
    }
  }
  material.dispose();
}

function formatUnixSecondsUtc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

function formatIodaScore(score: number): string {
  if (score >= 100) return Math.round(score).toLocaleString();
  if (score >= 10) return score.toFixed(1);
  return score.toFixed(2);
}

function buildInternetOutageMarkers(outages: IodaInternetOutage[]): InternetOutageMarker[] {
  const groups = new Map<string, InternetOutageMarker>();
  for (const outage of outages) {
    const key = `${outage.entityType}:${outage.entityCode}`;
    let marker = groups.get(key);
    if (!marker) {
      marker = {
        key,
        entityType: outage.entityType,
        entityCode: outage.entityCode,
        entityName: outage.entityName,
        countryCode: outage.countryCode,
        countryName: outage.countryName,
        lat: outage.lat,
        lng: outage.lng,
        coordinatePrecision: outage.coordinatePrecision,
        coordinateNote: outage.coordinateNote,
        events: [],
        datasourceMethods: [],
      };
      groups.set(key, marker);
    }
    marker.events.push(outage);
    const datasourceMethod = `${outage.datasource ?? "unknown source"}/${outage.method ?? "unknown method"}`;
    if (!marker.datasourceMethods.includes(datasourceMethod)) marker.datasourceMethods.push(datasourceMethod);
  }
  return [...groups.values()];
}

function internetOutageTooltip(marker: InternetOutageMarker): string {
  const location = marker.entityType === "region" && marker.countryName
    ? `${marker.entityName}, ${marker.countryName}`
    : marker.entityName;
  const scope = marker.entityType === "country" ? "COUNTRY-SCOPE CONNECTIVITY EVIDENCE" : "REGION-SCOPE CONNECTIVITY EVIDENCE";
  const detectionLines = marker.events.slice(0, 3).map((event) => {
    const source = `${event.datasource ?? "unknown source"}/${event.method ?? "unknown method"}`;
    const horizon = event.untilEqualsQueryHorizon ? " · end equals query horizon: recovery/ongoing status unresolved" : "";
    const preceding = event.fromBeforeQueryWindow ? " · start precedes requested lookback" : "";
    return `<div class="godseye-tooltip__meta">${escapeHtml(source)} · ${formatUnixSecondsUtc(event.from)} → ${formatUnixSecondsUtc(event.until)} · IODA score ${formatIodaScore(event.score)}${horizon}${preceding}</div>`;
  }).join("");
  const additional = marker.events.length > 3
    ? `<div class="godseye-tooltip__meta">+${marker.events.length - 3} additional detection record${marker.events.length - 3 === 1 ? "" : "s"} at this entity</div>`
    : "";
  return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#75bdd1">${scope}</div><div class="godseye-tooltip__title">${escapeHtml(location)}</div><div class="godseye-tooltip__meta">${marker.events.length} IODA detection record${marker.events.length === 1 ? "" : "s"} grouped only for display · ${escapeHtml(marker.datasourceMethods.join(" · "))}</div>${detectionLines}${additional}<div class="godseye-tooltip__meta">Scores are source-specific measurements, not cross-source severity. Records are not merged into a single incident.</div><div class="godseye-tooltip__meta">${escapeHtml(marker.coordinateNote)}</div><div class="godseye-tooltip__meta">IODA macroscopic connectivity evidence; no cause, intent, or shutdown attribution is implied.</div></div>`;
}

const internetOutageReticleCache = new WeakMap<InternetOutageMarker, BorderPath>();

function internetOutageReticlePath(marker: InternetOutageMarker): BorderPath {
  const cached = internetOutageReticleCache.get(marker);
  if (cached) return cached;
  const radiusDegrees = marker.entityType === "country" ? 0.72 : 0.46;
  const longitudeRadius = Math.min(1.8, radiusDegrees / Math.max(0.28, Math.cos(marker.lat * Math.PI / 180)));
  const path: BorderPath = {
    points: [
      [marker.lat + radiusDegrees, marker.lng, 0.012],
      [marker.lat, marker.lng + longitudeRadius, 0.012],
      [marker.lat - radiusDegrees, marker.lng, 0.012],
      [marker.lat, marker.lng - longitudeRadius, 0.012],
      [marker.lat + radiusDegrees, marker.lng, 0.012],
    ],
    intensity: 0,
    kind: "internetOutage" as const,
    tooltip: internetOutageTooltip(marker),
  };
  internetOutageReticleCache.set(marker, path);
  return path;
}

function internetOutageReticlePaths(markers: InternetOutageMarker[]): BorderPath[] {
  return markers.map(internetOutageReticlePath);
}

const GDELT_NEWS_PRECISION_RANK: Record<GdeltGeoNewsMention["coordinatePrecision"], number> = {
  "us-city-or-landmark": 2,
  "world-city-or-landmark": 2,
  "us-state-centroid": 1,
  "world-admin1-centroid": 1,
};

const GDELT_NEWS_PRECISION_LANGUAGE: Record<GdeltGeoNewsMention["coordinatePrecision"], string> = {
  "us-city-or-landmark": "US city/landmark-level gazetteer coordinate supplied by GDELT for a place mentioned in the article text — not an incident site",
  "world-city-or-landmark": "city/landmark-level gazetteer coordinate supplied by GDELT for a place mentioned in the article text — not an incident site",
  "us-state-centroid": "US-state-level mention plotted at the centroid of that entire state — coarse symbolic placement supplied by GDELT, never an incident site",
  "world-admin1-centroid": "admin-1-level mention plotted at the centroid of that entire division — coarse symbolic placement supplied by GDELT, never an incident site",
};

function buildGdeltNewsMarkers(mentions: GdeltGeoNewsMention[]): GdeltNewsLocationMarker[] {
  const groups = new Map<string, GdeltNewsLocationMarker>();
  for (const mention of mentions) {
    const key = `${mention.lat.toFixed(3)}:${mention.lng.toFixed(3)}:${mention.locationName}`;
    let marker = groups.get(key);
    if (!marker) {
      marker = {
        key,
        lat: mention.lat,
        lng: mention.lng,
        locationName: mention.locationName,
        coordinatePrecision: mention.coordinatePrecision,
        locationType: mention.locationType,
        mentions: [],
        articles: [],
        themes: [],
        latestSlotTime: mention.slotTime,
      };
      groups.set(key, marker);
    }
    marker.mentions.push(mention);
    if (!marker.articles.some((article) => article.url === mention.url)) marker.articles.push(mention);
    for (const theme of mention.themes) {
      if (!marker.themes.includes(theme)) marker.themes.push(theme);
    }
    if (mention.slotTime > marker.latestSlotTime) marker.latestSlotTime = mention.slotTime;
    if (GDELT_NEWS_PRECISION_RANK[mention.coordinatePrecision] > GDELT_NEWS_PRECISION_RANK[marker.coordinatePrecision]) {
      marker.coordinatePrecision = mention.coordinatePrecision;
      marker.locationType = mention.locationType;
    }
  }
  for (const marker of groups.values()) {
    marker.themes.sort();
    marker.articles.sort((a, b) =>
      (b.themes.length - a.themes.length) ||
      (a.proximityChars - b.proximityChars) ||
      b.slotTime.localeCompare(a.slotTime) ||
      a.url.localeCompare(b.url)
    );
  }
  return [...groups.values()];
}

function gdeltNewsTooltip(marker: GdeltNewsLocationMarker): string {
  const articleCount = marker.articles.length;
  const articleLines = marker.articles.slice(0, 3).map((mention) => {
    const headline = mention.title ? escapeHtml(mention.title) : `${escapeHtml(mention.domain)} (headline not supplied by feed)`;
    const timing = mention.seenAt
      ? `first seen ${formatRelativeTime(Date.parse(mention.seenAt))}`
      : `captured ${formatRelativeTime(Date.parse(mention.slotTime))} · per-article publication time not supplied`;
    const tone = mention.tone !== null ? ` · automated tone ${mention.tone.toFixed(1)}` : "";
    const translated = mention.collection === "machine-translated" ? " · machine-translated" : "";
    return `<div class="godseye-tooltip__meta">• ${headline} — ${escapeHtml(mention.domain)} · ${timing}${tone}${translated}</div>`;
  }).join("");
  const additional = articleCount > 3
    ? `<div class="godseye-tooltip__meta">+${articleCount - 3} further article${articleCount - 3 === 1 ? "" : "s"} at this location</div>`
    : "";
  const themeList = marker.themes.map((theme) => theme.toLowerCase().replace(/_/g, " ")).join(", ");
  return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#9fb0c9">CONFLICT-NEWS MEDIA MENTION · NOT A VERIFIED INCIDENT</div><div class="godseye-tooltip__title">${escapeHtml(marker.locationName)}</div><div class="godseye-tooltip__meta">${articleCount} article${articleCount === 1 ? "" : "s"} mention${articleCount === 1 ? "s" : ""} this location within a sentence or two of automated conflict-theme tags (${escapeHtml(themeList)})</div>${articleLines}${additional}<div class="godseye-tooltip__meta">${escapeHtml(GDELT_NEWS_PRECISION_LANGUAGE[marker.coordinatePrecision])}</div><div class="godseye-tooltip__meta">Media-attention geography only: no event is confirmed at this point. GDELT geocoding, translation, and theme tagging are automated and error-prone. Source: GDELT GKG 2.1 feeds · The GDELT Project.</div></div>`;
}

function severityPointRadius(event: ConflictEvent, selected: boolean): number {
  if (selected) return 0.23;
  const base = event.severity === "critical" ? 0.12 : event.severity === "high" ? 0.094 : event.severity === "medium" ? 0.066 : event.severity === "low" ? 0.05 : 0.05;
  return base + event.intensity * 0.042;
}

function colorWithAlpha(hexColor: string, alpha: number): string {
  const hex = hexColor.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return hexColor;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function unresolvedWindowIntersectsPlaybackFrame(event: ConflictEvent, playbackFrame: GodEyePlaybackFrame | null | undefined): boolean {
  if (!playbackFrame) return false;
  const occurrence = resolveIncidentOccurrenceWindow(event);
  return Boolean(
    occurrence
    && occurrence.precision !== "second"
    && occurrence.start < playbackFrame.endExclusive
    && occurrence.endExclusive > playbackFrame.start
  );
}

function buildSignalArcs(events: ConflictEvent[], theaters: ConflictTheater[], selectedTheater: ConflictTheater | null, maximum = 22): { arcs: SignalArc[]; candidateCount: number } {
  const relevantTheaters = selectedTheater ? [selectedTheater] : theaters.slice(0, 3);
  const arcs: SignalArc[] = [];

  for (const theater of relevantTheaters) {
    const theaterEvents = events
      .filter((event) => event.theater === theater.slug)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 7);

    for (let index = 0; index < theaterEvents.length - 1; index++) {
      const start = theaterEvents[index];
      const end = theaterEvents[index + 1];
      const distance = Math.hypot(start.lat - end.lat, start.lng - end.lng);
      if (distance < 0.5 || distance > 32) continue;
      arcs.push({
        id: `${start.id}-${end.id}`,
        startLat: start.lat,
        startLng: start.lng,
        endLat: end.lat,
        endLng: end.lng,
        severity: start.severity,
        altitude: Math.min(0.24, 0.07 + distance / 240),
      });
    }
  }

  // candidateCount is the exact pre-cap pool: omissions are attributable entirely to the
  // adaptive cap, never to silent truncation inside the builder.
  return { arcs: arcs.slice(0, maximum), candidateCount: arcs.length };
}

function globeObjectAltitude(point: GlobePointObject): number {
  if (point.objectKind === "aircraft") return 0.018;
  if (point.objectKind === "civilAircraft") return 0.016;
  if (point.objectKind === "vessel") return 0.007;
  if (point.objectKind === "satellite") return Math.min(0.22, 0.035 + (point.altitudeKm / 22000));
  if (point.objectKind === "launch") return 0.015;
  if (point.objectKind === "internetOutage") return 0.017;
  if (point.objectKind === "gdeltNews") return 0.013;
  if (point.objectKind === "natural") return 0.014;
  return GLOBE_RADIUS_ALTITUDE + (point.intensity * 0.006);
}

const transportTrackPathCache = new WeakMap<object, Map<string, BorderPath | null>>();
const wasmTrackPathCache = new WeakMap<object, Map<string, BorderPath>>();

/**
 * Identity-stable projected-track paths. globe.gl re-digests every retained path whenever the
 * shared paths layer is re-set, so rebuilding these wrapper objects on each camera-density
 * recompute would force full geometry interpolation for unchanged tracks. Weak-keyed on the
 * source record, the cache is exact for immutable snapshot inputs and garbage-collects with them.
 */
function transportTrackPath(
  owner: object,
  input: { lat: number; lng: number; track: number | null | undefined; speed: number | null | undefined },
  label: string,
  color: string,
  sampleCount: number,
  minSpeed: number,
  horizonHours: number,
  title: string,
  engineLabel = "short-horizon dead reckoning",
): BorderPath | null {
  const cacheKey = [
    input.lat, input.lng, input.track ?? "x", input.speed ?? "x",
    label, color, sampleCount, minSpeed, horizonHours, title, engineLabel,
  ].join("|");
  let forOwner = transportTrackPathCache.get(owner);
  if (!forOwner) {
    forOwner = new Map();
    transportTrackPathCache.set(owner, forOwner);
  }
  if (forOwner.has(cacheKey)) return forOwner.get(cacheKey) ?? null;
  const points = cachedTrackProjectionFor(owner, input, { minSpeed, horizonHours, sampleCount });
  const path = points
    ? {
      points,
      intensity: 0,
      kind: "aircraft" as const,
      trackColor: color,
      tooltip: `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:${color}">${label}</div><div class="godseye-tooltip__title">${escapeHtml(title)}</div><div class="godseye-tooltip__meta">${Math.round(input.speed ?? 0)} kt · ${Math.round(input.track ?? 0)}° · ${engineLabel}</div></div>`,
    }
    : null;
  forOwner.set(cacheKey, path);
  return path;
}

function buildOrbitPosition(radius: number, angle: number, inclination: number): Vector3 {
  return new Vector3(
    radius * Math.cos(angle),
    radius * Math.sin(angle) * Math.sin(inclination),
    radius * Math.sin(angle) * Math.cos(inclination)
  );
}

export default function GodEyeGlobe({
  events,
  theaters,
  militaryAircraft,
  aircraft,
  vessels,
  satellites,
  launches,
  naturalEvents,
  gpsInterference,
  internetOutages,
  gdeltGeoNews,
  selectedEvent,
  selectedTheater,
  focusTarget,
  getInitialCamera,
  layers,
  visualMode,
  autoRotate,
  playbackFrame = null,
  reducedMotion = false,
  reducedEffects = false,
  selectedMilitaryAircraft = null,
  selectedCivilAircraft = null,
  selectedVessel = null,
  onRenderStatus,
  onEventSelect,
  onAircraftSelect,
  onCivilAircraftSelect,
  onVesselSelect,
  onTheaterSelect,
  onCameraChange,
  onRenderFailure,
}: GodEyeGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const materialRef = useRef<ShaderMaterial | null>(null);
  const [viewFocus, setViewFocus] = useState({ lat: 20, lng: 0, altitude: 2.2 });
  const [wasmCore, setWasmCore] = useState<GodseyeWasmCore | null>(null);
  const cloudsRef = useRef<Mesh | null>(null);
  const layersRef = useRef(layers);
  const getInitialCameraRef = useRef(getInitialCamera);
  const onCameraChangeRef = useRef(onCameraChange);
  const [countryFeatures, setCountryFeatures] = useState<CountryFeature[]>([]);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const earthTexturesRef = useRef<Texture[]>([]);
  const particleTexturesRef = useRef<Map<string, CanvasTexture>>(new Map());
  const frameBudgetRef = useRef<FrameBudgetController | null>(null);
  const reducedEffectsRef = useRef(reducedEffects);
  const [deviceQualityTier] = useState<RenderQualityTier>(() => {
    if (typeof window === "undefined") return "full";
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return detectDeviceQualityTier({
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
      narrowViewport: Math.min(window.innerWidth, window.innerHeight) < 760,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      saveData: connection?.saveData,
    });
  });
  const [runtimeQualityTier, setRuntimeQualityTier] = useState<RenderQualityTier>(deviceQualityTier);
  // Frame-budget window completion counter, mirrored into React state at most once per completed
  // measurement window (~1Hz at 60fps) so published frame diagnostics never go stale when no tier
  // transition or camera move happens to re-render the component.
  const [frameWindowsCompleted, setFrameWindowsCompleted] = useState(0);
  const qualityTier = reducedEffects ? moreConstrainedTier(runtimeQualityTier, "constrained") : runtimeQualityTier;
  const qualityTierRef = useRef<RenderQualityTier>(qualityTier);

  useEffect(() => {
    getInitialCameraRef.current = getInitialCamera;
  }, [getInitialCamera]);

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    qualityTierRef.current = qualityTier;
  }, [qualityTier]);

  useEffect(() => {
    reducedEffectsRef.current = reducedEffects;
  }, [reducedEffects]);

  useEffect(() => {
    let active = true;
    void loadGodseyeWasm().then((core) => { if (active) setWasmCore(core); });
    return () => { active = false; };
  }, []);

  const affectedCountries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      const key = normalizeCountryKey(event.country);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const synonym = COUNTRY_SYNONYMS[key];
      if (synonym) counts.set(synonym, (counts.get(synonym) ?? 0) + 1);
    }
    return counts;
  }, [events]);

  const borderPaths = useMemo((): BorderPath[] => {
    return countryFeatures.flatMap((feature) => {
      const names = [feature.properties.NAME, feature.properties.ADMIN]
        .filter((name): name is string => Boolean(name))
        .map(normalizeCountryKey);
      const count = Math.max(0, ...names.map((name) => affectedCountries.get(name) ?? 0));
      return borderPathsFromFeature(feature).map((path) => ({
        ...path,
        intensity: Math.min(1, count / 90),
      }));
    });
  }, [affectedCountries, countryFeatures]);

  const detailLevel = detailLevelForAltitude(viewFocus.altitude);
  const renderProfile = useMemo(() => globeRenderQualityProfile(qualityTier, detailLevel), [qualityTier, detailLevel]);
  const incidentSelection = useMemo(() => selectAdaptiveEvents(
    events,
    viewFocus.lat,
    viewFocus.lng,
    detailLevel,
    renderProfile.caps.incidents,
    selectedEvent ? [selectedEvent] : [],
  ), [events, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.incidents, selectedEvent]);
  const interactiveEvents = incidentSelection.selected;


  const alertCandidates = useMemo(() => {
    return [...events]
      .filter((event) => event.severity === "critical" || event.severity === "high")
      .sort((a, b) => (b.intensity - a.intensity) || (b.occurredAt - a.occurredAt) || a.id.localeCompare(b.id));
  }, [events]);
  const alertEvents = useMemo(() => alertCandidates.slice(0, renderProfile.caps.htmlAlertMarkers), [alertCandidates, renderProfile.caps.htmlAlertMarkers]);
  // The exact array handed to the HTML-elements layer, so omission accounting counts what renders.
  const htmlAlertEvents = useMemo(() => (
    selectedEvent && !alertEvents.some((event) => event.id === selectedEvent.id)
      ? [...alertEvents, selectedEvent]
      : alertEvents
  ), [alertEvents, selectedEvent]);

  // TLE parsing is exact per catalog entry, so satrecs are memoized per snapshot and only the
  // (much cheaper) propagation step repeats on each cadence tick.
  const satelliteRecords = useMemo(() => {
    return satellites.flatMap((item) => {
      try {
        const record = twoline2satrec(item.line1, item.line2);
        return [{ item, record }];
      } catch {
        return [];
      }
    });
  }, [satellites]);

  // Adaptive propagation cadence: orbital layers re-propagate on the tier-scaled interval, and
  // not at all while the layer is hidden or the tab is invisible. Re-enabling the layer or a
  // tier transition re-creates the timer and refreshes positions immediately, so re-shown
  // positions are never stale by more than one frame.
  const [orbitTick, setOrbitTick] = useState(() => Date.now());
  const orbitalLayerEnabled = layers.orbitalAssets;
  useEffect(() => {
    if (!orbitalLayerEnabled) return;
    // Deferred rather than synchronous so the refresh does not cascade inside the effect pass;
    // it still lands well before the first cadence tick would.
    const immediate = window.setTimeout(() => setOrbitTick(Date.now()), 0);
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      setOrbitTick(Date.now());
    }, satellitePropagationIntervalMs(qualityTier));
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(interval);
    };
  }, [orbitalLayerEnabled, qualityTier]);

  const satellitePositions = useMemo(() => {
    const now = new Date(orbitTick);
    return satelliteRecords.flatMap(({ item, record }) => {
      try {
        const propagated = propagate(record, now);
        if (!propagated?.position) return [];
        const geodetic = eciToGeodetic(propagated.position, gstime(now));
        const lat = degreesLat(geodetic.latitude);
        const lng = degreesLong(geodetic.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        return [{ ...item, lat, lng, altitudeKm: geodetic.height }];
      } catch {
        return [];
      }
    });
  }, [satelliteRecords, orbitTick]);

  const militarySelection = useMemo(() => selectViewportAdaptiveItems(militaryAircraft, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.militaryAircraft,
    preserve: selectedMilitaryAircraft ? [selectedMilitaryAircraft] : [],
    keyOf: (item) => item.id,
  }), [militaryAircraft, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.militaryAircraft, selectedMilitaryAircraft]);
  const civilAircraftSelection = useMemo(() => selectViewportAdaptiveItems(aircraft, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.civilAircraft,
    preserve: selectedCivilAircraft ? [selectedCivilAircraft] : [],
    keyOf: (item) => item.id,
  }), [aircraft, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.civilAircraft, selectedCivilAircraft]);
  const vesselSelection = useMemo(() => selectViewportAdaptiveItems(vessels, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.vessels,
    preserve: selectedVessel ? [selectedVessel] : [],
    keyOf: (item) => item.id,
  }), [vessels, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.vessels, selectedVessel]);

  const aircraftTracks = useMemo(() => {
    const selected = militarySelection.selected;
    const wasmTracks = wasmCore?.aircraftTrackGeometry(selected);
    if (!wasmTracks) {
      return selected.flatMap((item) => {
        const path = transportTrackPath(item, item, "PROJECTED MILITARY TRACK", "#b8c29a", renderProfile.trackSampleCount, 70, 0.28, item.callsign);
        return path ? [path] : [];
      });
    }
    return wasmTracks.flatMap((track) => {
      const item = selected[track.sourceIndex];
      if (!item) return [];
      // Same identity-stability contract as transportTrackPath: the wrapper object must not be
      // rebuilt per camera-density recompute, or the shared paths layer re-interpolates it.
      let forOwner = wasmTrackPathCache.get(item);
      if (!forOwner) {
        forOwner = new Map();
        wasmTrackPathCache.set(item, forOwner);
      }
      const cacheKey = String(renderProfile.trackSampleCount);
      const cached = forOwner.get(cacheKey);
      if (cached) return [cached];
      const path: BorderPath = {
        points: resampleTrackPoints(track.points, renderProfile.trackSampleCount),
        intensity: 0,
        kind: "aircraft" as const,
        trackColor: "#b8c29a",
        tooltip: `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#b8c29a">PROJECTED MILITARY TRACK</div><div class="godseye-tooltip__title">${escapeHtml(item.callsign)}</div><div class="godseye-tooltip__meta">${Math.round(item.speed ?? 0)} kt · ${Math.round(item.track ?? 0)}° · Rust/WASM dead reckoning</div></div>`,
      };
      forOwner.set(cacheKey, path);
      return [path];
    });
  }, [militarySelection, wasmCore, renderProfile.trackSampleCount]);
  const civilAircraftTracks = useMemo(() => civilAircraftSelection.selected.flatMap((item) => {
    const path = transportTrackPath(item, item, "PROJECTED CIVIL AVIATION TRACK", "#9fb7a8", renderProfile.trackSampleCount, 90, 0.2, item.callsign);
    return path ? [path] : [];
  }), [civilAircraftSelection, renderProfile.trackSampleCount]);
  const vesselTracks = useMemo(() => vesselSelection.selected.flatMap((item) => {
    const input = { lat: item.lat, lng: item.lng, track: item.course, speed: item.speed };
    const path = transportTrackPath(item, input, "PROJECTED VESSEL TRACK", "#7da6a1", renderProfile.trackSampleCount, 3, 3.5, item.name);
    return path ? [path] : [];
  }), [vesselSelection, renderProfile.trackSampleCount]);

  // Each cell's reticle path is built once per snapshot and carried on the center record, so
  // viewport re-selection never rebuilds unchanged h3 boundary geometry in the shared paths layer.
  const gpsInterferenceCenters = useMemo(() => gpsInterference.map((cell) => {
    const [lat, lng] = cellToLatLng(cell.hex);
    const boundary = cellToBoundary(cell.hex);
    const ring = [...boundary, boundary[0]];
    const path: BorderPath = {
      points: ring.map(([pointLat, pointLng]) => [pointLat, pointLng, 0.0065] as [number, number, number]),
      intensity: cell.affectedShare,
      kind: "gps" as const,
      tooltip: `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#ff8a00">GPS/GNSS INTERFERENCE</div><div class="godseye-tooltip__title">${Math.round(cell.affectedShare * 100)}% affected aircraft</div><div class="godseye-tooltip__meta">${cell.badAircraft}/${cell.aircraftCount} aircraft reporting interference · gpsjam.org</div></div>`,
    };
    return { ...cell, lat, lng, path };
  }), [gpsInterference]);
  const gpsSelection = useMemo(() => selectViewportAdaptiveItems(gpsInterferenceCenters, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.gpsInterference,
  }), [gpsInterferenceCenters, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.gpsInterference]);
  const gpsInterferencePaths = useMemo((): BorderPath[] => gpsSelection.selected.map((cell) => cell.path), [gpsSelection]);
  const internetOutageMarkers = useMemo(() => buildInternetOutageMarkers(internetOutages), [internetOutages]);
  const internetOutageSelection = useMemo(() => selectViewportAdaptiveItems(internetOutageMarkers, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.internetOutages,
  }), [internetOutageMarkers, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.internetOutages]);
  const internetOutagePaths = useMemo(() => internetOutageReticlePaths(internetOutageSelection.selected), [internetOutageSelection]);
  const gdeltNewsMarkers = useMemo(() => buildGdeltNewsMarkers(gdeltGeoNews).sort((a, b) =>
    (GDELT_NEWS_PRECISION_RANK[b.coordinatePrecision] - GDELT_NEWS_PRECISION_RANK[a.coordinatePrecision])
    || (b.articles.length - a.articles.length)
    || b.latestSlotTime.localeCompare(a.latestSlotTime)
    || a.key.localeCompare(b.key)
  ), [gdeltGeoNews]);
  const gdeltNewsSelection = useMemo(() => selectViewportAdaptiveItems(gdeltNewsMarkers, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.gdeltGeoNews,
  }), [gdeltNewsMarkers, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.gdeltGeoNews]);
  const naturalSelection = useMemo(() => selectViewportAdaptiveItems(naturalEvents, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.naturalEvents,
  }), [naturalEvents, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.naturalEvents]);
  const satelliteSelection = useMemo(() => selectViewportAdaptiveItems(satellitePositions, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.satellites,
  }), [satellitePositions, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.satellites]);
  const launchSelection = useMemo(() => selectViewportAdaptiveItems(launches, {
    focusLat: viewFocus.lat,
    focusLng: viewFocus.lng,
    detailLevel,
    cap: renderProfile.caps.launches,
  }), [launches, viewFocus.lat, viewFocus.lng, detailLevel, renderProfile.caps.launches]);
  const signalArcSelection = useMemo(() => buildSignalArcs(events, theaters, selectedTheater, renderProfile.caps.signalArcs), [events, theaters, selectedTheater, renderProfile.caps.signalArcs]);
  const signalArcs = signalArcSelection.arcs;

  // Load country boundaries locally once.
  useEffect(() => {
    let cancelled = false;
    fetch(assetPath("/data/ne_110m_admin_0_countries.geojson"))
      .then((response) => response.json())
      .then((geojson: { features?: CountryFeature[] }) => {
        if (cancelled) return;
        setCountryFeatures(geojson.features ?? []);
      })
      .catch((error) => console.error("Unable to load country boundaries", error));
    return () => { cancelled = true; };
  }, []);

  // Initialize the WebGL globe and the cinematic Earth rendering stack.
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const probe = document.createElement("canvas");
    const hasWebgl = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    if (!hasWebgl) {
      onRenderFailure?.();
      return;
    }

    const globe = new Globe(container, {
      animateIn: false,
      rendererConfig: {
        antialias: qualityTierRef.current === "full" || qualityTierRef.current === "balanced",
        alpha: false,
        powerPreference: "high-performance",
      },
    })
      .backgroundImageUrl(assetPath("/textures/night-sky.png"))
      .showAtmosphere(true)
      .atmosphereColor("#58c7ff")
      .atmosphereAltitude(0.145)
      .width(container.clientWidth)
      .height(container.clientHeight)
      .pointOfView(getInitialCameraRef.current?.() ?? { lat: 24, lng: 12, altitude: 2.25 });

    if (visualMode === "satellite") {
      globe
        .globeTileEngineUrl((x, y, level) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${level}/${y}/${x}`)
        .globeTileEngineMaxLevel(globeRenderQualityProfile(qualityTierRef.current, 0).satelliteTileMaxLevel);
    }

    globeRef.current = globe;

    const renderer = globe.renderer();
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = visualMode === "satellite" ? 0.84 : 0.92;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(resolveAdaptivePixelRatio(window.devicePixelRatio || 1, globe.pointOfView().altitude ?? 2.2, qualityTierRef.current));

    if (visualMode === "satellite") {
      for (const light of globe.lights()) {
        if (light.type === "AmbientLight") light.intensity = 1.55;
        if (light.type === "DirectionalLight") light.intensity = 1.05;
      }
    }

    const composer = globe.postProcessingComposer();
    const bloomPass = new UnrealBloomPass(
      new Vector2(container.clientWidth, container.clientHeight),
      visualMode === "satellite" ? 0.16 : 0.3,
      0.32,
      0.68
    );
    bloomPass.enabled = qualityTierRef.current === "full" || qualityTierRef.current === "balanced";
    bloomPassRef.current = bloomPass;
    composer.addPass(bloomPass);

    const controls = globe.controls();
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.rotateSpeed = 0.48;
    controls.zoomSpeed = 0.72;
    controls.panSpeed = 0.35;
    controls.minDistance = 118;
    controls.maxDistance = 430;

    let activePixelRatio = 0;
    let lastFocusUpdate = 0;
    globe.onZoom((pov) => {
      const altitude = pov.altitude ?? 2.2;
      const desiredPixelRatio = resolveAdaptivePixelRatio(window.devicePixelRatio || 1, altitude, qualityTierRef.current);
      if (Math.abs(desiredPixelRatio - activePixelRatio) > 0.08) {
        activePixelRatio = desiredPixelRatio;
        renderer.setPixelRatio(desiredPixelRatio);
      }
      materialRef.current?.uniforms.globeRotation.value.set(pov.lng ?? 0, pov.lat ?? 0);
      if (
        typeof pov.lat === "number" && Number.isFinite(pov.lat)
        && typeof pov.lng === "number" && Number.isFinite(pov.lng)
        && Number.isFinite(altitude)
      ) {
        onCameraChangeRef.current?.({ lat: pov.lat, lng: pov.lng, altitude });
      }
      const now = performance.now();
      if (now - lastFocusUpdate < 140) return;
      lastFocusUpdate = now;
      setViewFocus((current) => {
        const centerDelta = Math.abs((pov.lat ?? 0) - current.lat) + Math.abs((pov.lng ?? 0) - current.lng);
        const altitudeDelta = Math.abs(altitude - current.altitude);
        if (altitude < 1.55 && (centerDelta > 3 || altitudeDelta > 0.12)) {
          return { lat: pov.lat ?? current.lat, lng: pov.lng ?? current.lng, altitude };
        }
        if (altitudeDelta > 0.16) return { ...current, altitude };
        return current;
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !globeRef.current) return;
      globeRef.current.width(containerRef.current.clientWidth);
      globeRef.current.height(containerRef.current.clientHeight);
    });
    resizeObserver.observe(container);

    let cancelled = false;
    let solarInterval = 0;

    if (visualMode === "cinematic") {
      const textureLoader = new TextureLoader();
      Promise.all([
        textureLoader.loadAsync(assetPath("/textures/earth-blue-marble.jpg")),
        textureLoader.loadAsync(assetPath("/textures/earth-night.jpg")),
        textureLoader.loadAsync(assetPath("/textures/earth-water.png")),
        textureLoader.loadAsync(assetPath("/textures/earth-topology.png")),
      ]).then(([dayTexture, nightTexture, waterTexture, bumpTexture]) => {
        if (cancelled || !globeRef.current) return;
        const maxAnisotropy = globeRef.current.renderer().capabilities.getMaxAnisotropy();
        const textureAnisotropy = resolveTextureAnisotropy(qualityTierRef.current, detailLevelForAltitude(globeRef.current.pointOfView().altitude ?? 2.2), maxAnisotropy);
        dayTexture.colorSpace = SRGBColorSpace;
        nightTexture.colorSpace = SRGBColorSpace;
        waterTexture.colorSpace = SRGBColorSpace;
        dayTexture.anisotropy = textureAnisotropy;
        nightTexture.anisotropy = textureAnisotropy;
        waterTexture.anisotropy = textureAnisotropy;
        bumpTexture.anisotropy = textureAnisotropy;

        earthTexturesRef.current = [dayTexture, nightTexture, waterTexture, bumpTexture];
        const material = createDayNightMaterial(dayTexture, nightTexture, waterTexture, bumpTexture);
        const setSunPosition = () => {
          material.uniforms.sunPosition.value.set(...solarPositionAt(new Date()));
        };
        setSunPosition();
        solarInterval = window.setInterval(setSunPosition, 60000);
        materialRef.current = material;
        globeRef.current.globeMaterial(material);
        const pov = globeRef.current.pointOfView();
        material.uniforms.globeRotation.value.set(pov.lng ?? 0, pov.lat ?? 0);
      }).catch((error) => console.error("Unable to initialize Earth shader", error));
    }

    // Volumetric-feeling cloud shell. Minimal devices skip the large texture/geometry entirely.
    const initialCloudSegments = globeRenderQualityProfile(qualityTierRef.current, 0).cloudSegments;
    if (initialCloudSegments > 0) new TextureLoader().load(assetPath("/textures/clouds.png"), (cloudTexture) => {
      if (cancelled || !globeRef.current) return;
      cloudTexture.colorSpace = SRGBColorSpace;
      const clouds = new Mesh(
        new SphereGeometry(globe.getGlobeRadius() * 1.0065, initialCloudSegments, initialCloudSegments),
        new MeshPhongMaterial({
          map: cloudTexture,
          transparent: true,
          opacity: visualMode === "satellite" ? 0.07 : 0.17,
          depthWrite: false,
          side: DoubleSide,
        })
      );
      cloudsRef.current = clouds;
      globe.scene().add(clouds);
    });

    // Orbital assets and scan-link lines. These are intentionally subtle: they read as
    // operational infrastructure rather than decorative sci-fi clutter.
    const orbitalCleanup = (() => {
      const scene = globe.scene();
      const radius = globe.getGlobeRadius();
      const orbitDefinitions: Array<{ radius: number; inclination: number; speed: number; phase: number; color: string }> = [];
      const orbitObjects: {
        mesh: Mesh;
        orbitLine: LineLoop;
        beam: Line;
        beamGeometry: BufferGeometry;
        radius: number;
        inclination: number;
        speed: number;
        phase: number;
      }[] = [];

      for (const definition of orbitDefinitions) {
        const points: Vector3[] = [];
        for (let step = 0; step <= 160; step++) {
          const angle = (step / 160) * Math.PI * 2;
          points.push(buildOrbitPosition(definition.radius, angle, definition.inclination));
        }
        const orbitLine = new LineLoop(
          new BufferGeometry().setFromPoints(points),
          new LineBasicMaterial({
            color: new Color(definition.color),
            transparent: true,
            opacity: 0.075,
            blending: AdditiveBlending,
          })
        );
        scene.add(orbitLine);

        const satellite = new Mesh(
          new OctahedronGeometry(1.15, 0),
          new MeshBasicMaterial({ color: new Color(definition.color), transparent: true, opacity: 0.9 })
        );
        scene.add(satellite);

        const beamGeometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
        const beam = new Line(
          beamGeometry,
          new LineBasicMaterial({
            color: new Color(definition.color),
            transparent: true,
            opacity: 0.105,
            blending: AdditiveBlending,
          })
        );
        scene.add(beam);
        orbitObjects.push({ mesh: satellite, orbitLine, beam, beamGeometry, ...definition });
      }

      frameBudgetRef.current = new FrameBudgetController({ initialTier: deviceQualityTier });
      let frame = 0;
      let previousFrameTime: number | null = null;
      let publishedWindows = 0;
      const animate = (frameTime: number) => {
        const now = performance.now();
        if (previousFrameTime !== null) {
          const transition = frameBudgetRef.current?.sample(frameTime - previousFrameTime);
          if (transition) setRuntimeQualityTier((current) => current === transition.tier ? current : transition.tier);
        }
        previousFrameTime = frameTime;
        const completedWindows = frameBudgetRef.current?.snapshot().windowsCompleted ?? 0;
        if (completedWindows !== publishedWindows) {
          publishedWindows = completedWindows;
          setFrameWindowsCompleted((current) => current === completedWindows ? current : completedWindows);
        }
        if (cloudsRef.current) {
          cloudsRef.current.rotation.y += reducedEffectsRef.current || qualityTierRef.current === "minimal" ? 0 : 0.000115;
          cloudsRef.current.visible = layersRef.current.clouds && !reducedEffectsRef.current && qualityTierRef.current !== "minimal";
          const altitude = globe.pointOfView().altitude ?? 2.2;
          const proximityFade = Math.min(1, Math.max(0.16, (altitude - 0.28) / 1.15));
          const baseOpacity = visualMode === "satellite" ? 0.07 : 0.17;
          const cloudMaterial = cloudsRef.current.material as MeshPhongMaterial;
          const cloudScale = globeRenderQualityProfile(qualityTierRef.current, 0).cloudOpacityScale;
          cloudMaterial.opacity = baseOpacity * proximityFade * cloudScale;
        }

        for (const orbit of orbitObjects) {
          const orbitalVisible = layersRef.current.orbitalAssets;
          orbit.mesh.visible = orbitalVisible;
          orbit.orbitLine.visible = orbitalVisible;
          orbit.beam.visible = orbitalVisible;
          const angle = orbit.phase + now * orbit.speed;
          const position = buildOrbitPosition(orbit.radius, angle, orbit.inclination);
          orbit.mesh.position.copy(position);
          orbit.mesh.rotation.x += 0.006;
          orbit.mesh.rotation.y += 0.009;

          const surfacePosition = position.clone().normalize().multiplyScalar(radius * 1.005);
          const positions = orbit.beamGeometry.attributes.position;
          positions.setXYZ(0, position.x, position.y, position.z);
          positions.setXYZ(1, surfacePosition.x, surfacePosition.y, surfacePosition.z);
          positions.needsUpdate = true;
        }

        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);

      return () => cancelAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      if (solarInterval) window.clearInterval(solarInterval);
      resizeObserver.disconnect();
      orbitalCleanup();
      disposeDayNightMaterial(materialRef.current);
      materialRef.current = null;
      if (cloudsRef.current) {
        cloudsRef.current.removeFromParent();
        cloudsRef.current.geometry.dispose();
        const cloudMaterial = cloudsRef.current.material;
        if (!Array.isArray(cloudMaterial)) {
          (cloudMaterial as MeshPhongMaterial).map?.dispose();
          cloudMaterial.dispose();
        }
        cloudsRef.current = null;
      }
      bloomPassRef.current = null;
      earthTexturesRef.current = [];
      frameBudgetRef.current = null;
      globe._destructor?.();
      globeRef.current = null;
    };
    // The globe is intentionally recreated only when the rendering mode changes.
    // Data layers are applied in separate effects below.
  }, [visualMode, onRenderFailure, deviceQualityTier]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  // Auto rotation is controlled by the command deck.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.controls().autoRotate = autoRotate;
    globe.controls().autoRotateSpeed = 0.16;
  }, [autoRotate, visualMode]);

  // Camera focus requests from feed, theatre list, search or detail panels.
  useEffect(() => {
    if (!focusTarget || !globeRef.current) return;
    globeRef.current.pointOfView(
      { lat: focusTarget.lat, lng: focusTarget.lng, altitude: focusTarget.altitude },
      1650
    );
  }, [focusTarget]);

  // Shared transition/tooltip/click callbacks keep per-layer effects narrow and preserve point identity.
  const transitionMs = useCallback((duration: number) => reducedMotion ? 0 : duration, [reducedMotion]);
  const pointColor = useCallback((event: ConflictEvent) => {
    const baseColor = SEVERITY_META[event.severity].color;
    return unresolvedWindowIntersectsPlaybackFrame(event, playbackFrame) ? colorWithAlpha(baseColor, 0.48) : baseColor;
  }, [playbackFrame]);
  const ringBeaconCandidates = useMemo(() => events
    .filter((event) => event.severity === "critical" || event.severity === "high" || event.intensity > 0.62)
    .sort((a, b) => (b.intensity - a.intensity) || (b.occurredAt - a.occurredAt) || a.id.localeCompare(b.id)),
  [events]);
  const ringBeaconEvents = useMemo(() => {
    const capped = ringBeaconCandidates.slice(0, renderProfile.caps.ringBeacons);
    return selectedEvent && !capped.some((event) => event.id === selectedEvent.id) ? [...capped, selectedEvent] : capped;
  }, [ringBeaconCandidates, renderProfile.caps.ringBeacons, selectedEvent]);
  const globeObjectTooltip = useCallback((point: GlobePointObject): string => {
        if ((point as GlobePointObject).objectKind === "aircraft") {
          const aircraft = point as MilitaryAircraft;
          const role = classifyAircraftRole(aircraft.aircraftType);
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:${role.color}">${role.label.toUpperCase()}</div><div class="godseye-tooltip__title">${escapeHtml(aircraft.callsign)}</div><div class="godseye-tooltip__meta">${escapeHtml(aircraft.aircraftType || "Unknown type")} · ${aircraft.altitude ? `${aircraft.altitude.toLocaleString()} ft` : "altitude unknown"} · ADSB.lol</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "civilAircraft") {
          const item = point as OsintAircraft;
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#9fb7a8">${escapeHtml(item.operatorClass.toUpperCase())}</div><div class="godseye-tooltip__title">${escapeHtml(item.callsign)}</div><div class="godseye-tooltip__meta">${escapeHtml(item.originCountry || "Unknown origin")} · ${item.altitude ? `${item.altitude.toLocaleString()} ft` : "altitude unknown"} · ${item.speed ? `${item.speed} kt` : "speed unknown"} · contact ${item.lastContact ? formatRelativeTime(Date.parse(item.lastContact)) : "unknown"} · OpenSky</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "vessel") {
          const vessel = point as OsintVessel;
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#7da6a1">${escapeHtml(vessel.vesselClass.toUpperCase())}</div><div class="godseye-tooltip__title">${escapeHtml(vessel.name)}</div><div class="godseye-tooltip__meta">MMSI ${vessel.mmsi} · ${vessel.speed != null ? `${vessel.speed.toFixed(1)} kt` : "speed unknown"} · ${escapeHtml(vessel.destination || "destination unavailable")} · reported ${vessel.timestamp ? formatRelativeTime(Date.parse(vessel.timestamp)) : "unknown"} · Digitraffic AIS</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "satellite") {
          const satellite = point as OsintSatellite & { altitudeKm: number };
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#d8c77f">TRACKED ORBITAL OBJECT</div><div class="godseye-tooltip__title">${escapeHtml(satellite.name)}</div><div class="godseye-tooltip__meta">NORAD ${satellite.catalogNumber} · ${Math.round(satellite.altitudeKm).toLocaleString()} km · ${escapeHtml(satellite.group)} · CelesTrak TLE propagated client-side</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "launch") {
          const launch = point as OsintLaunch;
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#bf5af2">UPCOMING LAUNCH</div><div class="godseye-tooltip__title">${escapeHtml(launch.name)}</div><div class="godseye-tooltip__meta">${escapeHtml(launch.provider || "Unknown provider")} · ${escapeHtml(launch.location || "Unknown pad")}</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "natural") {
          const naturalEvent = point as OsintNaturalEvent;
          const color = naturalEventColor(naturalEvent);
          const sourceLabel = naturalEvent.id.startsWith("gdacs-") ? "GDACS" : naturalEvent.id.startsWith("usgs-") ? "USGS" : "NASA EONET";
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:${color}">${escapeHtml(naturalEvent.category.toUpperCase())}</div><div class="godseye-tooltip__title">${escapeHtml(naturalEvent.title)}</div><div class="godseye-tooltip__meta">${naturalEvent.magnitude ? `${naturalEvent.magnitude}${naturalEvent.magnitudeUnit || ""} · ` : ""}${sourceLabel}</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "internetOutage") {
          return internetOutageTooltip(point as InternetOutageMarker);
        }
        if ((point as GlobePointObject).objectKind === "gdeltNews") {
          return gdeltNewsTooltip(point as GdeltNewsLocationMarker);
        }
        const conflictEvent = point as ConflictEvent;
        const severity = SEVERITY_META[conflictEvent.severity];
        const corroboration = conflictEvent.incident && conflictEvent.incident.memberCount > 1
          ? `<div class="godseye-tooltip__meta">${conflictEvent.incident.memberCount} linked reports · ${conflictEvent.incident.independentFamilyCount} independent source ${conflictEvent.incident.independentFamilyCount === 1 ? "family" : "families"} · ${escapeHtml(conflictEvent.incident.confidence)}</div>`
          : "";
        const occurrence = resolveIncidentOccurrenceWindow(conflictEvent);
        const unresolvedNow = unresolvedWindowIntersectsPlaybackFrame(conflictEvent, playbackFrame);
        const occurrenceLine = occurrence
          ? `<div class="godseye-tooltip__meta">Time window ${formatUtcExact(occurrence.start)} → ${formatUtcExact(occurrence.endExclusive)} end-exclusive · ${escapeHtml(occurrence.label)}${unresolvedNow ? " · current playback frame intersects this unresolved interval" : ""}</div>`
          : "";
        return `
          <div class="godseye-tooltip">
            <div class="godseye-tooltip__eyebrow" style="color:${severity.color}">${severity.label.toUpperCase()} / ${escapeHtml(normalizeCategory(conflictEvent.category)).toUpperCase()}</div>
            <div class="godseye-tooltip__title">${escapeHtml(conflictEvent.title)}</div>
            <div class="godseye-tooltip__meta">${escapeHtml(conflictEvent.country)} · ${escapeHtml(conflictEvent.conflict)} · ${formatRelativeTime(conflictEvent.occurredAt)}</div>
            ${occurrenceLine}
            ${corroboration}
          </div>
        `;
      }, [playbackFrame]);
  // Selection callbacks receive the original source records, never the render-tagged copies:
  // parents store selections in workspace state, where a tagged copy would defeat viewport
  // preservation matching and leak rendering artifacts into inspection, permalink, and export flows.
  const handlePointObjectClick = useCallback((clicked: object) => {
        const kind = (clicked as GlobePointObject).objectKind;
        const source = untagGlobeObject(clicked);
        if (kind === "event") onEventSelect(source as ConflictEvent);
        if (kind === "aircraft") onAircraftSelect(source as MilitaryAircraft);
        if (kind === "civilAircraft") onCivilAircraftSelect(source as OsintAircraft);
        if (kind === "vessel") onVesselSelect(source as OsintVessel);
      }, [onAircraftSelect, onCivilAircraftSelect, onEventSelect, onVesselSelect]);

  // Density heatmap updates independently of markers, paths, and transport layers.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (layers.density && events.length > 1) {
      globe
        .heatmapsData([{ points: events }])
        .heatmapPoints("points")
        .heatmapPointLat("lat")
        .heatmapPointLng("lng")
        .heatmapPointWeight((event) => {
          const conflictEvent = event as ConflictEvent;
          const unresolvedWeight = unresolvedWindowIntersectsPlaybackFrame(conflictEvent, playbackFrame) ? 0.58 : 1;
          return (0.22 + conflictEvent.intensity * 1.12) * unresolvedWeight;
        })
        .heatmapBandwidth(1.42)
        .heatmapColorSaturation(1.35)
        .heatmapBaseAltitude(GLOBE_RADIUS_ALTITUDE * 0.35)
        .heatmapTopAltitude(GLOBE_RADIUS_ALTITUDE * 1.4)
        .heatmapColorFn(() => (t: number) => {
          const alpha = Math.min(0.42, 0.04 + t * 0.38);
          if (t > 0.78) return `rgba(255,45,85,${alpha})`;
          if (t > 0.48) return `rgba(255,138,0,${alpha * 0.82})`;
          return `rgba(64,210,255,${alpha * 0.58})`;
        })
        .heatmapsTransitionDuration(transitionMs(450));
    } else {
      globe.heatmapsData([]);
    }

  }, [events, layers.density, playbackFrame, transitionMs, pointColor, visualMode]);

  // Borders and vector projections use adaptive resolution without cross-layer playback churn.
  //
  // Path-layer organization assessment: globe.gl exposes exactly one paths layer per instance, so
  // country borders, transport track projections, GPS interference cells, and outage reticles share
  // a single digest domain — splitting them into independently updated layers is not possible
  // without abandoning the supported layer API. Worse, the three-globe paths implementation
  // re-interpolates every retained path on every digest (its interpolation key is always forced
  // from 0 to 1, so there is no unchanged fast path). The mitigations applied here within those
  // constraints are: (1) every path object is identity-stable across unrelated recomputation —
  // memoized border geometry, weak-cached track/reticle wrappers — and (2) the digest is skipped
  // entirely when the applied array is element-identical, so camera density recomputation that
  // does not change path membership costs zero geometry work.
  const pathsAppliedRef = useRef<{ globe: GlobeInstance; paths: BorderPath[]; resolution: number; transition: number } | null>(null);
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const activePaths = [
      ...(layers.borders ? borderPaths : []),
      ...(layers.aircraft ? aircraftTracks : []),
      ...(layers.civilAviation ? civilAircraftTracks : []),
      ...(layers.maritime ? vesselTracks : []),
      ...(layers.gpsInterference ? gpsInterferencePaths : []),
      ...(layers.internetOutages ? internetOutagePaths : []),
    ];
    const resolution = renderProfile.pathResolution;
    const transition = transitionMs(300);
    const last = pathsAppliedRef.current;
    if (
      last
      && last.globe === globe
      && last.resolution === resolution
      && last.transition === transition
      && last.paths.length === activePaths.length
      && last.paths.every((path, index) => path === activePaths[index])
    ) {
      return;
    }
    pathsAppliedRef.current = { globe, paths: activePaths, resolution, transition };

    if (activePaths.length > 0) {
      globe
        .pathsData(activePaths)
        .pathPoints("points")
        .pathPointLat((point) => (point as [number, number, number])[0])
        .pathPointLng((point) => (point as [number, number, number])[1])
        .pathPointAlt((point) => (point as [number, number, number])[2])
        .pathLabel((path: object) => (path as BorderPath).tooltip ?? "")
        .pathColor((path: object) => {
          const border = path as BorderPath;
          if (border.kind === "gps") {
            if (border.intensity > 0.1) return "rgba(255,45,85,0.5)";
            if (border.intensity > 0.04) return "rgba(255,138,0,0.36)";
            return "rgba(255,209,102,0.24)";
          }
          if (border.kind === "internetOutage") return "rgba(117,189,209,0.42)";
          if (border.kind === "aircraft") return ["rgba(184,194,154,0)", border.trackColor ? `${border.trackColor}57` : "rgba(184,194,154,0.34)"];
          return border.intensity > 0.08
            ? `rgba(255,96,110,${0.13 + border.intensity * 0.18})`
            : "rgba(148,210,255,0.105)";
        })
        .pathStroke((path: object) => (path as BorderPath).kind === "aircraft" ? 0.28 : (path as BorderPath).kind === "gps" ? 0.34 : (path as BorderPath).kind === "internetOutage" ? 0.24 : 0.15)
        .pathResolution(renderProfile.pathResolution)
        .pathTransitionDuration(transitionMs(300));
    } else {
      globe.pathsData([]);
    }

  }, [layers.borders, layers.aircraft, layers.civilAviation, layers.maritime, layers.gpsInterference, layers.internetOutages, borderPaths, aircraftTracks, civilAircraftTracks, vesselTracks, gpsInterferencePaths, internetOutagePaths, renderProfile.pathResolution, transitionMs, visualMode]);

  // Alert rings are independently capped and can be slowed or made static by the frame budget.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (layers.beacons) {
      globe
        .ringsData(ringBeaconEvents)
        .ringLat("lat")
        .ringLng("lng")
        .ringAltitude(0.006)
        .ringColor((event: object) => {
          const conflictEvent = event as ConflictEvent;
          const color = SEVERITY_META[conflictEvent.severity].color;
          return (t: number) => {
            const alpha = Math.sqrt(1 - t) * (selectedEvent?.id === conflictEvent.id ? 0.94 : 0.58);
            const hex = color.replace("#", "");
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return `rgba(${r},${g},${b},${alpha})`;
          };
        })
        .ringMaxRadius((event) => {
          const conflictEvent = event as ConflictEvent;
          if (selectedEvent?.id === conflictEvent.id) return 7.2;
          return 1.55 + conflictEvent.intensity * 3.15;
        })
        .ringPropagationSpeed((event) => 0.7 + (event as ConflictEvent).intensity * 1.15)
        .ringRepeatPeriod((event) => {
          if (reducedMotion || reducedEffects || renderProfile.ringAnimation === "static") return -1;
          const base = selectedEvent?.id === (event as ConflictEvent).id ? 950 : 1750 + (1 - (event as ConflictEvent).intensity) * 1200;
          return renderProfile.ringAnimation === "slow" ? base * 2.4 : base;
        })
        .ringResolution(renderProfile.ringResolution);
    } else {
      globe.ringsData([]);
    }

  }, [layers.beacons, ringBeaconEvents, selectedEvent, reducedMotion, reducedEffects, renderProfile.ringAnimation, renderProfile.ringResolution, visualMode]);

  // Signal arcs update independently of point and ring layers.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (layers.signals) {
      globe
        .arcsData(signalArcs)
        .arcStartLat("startLat")
        .arcStartLng("startLng")
        .arcEndLat("endLat")
        .arcEndLng("endLng")
        .arcColor((arc: object) => {
          const signal = arc as SignalArc;
          const color = SEVERITY_META[signal.severity].color;
          return ["rgba(214,168,79,0.018)", color];
        })
        .arcAltitude((arc) => (arc as SignalArc).altitude)
        .arcStroke(0.24)
        .arcCurveResolution(renderProfile.arcCurveResolution)
        .arcCircularResolution(renderProfile.arcCircularResolution)
        .arcDashLength(0.36)
        .arcDashGap(0.72)
        .arcDashInitialGap((arc) => {
          const id = (arc as SignalArc).id;
          let hash = 0;
          for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
          return (hash % 1000) / 1000;
        })
        .arcDashAnimateTime(reducedMotion || reducedEffects || !renderProfile.animateArcs ? 0 : 2400)
        .arcsTransitionDuration(transitionMs(400));
    } else {
      globe.arcsData([]);
    }

  }, [layers.signals, signalArcs, renderProfile.arcCurveResolution, renderProfile.arcCircularResolution, renderProfile.animateArcs, reducedMotion, reducedEffects, transitionMs, visualMode]);

  // Theater label density selection is hoisted out of the layer effect so omission accounting
  // describes exactly the same records the layer renders.
  const theaterLabelSelection = useMemo(() => {
    const orderedTheaters = selectedTheater
      ? [selectedTheater, ...theaters.filter((theater) => theater.slug !== selectedTheater.slug)]
      : theaters;
    const labelTheaters: ConflictTheater[] = [];
    for (const theater of orderedTheaters) {
      const maxLabels = renderProfile.caps.theaterLabels;
      if (labelTheaters.length >= maxLabels) break;
      const isolated = labelTheaters.every((existing) => {
        const avgLat = ((existing.lat + theater.lat) / 2) * Math.PI / 180;
        const dLat = existing.lat - theater.lat;
        const dLng = (existing.lng - theater.lng) * Math.cos(avgLat);
        const minimumSeparation = detailLevel === 2 ? 4.2 : detailLevel === 1 ? 7.2 : 11.5;
        return Math.sqrt(dLat * dLat + dLng * dLng) >= minimumSeparation;
      });
      if (isolated || theater.slug === selectedTheater?.slug) labelTheaters.push(theater);
    }
    return { total: theaters.length, labelTheaters };
  }, [theaters, selectedTheater, detailLevel, renderProfile.caps.theaterLabels]);

  // Theater labels are density capped independently of incident points.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (layers.theaterLabels) {
      globe
        .labelsData(theaterLabelSelection.labelTheaters)
        .labelLat("lat")
        .labelLng("lng")
        .labelText((theater) => normalizeTheaterName((theater as ConflictTheater).name))
        .labelColor((theater) => selectedTheater?.slug === (theater as ConflictTheater).slug ? "#ffffff" : "#8ed8ff")
        .labelAltitude(0.022)
        .labelSize((theater) => selectedTheater?.slug === (theater as ConflictTheater).slug ? 1.28 : 0.92)
        .labelResolution(renderProfile.labelResolution)
        .labelIncludeDot(true)
        .labelDotRadius((theater) => selectedTheater?.slug === (theater as ConflictTheater).slug ? 0.34 : 0.2)
        .labelDotOrientation("top")
        .labelsTransitionDuration(transitionMs(350))
        .onLabelClick((label) => {
          const theater = label as ConflictTheater;
          onTheaterSelect(theater);
        });
    } else {
      globe.labelsData([]);
    }

  }, [layers.theaterLabels, theaterLabelSelection, selectedTheater, renderProfile.labelResolution, transitionMs, onTheaterSelect, visualMode]);

  // Incident and auxiliary point meshes remain individually inspectable. Satellites are deliberately
  // absent here: they re-propagate on the orbital cadence, and keeping them in this layer would force
  // every incident cylinder through a digest cycle each tick. They render in the particle layer
  // instead, where a position refresh is one small buffer rebake rather than mesh churn.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    globe
      .pointsData([
        ...interactiveEvents.map((event) => tagGlobeObject(event, "event")),
        ...(layers.orbitalAssets ? launchSelection.selected.map((launch) => tagGlobeObject(launch, "launch")) : []),
        ...(layers.environmental ? naturalSelection.selected.map((event) => tagGlobeObject(event, "natural")) : []),
        ...(layers.internetOutages ? internetOutageSelection.selected.map((marker) => tagGlobeObject(marker, "internetOutage")) : []),
        ...(layers.gdeltGeoNews ? gdeltNewsSelection.selected.map((marker) => tagGlobeObject(marker, "gdeltNews")) : []),
      ] as GlobePointObject[])
      .pointLat("lat")
      .pointLng("lng")
      .pointAltitude((point) => globeObjectAltitude(point as GlobePointObject))
      .pointColor((point: object) => (point as GlobePointObject).objectKind === "launch" ? "#bf5af2" : (point as GlobePointObject).objectKind === "internetOutage" ? ((point as InternetOutageMarker).entityType === "country" ? "#75bdd1" : "#548498") : (point as GlobePointObject).objectKind === "gdeltNews" ? (GDELT_NEWS_PRECISION_RANK[(point as GdeltNewsLocationMarker).coordinatePrecision] === 2 ? "#9fb0c9" : "#6d7a91") : (point as GlobePointObject).objectKind === "natural" ? naturalEventColor(point as OsintNaturalEvent) : pointColor(point as ConflictEvent))
      .pointRadius((point) => (point as GlobePointObject).objectKind === "launch" ? 0.074 : (point as GlobePointObject).objectKind === "internetOutage" ? ((point as InternetOutageMarker).entityType === "country" ? 0.066 : 0.047) : (point as GlobePointObject).objectKind === "gdeltNews" ? Math.min(0.074, 0.032 + Math.log1p((point as GdeltNewsLocationMarker).articles.length) * 0.014) : (point as GlobePointObject).objectKind === "natural" ? 0.062 : severityPointRadius(point as ConflictEvent, selectedEvent?.id === (point as ConflictEvent).id) * (unresolvedWindowIntersectsPlaybackFrame(point as ConflictEvent, playbackFrame) ? 0.84 : 1))
      .pointResolution(renderProfile.pointResolution)
      .pointsMerge(false)
      .pointsTransitionDuration(transitionMs(320))
      .pointLabel((point) => globeObjectTooltip(point as GlobePointObject))
      .onPointClick(handlePointObjectClick);

  }, [interactiveEvents, layers.orbitalAssets, layers.environmental, layers.internetOutages, layers.gdeltGeoNews, launchSelection, naturalSelection, internetOutageSelection, gdeltNewsSelection, selectedEvent, playbackFrame, detailLevel, renderProfile.pointResolution, transitionMs, pointColor, globeObjectTooltip, handlePointObjectClick, visualMode]);

  // Particle groups are memoized per source selection: globe.gl digests the particles layer by
  // group-object identity, so the transport groups below survive every orbital propagation tick
  // untouched while only the satellite group is rebuilt. One THREE.Points buffer per visual class.
  const militaryParticleGroups = useMemo(() => {
    if (!layers.aircraft) return [];
    const entries: BatchedParticleEntry<GlobePointObject>[] = militarySelection.selected.map((item) => ({
      item: tagGlobeObject(item, "aircraft"),
      kind: "aircraft",
      color: classifyAircraftRole(item.aircraftType).color,
      size: particleSizeForPointRadius(0.052),
    }));
    return createBatchedParticleGroups(entries);
  }, [layers.aircraft, militarySelection]);
  const civilParticleGroups = useMemo(() => {
    if (!layers.civilAviation) return [];
    const entries: BatchedParticleEntry<GlobePointObject>[] = civilAircraftSelection.selected.map((item) => ({
      item: tagGlobeObject(item, "civilAircraft"),
      kind: "civilAircraft",
      color: item.operatorClass.includes("cargo") ? "#f0a84f" : "#9fb7a8",
      size: particleSizeForPointRadius(0.035),
    }));
    return createBatchedParticleGroups(entries);
  }, [layers.civilAviation, civilAircraftSelection]);
  const vesselParticleGroups = useMemo(() => {
    if (!layers.maritime) return [];
    const entries: BatchedParticleEntry<GlobePointObject>[] = vesselSelection.selected.map((item) => ({
      item: tagGlobeObject(item, "vessel"),
      kind: "vessel",
      color: item.vesselClass === "Tanker" ? "#d59b6a" : item.vesselClass === "Cargo" ? "#7da6a1" : "#8f9b7d",
      size: particleSizeForPointRadius(0.038),
    }));
    return createBatchedParticleGroups(entries);
  }, [layers.maritime, vesselSelection]);
  const satelliteParticleGroups = useMemo(() => {
    if (!layers.orbitalAssets) return [];
    const entries: BatchedParticleEntry<GlobePointObject>[] = satelliteSelection.selected.map((item) => ({
      item: tagGlobeObject(item, "satellite"),
      kind: "satellite",
      color: "#d8c77f",
      size: particleSizeForPointRadius(0.046),
    }));
    return createBatchedParticleGroups(entries);
  }, [layers.orbitalAssets, satelliteSelection]);
  const particleGroups = useMemo(() => [
    ...militaryParticleGroups,
    ...civilParticleGroups,
    ...vesselParticleGroups,
    ...satelliteParticleGroups,
  ], [militaryParticleGroups, civilParticleGroups, vesselParticleGroups, satelliteParticleGroups]);
  const particleTexture = useCallback((color: string) => {
    const cached = particleTexturesRef.current.get(color);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) { context.fillStyle = color; context.beginPath(); context.arc(32, 32, 25, 0, Math.PI * 2); context.fill(); }
    const texture = new CanvasTexture(canvas);
    particleTexturesRef.current.set(color, texture);
    return texture;
  }, []);

  // Batched transport and orbital contacts: one THREE.Points buffer per visual class while
  // retaining indexed per-contact clicks. No cleanup clears the data on re-runs; the digest
  // already removes stale groups, and the layer dies with the globe instance on remount.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe
      .particlesData(particleGroups)
      .particlesList((group) => group as GlobePointObject[])
      .particleLat("lat")
      .particleLng("lng")
      .particleAltitude((point) => globeObjectAltitude(point as GlobePointObject))
      .particlesSize((group) => (group as { particleSize: number }).particleSize)
      .particlesSizeAttenuation(true)
      .particlesTexture((group) => particleTexture((group as { particleColor: string }).particleColor))
      .particleLabel((point) => globeObjectTooltip(point as GlobePointObject))
      .onParticleClick(handlePointObjectClick);
  }, [particleGroups, particleTexture, globeObjectTooltip, handlePointObjectClick, visualMode]);

  // HTML alert beacons update only when beacon state or selection changes.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    if (layers.beacons) {
      globe
        .htmlElementsData(htmlAlertEvents)
        .htmlLat("lat")
        .htmlLng("lng")
        .htmlAltitude(0.026)
        .htmlElement((event) => {
          const conflictEvent = event as ConflictEvent;
          const button = document.createElement("button");
          button.type = "button";
          button.className = `godseye-alert-marker godseye-alert-marker--${conflictEvent.severity}${selectedEvent?.id === conflictEvent.id ? " godseye-alert-marker--selected" : ""}`;
          button.setAttribute("aria-label", `${conflictEvent.severity} alert: ${conflictEvent.title}`);
          const core = document.createElement("span");
          core.className = "godseye-alert-marker__core";
          const pulse = document.createElement("span");
          pulse.className = "godseye-alert-marker__pulse";
          button.appendChild(pulse);
          button.appendChild(core);
          button.addEventListener("click", (domEvent) => {
            domEvent.stopPropagation();
            onEventSelect(conflictEvent);
          });
          return button;
        })
        .htmlTransitionDuration(transitionMs(300));
    } else {
      globe.htmlElementsData([]);
    }
  }, [layers.beacons, htmlAlertEvents, selectedEvent, transitionMs, onEventSelect, visualMode]);

  // Publish exact adaptive-render accounting outside React playback state; rendering caps never alter export/filter state.
  useEffect(() => {
    if (!onRenderStatus) return;
    // Accounts describe the adaptive pipeline per layer; the layer-enabled flag separates
    // operator toggles from adaptive culling so summaries never claim off-screen objects.
    const accounts = {
      incidents: accountWithLayerEnabled(accountFromSelection(incidentSelection), true),
      militaryAircraft: accountWithLayerEnabled(accountFromSelection(militarySelection), layers.aircraft),
      civilAircraft: accountWithLayerEnabled(accountFromSelection(civilAircraftSelection), layers.civilAviation),
      vessels: accountWithLayerEnabled(accountFromSelection(vesselSelection), layers.maritime),
      satellites: accountWithLayerEnabled(accountFromSelection(satelliteSelection), layers.orbitalAssets),
      launches: accountWithLayerEnabled(accountFromSelection(launchSelection), layers.orbitalAssets),
      naturalEvents: accountWithLayerEnabled(accountFromSelection(naturalSelection), layers.environmental),
      gpsInterference: accountWithLayerEnabled(accountFromSelection(gpsSelection), layers.gpsInterference),
      internetOutages: accountWithLayerEnabled(accountFromSelection(internetOutageSelection), layers.internetOutages),
      gdeltGeoNews: accountWithLayerEnabled(accountFromSelection(gdeltNewsSelection), layers.gdeltGeoNews),
      ringBeacons: accountWithLayerEnabled(accountForCappedLayer(ringBeaconCandidates.length, ringBeaconEvents.length, renderProfile.caps.ringBeacons), layers.beacons),
      htmlAlertMarkers: accountWithLayerEnabled(accountForCappedLayer(alertCandidates.length, htmlAlertEvents.length, renderProfile.caps.htmlAlertMarkers), layers.beacons),
      theaterLabels: accountWithLayerEnabled(accountForCappedLayer(theaterLabelSelection.total, theaterLabelSelection.labelTheaters.length, renderProfile.caps.theaterLabels), layers.theaterLabels),
      signalArcs: accountWithLayerEnabled(accountForCappedLayer(signalArcSelection.candidateCount, signalArcs.length, renderProfile.caps.signalArcs), layers.signals),
    };
    const totals = summarizeRenderAccounts(accounts);
    const frame = frameBudgetRef.current?.snapshot();
    onRenderStatus({
      qualityTier,
      runtimeQualityTier,
      detailLevel,
      detailLabel: renderDetailLabel(detailLevel),
      reducedEffects,
      pixelRatio: resolveAdaptivePixelRatio(window.devicePixelRatio || 1, viewFocus.altitude, qualityTier),
      frameP80Ms: frame?.p80Ms ?? null,
      frameWindows: frame?.windowsCompleted ?? frameWindowsCompleted,
      adaptationLabel: reducedEffects ? "reduced effects operator override" : runtimeQualityTier !== deviceQualityTier ? "frame-budget adapted" : `${qualityTier} adaptive detail`,
      batchingLabel: "transport contacts and orbital assets batched as GPU point sprites; incident cylinders remain individually inspectable",
      accounts,
      ...totals,
    });
  }, [onRenderStatus, incidentSelection, militarySelection, civilAircraftSelection, vesselSelection, satelliteSelection, launchSelection, naturalSelection, gpsSelection, internetOutageSelection, gdeltNewsSelection, ringBeaconCandidates.length, ringBeaconEvents.length, renderProfile.caps.ringBeacons, renderProfile.caps.htmlAlertMarkers, renderProfile.caps.theaterLabels, renderProfile.caps.signalArcs, alertCandidates.length, htmlAlertEvents.length, theaterLabelSelection, signalArcSelection.candidateCount, signalArcs.length, layers.aircraft, layers.civilAviation, layers.maritime, layers.orbitalAssets, layers.environmental, layers.gpsInterference, layers.internetOutages, layers.gdeltGeoNews, layers.beacons, layers.theaterLabels, layers.signals, qualityTier, runtimeQualityTier, detailLevel, reducedEffects, viewFocus.altitude, deviceQualityTier, frameWindowsCompleted]);

  // Deterministic quality application: high-DPI budget, bloom, texture filtering, and satellite tile ceilings.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.renderer().setPixelRatio(resolveAdaptivePixelRatio(window.devicePixelRatio || 1, viewFocus.altitude, qualityTier));
    if (bloomPassRef.current) {
      bloomPassRef.current.enabled = renderProfile.enableBloom && !reducedEffects;
      bloomPassRef.current.strength = (visualMode === "satellite" ? 0.16 : 0.3) * renderProfile.bloomStrengthScale;
    }
    const anisotropy = resolveTextureAnisotropy(qualityTier, detailLevel, globe.renderer().capabilities.getMaxAnisotropy());
    // eslint-disable-next-line react-hooks/immutability -- three.js texture uniforms are imperative renderer resources, not React state.
    for (const texture of earthTexturesRef.current) texture.anisotropy = anisotropy;
    if (visualMode === "satellite") globe.globeTileEngineMaxLevel(renderProfile.satelliteTileMaxLevel);
  }, [viewFocus.altitude, qualityTier, renderProfile, reducedEffects, detailLevel, visualMode]);

  useEffect(() => () => {
    for (const texture of particleTexturesRef.current.values()) texture.dispose();
    particleTexturesRef.current.clear();
  }, []);


  return (
    <div
      className="absolute inset-0 overflow-hidden bg-black"
      data-render-quality={qualityTier}
      data-reduced-effects={reducedEffects ? "true" : "false"}
      data-scanlines={renderProfile.scanlines ? "on" : "off"}
      data-html-pulse={renderProfile.htmlPulse ? "on" : "off"}
      data-vignette={renderProfile.vignette ? "on" : "off"}
    >
      <div ref={containerRef} className="h-full w-full cursor-grab active:cursor-grabbing" />
      <div className="pointer-events-none absolute inset-0 godseye-scanlines" />
      <div className="pointer-events-none absolute inset-0 godseye-vignette" />
      {visualMode === "satellite" && (
        <div className="pointer-events-none absolute bottom-2 right-3 z-10 text-[9px] uppercase tracking-[0.2em] text-white/35">
          Imagery © {ESRI_WORLD_IMAGERY_ATTRIBUTION}
        </div>
      )}
    </div>
  );
}
