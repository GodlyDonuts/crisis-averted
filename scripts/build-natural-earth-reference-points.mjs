// Regenerates scripts/natural-earth-reference-points.json, the defensive geolocation
// lookup used to place IODA country/region outage detections at broad Natural Earth
// cartographic reference coordinates.
//
// Usage:
//   node scripts/build-natural-earth-reference-points.mjs
//   node scripts/build-natural-earth-reference-points.mjs --output /tmp/reference-points.json
//   node scripts/build-natural-earth-reference-points.mjs --countries <geojson> --regions <geojson> [--output <path>]
//
// The --countries/--regions flags accept local file paths or URLs so the exact upstream
// inputs can be pinned and audited. Without them the pinned v5.1.2 upstream URLs are fetched.
//
// Selection contract (deliberately conservative):
//   countries: keyed by ISO_A2_EH (valid two-letter codes only). Where several features share
//     a code (dependencies/leases such as Clipperton I., Baikonur, Indian Ocean Ter.), the
//     HOMEPART === 1 feature wins so the code resolves to the mainland/home territory rather
//     than an overseas possession. Coordinates are Natural Earth's LABEL_X/LABEL_Y cartographic
//     label reference points.
//   regions: keyed by String(diss_me), matching IODA's entity.attrs.ne_region_id. Coordinates
//     are Natural Earth's admin-1 latitude/longitude reference attributes. Features with a null
//     name fall back to their diss_me key; iso_a2 "-1" (unattributed) normalizes to null.
//
// These coordinates are reference placements only - never outage origins, asset locations,
// centroids of impact, or spatial footprints.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultOutput = join(root, 'scripts', 'natural-earth-reference-points.json');

const NATURAL_EARTH_VERSION = 'v5.1.2';
const SOURCE_URLS = {
  countries: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_VERSION}/geojson/ne_10m_admin_0_countries.geojson`,
  regions: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_VERSION}/geojson/ne_10m_admin_1_states_provinces.geojson`,
};
const COORDINATE_MEANING = {
  countries: 'Natural Earth LABEL_X/LABEL_Y cartographic reference coordinates for country-scope placement; they are not outage origins, facility locations, centroids of impact, or spatial footprints.',
  regions: 'Natural Earth admin-1 latitude/longitude reference attributes keyed by diss_me; they are broad regional placement references, not outage origins, facility locations, centroids of impact, or spatial footprints.',
};

function parseArgs(argv) {
  const args = { output: defaultOutput, countries: null, regions: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--output') args.output = resolve(argv[++i]);
    else if (argv[i] === '--countries') args.countries = argv[++i];
    else if (argv[i] === '--regions') args.regions = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

async function loadGeoJson(source, fallbackUrl) {
  const location = source ?? fallbackUrl;
  if (/^https?:\/\//.test(location)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(location, { signal: controller.signal, headers: { 'User-Agent': 'GodseyeOSINT/1.0 reference-data build' } });
      if (!response.ok) throw new Error(`fetch ${location}: HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  if (!existsSync(location)) throw new Error(`input file not found: ${location}`);
  return JSON.parse(readFileSync(location, 'utf8'));
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function buildCountries(geojson) {
  const groups = new Map();
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    const code = props.ISO_A2_EH;
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) continue;
    if (!Number.isFinite(props.LABEL_X) || !Number.isFinite(props.LABEL_Y)) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(props);
  }
  const countries = {};
  for (const [code, candidates] of groups) {
    const selected = candidates.find((props) => props.HOMEPART === 1) ?? candidates[0];
    countries[code] = { lat: round6(selected.LABEL_Y), lng: round6(selected.LABEL_X), name: selected.NAME };
  }
  return countries;
}

function buildRegions(geojson) {
  const entries = [];
  const seen = new Set();
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    if (props.diss_me == null) continue;
    if (!Number.isFinite(props.latitude) || !Number.isFinite(props.longitude)) continue;
    const key = String(props.diss_me);
    if (seen.has(key)) throw new Error(`duplicate diss_me ${key} in admin-1 source`);
    seen.add(key);
    entries.push([Number(key), key, {
      lat: round6(props.latitude),
      lng: round6(props.longitude),
      name: props.name ?? key,
      country: props.iso_a2 === '-1' ? null : props.iso_a2,
    }]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  const regions = {};
  for (const [, key, value] of entries) regions[key] = value;
  return regions;
}

function validateReferencePoints(payload) {
  const errors = [];
  const countryEntries = Object.entries(payload.countries);
  const regionEntries = Object.entries(payload.regions);
  if (countryEntries.length < 200) errors.push(`suspiciously few countries: ${countryEntries.length}`);
  if (regionEntries.length < 4000) errors.push(`suspiciously few regions: ${regionEntries.length}`);
  for (const [code, entry] of countryEntries) {
    if (!/^[A-Z]{2}$/.test(code)) errors.push(`country key ${code} is not a two-letter code`);
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng) || Math.abs(entry.lat) > 90 || Math.abs(entry.lng) > 180) errors.push(`country ${code} invalid coordinates`);
    if (typeof entry.name !== 'string' || entry.name.length === 0) errors.push(`country ${code} missing name`);
  }
  for (const [key, entry] of regionEntries) {
    if (!/^\d+$/.test(key)) errors.push(`region key ${key} is not numeric`);
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng) || Math.abs(entry.lat) > 90 || Math.abs(entry.lng) > 180) errors.push(`region ${key} invalid coordinates`);
    if (typeof entry.name !== 'string' || entry.name.length === 0) errors.push(`region ${key} missing name`);
    if (entry.country !== null && (typeof entry.country !== 'string' || entry.country.length !== 2)) errors.push(`region ${key} invalid country code`);
  }
  if (errors.length > 0) throw new Error(`reference-point validation failed: ${errors.slice(0, 8).join('; ')}`);
  return { countryCount: countryEntries.length, regionCount: regionEntries.length };
}

const args = parseArgs(process.argv);
const [countriesGeojson, regionsGeojson] = await Promise.all([
  loadGeoJson(args.countries, SOURCE_URLS.countries),
  loadGeoJson(args.regions, SOURCE_URLS.regions),
]);

const payload = {
  schemaVersion: 1,
  naturalEarthVersion: NATURAL_EARTH_VERSION,
  license: 'Natural Earth vector data is public domain; see https://www.naturalearthdata.com/about/terms-of-use/',
  generatedAt: new Date().toISOString(),
  sourceUrls: { ...SOURCE_URLS },
  coordinateMeaning: { ...COORDINATE_MEANING },
  countries: buildCountries(countriesGeojson),
  regions: buildRegions(regionsGeojson),
};

const { countryCount, regionCount } = validateReferencePoints(payload);
mkdirSync(dirname(args.output), { recursive: true });
writeFileSync(args.output, JSON.stringify(payload));
console.log(`natural-earth reference points: ${countryCount} countries, ${regionCount} regions -> ${args.output}`);
