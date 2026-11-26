# Ideas 501–750: Analyst Workflows, Alerting & Decision Support

> Series file 003. Numbering continues from idea files 001–002.
>
> **Hard constraint for every idea below:** the app is deployed as a **static site on GitHub Pages**. There is no backend, no server-side compute, and no secrets or API keys may ship to the browser. All data arrives as pre-baked static bundles (JSON/GeoJSON/Parquet/Arrow) generated at build time; all logic runs client-side (main thread, Web Workers, or WASM); all persistence uses localStorage/IndexedDB; all sharing uses URL-encoded state or exported files. Priorities: P0 = critical, P1 = high, P2 = medium, P3 = nice-to-have.

## Analyst Workflow Core (501–525)

501. [P0] Analyst workspace with saved multi-panel layouts — persist panel grid configs to localStorage with a versioned schema-migration chain.
502. [P0] Case-centric workflow organizing filters, notes, pins, and evidence under a case ID — IndexedDB object store keyed by case with portable JSON export.
503. [P1] Daily briefing queue generated from snapshot deltas — diff consecutive dated static bundles in a Web Worker at load time.
504. [P1] Triage inbox ranking countries by severity-to-funding-gap change — precompute rank deltas into snapshot metadata at build time.
505. [P1] Keyboard-first command palette covering all analyst actions — fuzzy-matched client-side command registry with shortcut hints.
506. [P2] Shift-handoff summary generator — serialize open cases, watchlist hits, and annotations into one portable JSON handoff file.
507. [P1] Guided investigation checklists per crisis type — ship checklist templates as static markdown rendered into interactive task lists.
508. [P2] Session replay of analyst navigation and filter actions — in-memory event-sourced action log exportable as JSON lines.
509. [P2] Multi-hypothesis workspace tabs — parallel tabs each holding independent filter state in separate localStorage namespaces.
510. [P1] Pinboard for countries and clusters of interest — pinned ISO3+cluster tuples with free-text pin notes in IndexedDB.
511. [P2] Batch operations across pinned entities — run compare, export, or watchlist-add actions on pinboard selections in one click.
512. [P3] Personal analyst statistics (cases closed, mean time-to-assessment) — computed locally from the action log; nothing leaves the browser.
513. [P1] Workload queue ordered by HRI volatility — sort client-side using precomputed volatility series shipped in the static bundle.
514. [P2] Duplicate-case detection — hash normalized case parameters and warn when a matching hash already exists in IndexedDB.
515. [P2] Case templates for common scenarios (flood, displacement spike, funding cutoff) — parameterizable template JSON in static assets.
516. [P3] Focus mode hiding non-essential chrome during deep dives — CSS-class toggle plus keyboard shortcut, persisted per session.
517. [P2] Undo/redo for analyst actions — inverse-action stack with periodic state snapshot checkpoints capped in memory.
518. [P1] Quick-capture scratchpad with automatic entity linking — notes auto-link ISO3 codes and cluster names via regex dictionary.
519. [P2] Deadline and follow-up reminders — local scheduling plus Notification API permission requested at runtime only.
520. [P2] Analyst-defined tags on any entity — tag registry in IndexedDB with color mapping and tag-as-filter integration.
521. [P3] Onboarding walkthrough for new analysts — driver.js-style tour steps defined in a static JSON file.
522. [P2] Recently-viewed entity rail — ring buffer of the last N viewed countries/clusters persisted in localStorage.
523. [P1] Split-screen compare mode for two entities or time slices — synchronized dual panes sharing one static dataset.
524. [P2] Workflow state machine enforcing assessment completeness — client-side validation checklist gating "mark assessed" transitions.
525. [P3] Personal investigation-velocity dashboard — charts computed from the local case store with zero network calls.

## Alerting (526–550)

