use super::{
    ColumnMeta, ConnectOpts, DbObject, DriverSession, QueryOutcome, RowChange, RowsPage,
};
use crate::error::{AppError, AppResult};
use native_tls::TlsConnector;
use postgres::types::Type;
use postgres::{Client, NoTls, Row};
use postgres_native_tls::MakeTlsConnector;
use serde_json::{Number, Value};
use std::sync::Mutex;
use std::time::Instant;

pub struct PostgresSession {
    client: Mutex<Client>,
}

fn build_config(opts: &ConnectOpts, sslmode: &str) -> AppResult<String> {
    let host = opts
        .host
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("PostgreSQL 主机不能为空".into()))?;
    let port = opts.port.unwrap_or(5432);
    let user = opts.user.clone().unwrap_or_else(|| "postgres".into());
    let password = opts.password.clone().unwrap_or_default();
    let dbname = opts.database.clone().unwrap_or_else(|| "postgres".into());
    Ok(format!(
        "host={host} port={port} user={user} password={password} dbname={dbname} sslmode={sslmode}"
    ))
}

impl PostgresSession {
    pub fn connect(opts: &ConnectOpts) -> AppResult<Self> {
        let mode = opts.ssl_mode.as_deref().unwrap_or("disable");
        let client = if mode.eq_ignore_ascii_case("require") {
            let trust = opts.ssl_trust.unwrap_or(false);
            let tls = TlsConnector::builder()
                .danger_accept_invalid_certs(trust)
                .danger_accept_invalid_hostnames(trust)
                .build()
                .map_err(|e| AppError::Driver(e.to_string()))?;
            let connector = MakeTlsConnector::new(tls);
            // Prefer require; local servers without SSL will error clearly.
            Client::connect(&build_config(opts, "require")?, connector)?
        } else {
            Client::connect(&build_config(opts, "disable")?, NoTls)?
        };
        Ok(Self {
            client: Mutex::new(client),
        })
    }
}

fn ident_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn pg_cell_to_json(row: &Row, idx: usize) -> Value {
    let col = &row.columns()[idx];
    match *col.type_() {
        Type::BOOL => row
            .try_get::<_, bool>(idx)
            .ok()
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        Type::INT2 | Type::INT4 => row
            .try_get::<_, i32>(idx)
            .ok()
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        Type::INT8 => row
            .try_get::<_, i64>(idx)
            .ok()
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        Type::FLOAT4 | Type::FLOAT8 => row
            .try_get::<_, f64>(idx)
            .ok()
            .and_then(|v| Number::from_f64(v).map(Value::Number))
            .unwrap_or(Value::Null),
        Type::NUMERIC => row
            .try_get::<_, String>(idx)
            .ok()
            .map(Value::String)
            .unwrap_or(Value::Null),
        _ => row
            .try_get::<_, String>(idx)
            .ok()
            .map(Value::String)
            .or_else(|| {
                row.try_get::<_, Vec<u8>>(idx)
                    .ok()
                    .map(|b| Value::String(format!("\\x{}", hex::encode(b))))
            })
            .unwrap_or(Value::Null),
    }
}

impl DriverSession for PostgresSession {
    fn list_databases(&self) -> AppResult<Vec<String>> {
        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;
        let rows = client.query(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
            &[],
        )?;
        Ok(rows.iter().map(|r| r.get(0)).collect())
    }

    fn list_schemas(&self, _database: Option<&str>) -> AppResult<Vec<String>> {
        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;
        let rows = client.query(
            "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
            &[],
        )?;
        Ok(rows.iter().map(|r| r.get(0)).collect())
    }

    fn list_tables(&self, _database: Option<&str>, schema: Option<&str>) -> AppResult<Vec<DbObject>> {
        let schema = schema.unwrap_or("public");
        if !ident_ok(schema) {
            return Err(AppError::Validation("非法 schema".into()));
        }
        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;
        let rows = client.query(
            "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
            &[&schema],
        )?;
        Ok(rows
            .iter()
            .map(|r| {
                let name: String = r.get(0);
                let kind: String = r.get(1);
                DbObject {
                    name,
                    kind: if kind.to_uppercase().contains("VIEW") {
                        "view".into()
                    } else {
                        "table".into()
                    },
                    table_rows: None,
                    data_length: None,
                    engine: None,
                    create_time: None,
                    update_time: None,
                    collation: None,
                    comment: None,
                }
            })
            .collect())
    }

