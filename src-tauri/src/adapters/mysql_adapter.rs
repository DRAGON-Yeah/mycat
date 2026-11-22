use super::{
    ColumnMeta, ConnectOpts, DbObject, DriverSession, MultiOutcome, QueryOutcome, RowChange,
    RowsPage,
};
use crate::error::{AppError, AppResult};
use mysql::prelude::*;
use mysql::{Opts, OptsBuilder, SslOpts, Value as MysqlValue};
use serde_json::{Number, Value};
use std::sync::Mutex;
use std::time::Instant;

pub struct MysqlSession {
    conn: Mutex<mysql::Conn>,
}

fn build_opts(opts: &ConnectOpts) -> AppResult<Opts> {
    let host = opts
        .host
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("MySQL 主机不能为空".into()))?;
    let port = opts.port.unwrap_or(3306) as u16;
    let mut builder = OptsBuilder::new()
        .ip_or_hostname(Some(host))
        .tcp_port(port)
        .user(opts.user.clone())
        .pass(opts.password.clone())
        .db_name(opts.database.clone());

    let mode = opts.ssl_mode.as_deref().unwrap_or("disable");
    if mode.eq_ignore_ascii_case("require") {
        let trust = opts.ssl_trust.unwrap_or(false);
        let ssl = SslOpts::default()
            .with_danger_accept_invalid_certs(trust)
            .with_danger_skip_domain_validation(trust);
        builder = builder.ssl_opts(ssl);
    }
    Ok(Opts::from(builder))
}

