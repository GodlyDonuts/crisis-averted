# God's Eye Native Rust Application

`godseye-native` is the native Rust companion implementation of the God's Eye command-center concept. It is intentionally separate from the static Next.js deployment so the web product remains lightweight while the native version can evolve toward a fully GPU-resident, high-performance intelligence workstation.

## Current milestone

- Macroquad/OpenGL desktop shell
- Textured 3D Earth
- Mouse orbit and wheel zoom
- Embedded conflict fallback snapshot
- Embedded OSINT aircraft/environment snapshot
- Batched octahedral incident and aircraft markers
- Aircraft dead-reckoning vectors
- Operational incident list and command statistics

## Run

```bash
cd native/godseye-native
cargo run --release
```

The application embeds the repository's current public snapshots at compile time. Rebuild after refreshing `frontend/public/data/osint-snapshot.json` or `frontend/public/data/conflict-fallback.json`.

## Architecture direction

The long-term native split should be:

- `godseye-core`: data normalization, spatial math, filtering, prioritization, track propagation, clustering
- `godseye-render`: GPU globe, instanced markers, camera, atmosphere/terrain shaders
- `godseye-ui`: command panels, inspector, filtering, search, alerts
- `godseye-net`: optional endpoint refresh and cache snapshots

The first implementation uses Macroquad to keep the graphics stack portable and avoid the much larger Bevy dependency graph. Rendering-critical data is already batched into triangle meshes instead of issuing hundreds of sphere draw calls.
