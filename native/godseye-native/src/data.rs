use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ConflictFallback {
    events: Vec<WarEvent>,
}

#[derive(Debug, Deserialize)]
struct WarEvent {
    #[serde(rename = "la")]
    lat: f32,
    #[serde(rename = "lo")]
    lng: f32,
    #[serde(rename = "s", default)]
    severity: Option<String>,
    #[serde(rename = "c", default)]
    category: Option<String>,
    #[serde(rename = "ti", default)]
    title: Option<String>,
    #[serde(rename = "n", default)]
    country: Option<String>,
    #[serde(rename = "cf", default)]
    conflict: Option<String>,
    #[serde(rename = "x", default)]
    casualties: Option<f32>,
    #[serde(rename = "et", default)]
    occurred_at: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct OsintSnapshot {
    #[serde(rename = "militaryAircraft", default)]
    pub aircraft: Vec<Aircraft>,
    #[serde(rename = "naturalEvents", default)]
    pub natural_events: Vec<NaturalEvent>,
    #[serde(rename = "mapOfWarsEvents", default)]
    map_events: Vec<MapEvent>,
}

#[derive(Debug, Deserialize)]
pub struct Aircraft {
    pub lat: f32,
    pub lng: f32,
    #[serde(default)]
    pub callsign: Option<String>,
    #[serde(default)]
    pub track: Option<f32>,
    #[serde(default)]
    pub speed: Option<f32>,
    #[serde(default)]
    pub altitude: Option<f32>,
}

#[derive(Debug, Deserialize)]
pub struct NaturalEvent {
    pub lat: f32,
    pub lng: f32,
    pub title: String,
    pub category: String,
}

#[derive(Debug, Deserialize)]
struct MapEvent {
    kind: Option<String>,
    lat: Option<f32>,
    lon: Option<f32>,
    title: Option<String>,
    detail: Option<String>,
    level: Option<u8>,
    ts: Option<f64>,
    note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Incident {
    pub lat: f32,
    pub lng: f32,
    pub severity: String,
    pub category: String,
    pub title: String,
    pub country: String,
    pub conflict: String,
    pub casualties: f32,
    pub occurred_at: f64,
}

fn map_casualties(detail: Option<&str>) -> f32 {
    detail
        .and_then(|value| value.split(['•', '�']).nth(1))
        .and_then(|value| value.trim().parse::<f32>().ok())
        .unwrap_or(0.0)
}

fn map_country(title: Option<&str>) -> String {
    title
        .and_then(|value| value.rsplit(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Unknown")
        .to_string()
}

pub fn load_embedded() -> (Vec<Incident>, OsintSnapshot) {
    let fallback: ConflictFallback = serde_json::from_str(include_str!(
        "../../../frontend/public/data/conflict-fallback.json"
    ))
    .expect("valid conflict fallback snapshot");
    let osint: OsintSnapshot = serde_json::from_str(include_str!(
        "../../../frontend/public/data/osint-snapshot.json"
    ))
    .expect("valid osint snapshot");

    let mut incidents = Vec::with_capacity(fallback.events.len() + osint.map_events.len());
    for event in fallback.events {
        incidents.push(Incident {
            lat: event.lat,
            lng: event.lng,
            severity: event.severity.unwrap_or_else(|| "l".to_string()),
            category: event.category.unwrap_or_else(|| "other".to_string()),
            title: event
                .title
                .unwrap_or_else(|| "Untitled incident".to_string()),
            country: event.country.unwrap_or_else(|| "Unknown".to_string()),
            conflict: event
                .conflict
                .unwrap_or_else(|| "Unresolved conflict".to_string()),
            casualties: event.casualties.unwrap_or(0.0),
            occurred_at: event.occurred_at.unwrap_or(0.0),
        });
    }

    for event in &osint.map_events {
        let (Some(lat), Some(lng), Some(ts)) = (event.lat, event.lon, event.ts) else {
            continue;
        };
        let kind = event.kind.as_deref().unwrap_or("");
        if !matches!(kind, "battle" | "ship" | "outage" | "activation" | "launch") {
            continue;
        }
        let casualties = map_casualties(event.detail.as_deref());
        let country = map_country(event.title.as_deref());
        let severity = if kind == "battle" {
            if casualties >= 25.0 {
                "c"
            } else if casualties >= 5.0 || event.level.unwrap_or(1) >= 3 {
                "h"
            } else if casualties > 0.0 {
                "m"
            } else {
                "l"
            }
        } else if matches!(kind, "outage" | "activation") {
            "m"
        } else {
            "l"
        };
        let category = match kind {
            "battle" => "ground_battle",
            "ship" => "naval",
            "outage" => "cyber",
            "launch" => "missile",
            _ => "infrastructure",
        };
        let conflict = match kind {
            "battle" => format!("{} conflict", country),
            "ship" => "Naval vessel activity".to_string(),
            "outage" => "Infrastructure and cyber disruption".to_string(),
            "launch" => "Strategic launch activity".to_string(),
            _ => "Strategic infrastructure activity".to_string(),
        };
        incidents.push(Incident {
            lat,
            lng,
            severity: severity.to_string(),
            category: category.to_string(),
            title: event
                .note
                .clone()
                .or_else(|| event.title.clone())
                .unwrap_or_else(|| "Unnamed contact".to_string()),
            country,
            conflict,
            casualties,
            occurred_at: ts,
        });
    }
    incidents.sort_by(|a, b| {
        b.occurred_at
            .partial_cmp(&a.occurred_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    (incidents, osint)
}
