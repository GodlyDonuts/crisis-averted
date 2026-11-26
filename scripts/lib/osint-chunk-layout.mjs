/**
 * Canonical domain layout for the domain-chunked OSINT snapshot publication
 * (catalog batch 18). This module is deliberately dependency-free so build,
 * validation, and governance code share one deterministic contract.
 */
export const OSINT_MANIFEST_SCHEMA_VERSION = 'osint-snapshot-manifest/v1';
export const OSINT_SNAPSHOT_SCHEMA_VERSION = 'osint-snapshot/v2-domain-chunked';
export const OSINT_LEGACY_SCHEMA_VERSION = 'osint-snapshot/v1-monolithic-compatibility';
export const OSINT_CHUNK_DATA_DIR = 'data/osint';
export const OSINT_MANIFEST_PATH = 'data/osint/manifest.json';
export const OSINT_LEGACY_SNAPSHOT_PATH = 'data/osint-snapshot.json';

function collection(key, kind) {
  return Object.freeze({ key, kind });
}

function chunk(spec) {
  return Object.freeze({
    ...spec,
    fileName: `${spec.id}.v1.json`,
    schemaVersion: `osint-domain-chunk/${spec.id}/v1`,
    collections: Object.freeze(spec.collections),
    dependencies: Object.freeze([...spec.dependencies]),
    externalArtifactDependencies: Object.freeze([...(spec.externalArtifactDependencies ?? [])]),
  });
}

/**
 * Layout order is the deterministic publication/loading order. `critical`
 * chunks are fetched before every background chunk; priority is retained in
 * the manifest so future clients can reproduce the ordering without parsing
 * implementation code.
 */
export const OSINT_CHUNK_LAYOUT = Object.freeze([
  chunk({
    id: 'conflict',
    title: 'Conflict incident lattice',
    priority: 0,
    critical: true,
    dependencies: [],
    collections: [
      collection('mapOfWarsEvents', 'records'),
      collection('ucdpMeta', 'metadata'),
    ],
  }),
  chunk({
    id: 'connectivity',
    title: 'Internet connectivity outages',
    priority: 10,
    critical: true,
    dependencies: [],
    externalArtifactDependencies: [
      { path: 'data/ne_110m_admin_0_countries.geojson', reason: 'Natural Earth reference geometry is the pinned coarse country/region placement reference disclosed in IODA coordinate provenance' },
    ],
    collections: [
      collection('internetOutages', 'records'),
      collection('internetOutageMeta', 'metadata'),
    ],
  }),
  chunk({
    id: 'environmental',
    title: 'Environmental events',
    priority: 20,
    critical: true,
    dependencies: [],
    collections: [collection('naturalEvents', 'records')],
  }),
  chunk({
    id: 'orbital',
    title: 'Orbital objects and launches',
    priority: 30,
    critical: false,
    dependencies: [],
    collections: [
      collection('satellites', 'records'),
      collection('launches', 'records'),
    ],
  }),
  chunk({
    id: 'transport-aviation',
    title: 'Transport and aviation tracks',
    priority: 40,
    critical: false,
    dependencies: [],
    collections: [
      collection('militaryAircraft', 'records'),
      collection('aircraft', 'records'),
    ],
  }),
  chunk({
    id: 'maritime',
    title: 'Maritime AIS vessels',
    priority: 50,
    critical: false,
    dependencies: [],
    collections: [collection('vessels', 'records')],
  }),
  chunk({
    id: 'media-context',
    title: 'Media attention and situational context',
    priority: 60,
    critical: false,
    // Media attention is conflict-theme-derived context. This is a semantic
    // dependency, not a parse-time requirement; the chunk remains self-contained.
    dependencies: ['conflict'],
    collections: [
      collection('news', 'records'),
      collection('gpsInterference', 'records'),
      collection('webcams', 'records'),
      collection('gdeltGeoNews', 'records'),
      collection('gdeltGeoMeta', 'metadata'),
    ],
  }),
  chunk({
    id: 'cyber',
    title: 'Known exploited vulnerability evidence',
    priority: 70,
    critical: false,
    dependencies: [],
    collections: [
      collection('cyberVulnerabilities', 'records'),
      collection('cyberVulnerabilityMeta', 'metadata'),
    ],
  }),
  chunk({
    id: 'provenance',
    title: 'Source and provenance metadata',
    priority: 80,
    critical: false,
    dependencies: [
      'conflict',
      'connectivity',
      'environmental',
      'orbital',
      'transport-aviation',
      'maritime',
      'media-context',
      'cyber',
    ],
    collections: [collection('provenanceLedger', 'metadata')],
  }),
]);

export const OSINT_CHUNKS_BY_ID = Object.freeze(Object.fromEntries(OSINT_CHUNK_LAYOUT.map((entry) => [entry.id, entry])));

export const OSINT_COLLECTION_TO_CHUNK = Object.freeze(Object.fromEntries(
  OSINT_CHUNK_LAYOUT.flatMap((entry) => entry.collections.map((item) => [item.key, entry])),
));

/** Original monolithic root-field insertion order retained for the compatibility artifact. */
export const OSINT_SNAPSHOT_FIELD_ORDER = Object.freeze([
  'fetchedAt',
  'sources',
  'militaryAircraft',
  'aircraft',
  'vessels',
  'satellites',
  'news',
  'launches',
  'naturalEvents',
  'gpsInterference',
  'mapOfWarsEvents',
  'webcams',
  'cyberVulnerabilities',
  'cyberVulnerabilityMeta',
  'internetOutages',
  'internetOutageMeta',
  'ucdpMeta',
  'gdeltGeoNews',
  'gdeltGeoMeta',
  'errors',
  'provenanceLedger',
]);

export const OSINT_MANIFEST_ROOT_FIELDS = Object.freeze(['fetchedAt', 'sources', 'errors']);

export function chunkPublicPath(chunkSpec) {
  return `${OSINT_CHUNK_DATA_DIR}/${chunkSpec.fileName}`;
}

export function chunkJsonPointer(collectionKey) {
  return `/collections/${collectionKey}`;
}
