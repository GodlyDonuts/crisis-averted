# Globe Rendering & Geospatial Visualization — Feature Ideas 251–500

Continuation of the feature-idea ledger, focused on high-performance realistic globe rendering, geospatial layers, WebGL optimization, picking, tracks, clustering, visualization integrity, terrain/weather/satellite imagery, time playback, and GPU/WASM architecture. Priorities: P0 = foundation/critical, P1 = high operational value, P2 = valuable, P3 = exploratory.

## A. Rendering Core & WebGL Optimization (251–275)

251. [P0] Instanced event rendering — batch all conflict-event markers into one InstancedMesh with per-instance position/intensity attributes, cutting thousands of draw calls to one.
252. [P0] Frame-budget governor — measure rolling frame time and automatically step fidelity tiers up or down to hold 60 fps (30 on low-end hardware).
253. [P0] Device-pixel-ratio cap — clamp renderer pixel ratio at 1.5 by default; full retina resolution quadruples fragment cost for negligible gain at globe scale.
254. [P0] Multi-resolution polygon cache — precompute country border tessellations at three detail levels and swap by camera altitude instead of re-triangulating at runtime.
255. [P0] Frustum-culled instance upload — maintain a lat/lng bounding-region index so only visible instances are written to GPU buffers each frame.
256. [P1] Half-float attribute packing — encode positions and intensities in Uint16/Float16 buffers to halve vertex memory bandwidth on integrated GPUs.
257. [P1] Glyph texture atlas — pack all marker icons into a single atlas with per-instance UV offsets to eliminate texture rebinds within a frame.
258. [P1] Static-geometry draw merging — bake coastline, graticule, and border lines into one merged BufferGeometry rendered in a single draw call.
259. [P1] On-demand render loop — render only on camera move, data change, or active animation instead of a continuous rAF loop, cutting idle power use to near zero.
260. [P2] Mipmapped glyph textures — generate mipmaps for all glyph and raster textures to reduce aliasing shimmer during zoom transitions.
261. [P1] Far-side occlusion correctness — depth-test markers against the globe body and pre-cull far-hemisphere instances in WASM so back-side events never bleed through the planet.
262. [P2] Level-of-detail arcs — reduce arc tessellation segment counts with distance; distant arcs collapse to simple polylines.
263. [P1] Prewarmed shader compilation — compile all programs at startup via renderer.compile() with dummy objects to eliminate first-use hitches during critical interactions.
264. [P2] Parallel shader compilation — enable KHR_parallel_shader_compile where supported to shorten startup stalls on multi-core machines.
265. [P1] Buffer pool reuse — allocate fixed-size typed-array pools reused across frames instead of per-update allocation, avoiding GC pauses during playback.
266. [P2] OffscreenCanvas worker rendering — move the render loop into a dedicated worker where supported so main-thread UI jank never drops frames.
267. [P2] Adaptive resolution scaling — dynamically scale the render target between 0.75x and 1.0x based on measured frame-time headroom.
268. [P1] WebGL context-loss recovery — handle context loss by snapshotting layer state and rebuilding GPU resources automatically without a page reload.
269. [P2] Single-pass antialiasing — use FXAA/SMAA on the composited output instead of MSAA on the whole framebuffer to reduce memory bandwidth on mobile GPUs.
270. [P3] WebGPU evaluation harness — prototype the marker pipeline in WebGPU behind a feature flag to benchmark instancing and compute-culling gains before committing.
271. [P1] Opaque-first render ordering — render opaque globe geometry before translucent layers so overdraw is depth-rejected cheaply.
272. [P2] Point sprites for distant markers — replace circular point geometry with point sprites at low zoom, cutting vertex throughput roughly 4x.
273. [P2] Instanced polygon extrusion — render country extrusions as instanced prism geometry rather than individually generated extruded meshes.
274. [P1] Precomputed orientation quaternions — compute per-instance surface-orientation quaternions once in WASM instead of per-frame in JS.
275. [P2] Opacity-bucket render sorting — draw opaque first, then additive, then alpha-blended layers to minimize state changes and blending artifacts.

