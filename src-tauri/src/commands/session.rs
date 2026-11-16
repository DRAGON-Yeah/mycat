use crate::adapters::{ConnectOpts, DbObject, QueryOutcome, RowChange, RowsPage};
use crate::meta::MetaDb;
use crate::session::{opts_from_connection, SessionPool};
use tauri::State;

#[tauri::command]
pub fn test_connection(opts: ConnectOpts) -> Result<(), String> {
    SessionPool::test_connect(&opts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_connection(
    meta: State<'_, MetaDb>,
    pool: State<'_, SessionPool>,
    connection_id: String,
) -> Result<(), String> {
    let opts = opts_from_connection(&meta, &connection_id).map_err(|e| e.to_string())?;
    pool.open(&connection_id, opts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_connection(pool: State<'_, SessionPool>, connection_id: String) -> Result<(), String> {
    pool.close(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_databases(
    pool: State<'_, SessionPool>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    pool.with_session(&connection_id, |s| s.list_databases())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_schemas(
    pool: State<'_, SessionPool>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    pool.with_session(&connection_id, |s| s.list_schemas(database.as_deref()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tables(
    meta: State<'_, MetaDb>,
    pool: State<'_, SessionPool>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<DbObject>, String> {
    let database = match database.filter(|d| !d.trim().is_empty()) {
        Some(db) => Some(db),
        None => opts_from_connection(&meta, &connection_id)
            .map_err(|e| e.to_string())?
            .database,
    };
    pool.with_session(&connection_id, |s| s.list_tables(database.as_deref(), None))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_table_page(
    pool: State<'_, SessionPool>,
    connection_id: String,
    table: String,
    page: i64,
    page_size: i64,
    sort_col: Option<String>,
    sort_dir: Option<String>,
    filter_col: Option<String>,
    filter_value: Option<String>,
    database: Option<String>,
) -> Result<RowsPage, String> {
    pool.with_session(&connection_id, |s| {
        s.query_page(
            database.as_deref(),
            &table,
            page,
            page_size,
            sort_col.as_deref(),
            sort_dir.as_deref(),
            filter_col.as_deref(),
            filter_value.as_deref(),
        )
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn execute_sql(
    pool: State<'_, SessionPool>,
    connection_id: String,
    sql: String,
    database: Option<String>,
) -> Result<QueryOutcome, String> {
    pool.begin_query(&connection_id)
        .map_err(|e| e.to_string())?;
    let result = pool.with_session(&connection_id, |s| {
        s.use_database(database.as_deref())?;
        s.execute_sql(&sql)
    });
    pool.end_query(&connection_id);
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_query(pool: State<'_, SessionPool>, connection_id: String) -> Result<(), String> {
    pool.cancel_query(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_row_changes(
    pool: State<'_, SessionPool>,
    connection_id: String,
    table: String,
    changes: Vec<RowChange>,
    database: Option<String>,
) -> Result<i64, String> {
    pool.with_session(&connection_id, |s| {
        s.apply_row_changes(database.as_deref(), &table, &changes)
    })
    .map_err(|e| e.to_string())
}