526. [P0] Rule-based alert engine evaluated entirely in-browser — declarative JSON rule pack in static assets evaluated against the loaded snapshot.
527. [P0] Severity-gap threshold alerts — compare precomputed mismatch scores against analyst-defined thresholds client-side.
528. [P1] Delta alerts on data refresh — diff the two most recent dated static bundles in a Web Worker and surface changed entities.
529. [P1] Alert severity tiers with distinct visual and audio cues — tier mapping in the rule pack; tones from static assets or WebAudio.
530. [P1] Per-watchlist alert subscriptions — rules scoped to watchlist entity sets resolved from IndexedDB at evaluation time.
531. [P2] Alert snooze and acknowledgment workflow — acknowledgment state persisted locally with expiry timestamps.
532. [P2] Alert grouping and deduplication — collapse repeat firings by entity+rule signature within a configurable time window.
533. [P1] Alert center panel filterable by tier, entity, and rule — client-side query over the in-memory alert event store.
534. [P2] Quiet hours and per-tier muting — local preference object checked before rendering any toast or sound.
535. [P2] Direction-aware threshold logic (rising vs falling) — rule pack supports directional operators evaluated over series arrays.
536. [P1] Data-vintage staleness banner — compare bundle timestamp against current date at runtime and warn past a threshold.
537. [P2] RSS/Atom alert snapshot export — generate a static XML feed file client-side capturing current alert state, since static hosting cannot serve dynamic feeds or Web Push.
538. [P2] Rate-of-change alerts on displacement and funding velocity — precompute first derivatives into snapshot series at build time.
539. [P3] Statistical anomaly alerts using z-score bands — z-scores computed at build time and shipped per entity in the bundle.
540. [P2] Compound alert conditions (AND/OR over multiple metrics) — boolean mini-evaluator sandboxed to numeric comparisons only.
541. [P2] One-click alert-to-case conversion — creates an investigation case pre-populated with the alert's entity, rule, and snapshot context.
542. [P3] WebAudio-generated alert tones — oscillator-based sounds parameterized by tier; no audio assets required.
543. [P2] Browser Notification API integration — permission-gated desktop notifications fired only while the app tab is open.
544. [P2] Alert history ledger — append-only IndexedDB store with retention cap and CSV export.
545. [P3] What-if threshold simulator — drag a threshold slider and live-preview which entities would fire on the current snapshot.
546. [P2] Alert provenance linking each firing to exact data rows — record snapshot version and row keys inside the alert record.
547. [P1] Cluster-specific alert rules (WASH, protection, food security, health) — rule-pack sections keyed by the static cluster taxonomy.
548. [P3] Locally simulated escalation chains — unacknowledged alerts re-tier after N minutes using client-side timers.
549. [P2] Alert digest mode — batch all firings into a single end-of-session summary panel instead of interruptive toasts.
550. [P3] Offline alert evaluation — service worker caches the latest snapshot so rule evaluation still runs without network.

## Filtering & Faceted Exploration (551–572)

