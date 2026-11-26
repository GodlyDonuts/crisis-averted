use crate::data::{parse_osint_snapshot, snapshot_revision, unix_time_now, OsintSnapshot};
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

fn load_local(path: &PathBuf) -> Result<LoadSuccess, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("unable to read {}: {}", path.display(), error))?;
    let snapshot = parse_osint_snapshot(&text).map_err(|error| {
        format!(
            "invalid OSINT snapshot JSON in {}: {}",
            path.display(),
            error
        )
    })?;
    Ok(LoadSuccess {
        kind: SnapshotSourceKind::LocalFile,
        detail: path.display().to_string(),
        snapshot,
        bytes: text.len(),
    })
}

fn load_remote(agent: &ureq::Agent, url: &str) -> Result<LoadSuccess, String> {
    let mut response = agent
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", "godseye-native/0.1 snapshot-refresh")
        .call()
        .map_err(|error| format!("remote snapshot request failed: {}", error))?;
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("unable to read remote snapshot body: {}", error))?;
    let snapshot = parse_osint_snapshot(&text)
        .map_err(|error| format!("invalid remote OSINT snapshot JSON: {}", error))?;
    Ok(LoadSuccess {
        kind: SnapshotSourceKind::RemoteUrl,
        detail: url.to_string(),
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
    let active = selected_success.map(|success| ActiveSnapshot {
        source: success.kind,
        detail: success.detail,
        revision: snapshot_revision(&success.snapshot),
        snapshot: success.snapshot,
        received_unix: unix_time_now(),
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
            run_cycle(cycle, &config, &agent, &message_tx);
            loop {
                match command_rx.recv_timeout(config.interval) {
                    Ok(RefreshCommand::Now) => {
                        cycle += 1;
                        run_cycle(cycle, &config, &agent, &message_tx);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        cycle += 1;
                        run_cycle(cycle, &config, &agent, &message_tx);
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