impl MysqlSession {
    pub fn connect(opts: &ConnectOpts) -> AppResult<Self> {
        let conn = mysql::Conn::new(build_opts(opts)?)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

fn mysql_value_to_json(v: MysqlValue) -> Value {
    match v {
        MysqlValue::NULL => Value::Null,
        MysqlValue::Bytes(b) => match String::from_utf8(b.clone()) {
            Ok(s) => Value::String(s),
            Err(_) => Value::String(format!("\\x{}", hex::encode(b))),
        },
        MysqlValue::Int(i) => Value::Number(i.into()),
        MysqlValue::UInt(u) => Value::Number(u.into()),
        MysqlValue::Float(f) => Number::from_f64(f as f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        MysqlValue::Double(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        MysqlValue::Date(y, m, d, h, mi, s, us) => {
            Value::String(format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}"))
        }
        MysqlValue::Time(is_neg, days, h, m, s, us) => {
            let sign = if is_neg { "-" } else { "" };
            Value::String(format!("{sign}{days}d {h:02}:{m:02}:{s:02}.{us:06}"))
        }
    }
}

fn ident_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 跳过语句开头的空白与注释（`-- ` / `#` / `/* */`），用于判断语句类型。
/// `/*! ... */` 是 MySQL 可执行注释，不能跳过。
fn skip_leading_comments(sql: &str) -> &str {
    let bytes = sql.as_bytes();
    let mut i = 0usize;
    loop {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i + 1 < bytes.len() && bytes[i] == b'-' && bytes[i + 1] == b'-' {
            // MySQL 规则：`--` 后必须跟空白（或行尾）才算注释
            let is_comment = match bytes.get(i + 2) {
                None => true,
                Some(c) => c.is_ascii_whitespace(),
            };
            if is_comment {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
        }
        if i < bytes.len() && bytes[i] == b'#' {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            if bytes.get(i + 2) == Some(&b'!') {
                break;
            }
            match sql[i + 2..].find("*/") {
                Some(pos) => {
                    i += 2 + pos + 2;
                    continue;
                }
                None => {
                    i = bytes.len();
                    break;
                }
            }
        }
        break;
    }
    &sql[i..]
}

/// Qualify as `db`.`table` when database is set so ops work without session USE.
fn table_ref(database: Option<&str>, table: &str) -> AppResult<String> {
    if !ident_ok(table) {
        return Err(AppError::Validation("非法表名".into()));
    }
    if let Some(db) = database.map(str::trim).filter(|d| !d.is_empty()) {
        if !ident_ok(db) {
            return Err(AppError::Validation("非法库名".into()));
        }
        return Ok(format!("`{db}`.`{table}`"));
    }
    Ok(format!("`{table}`"))
}

impl DriverSession for MysqlSession {
    fn list_databases(&self) -> AppResult<Vec<String>> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;
        let rows: Vec<String> = conn.query("SHOW DATABASES")?;
        Ok(rows)
    }

    fn list_schemas(&self, _database: Option<&str>) -> AppResult<Vec<String>> {
        Ok(vec![])
    }

    fn list_tables(&self, database: Option<&str>, _schema: Option<&str>) -> AppResult<Vec<DbObject>> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;

        if let Some(db) = database.filter(|d| ident_ok(d)) {
            // Select schema so subsequent unqualified queries work.
            conn.query_drop(format!("USE `{db}`"))?;
            // InnoDB often leaves information_schema.UPDATE_TIME NULL; COALESCE to
            // CREATE_TIME so「修改日期」still shows a usable timestamp (Navicat-like).
            let sql = format!(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, DATA_LENGTH, ENGINE,
                        DATE_FORMAT(CREATE_TIME, '%Y-%m-%d %H:%i:%s'),
                        DATE_FORMAT(COALESCE(UPDATE_TIME, CHECK_TIME, CREATE_TIME), '%Y-%m-%d %H:%i:%s'),
                        TABLE_COLLATION, TABLE_COMMENT
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = '{db}'
                 ORDER BY TABLE_NAME"
            );
            let result = conn.query_map(
                sql,
                |(name, kind, rows, data_len, engine, created, updated, collation, comment): (
                    String,
                    String,
                    Option<i64>,
                    Option<i64>,
                    Option<String>,
                    Option<String>,
                    Option<String>,
                    Option<String>,
                    Option<String>,
                )| {
                    DbObject {
                        name,
                        kind: if kind.to_uppercase().contains("VIEW") {
                            "view".into()
                        } else {
                            "table".into()
                        },
                        table_rows: rows,
                        data_length: data_len,
                        engine,
                        create_time: created.clone(),
                        update_time: updated.or(created),
                        collation,
                        comment,
                    }
                },
            )?;
            return Ok(result);
        }

        // No database on the connection: avoid SHOW FULL TABLES (ERROR 1046).
        Err(AppError::Validation(
            "未选择数据库：请在连接里填写数据库名，或先展开库列表选择一个库".into(),
        ))
    }

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
    ) -> AppResult<RowsPage> {
        let table_sql = table_ref(database, table)?;
        let page = page.max(1);
        let page_size = page_size.clamp(1, 1000);
        let offset = (page - 1) * page_size;

        let mut where_sql = String::new();
        let mut params: Vec<MysqlValue> = Vec::new();
        if let (Some(col), Some(val)) = (filter_col, filter_value) {
            if !ident_ok(col) {
                return Err(AppError::Validation("非法过滤列".into()));
            }
            where_sql = format!(" WHERE `{col}` LIKE ?");
            params.push(MysqlValue::from(format!("%{val}%")));
        }

        let order_sql = match (sort_col, sort_dir) {
            (Some(col), dir) if ident_ok(col) => {
                let d = if dir.unwrap_or("ASC").eq_ignore_ascii_case("DESC") {
                    "DESC"
                } else {
                    "ASC"
                };
                format!(" ORDER BY `{col}` {d}")
            }
            _ => String::new(),
        };

        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;

        // Keep session default DB in sync when provided (helps other unqualified ops).
        if let Some(db) = database.map(str::trim).filter(|d| !d.is_empty() && ident_ok(d)) {
            conn.query_drop(format!("USE `{db}`"))?;
        }

        let count_sql = format!("SELECT COUNT(*) FROM {table_sql}{where_sql}");
        let total: i64 = if params.is_empty() {
            conn.query_first(count_sql)?.unwrap_or(0)
        } else {
            conn.exec_first(count_sql, params.clone())?.unwrap_or(0)
        };

        let data_sql = format!(
            "SELECT * FROM {table_sql}{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
        );

        let (columns_meta, rows) = if params.is_empty() {
            let result = conn.query_iter(data_sql)?;
            let columns_meta = result
                .columns()
                .as_ref()
                .iter()
                .map(|c| ColumnMeta {
                    name: c.name_str().to_string(),
                    data_type: format!("{:?}", c.column_type()),
                    nullable: true,
                })
                .collect::<Vec<_>>();
            let mut rows = Vec::new();
            for row in result {
                let row = row?;
                let mut values = Vec::with_capacity(columns_meta.len());
                for i in 0..columns_meta.len() {
                    let v: MysqlValue = row
                        .get_opt(i)
                        .and_then(|r| r.ok())
                        .unwrap_or(MysqlValue::NULL);
                    values.push(mysql_value_to_json(v));
                }
                rows.push(values);
            }
            (columns_meta, rows)
        } else {
            let result = conn.exec_iter(data_sql, params)?;
            let columns_meta = result
                .columns()
                .as_ref()
                .iter()
                .map(|c| ColumnMeta {
                    name: c.name_str().to_string(),
                    data_type: format!("{:?}", c.column_type()),
                    nullable: true,
                })
                .collect::<Vec<_>>();
            let mut rows = Vec::new();
            for row in result {
                let row = row?;
                let mut values = Vec::with_capacity(columns_meta.len());
                for i in 0..columns_meta.len() {
                    let v: MysqlValue = row
                        .get_opt(i)
                        .and_then(|r| r.ok())
                        .unwrap_or(MysqlValue::NULL);
                    values.push(mysql_value_to_json(v));
                }
                rows.push(values);
            }
            (columns_meta, rows)
        };

        Ok(RowsPage {
            columns: columns_meta,
            rows,
            total,
            page,
            page_size,
        })
    }

    fn backend_pid(&self) -> AppResult<Option<i64>> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;
        let id: Option<u32> = conn.query_first("SELECT CONNECTION_ID()")?;
        Ok(id.map(|v| i64::from(v)))
    }

    fn ping(&self) -> AppResult<()> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;
        let one: Option<u8> = conn.query_first("SELECT 1")?;
        if one.is_some() {
            Ok(())
        } else {
            Err(AppError::Message("mysql ping failed".into()))
        }
    }

