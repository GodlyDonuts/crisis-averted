# Source governance and publication gate

Catalog batch 17 adds a machine-readable source registry, a public provenance ledger, an automated publication gate, and UI disclosure for the statically deployed OSINT console. It is deliberately an audit system, not a legal oracle.

## What is published

The snapshot build now emits three coordinated files under `frontend/public/data/`:

- `osint-snapshot.json` — the existing bounded collections plus an embedded `provenanceLedger`.
- `source-registry.json` — an exact copy of the canonical `scripts/source-registry.json` used by the build.
- `provenance-ledger.json` — the master ledger: all snapshot collections plus static artifacts such as `conflict-fallback.json` and the Natural Earth basemap.

`source-registry.json` is the canonical registry for active connectors and static data artifacts. It uses JSON rather than YAML because the repository intentionally avoids adding an unneeded parser dependency; validation is implemented locally in dependency-light Node code.

## Registry obligations

Every registry source must explicitly record:

- source identity, owner/publisher, connector version, endpoint URLs, endpoint protocol, and documentation/evidence links;
- license or terms status, terms/evidence URL where available, and an `unknown` state when terms cannot honestly be found;
- attribution requirement, conservative attribution text, and attribution evidence;
- publisher cadence, retrieval cadence, cache/retention policy, freshness thresholds, and timestamp basis;
- authentication mode and build-time environment variable names;
- browser mode, CORS status, and whether runtime browser fetching is allowed;
- public-static redistribution status, risk, bulk-export posture, constraints, and notes;
- confidence characteristics: authority, verification, coverage, automation, and caveats;
- the emitted collections covered by the source.

No source may claim a non-`unknown` license status without a source-backed terms URL. Empty attribution text is invalid even when the exact requirement is unknown; the build uses conservative source credit rather than omitting attribution. Each collection must have at least one registered source.

## Provenance and freshness semantics

The ledger distinguishes publisher time, record time, retrieval time, build time, and preserved prior data:

- `retrievedAt` is when the build acquired or reused data;
- `generatedAt`/`fetchedAt` is snapshot assembly time;
- `dataVintage.newestRecordTimestamp` is only the newest trustworthy per-record timestamp understood by the normalizer, not a universal freshness signal;
- `freshness.state` uses retrieval age plus per-source thresholds and can be `current`, `aging`, `stale`, `preserved`, `unavailable`, or `unknown`;
- `preserved` means a transiently failed or empty ingest reused prior snapshot rows. It must not be presented as a fresh upstream fetch.

Some combined collections cannot currently attribute every row to one source (notably `naturalEvents` and mixed `mapOfWarsEvents`). Their ledger entries say so conservatively. Map of Wars nested upstream publishers are represented through the aggregator's upstream caveats and source strings; they are not independently re-licensed by this repository.

## Publication gate

Run:

```bash
node scripts/validate-source-governance.mjs
```

The gate:

1. validates registry schema and full collection coverage;
2. validates the snapshot ledger against the canonical registry;
3. verifies collection record counts and deterministic normalization hashes;
4. verifies registry/ledger versions, artifact location and JSON pointers;
5. detects registry drift and unregistered source entries;
6. fails missing required/requested attribution, invalid provenance, impossible timestamps/counts, and prohibited bulk export when rows are emitted;
7. verifies the public registry copy matches `scripts/source-registry.json`;
8. verifies hashes/counts and embedded license declarations for static artifacts;
9. scans public data and `frontend/out` for exact configured connector secrets and high-confidence secret-shaped material without printing raw matches;
10. scans frontend source and compiled chunks for non-public environment variable use and keyed-source network exposure;
11. reports unknown/restricted redistribution entries as truthful review findings;
12. runs no-network adversarial self-tests for secret samples, missing attribution, registry drift, unknown-license handling, and prohibited redistribution.

Hard failures block publication. Unknown licenses and restricted or unclear redistribution terms do **not** automatically prove noncompliance, but they are surfaced as review findings and are never converted into a compliance claim. If a registry entry explicitly says `bulkPublicExport: "prohibited"`, emitted rows are a hard failure because that is a direct contradiction rather than a legal inference.

### Secret scanner limits

The scanner looks for exact configured secret values and high-confidence shapes such as private-key blocks, AWS/GitHub/Slack/Stripe/Google key formats, JWT-like tokens, URI-embedded credentials, bearer tokens, secret-looking JSON assignments, and credential-looking query parameters. Findings contain only fingerprints and lengths. It does not print secrets.

This is not a perfect entropy scanner. It deliberately avoids flagging hashes, TLEs, coordinates, public IDs, and other benign high-entropy data wholesale. Conversely, some public CDN/media URLs contain token-shaped parameters. The GDELT image URL normalizer drops media URLs with credential-looking query parameters rather than republishing ambiguous token material.

### Browser/key exposure limits

The keyed-source scan looks for non-public `process.env` use in client source and for keyed upstream hostnames near network/credential contexts in source and compiled chunks. It cannot prove absence of every indirect or dynamically constructed endpoint. Registry browser modes and build-time ingestion are the primary controls; the scan is a deterministic regression check.

## ReliefWeb humanitarian metadata posture (catalog batch 20)

ReliefWeb API v2 access requires a pre-approved `appname` URL parameter. The console treats `RELIEFWEB_APPNAME` as build-time-only connector configuration, never serializes its value, never fetches ReliefWeb from the browser, and records only redacted request URLs plus POST-body hashes in ingestion provenance. Because ReliefWeb Terms restrict redistribution/compilation and original publishing organizations retain rights, `reliefwebRecords` is deliberately limited to factual metadata: identifiers, titles, dates, taxonomy, organizations, status/GLIDE references, canonical/original links, and country-centroid georeferences. Narrative bodies, HTML, summaries, disaster descriptions, attachments, images, excerpts, casualty/displacement/people-in-need values, and invented severity scores are structurally excluded. ReliefWeb rows remain humanitarian metadata/context and are never conflict incidents or independent corroboration.

## Updating a source

1. Update the connector implementation and bump its `connectorVersion`.
2. Update the source's registry entry: endpoint, auth/browser mode, license evidence, attribution, cadence/retention/freshness, redistribution constraints, and confidence caveats.
3. If a new emitted collection is added, update collection lists in `scripts/lib/source-governance.mjs`, snapshot schema validation, frontend types, and the UI.
4. If nested upstream sources become independently emitted rather than merely aggregated, register them explicitly.
5. Bump `registryVersion` and `updatedAt` in `scripts/source-registry.json`.
6. Run the snapshot build and `node scripts/validate-source-governance.mjs`.
7. Run frontend lint/typecheck/build and inspect `frontend/out` before publishing.

## Deliberate exclusions and legal limitations

- Visual texture/map imagery and backend/Databricks/humanitarian pipelines are outside this batch's connector ledger scope. The registry covers the public OSINT console connectors and static data artifacts identified in the batch.
- The registry records researched terms and explicit unknowns at the time of authorship. Providers can change terms without notice.
- A `low` risk score is not legal permission, and a `high` risk score is not proof of infringement. External licenses or permissions may exist outside the repository.
- This documentation and the generated report are not legal advice.
- Review the full report in `frontend/out/data/source-governance-report.json` after a production build before changing commercialization, redistribution, or retention posture.

## CI behavior

The GitHub Pages workflow builds the static export, then runs the source-governance gate before the Pages artifact upload. A hard failure therefore prevents deployment. Review findings are visible in logs and in the report artifact but do not masquerade as legal approval.
