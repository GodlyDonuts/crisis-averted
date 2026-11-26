use crate::correlation::{correlate_loaded_incidents, IncidentCorrelationStats};
use crate::data::{
    parse_osint_snapshot, snapshot_revision, unix_time_now, Incident, OsintSnapshot,
};
use serde::Deserialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

pub const DEFAULT_SNAPSHOT_URL: &str =
    "https://godlydonuts.github.io/crisis-averted/data/osint-snapshot.json";
const DEFAULT_REFRESH_SECONDS: u64 = 300;
const MIN_REFRESH_SECONDS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotSourceKind {
    LocalFile,
    RemoteUrl,
}

impl SnapshotSourceKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::LocalFile => "local file",
            Self::RemoteUrl => "remote URL",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RefreshConfig {
    pub local_path: Option<PathBuf>,
    pub remote_url: Option<String>,
    pub interval: Duration,
    pub warnings: Vec<String>,
}

fn truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn read_env_nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub fn config_from_env_and_args() -> RefreshConfig {
    let mut warnings = Vec::new();
    let mut local_path = read_env_nonempty("GODSEYE_SNAPSHOT_PATH").map(PathBuf::from);
    let mut remote_url = read_env_nonempty("GODSEYE_SNAPSHOT_URL").or_else(|| {
        if std::env::var("GODSEYE_NO_REMOTE")
            .map(|value| truthy(&value))
            .unwrap_or(false)
        {
            None
        } else {
            Some(DEFAULT_SNAPSHOT_URL.to_string())
        }
    });
    let mut interval_seconds = read_env_nonempty("GODSEYE_REFRESH_SECONDS")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_REFRESH_SECONDS);

    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0usize;
    while index < args.len() {
        let arg = &args[index];
        let mut take_value = |index: &mut usize, flag: &str| -> Option<String> {
            if let Some(value) = args[*index]
                .strip_prefix(flag)
                .and_then(|rest| rest.strip_prefix('='))
            {
                return (!value.trim().is_empty()).then(|| value.trim().to_string());
            }
            if args[*index] == flag {
                if let Some(value) = args.get(*index + 1) {
                    *index += 1;
                    return (!value.trim().is_empty()).then(|| value.trim().to_string());
                }
                warnings.push(format!("{} requires a value", flag));
            }
            None
        };
        if let Some(path) = take_value(&mut index, "--snapshot") {
            local_path = Some(PathBuf::from(path));
        } else if let Some(path) = take_value(&mut index, "--snapshot-path") {
            local_path = Some(PathBuf::from(path));
        } else if let Some(url) = take_value(&mut index, "--snapshot-url") {
            remote_url = Some(url);
        } else if arg == "--no-remote" {
            remote_url = None;
        } else if let Some(value) = take_value(&mut index, "--refresh-interval") {
            match value.parse::<u64>() {
                Ok(parsed) => interval_seconds = parsed,
                Err(_) => warnings.push(format!(
                    "invalid refresh interval '{}'; using default",
                    value
                )),
            }
        } else if arg == "--help" || arg == "-h" {
            println!(
                "godseye-native options:\n  --snapshot PATH / GODSEYE_SNAPSHOT_PATH      local osint-snapshot.json refresh source (preferred)\n  --snapshot-url URL / GODSEYE_SNAPSHOT_URL     remote snapshot URL (default: deployed static JSON)\n  --no-remote / GODSEYE_NO_REMOTE=1              disable remote refresh\n  --refresh-interval SECONDS / GODSEYE_REFRESH_SECONDS  polling interval (default 300, minimum 30)"
            );
            std::process::exit(0);
        } else {
            warnings.push(format!("unrecognized argument '{}'", arg));
        }
        index += 1;
    }

    if interval_seconds < MIN_REFRESH_SECONDS {
        warnings.push(format!(
            "refresh interval {}s is below the {}s safety floor; using {}s",
            interval_seconds, MIN_REFRESH_SECONDS, MIN_REFRESH_SECONDS
        ));
        interval_seconds = MIN_REFRESH_SECONDS;
    }

    RefreshConfig {
        local_path,
        remote_url,
        interval: Duration::from_secs(interval_seconds),
        warnings,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshCommand {
    Now,
}

#[derive(Debug)]
pub enum RefreshMessage {
    Started { cycle: u64 },
    Completed(Box<RefreshReport>),
}

#[derive(Debug, Clone)]
pub struct SourceAttempt {
    pub kind: SnapshotSourceKind,
    pub detail: String,
    pub ok: bool,
    pub error: Option<String>,
    pub bytes: Option<usize>,
    pub snapshot_fetched_at: Option<String>,
    pub selected: bool,
}

#[derive(Debug)]
pub struct ActiveSnapshot {
    pub source: SnapshotSourceKind,
    pub detail: String,
    pub snapshot: OsintSnapshot,
    /// Canonical incidents correlated inside the refresh worker, keeping the render thread interactive.
    pub incidents: Vec<Incident>,
    /// Temporal playback grids are deliberately not prebuilt here: they analyze the operator's
    /// filtered scope rather than the full corpus, so the filter pipeline rebuilds them through
    /// its own generationed worker when the refreshed corpus lands.
    pub correlation_stats: IncidentCorrelationStats,
    pub revision: String,
    pub received_unix: f64,
}

#[derive(Debug)]
pub struct RefreshReport {
    pub cycle: u64,
    pub active: Option<ActiveSnapshot>,
    pub attempts: Vec<SourceAttempt>,
    pub completed_unix: f64,
}

struct LoadSuccess {
    kind: SnapshotSourceKind,
    detail: String,
    snapshot: OsintSnapshot,
    bytes: usize,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ChunkedManifest {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "snapshotSchemaVersion")]
    snapshot_schema_version: String,
    #[serde(rename = "generatedAt")]
    generated_at: String,
    snapshot: ChunkedManifestSnapshot,
    publication: ChunkedManifestPublication,
    #[serde(rename = "legacyArtifact")]
    legacy_artifact: ChunkedLegacyArtifact,
    chunks: Vec<ChunkedManifestChunk>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ChunkedManifestSnapshot {
    #[serde(rename = "fetchedAt")]
    fetched_at: String,
    sources: BTreeMap<String, String>,
    errors: Vec<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ChunkedManifestPublication {
    #[serde(rename = "combinedSha256")]
    combined_sha256: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ChunkedLegacyArtifact {
    bytes: usize,
    sha256: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ChunkedManifestChunk {
    id: String,
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    #[serde(rename = "relativePath")]
    relative_path: String,
    bytes: usize,
    sha256: String,
    priority: i32,
    collections: Vec<String>,
    counts: BTreeMap<String, usize>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

fn json_collection_count(value: &Value) -> usize {
    match value {
        Value::Array(rows) => rows.len(),
        Value::Null => 0,
        _ => 1,
    }
}

fn parse_chunked_manifest(text: &str) -> Result<ChunkedManifest, String> {
    let manifest: ChunkedManifest = serde_json::from_str(text)
        .map_err(|error| format!("invalid domain manifest JSON: {}", error))?;
    if manifest.schema_version != "osint-snapshot-manifest/v1" {
        return Err(format!(
            "unsupported domain manifest schema {}",
            manifest.schema_version
        ));
    }
    if manifest.snapshot_schema_version != "osint-snapshot/v2-domain-chunked" {
        return Err(format!(
            "unsupported chunked snapshot schema {}",
            manifest.snapshot_schema_version
        ));
    }
    if manifest.snapshot.fetched_at != manifest.generated_at {
        return Err("manifest snapshot retrieval timestamp drift".to_string());
    }
    if manifest.chunks.len() != 9 {
        return Err(format!(
            "manifest declares {} chunks; canonical layout requires 9",
            manifest.chunks.len()
        ));
    }
    if manifest.chunks.iter().any(|chunk| {
        chunk.id.is_empty()
            || chunk.relative_path.is_empty()
            || chunk.bytes == 0
            || chunk.sha256.len() != 64
    }) {
        return Err("manifest chunk path/byte/hash metadata malformed".to_string());
    }
    Ok(manifest)
}

/// Reassemble the typed native snapshot from validated domain chunks. Native does not
/// silently tolerate partial chunks: every canonical collection, count, byte length,
/// and SHA-256 digest must agree with the manifest before any row is projected.
fn assemble_chunked_snapshot(
    manifest: &ChunkedManifest,
    chunk_texts: &[String],
) -> Result<OsintSnapshot, String> {
    if chunk_texts.len() != manifest.chunks.len() {
        return Err(format!(
            "{} chunk bodies supplied for {} manifest chunks",
            chunk_texts.len(),
            manifest.chunks.len()
        ));
    }
    let mut root = Map::new();
    root.insert(
        "fetchedAt".to_string(),
        Value::String(manifest.snapshot.fetched_at.clone()),
    );
    root.insert(
        "sources".to_string(),
        serde_json::to_value(&manifest.snapshot.sources).map_err(|error| error.to_string())?,
    );
    root.insert(
        "errors".to_string(),
        serde_json::to_value(&manifest.snapshot.errors).map_err(|error| error.to_string())?,
    );
    let mut combined_input = String::new();
    for (index, reference) in manifest.chunks.iter().enumerate() {
        let text = chunk_texts
            .get(index)
            .ok_or_else(|| format!("missing chunk body {}", reference.id))?;
        if text.as_bytes().len() != reference.bytes {
            return Err(format!(
                "chunk {} byte-count drift: received {}, manifest declares {}",
                reference.id,
                text.as_bytes().len(),
                reference.bytes
            ));
        }
        let actual_sha256 = sha256_hex(text.as_bytes());
        if actual_sha256 != reference.sha256 {
            return Err(format!(
                "chunk {} SHA-256 drift: received {}, manifest declares {}",
                reference.id, actual_sha256, reference.sha256
            ));
        }
        if index > 0 {
            combined_input.push('\n');
        }
        combined_input.push_str(&format!("{}:{}", reference.id, reference.sha256));
        let payload: Value = serde_json::from_str(text)
            .map_err(|error| format!("chunk {} invalid JSON: {}", reference.id, error))?;
        let object = payload
            .as_object()
            .ok_or_else(|| format!("chunk {} is not an object", reference.id))?;
        if object.get("schemaVersion").and_then(Value::as_str)
            != Some(reference.schema_version.as_str())
        {
            return Err(format!("chunk {} schemaVersion drift", reference.id));
        }
        if object.get("domain").and_then(Value::as_str) != Some(reference.id.as_str()) {
            return Err(format!("chunk {} domain mismatch", reference.id));
        }
        if object.get("snapshotFetchedAt").and_then(Value::as_str)
            != Some(manifest.generated_at.as_str())
        {
            return Err(format!(
                "chunk {} retrieval timestamp does not match manifest",
                reference.id
            ));
        }
        let collections = object
            .get("collections")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("chunk {} collections missing", reference.id))?;
        let counts = object
            .get("counts")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("chunk {} counts missing", reference.id))?;
        for key in &reference.collections {
            let value = collections
                .get(key)
                .ok_or_else(|| format!("chunk {} missing collection {}", reference.id, key))?;
            let actual_count = json_collection_count(value);
            let declared_count = counts
                .get(key)
                .and_then(Value::as_u64)
                .map(|value| value as usize);
            if declared_count != Some(actual_count) {
                return Err(format!("chunk {} count drift for {}", reference.id, key));
            }
            if reference.counts.get(key).copied() != Some(actual_count) {
                return Err(format!(
                    "chunk {} manifest count drift for {}",
                    reference.id, key
                ));
            }
            root.insert(key.clone(), value.clone());
        }
    }
    let combined_sha256 = sha256_hex(combined_input.as_bytes());
    if !manifest.publication.combined_sha256.is_empty()
        && combined_sha256 != manifest.publication.combined_sha256
    {
        return Err("manifest combined chunk hash does not match ordered chunk hashes".to_string());
    }
    let serialized =
        serde_json::to_string(&Value::Object(root)).map_err(|error| error.to_string())?;
    parse_osint_snapshot(&serialized).map_err(|error| {
        format!(
            "reassembled chunked snapshot does not satisfy the native schema: {}",
            error
        )
    })
}

fn manifest_url_for_snapshot(snapshot_url: &str) -> Option<String> {
    snapshot_url
        .strip_suffix("data/osint-snapshot.json")
        .map(|prefix| format!("{}data/osint/manifest.json", prefix))
}

fn sibling_artifact_url(manifest_url: &str, relative_path: &str) -> Result<String, String> {
    manifest_url
        .rfind('/')
        .map(|index| format!("{}/{}", &manifest_url[..index], relative_path))
        .ok_or_else(|| "manifest URL has no directory component".to_string())
}

fn fetch_remote_text(agent: &ureq::Agent, url: &str) -> Result<String, String> {
    let mut response = agent
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", "godseye-native/0.1 snapshot-refresh")
        .call()
        .map_err(|error| format!("remote snapshot request failed: {}", error))?;
    response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("unable to read remote snapshot body: {}", error))
}

fn load_remote_chunked(agent: &ureq::Agent, snapshot_url: &str) -> Result<LoadSuccess, String> {
    let manifest_url = manifest_url_for_snapshot(snapshot_url).ok_or_else(|| {
        "remote URL is not the canonical compatibility monolith location".to_string()
    })?;
    let manifest_text = fetch_remote_text(agent, &manifest_url)
        .map_err(|error| format!("domain manifest unavailable: {}", error))?;
    let manifest = parse_chunked_manifest(&manifest_text)?;
    let mut order = manifest.chunks.iter().enumerate().collect::<Vec<_>>();
    order.sort_by_key(|(_, chunk)| chunk.priority);
    let mut chunk_texts = vec![String::new(); manifest.chunks.len()];
    let mut bytes = manifest_text.as_bytes().len();
    for (index, reference) in order {
        let url = sibling_artifact_url(&manifest_url, &reference.relative_path)?;
        let text = fetch_remote_text(agent, &url)
            .map_err(|error| format!("domain chunk {} unavailable: {}", reference.id, error))?;
        bytes += text.as_bytes().len();
        chunk_texts[index] = text;
    }
    let snapshot = assemble_chunked_snapshot(&manifest, &chunk_texts)?;
    Ok(LoadSuccess {
        kind: SnapshotSourceKind::RemoteUrl,
        detail: format!(
            "{} ({} verified domain chunks)",
            manifest_url,
            manifest.chunks.len()
        ),
        snapshot,
        bytes,
    })
}

fn local_manifest_path(snapshot_path: &PathBuf) -> Option<PathBuf> {
    if snapshot_path.file_name().and_then(|name| name.to_str()) == Some("manifest.json") {
        return Some(snapshot_path.clone());
    }
    snapshot_path
        .parent()
        .map(|parent| parent.join("osint").join("manifest.json"))
}

fn load_local_chunked(path: &PathBuf) -> Result<Option<LoadSuccess>, String> {
    let Some(manifest_path) = local_manifest_path(path) else {
        return Ok(None);
    };
    if !manifest_path.exists() {
        return Ok(None);
    }
    let manifest_text = std::fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "unable to read domain manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    let manifest = parse_chunked_manifest(&manifest_text)?;
    let manifest_dir = manifest_path
        .parent()
        .ok_or_else(|| "domain manifest has no parent directory".to_string())?;
    let mut order = manifest.chunks.iter().enumerate().collect::<Vec<_>>();
    order.sort_by_key(|(_, chunk)| chunk.priority);
    let mut chunk_texts = vec![String::new(); manifest.chunks.len()];
    let mut bytes = manifest_text.as_bytes().len();
    for (index, reference) in order {
        let chunk_path = manifest_dir.join(&reference.relative_path);
        let text = std::fs::read_to_string(&chunk_path).map_err(|error| {
            format!(
                "unable to read domain chunk {} at {}: {}",
                reference.id,
                chunk_path.display(),
                error
            )
        })?;
        bytes += text.as_bytes().len();
        chunk_texts[index] = text;
    }
    let snapshot = assemble_chunked_snapshot(&manifest, &chunk_texts)?;
    Ok(Some(LoadSuccess {
        kind: SnapshotSourceKind::LocalFile,
        detail: format!(
            "{} ({} verified domain chunks)",
            manifest_path.display(),
            manifest.chunks.len()
        ),
        snapshot,
        bytes,
    }))
}

fn validate_legacy_text_against_manifest(
    text: &str,
    manifest: &ChunkedManifest,
) -> Result<(), String> {
    if manifest.legacy_artifact.bytes > 0 && text.as_bytes().len() != manifest.legacy_artifact.bytes
    {
        return Err(format!(
            "compatibility monolith byte-count drift: received {}, manifest declares {}",
            text.as_bytes().len(),
            manifest.legacy_artifact.bytes
        ));
    }
    if manifest.legacy_artifact.sha256.len() == 64 {
        let actual = sha256_hex(text.as_bytes());
        if actual != manifest.legacy_artifact.sha256 {
            return Err(format!(
                "compatibility monolith SHA-256 drift: received {}, manifest declares {}",
                actual, manifest.legacy_artifact.sha256
            ));
        }
    }
    Ok(())
}

fn compatibility_detail(base: String, chunk_error: Option<String>) -> String {
    match chunk_error {
        Some(error) => format!(
            "{} (compatibility monolith; chunked path unavailable: {})",
            base,
            error.chars().take(160).collect::<String>()
        ),
        None => base,
    }
}

fn load_local(path: &PathBuf) -> Result<LoadSuccess, String> {
    let mut chunk_error = None;
    match load_local_chunked(path) {
        Ok(Some(success)) => return Ok(success),
        Ok(None) => {}
        Err(error) => chunk_error = Some(error),
    }
    if path.file_name().and_then(|name| name.to_str()) == Some("manifest.json") {
        return Err(chunk_error.unwrap_or_else(|| {
            "domain manifest cannot be used as the compatibility monolith".to_string()
        }));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("unable to read {}: {}", path.display(), error))?;
    let snapshot = parse_osint_snapshot(&text).map_err(|error| {
        format!(
            "invalid OSINT snapshot JSON in {}: {}",
            path.display(),
            error
        )
    })?;
    if snapshot.fetched_at.is_none() {
        return Err(format!(
            "invalid OSINT snapshot JSON in {}: fetchedAt missing",
            path.display()
        ));
    }
    if let Some(manifest_path) = local_manifest_path(path) {
        if manifest_path.exists() {
            let manifest_text = std::fs::read_to_string(&manifest_path).map_err(|error| {
                format!(
                    "unable to read domain manifest {}: {}",
                    manifest_path.display(),
                    error
                )
            })?;
            let manifest = parse_chunked_manifest(&manifest_text)?;
            validate_legacy_text_against_manifest(&text, &manifest)?;
        }
    }
    Ok(LoadSuccess {
        kind: SnapshotSourceKind::LocalFile,
        detail: compatibility_detail(path.display().to_string(), chunk_error),
        snapshot,
        bytes: text.len(),
    })
}

fn load_remote(agent: &ureq::Agent, url: &str) -> Result<LoadSuccess, String> {
    let chunk_error = match load_remote_chunked(agent, url) {
        Ok(success) => return Ok(success),
        Err(error) => Some(error),
    };
    let text = fetch_remote_text(agent, url)?;
    let snapshot = parse_osint_snapshot(&text)
        .map_err(|error| format!("invalid remote OSINT snapshot JSON: {}", error))?;
    if snapshot.fetched_at.is_none() {
        return Err("invalid remote OSINT snapshot JSON: fetchedAt missing".to_string());
    }
    if let Some(manifest_url) = manifest_url_for_snapshot(url) {
        if let Ok(manifest_text) = fetch_remote_text(agent, &manifest_url) {
            if let Ok(manifest) = parse_chunked_manifest(&manifest_text) {
                validate_legacy_text_against_manifest(&text, &manifest)?;
            }
        }
    }
    Ok(LoadSuccess {
        kind: SnapshotSourceKind::RemoteUrl,
        detail: compatibility_detail(url.to_string(), chunk_error),
        snapshot,
        bytes: text.len(),
    })
}

fn success_attempt(success: &LoadSuccess, selected: bool) -> SourceAttempt {
    SourceAttempt {
        kind: success.kind,
        detail: success.detail.clone(),
        ok: true,
        error: None,
        bytes: Some(success.bytes),
        snapshot_fetched_at: success.snapshot.fetched_at.clone(),
        selected,
    }
}

fn failure_attempt(
    kind: SnapshotSourceKind,
    detail: String,
    error: String,
    selected: bool,
) -> SourceAttempt {
    SourceAttempt {
        kind,
        detail,
        ok: false,
        error: Some(error),
        bytes: None,
        snapshot_fetched_at: None,
        selected,
    }
}

fn run_cycle(
    cycle: u64,
    config: &RefreshConfig,
    agent: &ureq::Agent,
    fallback_incidents: &[Incident],
    messages: &Sender<RefreshMessage>,
) {
    let _ = messages.send(RefreshMessage::Started { cycle });
    let mut local_result = None;
    let mut remote_result = None;
    let mut errors = Vec::new();

    if let Some(path) = &config.local_path {
        match load_local(path) {
            Ok(success) => local_result = Some(success),
            Err(error) => errors.push((
                SnapshotSourceKind::LocalFile,
                path.display().to_string(),
                error,
            )),
        }
    }
    if let Some(url) = &config.remote_url {
        match load_remote(agent, url) {
            Ok(success) => remote_result = Some(success),
            Err(error) => errors.push((SnapshotSourceKind::RemoteUrl, url.clone(), error)),
        }
    }

    // An operator-supplied local file is deliberately preferred over the deployed public file.
    // If it is absent or malformed, the remote snapshot remains a truthful fallback.
    let selected_kind = if local_result.is_some() {
        Some(SnapshotSourceKind::LocalFile)
    } else if remote_result.is_some() {
        Some(SnapshotSourceKind::RemoteUrl)
    } else {
        None
    };
    let mut attempts = Vec::new();
    if let Some(success) = local_result.as_ref() {
        attempts.push(success_attempt(
            success,
            selected_kind == Some(SnapshotSourceKind::LocalFile),
        ));
    }
    if let Some(success) = remote_result.as_ref() {
        attempts.push(success_attempt(
            success,
            selected_kind == Some(SnapshotSourceKind::RemoteUrl),
        ));
    }
    for (kind, detail, error) in errors {
        attempts.push(failure_attempt(kind, detail, error, false));
    }

    let selected_success = match selected_kind {
        Some(SnapshotSourceKind::LocalFile) => local_result,
        Some(SnapshotSourceKind::RemoteUrl) => remote_result,
        None => None,
    };
    let active = selected_success.map(|success| {
        let received_unix = unix_time_now();
        let correlation =
            correlate_loaded_incidents(fallback_incidents, &success.snapshot, received_unix);
        ActiveSnapshot {
            source: success.kind,
            detail: success.detail,
            revision: snapshot_revision(&success.snapshot),
            incidents: correlation.incidents,
            correlation_stats: correlation.stats,
            snapshot: success.snapshot,
            received_unix,
        }
    });
    let _ = messages.send(RefreshMessage::Completed(Box::new(RefreshReport {
        cycle,
        active,
        attempts,
        completed_unix: unix_time_now(),
    })));
}

pub fn spawn_refresh_worker(
    config: RefreshConfig,
    fallback_incidents: Vec<Incident>,
) -> Option<(Sender<RefreshCommand>, Receiver<RefreshMessage>)> {
    if config.local_path.is_none() && config.remote_url.is_none() {
        return None;
    }
    let (command_tx, command_rx) = std::sync::mpsc::channel::<RefreshCommand>();
    let (message_tx, message_rx) = std::sync::mpsc::channel::<RefreshMessage>();
    std::thread::Builder::new()
        .name("godseye-snapshot-refresh".to_string())
        .spawn(move || {
            let agent_config = ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(18)))
                .https_only(true)
                .build();
            let agent = ureq::Agent::new_with_config(agent_config);
            let mut cycle = 1u64;
            run_cycle(cycle, &config, &agent, &fallback_incidents, &message_tx);
            loop {
                match command_rx.recv_timeout(config.interval) {
                    Ok(RefreshCommand::Now) => {
                        cycle += 1;
                        run_cycle(cycle, &config, &agent, &fallback_incidents, &message_tx);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        cycle += 1;
                        run_cycle(cycle, &config, &agent, &fallback_incidents, &message_tx);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        })
        .ok()?;
    Some((command_tx, message_rx))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deployed_snapshot_url_is_github_pages_contract_location() {
        assert!(DEFAULT_SNAPSHOT_URL.starts_with("https://"));
        assert!(DEFAULT_SNAPSHOT_URL.ends_with("/crisis-averted/data/osint-snapshot.json"));
    }

    #[test]
    fn refresh_interval_has_safety_floor_documented() {
        assert!(MIN_REFRESH_SECONDS >= 30);
        assert!(DEFAULT_REFRESH_SECONDS >= MIN_REFRESH_SECONDS);
    }

    #[test]
    fn canonical_snapshot_url_maps_to_domain_manifest_cursor() {
        let manifest =
            manifest_url_for_snapshot(DEFAULT_SNAPSHOT_URL).expect("canonical URL should map");
        assert_eq!(
            manifest,
            "https://godlydonuts.github.io/crisis-averted/data/osint/manifest.json"
        );
    }

    #[test]
    fn committed_domain_chunks_reassemble_to_native_snapshot_contract() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let monolith_path = root.join("frontend/public/data/osint-snapshot.json");
        let success =
            load_local(&monolith_path).expect("committed chunked publication should load");
        assert!(
            success.detail.contains("verified domain chunks"),
            "unexpected detail: {}",
            success.detail
        );
        assert_eq!(success.snapshot.map_events.len(), 1555);
        assert_eq!(success.snapshot.internet_outages.len(), 191);
        assert_eq!(success.snapshot.gdelt_geo_news.len(), 600);
        let legacy_text = std::fs::read_to_string(&monolith_path).expect("monolith readable");
        let legacy = parse_osint_snapshot(&legacy_text).expect("compatibility monolith parses");
        assert_eq!(
            snapshot_revision(&success.snapshot),
            snapshot_revision(&legacy)
        );
    }

    #[test]
    fn tampered_domain_chunk_is_rejected_before_projection() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let osint_dir = root.join("frontend/public/data/osint");
        let manifest_text =
            std::fs::read_to_string(osint_dir.join("manifest.json")).expect("manifest readable");
        let manifest = parse_chunked_manifest(&manifest_text).expect("manifest valid");
        let mut texts = manifest
            .chunks
            .iter()
            .map(|chunk| {
                std::fs::read_to_string(osint_dir.join(&chunk.relative_path))
                    .expect("chunk readable")
            })
            .collect::<Vec<_>>();
        texts[0].push(' ');
        let error = assemble_chunked_snapshot(&manifest, &texts).expect_err("byte drift must fail");
        assert!(
            error.contains("byte-count drift"),
            "unexpected error: {}",
            error
        );
        let missing = assemble_chunked_snapshot(&manifest, &texts[..texts.len() - 1])
            .expect_err("incomplete chunks must fail");
        assert!(
            missing.contains("chunk bodies supplied"),
            "unexpected error: {}",
            missing
        );
    }

    #[test]
    #[ignore = "network smoke test for the deployed GitHub Pages snapshot"]
    fn deployed_remote_snapshot_loads_and_has_core_layers() {
        let agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(30)))
                .https_only(true)
                .build(),
        );
        let success =
            load_remote(&agent, DEFAULT_SNAPSHOT_URL).expect("deployed snapshot should load");
        assert!(success.bytes > 1_000_000);
        assert!(!success.snapshot.military_aircraft.is_empty());
        assert!(!success.snapshot.internet_outages.is_empty());
        assert!(!success.snapshot.gdelt_geo_news.is_empty());
    }
}