## B. GPU/WASM Architecture (276–300)

276. [P0] WASM spatial index — extend godseye-core with a KD-tree over event lat/lng for sub-millisecond viewport and radius queries.
277. [P0] Zero-copy shared buffers — load event data into WASM linear memory once and keep it resident; queries return index lists only, never re-serialized rows.
278. [P0] WASM-driven culling — move frustum and horizon culling into Rust so the JS side only writes final instance arrays into GPU buffers.
279. [P1] SIMD-accelerated filtering — compile the WASM core with simd128 to vectorize lat/lng distance tests and intensity thresholds.
280. [P1] Double-buffered GPU upload — alternate two instance-attribute buffers so WASM writes never stall against an in-flight GPU read.
281. [P1] Columnar event storage — store events as structure-of-arrays (lat[], lng[], intensity[], time[]) for cache-friendly SIMD scans.
282. [P1] Worker-side WASM execution — run all filtering and aggregation in a Web Worker so the main thread never blocks on large datasets.
283. [P2] Ring-buffer time index — maintain a WASM index sorted by occurred_at for O(log n) time-window extraction during playback.
284. [P1] Typed-array transfer semantics — transfer rather than clone ArrayBuffers between worker and main thread to avoid multi-megabyte copies per frame.
285. [P2] WASM clustering pass — compute grid/h3 aggregation in Rust returning cell centroids and counts instead of raw points at low zoom.
286. [P2] Fixed output arenas — pre-allocate WASM output memory sized by dataset and reuse across queries, keeping memory growth flat over long sessions.
287. [P1] Bitmask category filters — encode event categories as a u32 bitmask so multi-select filtering is a single AND per row.
288. [P2] Persistent bounding-volume hierarchy — build a static BVH over events at load time in WASM for accelerated picking and range queries.
289. [P3] GPU compute picking probe — evaluate a WebGPU compute pass testing ray-vs-event spheres entirely on GPU when available.
290. [P2] Centralized WASM geospatial math — implement haversine, bearing, destination-point, and great-circle interpolation once in Rust for consistent results across all features.
291. [P1] Progressive data hydration — stream events into WASM memory in chunks as they arrive so first paint isn't blocked by the full dataset.
292. [P2] Delta-encoded timestamps — store times as delta-encoded u32 in WASM memory, halving footprint for multi-year archives.
293. [P2] WASM arc tessellation — generate great-circle arc vertex positions in Rust writing directly into GPU-bound buffers.
294. [P1] WASM query-cost telemetry — instrument filtering/culling cost inside Rust and export counters to the performance HUD.
295. [P2] Fixed-point coordinate quantization — quantize lat/lng to i32 at 1e-5 degree precision, enabling integer SIMD comparisons and stable equality tests.
296. [P3] Memory64 evaluation — test the WASM memory64 target for future datasets exceeding 2 GB of linear memory.
297. [P2] Parallel worker sharding — shard events by longitude band across 2–4 WASM workers for parallel filtering on multi-core machines.
298. [P1] Runtime feature detection ladder — probe SIMD, threads, and SharedArrayBuffer support at boot and select the fastest available execution path automatically.
299. [P2] WASM golden-dataset test harness — validate culling and aggregation kernels against fixed input/output pairs in CI to catch math regressions.
300. [P3] GPU-resident time series — investigate storing time-windowed attributes in textures so playback becomes a uniform update instead of buffer re-upload.

## C. Geospatial Data Layers (301–325)

