use crate::adapters::{ConnectOpts, DbObject, QueryOutcome, RowChange, RowsPage};
use crate::meta::MetaDb;
use crate::session::{opts_from_connection, SessionPool};
use serde::Serialize;
use tauri::State;

#[tauri::command(async)]
pub fn test_connection(opts: ConnectOpts) -> Result<(), String> {
    SessionPool::test_connect(&opts).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn open_connection(
    meta: State<'_, MetaDb>,
    pool: State<'_, SessionPool>,
    connection_id: String,
) -> Result<(), String> {
    let opts = opts_from_connection(&meta, &connection_id).map_err(|e| e.to_string())?;
    pool.open(&connection_id, opts).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn close_connection(pool: State<'_, SessionPool>, connection_id: String) -> Result<(), String> {
    pool.close(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn list_databases(
    pool: State<'_, SessionPool>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    pool.with_session(&connection_id, |s| s.list_databases())
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn list_schemas(
    pool: State<'_, SessionPool>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    pool.with_session(&connection_id, |s| s.list_schemas(database.as_deref()))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn cancel_query(pool: State<'_, SessionPool>, connection_id: String) -> Result<(), String> {
    pool.cancel_query(&connection_id).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStatementOutcome {
    pub ok: bool,
    pub rows_affected: i64,
    /// 逐条执行时才有单条耗时；多语句单包发送时无法按条计时
    pub elapsed_ms: Option<u128>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchOutcome {
    pub results: Vec<BatchStatementOutcome>,
    /// 提前结束（被取消，或遇到错误且未勾选“遇到错误时继续”）
    pub stopped: bool,
    pub cancelled: bool,
}

/// 多语句单包发送的字节上限，避免超过服务端 max_allowed_packet。
const MAX_PACKET_BYTES: usize = 1_000_000;

/// 批量执行 SQL 文件中的一段语句：一次 USE + 一次 IPC，
/// MySQL 走多语句协议（整包发给服务器），其它引擎退化为逐条。
#[tauri::command(async)]
pub fn execute_sql_batch(
    pool: State<'_, SessionPool>,
    connection_id: String,
    statements: Vec<String>,
    database: Option<String>,
    continue_on_error: bool,
) -> Result<BatchOutcome, String> {
    pool.begin_batch(&connection_id);
    pool.begin_query(&connection_id)
        .map_err(|e| e.to_string())?;

    let result = pool.with_session(&connection_id, |s| {
        s.use_database(database.as_deref())?;
        let mut results = Vec::with_capacity(statements.len());
        let mut stopped = false;
        let mut cancelled = false;

        // 非 MySQL：逐条执行（仍复用同一会话，只有一次 USE）
        if !s.supports_multi_statement() {
            for stmt in &statements {
                if pool.is_batch_cancelled(&connection_id) {
                    cancelled = true;
                    stopped = true;
                    break;
                }
                match s.execute_sql(stmt) {
                    Ok(outcome) => results.push(BatchStatementOutcome {
                        ok: true,
                        rows_affected: outcome.rows_affected,
                        elapsed_ms: Some(outcome.elapsed_ms),
                        error: None,
                    }),
                    Err(err) => {
                        results.push(BatchStatementOutcome {
                            ok: false,
                            rows_affected: 0,
                            elapsed_ms: None,
                            error: Some(err.to_string()),
                        });
                        if !continue_on_error {
                            stopped = true;
                            break;
                        }
                    }
                }
            }
            return Ok(BatchOutcome {
                results,
                stopped,
                cancelled,
            });
        }

        let mut index = 0usize;
        while index < statements.len() {
            if pool.is_batch_cancelled(&connection_id) {
                cancelled = true;
                stopped = true;
                break;
            }

            // 按字节切包：单条超限的语句单独成包
            let mut end = index;
            let mut bytes = 0usize;
            while end < statements.len() {
                let len = statements[end].len() + 2;
                if end > index && bytes + len > MAX_PACKET_BYTES {
                    break;
                }
                bytes += len;
                end += 1;
            }

            let joined = statements[index..end].join(";\n");
            let outcome = s.execute_sql_multi(&joined)?;

            for affected in &outcome.affected {
                results.push(BatchStatementOutcome {
                    ok: true,
                    rows_affected: *affected,
                    elapsed_ms: None,
                    error: None,
                });
            }

            match outcome.error {
                None => index = end,
                Some((failed_at, message)) => {
                    results.push(BatchStatementOutcome {
                        ok: false,
                        rows_affected: 0,
                        elapsed_ms: None,
                        error: Some(message),
                    });
                    // failed_at 之前的语句已执行成功，从失败语句的下一条继续
                    index += failed_at + 1;
                    if !continue_on_error {
                        stopped = true;
                        break;
                    }
                }
            }
        }

        Ok(BatchOutcome {
            results,
            stopped,
            cancelled,
        })
    });

    pool.end_query(&connection_id);
    pool.clear_batch(&connection_id);
    result.map_err(|e| e.to_string())
}

/// 请求停止批量执行：当前语句跑完后不再继续。
#[tauri::command(async)]
pub fn cancel_sql_batch(
    pool: State<'_, SessionPool>,
    connection_id: String,
) -> Result<(), String> {
    pool.cancel_batch(&connection_id);
    Ok(())
}

/// Engine-native DDL for a table or view (MySQL SHOW CREATE / PG catalogs).
#[tauri::command(async)]
pub fn get_table_ddl(
    pool: State<'_, SessionPool>,
    connection_id: String,
    table: String,
    database: Option<String>,
) -> Result<String, String> {
    pool.with_session(&connection_id, |s| {
        s.table_ddl(database.as_deref(), &table)
    })
    .map_err(|e| e.to_string())
}

#[tauri::command(async)]
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