551. [P0] Faceted filter panel covering region, cluster, severity tier, and funding band — filter state as a typed object serialized to the URL hash.
552. [P0] Numeric range sliders with histogram brushing — distributions computed in-memory with crossfilter-style indexing over the static rows.
553. [P1] Filter chips with one-click removal — canonical chip component reflecting the serialized filter state.
554. [P1] Boolean filter builder with nested AND/OR/NOT groups — tree-structured query model evaluated client-side.
555. [P1] Saved filter presets — named presets in localStorage, shareable via compressed URL encoding.
556. [P2] Global versus pane-local filter scopes — scope prefixes on state keys controlling propagation.
557. [P2] Inverse (exclude-mode) filtering per facet — negation flag on each facet state entry.
558. [P2] Filtering by data quality and vintage — source-quality metadata carried per row in the static bundle.
559. [P1] Time-window filtering with preset ranges (7d/30d/90d/1y) — window math over ISO date strings in series arrays.
560. [P2] Affected-population magnitude bands — log-scale bucketing precomputed at build time.
561. [P2] Live match counts as facets change — crossfilter recomputation in a Web Worker for large row sets.
562. [P3] Constrained natural-language filter input — grammar-based parser mapping phrases to facet operations; no LLM or network required.
563. [P2] Filter templates per crisis archetype — static JSON template library applied with one click.
564. [P1] One-click reset plus filter-diff view — highlight which facets deviate from the default state.
565. [P2] Cross-panel filter synchronization toggle — pub/sub store propagating state only when sync is enabled.
566. [P2] Geographic region filtering via ISO3 groupings — region lookup table shipped as static JSON.
567. [P3] Lasso/polygon selection directly on the globe — convert screen-space selection to an entity set applied as an ad-hoc facet.
568. [P2] Funding-gap quintile quick filters — quintile assignments precomputed at build time.
569. [P2] Sticky filter bar with active-filter count badge — badge derived from serialized state length.
570. [P3] Filter provenance tracking — record which preset or URL imported the current facets for auditability.
571. [P2] Zero-result explanations — identify the excluding facet by testing single-facet removal client-side.
572. [P3] Adaptive facet ordering — reorder filter sections by usage frequency tracked locally.

## Incident Investigation (573–595)

573. [P0] Incident dossier view aggregating all entity data into one scrollable brief — composed client-side from static bundle sections.
574. [P0] Incident creation from any globe or dashboard selection — context capture copies entity keys and active filters into the new case.
575. [P1] Hypothesis tracker with support/refute/undecided evidence linking — evidence references stored in the case JSON.
576. [P1] Investigation timeline auto-populated from related events — filter the static event series by entity and time window at runtime.
577. [P2] Key-questions board (who/what/when/where/why/how-many) — structured form persisting answers into the case store.
578. [P2] Entity relationship mapper — force-directed graph built in-browser from co-occurrence data precomputed at build time.
579. [P1] Severity reassessment workflow — analyst override stored alongside original values with mandatory rationale text.
580. [P2] Affected-population estimator — client-side arithmetic combining static population figures with analyst-set percentages.
581. [P2] Comparative incident analysis — diff two incidents' metrics side by side reusing compare-mode components.
582. [P2] Investigation notes with markdown support — client-side rendering with strict HTML sanitization.
583. [P3] Incident geofencing — draw radius/polygon on the globe with turf.js point-in-polygon tests in-browser.
584. [P2] Casualty and displacement cross-check panel — display multiple source values side by side from bundle source arrays.
585. [P1] Incident status lifecycle (new/triaging/investigating/assessed/closed) — client-side state machine with an immutable transition log.
586. [P2] Automatic incident-to-watchlist cross-referencing — badges computed at render time from entity-key overlap.
587. [P3] Incident merge and split tools — merge concatenates evidence arrays with content-hash deduplication.
588. [P2] Investigation effort log — timestamped analyst-action entries appended to the case record.
589. [P2] Snapshot-in-time incident capture — freeze bundle version and filters so later data refreshes never mutate case context.
590. [P3] Peer-review request workflow — export a review-packet file colleagues import into their own static instance.
591. [P2] Incident severity heat calendar — calendar heatmap rendered from precomputed daily severity indices.
592. [P2] Access-constraint tracker (bureaucratic/security/physical) — categorical fields in the incident schema with filtering.
593. [P3] Incident correlation hints — surface incidents with overlapping entities/windows via client-side similarity scoring.
594. [P2] Funding-response lag measurement — compute days between incident onset and first funding commitment from series data.
595. [P3] Narrative summary scaffold — templated text with placeholder slots auto-filled from incident data, then analyst-edited.

## Evidence Handling (596–612)