301. [P0] Layer registry with z-order contract — central registry defining draw order, blending mode, and opacity per layer to prevent ad-hoc ordering bugs as layers multiply.
302. [P0] Country severity choropleth — fill country polygons by severity or funding-gap score using a documented, colorblind-safe sequential scale.
303. [P0] Conflict-event point layer — lat/lng events sized by intensity and colored by category with a legend binding sizes to exact value ranges.
304. [P1] H3 hexagonal aggregation layer — aggregate events into h3 cells at resolution matched to zoom, rendered as a flat hex grid.
305. [P1] Displacement-flow arc layer — directional arcs for refugee/IDP movements with volume encoded in width, not color alone.
306. [P1] Funding-flow arc layer — donor-to-recipient arcs with direction chevrons so capital flows are never visually confused with displacement flows.
307. [P1] Critical-infrastructure layers — hospitals, airports, ports, and power stations as toggleable icon layers sourced from HDX/OpenStreetMap extracts.
308. [P2] Major-road network layer — simplified primary-road polylines appearing at country zoom for corridor-assessment use cases.
309. [P2] Border-crossing status layer — official crossing points colored by open/restricted/closed status with last-verified timestamps.
310. [P1] Active-combat-zone polygons — contested-area or exclusion polygons as translucent fill with a hatch pattern that survives printing and colorblindness.
311. [P2] Humanitarian-presence layer — active project counts per admin-1 region from HPC data, rendered as scaled polygons or centroids.
312. [P2] IPC food-security phase layer — phase classification (1–5) per region using the official IPC color scale for inter-agency legibility.
313. [P3] Population-density raster — WorldPop/GHSL density tiles as a dimmable base overlay for exposure estimation.
314. [P2] Admin-1 boundary lines — first-order administrative boundaries appearing beyond a zoom threshold, avoiding clutter at global scale.
315. [P3] Maritime zone layer — EEZ boundaries and naval warning areas for Red Sea-type corridor monitoring.
316. [P2] Per-layer opacity and blend controls — opacity sliders and blend-mode selection (normal/additive/multiply) persisted in view state.
317. [P1] Layer provenance badges — every layer carries a visible source-and-freshness badge (e.g., "ACLED, updated 2h ago") as a condition of operational trust.
318. [P2] Vector-tile base geometry — migrate country/admin geometry to static PMTiles/MVT, replacing bulky embedded GeoJSON.
319. [P1] Zoom-ranged layer activation — layers declare min/max zoom so detail fades in and out automatically without manual toggling.
320. [P3] Analyst CSV/KML import — drop-in CSV of coordinates or KML file rendered as a temporary overlay layer for ad-hoc field data.
321. [P2] Kernel-density heat layer — event density computed in WASM and rendered as a gradient texture draped on the sphere, with the kernel radius disclosed.
322. [P2] Graticule and coordinate readout — toggleable lat/lng grid plus cursor readout in decimal degrees and MGRS for cross-system communication.
323. [P3] Sea-lane and air-corridor reference lines — principal shipping lanes and humanitarian air corridors as reference geometry.
324. [P2] Operational layer presets — named presets ("Displacement crisis", "Food insecurity", "Conflict intensity") toggling curated layer sets in one click.
325. [P3] Temporal coverage metadata — layers declare valid time ranges so incompatible periods can't be overlaid without an explicit warning.

## D. Picking & Interaction (326–350)

