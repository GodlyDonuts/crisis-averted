"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeInstance } from "globe.gl";
import { cellToBoundary } from "h3-js";
import { loadGodseyeWasm, type GodseyeWasmCore } from "@/lib/godseyeWasm";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
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
import type { ConflictEvent, ConflictTheater, MilitaryAircraft, OsintLaunch, OsintNaturalEvent, GpsInterferenceCell, SeverityKey } from "@/types/conflict";
import { escapeHtml, formatRelativeTime, normalizeCategory, normalizeTheaterName, SEVERITY_META } from "@/lib/conflictData";

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
  environmental: boolean;
  gpsInterference: boolean;
}

export interface GodEyeFocusTarget {
  lat: number;
  lng: number;
  altitude: number;
  key: string;
}

interface GodEyeGlobeProps {
  events: ConflictEvent[];
  theaters: ConflictTheater[];
  militaryAircraft: MilitaryAircraft[];
  launches: OsintLaunch[];
  naturalEvents: OsintNaturalEvent[];
  gpsInterference: GpsInterferenceCell[];
  selectedEvent: ConflictEvent | null;
  selectedTheater: ConflictTheater | null;
  focusTarget: GodEyeFocusTarget | null;
  layers: GodEyeLayerToggles;
  visualMode: GodEyeVisualMode;
  autoRotate: boolean;
  onEventSelect: (event: ConflictEvent) => void;
  onAircraftSelect: (aircraft: MilitaryAircraft) => void;
  onTheaterSelect: (theater: ConflictTheater) => void;
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

type GlobePointObject =
  | (ConflictEvent & { objectKind: "event" })
  | (MilitaryAircraft & { objectKind: "aircraft" })
  | (OsintLaunch & { objectKind: "launch" })
  | (OsintNaturalEvent & { objectKind: "natural" });

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
  kind?: "border" | "aircraft" | "gps";
  tooltip?: string;
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

function aircraftTrackPaths(aircraft: MilitaryAircraft[]): BorderPath[] {
  return aircraft
    .filter((item) => typeof item.track === "number" && typeof item.speed === "number" && item.speed > 70)
    .slice(0, 180)
    .map((item) => {
      const distanceNm = Math.min(260, (item.speed ?? 0) * 0.28);
      const angularDistance = distanceNm / 3440.065;
      const bearing = ((item.track ?? 0) * Math.PI) / 180;
      const lat1 = (item.lat * Math.PI) / 180;
      const lng1 = (item.lng * Math.PI) / 180;
      const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
      const lng2 = lng1 + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );
      const endLat = (lat2 * 180) / Math.PI;
      let endLng = ((lng2 * 180) / Math.PI + 540) % 360 - 180;
      if (Math.abs(endLng - item.lng) > 180) endLng = item.lng;
      const points: [number, number, number][] = [];
      for (let step = 0; step <= 7; step += 1) {
        const t = step / 7;
        points.push([
          item.lat + (endLat - item.lat) * t,
          item.lng + (endLng - item.lng) * t,
          0.018 + t * 0.004,
        ]);
      }
      return {
        points,
        intensity: 0,
        kind: "aircraft" as const,
        tooltip: `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#b8c29a">PROJECTED MILITARY TRACK</div><div class="godseye-tooltip__title">${escapeHtml(item.callsign)}</div><div class="godseye-tooltip__meta">${Math.round(item.speed ?? 0)} kt · ${Math.round(item.track ?? 0)}° · short-horizon dead reckoning</div></div>`,
      };
    });
}

function severityPointRadius(event: ConflictEvent, selected: boolean): number {
  if (selected) return 0.23;
  const base = event.severity === "critical" ? 0.12 : event.severity === "high" ? 0.094 : event.severity === "medium" ? 0.066 : event.severity === "low" ? 0.05 : 0.05;
  return base + event.intensity * 0.042;
}