596. [P0] Evidence items attachable to cases with source label, date, and reliability grade — typed evidence schema stored in IndexedDB.
597. [P0] Admiralty-style reliability grading (A–F) — enum field rendered with color coding and filter support.
598. [P1] Source-independence marking — flag evidence sharing a common origin to prevent false corroboration.
599. [P1] Evidence-to-hypothesis linking matrix — grid UI over the hypothesis×evidence cross product persisted in case JSON.
600. [P2] File attachment import (PDF/images/CSV) stored locally — FileReader into IndexedDB blobs with size caps and type allowlist.
601. [P2] Evidence text snippets with highlight annotations — store selection offsets plus quoted text for context.
602. [P2] Snapshot-hash verification for attached data — SHA-256 via WebCrypto recorded at attach time for tamper detection.
603. [P2] Evidence chain-of-custody log — append-only timestamped entries inside the case record.
604. [P3] Bulk evidence tagging — multi-select operations applying tags across evidence arrays.
605. [P2] Cross-case evidence search — lazily built client-side inverted index over IndexedDB content.
606. [P2] Evidence redaction tools — redacted flag masks sensitive fields in all views and exports.
607. [P3] Photo-evidence EXIF viewer — parse EXIF in-browser and strip it on export when redaction is enabled.
608. [P2] Evidence confidence rollup — aggregate linked evidence grades into a hypothesis-level score client-side.
609. [P2] Duplicate-evidence detection — content hashing plus text-overlap warnings above a similarity threshold.
610. [P3] Clipboard quick-add for evidence — paste handler parsing text/URLs into draft evidence items.
611. [P2] Evidence export manifest — itemized list with hashes included in case exports for integrity verification.
612. [P3] Field-interview capture template — structured form enforcing minimum provenance fields before save.

## Watchlists (613–629)

613. [P0] User-defined watchlists of countries, clusters, or incidents — entity-key arrays persisted in IndexedDB with names and descriptions.
614. [P0] Watchlist panel with at-a-glance status indicators — per-entity status computed from the current snapshot at render.
615. [P1] Multiple named watchlists with priority ordering — sortable list registry in local storage.
616. [P1] Watchlist-scoped alerting — alert rules reference watchlist IDs resolved client-side at evaluation.
617. [P2] Watchlist import/export as CSV or JSON — client-side CSV generation and parsing.
618. [P2] Per-item watchlist annotations — note field plus last-reviewed timestamp on every entry.
619. [P2] Automatic watchlist suggestions — propose entities with worsening deltas detected in the snapshot-diff pass.
620. [P2] Watchlist health summary strip — aggregate counts by severity tier rendered as a compact status bar.
621. [P3] Watchlist sharing via URL — encode entity keys (never notes) in compressed URL-safe base64.
622. [P2] Rotating review queue — surface least-recently-reviewed items first using local review timestamps.
623. [P2] Watchlist coverage-gap view — highlight regions/clusters absent from all watchlists.
624. [P3] Temporary watchlists with auto-expiry — TTL checked at load; expired lists archived, not deleted.
625. [P2] Watchlist focus mode on the globe — dim non-watchlist polygons through client-side layer filtering.
626. [P2] Removal governance — confirmation dialog plus captured reason when dropping high-severity entities.
627. [P3] Nested watchlist groups — hierarchical list metadata with rollup status propagation.
628. [P2] Watchlist diff over time — compare exported list snapshots from different dates to audit scope drift.
629. [P3] Printable watchlist cards — compact per-entity summaries generated with print CSS.

## Theater Assessments (630–646)

