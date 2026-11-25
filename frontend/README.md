# God's Eye — Global Conflict Observation Lattice

A cinematic Next.js/WebGL intelligence console inspired by the *Fast & Furious* “God’s Eye”. The application renders a realistic 3D Earth with live conflict-event intelligence, priority theaters, incident filtering, signal arcs, satellite imagery mode, and a command-center HUD.

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` or `http://localhost:3000/globe`.


## Hosted deployment

The static production build is deployed to GitHub Pages:

**https://godlydonuts.github.io/crisis-averted/**

GitHub Actions rebuilds and redeploys on every `main` push and twice hourly. During each deployment the OSINT snapshot is refreshed from public endpoints including ADSB.lol military aircraft, Google News RSS/GDELT conflict coverage, Launch Library 2, NASA EONET, USGS earthquakes, WarHeatMap, and Map of Wars/UCDP-derived events.

Production validation:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Experience

- Real-time day/night Earth shader using local Blue Marble and city-light textures
- Animated cloud shell, atmosphere, bloom, orbital assets, and cinematic scan-line treatment
- Esri World Imagery satellite mode (`/globe?mode=satellite`)
- Live WarHeatMap conflict events with a generated offline fallback snapshot
- Incident density fields, pulsing beacons, signal arcs, country-boundary lattice, and theater isolation
- Search, category/severity/time filters, clickable event feed, theater ranking, and incident detail intelligence cards
- Mobile intelligence sheet for incident/theater browsing on small screens

## Key structure

```text
src/
├── app/
│   ├── page.tsx                         # God's Eye entry point
│   └── globe/page.tsx                   # Globe route using the same experience
├── components/godseye/
│   ├── GodEyeCommandCenter.tsx          # Application state and HUD composition
│   ├── GodEyeGlobe.tsx                  # WebGL Earth and geospatial layers
│   ├── TopCommandBar.tsx                # Status, search, mode and refresh controls
│   ├── TheaterList.tsx                  # Priority conflict theater panel
│   ├── EventFeed.tsx                    # Live incident feed
│   ├── EventDetailPanel.tsx             # Detailed incident intelligence card
│   ├── ControlDeck.tsx                  # Filters, timeline and layer controls
│   ├── MobileIntelSheet.tsx             # Mobile incident/theater browser
│   └── BootSequence.tsx                 # Initialization overlay
├── hooks/useConflictEvents.ts           # Live/fallback data lifecycle
├── lib/conflictData.ts                  # Normalization, aggregation and filtering
└── types/conflict.ts                    # Shared conflict-intelligence types
```

## Data and imagery attribution

- Conflict event data: [WarHeatMap.app](https://warheatmap.app/) and [Map of Wars](https://mapofwars.org/) public endpoints, including UCDP-derived battle events. WarHeatMap data is CC BY 4.0. OSINT incident data may be incomplete, corrected, merged, or delayed.
- Satellite imagery: Esri, Maxar, Earthstar Geographics.
- Earth textures are stored locally in `public/textures/`; Natural Earth country boundaries are in `public/data/`.

The live feed is cached client-side and refreshed at a conservative interval. If it is unavailable, the app transparently falls back to `public/data/conflict-events-fallback.json`.

## Legacy routes

Older hackathon-era routes such as `/dashboard` and `/finance` still exist for reference, but the primary product experience is now the God's Eye command center at `/` and `/globe`.