326. [P0] GPU color picking pass — render picking IDs to a small offscreen target once per click instead of CPU-raycasting thousands of objects.
327. [P0] Screen-space pick tolerance — expand effective pick radius in pixels so small markers remain clickable at every zoom level.
328. [P0] Allocation-free hover highlight — implement highlighting as an instanced-attribute update or shader uniform, never a geometry rebuild.
329. [P1] Priority-ranked pick resolution — when candidates overlap at the cursor, resolve by severity/visibility rank rather than incidental draw order.
330. [P1] Click-cycling through overlaps — repeated clicks cycle through stacked/overlapping entities so occluded items remain reachable.
331. [P1] Cluster drill-down on click — clicking a cluster zooms to its expansion level rather than only opening a popup.
332. [P1] Marquee rectangle select — drag a screen-space rectangle to select all contained events, resolved in WASM against the spatial index.
333. [P2] Lasso polygon select — freehand selection converted to a geodesic polygon for spatial filtering of the event set.
334. [P1] Standardized tooltip schema — fixed fields (event type, date, severity, source, location precision) so semantics are consistent across all pickable layers.
335. [P2] Keyboard-navigable selection — arrow keys cycle visible events with a visible focus ring for accessibility and precise review.
336. [P2] Modifier-key multi-select — shift-click builds a selection set driving the comparison panel.
337. [P1] Pick-accuracy audit mode — debug overlay rendering pick-radius circles to verify hit areas match visible glyphs.
338. [P2] View-center pick priority — among overlapping candidates, prefer events nearest the camera focus point at high density.
339. [P1] Frame-throttled hover picking — throttle hover pick queries to animation frames to avoid recompute storms during fast pointer movement.
340. [P2] Click/drag disambiguation — suppress click selection if the pointer moved beyond a few pixels so camera drags never trigger accidental picks.
341. [P1] Touch-sized hit targets — enforce 44px minimum hit targets on touch devices regardless of glyph size.
342. [P2] Country-fill selection context — clicking a country selects it as the active boundary, filtering all other layers to that polygon.
343. [P3] Arc curve picking — picking anywhere along an arc resolves via closest-point-on-curve computed in WASM.
344. [P1] Sticky hover during playback — hover targets don't flicker during time playback; selection persists until the pointer genuinely leaves.
345. [P2] Visible-hemisphere pick verification — confirm picked items are on the camera-facing hemisphere before showing tooltips, eliminating phantom picks through the globe.
346. [P2] Double-click zoom-to-entity — double-clicking any event or cluster flies the camera to a detail zoom centered on it.
347. [P3] Long-press radial menu — touch long-press opens a radial menu (details, filter-to-this, compare) for field tablets.
348. [P2] Selection state in URL — encode selected entity IDs in the URL hash so shared links reproduce the exact selection.
349. [P2] Layer-tagged pick results — every pick response includes the originating layer so click routing stays correct as layer count grows.
350. [P3] Contextual cursor states — cursor reflects interaction mode and pickability beneath the pointer (crosshair/pointer/grab).

## E. Tracks, Routes & Movement Visualization (351–375)

351. [P0] Entity track polylines — render vessel/aircraft/convoy movement as time-stamped polylines following the ellipsoid surface.
352. [P0] Direction chevrons on tracks — animated chevrons indicate direction of movement; direction is operationally critical and must never be ambiguous.
353. [P1] Age-faded track segments — older track segments fade by age so current position dominates visually.
354. [P1] Corridor buffer polygons — render a semi-transparent buffer along planned routes for safe-corridor planning and clearance checks.
355. [P1] Speed-encoded track coloring — color segments by speed to expose loitering versus transit behavior.
356. [P2] Zoom-dependent track simplification — apply Ramer–Douglas–Peucker in WASM with zoom-scaled epsilon to keep vertex counts bounded.
357. [P1] Distinct current-position markers — head-of-track markers pulse independently of the historical path, drawn in the additive pass.
358. [P2] Corridor aggregation of displacement tracks — merge many individual movement tracks into volume-scaled corridor ribbons.
359. [P2] Great-circle interpolation in playback — interpolate positions along geodesics during playback rather than teleporting between fixes.
360. [P2] Chord-artifact prevention — sample track lines densely enough to hug the sphere at all zooms; no straight chords cutting through the globe interior.
361. [P1] Track event tick markers — flag significant events along tracks (stops, gaps, border crossings) with small marker ticks.
362. [P2] Data-gap dash rendering — render dashed segments where tracking was lost so interpolated spans are never mistaken for observations.
363. [P1] Fixed-length temporal trails — trails show the trailing N hours/days of movement, configurable per layer.
364. [P3] Predicted-position ghosting — extrapolated positions render as visually distinct ghost markers, never styled like observations.
365. [P2] Low-zoom track collapse — collapse overlapping tracks into corridor bands when zoomed out to avoid unreadable line spaghetti.
366. [P1] Track focus mode — clicking a track isolates it (dimming all others) and opens its timeline summary.
367. [P2] Synchronized multi-entity playback — time playback animates all tracks simultaneously against one shared clock.
368. [P3] Planned-vs-actual route overlay — overlay planned and actual convoy routes with deviation-distance readout.
369. [P2] Chokepoint crossing counters — automatic count badges where tracks cross defined chokepoints (straits, border posts).
370. [P1] Per-track vertex budgets — enforce vertex caps with adaptive decimation so long-running tracks cannot degrade frame rate.
371. [P3] Altitude-extruded flight tracks — render air tracks at altitude-proportional height with vertical drop-lines to ground positions.
372. [P2] Bidirectional flow separation — never render opposing flows as one line; offset or chevron counter-directional movements.
373. [P3] Port-pair volume ribbons — collapse vessel tracks into port-to-port ribbons scaled by volume for maritime supply overviews.
374. [P2] Track staleness indication — tracks whose last fix exceeds a freshness threshold render with a dashed tail and clock badge.
375. [P3] Track export — one-click export of waypoints, distances, and timeline as CSV/GeoJSON for handoff to logistics systems.

