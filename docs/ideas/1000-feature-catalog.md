# God's Eye 1,000-Feature Implementation Catalog

Generated from four domain-specific agent catalogs. Unique numbered ideas: 1000. Duplicates: 0. Missing numbers: 0.

001. [P0] Unified source registry — encode owner, license, cadence, endpoint, authentication, CORS status, retention, and confidence in machine-readable YAML.
002. [P0] Static snapshot orchestrator — run all server-dependent ingestion inside scheduled GitHub Actions before deploying the Pages artifact.
003. [P0] Source-mode classifier — label every connector browser-safe CORS, keyless non-CORS, keyed, licensed, or manual-download to prevent invalid runtime fetches.
004. [P0] Secret-isolated keyed ingestion — read API keys only from GitHub Actions secrets and never emit them into client bundles or snapshot payloads.
005. [P0] License compliance ledger — record redistribution, attribution, derivative-work, and commercial-use terms beside every normalized record collection.
006. [P0] Provenance envelope — attach source name, source URL, retrieval timestamp, publisher timestamp, license, connector version, and raw-record identifier to every feature.
007. [P0] Deterministic normalization — convert heterogeneous source payloads through versioned schema validators rather than ad hoc client transformations.
008. [P0] Versioned data contracts — publish JSON Schema for each snapshot domain and fail deployment when required fields or units regress.
009. [P1] Immutable evidence extracts — retain compact raw-source excerpts in build artifacts for auditability without redistributing disallowed bulk payloads.
010. [P1] Content-hash audit chain — hash normalized collections and manifests so users can detect accidental mutation between builds.
011. [P1] Conditional fetching — persist ETag, Last-Modified, and cache-control metadata to reduce bandwidth and respect source rate limits.
012. [P1] Rate-limit budget manager — centralize per-source retry, backoff, timeout, and concurrency policies inside the build pipeline.
013. [P2] Official failover endpoints — support publisher-approved mirrors or alternate formats while recording which endpoint supplied each batch.
014. [P0] Staleness badges — compute age from publisher timestamps and visually decay layers when data exceeds domain-specific freshness thresholds.
015. [P0] Confidence taxonomy — standardize confirmed, corroborated, single-source, inferred, and contested states across all intelligence domains.
016. [P1] Source health matrix — surface last success, last failure, latency, record count, coverage, and error class in the Source Status panel.
017. [P1] Snapshot diff engine — emit added, removed, moved, and materially changed entities so the interface can highlight what changed between builds.
018. [P2] Replayable build manifests — store connector versions, parameters, timestamps, and artifact hashes needed to reproduce each deployed snapshot.
019. [P2] Geographic coverage registry — expose per-source spatial footprints so absence of aircraft, vessels, or events is never misread as absence of activity.
020. [P2] Temporal coverage registry — expose each feed's historical depth and expected latency beside time-slider controls.
021. [P0] Canonical entity resolution — reconcile aircraft, vessels, satellites, organizations, places, and events through deterministic identifiers before fuzzy matching.
022. [P0] Coordinate validation — reject impossible coordinates, clamp precision appropriately, and retain original accuracy or uncertainty radius metadata.
023. [P0] Temporal normalization — store UTC instants plus original timezone, precision, start/end windows, and publisher-supplied uncertainty.
024. [P1] Unit normalization — convert altitude, speed, magnitude, depth, casualties, and distance to canonical units while retaining original values.
025. [P0] Last-verified fallback — when ingestion fails, reuse the previous real snapshot with prominent staleness rather than fabricating replacement data.
026. [P0] AISStream global positions — collect keyed WebSocket AIS position reports during build-time only and merge them by MMSI into the static vessel snapshot.
027. [P0] Digitraffic Baltic AIS — ingest the keyless Finnish maritime locations and vessel metadata APIs at build-time for reliable regional coverage.
028. [P1] National open AIS federation — add connector adapters for government-published AIS feeds where terms permit redistribution, recording regional coverage explicitly.
029. [P1] Marine Cadastre historical AIS — ingest official US historical vessel traffic files in build-time chunks for baseline movement and seasonal comparisons.
030. [P2] Licensed satellite AIS support — integrate Spire, ORBCOMM, or exactEarth data only after licensing and redistribute only derived records permitted by contract.
031. [P1] Vessel identity enrichment — join MMSI, IMO, call sign, name, dimensions, ship type, flag, and navigation status without overwriting conflicting source values.
032. [P0] Vessel track reconstruction — persist sequential positions and render compressed time-ordered tracks instead of isolated vessel dots.
033. [P1] Port-call detection — geofence World Port Index ports and derive arrival, departure, dwell time, and repeated-call patterns from real AIS positions.
034. [P1] Anchorage loitering analysis — detect vessels stationary in recognized anchorages while labeling duration estimates as movement-pattern observations.
035. [P1] AIS transmission-gap timeline — display periods without received positions as coverage gaps, never automatically as deliberate dark activity.
036. [P2] Kinematic spoofing checks — flag impossible speed, teleportation, timestamp reversal, or duplicated simultaneous positions for analyst review.
037. [P1] Ship-type normalization — map AIS numeric type codes to consistent cargo, tanker, passenger, fishing, military, law-enforcement, and rescue classes.
038. [P2] Flag-state inference caveat — derive probable registration from MMSI maritime identification digits while clearly separating it from verified registry data.
039. [P1] Sanctions screening — match IMO, MMSI, vessel names, and ownership clues against UN, OFAC, EU, and UK consolidated sanctions lists at build-time.
040. [P1] Naval AIS caveat layer — show military or government vessels only when voluntarily transmitting AIS and state that non-transmitting vessels are absent.
041. [P2] Convoy clustering — detect temporally sustained close formation among multiple vessels and render the cluster with member-level provenance.
042. [P1] Chokepoint density monitor — aggregate real AIS traffic through Hormuz, Bab el-Mandeb, Suez, Malacca, Bosporus, and Panama corridors.
043. [P1] Maritime boundary context — use MarineRegions EEZ and territorial-sea datasets to contextualize vessel positions without implying legal conclusions.
044. [P2] Public piracy incident ingestion — incorporate IMO GISIS or other license-cleared piracy reports as geolocated incidents with publication delays shown.
045. [P1] Maritime advisory ingestion — parse official NAVAREA, coastal-state, and US Maritime Administration warnings into time-bounded safety polygons.
046. [P2] Vessel registry augmentation — link national open registries where available, retaining jurisdiction-specific coverage and exact registry URLs.
047. [P1] Port congestion scoring — derive queue length, anchorage occupancy, and dwell-time deltas from observed AIS rather than inferred commercial cargo data.
048. [P1] Conflict-zone rerouting detection — compare current tracks with historical real AIS corridors and quantify diversion distance with baseline uncertainty.
049. [P2] Hazardous vessel highlighting — use declared AIS ship type and dangerous-goods status when present, avoiding unsupported cargo speculation.
050. [P2] Fishing-activity context — ingest Global Fishing Watch API data at build-time using its token in Actions and render only license-permitted derived layers.
051. [P2] Maritime weather routing context — overlay official NOAA or national meteorological hazards on vessel tracks to explain slowing, sheltering, or diversion.
052. [P2] GNSS-AIS anomaly correlation — compare vessel position irregularities with gpsjam.org interference cells and label causality as unestablished.
053. [P2] Cable-corridor proximity — display license-cleared undersea cable datasets alongside vessel anchoring or slow-speed behavior as contextual proximity only.
054. [P2] Port-state-control enrichment — ingest Paris MoU, Tokyo MoU, or national detention datasets where bulk terms allow and link by verified IMO number.
055. [P1] AIS-SART emergency highlighting — render active AIS search-and-rescue transmitter positions as high-priority safety events with first-seen and last-seen times.
056. [P2] MMSI identity collision detection — identify reused or conflicting MMSI metadata across sources and expose per-field source attribution.
057. [P1] Vessel absence disclosure — show receiver and satellite AIS coverage limitations prominently whenever users inspect sparse maritime regions.
058. [P1] Track compression pipeline — simplify vessel tracks with tolerance-aware geometry while preserving raw timestamps and motion vectors.
059. [P2] Maritime incident correlation — spatially and temporally connect vessels to verified attacks, advisories, disasters, or sanctions events without claiming causation.
060. [P3] Vessel voyage hypotheses — rank possible destinations from declared destination, historical real calls, and current heading with explicit uncertainty percentages.
061. [P0] OpenSky live aviation snapshot — ingest public state vectors at build-time while retaining anonymous-access rate limits and last-contact timestamps.
062. [P0] ADSB.lol military aircraft — ingest the public military endpoint at build-time and preserve receiver-derived position age and aircraft identifiers.
063. [P1] Licensed ADS-B Exchange support — integrate commercial high-fidelity data only through an authorized key inside build-time Actions and honor redistribution terms.
064. [P1] OpenSky historical tracks — use authenticated historical APIs in build-time jobs to reconstruct complete mission paths for selected aircraft.
065. [P1] Aircraft metadata enrichment — join ICAO24 addresses to legitimate open aircraft databases for registration, type, operator, and airframe details.
066. [P1] Operator-class inference labels — infer cargo or government likelihood from callsign patterns but display the classification as unconfirmed.
067. [P2] Military corridor detection — identify repeated real aircraft concentrations along corridors using historical baselines rather than single-position speculation.
068. [P2] Tanker-pattern detection — detect sustained racetrack orbits consistent with refueling aircraft and label mission purpose as only pattern-based.
069. [P2] ISR-orbit detection — identify persistent surveillance-like tracks while withholding platform or mission assertions unsupported by public evidence.
070. [P2] Government flight highlighting — surface publicly transponding state aircraft using verified registration or operator metadata rather than tail-number guessing.
071. [P1] NOTAM ingestion — retrieve FAA or other official NOTAM API data at build-time when keys or non-CORS restrictions require server-side access.
072. [P1] Conflict-zone airspace warnings — parse active closure, danger, missile, and military-activity NOTAMs into polygonal time-bounded overlays.
073. [P2] Flight-information-region context — ingest license-compatible FIR boundaries and display controlling authority for aviation warning interpretation.
074. [P1] Airport reference layer — use OurAirports open data for airport positions, types, identifiers, and runway context.
075. [P1] Aviation density anomaly — compare live state-vector counts with historical real snapshots by region and hour to reveal traffic disruption.
076. [P0] Transponder coverage caveat — explain that ADS-B-dependent aircraft, receiver gaps, and blocked aircraft create incomplete aviation visibility.
077. [P2] Aviation-GNSS interference correlation — compare degraded tracks or missing positions with gpsjam.org cells while avoiding causal assertions.
078. [P1] Emergency squawk detection — highlight 7500, 7600, and 7700 squawks with timestamps, location, aircraft metadata, and source freshness.
079. [P2] Launch-hazard airspace correlation — intersect NOTAM hazard areas with scheduled launch windows and nearby real aviation traffic.
080. [P3] Relief-flight pattern monitor — identify repeated verified humanitarian-operator flights only when operator evidence is publicly available.
081. [P2] Cargo-surge indicator — count verified cargo-operator flights near crisis regions and compare against historical baseline without inferring cargo contents.
082. [P1] Aviation unit normalization — standardize feet, knots, vertical rate, track, and receiver timestamps while retaining original source fields.
083. [P2] Position-quality radius — represent multilateration or low receiver confidence with uncertainty circles when source metadata supports it.
084. [P1] Cross-feed aircraft dedupe — merge ADSB.lol, OpenSky, and licensed feeds by ICAO24 while retaining every distinct observation as evidence.
085. [P1] Track smoothing with raw preservation — render simplified flight paths but expose the unsmoothed real positions in detail panels.
086. [P2] Aviation arc visualization — connect ordered track positions with altitude-aware arcs instead of falsely implying great-circle routes.
087. [P1] Airport operational status — ingest official airport closure or delay feeds where available and correlate with nearby conflict incidents.
088. [P2] Hazard timeline correlation — align military aircraft concentrations, airspace warnings, missile reports, and space launches on one chronological lane.
089. [P1] EASA conflict-zone bulletins — ingest public EASA CZIB documents and represent affected airspace, validity dates, and issuing authority.
090. [P2] Sanctioned aircraft screening — match registrations, ICAO24 identifiers, and operators against sanctions lists using exact identifiers before fuzzy names.
091. [P3] Historical aviation comparison — let users compare current military flight density with prior real snapshots for the same theater and season.
092. [P1] Receiver coverage heatmap — visualize the observable coverage implied by data source footprints rather than inventing positions in blind zones.
093. [P0] Aircraft freshness display — show last-contact age directly on markers and remove stale positions after configurable thresholds.
094. [P2] Aviation anomaly queue — rank unusual squawks, abrupt track loss, orbit persistence, and density spikes by transparent rule-based scores.
095. [P1] Aircraft provenance tooltip — expose feed, receiver-derived timestamp, ICAO24, callsign, inference fields, and license notes for every aircraft.
096. [P0] CelesTrak catalog ingestion — download public TLE groups at build-time and normalize satellite number, object name, epoch, and orbital elements.
097. [P1] Space-Track authenticated ingestion — query Space-Track only inside build-time Actions with credentials and respect its redistribution and query rules.
098. [P0] Client-side orbit propagation — propagate stored TLEs in the browser with satellite.js so static Pages can animate positions without an API server.
099. [P1] Launch Library schedule — ingest upcoming and recent launches, pads, agencies, mission names, statuses, and uncertainty windows.
100. [P1] Launch countdown timeline — synchronize launch net times, hold states, and outcome updates with the global incident timeline.
101. [P2] Close-approach screening — compute approximate conjunction candidates from public TLEs and label them as coarse screenings rather than official warnings.
102. [P2] Breakup debris visualization — use confirmed public fragmentation event data to animate debris-cloud dispersal over time.
103. [P1] UCS satellite metadata — ingest the Union of Concerned Scientists satellite database for owner, operator, purpose, orbit, and launch details.
104. [P0] GNSS interference layer — ingest gpsjam.org daily interference geometry at build-time because redistribution and browser access must remain controlled.
105. [P1] Historical jamming comparison — retain dated gpsjam.org snapshots and render interference persistence, expansion, contraction, and overlap.
106. [P1] NOAA space-weather ingestion — ingest SWPC alerts, planetary K-index, solar wind, and geomagnetic storm observations at build-time or runtime when CORS permits.
107. [P1] NASA DONKI space weather — ingest coronal mass ejections, solar flares, radiation storms, and interplanetary shocks with analysis links.
108. [P2] Geomagnetic impact context — correlate severe space weather with GNSS, satellite-drag, radio, and aviation communication caveats.
109. [P2] Satellite pass prediction — show future visible or footprint passes above a selected theater using propagated public TLEs.
110. [P3] Earth-observation overpass windows — display publicly cataloged imaging-satellite pass times as orbital facts, not evidence of tasking or collection.
111. [P1] Rocket-body decay tracking — monitor high-interest rocket bodies and large debris using public TLE epoch and decay status changes.
112. [P2] Orbital-regime coloring — distinguish LEO, MEO, GEO, HEO, and cislunar objects using derived altitude and eccentricity ranges.
113. [P1] Verified military satellite labeling — mark defense ownership or mission only when the public catalog operator and mission metadata support it.
114. [P0] Space-object provenance panel — show catalog source, TLE epoch, propagation time, owner metadata source, and uncertainty for every object.
115. [P0] TLE freshness warnings — flag orbital elements older than domain-specific thresholds because propagated positions become increasingly unreliable.
116. [P2] Reentry alert integration — ingest official reentry predictions or confirmed event notices and distinguish prediction windows from observed reentry.
117. [P2] Launch-corridor correlation — intersect launch pads, hazard notices, aviation routes, and maritime vessel traffic during launch windows.
118. [P2] Debris density field — aggregate public catalog objects into orbital-shell density visualizations without implying precise collision probability.
119. [P3] Historical ASAT-event layer — encode well-sourced public anti-satellite test events and linked debris counts with citations and uncertainty.
120. [P2] GNSS multimodal anomaly correlation — align jamming cells with aviation track gaps and AIS irregularities as a correlation hypothesis queue.
121. [P1] Space data licensing guardrails — propagate CelesTrak, Space-Track, and catalog-specific attribution or redistribution constraints into the manifest.
122. [P0] Orbital precision disclaimer — expose propagation error growth, approximate altitude, and non-operational status in user-facing satellite details.
123. [P2] Space-conflict timeline — integrate launches, breakups, reentries, interference episodes, and verified space-policy incidents into a common chronology.
124. [P1] Compressed orbital snapshots — store only necessary TLEs and metadata in compact static files rather than large precomputed position tables.
125. [P3] Space weather impact forecast — combine official SWPC forecasts with asset-location context and clearly separate forecast from observation.
126. [P0] CISA KEV ingestion — pull the authoritative Known Exploited Vulnerabilities catalog at build-time and link CVEs to remediation deadlines.
127. [P0] NVD vulnerability enrichment — query the NVD API at build-time for CVSS, CWE, references, affected configurations, and publication chronology.
128. [P1] CVE record reconciliation — compare CVE.org authoritative records with NVD interpretations and expose disagreements in severity or affected products.
129. [P1] EPSS exploitability scoring — ingest FIRST EPSS scores at build-time and rank vulnerabilities by current exploitation probability.
130. [P1] Exploitation evidence matrix — distinguish KEV confirmation, exploit code references, scanner observations, and unverified reporting.
131. [P2] Critical-infrastructure vulnerability lens — correlate vulnerability product families with public sector categories without exposing sensitive asset inventories.
132. [P2] AbuseIPDB integration — query keyed reputation data only during build-time and aggregate network indicators without embedding the API key.
133. [P2] AlienVault OTX pulse ingestion — use keyed OTX access inside Actions and normalize pulse indicators, tags, references, and expiration metadata.
134. [P2] GreyNoise context — use keyed build-time lookups to classify internet noise, benign scanners, and malicious mass-scanning behavior.
135. [P3] Shodan aggregate exposure — use licensed keyed queries in build-time jobs and publish only aggregated, license-permitted exposure statistics.
136. [P3] Censys aggregate exposure — use keyed build-time collection and redistribute only derived counts or summaries allowed by the service terms.
137. [P1] URLhaus malicious infrastructure — ingest abuse.ch URLhaus indicators at build-time with first-seen, status, malware family, and reference URLs.
138. [P1] ThreatFox IOC ingestion — normalize abuse.ch ThreatFox malware indicators with confidence, type, expiration, reporter, and malware family metadata.
139. [P1] MalwareBazaar metadata — ingest sample hashes and family metadata only, never distributing executable malware or unsafe payloads.
140. [P1] Feodo C2 tracking — ingest abuse.ch Feodo Tracker command-and-control indicators and render takedown or offline status transitions.
141. [P1] RIPEstat BGP monitoring — ingest public routing statistics and prefix visibility changes as network-context events with exact timestamps.
142. [P2] Cloudflare Radar outages — query keyed Radar endpoints inside Actions and store license-permitted internet-traffic anomaly summaries.
143. [P1] IODA outage events — ingest Georgia Tech IODA outage signals to corroborate national or regional connectivity disruptions.
144. [P2] BGP anomaly correlation — combine RIPE RIS or BGPStream-derived public evidence with outages while labeling hijack classification confidence.
145. [P2] Connectivity-conflict correlation — align internet outages with verified conflict incidents, disasters, or infrastructure reports without automated attribution.
146. [P0] Attribution firewall — separate observable cyber events, suspected actor claims, vendor attribution, and state attribution in both schema and UI language.
147. [P1] CISA advisory ingestion — parse CISA cybersecurity and ICS advisories for affected vendors, products, mitigations, and vulnerability references.
148. [P1] CSAF vendor advisory ingestion — consume machine-readable CSAF advisories from legitimate publishers and normalize remediation status.
149. [P2] National CERT alert aggregation — ingest official CERT RSS or API feeds where redistribution is permitted and preserve original language plus translations.
150. [P2] MISP OSINT feed support — connect only to explicitly public MISP feeds at build-time and honor each feed's sharing and traffic-light protocol.
151. [P2] Certificate-transparency abuse watch — query crt.sh in build-time batches for clearly defined watchlist domains without monitoring private entities.
152. [P2] Conflict-themed phishing signals — tag public phishing or malware indicators only when the source itself provides campaign or theme evidence.
153. [P1] Cyber geolocation caution — display infrastructure location as host or network geography with uncertainty, never as attacker location.
154. [P1] IOC expiration engine — suppress stale indicators by source-specific validity windows while preserving them in historical views.
155. [P2] Cyber threat correlation graph — link CVEs, advisories, malware families, infrastructure, outages, and public reporting through typed evidence edges.
156. [P0] UCDP event ingestion — consume official UCDP APIs or downloads at build-time and preserve event IDs, precision codes, actors, and fatality ranges.
157. [P0] ACLED ingestion — use authenticated ACLED access only inside build-time Actions and enforce API terms, attribution, and update cadence.
158. [P1] GDELT event ingestion — download legitimate GDELT event or DOC exports at build-time and distinguish media attention from verified incident occurrence.
159. [P1] Map of Wars ingestion — refresh public UCDP-derived event lattice data at build-time with source-generation metadata and attribution.
160. [P1] WarHeatMap integration — ingest the public WarHeatMap feed with CC BY attribution and expose correction or merger status where supplied.
161. [P1] HDX conflict dataset importer — support license-cleared HDX CSV and GeoJSON datasets with organization, dataset version, and resource lineage.
162. [P1] ACLED actor normalization — preserve original actor names while mapping aliases to canonical organizations using reviewable mapping tables.
163. [P0] UCDP-ACLED dedupe — detect likely duplicate events across datasets using time, location, actors, and fatalities while retaining both source records.
164. [P1] Fatality range normalization — store low, best, and high casualty estimates separately instead of forcing a single potentially false precision.
165. [P0] Geoprecision visualization — render point, district, province, country, and unknown precision with different geometries or uncertainty treatments.
166. [P1] Temporal uncertainty windows — represent events known only by day, week, or reporting period as intervals rather than false exact timestamps.
167. [P1] Conflict actor aliasing — maintain transparent many-to-one actor aliases with evidence links and unresolved ambiguity states.
168. [P2] License-cleared control layers — render territorial-control polygons only from sources with explicit redistribution rights and clear observation dates.
169. [P1] Shared violence taxonomy — map source-specific event types into battles, explosions, remote violence, civilian targeting, unrest, and strategic developments.
170. [P1] Civilian-harm separation — keep violence-against-civilians metrics distinct from combatant battle intensity in theater scoring.
171. [P2] Protest and unrest layer — ingest ACLED disorder events where licensed and allow users to separate political unrest from armed conflict.
172. [P1] Spatial event clustering — aggregate dense incidents into H3 or geohash cells while retaining drill-down access to individual source records.
173. [P2] Event-series linking — connect related incidents into campaigns or escalation sequences using transparent spatial, temporal, and actor rules.
174. [P1] Escalation index — derive a transparent weighted score from verified event counts, fatalities, civilian harm, geographic spread, and novelty.
175. [P1] Historical baseline anomalies — compare current incident intensity with trailing real-data baselines for the same region and seasonal period.
176. [P1] Conflict timeline heatmap — render event intensity by day, week, and theater using normalized counts rather than raw incomparable source totals.
177. [P0] Casualty quality annotations — expose source-specific counting methodology, missingness, revision status, and conflicting estimates in detail panels.
178. [P0] Cross-source duplicate review — present probable duplicates as linked evidence clusters rather than silently deleting potentially independent reports.
179. [P1] Contradictory casualty ranges — display competing confirmed casualty counts side by side with publisher, publication time, and methodology.
180. [P1] Verification-tier labels — distinguish database-coded events, official statements, multi-source media reports, and single-source claims.
181. [P2] Controlled conflict vocabulary — use a versioned ontology for tactics, weapons, targets, actors, and outcomes without overwriting source terminology.
182. [P0] Boundary-neutrality policy — use Natural Earth or similarly documented boundaries and label disputed areas according to source geometry, not political claims.
183. [P1] Event freshness decay — visually reduce emphasis on stale incidents while preserving them in historical and evidentiary views.
184. [P1] Location uncertainty radius — scale map uncertainty geometry from source precision instead of assigning arbitrary confidence circles.
185. [P1] Priority theater ranking — rank theaters using transparent recency, intensity, civilian impact, escalation velocity, and cross-domain disruption metrics.
186. [P0] Conflict source outage transparency — warn users when one major dataset is unavailable and avoid treating missing coverage as reduced violence.
187. [P1] Disaster-violence separation — keep natural hazards, humanitarian need, and violent incidents distinct while allowing explicit overlap analysis.
188. [P2] Theater watchlist personalization — let users pin regions locally in browser storage without accounts, tracking, or server dependence.
189. [P0] Conflict redistribution audit — block deployment if restricted-source records appear in public static assets beyond licensed aggregation limits.
190. [P2] Conflict revision history — retain corrected event versions and show what changed rather than silently replacing historical records.
191. [P0] ReliefWeb ingestion — use the ReliefWeb API for disasters, reports, appeals, jobs-free humanitarian updates, source organizations, and publication dates.
192. [P0] GDACS alert ingestion — normalize red and orange earthquake, cyclone, flood, volcano, drought, and wildfire alerts with severity scores.
193. [P0] USGS earthquake integration — ingest significant and high-magnitude earthquake feeds with depth, magnitude, tsunami flag, and shake-map links.
194. [P1] NASA EONET integration — ingest open natural-event categories, geometries, sources, and temporal evolution for environmental context.
195. [P1] NASA FIRMS active fires — use keyed FIRMS access only in build-time Actions and store license-compliant fire detections with confidence.
196. [P1] NOAA weather alerts — ingest active US alert polygons, severity, certainty, urgency, onset, expiration, and issuing office.
197. [P1] EMSC earthquake corroboration — ingest EMSC real-time or public feeds to compare magnitude, depth, and location against USGS records.
198. [P1] Tropical cyclone advisories — ingest official NHC, JTWC, or national meteorological products into standardized tracks, cones, and wind radii.
199. [P2] Copernicus EMS activations — ingest public activation metadata and clearly separate rapid-mapping products from automatically derived hazard detections.
200. [P1] IFRC GO emergency integration — ingest appeals, field reports, emergencies, and response activities from the public GO API.
201. [P1] OCHA FTS funding flows — normalize humanitarian funding requirements, contributions, pledges, and sector allocations by crisis.
202. [P1] UNHCR displacement statistics — ingest refugee, asylum-seeker, stateless-person, and internally displaced population datasets with reference-period metadata.
203. [P1] IOM DTM displacement ingestion — load public DTM datasets through HDX or official endpoints and preserve assessment round, methodology, and coverage.
204. [P2] WFP food-security context — ingest public hunger, market, or emergency-operation datasets where available and label indicator methodology.
205. [P2] FEWS NET insecurity classification — render Integrated Food Security Phase Classification or FEWS NET spatial products subject to redistribution terms.
206. [P1] WHO outbreak intelligence — ingest Disease Outbreak News entries and geocode only locations explicitly stated in the report.
207. [P2] UNICEF situation reports — parse public situation-report metadata for affected children, response targets, and funding gaps without inventing figures.
208. [P1] ACAPS severity datasets — ingest public ACAPS crisis severity and access indicators at build-time where licensing permits redistribution.
209. [P2] INFORM risk context — ingest INFORM severity or risk indices as low-frequency baseline context rather than real-time incident evidence.
210. [P2] Humanitarian access constraints — normalize verified access, bureaucratic, insecurity, and infrastructure constraints from public humanitarian datasets.
211. [P2] Displacement flow arcs — aggregate official origin-destination displacement statistics into non-sensitive directional arcs with uncertainty labels.
212. [P1] Disaster-conflict overlap analysis — identify spatial and temporal overlap between active disasters and conflict theaters while explicitly avoiding causal inference.
213. [P1] Verified infrastructure damage — ingest only source-attributed damage reports and distinguish confirmed, preliminary, and unverified damage states.
214. [P2] Population exposure context — use WorldPop or SEDAC public rasters to estimate exposed population with method and resolution caveats.
215. [P2] Health-facility context — use license-cleared Healthsites or HDX facility data as humanitarian context without exposing sensitive operational details.
216. [P2] Camp and settlement context — ingest public UNHCR or IOM camp datasets, respecting protection restrictions and suppressing sensitive coordinates when required.
217. [P1] Funding-gap indicator — derive the gap between humanitarian requirements and committed funding directly from FTS figures with as-of dates.
218. [P1] Disaster lifecycle dedupe — link repeated reports to one evolving disaster while preserving individual alerts, revisions, and source observations.
219. [P1] Humanitarian cadence labels — disclose whether datasets update daily, monthly, annually, per assessment round, or only after major appeals.
220. [P0] Humanitarian uncertainty display — show population, casualty, funding, and displacement values with reference dates, rounding, and methodology notes.
221. [P0] Cross-source corroboration graph — connect independent reports, datasets, advisories, and observations supporting the same real-world event.
222. [P0] Evidence object model — model claims separately from source documents so one article never becomes an unquestioned fact.
223. [P1] H3 geospatial fusion — index incidents, assets, interference, and hazards in H3 cells for consistent spatial correlation across domains.
224. [P1] Temporal fusion windows — align events using explicit before, after, overlapping, and containment intervals rather than exact-timestamp equality.
225. [P1] Multimodal entity resolution — reconcile vessels by MMSI/IMO, aircraft by ICAO24, satellites by catalog number, and facilities by stable external identifiers.
226. [P0] Transparent confidence scoring — calculate confidence from source independence, precision, freshness, corroboration, methodology, and contradiction penalties.
227. [P0] Verification state machine — classify records as unconfirmed, single-source, corroborated, confirmed, contested, corrected, or retracted.
228. [P1] Provenance inspector — provide a detail-panel timeline showing retrieval, normalization, enrichment, correlation, correction, and confidence changes.
229. [P1] Contradiction detector — flag inconsistent timestamps, coordinates, casualty totals, identifiers, or classifications and preserve all conflicting values.
230. [P2] Source-independence detection — collapse syndicated copies and repeated wire reports so copied text does not count as independent corroboration.
231. [P2] Build-time claim extraction — use keyed language-model services only inside Actions to extract claims with citations, then store reviewable structured output.
232. [P2] Curated analyst annotations — support version-controlled human notes checked into the repository and rendered with author, timestamp, and evidence links.
233. [P1] Cross-domain correlation matrix — let users inspect aviation, maritime, conflict, cyber, space, and disaster co-occurrence by theater and time window.
234. [P2] Strategic chokepoint composite — combine AIS density, advisories, conflict incidents, disasters, and connectivity disruptions into explainable chokepoint risk.
235. [P0] Explainable anomaly evidence — every anomaly marker must link to the exact observations, baseline period, rule, and uncertainty that produced it.
236. [P0] Twice-hourly ingestion matrix — schedule independent GitHub Actions jobs by domain so one source failure does not block the entire deployment.
237. [P1] Multi-cadence snapshots — refresh aviation and AIS frequently, disaster alerts hourly, and annual statistics daily or weekly according to publisher cadence.
238. [P1] Precomputed spatial aggregates — generate H3 counts, density fields, and theater summaries during builds to minimize client computation and bandwidth.
239. [P1] Compact static serialization — emit normalized JSON with stable key ordering, concise fields, precision rounding, and compression-friendly binary alternatives when appropriate.
240. [P0] Domain-chunked loading — split snapshots into lazy-loaded maritime, aviation, conflict, cyber, space, humanitarian, and manifest files.
241. [P1] Atomic snapshot publication — generate a manifest pointing to immutable hashed chunks so partial deployments cannot mix incompatible versions.
242. [P0] Keyed connector containment — require keyed or credentialed sources such as ACLED, FIRMS, AISStream, Space-Track, OTX, and Radar to run build-time only.
243. [P0] Non-CORS connector mirroring — transform non-CORS public endpoints into normalized static JSON during builds instead of proxying or exposing user browsers to failures.
244. [P1] Runtime CORS refresh policy — permit direct browser refresh only for keyless CORS-enabled endpoints and preserve build-time snapshots as authoritative baselines.
245. [P0] Secret redaction gate — scan snapshot chunks, source maps, logs, and the client bundle for tokens before uploading the Pages artifact.
246. [P0] License-aware publication gate — compare each connector's output fields with permitted redistribution rules and fail the build on unauthorized bulk export.
247. [P1] Ingestion observability artifacts — upload redacted connector metrics, row counts, errors, checksums, and durations as GitHub Actions artifacts.
248. [P0] CI data-quality gates — validate schemas, coordinate bounds, timestamp ordering, duplicate ratios, required attribution, and minimum viable real-record counts.
249. [P0] Last-real-snapshot resilience — retain previous verified chunks in the artifact and activate them automatically with visible staleness when a source fails.
250. [P1] Public data-architecture panel — document source legitimacy, CORS constraints, build-time collection, update cadence, confidence semantics, and licensing inside the product.
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
751. [P1] Mission density profiles — Add compact/standard/expanded density presets in `GodEyeCommandCenter` that persist per operator workstation.
752. [P1] Keyboard-first command palette — Implement Ctrl+K actions for theater selection, layer toggles, focus targets, pause, refresh, and export.
753. [P1] Saved operational views — Serialize filters, layers, visual mode, camera target, and panel layout into shareable named views.
754. [P0] Critical incident triage queue — Add a ranked queue derived from severity, casualties, recency, and source confidence beside the event feed.
755. [P1] Theater comparison mode — Let operators pin two theaters and compare event tempo, severity mix, assets, and trend deltas.
756. [P1] Time-window scrubber — Provide a keyboard-accessible timeline control with playback speed, snapping, and explicit visible range.
757. [P0] Selection state consistency — Unify event, aircraft, vessel, and theater selection semantics so Escape always clears focus predictably.
758. [P1] Evidence-first detail panels — Reorder detail panels to show source, timestamp, confidence, location, casualties, and provenance before narrative text.
759. [P1] Multi-select incident operations — Support shift-selection for batch tagging, exporting, hiding, or adding incidents to a watchlist.
760. [P2] Operator notes — Add local or server-backed timestamped annotations on incidents and theaters with audit metadata.
761. [P1] Watchlists — Let operators pin theaters, routes, aircraft types, or regions and surface changes in a dedicated feed.
762. [P2] Incident correlation links — Group related events by proximity, time, theater, and source references without merging underlying records.
763. [P1] Powerful filter builder — Replace hidden filter logic with composable severity/category/time/source/region clauses and a readable summary.
764. [P2] Query transparency — Show exactly which records are excluded by active filters and provide one-click clause removal.
765. [P1] Camera mission presets — Add named camera positions for global, theater, corridor, and point-target inspections with deterministic transitions.
766. [P2] Coordinate copy workflow — Copy latitude/longitude, MGRS, altitude, and current timestamp in operator-selectable formats.
767. [P1] Event age encoding — Pair color with explicit age labels and sortable timestamps so recency never depends on hue alone.
768. [P1] Layer dependency disclosure — Explain data-source constraints and refresh cadence directly in each layer toggle tooltip.
769. [P2] Focused analysis mode — Add a distraction-free layout that retains legend, clock, filters, and evidence panels while minimizing nonessential chrome.
770. [P1] Empty-state guidance — Make every empty feed or layer state explain whether filters, connectivity, source outage, or lack of data is responsible.
771. [P1] Destructive-action safeguards — Confirm reset, export overwrite, and workspace deletion operations with undo or recovery paths.
772. [P2] Operator session timeline — Maintain a local chronological log of selections, filter changes, refreshes, and exports for after-action reconstruction.
773. [P1] Focus-safe split panels — Preserve selected-incident context when resizing or collapsing theater, feed, and detail panels.
774. [P2] Map scale and units — Add persistent scale, unit preferences, coordinate readout, and measurement display appropriate for operational briefs.
775. [P2] Briefing export workflow — Export a filtered incident package with map snapshot, source manifest, caveats, timestamps, and checksum.
776. [P0] WCAG contrast remediation — Audit command-center colors against WCAG 2.2 AA and introduce a high-contrast operational theme.
777. [P0] Globe keyboard alternative — Provide a synchronized tabular incident navigator for users unable to operate the WebGL globe.
778. [P0] Focus management — Move focus predictably when detail panels, sheets, dialogs, and the command palette open or close.
779. [P0] Screen-reader live regions — Announce refresh completion, source failures, selection changes, and critical alerts with throttled polite/assertive priorities.
780. [P0] Reduced-motion enforcement — Disable autorotation, camera tweening, pulsing, and nonessential transitions whenever `prefers-reduced-motion` is set.
781. [P1] Complete keyboard map — Document and implement bindings for navigation, selection, filtering, layer control, pause, refresh, and export.
782. [P1] Visible focus indicators — Use consistent high-contrast focus rings that remain visible over the globe, panels, and dense list rows.
783. [P1] Semantic landmark structure — Add labeled header, navigation, main map, complementary panels, and status landmarks to the command center.
784. [P1] Accessible names — Audit icon-only controls and add concise aria labels that include state such as paused, active, or unavailable.
785. [P1] Non-color severity encoding — Combine color with shapes, labels, ordering, and text tokens for critical/high/medium/low severity.
786. [P1] Text scaling resilience — Support 200% browser zoom and larger font preferences without clipping feeds, controls, or detail metadata.
787. [P1] Dyslexia-conscious typography — Use legible font sizing, spacing, sentence case, and limited numeric condensation in dense operational UI.
788. [P2] Captions and transcripts — Provide timestamped transcripts for voice-agent interactions and textual alternatives for audio alerts.
789. [P2] Voice command parity — Expose core navigation and filtering through voice commands while retaining visible confirmation and undo.
790. [P2] Speech-control compatibility — Use stable accessible names so Dragon/Voice Control users can activate controls by spoken label.
791. [P1] Tooltip accessibility — Make tooltips keyboard-focusable, dismissible, persistent on hover/focus, and available to assistive technology.
792. [P1] Accessible charts — Add data tables and concise summaries for timelines, comparisons, and trend charts rendered by Recharts.
793. [P1] Hierarchical headings — Correct heading order in panels and dialogs so screen-reader users can navigate operational sections efficiently.
794. [P1] Error identification — Associate validation and connectivity errors with controls using clear text rather than color-only cues.
795. [P2] Language and locale readiness — Externalize UI strings, date formats, units, and number formats before adding translations.
796. [P2] Plain-language alerts — Write concise alert copy that states what happened, where, when, confidence, and recommended operator action.
797. [P1] Touch target sizing — Ensure interactive controls meet at least 24x24 CSS pixels, with 44x44 targets on mobile interfaces.
798. [P2] Cognitive load controls — Allow operators to hide secondary metadata, freeze scrolling feeds, and reduce simultaneous motion or alerts.
799. [P1] Accessibility regression gate — Add axe-core scans plus keyboard and screen-reader smoke scripts to CI for primary workflows.
800. [P2] Assistive-technology test matrix — Validate critical flows with NVDA, JAWS, VoiceOver, keyboard-only operation, zoom, and high-contrast mode.
801. [P0] Mobile operational priority — Optimize the mobile sheet for current alerts, selected incident evidence, source health, and refresh controls before secondary analytics.
802. [P0] Offline-aware mobile shell — Keep last-known incidents, filters, and source status usable when connectivity drops during field operations.
803. [P1] Responsive panel choreography — Replace fixed desktop side panels with bottom-sheet, full-screen, and compact modes driven by viewport and orientation.
804. [P1] Thumb-zone command bar — Place pause, refresh, layers, search, and selected-target actions within reachable bottom-screen regions.
805. [P1] Touch gesture consistency — Standardize one-finger orbit, two-finger zoom, pinch inertia, tap selection, and long-press inspection with visible guidance.
806. [P1] Accidental-tap prevention — Separate dense incident markers under touch, requiring confirmation when multiple candidates fall within the selection radius.
807. [P0] Small-screen triage list — Offer a fast list-first mode with sorting, filtering, and incident detail independent of globe rendering.
808. [P1] Mobile bandwidth mode — Reduce imagery, animation, polling frequency, and asset density automatically on metered or degraded connections.
809. [P1] Battery-aware refresh — Lower background refresh and rendering activity when battery saver, thermal pressure, or hidden-tab state is detected.
810. [P1] Orientation transition continuity — Preserve selected target, camera context, filters, and scroll position across portrait/landscape changes.
811. [P1] Safe-area support — Account for notches, home indicators, browser chrome, and foldable-device hinges in all fixed navigation and sheets.
812. [P2] Split-screen and foldable layouts — Adapt panel proportions and map aspect ratios for tablets, foldables, and desktop-window resizing.
813. [P1] Mobile incident quick actions — Provide large, unambiguous actions for copy coordinates, watch, annotate, share, and open source evidence.
814. [P1] Mobile filter editing — Convert complex filters into stepwise full-screen editors with a persistent readable summary and easy reset.
815. [P2] Offline map packaging — Define tile/data packages by theater so mobile operators can prefetch only mission-relevant regions.
816. [P2] Low-end device fallback — Detect GPU, memory, and frame-rate constraints, then switch to simplified geometry and list-first operation.
817. [P1] Mobile alerting discipline — Batch noncritical notifications while preserving immediate, accessible presentation of critical incident changes.
818. [P2] Field sharing safeguards — Require explicit confirmation and redaction choices before exporting screenshots or incident bundles from mobile.
819. [P1] Mobile keyboard behavior — Prevent input focus from obscuring active fields and ensure numeric/coordinate keyboards appear where appropriate.
820. [P2] PWA installability — Add a manifest, service worker, offline start route, and install prompts only after core offline behavior is validated.
821. [P1] Mobile performance tracing — Measure startup, filter interaction, sheet expansion, target selection, and globe frame rate on representative devices.
822. [P2] Persistent mobile layout memory — Remember sheet height, active tab, sort order, and list/map preference across sessions.
823. [P2] Mobile accessibility audit — Validate touch target size, VoiceOver/TalkBack order, rotor navigation, zoom behavior, and focus visibility.
824. [P1] Mobile source-status visibility — Surface stale/offline/degraded state in a persistent compact header rather than hiding it in a panel.
825. [P2] Mobile usability field tests — Run task-based tests with gloved, one-handed, moving-vehicle, low-light, and intermittent-network scenarios.
826. [P0] Stale-data labeling — Display exact data age and staleness thresholds per source instead of a single ambiguous `lastUpdated` value.
827. [P0] Graceful source degradation — Keep independent aircraft, maritime, conflict, natural-event, and GPS-interference layers running when one source fails.
828. [P0] Retry with backoff — Implement bounded exponential backoff, jitter, cancellation, and manual retry for all polling hooks and API requests.
829. [P0] Last-known-good cache — Cache validated snapshots in IndexedDB with schema version, timestamp, source, checksum, and expiration metadata.
830. [P0] Offline read-only mode — Clearly switch to cached operation when disconnected while disabling actions that require live server confirmation.
831. [P1] Cache corruption quarantine — Validate cached payloads before use and quarantine malformed versions without destroying older known-good snapshots.
832. [P1] Reconnect reconciliation — Refetch changed data after reconnection, reconcile local annotations, and report conflicts without silent overwrites.
833. [P1] Source health model — Normalize states for live, delayed, degraded, unauthorized, rate-limited, offline, and failed across every upstream provider.
834. [P1] Refresh conflict prevention — Serialize overlapping refreshes with request cancellation and monotonically increasing snapshot identifiers.
835. [P1] Pause persistence — Persist operator pause intent locally so automatic refreshes do not silently resume after navigation or reload.
836. [P0] Globe failure continuity — Expand `GlobeFallback` into a useful sortable incident table with the same filters, selection, and evidence panels.
837. [P1] WebGL capability detection — Test context creation, memory pressure, and renderer failures before mounting the globe rather than relying on exceptions.
838. [P1] Snapshot atomicity — Apply multi-layer updates transactionally so operators never see incompatible combinations from different refresh cycles.
839. [P2] Offline mutation queue — Queue notes, watchlist edits, and preferences locally with durable IDs, retry metadata, and operator-visible sync status.
840. [P1] Partial payload validation — Accept valid independent sections of a snapshot while rejecting malformed sections and preserving prior values.
841. [P2] Data provenance ledger — Attach source URL, retrieval time, ingestion version, license terms, and transformation hash to every cached batch.
842. [P1] Rate-limit transparency — Show when provider quotas constrain freshness and provide operator-adjustable polling within safe service limits.
843. [P1] Clock-skew tolerance — Compare server timestamps using server-relative offsets and warn when device clocks threaten recency calculations.
844. [P2] Low-connectivity transport hints — Use `navigator.connection`, measured latency, and failure history to adapt polling without treating hints as guarantees.
845. [P1] Disaster-mode snapshot — Package a small curated high-severity dataset that remains available even if full cached payloads exceed storage quotas.
846. [P1] Service-worker update safety — Version cached assets, avoid mixed releases, and require user-visible confirmation before activating a breaking update.
847. [P1] Storage quota handling — Detect quota pressure, prune least-recent nonmission data, and alert operators before critical cached data is at risk.
848. [P2] Network chaos testing — Automate tests for offline startup, timeouts, slow 3G, dropped packets, partial responses, and captive-portal interference.
849. [P1] Resilience status API — Expose backend health, provider freshness, queue depth, cache age, and degradation reasons through a machine-readable endpoint.
850. [P2] Operator recovery runbook — Link in-product degraded-state banners to concise recovery steps and escalation contacts.
851. [P0] Native data-schema parity — Align Rust incident, aircraft, vessel, natural-event, and GPS-interference models with frontend TypeScript contracts.
852. [P0] Native filtering parity — Implement the same severity, category, theater, time-window, and source filters available in the web command center.
853. [P0] Native selection details — Add keyboard/mouse incident inspection with source, timestamp, casualties, confidence, coordinates, and provenance.
854. [P1] Native event feed — Add a sortable, filterable side panel mirroring web feed ordering and stale-data indicators.
855. [P1] Native theater aggregation — Port `aggregateTheaters` semantics to Rust with shared test fixtures validating counts and severity rollups.
856. [P1] Native timeline analysis — Add temporal scrubbing and trend summaries using the same bucketing rules as the web implementation.
857. [P1] Native source-status panel — Surface embedded-snapshot age, unavailable layers, parse failures, and refresh provenance in the Rust UI.
858. [P1] Native layer toggles — Implement equivalent density, beacon, border, aircraft, maritime, environmental, and GPS-interference controls.
859. [P1] Native keyboard map — Support consistent shortcuts for focus, selection, filters, pause, reset view, and detail dismissal.
860. [P2] Native command palette — Add searchable commands for jump-to-theater, filter presets, layer toggles, exports, and diagnostics.
861. [P1] Native high-contrast theme — Provide contrast-safe colors and non-color severity encodings matching web accessibility behavior.
862. [P1] Native reduced-motion mode — Disable autorotation, animated transitions, and pulsing indicators through configuration or OS accessibility settings.
863. [P1] Native offline-first packaging — Keep embedded snapshots valid while supporting optional signed external data updates with rollback.
864. [P1] Native deterministic rendering — Use fixed random seeds and deterministic ordering so screenshots and regression tests are repeatable.
865. [P2] Native camera bookmarks — Save and restore theater, corridor, and target views with explicit coordinates and orientation metadata.
866. [P2] Native export capability — Export filtered incident CSV/JSON and evidence manifests using the same schema and redaction controls as web.
867. [P2] Native operator notes — Store local annotations in an encrypted or access-controlled platform-appropriate data directory.
868. [P1] Native rendering budgets — Cap mesh counts, track lengths, labels, and draw calls with adaptive degradation on constrained hardware.
869. [P1] Native memory profiling — Measure baseline and peak memory for embedded datasets, mesh generation, and long-running sessions.
870. [P2] Native packaging automation — Produce reproducible Windows, macOS, and Linux builds with checksums, licenses, and version metadata.
871. [P1] Native crash reporting — Add opt-in crash capture with local logs, redaction, symbolication, and clear retention controls.
872. [P2] Native configuration validation — Validate config files at startup with actionable errors and safe fallback defaults.
873. [P1] Shared parity fixture suite — Generate canonical fixtures consumed by both frontend tests and Rust tests to prevent behavioral drift.
874. [P2] Native feature-matrix documentation — Maintain a user-visible parity matrix covering implemented, partial, unavailable, and intentionally different features.
875. [P2] Native UX acceptance review — Require side-by-side web/native task comparisons for triage, filtering, inspection, and export before release.
876. [P0] Contract-test API schemas — Validate backend responses against versioned JSON schemas in CI using representative success and failure cases.
877. [P0] Data-ingestion golden tests — Snapshot normalized conflict, aircraft, maritime, and environmental records with explicit unstable-field exclusions.
878. [P0] Critical-flow end-to-end tests — Automate startup, incident selection, filtering, pause/refresh, degraded source handling, and fallback operation.
879. [P1] Component tests for filters — Test every filter interaction and edge case against deterministic fixtures using Testing Library.
880. [P1] Hook reliability tests — Test cancellation, retry, stale responses, overlapping refresh, cache fallback, and error recovery in data hooks.
881. [P1] Visual regression baselines — Capture core layouts and states with stable fixtures, controlled clocks, and motion disabled.
882. [P1] Accessibility CI gates — Enforce zero critical axe violations and add manual keyboard/screen-reader release checklists.
883. [P1] Mobile viewport tests — Automate narrow, tablet, foldable, portrait, landscape, safe-area, and high-zoom layout checks.
884. [P1] WebGL fallback tests — Simulate context failure and verify that incident triage remains fully operable through the fallback interface.
885. [P1] Security regression tests — Test authentication boundaries, authorization, injection handling, rate limiting, security headers, and unsafe URL rendering.
886. [P1] Privacy regression tests — Verify telemetry opt-in, redaction, retention behavior, local-data deletion, and absence of sensitive data in logs.
887. [P1] Performance regression tests — Fail CI when startup, interaction, memory, bundle, or frame-time budgets exceed approved thresholds.
888. [P2] Load and stress tests — Exercise API and polling infrastructure with realistic concurrent operators and upstream-provider failure spikes.
889. [P2] Chaos-test upstreams — Inject latency, malformed payloads, intermittent 5xx responses, rate limits, and DNS failures in staging.
890. [P1] Offline test harness — Create repeatable browser tests for cold offline startup, cache expiry, reconnection, and queued-action reconciliation.
891. [P2] Cross-browser matrix — Validate Chromium, Firefox, Safari, Edge, iOS Safari, and Android Chrome with explicit unsupported-browser messaging.
892. [P2] Mutation testing — Introduce targeted mutation analysis for normalization, filtering, aggregation, and severity-classification logic.
893. [P1] Rust unit and property tests — Test coordinate transforms, data decoding, severity mapping, aggregation, and filtering against generated cases.
894. [P1] Rust snapshot tests — Validate embedded-data parsing and mesh-building invariants without relying on unstable rendering output.
895. [P2] Native smoke automation — Add scripted launch, fixture-load, interaction, shutdown, and log assertions to CI for supported platforms.
896. [P1] Test data governance — Scrub or synthesize sensitive operational information while preserving realistic distributions and edge cases.
897. [P2] Flake management — Track flaky-test ownership, quarantine criteria, retry policy, and removal deadlines rather than hiding failures.
898. [P1] Release validation checklist — Combine automated gates with explicit human verification of operational accuracy, accessibility, security, and rollback.
899. [P2] UAT scenario library — Define repeatable analyst scenarios covering triage, briefing, degraded operations, mobile use, and native parity.
900. [P1] Validation evidence archive — Store test reports, screenshots, performance traces, schema versions, and approval records with each release.
901. [P0] Structured frontend telemetry — Emit typed events for startup, refresh, source failure, fallback activation, selection, filter, export, and errors.
902. [P0] Backend request tracing — Add correlation IDs, route timing, dependency status, and trace propagation across API and upstream calls.
903. [P0] Source freshness metrics — Expose per-source age, lag, failure rate, latency, payload size, record count, and validation errors.
904. [P1] Real-user performance monitoring — Measure INP, LCP, CLS, long tasks, frame drops, memory growth, and device/network cohorts with privacy safeguards.
905. [P1] Error taxonomy — Classify errors by source, severity, recoverability, user impact, and retryability instead of reporting generic failures.
906. [P1] Operational dashboards — Build dashboards for live operators, degraded sources, cache-hit rates, offline usage, latency, and alert volume.
907. [P1] Alerting SLOs — Define SLOs for availability, freshness, startup, API latency, error rate, and recovery time with paging thresholds.
908. [P1] Privacy-safe diagnostics — Redact coordinates, annotations, queries, user identifiers, and access tokens from telemetry by default.
909. [P2] Local diagnostic bundle — Let operators generate an encrypted support bundle containing logs, versions, redacted config, and cache health.
910. [P1] Startup performance budget — Enforce fast first interactive command-center load with documented budgets by desktop, mobile, and low-end device class.
911. [P1] Interaction performance budget — Budget target selection, filter application, panel expansion, and timeline scrub interactions with measurable thresholds.
912. [P1] Rendering frame budget — Define frame-time targets for normal, dense, degraded, and fallback modes using repeatable fixture scenes.
913. [P1] Memory leak detection — Track renderer, hook, cache, listener, and worker lifetimes across long-running sessions and automated soak tests.
914. [P1] Bundle size governance — Monitor JavaScript, CSS, WASM, imagery, and data payload sizes with ownership and approval for regressions.
915. [P1] Payload minimization — Compress snapshots, trim unused fields, paginate feeds, and move historical data behind explicit operator requests.
916. [P2] Runtime data budget — Cap visible markers, labels, arcs, tracks, and polygons with adaptive aggregation and transparent count disclosure.
917. [P1] Worker-based normalization — Move heavy parsing, filtering, aggregation, and geospatial indexing off the main thread where beneficial.
918. [P2] Cache efficiency metrics — Measure hit ratio, eviction frequency, staleness, corruption rate, and storage usage per cached data class.
919. [P2] Backend capacity metrics — Track queue depth, worker utilization, database latency, upstream wait time, and saturation indicators.
920. [P1] Deployment release markers — Correlate frontend, backend, WASM, native, and data-schema versions in telemetry and dashboards.
921. [P2] Synthetic monitoring — Continuously probe critical API routes and user journeys from representative regions and network profiles.
922. [P1] Observability data retention — Define retention, aggregation, access control, and deletion processes for metrics, logs, traces, and diagnostics.
923. [P1] Performance lab fixtures — Create fixed datasets representing sparse, normal, dense, and extreme incident load for repeatable benchmarking.
924. [P2] Native telemetry parity — Emit comparable startup, memory, frame, crash, data-age, and feature-usage metrics from the Rust application.
925. [P1] Incident-response observability — Add runbook-linked alerts with enough context to distinguish frontend, backend, provider, network, and data faults.
926. [P0] Environment configuration validation — Fail fast on missing or invalid API URLs, keys, secrets, CORS origins, and feature flags at startup.
927. [P0] Secret-management standard — Store secrets in approved managers, rotate them regularly, and prohibit secrets in client bundles or repository files.
928. [P0] Backend authentication — Require authenticated access for privileged operational endpoints using short-lived tokens and explicit authorization scopes.
929. [P0] Authorization model — Separate viewer, analyst, administrator, and support permissions for exports, annotations, configuration, and diagnostics.
930. [P0] Security headers — Enforce CSP, HSTS, frame-ancestors, nosniff, referrer-policy, permissions-policy, and cross-origin isolation where appropriate.
931. [P1] API input validation — Validate and constrain query parameters, coordinate ranges, pagination, date windows, and schema-shaped request bodies.
932. [P1] Output encoding — Escape untrusted titles, source notes, user annotations, and URLs across HTML, Markdown, CSV, and exported documents.
933. [P1] CSRF and CORS discipline — Apply strict origin allowlists, credential rules, CSRF protections, and preflight caching appropriate to deployment.
934. [P1] Rate limiting and abuse control — Throttle expensive endpoints by identity and workload while preserving emergency access procedures.
935. [P1] Dependency supply-chain scanning — Audit npm, Python, and Rust dependencies for vulnerabilities, licenses, provenance, and unexpected drift.
936. [P1] Reproducible builds — Pin toolchains, lock dependencies, record build metadata, and verify artifacts with reproducible-build checks where feasible.
937. [P1] Signed release artifacts — Sign frontend bundles, backend images, native binaries, and data snapshots with verification documented for operators.
938. [P1] Safe feature flags — Make flags server-controlled, auditable, scoped, and safe to disable without redeployment during incidents.
939. [P1] Blue-green deployment — Support zero-downtime deployment with health checks, database compatibility, automatic rollback, and release markers.
940. [P1] Database migration safety — Require backward-compatible migrations, rollback plans, lock analysis, and rehearsal on production-like data.
941. [P1] Backup and restore testing — Schedule restores for application state, annotations, configuration, and operational metadata with measured recovery objectives.
942. [P1] Infrastructure as code — Define environments declaratively with peer review, drift detection, secret isolation, and least-privilege deployment identities.
943. [P2] Multi-region readiness — Document and test failover, data residency, latency, cache consistency, and provider availability across deployment regions.
944. [P1] Container hardening — Run backend services as non-root, minimize base images, scan filesystems, cap resources, and disable unnecessary capabilities.
945. [P1] Audit logging — Record sensitive reads, exports, permission changes, annotations, configuration edits, and administrative actions with tamper resistance.
946. [P2] Break-glass access — Provide emergency elevated access with strong approval, time limits, auditing, and post-incident review.
947. [P1] Vulnerability-management SLA — Define severity-based remediation deadlines and exception approval for frontend, backend, native, and infrastructure components.
948. [P2] Security incident drills — Exercise token leakage, dependency compromise, provider compromise, unauthorized export, and cache-poisoning scenarios.
949. [P1] Native binary hardening — Enable platform exploit mitigations, strip unnecessary debug data, verify signatures, and avoid insecure update channels.
950. [P1] Deployment provenance — Record commit, pipeline, artifact digest, dependency lock hashes, configuration version, and approving identity for every release.
951. [P0] Data classification map — Classify incident data, operator notes, telemetry, logs, exports, and diagnostics by sensitivity and handling requirements.
952. [P0] Telemetry consent — Make nonessential telemetry opt-in, explain collected fields, and honor withdrawal without degrading core operations.
953. [P0] Export redaction controls — Provide role-aware redaction of annotations, identities, precise coordinates, source metadata, and diagnostic details.
954. [P1] Local-data transparency — Show what IndexedDB, service workers, native files, preferences, and caches store with one-click inspection and deletion.
955. [P1] Retention enforcement — Implement automatic expiration and verified deletion for logs, telemetry, cached data, notes, exports, and support bundles.
956. [P1] Privacy impact assessment — Document data flows, lawful basis, processors, residency, risks, mitigations, and review cadence for the whole system.
957. [P1] Sensitive-coordinate handling — Support precision reduction, exclusion zones, and delayed publication where operational safety requires it.
958. [P1] Annotation protection — Encrypt or access-control operator notes at rest and prevent accidental inclusion in screenshots, telemetry, and exports.
959. [P1] Voice-data minimization — Define exactly what voice interactions are stored, transcribed, transmitted, retained, and visible to operators.
960. [P2] Source-license compliance — Track attribution, redistribution, caching, and commercial-use constraints for every upstream dataset and map asset.
961. [P1] Operator quick-start — Write a concise mission-focused guide covering triage, filters, alerts, exports, degraded mode, and keyboard workflows.
962. [P1] Administrator deployment guide — Document architecture, environment variables, security controls, scaling, backup, rollback, and health verification.
963. [P1] Offline operations guide — Explain prefetching, cache limits, stale-data interpretation, queued actions, reconciliation, and recovery procedures.
964. [P1] Native application guide — Document installation, signatures, permissions, parity differences, configuration, updates, diagnostics, and uninstall cleanup.
965. [P2] Accessibility conformance report — Maintain a current VPAT-style report with known gaps, remediation priorities, and tested assistive technologies.
966. [P1] API documentation — Generate accurate endpoint references with schemas, errors, rate limits, versioning, authentication, and reproducible examples.
967. [P2] Data dictionary — Define every operational field, unit, severity scale, confidence label, timestamp semantic, and source transformation.
968. [P1] Architecture decision records — Record significant UX, offline, native, security, observability, and performance tradeoffs with review dates.
969. [P1] Runbook library — Create indexed runbooks for provider outage, stale data, cache corruption, deployment rollback, security events, and privacy incidents.
970. [P1] In-product help — Add contextual, searchable help that explains controls and degraded states without exposing unsupported operational claims.
971. [P2] Training scenarios — Provide safe synthetic datasets and exercises for triage, briefing, degraded operations, mobile use, and native parity.
972. [P2] Terminology glossary — Standardize C2, incident, theater, source freshness, confidence, severity, provenance, and watchlist terminology.
973. [P1] Documentation validation — Test documented commands, configuration examples, curl requests, recovery steps, and screenshots in CI where feasible.
974. [P1] Privacy notices — Present concise, layered privacy information in product and link to detailed retention, telemetry, and processor documentation.
975. [P2] Release notes discipline — Publish user-facing changes, operational impacts, breaking changes, security fixes, migrations, and validation evidence.
976. [P0] Schema-version compatibility matrix — Maintain supported frontend, backend, WASM, native, cache, and snapshot schema combinations with migration tests.
977. [P0] Data quality scoring — Score completeness, timeliness, geospatial validity, source agreement, duplication, and confidence before records enter operational views.
978. [P0] Geospatial validation — Reject impossible coordinates, invalid geometries, antimeridian errors, inconsistent precision, and malformed timezone conversions.
979. [P1] Duplicate detection — Detect near-duplicate incidents using spatial, temporal, title, source, and casualty similarity while preserving independent records.
980. [P1] Source disagreement workflow — Surface conflicting reports side-by-side with provenance and confidence instead of silently selecting one version.
981. [P1] Casualty-count validation — Parse, normalize, and validate casualty values with uncertainty ranges and explicit unknown states.
982. [P1] Timestamp normalization — Store UTC canonical timestamps plus original source time, ingestion time, timezone assumptions, and uncertainty.
983. [P1] Severity-classification audit — Document and test deterministic rules for critical/high/medium/low mappings across every source.
984. [P2] Manual verification queue — Route low-confidence or anomalous high-impact incidents for analyst confirmation before elevated alerting.
985. [P1] Alert precision measurement — Measure false-positive, false-negative, duplicate, and correction rates for operational alerts by source and theater.
986. [P2] Analyst feedback loop — Capture structured correction, confirmation, irrelevance, and severity-dispute feedback tied to records and model versions.
987. [P1] WASM/core parity tests — Validate any shared computational core against both browser and native consumers using identical fixtures.
988. [P2] End-to-end provenance verification — Test that a record can be traced from source retrieval through normalization, cache, UI, export, and archive.
989. [P1] Disaster recovery game day — Conduct scheduled loss scenarios for backend, database, provider, cache, artifact registry, and deployment credentials.
990. [P1] Operational acceptance criteria — Require objective pass/fail criteria for freshness, correctness, availability, accessibility, performance, and security before launch.
991. [P2] Mission-thread validation — Test complete workflows from detection through triage, verification, briefing, export, audit, and after-action review.
992. [P2] Cold-start validation — Measure and verify first-run behavior without cache, tokens, permissions, network access, GPU acceleration, or prior preferences.
993. [P1] Release candidate hardening — Freeze features, execute full automated and manual validation, remediate critical defects, and document accepted risks.
994. [P2] Post-release verification — Monitor SLOs, errors, performance, adoption, accessibility feedback, privacy signals, and rollback readiness after deployment.
995. [P1] Configuration drift detection — Compare deployed configuration and feature flags against approved baselines with alerting and audit history.
996. [P2] Data snapshot certification — Sign and certify validated operational snapshots after automated schema, quality, license, and provenance checks.
997. [P2] Human-factors validation — Evaluate workload, error rates, comprehension, alert fatigue, and task completion with representative operators.
998. [P1] Compliance evidence traceability — Link requirements, controls, implementation artifacts, tests, approvals, and release evidence in an auditable matrix.
999. [P2] Continuous validation dashboard — Aggregate automated gates, manual checks, drill results, SLOs, exceptions, and expiry dates for operational readiness.
1000. [P0] Independent readiness review — Require cross-functional security, privacy, accessibility, operations, and analyst sign-off before designating the system mission-ready.
