# God's Eye Native Rust Application

`godseye-native` is the native Rust companion implementation of the God's Eye command-center concept. It is intentionally separate from the static Next.js deployment so the web product remains lightweight while the native version can evolve toward a fully GPU-resident, high-performance intelligence workstation.

## Current milestone

- Macroquad/OpenGL desktop shell with textured 3D Earth
- Mouse orbit, wheel zoom, target focus, and incident tour mode
- Embedded conflict fallback plus embedded OSINT snapshot for offline startup
- Background runtime refresh from the deployed static OSINT JSON without blocking first paint
- Optional operator-supplied local `osint-snapshot.json` refresh source
- Typed military/civil aircraft, AIS vessel, satellite TLE, launch, natural-event, GPS-interference, IODA outage, GDELT media-mention, source-metadata, and ingestion-error contracts
- Batched/capped mesh rendering with zoom-dependent aviation, maritime, and incident culling
- Client-side SGP4 satellite propagation (visual accuracy only) refreshed on a 10-second cadence
- Click inspectors for incidents, aircraft, vessels, satellites, launches, natural events, GPS cells, IODA outage groups, and GDELT media-attention groups
- Honest source-status panel for snapshot age, runtime provenance, refresh attempts, metadata status, provider errors, and unsupported native sections

## Run

```bash
cd native/godseye-native
cargo run --release
```

The application embeds the repository's current public snapshots at compile time, so it remains useful offline. Rebuild after refreshing `frontend/public/data/osint-snapshot.json` or `frontend/public/data/conflict-fallback.json` to update the embedded fallback.

At startup a worker thread also polls the deployed static snapshot by default:

```text
https://godlydonuts.github.io/crisis-averted/data/osint-snapshot.json
```

The network/local refresh never blocks UI startup. The embedded snapshot is shown immediately and is replaced only after a complete runtime snapshot has been downloaded/read and successfully parsed. If a refresh fails, the previous data remains active and the error is shown in the source-status panel.

### Refresh configuration

CLI flags and environment variables are equivalent:

```bash
cargo run --release -- \
  --snapshot "C:\\path\\to\\osint-snapshot.json" \
  --snapshot-url "https://godlydonuts.github.io/crisis-averted/data/osint-snapshot.json" \
  --refresh-interval 300
```

- `--snapshot PATH` / `GODSEYE_SNAPSHOT_PATH`: read a local snapshot each cycle. When present and valid it is deliberately preferred over the remote snapshot.
- `--snapshot-url URL` / `GODSEYE_SNAPSHOT_URL`: override the deployed static JSON URL. HTTPS is required by the runtime HTTP client.
- `--no-remote` / `GODSEYE_NO_REMOTE=1`: disable remote refresh.
- `--refresh-interval SECONDS` / `GODSEYE_REFRESH_SECONDS`: polling cadence. Default 300 seconds; values below 30 seconds are clamped to protect public endpoints.

Press `R` in the UI for a manual refresh and `S` for the detailed source-status panel.

## Controls

- Click: inspect globe entities
- `F`: focus selected entity
- `T`: priority incident tour
- `Space`: toggle drift
- `A`: military aircraft
- `C`: civil aviation
- `M`: maritime AIS
- `O`: orbital assets (satellites and launches)
- `E`: environmental events
- `I`: IODA internet outages
- `N`: GDELT media attention
- `G`: GPS/GNSS interference
- `B`: country borders
- `S`: source status
- `R`: refresh now
- `Esc`: close selection

## Rendering budgets

The current static caps follow or closely mirror the web client: 240 military aircraft, 700 civil aircraft, 900 vessels, 110 satellites, 24 launches, 70 natural events, 500 GPS cells, 220 grouped IODA markers, 240 grouped GDELT markers, and 900 near-zoom incident markers. Far zoom uses smaller prebuilt meshes and critical/high-priority incidents. Track vectors are independently capped. These are deliberate performance bounds; omitted points are not evidence of absence.

## Native limitations in this vertical slice

- No live WarHeatMap websocket/API merge and no web cross-source incident-correlation pass yet; incidents are embedded fallback plus normalized Map-of-Wars battle rows.
- Map-of-Wars non-battle rows are not folded into conflict incidents. Launches/vessels are shown from their dedicated arrays; Copernicus activation rows are currently count/schema-only in `mapOfWarsEvents`.
- Cyber-vulnerability and webcam payloads are parsed only as opaque JSON for counts/provenance; they are not visualized natively.
- Google/RSS news is shown as source context, not plotted.
- Satellite positions use published TLEs, SGP4, and an approximate Earth-rotation/WGS84 transform. They are suitable for globe context, not conjunction assessment or precision pointing.
- IODA coordinates are broad reference placements supplied for display, not outage origins or spatial footprints. GDELT points are places mentioned in news text, never verified incident locations.
- Runtime refresh expects a complete top-level snapshot JSON. Malformed snapshots are rejected as a whole rather than partially merged section-by-section.

## Architecture direction

The long-term native split should be:

- `godseye-core`: data normalization, spatial math, filtering, prioritization, track propagation, clustering
- `godseye-render`: GPU globe, instanced markers, camera, atmosphere/terrain shaders
- `godseye-ui`: command panels, inspector, filtering, search, alerts
- `godseye-net`: optional endpoint refresh and cache snapshots

The implementation uses Macroquad to keep the graphics stack portable and avoid the much larger Bevy dependency graph. Rendering-critical data is batched into triangle meshes instead of issuing hundreds of sphere draw calls; dynamic orbital positions are repropagated on a cadence rather than every frame.