function buildSignalArcs(events: ConflictEvent[], theaters: ConflictTheater[], selectedTheater: ConflictTheater | null): SignalArc[] {
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

  return arcs.slice(0, 22);
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
  launches,
  naturalEvents,
  gpsInterference,
  selectedEvent,
  selectedTheater,
  focusTarget,
  layers,
  visualMode,
  autoRotate,
  onEventSelect,
  onAircraftSelect,
  onTheaterSelect,
}: GodEyeGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const materialRef = useRef<ShaderMaterial | null>(null);
  const [viewFocus, setViewFocus] = useState({ lat: 20, lng: 0, altitude: 2.2 });
  const [wasmCore, setWasmCore] = useState<GodseyeWasmCore | null>(null);
  const cloudsRef = useRef<Mesh | null>(null);
  const layersRef = useRef(layers);
  const [countryFeatures, setCountryFeatures] = useState<CountryFeature[]>([]);

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

  const detailLevel = viewFocus.altitude < 0.62 ? 2 : viewFocus.altitude < 1.35 ? 1 : 0;
  const interactiveEvents = useMemo(() => {
    const maxEvents = detailLevel === 2 ? 430 : detailLevel === 1 ? 320 : 190;
    let ordered: ConflictEvent[];
    const wasmSelection = wasmCore?.selectRegionalEvents(events, viewFocus.lat, viewFocus.lng, viewFocus.altitude);
    if (wasmSelection) {
      ordered = wasmSelection.map((index) => events[index]).filter(Boolean);
    } else {
      let regionalPool = events;
      if (detailLevel > 0) {
        const radiusDegrees = detailLevel === 2 ? 30 : 58;
        regionalPool = events.filter((event) => {
          const meanLat = ((event.lat + viewFocus.lat) / 2) * Math.PI / 180;
          const dLat = event.lat - viewFocus.lat;
          const wrappedLngDiff = ((event.lng - viewFocus.lng + 540) % 360) - 180;
      const dLng = wrappedLngDiff * Math.cos(meanLat);
          return Math.sqrt(dLat * dLat + dLng * dLng) <= radiusDegrees;
        });
      }
      ordered = [...regionalPool]
        .sort((a, b) => (b.intensity - a.intensity) || (b.occurredAt - a.occurredAt))
        .slice(0, maxEvents);
    }
    if (selectedEvent && !ordered.some((event) => event.id === selectedEvent.id)) ordered.unshift(selectedEvent);
    return ordered;
  }, [events, detailLevel, viewFocus.lat, viewFocus.lng, viewFocus.altitude, wasmCore, selectedEvent]);

  const alertEvents = useMemo(() => {
    return [...events]
      .filter((event) => event.severity === "critical" || event.severity === "high")
      .sort((a, b) => (b.intensity - a.intensity) || (b.occurredAt - a.occurredAt))
      .slice(0, 8);
  }, [events]);

  const aircraftTracks = useMemo(() => {
    const wasmTracks = wasmCore?.aircraftTrackGeometry(militaryAircraft);
    if (!wasmTracks) return aircraftTrackPaths(militaryAircraft);
    return wasmTracks.map((track) => {
      const item = militaryAircraft[track.sourceIndex];
      return {
        points: track.points,
        intensity: 0,
        kind: "aircraft" as const,
        tooltip: `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#b8c29a">PROJECTED MILITARY TRACK</div><div class="godseye-tooltip__title">${escapeHtml(item.callsign)}</div><div class="godseye-tooltip__meta">${Math.round(item.speed ?? 0)} kt · ${Math.round(item.track ?? 0)}° · Rust/WASM dead reckoning</div></div>`,
      };
    });
  }, [militaryAircraft, wasmCore]);
  const gpsInterferencePaths = useMemo((): BorderPath[] => {
    return gpsInterference.map((cell) => {
      const boundary = cellToBoundary(cell.hex);
      const ring = [...boundary, boundary[0]];
      return {
        points: ring.map(([lat, lng]) => [lat, lng, 0.0065] as [number, number, number]),
        intensity: cell.affectedShare,
        kind: "gps" as const,
        tooltip: `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#ff8a00">GPS/GNSS INTERFERENCE</div><div class="godseye-tooltip__title">${Math.round(cell.affectedShare * 100)}% affected aircraft</div><div class="godseye-tooltip__meta">${cell.badAircraft}/${cell.aircraftCount} aircraft reporting interference · gpsjam.org</div></div>`,
      };
    });
  }, [gpsInterference]);
  const signalArcs = useMemo(() => buildSignalArcs(events, theaters, selectedTheater), [events, theaters, selectedTheater]);

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
    const globe = new Globe(container, {
      animateIn: false,
      rendererConfig: {
        antialias: true,
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
      .pointOfView({ lat: 24, lng: 12, altitude: 2.25 });

    if (visualMode === "satellite") {
      globe
        .globeTileEngineUrl((x, y, level) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${level}/${y}/${x}`)
        .globeTileEngineMaxLevel(17);
    }

    globeRef.current = globe;

    const renderer = globe.renderer();
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = visualMode === "satellite" ? 0.84 : 0.92;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

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
    globe.onZoom((pov) => {
      const altitude = pov.altitude ?? 2.2;
      const desiredPixelRatio = Math.min(window.devicePixelRatio || 1, altitude < 0.62 ? 2 : altitude < 1.35 ? 1.6 : 1.25);
      if (Math.abs(desiredPixelRatio - activePixelRatio) > 0.08) {
        activePixelRatio = desiredPixelRatio;
        renderer.setPixelRatio(desiredPixelRatio);
      }
      materialRef.current?.uniforms.globeRotation.value.set(pov.lng ?? 0, pov.lat ?? 0);
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
        dayTexture.colorSpace = SRGBColorSpace;
        nightTexture.colorSpace = SRGBColorSpace;
        waterTexture.colorSpace = SRGBColorSpace;
        dayTexture.anisotropy = Math.min(8, maxAnisotropy);
        nightTexture.anisotropy = Math.min(8, maxAnisotropy);
        waterTexture.anisotropy = Math.min(8, maxAnisotropy);
        bumpTexture.anisotropy = Math.min(8, maxAnisotropy);

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

    // Volumetric-feeling cloud shell.
    new TextureLoader().load(assetPath("/textures/clouds.png"), (cloudTexture) => {
      if (cancelled || !globeRef.current) return;
      cloudTexture.colorSpace = SRGBColorSpace;
      const clouds = new Mesh(
        new SphereGeometry(globe.getGlobeRadius() * 1.0065, 56, 56),
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
      const orbitDefinitions = [
        { radius: radius * 1.27, inclination: 0.48, speed: 0.00016, phase: 0.2, color: "#64d2ff" },
        { radius: radius * 1.38, inclination: -0.72, speed: -0.00011, phase: 2.4, color: "#ff5f6d" },
        { radius: radius * 1.48, inclination: 0.92, speed: 0.00008, phase: 4.1, color: "#8effff" },
      ];
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

      let frame = 0;
      const animate = () => {
        const now = performance.now();
        if (cloudsRef.current) {
          cloudsRef.current.rotation.y += 0.000115;
          cloudsRef.current.visible = layersRef.current.clouds;
          const altitude = globe.pointOfView().altitude ?? 2.2;
          const proximityFade = Math.min(1, Math.max(0.16, (altitude - 0.28) / 1.15));
          const baseOpacity = visualMode === "satellite" ? 0.07 : 0.17;
          const cloudMaterial = cloudsRef.current.material as MeshPhongMaterial;
          cloudMaterial.opacity = baseOpacity * proximityFade;
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
      globe._destructor?.();
      globeRef.current = null;
    };
    // The globe is intentionally recreated only when the rendering mode changes.
    // Data layers are applied in separate effects below.
  }, [visualMode]);

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

  // Apply event density, alert beacons, signal arcs, theater labels, boundaries and interactive points.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const pointColor = (event: ConflictEvent) => SEVERITY_META[event.severity].color;

    if (layers.density && events.length > 1) {
      globe
        .heatmapsData([{ points: events }])
        .heatmapPoints("points")
        .heatmapPointLat("lat")
        .heatmapPointLng("lng")
        .heatmapPointWeight((event) => 0.22 + (event as ConflictEvent).intensity * 1.12)
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
        .heatmapsTransitionDuration(450);
    } else {
      globe.heatmapsData([]);
    }

    globe.polygonsData([]);
    const activePaths = [
      ...(layers.borders ? borderPaths : []),
      ...(layers.aircraft ? aircraftTracks : []),
      ...(layers.gpsInterference ? gpsInterferencePaths : []),
    ];
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
          if (border.kind === "aircraft") return ["rgba(184,194,154,0)", "rgba(184,194,154,0.34)"];
          return border.intensity > 0.08
            ? `rgba(255,96,110,${0.13 + border.intensity * 0.18})`
            : "rgba(148,210,255,0.105)";
        })
        .pathStroke((path: object) => (path as BorderPath).kind === "aircraft" ? 0.28 : (path as BorderPath).kind === "gps" ? 0.34 : 0.15)
        .pathResolution(2)
        .pathTransitionDuration(300);
    } else {
      globe.pathsData([]);
    }

    if (layers.beacons) {
      const beaconEvents = events
        .filter((event) => event.severity === "critical" || event.severity === "high" || event.intensity > 0.62)
        .sort((a, b) => (b.intensity - a.intensity) || (b.occurredAt - a.occurredAt))
        .slice(0, 42);

      const allRings = selectedEvent && !beaconEvents.some((event) => event.id === selectedEvent.id)
        ? [...beaconEvents, selectedEvent]
        : beaconEvents;

      globe
        .ringsData(allRings)
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
        .ringRepeatPeriod((event) => selectedEvent?.id === (event as ConflictEvent).id ? 950 : 1750 + (1 - (event as ConflictEvent).intensity) * 1200)
        .ringResolution(32);
    } else {
      globe.ringsData([]);
    }

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
        .arcCurveResolution(28)
        .arcCircularResolution(8)
        .arcDashLength(0.36)
        .arcDashGap(0.72)
        .arcDashInitialGap(() => Math.random())
        .arcDashAnimateTime(2400)
        .arcsTransitionDuration(400);
    } else {
      globe.arcsData([]);
    }

    if (layers.theaterLabels) {
      const orderedTheaters = selectedTheater
        ? [selectedTheater, ...theaters.filter((theater) => theater.slug !== selectedTheater.slug)]
        : theaters;
      const labelTheaters: ConflictTheater[] = [];
      for (const theater of orderedTheaters) {
        const maxLabels = detailLevel === 2 ? 16 : detailLevel === 1 ? 12 : 8;
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
      globe
        .labelsData(labelTheaters)
        .labelLat("lat")
        .labelLng("lng")
        .labelText((theater) => normalizeTheaterName((theater as ConflictTheater).name))
        .labelColor((theater) => selectedTheater?.slug === (theater as ConflictTheater).slug ? "#ffffff" : "#8ed8ff")
        .labelAltitude(0.022)
        .labelSize((theater) => selectedTheater?.slug === (theater as ConflictTheater).slug ? 1.28 : 0.92)
        .labelResolution(3)
        .labelIncludeDot(true)
        .labelDotRadius((theater) => selectedTheater?.slug === (theater as ConflictTheater).slug ? 0.34 : 0.2)
        .labelDotOrientation("top")
        .labelsTransitionDuration(350)
        .onLabelClick((label) => {
          const theater = label as ConflictTheater;
          onTheaterSelect(theater);
        });
    } else {
      globe.labelsData([]);
    }

    globe
      .pointsData([
        ...interactiveEvents.map((event) => ({ ...event, objectKind: "event" as const })),
        ...(layers.aircraft ? militaryAircraft.slice(0, detailLevel === 2 ? 240 : detailLevel === 1 ? 190 : 120).map((aircraft) => ({ ...aircraft, objectKind: "aircraft" as const })) : []),
        ...(layers.orbitalAssets ? launches.slice(0, 24).map((launch) => ({ ...launch, objectKind: "launch" as const })) : []),
        ...(layers.environmental ? naturalEvents.slice(0, 70).map((event) => ({ ...event, objectKind: "natural" as const })) : []),
      ] as GlobePointObject[])
      .pointLat("lat")
      .pointLng("lng")
      .pointAltitude((point) => (point as GlobePointObject).objectKind === "aircraft" ? 0.018 : (point as GlobePointObject).objectKind === "launch" ? 0.015 : (point as GlobePointObject).objectKind === "natural" ? 0.014 : GLOBE_RADIUS_ALTITUDE + ((point as ConflictEvent).intensity * 0.006))
      .pointColor((point: object) => (point as GlobePointObject).objectKind === "aircraft" ? "#b8c29a" : (point as GlobePointObject).objectKind === "launch" ? "#bf5af2" : (point as GlobePointObject).objectKind === "natural" ? "#30d158" : pointColor(point as ConflictEvent))
      .pointRadius((point) => (point as GlobePointObject).objectKind === "aircraft" ? 0.052 : (point as GlobePointObject).objectKind === "launch" ? 0.074 : (point as GlobePointObject).objectKind === "natural" ? 0.062 : severityPointRadius(point as ConflictEvent, selectedEvent?.id === (point as ConflictEvent).id))
      .pointResolution(9)
      .pointsMerge(false)
      .pointsTransitionDuration(320)
      .pointLabel((point) => {
        if ((point as GlobePointObject).objectKind === "aircraft") {
          const aircraft = point as MilitaryAircraft;
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#b8c29a">MILITARY AIRCRAFT</div><div class="godseye-tooltip__title">${escapeHtml(aircraft.callsign)}</div><div class="godseye-tooltip__meta">${escapeHtml(aircraft.aircraftType || "Unknown type")} · ${aircraft.altitude ? `${aircraft.altitude.toLocaleString()} ft` : "altitude unknown"} · ADSB.lol</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "launch") {
          const launch = point as OsintLaunch;
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#bf5af2">UPCOMING LAUNCH</div><div class="godseye-tooltip__title">${escapeHtml(launch.name)}</div><div class="godseye-tooltip__meta">${escapeHtml(launch.provider || "Unknown provider")} · ${escapeHtml(launch.location || "Unknown pad")}</div></div>`;
        }
        if ((point as GlobePointObject).objectKind === "natural") {
          const naturalEvent = point as OsintNaturalEvent;
          return `<div class="godseye-tooltip"><div class="godseye-tooltip__eyebrow" style="color:#30d158">${escapeHtml(naturalEvent.category.toUpperCase())}</div><div class="godseye-tooltip__title">${escapeHtml(naturalEvent.title)}</div><div class="godseye-tooltip__meta">${naturalEvent.magnitude ? `${naturalEvent.magnitude}${naturalEvent.magnitudeUnit || ""} · ` : ""}NASA EONET / USGS</div></div>`;
        }
        const conflictEvent = point as ConflictEvent;
        const severity = SEVERITY_META[conflictEvent.severity];
        return `
          <div class="godseye-tooltip">
            <div class="godseye-tooltip__eyebrow" style="color:${severity.color}">${severity.label.toUpperCase()} / ${escapeHtml(normalizeCategory(conflictEvent.category)).toUpperCase()}</div>
            <div class="godseye-tooltip__title">${escapeHtml(conflictEvent.title)}</div>
            <div class="godseye-tooltip__meta">${escapeHtml(conflictEvent.country)} · ${escapeHtml(conflictEvent.conflict)} · ${formatRelativeTime(conflictEvent.occurredAt)}</div>
          </div>
        `;
      })
      .onPointClick((event) => {
        if ((event as GlobePointObject).objectKind === "event") onEventSelect(event as ConflictEvent);
        if ((event as GlobePointObject).objectKind === "aircraft") onAircraftSelect(event as MilitaryAircraft);
      });

    if (layers.beacons) {
      globe
        .htmlElementsData(selectedEvent && !alertEvents.some((event) => event.id === selectedEvent.id) ? [...alertEvents, selectedEvent] : alertEvents)
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
        .htmlTransitionDuration(300);
    } else {
      globe.htmlElementsData([]);
    }
  }, [
    events,
    theaters,
    detailLevel,
    interactiveEvents,
    militaryAircraft,
    aircraftTracks,
    gpsInterferencePaths,
    launches,
    naturalEvents,
    alertEvents,
    signalArcs,
    affectedCountries,
    borderPaths,
    selectedEvent,
    selectedTheater,
    layers,
    onEventSelect,
    onAircraftSelect,
    onTheaterSelect,
    visualMode,
  ]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
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