    fn query_page(
        &self,
        table: &str,
        page: i64,
        page_size: i64,
        sort_col: Option<&str>,
        sort_dir: Option<&str>,
        filter_col: Option<&str>,
        filter_value: Option<&str>,
    ) -> AppResult<RowsPage> {
        if !ident_ok(table) {
            return Err(AppError::Validation("非法表名".into()));
        }
        let page = page.max(1);
        let page_size = page_size.clamp(1, 1000);
        let offset = (page - 1) * page_size;

        let mut where_sql = String::new();
        let mut filter_param: Option<String> = None;
        if let (Some(col), Some(val)) = (filter_col, filter_value) {
            if !ident_ok(col) {
                return Err(AppError::Validation("非法过滤列".into()));
            }
            where_sql = format!(" WHERE \"{col}\"::text ILIKE $1");
            filter_param = Some(format!("%{val}%"));
        }

        let order_sql = match (sort_col, sort_dir) {
            (Some(col), dir) if ident_ok(col) => {
                let d = if dir.unwrap_or("ASC").eq_ignore_ascii_case("DESC") {
                    "DESC"
                } else {
                    "ASC"
                };
                format!(" ORDER BY \"{col}\" {d}")
            }
            _ => String::new(),
        };

        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;

        let count_sql = format!("SELECT COUNT(*) FROM \"{table}\"{where_sql}");
        let total: i64 = if let Some(ref p) = filter_param {
            client.query_one(&count_sql, &[p])?.get(0)
        } else {
            client.query_one(&count_sql, &[])?.get(0)
        };

        let data_sql = format!(
            "SELECT * FROM \"{table}\"{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
        );
        let rows_raw = if let Some(ref p) = filter_param {
            client.query(&data_sql, &[p])?
        } else {
            client.query(&data_sql, &[])?
        };

        let columns = if let Some(first) = rows_raw.first() {
            first
                .columns()
                .iter()
                .map(|c| ColumnMeta {
                    name: c.name().to_string(),
                    data_type: c.type_().name().to_string(),
                    nullable: true,
                })
                .collect()
        } else {
            // no rows — describe via zero-row select already empty columns
            Vec::new()
        };

        let mut rows = Vec::new();
        for row in &rows_raw {
            let mut values = Vec::with_capacity(row.len());
            for i in 0..row.len() {
                values.push(pg_cell_to_json(row, i));
            }
            rows.push(values);
        }

        Ok(RowsPage {
            columns,
            rows,
            total,
            page,
            page_size,
        })
    }

    fn backend_pid(&self) -> AppResult<Option<i64>> {
        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;
        let row = client.query_one("SELECT pg_backend_pid()", &[])?;
        let pid: i32 = row.get(0);
        Ok(Some(i64::from(pid)))
    }