## F. Clustering & Aggregation (376–400)

376. [P0] Zoom-aware cluster decomposition — clusters subdivide predictably along the h3 hierarchy as zoom increases; never arbitrary re-clustering.
377. [P0] Exact cluster count labels — every cluster displays its exact contained-event count, never capped or abbreviated without an expansion affordance.
378. [P0] Deterministic cluster membership — membership is stable across pans at fixed zoom so positions don't jitter during interaction.
379. [P1] Severity-weighted cluster color — cluster color reflects maximum or weighted severity of contents, with the rule documented in the legend.
380. [P1] Bounded cluster scaling — cluster radius scales with sqrt(count) within fixed min/max bounds to prevent overlap at extreme densities.
381. [P1] Spiderfied expansion at max zoom — clicking a dense cluster at maximum zoom expands members radially so individual events stay selectable.
382. [P1] Server-side pre-aggregation — precompute h3 aggregations at several resolutions in the backend so low zooms never ship raw points.
383. [P2] Weighted-centroid cluster positions — position clusters at the count-weighted centroid rather than a grid anchor so locations are geographically honest.
384. [P1] Category composition in clusters — mixed-category clusters expose composition (mini stacked bar) instead of hiding it behind a single color.
385. [P2] Flicker-free temporal clustering — during playback, clusters recompute per frame in WASM with hysteresis thresholds to prevent popping.
386. [P2] Cluster-matched pick radius — picking radius scales with cluster glyph radius so large clusters are clickable across their full extent.
387. [P2] Cluster-to-point transition animation — animate member points outward from clusters on zoom-in to communicate containment.
388. [P2] Supercluster fallback path — pure-JS supercluster fallback when WASM is unavailable, with identical visual semantics and thresholds.
389. [P1] Critical-event exemption — high-severity events are never absorbed into clusters below a zoom threshold; they always render individually.
390. [P2] Cluster composition tooltips — cluster tooltips list top categories, date range, and totals, not just a count.
391. [P3] Grid-versus-hex validation toggle — internal comparison of square-grid versus h3 aggregation for validating hot-spot artifacts.
392. [P2] Persistent cluster expansion state — expansion state survives layer toggles and time scrubs within a session.
393. [P3] Screen-space cluster decluttering — overlapping clusters resolve via displacement with leader lines rather than visual overlap.
394. [P1] Cluster-snapped arc endpoints — arc endpoints snap to cluster centroids at low zoom so flows terminate coherently rather than stacking in one pixel.
395. [P3] Density-adaptive merge radius — cluster merge radius scales inversely with local density to preserve spatial structure in both dense and sparse regions.
396. [P2] Filter-before-aggregation rule — filters apply before aggregation so cluster counts always reflect the filtered population.
397. [P2] Export-parity counts — cluster-displayed counts match exported CSV numbers exactly for the same filter set.
398. [P3] Adjacent-resolution prefetch — prefetch neighboring h3 resolution aggregations so zoom transitions render instantly.
399. [P2] Raw-point threshold — below roughly 200 visible events, disable clustering entirely and render raw points; the threshold is explicit in the UI.
400. [P3] Cluster roll-up summary bar — selecting clusters aggregates stats (events, fatalities, actors) into a summary bar for situation reports.

## G. Visualization Integrity & Accuracy (401–425)