    fn table_ddl(&self, database: Option<&str>, table: &str) -> AppResult<String> {
        let reference = table_ref(database, table)?;
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;
        for kind in ["TABLE", "VIEW"] {
            let sql = format!("SHOW CREATE {kind} {reference}");
            if let Ok(row) = conn.query_first::<mysql::Row, _>(&sql) {
                if let Some(value) = row.as_ref().and_then(|r| r.get::<String, _>(1)) {
                    if !value.trim().is_empty() {
                        return Ok(format!("{};\n", value.trim_end_matches(';')));
                    }
                }
            }
        }
        Err(AppError::Message(format!("无法获取 {table} 的 DDL")))
    }

    fn use_database(&self, database: Option<&str>) -> AppResult<()> {
        let Some(db) = database.map(str::trim).filter(|d| !d.is_empty()) else {
            return Ok(());
        };
        if !ident_ok(db) {
            return Err(AppError::Validation("非法库名".into()));
        }
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;
        conn.query_drop(format!("USE `{db}`"))?;
        Ok(())
    }

    fn execute_sql(&self, sql: &str) -> AppResult<QueryOutcome> {
        let started = Instant::now();
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("SQL 为空".into()));
        }
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;

        // 语句可能带前置注释（`-- 说明` / `/* 说明 */`），判断类型前先跳过，
        // 否则 `-- x\nSELECT ...` 会走 query_drop，结果集被丢掉。
        let upper = skip_leading_comments(trimmed).to_uppercase();
        // CHECK/ANALYZE/OPTIMIZE/REPAIR TABLE return result sets (Msg_text).
        if upper.starts_with("SELECT")
            || upper.starts_with("SHOW")
            || upper.starts_with("DESCRIBE")
            || upper.starts_with("DESC")
            || upper.starts_with("EXPLAIN")
            || upper.starts_with("WITH")
            || upper.starts_with("CHECK TABLE")
            || upper.starts_with("ANALYZE TABLE")
            || upper.starts_with("OPTIMIZE TABLE")
            || upper.starts_with("REPAIR TABLE")
        {
            let result = conn.query_iter(trimmed)?;
            let columns = result
                .columns()
                .as_ref()
                .iter()
                .map(|c| c.name_str().to_string())
                .collect::<Vec<_>>();
            let mut rows = Vec::new();
            for row in result {
                let row = row?;
                let mut values = Vec::with_capacity(columns.len());
                for i in 0..columns.len() {
                    let v: MysqlValue = row
                        .get_opt(i)
                        .and_then(|r| r.ok())
                        .unwrap_or(MysqlValue::NULL);
                    values.push(mysql_value_to_json(v));
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

        conn.query_drop(trimmed)?;
        let affected = conn.affected_rows();
        Ok(QueryOutcome {
            columns: vec![],
            rows: vec![],
            rows_affected: affected as i64,
            elapsed_ms: started.elapsed().as_millis(),
        })
    }

    fn supports_multi_statement(&self) -> bool {
        true
    }

    /// 一次把多条语句发给服务器（CLIENT_MULTI_STATEMENTS），按结果集逐条统计。
    /// 比逐条往返快一个数量级，且能精确定位出错的是第几条。
    fn execute_sql_multi(&self, sql: &str) -> AppResult<MultiOutcome> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;

        let mut result = match conn.query_iter(sql) {
            Ok(result) => result,
            Err(err) => {
                // 服务端拒绝第一条语句：连接仍然可用，按第 0 条失败返回；
                // 网络/协议错误则上抛，避免在已损坏的连接上继续发语句
                if matches!(&err, mysql::Error::MySqlError(_)) {
                    return Ok(MultiOutcome {
                        affected: Vec::new(),
                        error: Some((0, err.to_string())),
                    });
                }
                return Err(err.into());
            }
        };

        let mut affected = Vec::with_capacity(16);
        let mut error = None;
        loop {
            let Some(mut set) = result.iter() else {
                break;
            };
            // 必须在消费行之前取，消费完会推进到下一个结果集
            let rows = set.affected_rows() as i64;
            let mut set_error = None;
            for row in set.by_ref() {
                if let Err(err) = row {
                    set_error = Some(err.to_string());
                    break;
                }
            }
            drop(set);
            if let Some(message) = set_error {
                error = Some((affected.len(), message));
                break;
            }
            affected.push(rows);
        }

        Ok(MultiOutcome { affected, error })
    }

    fn apply_row_changes(
        &self,
        database: Option<&str>,
        table: &str,
        changes: &[RowChange],
    ) -> AppResult<i64> {
        let table_sql = table_ref(database, table)?;
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Message("mysql lock".into()))?;
        if let Some(db) = database.map(str::trim).filter(|d| !d.is_empty() && ident_ok(d)) {
            conn.query_drop(format!("USE `{db}`"))?;
        }
        let mut tx = conn.start_transaction(mysql::TxOpts::default())?;
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
                        .map(|c| format!("`{c}` = ?"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let where_sql = change
                        .pk_columns
                        .iter()
                        .map(|c| format!("`{c}` = ?"))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("UPDATE {table_sql} SET {set_sql} WHERE {where_sql}");
                    let params: Vec<MysqlValue> = change
                        .values
                        .iter()
                        .chain(change.pk_values.iter())
                        .map(json_to_mysql)
                        .collect();
                    affected += tx.exec_iter(sql, params)?.affected_rows() as i64;
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
                        .map(|c| format!("`{c}`"))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let placeholders = (0..change.columns.len())
                        .map(|_| "?")
                        .collect::<Vec<_>>()
                        .join(", ");
                    let sql =
                        format!("INSERT INTO {table_sql} ({cols}) VALUES ({placeholders})");
                    let params: Vec<MysqlValue> = change.values.iter().map(json_to_mysql).collect();
                    affected += tx.exec_iter(sql, params)?.affected_rows() as i64;
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
                        .map(|c| format!("`{c}` = ?"))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("DELETE FROM {table_sql} WHERE {where_sql}");
                    let params: Vec<MysqlValue> =
                        change.pk_values.iter().map(json_to_mysql).collect();
                    affected += tx.exec_iter(sql, params)?.affected_rows() as i64;
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

fn json_to_mysql(v: &Value) -> MysqlValue {
    match v {
        Value::Null => MysqlValue::NULL,
        Value::Bool(b) => MysqlValue::Int(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                MysqlValue::Int(i)
            } else if let Some(u) = n.as_u64() {
                MysqlValue::UInt(u)
            } else if let Some(f) = n.as_f64() {
                MysqlValue::Double(f)
            } else {
                MysqlValue::Bytes(n.to_string().into_bytes())
            }
        }
        Value::String(s) => MysqlValue::Bytes(s.clone().into_bytes()),
        other => MysqlValue::Bytes(other.to_string().into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn docker_opts(password: &str) -> ConnectOpts {
        ConnectOpts {
            engine: "mysql".into(),
            host: Some("127.0.0.1".into()),
            port: Some(3307),
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
    fn mysql_connect_success_and_list_tables() {
        let session = MysqlSession::connect(&docker_opts("navicat")).expect("mysql connect");
        let tables = session.list_tables(Some("demo"), None).expect("tables");
        assert!(tables.iter().any(|t| t.name == "t1"));
    }

    #[test]
    fn mysql_bad_password_returns_readable_error() {
        let err = match MysqlSession::connect(&docker_opts("wrong-password")) {
            Ok(_) => panic!("expected auth failure"),
            Err(e) => e,
        };
        let msg = err.to_string();
        assert!(
            msg.contains("Access denied") || msg.contains("driver") || msg.contains("Password"),
            "unexpected error: {msg}"
        );
    }

    fn live_opts() -> Option<ConnectOpts> {
        if std::env::var("MYCAT_MYSQL_TEST").ok().as_deref() != Some("1") {
            return None;
        }
        Some(ConnectOpts {
            engine: "mysql".into(),
            host: Some(std::env::var("MYCAT_MYSQL_HOST").unwrap_or_else(|_| "127.0.0.1".into())),
            port: Some(
                std::env::var("MYCAT_MYSQL_PORT")
                    .ok()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(3306),
            ),
            database: None,
            user: Some(std::env::var("MYCAT_MYSQL_USER").unwrap_or_else(|_| "root".into())),
            password: Some(
                std::env::var("MYCAT_MYSQL_PASSWORD").unwrap_or_else(|_| "root".into()),
            ),
            ssl_mode: Some("disable".into()),
            ssl_trust: None,
            ssh_enabled: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
        })
    }

    /// Regression guard for the shared driver surface: `MYCAT_MYSQL_TEST=1 cargo test --lib mysql_live`.
    #[test]
    fn mysql_live_roundtrip() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = MysqlSession::connect(&opts).expect("connect");
        session.ping().expect("ping");
        session
            .execute_sql(
                "DROP DATABASE IF EXISTS mycat_test;
                 CREATE DATABASE mycat_test;
                 CREATE TABLE mycat_test.sample (
                   id INT AUTO_INCREMENT PRIMARY KEY,
                   name VARCHAR(64) NOT NULL,
                   amount DECIMAL(12,2),
                   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                 );",
            )
            .expect("setup");

        let tables = session.list_tables(Some("mycat_test"), None).expect("list");
        assert!(tables.iter().any(|t| t.name == "sample"));

        let page = session
            .query_page(Some("mycat_test"), "sample", 1, 10, None, None, None, None)
            .expect("page");
        assert_eq!(page.total, 0);
        assert_eq!(page.columns.len(), 4);

        let inserted = session
            .apply_row_changes(
                Some("mycat_test"),
                "sample",
                &[RowChange {
                    op: "insert".into(),
                    pk_columns: vec![],
                    pk_values: vec![],
                    columns: vec!["name".into(), "amount".into()],
                    values: vec![Value::String("第一条".into()), Value::from(9.5)],
                }],
            )
            .expect("insert");
        assert_eq!(inserted, 1);

        let page = session
            .query_page(
                Some("mycat_test"),
                "sample",
                1,
                10,
                Some("id"),
                Some("DESC"),
                Some("name"),
                Some("第一"),
            )
            .expect("page");
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0][1], Value::String("第一条".into()));

        let ddl = session.table_ddl(Some("mycat_test"), "sample").expect("ddl");
        assert!(ddl.contains("CREATE TABLE"));
        assert!(ddl.contains("AUTO_INCREMENT"));

        session
            .execute_sql("DROP DATABASE mycat_test")
            .expect("cleanup");
    }

    /// `open_connection` is called before every object-list refresh: it must not
    /// reconnect when the settings are unchanged.
    #[test]
    fn session_pool_reuses_live_session() {
        let Some(opts) = live_opts() else {
            return;
        };
        let pool = crate::session::SessionPool::new();
        pool.open("c1", opts.clone()).expect("open");
        let pid1 = pool
            .with_session("c1", |s| s.backend_pid())
            .expect("pid1");
        pool.open("c1", opts.clone()).expect("reopen");
        let pid2 = pool
            .with_session("c1", |s| s.backend_pid())
            .expect("pid2");
        assert_eq!(pid1, pid2, "unchanged settings must reuse the session");

        let mut changed = opts.clone();
        changed.password = Some("definitely-wrong".into());
        assert!(pool.open("c1", changed).is_err(), "settings change reconnects");

        pool.close("c1").expect("close");
        assert!(pool.with_session("c1", |s| s.ping()).is_err());
    }

    /// 多语句单包：逐条统计受影响行数，并能定位出错语句。
    #[test]
    fn mysql_live_multi_statement() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = MysqlSession::connect(&opts).expect("connect");
        session
            .execute_sql(
                "DROP DATABASE IF EXISTS mycat_batch;
                 CREATE DATABASE mycat_batch;
                 CREATE TABLE mycat_batch.t (id INT PRIMARY KEY, v VARCHAR(32));",
            )
            .expect("setup");
        session.use_database(Some("mycat_batch")).expect("use");

        let out = session
            .execute_sql_multi(
                "INSERT INTO t VALUES (1,'a');\nINSERT INTO t VALUES (2,'b');\nINSERT INTO t VALUES (3,'c')",
            )
            .expect("multi");
        assert_eq!(out.affected, vec![1, 1, 1]);
        assert!(out.error.is_none());

        // 第 2 条主键冲突：前 1 条成功，错误下标 1，连接仍可用
        let out = session
            .execute_sql_multi(
                "INSERT INTO t VALUES (4,'d');\nINSERT INTO t VALUES (1,'dup');\nINSERT INTO t VALUES (5,'e')",
            )
            .expect("multi with error");
        assert_eq!(out.affected, vec![1]);
        let (idx, msg) = out.error.expect("error");
        assert_eq!(idx, 1);
        assert!(msg.contains("Duplicate"), "{msg}");

        let out = session
            .execute_sql_multi("INSERT INTO t VALUES (5,'e')")
            .expect("reuse");
        assert_eq!(out.affected, vec![1]);

        // 首条语句就报错
        let out = session
            .execute_sql_multi("SELECT * FROM no_such_table; SELECT 1")
            .expect("first error");
        assert_eq!(out.error.expect("error").0, 0);

        // SELECT 结果集也要能跳过并推进到下一条
        let out = session
            .execute_sql_multi("SELECT * FROM t; INSERT INTO t VALUES (6,'f')")
            .expect("select + insert");
        assert_eq!(out.affected.len(), 2);
        assert_eq!(out.affected[1], 1);

        session
            .execute_sql("DROP DATABASE mycat_batch")
            .expect("cleanup");
    }

    #[test]
    fn mysql_ssl_require_on_plain_server_errors() {
        let mut opts = docker_opts("navicat");
        opts.ssl_mode = Some("require".into());
        opts.ssl_trust = Some(true);
        let err = match MysqlSession::connect(&opts) {
            Ok(_) => return, // some local MySQL may already speak TLS
            Err(e) => e,
        };
        assert!(!err.to_string().is_empty());
    }
}
