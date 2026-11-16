use super::{
    ColumnMeta, ConnectOpts, DbObject, DriverSession, QueryOutcome, RowChange, RowsPage,
};
use crate::error::{AppError, AppResult};
use rusqlite::types::Value as SqlValue;
use rusqlite::{types::ValueRef, Connection, InterruptHandle, OptionalExtension};
use serde_json::{Number, Value};
use std::time::Instant;

fn json_to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Text(n.to_string())
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn ident_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub struct SqliteSession {
    conn: Connection,
    path: String,
}

impl SqliteSession {
    pub fn connect(opts: &ConnectOpts) -> AppResult<Self> {
        let path = opts
            .host
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Validation("SQLite 文件路径不能为空".into()))?;
        let conn = Connection::open(&path)?;
        Ok(Self { conn, path })
    }
}

fn value_ref_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::String(format!("\\x{}", hex::encode(b))),
    }
}

impl DriverSession for SqliteSession {
    fn list_databases(&self) -> AppResult<Vec<String>> {
        Ok(vec![self.path.clone()])
    }

    fn list_schemas(&self, _database: Option<&str>) -> AppResult<Vec<String>> {
        Ok(vec!["main".into()])
    }

    fn list_tables(&self, _database: Option<&str>, _schema: Option<&str>) -> AppResult<Vec<DbObject>> {
        let mut stmt = self.conn.prepare(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DbObject {
                name: row.get(0)?,
                kind: row.get(1)?,
                table_rows: None,
                data_length: None,
                engine: Some("sqlite".into()),
                create_time: None,
                update_time: None,
                collation: None,
                comment: None,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
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
        if !table.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(AppError::Validation("非法表名".into()));
        }
        let page = page.max(1);
        let page_size = page_size.clamp(1, 1000);
        let offset = (page - 1) * page_size;

        let mut where_sql = String::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let (Some(col), Some(val)) = (filter_col, filter_value) {
            if !col.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                return Err(AppError::Validation("非法过滤列".into()));
            }
            where_sql = format!(" WHERE \"{col}\" LIKE ?1");
            params.push(Box::new(format!("%{val}%")));
        }

        let order_sql = match (sort_col, sort_dir) {
            (Some(col), dir) if col.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => {
                let d = if dir.unwrap_or("ASC").eq_ignore_ascii_case("DESC") {
                    "DESC"
                } else {
                    "ASC"
                };
                format!(" ORDER BY \"{col}\" {d}")
            }
            _ => String::new(),
        };

        let count_sql = format!("SELECT COUNT(*) FROM \"{table}\"{where_sql}");
        let total: i64 = if params.is_empty() {
            self.conn
                .query_row(&count_sql, [], |r| r.get(0))
                .optional()?
                .unwrap_or(0)
        } else {
            self.conn
                .query_row(&count_sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |r| r.get(0))?
        };

        let data_sql = format!(
            "SELECT * FROM \"{table}\"{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
        );
        let mut stmt = self.conn.prepare(&data_sql)?;

        let column_count = stmt.column_count();
        let mut columns = Vec::new();
        for i in 0..column_count {
            columns.push(ColumnMeta {
                name: stmt.column_name(i)?.to_string(),
                data_type: "TEXT".into(),
                nullable: true,
            });
        }

        let mut rows = Vec::new();
        if params.is_empty() {
            let mapped = stmt.query_map([], |row| {
                let mut values = Vec::with_capacity(column_count);
                for i in 0..column_count {
                    values.push(value_ref_to_json(row.get_ref(i)?));
                }
                Ok(values)
            })?;
            for row in mapped {
                rows.push(row?);
            }
        } else {
            let mapped = stmt.query_map(
                rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
                |row| {
                    let mut values = Vec::with_capacity(column_count);
                    for i in 0..column_count {
                        values.push(value_ref_to_json(row.get_ref(i)?));
                    }
                    Ok(values)
                },
            )?;
            for row in mapped {
                rows.push(row?);
            }
        }

        Ok(RowsPage {
            columns,
            rows,
            total,
            page,
            page_size,
        })
    }

    fn sqlite_interrupt_handle(&self) -> Option<InterruptHandle> {
        Some(self.conn.get_interrupt_handle())
    }

