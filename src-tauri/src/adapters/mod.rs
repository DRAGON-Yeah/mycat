pub mod mysql_adapter;
pub mod postgres_adapter;
pub mod sqlite;

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectOpts {
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_trust: Option<bool>,
    #[serde(default)]
    pub ssh_enabled: Option<bool>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<i64>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbObject {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub table_rows: Option<i64>,
    #[serde(default)]
    pub data_length: Option<i64>,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub create_time: Option<String>,
    #[serde(default)]
    pub update_time: Option<String>,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsPage {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Value>>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutcome {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: i64,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowChange {
    /// update | insert | delete
    pub op: String,
    pub pk_columns: Vec<String>,
    pub pk_values: Vec<Value>,
    pub columns: Vec<String>,
    pub values: Vec<Value>,
}

pub trait DriverSession: Send {
    fn list_databases(&self) -> AppResult<Vec<String>>;
    fn list_schemas(&self, database: Option<&str>) -> AppResult<Vec<String>>;
    fn list_tables(&self, database: Option<&str>, schema: Option<&str>) -> AppResult<Vec<DbObject>>;
    fn query_page(
        &self,
        database: Option<&str>,
        table: &str,
        page: i64,
        page_size: i64,
        sort_col: Option<&str>,
        sort_dir: Option<&str>,
        filter_col: Option<&str>,
        filter_value: Option<&str>,
    ) -> AppResult<RowsPage>;
    fn execute_sql(&self, sql: &str) -> AppResult<QueryOutcome>;
    /// Select schema/database for subsequent unqualified SQL (MySQL USE / PG search_path).
    fn use_database(&self, _database: Option<&str>) -> AppResult<()> {
        Ok(())
    }
    fn apply_row_changes(
        &self,
        database: Option<&str>,
        table: &str,
        changes: &[RowChange],
    ) -> AppResult<i64>;
    /// Server-side backend/connection id used by cancel (MySQL CONNECTION_ID / PG pid).
    fn backend_pid(&self) -> AppResult<Option<i64>> {
        Ok(None)
    }
    /// Cheap liveness probe; used before reusing a pooled session.
    fn ping(&self) -> AppResult<()> {
        Ok(())
    }
    /// Engine-native DDL for a table or view (SHOW CREATE TABLE / pg catalogs).
    fn table_ddl(&self, _database: Option<&str>, _table: &str) -> AppResult<String> {
        Err(crate::error::AppError::Message(
            "当前引擎不支持导出 DDL".into(),
        ))
    }
    /// SQLite InterruptHandle for cross-thread cancel (None for other engines).
    fn sqlite_interrupt_handle(&self) -> Option<rusqlite::InterruptHandle> {
        None
    }
}

pub fn connect(opts: &ConnectOpts) -> AppResult<Box<dyn DriverSession>> {
    match opts.engine.as_str() {
        "sqlite" => Ok(Box::new(sqlite::SqliteSession::connect(opts)?)),
        "mysql" => Ok(Box::new(mysql_adapter::MysqlSession::connect(opts)?)),
        "postgres" => Ok(Box::new(postgres_adapter::PostgresSession::connect(opts)?)),
        other => Err(crate::error::AppError::Validation(format!(
            "引擎尚未实现: {other}"
        ))),
    }
}
