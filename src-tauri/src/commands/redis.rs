use crate::adapters::redis_adapter::{
    parse_db_index, RedisKeyPage, RedisKeyValue, RedisReply,
};
use crate::session::SessionPool;
use tauri::State;

fn db_index(db: Option<String>) -> Result<Option<i64>, String> {
    db.map(|value| parse_db_index(Some(&value)))
        .transpose()
        .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_list_databases(
    pool: State<'_, SessionPool>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    pool.with_redis(&connection_id, |session| session.list_databases())
        .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_scan_keys(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    pattern: String,
    cursor: u64,
    count: Option<u32>,
) -> Result<RedisKeyPage, String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| {
        session.scan_keys(db, &pattern, cursor, count.unwrap_or(200))
    })
    .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_key_detail(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    key: String,
) -> Result<RedisKeyValue, String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| session.key_detail(db, &key))
        .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_set_string(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    key: String,
    value: String,
    ttl: Option<i64>,
) -> Result<(), String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| {
        session.set_string(db, &key, &value, ttl)
    })
    .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_hash_set(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    key: String,
    field: String,
    value: String,
) -> Result<(), String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| {
        session.hash_set(db, &key, &field, &value)
    })
    .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_hash_delete(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    key: String,
    fields: Vec<String>,
) -> Result<i64, String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| {
        session.hash_delete(db, &key, &fields)
    })
    .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_delete_keys(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    keys: Vec<String>,
) -> Result<i64, String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| {
        session.delete_keys(db, &keys)
    })
    .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_expire(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    key: String,
    ttl_secs: Option<i64>,
) -> Result<bool, String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| {
        session.expire(db, &key, ttl_secs)
    })
    .map_err(|err| err.to_string())
}

#[tauri::command(async)]
pub fn redis_execute(
    pool: State<'_, SessionPool>,
    connection_id: String,
    db: Option<String>,
    command: String,
) -> Result<RedisReply, String> {
    let db = db_index(db)?;
    pool.with_redis(&connection_id, |session| session.execute(db, &command))
        .map_err(|err| err.to_string())
}