401. [P0] Binding legends — every color/size encoding has a visible legend with exact numeric breaks; no unlabeled continuous scales anywhere.
402. [P0] One channel, one variable — a single visual channel never encodes two variables; color never simultaneously means severity and category.
403. [P0] Data-freshness watermarks — every layer displays its data timestamp; stale layers gain a visible staleness frame after a defined age.
404. [P0] Precision-honest geometry — events geolocated only to admin level render as fuzzy region fills, not false-precision points.
405. [P0] Zero-baseline magnitudes — extrusion heights and point sizes always scale from zero; truncated scales that exaggerate differences are prohibited.
406. [P1] Colorblind-safe default palette — default palettes validated for deuteranopia, with a high-contrast alternate theme available.
407. [P1] Mandatory unit annotations — tooltips and legends always carry units (persons, USD, events); bare numbers are a defect.
408. [P1] Extrusion literacy note — onboarding documents that extruded heights must be compared by height, not apparent screen area, which varies with latitude.
409. [P1] Verification-status grammar — unverified reports render hollow/dashed until confirmed, and the distinction survives clustering.
410. [P1] Missing-versus-zero distinction — regions with no data render as neutral hatch, visually distinct from regions with a measured zero.
411. [P2] Uncertainty ribbons on forecasts — prediction layers render confidence intervals as ribbons, never single unqualified lines.
412. [P1] Shared scales in comparison mode — country/period comparisons share normalized scales by default, with an explicit toggle for local scales.
413. [P2] Aggregation cell-size disclosure — hex/grid layers disclose cell dimensions ("cells are ~65 km across") so hot-spots aren't over-interpreted.
414. [P2] No decorative motion — remove particle effects and idle animation that could be mistaken for data; all motion must encode meaning.
415. [P1] Truthful print exports — exported images embed legends, timestamps, and scale bars rather than the bare globe.
416. [P2] Full-range time defaults — time filters default to the full available range; narrow windows require explicit user action.
417. [P1] Anchored labels — labels never float free of their feature; displaced labels draw leader lines to their anchor.
418. [P2] Uniform rounding policy — consistent rounding rules everywhere (exact fatality counts, dollar amounts to two significant digits), documented in one place.
419. [P2] Per-capita normalization toggle — population normalization available for intensity layers with the denominator source disclosed.
420. [P2] Multi-source deduplication — overlapping events from multiple sources at the same location/date get a multi-source badge rather than double-counting.
421. [P3] Source-bias disclosure — layer info panels disclose known biases (e.g., media-reporting bias in event data) with citations.
422. [P2] Geodesically correct scale bar — scale bar computed on the ellipsoid at view center, accurate within 1 percent.
423. [P1] Sentinel-value hygiene — unknown/missing source values never render as zero; they are excluded or styled as unknown.
424. [P2] Labeled playback speed — time playback speed is labeled in real terms ("1 sec = 1 week"); acceleration never silently distorts duration perception.
425. [P3] Visual integrity audit checklist — pre-release checklist verifying every encoding against the rules above, run on each release.

## H. Terrain, Weather & Satellite Imagery (426–450)

