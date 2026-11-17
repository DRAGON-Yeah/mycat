use crate::meta::{MetaDb, SavedQueryRecord};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueryDto {
    pub id: String,
    pub connection_id: String,
    pub database: Option<String>,
    pub name: String,
    pub sql: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSavedQueryInput {
    pub id: Option<String>,
    pub connection_id: String,
    pub database: Option<String>,
    pub name: String,
    pub sql: String,
}

fn to_dto(r: SavedQueryRecord) -> SavedQueryDto {
    SavedQueryDto {
        id: r.id,
        connection_id: r.connection_id,
        database: r.database,
        name: r.name,
        sql: r.sql_text,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

#[tauri::command(async)]
pub fn list_saved_queries(
    state: State<'_, MetaDb>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<SavedQueryDto>, String> {
    let rows = state
        .list_saved_queries(&connection_id, database.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(to_dto).collect())
}

#[tauri::command(async)]
pub fn upsert_saved_query(
    state: State<'_, MetaDb>,
    input: UpsertSavedQueryInput,
) -> Result<SavedQueryDto, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("查询名称不能为空".into());
    }
    let now = now_iso();
    let id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let existing = state.get_saved_query(&id).map_err(|e| e.to_string())?;
    let created_at = existing
        .as_ref()
        .map(|e| e.created_at.clone())
        .unwrap_or_else(|| now.clone());

    let record = SavedQueryRecord {
        id: id.clone(),
        connection_id: input.connection_id,
        database: input
            .database
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        name,
        sql_text: input.sql,
        created_at,
        updated_at: now,
    };
    state
        .upsert_saved_query(&record)
        .map_err(|e| e.to_string())?;
    Ok(to_dto(record))
}

#[tauri::command(async)]
pub fn delete_saved_query(state: State<'_, MetaDb>, id: String) -> Result<(), String> {
    state.delete_saved_query(&id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn get_saved_query(
    state: State<'_, MetaDb>,
    id: String,
) -> Result<Option<SavedQueryDto>, String> {
    let row = state.get_saved_query(&id).map_err(|e| e.to_string())?;
    Ok(row.map(to_dto))
}