630. [P0] Theater assessment view aggregating multiple countries into a regional picture — region membership joined client-side from a static lookup.
631. [P0] Theater composite severity scoring — weighted rollup of member-country indices computed in-browser with visible weights.
632. [P1] Theater funding-flow matrix — cluster×country funding table rendered from the static bundle with conditional formatting.
633. [P1] Cross-border spillover indicators — adjacency graph and spillover metrics precomputed at build time.
634. [P2] Theater logistics/access overlay — static GeoJSON layers for corridors, ports, and airports toggleable on the globe.
635. [P2] Theater narrative assessment editor — rich-text editor with debounced autosave to local storage.
636. [P2] Seasonal risk calendar per theater — month-indexed hazard seasonality (cyclone, monsoon, lean season) in a static lookup.
637. [P2] Theater comparison mode — standardized metric tables across up to four theaters computed client-side.
638. [P1] Theater escalation/de-escalation trend badges — slope classification of severity series precomputed per theater.
639. [P2] Population-movement flow visualization — animated globe arcs fed by static displacement-flow JSON.
640. [P2] Theater resource-gap heatmap — choropleth of unmet need per cluster with extrusion-plus-color dual encoding.
641. [P3] Theater assumption register — explicit assumption list with review dates stored locally.
642. [P2] Theater brief export for operational audiences — print-layout HTML generated fully client-side.
643. [P2] Sub-theater drilldown — hierarchical region taxonomy in the static ontology enabling zoom-in aggregation.
644. [P3] Theater scenario comparison — analyst-defined parameter sets re-scoring composites client-side.
645. [P2] Theater volatility index — variance metrics precomputed at build time, displayed with sparklines.
646. [P3] Theater handoff-brief generator — compile open incidents, watchlist status, and key judgments into one exportable document.

## Exports & Reporting (647–663)

647. [P0] One-click PNG/SVG export of globe and chart views — canvas/SVG serialization entirely in-browser.
648. [P0] CSV/JSON export of any filtered dataset — serialize in-memory filtered rows with a client-side CSV writer.
649. [P1] PDF briefing generation — jsPDF or print-CSS pagination with zero server rendering.
650. [P1] Export manifest with data vintage, active filters, and integrity hash — metadata header embedded in every export.
651. [P2] XLSX multi-sheet workbook export — SheetJS community edition running client-side.
652. [P2] GeoJSON export of selected regions — extract polygon subsets from static geo assets by ISO3 key.
653. [P2] Redaction-aware export pipeline — strip analyst notes and PII-tagged fields when the redaction toggle is enabled.
654. [P2] Scheduled-report emulation — generate .ics calendar reminders prompting manual exports, since static sites cannot run jobs.
655. [P2] Report template library — parameterized markdown/HTML templates in static assets with slot filling.
656. [P3] Copy chart images to clipboard — canvas blobs written via the Clipboard API for direct paste into slides.
657. [P2] Batch export of multiple cases — ZIP generation client-side with JSZip.
658. [P2] Filename-convention enforcement — template-driven filenames embedding date, theater, and handling tag.
659. [P3] Export size estimator — precompute blob sizes and warn before large ZIP/PDF generation.
660. [P2] Auto-generated citation blocks — attribution strings pulled from bundle metadata for source citation.
661. [P2] Export audit log — local record of what was exported and when, itself exportable as CSV.
662. [P3] Branded report cover pages — static logo assets composited onto the PDF first page.
663. [P2] Machine-readable export mode — versioned clean JSON schema designed for downstream tooling ingestion.

## Collaboration-Safe Static-State Sharing (664–680)

664. [P0] Shareable URL encoding full workspace state — deflate-compressed serialized state in the URL hash with length guardrails.
665. [P0] State-schema versioning with graceful migration — version field in every payload; migration chain applied at import.
666. [P1] Read-only shared view mode — URLs flagged read-only disable all mutation affordances on load.
667. [P1] Redacted share links excluding notes and evidence text — selective-serialization whitelist applied before encoding.
668. [P2] File-based workspace sharing (.ctws files) — download/upload JSON workspace bundles for air-gapped collaboration.
669. [P2] Integrity checksums embedded in shared payloads — SHA-256 digest verified on import with corruption warnings.
670. [P2] QR-code sharing of workspace URLs — QR generation in-browser for in-person handoff.
671. [P2] Import preview with conflict resolution — diff incoming state against local before applying, with per-section opt-in.
672. [P3] Link-validity windows — not-before/not-after timestamps embedded in payloads and enforced at import.
673. [P2] Privacy-notice generator — auto-list the data categories a shared link contains before it is copied.
674. [P2] Merge-based collaboration — union merge of annotations with author tags and timestamps plus a conflict-surfacing UI.
675. [P3] Comment threads carried inside shared state — threaded-comment schema in the portable workspace file; no server needed.
676. [P2] Attribution metadata on shared artifacts — author/org free-text fields embedded in export manifests.
677. [P3] Size-aware sharing fallback — when a URL exceeds browser limits, auto-offer file download instead.
678. [P2] Share-link sensitivity hints — warn when shared state contains entities on flagged watchlists.
679. [P3] Presentation-mode links — stripped-chrome variant of shared views for briefing audiences.
680. [P2] Deterministic state encoding — canonical key ordering so identical states produce identical URLs for diffing.