426. [P0] Satellite base imagery — low-zoom global satellite basemap (NASA GIBS/Blue Marble class) as an optional realistic base under all data layers.
427. [P0] Fixed terrain exaggeration — vertical exaggeration fixed at 1.0x by default with an explicit control; exaggerated terrain must never distort perceived severity.
428. [P1] Hillshade relief layer — shaded relief from low-resolution DEM tiles giving pass/valley context relevant to ground logistics.
429. [P1] Bathymetry toggle — ocean-depth shading for maritime corridor analysis.
430. [P1] Live weather overlay — current precipitation/cloud raster from a free API (OpenWeather/NOAA GFS tiles) with a data timestamp.
431. [P2] Weather-at-event-time lookup — clicking a historical event can retrieve archived reanalysis weather for that date/location, aiding incident verification.
432. [P2] Cyclone forecast cone layer — active tropical-cyclone tracks and forecast cones from NOAA/JTWC for disaster-response anticipation.
433. [P2] Flood-extent overlays — near-real-time satellite-derived flood polygons for rapid impact estimation.
434. [P1] Terrain-conformant marker placement — markers and extrusions sit on the terrain surface when terrain is enabled, not at zero elevation.
435. [P2] Cursor elevation readout — elevation displayed alongside cursor coordinates, sampled from the DEM.
436. [P2] LOD terrain tiles — quantized-mesh or heightmap tiles at zoom-dependent resolution with a maximum-resolution cap for bandwidth control.
437. [P1] Imagery vintage disclosure — satellite base layers disclose capture era ("imagery circa 2020") so users never assume currency.
438. [P2] Night-lights layer — VIIRS night-lights composite as an optional base, relevant to outage and economic-activity analysis.
439. [P2] Active-fire detection layer — MODIS/VIIRS thermal anomaly points with detection-time labels for fire-conflict correlation.
440. [P2] Snow-cover extent layer — seasonal snow raster relevant to high-altitude access constraints.
441. [P3] Land-cover context layer — simplified land-cover coloring (cropland/urban/forest) for displacement-camp siting context.
442. [P2] Offline tile packaging — prepackage low-zoom satellite/terrain tiles with the app so demos and low-connectivity field use work offline.
443. [P1] Prioritized tile loading — visible-hemisphere tiles load first; stale tile requests are cancelled aggressively during camera moves.
444. [P2] Compressed terrain encoding — brotli-compressed heightmap tiles with quantized i16 elevation to minimize bandwidth.
445. [P2] GPU vertex displacement — displace sphere vertices in the vertex shader from a heightmap texture instead of CPU mesh generation.
446. [P3] Physically grounded atmosphere — subtle Rayleigh-scattering approximation kept restrained so it never interferes with data colors.
447. [P2] Day/night terminator — accurate solar terminator for current UTC, relevant to time-zone-aware operational coordination.
448. [P3] Weather-layer contrast guard — animated weather overlays may never darken underlying data beyond recognition; enforce minimum data contrast.
449. [P2] Smoke-plume overlays — aerosol optical depth or smoke-plume rasters for fire-conflict correlation analysis.
450. [P1] Automated base-layer contrast check — verify data layers maintain adequate contrast against whichever base imagery is active; auto-dim the base when violated.

## I. Time Playback & Temporal Analysis (451–475)

451. [P0] Single temporal source of truth — one clock model (start/end/current) drives all time-aware layers, arcs, and tracks.
452. [P0] Timeline scrubber — draggable control with date labels, meaningful tick intervals, and keyboard stepping.
453. [P0] Playback speed control — speeds from 0.25x to 32x, labeled in real-time terms.
454. [P1] Windowed accumulation modes — toggle among cumulative, sliding-window, and instantaneous display, always clearly labeled.
455. [P1] Event lifecycle rendering — events fade in at occurrence and decay over a configurable afterglow; nothing accumulates into permanent noise.
456. [P1] Loop and ping-pong modes — loop for presentations, ping-pong for change-detection comparison.
457. [P1] Pause-on-inspect — playback pauses automatically on hover/pick so users can inspect without missing frames.
458. [P2] Temporal bookmarks — save named time positions and jump among them during briefings.
459. [P1] Time-brushing histogram — event-volume histogram beneath the timeline; brushing a range filters the globe.
460. [P2] Step-by-event navigation — advance to the next event rather than fixed time steps for detailed sequence review.
461. [P2] Dual-window comparison — overlay two time windows with distinct color coding for before/after analysis.
462. [P1] UTC-first clock display — prominent UTC clock with optional secondary local time for the viewed region.
463. [P2] Budget-aware time stepping — step size adapts so per-frame event deltas never exceed the render budget.
464. [P2] WASM time-window extraction — temporal filtering executes against the WASM time index, never a linear JS scan.
465. [P2] Real-time-unit trail lengths — track trail length is defined in real time units so meaning stays constant across playback speeds.
466. [P3] Seasonal decomposition view — aggregate events by week-of-year across years to expose seasonal patterns such as monsoon-driven displacement.
467. [P2] Synchronized split-time view — two globes at different time points sharing camera control for direct comparison.
468. [P2] Playback state in URLs — time range and current position encoded in shared links for reproducible handoff.
469. [P1] Temporal extent enforcement — UI shows the full available data range; selections outside it snap back with an explanation.
470. [P2] Frame-accurate video export — record playback to video or frame sequences for briefings, with embedded timestamp overlays.
471. [P3] Playback-linked event list — ordered event list synchronized to playback position; clicking an entry jumps the clock.
472. [P2] Rate-of-change layer — temporal-derivative heatmap showing where event frequency is accelerating or decelerating.
473. [P1] Deterministic playback — the same time position always yields identical frame content, enabling reproducible analysis and testing.
474. [P2] Worker-clock playback — playback runs on the worker clock so UI jank never affects temporal accuracy.
475. [P3] Future-projection lane — forecast layers extend the timeline beyond "now" inside a visually distinct hatched future zone.

