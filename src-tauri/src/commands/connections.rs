use crate::error::{AppError, AppResult};
use crate::meta::{ConnectionRecord, MetaDb};
use crate::vault;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertConnectionInput {
    pub id: Option<String>,
    pub name: String,
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_trust: Option<bool>,
    pub ssh_enabled: Option<bool>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub color: Option<String>,
    pub starred: Option<bool>,
    pub group_name: Option<String>,
    pub hidden: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDto {
    #[serde(flatten)]
    pub record: ConnectionRecord,
    pub has_password: bool,
}

fn now_iso() -> String {
    // Keep dependency-light; sufficient for Phase 0 metadata.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn validate(input: &UpsertConnectionInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("显示名不能为空".into()));
    }
    match input.engine.as_str() {
        "mysql" | "postgres" | "sqlite" => {}
        other => {
            return Err(AppError::Validation(format!("不支持的引擎: {other}")));
        }
    }
    if input.engine == "sqlite" {
        if input.host.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            return Err(AppError::Validation("SQLite 需要文件路径".into()));
        }
    } else {
        if input.host.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            return Err(AppError::Validation("主机不能为空".into()));
        }
        match input.port {
            Some(p) if (1..=65535).contains(&p) => {}
            Some(_) => return Err(AppError::Validation("端口非法，应在 1–65535".into())),
            None => return Err(AppError::Validation("端口不能为空".into())),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_connections(state: State<'_, MetaDb>) -> Result<Vec<ConnectionDto>, String> {
    let rows = state.list_connections().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for record in rows {
        let has_password = record
            .secret_ref
            .as_ref()
            .map(|r| vault::get_secret(r).ok().flatten().is_some())
            .unwrap_or(false);
        out.push(ConnectionDto {
            record,
            has_password,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn upsert_connection(
    state: State<'_, MetaDb>,
    input: UpsertConnectionInput,
) -> Result<ConnectionDto, String> {
    validate(&input).map_err(|e| e.to_string())?;

    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let existing = state.get_connection(&id).map_err(|e| e.to_string())?;
    let created_at = existing
        .as_ref()
        .map(|c| c.created_at.clone())
        .unwrap_or_else(now_iso);
    let secret_ref = existing
        .as_ref()
        .and_then(|c| c.secret_ref.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if let Some(password) = input.password.as_ref().filter(|p| !p.is_empty()) {
        vault::set_secret(&secret_ref, password).map_err(|e| e.to_string())?;
    }

    if let Some(ssh_password) = input.ssh_password.as_ref().filter(|p| !p.is_empty()) {
        let ssh_ref = format!("{secret_ref}:ssh");
        vault::set_secret(&ssh_ref, ssh_password).map_err(|e| e.to_string())?;
    }

    let record = ConnectionRecord {
        id: id.clone(),
        name: input.name.trim().to_string(),
        engine: input.engine,
        host: input.host.map(|s| s.trim().to_string()),
        port: input.port,
        database: input.database,
        user: input.user,
        ssl_mode: input.ssl_mode.unwrap_or_else(|| "disable".into()),
        ssl_trust: input.ssl_trust.unwrap_or(false),
        ssh_enabled: input.ssh_enabled.unwrap_or(false),
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user,
        color: input.color,
        starred: input.starred.unwrap_or(false),
        group_name: input.group_name,
        hidden: input.hidden.unwrap_or(false),
        secret_ref: Some(secret_ref.clone()),
        created_at,
        updated_at: now_iso(),
    };

    state.upsert_connection(&record).map_err(|e| e.to_string())?;
    let has_password = vault::get_secret(&secret_ref)
        .ok()
        .flatten()
        .is_some();
    Ok(ConnectionDto {
        record,
        has_password,
    })
}

#[tauri::command]
pub fn delete_connection(state: State<'_, MetaDb>, id: String) -> Result<(), String> {
    if let Some(existing) = state.get_connection(&id).map_err(|e| e.to_string())? {
        if let Some(secret_ref) = existing.secret_ref {
            let _ = vault::delete_secret(&secret_ref);
            let _ = vault::delete_secret(&format!("{secret_ref}:ssh"));
        }
    }
    state.delete_connection(&id).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionExportItem {
    pub name: String,
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub ssl_mode: String,
    #[serde(default)]
    pub ssl_trust: bool,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub color: Option<String>,
    pub starred: bool,
    pub group_name: Option<String>,
    pub hidden: bool,
    /// Always omitted / null in export — never plaintext password.
    pub password: Option<String>,
}

#[tauri::command]
pub fn export_connections(state: State<'_, MetaDb>) -> Result<Vec<ConnectionExportItem>, String> {
    let rows = state.list_connections().map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| ConnectionExportItem {
            name: r.name,
            engine: r.engine,
            host: r.host,
            port: r.port,
            database: r.database,
            user: r.user,
            ssl_mode: r.ssl_mode,
            ssl_trust: r.ssl_trust,
            ssh_enabled: r.ssh_enabled,
            ssh_host: r.ssh_host,
            ssh_port: r.ssh_port,
            ssh_user: r.ssh_user,
            color: r.color,
            starred: r.starred,
            group_name: r.group_name,
            hidden: r.hidden,
            password: None,
        })
        .collect())
}

#[tauri::command]
pub fn import_connections(
    state: State<'_, MetaDb>,
    items: Vec<ConnectionExportItem>,
) -> Result<usize, String> {
    let mut count = 0usize;
    for item in items {
        let input = UpsertConnectionInput {
            id: None,
            name: item.name,
            engine: item.engine,
            host: item.host,
            port: item.port,
            database: item.database,
            user: item.user,
            password: None,
            ssl_mode: Some(item.ssl_mode),
            ssl_trust: Some(item.ssl_trust),
            ssh_enabled: Some(item.ssh_enabled),
            ssh_host: item.ssh_host,
            ssh_port: item.ssh_port,
            ssh_user: item.ssh_user,
            ssh_password: None,
            color: item.color,
            starred: Some(item.starred),
            group_name: item.group_name,
            hidden: Some(item.hidden),
        };
        // Reuse validation + persistence path without re-entering command wrapper.
        validate(&input).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_iso();
        let record = ConnectionRecord {
            id,
            name: input.name.trim().to_string(),
            engine: input.engine,
            host: input.host.map(|s| s.trim().to_string()),
            port: input.port,
            database: input.database,
            user: input.user,
            ssl_mode: input.ssl_mode.unwrap_or_else(|| "disable".into()),
            ssl_trust: input.ssl_trust.unwrap_or(false),
            ssh_enabled: input.ssh_enabled.unwrap_or(false),
            ssh_host: input.ssh_host,
            ssh_port: input.ssh_port,
            ssh_user: input.ssh_user,
            color: input.color,
            starred: input.starred.unwrap_or(false),
            group_name: input.group_name,
            hidden: input.hidden.unwrap_or(false),
            secret_ref: None,
            created_at: now.clone(),
            updated_at: now,
        };
        state.upsert_connection(&record).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str, port: i64) -> UpsertConnectionInput {
        UpsertConnectionInput {
            id: None,
            name: name.into(),
            engine: "mysql".into(),
            host: Some("127.0.0.1".into()),
            port: Some(port),
            database: None,
            user: None,
            password: None,
            ssl_mode: None,
            ssl_trust: None,
            ssh_enabled: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            color: None,
            starred: None,
            group_name: None,
            hidden: None,
        }
    }

    #[test]
    fn rejects_empty_name_and_bad_port() {
        assert!(validate(&sample("  ", 3306)).is_err());
        let err = validate(&sample("demo", 99999)).unwrap_err().to_string();
        assert!(err.contains("端口"));
    }

    #[test]
    fn export_item_password_field_is_none() {
        let item = ConnectionExportItem {
            name: "x".into(),
            engine: "mysql".into(),
            host: Some("h".into()),
            port: Some(3306),
            database: None,
            user: Some("u".into()),
            ssl_mode: "disable".into(),
            ssl_trust: false,
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            color: Some("#f00".into()),
            starred: true,
            group_name: Some("dev".into()),
            hidden: false,
            password: None,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"password\":null") || !json.contains("S3cret"));
        assert!(!json.contains("PlainTextPassword"));
    }
}