## Search (681–697)

681. [P0] Global search across countries, clusters, incidents, and cases — client-side inverted index built at load from the static bundle.
682. [P0] Fuzzy matching with typo tolerance — Fuse.js-style indexing over entity names and aliases.
683. [P1] Alias and exonym resolution — alternative-name lookup table (country name variants) shipped statically.
684. [P1] Scoped search modes (entities vs evidence vs notes) — separate indexes per corpus behind a unified results UI.
685. [P2] Result grouping and type-weighted ranking — scoring computed in-browser at query time.
686. [P2] Search-as-you-type with debouncing — input throttling plus Web Worker index queries for large corpora.
687. [P2] Advanced query syntax (field:value, ranges) — mini parser compiling to index lookups.
688. [P2] Recent and frequent searches — local history with frequency-weighted suggestions.
689. [P3] Phonetic matching for place names — metaphone-style encodings precomputed into the index at build time.
690. [P2] Per-column search within tables — column filter inputs wired to the same inverted index.
691. [P2] Match-term highlighting in results — safe substring highlighting without innerHTML injection risk.
692. [P3] Zero-result query analytics — logged locally to guide alias-table improvements; never transmitted.
693. [P2] Full-text search over bundled report narratives — prebuilt lunr-style index serialized as a static asset.
694. [P2] Keyboard navigation of results — arrow-key traversal with a live preview pane.
695. [P3] Geo-search by coordinates — reverse-lookup nearest entities using a static centroid table and haversine math.
696. [P2] Search-to-filter integration — apply a result set directly as a facet selection.
697. [P3] Searchable in-app help — documentation snippets indexed alongside entities for contextual guidance.

## Timelines (698–712)

698. [P0] Interactive incident timeline with zoom and pan — canvas-rendered scale computed client-side from the event series.
699. [P0] Multi-track timeline comparing severity, funding, and displacement — synchronized tracks sharing one time scale.
700. [P1] Category-styled event markers — event taxonomy with icon mapping shipped in the static ontology.
701. [P1] Analyst annotations on the timeline — annotation records keyed by timestamp stored in the case store.
702. [P2] Timeline playback/scrubbing — requestAnimationFrame stepping with speed controls; no server streaming.
703. [P2] Event-density heat strip — histogram of event counts precomputed per time bucket.
704. [P2] Decision-milestone flags — decision-log entries rendered as markers linking to rationale text.
705. [P2] Range selection filtering all views — brush selection writes into the global filter state.
706. [P3] Comparative overlay of two incidents — optional normalized alignment by days-since-onset.
707. [P2] Seasonality backdrop bands — recurring hazard seasons drawn as shaded regions from the static lookup.
708. [P2] Timeline export as image or CSV — same export pipeline as charts plus event-table serialization.
709. [P3] Automatic event clustering at low zoom — client-side bucket merging to prevent marker clutter.
710. [P2] Commitment-versus-disbursement lag visualization — paired markers connected by span lines.
711. [P2] Timeline deep links — shareable URL state including time window and selected events.
712. [P3] Projection-shadow extension — dashed continuation zone rendering precomputed forecast series with uncertainty bands.

## Confidence (713–723)