## J. Reliability, Instrumentation & Operational Utility (476–500)

476. [P0] Performance HUD — toggleable overlay showing fps, frame time, draw calls, triangle count, and GPU memory.
477. [P0] Automated performance budgets — CI check asserting initial load size and minimum frame rate on reference hardware.
478. [P0] Layer-level error isolation — a crash in any layer never blanks the globe; failed layers deactivate with a visible error badge.
479. [P0] No-WebGL fallback — detect missing WebGL and present a static map image with explanation instead of a black screen.
480. [P1] Memory-leak watchdog — long-running sessions monitored for GPU buffer leaks with warnings before tab memory becomes critical.
481. [P1] Deterministic screenshot regression tests — render fixed camera/data states headlessly and diff images in CI to catch visual regressions.
482. [P1] Data-contract validation — validate incoming GeoJSON/API payloads against schema before rendering; malformed data is flagged, never silently dropped.
483. [P1] Coordinate-order verification — automated tests confirming WGS84 lon/lat interpretation, guarding against swapped-axis regressions.
484. [P2] Antimeridian correctness tests — arcs and tracks crossing the antimeridian render without wrapping artifacts.
485. [P2] Polar-region rendering tests — verify picking, clustering, and tracks near the poles where lon/lng math degrades.
486. [P1] UTC-canonical timestamps — all timestamps handled as UTC internally; display conversion happens only at the presentation edge.
487. [P2] Hot-reloadable layers in dev — development-mode layer reloading without full page refresh to speed iteration.
488. [P2] Reduced-motion support — respect prefers-reduced-motion by disabling idle rotation and non-essential animation.
489. [P1] Full keyboard camera control — pan/zoom/rotate entirely via keyboard for accessibility and precision positioning.
490. [P2] Touch gesture parity — pinch-zoom, two-finger rotate, and tap-hold matching mouse capabilities on field tablets.
491. [P2] Low-bandwidth mode — degrade imagery/terrain to vector-only rendering under constrained bandwidth, clearly disclosed.
492. [P2] Battery-aware rendering — reduce frame rate and disable idle animation on battery power.
493. [P1] Serializable camera state — camera position, altitude, and heading encode into reproducible shareable URLs.
494. [P2] Named operation save slots — persist complete view configurations (layers, filters, time, camera) as reloadable named operations.
495. [P2] Briefing export — export the current view as self-contained PNG/PDF with legend, timestamp, scale bar, and data sources.
496. [P3] Ultra-wide aspect tolerance — no aspect-ratio distortion when the window spans ultra-wide or multi-monitor layouts.
497. [P2] Opt-in idle rotation — attract-mode rotation only when explicitly enabled; never during active analysis.
498. [P2] Asset preloading pipeline — preload fonts, textures, and tile scaffolding during startup to eliminate mid-interaction stalls.
499. [P1] Rendering dependency pinning — pin three.js/react-globe.gl versions with a documented upgrade test plan, since visual regressions are silent.
500. [P3] Analyst error-reporting loop — in-app mechanism for analysts to flag visualization errors (wrong location, stale data) as structured reports back to the data team.