    fn execute_sql(&self, sql: &str) -> AppResult<QueryOutcome> {
        let started = Instant::now();
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("SQL 为空".into()));
        }

        let upper = trimmed.to_uppercase();
        if upper.starts_with("SELECT") || upper.starts_with("WITH") || upper.starts_with("PRAGMA") {
            let mut stmt = self.conn.prepare(trimmed)?;
            let column_count = stmt.column_count();
            let columns: Vec<String> = (0..column_count)
                .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
                .collect();
            let mapped = stmt.query_map([], |row| {
                let mut values = Vec::with_capacity(column_count);
                for i in 0..column_count {
                    values.push(value_ref_to_json(row.get_ref(i)?));
                }
                Ok(values)
            })?;
            let mut rows = Vec::new();
            for row in mapped {
                rows.push(row?);
            }
            return Ok(QueryOutcome {
                columns,
                rows,
                rows_affected: 0,
                elapsed_ms: started.elapsed().as_millis(),
            });
        }

        let affected = self.conn.execute(trimmed, [])?;
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
        let tx = self.conn.unchecked_transaction()?;
        let mut affected = 0i64;
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
                    let set_sql = change
                        .columns
                        .iter()
                        .map(|c| format!("\"{c}\" = ?"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let where_sql = change
                        .pk_columns
                        .iter()
                        .map(|c| format!("\"{c}\" = ?"))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("UPDATE \"{table}\" SET {set_sql} WHERE {where_sql}");
                    let params: Vec<SqlValue> = change
                        .values
                        .iter()
                        .chain(change.pk_values.iter())
                        .map(json_to_sql)
                        .collect();
                    affected += tx.execute(
                        &sql,
                        rusqlite::params_from_iter(params.iter()),
                    )? as i64;
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
                    let placeholders = (0..change.columns.len())
                        .map(|_| "?")
                        .collect::<Vec<_>>()
                        .join(", ");
                    let sql = format!("INSERT INTO \"{table}\" ({cols}) VALUES ({placeholders})");
                    let params: Vec<SqlValue> = change.values.iter().map(json_to_sql).collect();
                    affected += tx.execute(
                        &sql,
                        rusqlite::params_from_iter(params.iter()),
                    )? as i64;
                }
                "delete" => {
                    if change.pk_columns.is_empty()
                        || change.pk_columns.len() != change.pk_values.len()
                        || !change.pk_columns.iter().all(|c| ident_ok(c))
                    {
                        return Err(AppError::Validation("delete 变更不合法".into()));
                    }
                    let where_sql = change
                        .pk_columns
                        .iter()
                        .map(|c| format!("\"{c}\" = ?"))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("DELETE FROM \"{table}\" WHERE {where_sql}");
                    let params: Vec<SqlValue> = change.pk_values.iter().map(json_to_sql).collect();
                    affected += tx.execute(
                        &sql,
                        rusqlite::params_from_iter(params.iter()),
                    )? as i64;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sqlite_connect_list_tables_and_page() {
        let path = std::env::temp_dir().join(format!("mycat-t6-{}.db", uuid::Uuid::new_v4()));
        let _ = fs::remove_file(&path);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE demo(id INTEGER PRIMARY KEY, name TEXT);
                 INSERT INTO demo(name) VALUES ('a'),('b'),('c');",
            )
            .unwrap();
        }

        let session = SqliteSession::connect(&ConnectOpts {
            engine: "sqlite".into(),
            host: Some(path.display().to_string()),
            port: None,
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
        })
        .unwrap();

        let tables = session.list_tables(None, None).unwrap();
        assert!(tables.iter().any(|t| t.name == "demo"));

        let page = session
            .query_page("demo", 1, 10, Some("id"), Some("ASC"), None, None)
            .unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.rows.len(), 3);

        // seed more rows for paging/filter
        session
            .execute_sql(
                "INSERT INTO demo(name) VALUES ('d'),('e'),('f'),('g'),('h'),('i'),('j'),('k');",
            )
            .unwrap();
        let page2 = session
            .query_page("demo", 2, 5, Some("id"), Some("ASC"), None, None)
            .unwrap();
        assert_eq!(page2.total, 11);
        assert_eq!(page2.rows.len(), 5);
        assert_eq!(page2.page, 2);

        let filtered = session
            .query_page("demo", 1, 50, None, None, Some("name"), Some("a"))
            .unwrap();
        assert!(filtered.total >= 1);
        assert!(filtered.rows.iter().all(|r| {
            r.get(1)
                .map(|v| v.as_str().unwrap_or("").contains('a'))
                .unwrap_or(false)
        }));

        session
            .apply_row_changes(
                "demo",
                &[RowChange {
                    op: "update".into(),
                    pk_columns: vec!["id".into()],
                    pk_values: vec![Value::from(1)],
                    columns: vec!["name".into()],
                    values: vec![Value::String("updated".into())],
                }],
            )
            .unwrap();
        let after = session
            .query_page("demo", 1, 10, Some("id"), Some("ASC"), Some("name"), Some("updated"))
            .unwrap();
        assert_eq!(after.total, 1);

        let _ = fs::remove_file(&path);
    }
}
