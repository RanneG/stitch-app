use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DateRangePayload {
    start: String,
    end: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TripContextPayload {
    destination_label: String,
    date_range: DateRangePayload,
    image_url: Option<String>,
    tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionPayload {
    id: String,
    title: String,
    created_at: String,
    trip_context: TripContextPayload,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MessagePayload {
    id: String,
    session_id: String,
    role: MessageRole,
    content: Vec<serde_json::Value>,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSessionPayload {
    session: SessionPayload,
    messages: Vec<MessagePayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSessionFile {
    session: SessionPayload,
    messages: Vec<MessagePayload>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct SessionListItem {
    id: String,
    title: String,
    updated_at: String,
}

fn now_iso_like() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.to_string()
}

fn sanitize_session_id(session_id: &str) -> String {
    let sanitized: String = session_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "session".to_string()
    } else {
        sanitized
    }
}

fn validate_iso_date(input: &str, field_name: &str) -> Result<(), String> {
    if input.len() != 10 {
        return Err(format!("{field_name} must use YYYY-MM-DD format"));
    }
    let bytes = input.as_bytes();
    for (idx, byte) in bytes.iter().enumerate() {
        let is_dash = idx == 4 || idx == 7;
        if (is_dash && *byte != b'-') || (!is_dash && !byte.is_ascii_digit()) {
            return Err(format!("{field_name} must use YYYY-MM-DD format"));
        }
    }
    Ok(())
}

fn validate_session_payload(payload: &SaveSessionPayload) -> Result<(), String> {
    if payload.session.id.trim().is_empty() {
        return Err("session.id is required".to_string());
    }
    if payload.session.title.trim().is_empty() {
        return Err("session.title is required".to_string());
    }
    if payload.session.created_at.trim().is_empty() {
        return Err("session.createdAt is required".to_string());
    }
    if payload.session.trip_context.destination_label.trim().is_empty() {
        return Err("session.tripContext.destinationLabel is required".to_string());
    }
    validate_iso_date(
        &payload.session.trip_context.date_range.start,
        "session.tripContext.dateRange.start",
    )?;
    validate_iso_date(
        &payload.session.trip_context.date_range.end,
        "session.tripContext.dateRange.end",
    )?;

    for (index, message) in payload.messages.iter().enumerate() {
        if message.id.trim().is_empty() {
            return Err(format!("messages[{index}].id is required"));
        }
        if message.session_id.trim().is_empty() {
            return Err(format!("messages[{index}].sessionId is required"));
        }
        if message.created_at.trim().is_empty() {
            return Err(format!("messages[{index}].createdAt is required"));
        }
        if message.content.is_empty() {
            return Err(format!("messages[{index}].content must contain at least one block"));
        }
    }

    Ok(())
}

fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    path.push("sessions");
    fs::create_dir_all(&path).map_err(|err| format!("failed to create sessions directory: {err}"))?;
    Ok(path)
}

fn session_file_path(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let mut path = sessions_dir(app)?;
    path.push(format!("{}.json", sanitize_session_id(session_id)));
    Ok(path)
}

#[tauri::command]
fn save_session(app: AppHandle, payload: SaveSessionPayload) -> Result<(), String> {
    validate_session_payload(&payload)?;
    let session_id = payload.session.id.clone();
    let record = StoredSessionFile {
        session: payload.session,
        messages: payload.messages,
        updated_at: now_iso_like(),
    };
    let file_path = session_file_path(&app, &session_id)?;
    let encoded = serde_json::to_string_pretty(&record)
        .map_err(|err| format!("failed to encode session JSON: {err}"))?;
    fs::write(&file_path, encoded).map_err(|err| format!("failed to write session file: {err}"))?;
    Ok(())
}

#[tauri::command]
fn load_session(app: AppHandle, session_id: String) -> Result<Value, String> {
    let file_path = session_file_path(&app, &session_id)?;
    let raw = fs::read_to_string(&file_path).map_err(|err| format!("failed to read session file: {err}"))?;
    let record: StoredSessionFile =
        serde_json::from_str(&raw).map_err(|err| format!("failed to decode session file: {err}"))?;
    Ok(json!({
      "session": record.session,
      "messages": record.messages,
    }))
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> Result<Vec<SessionListItem>, String> {
    let path = sessions_dir(&app)?;
    let mut sessions = Vec::new();
    let entries = fs::read_dir(path).map_err(|err| format!("failed to list sessions directory: {err}"))?;

    for entry in entries.flatten() {
        let file_path = entry.path();
        if file_path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&file_path) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<StoredSessionFile>(&raw) else {
            continue;
        };
        let id = if record.session.id.trim().is_empty() {
            file_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "session".to_string())
        } else {
            record.session.id.clone()
        };
        sessions.push(SessionListItem {
            id,
            title: if record.session.title.trim().is_empty() {
                "Untitled Session".to_string()
            } else {
                record.session.title.clone()
            },
            updated_at: record.updated_at,
        });
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_session,
            load_session,
            list_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