    fn execute_sql(&self, sql: &str) -> AppResult<QueryOutcome> {
        let started = Instant::now();
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("SQL 为空".into()));
        }
        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;

        let upper = trimmed.to_uppercase();
        if upper.starts_with("SELECT")
            || upper.starts_with("WITH")
            || upper.starts_with("SHOW")
            || upper.starts_with("EXPLAIN")
        {
            let rows_raw = client.query(trimmed, &[])?;
            let columns = rows_raw
                .first()
                .map(|r| {
                    r.columns()
                        .iter()
                        .map(|c| c.name().to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let mut rows = Vec::new();
            for row in &rows_raw {
                let mut values = Vec::with_capacity(row.len());
                for i in 0..row.len() {
                    values.push(pg_cell_to_json(row, i));
                }
                rows.push(values);
            }
            return Ok(QueryOutcome {
                columns,
                rows,
                rows_affected: 0,
                elapsed_ms: started.elapsed().as_millis(),
            });
        }

        let affected = client.execute(trimmed, &[])?;
        Ok(QueryOutcome {
            columns: vec![],
            rows: vec![],
            rows_affected: affected as i64,
            elapsed_ms: started.elapsed().as_millis(),
        })
    }

    fn apply_row_changes(&self, table: &str, changes: &[RowChange]) -> AppResult<i64> {
        if !ident_ok(table) {
            return Err(AppError::Validation("非法表名".into()));
        }
        let mut client = self
            .client
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))?;
        let mut affected = 0i64;
        let mut tx = client.transaction()?;
        for change in changes {
            match change.op.as_str() {
                "update" => {
                    if change.columns.is_empty()
                        || change.columns.len() != change.values.len()
                        || change.pk_columns.is_empty()
                        || change.pk_columns.len() != change.pk_values.len()
                        || !change.columns.iter().all(|c| ident_ok(c))
                        || !change.pk_columns.iter().all(|c| ident_ok(c))
                    {
                        return Err(AppError::Validation("update 变更不合法".into()));
                    }
                    let mut params: Vec<Option<String>> = Vec::new();
                    let mut idx = 1;
                    let mut set_parts = Vec::new();
                    for c in &change.columns {
                        set_parts.push(format!("\"{c}\" = ${idx}"));
                        idx += 1;
                    }
                    for v in &change.values {
                        params.push(json_to_pg_opt(v));
                    }
                    let mut where_parts = Vec::new();
                    for c in &change.pk_columns {
                        where_parts.push(format!("\"{c}\" = ${idx}"));
                        idx += 1;
                    }
                    for v in &change.pk_values {
                        params.push(json_to_pg_opt(v));
                    }
                    let sql = format!(
                        "UPDATE \"{table}\" SET {} WHERE {}",
                        set_parts.join(", "),
                        where_parts.join(" AND ")
                    );
                    let refs: Vec<&(dyn postgres::types::ToSql + Sync)> =
                        params.iter().map(|p| p as _).collect();
                    affected += tx.execute(&sql, &refs[..])? as i64;
                }
                "insert" => {
                    if change.columns.is_empty()
                        || change.columns.len() != change.values.len()
                        || !change.columns.iter().all(|c| ident_ok(c))
                    {
                        return Err(AppError::Validation("insert 变更不合法".into()));
                    }
                    let cols = change
                        .columns
                        .iter()
                        .map(|c| format!("\"{c}\""))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let placeholders = (1..=change.columns.len())
                        .map(|i| format!("${i}"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let sql =
                        format!("INSERT INTO \"{table}\" ({cols}) VALUES ({placeholders})");
                    let params: Vec<Option<String>> =
                        change.values.iter().map(json_to_pg_opt).collect();
                    let refs: Vec<&(dyn postgres::types::ToSql + Sync)> =
                        params.iter().map(|p| p as _).collect();
                    affected += tx.execute(&sql, &refs[..])? as i64;
                }
                "delete" => {
                    if change.pk_columns.is_empty()
                        || change.pk_columns.len() != change.pk_values.len()
                        || !change.pk_columns.iter().all(|c| ident_ok(c))
                    {
                        return Err(AppError::Validation("delete 变更不合法".into()));
                    }
                    let mut where_parts = Vec::new();
                    let mut params = Vec::new();
                    for (i, c) in change.pk_columns.iter().enumerate() {
                        where_parts.push(format!("\"{c}\" = ${}", i + 1));
                        params.push(json_to_pg_opt(&change.pk_values[i]));
                    }
                    let sql = format!(
                        "DELETE FROM \"{table}\" WHERE {}",
                        where_parts.join(" AND ")
                    );
                    let refs: Vec<&(dyn postgres::types::ToSql + Sync)> =
                        params.iter().map(|p| p as _).collect();
                    affected += tx.execute(&sql, &refs[..])? as i64;
                }
                other => {
                    return Err(AppError::Validation(format!("未知变更类型: {other}")));
                }
            }
        }
        tx.commit()?;
        Ok(affected)
    }
}

fn json_to_pg_opt(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn docker_opts(password: &str) -> ConnectOpts {
        ConnectOpts {
            engine: "postgres".into(),
            host: Some("127.0.0.1".into()),
            port: Some(5432),
            database: Some("demo".into()),
            user: Some("navicat".into()),
            password: Some(password.into()),
            ssl_mode: Some("disable".into()),
            ssl_trust: None,
            ssh_enabled: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
        }
    }

    #[test]
    fn postgres_connect_success_and_list_tables() {
        let session = PostgresSession::connect(&docker_opts("navicat")).expect("pg connect");
        let tables = session.list_tables(None, Some("public")).expect("tables");
        assert!(tables.iter().any(|t| t.name == "t1"));
    }

    #[test]
    fn postgres_bad_password_returns_readable_error() {
        let err = match PostgresSession::connect(&docker_opts("wrong-password")) {
            Ok(_) => panic!("expected auth failure"),
            Err(e) => e,
        };
        let msg = err.to_string();
        assert!(
            msg.contains("password") || msg.contains("authentication") || msg.contains("driver"),
            "unexpected error: {msg}"
        );
    }
}