713. [P0] Confidence scoring on all analyst judgments — 1–5 scale with mandatory rationale stored in the case schema.
714. [P0] Data-confidence indicators distinct from analyst confidence — source-quality metadata from the bundle rendered inline.
715. [P1] Confidence-weighted aggregation — rollups weight member values by confidence client-side with a visible methodology note.
716. [P1] Confidence-change tracking — history array per judgment preserving prior values and timestamps.
717. [P2] Low-confidence highlighting — visual treatment flagging weakly supported assessments across all views.
718. [P2] Confidence distribution dashboard — histogram of current judgments computed locally.
719. [P2] Source-agreement boost hints — heuristic surfacing where independent sources concur, computed at render time.
720. [P3] Calibration training mode — historical cases with known outcomes for practicing confidence scoring.
721. [P2] Confidence-required workflow gates — block case closure until key judgments carry confidence values.
722. [P2] Uncertainty visualization on charts — error bands rendered from precomputed variance fields in the static data.
723. [P3] Confidence-decay reminders — prompt re-review of aging high-impact judgments based on elapsed time.

## Contradiction Handling (724–735)

724. [P0] Contradiction detection across source values — mismatched figures flagged at build time and surfaced in a dedicated panel.
725. [P0] Per-case contradiction registry — explicit records linking conflicting evidence items with open/resolved status.
726. [P1] Side-by-side contradiction viewer — paired display preserving the provenance of each conflicting value.
727. [P1] Resolution workflow with documented rationale — resolution note plus preferred-value choice stored in the case record.
728. [P2] Source-recency preference heuristics — default hint favoring newer data, overridable by the analyst.
729. [P2] Contradiction severity classification — magnitude-of-disagreement computed relative to each metric's scale.
730. [P2] Unresolved-contradiction warnings in exports — manifest lists open contradictions so consumers know the caveats.
731. [P2] Numeric tolerance configuration — per-metric thresholds stored locally controlling what counts as a conflict.
732. [P3] Narrative-versus-data contradiction flagging — analysts mark where qualitative reporting diverges from quantitative series.
733. [P2] Contradiction trend metrics — open/resolved counts per case over time computed locally.
734. [P3] Both-truths presentation mode — display conflicting values as ranges rather than forcing premature resolution.
735. [P2] Contradiction escalation tagging — flag conflicts affecting high-stakes decisions for priority review.

## Operational Decision Support (736–750)

736. [P0] Decision-support board summarizing recommended actions per theater — rule-generated suggestions computed client-side from snapshot metrics.
737. [P0] Allocation comparison tool — model redistribution scenarios by adjusting funding weights client-side against static need data.
738. [P1] Impact-estimation calculator — cost-per-beneficiary ratios from bundle arithmetic producing rough people-reached estimates.
739. [P1] Decision log with rationale capture — append-only entries in local storage with export support.
740. [P2] Courses-of-action matrix — criteria×option scoring grid with weighted totals computed in-browser.
741. [P2] Constraint-aware recommendations — exclude options violating analyst-set constraints (access, funding floor, severity minimum).
742. [P2] Decision-deadline countdown panel — deadlines stored locally and ordered by urgency-severity weighting.
743. [P1] Pre-mortem and assumption-check prompts — structured reflection templates attached to decision records.
744. [P2] Resource-requirement estimator — staffing and asset arithmetic parameterized by incident-scale inputs.
745. [P2] Decision-outcome linkage — link later assessment results back to originating decisions for learning loops.
746. [P3] Sensitivity-analysis sliders — show how composite rankings shift as criterion weights move, recomputed live client-side.
747. [P2] Escalation-criteria checker — compare entity metrics against escalation doctrine rules from static JSON.
748. [P2] Meeting-ready decision briefs — auto-compiled one-pagers per decision with supporting figures embedded.
749. [P3] Red-team prompt generator — templated challenge questions per decision type from a static library.
750. [P2] Decision-confidence heatmap — matrix of open decisions by urgency×confidence rendered client-side for prioritization.
