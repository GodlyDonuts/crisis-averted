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
