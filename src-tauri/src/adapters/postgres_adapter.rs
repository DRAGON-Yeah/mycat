use super::{
    ColumnMeta, ConnectOpts, DbObject, DriverSession, QueryOutcome, RowChange, RowsPage,
};
use crate::error::{AppError, AppResult};
use native_tls::TlsConnector;
use postgres::config::SslMode;
use postgres::{Client, NoTls, SimpleQueryMessage};
use postgres_native_tls::MakeTlsConnector;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Schemas hidden from the object browser.
const SYSTEM_SCHEMAS: &[&str] = &["pg_catalog", "information_schema", "pg_toast"];

pub struct PostgresSession {
    inner: Mutex<PgInner>,
}

/// `postgres::Client` closes its socket through the driver's own runtime on drop,
/// which panics when the session is released from a tokio worker thread. The
/// newtype moves that work to a plain thread.
struct PgClient(Option<Client>);

impl std::ops::Deref for PgClient {
    type Target = Client;
    fn deref(&self) -> &Client {
        self.0.as_ref().expect("postgres client")
    }
}

impl std::ops::DerefMut for PgClient {
    fn deref_mut(&mut self) -> &mut Client {
        self.0.as_mut().expect("postgres client")
    }
}

impl Drop for PgClient {
    fn drop(&mut self) {
        if let Some(client) = self.0.take() {
            let _ = std::thread::scope(|scope| scope.spawn(move || drop(client)).join());
        }
    }
}

struct PgInner {
    client: PgClient,
    /// Resolved options of the live connection (used to reconnect to another db).
    opts: ConnectOpts,
    database: String,
}

#[derive(Default)]
struct SimpleOutcome {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    affected: i64,
}

// ---------------------------------------------------------------------------
// connection helpers
// ---------------------------------------------------------------------------

fn normalized(opts: &ConnectOpts) -> AppResult<ConnectOpts> {
    let host = opts
        .host
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("PostgreSQL 主机不能为空".into()))?
        .to_string();
    let database = opts
        .database
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("postgres")
        .to_string();
    let mut out = opts.clone();
    out.host = Some(host);
    out.port = Some(opts.port.unwrap_or(5432));
    out.user = Some(
        opts.user
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("postgres")
            .to_string(),
    );
    out.database = Some(database);
    Ok(out)
}

fn config_for(opts: &ConnectOpts) -> postgres::Config {
    let mut cfg = postgres::Config::new();
    cfg.host(opts.host.as_deref().unwrap_or("127.0.0.1"))
        .port(opts.port.unwrap_or(5432).clamp(1, 65535) as u16)
        .user(opts.user.as_deref().unwrap_or("postgres"))
        .dbname(opts.database.as_deref().unwrap_or("postgres"))
        .application_name("Mycat")
        .connect_timeout(Duration::from_secs(15));
    if let Some(pw) = opts.password.as_deref().filter(|p| !p.is_empty()) {
        cfg.password(pw);
    }
    cfg
}

fn tls_connector(trust: bool) -> AppResult<MakeTlsConnector> {
    let tls = TlsConnector::builder()
        .danger_accept_invalid_certs(trust)
        .danger_accept_invalid_hostnames(trust)
        .build()
        .map_err(|e| AppError::Driver(format!("TLS 初始化失败: {e}")))?;
    Ok(MakeTlsConnector::new(tls))
}

fn open_client(opts: &ConnectOpts) -> AppResult<Client> {
    // `postgres::Config::connect` builds its own runtime and blocks on it, which
    // panics ("Cannot start a runtime from within a runtime") when the command is
    // dispatched from Tauri's tokio worker. Run it on a plain OS thread instead.
    let owned = opts.clone();
    std::thread::spawn(move || open_client_inner(&owned))
        .join()
        .unwrap_or_else(|_| Err(AppError::Message("PostgreSQL 连接线程异常退出".into())))
}

fn open_client_inner(opts: &ConnectOpts) -> AppResult<Client> {
    let mode = opts
        .ssl_mode
        .as_deref()
        .unwrap_or("disable")
        .trim()
        .to_ascii_lowercase();
    let trust = opts.ssl_trust.unwrap_or(false);
    let driver_err = |e: postgres::Error| AppError::Driver(crate::error::postgres_message(&e));

    match mode.as_str() {
        "require" | "verify-ca" | "verify-full" => {
            let mut cfg = config_for(opts);
            cfg.ssl_mode(SslMode::Require);
            cfg.connect(tls_connector(trust)?).map_err(driver_err)
        }
        // prefer/allow: try TLS first, silently fall back to plaintext.
        "prefer" | "allow" => {
            let mut cfg = config_for(opts);
            cfg.ssl_mode(SslMode::Require);
            match cfg.connect(tls_connector(trust)?) {
                Ok(client) => Ok(client),
                Err(_) => {
                    let mut cfg = config_for(opts);
                    cfg.ssl_mode(SslMode::Disable);
                    cfg.connect(NoTls).map_err(driver_err)
                }
            }
        }
        _ => {
            let mut cfg = config_for(opts);
            cfg.ssl_mode(SslMode::Disable);
            cfg.connect(NoTls).map_err(driver_err)
        }
    }
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

/// Quote a Postgres identifier (double quotes, escaped).
fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Quote a string literal (standard_conforming_strings is on by default).
fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn ident_ok(name: &str) -> bool {
    !name.trim().is_empty() && !name.contains('\0')
}

/// Split `schema.table` (as produced by the object browser) into its parts.
fn split_qualified(table: &str) -> (Option<&str>, &str) {
    match table.split_once('.') {
        Some((schema, name)) if !schema.is_empty() && !name.is_empty() => {
            (Some(schema), name)
        }
        _ => (None, table),
    }
}

/// Resolve a table reference: `schema` argument wins, then a `schema.table` name.
fn table_ref(schema: Option<&str>, table: &str) -> AppResult<String> {
    let (inline_schema, name) = split_qualified(table.trim());
    if !ident_ok(name) {
        return Err(AppError::Validation("非法表名".into()));
    }
    let schema = schema
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(inline_schema);
    if let Some(schema) = schema {
        if !ident_ok(schema) {
            return Err(AppError::Validation("非法 schema".into()));
        }
        return Ok(format!("{}.{}", quote(schema), quote(name)));
    }
    Ok(quote(name))
}

fn run_simple(client: &mut Client, sql: &str) -> AppResult<SimpleOutcome> {
    let messages = client.simple_query(sql)?;
    let mut out = SimpleOutcome::default();
    for msg in messages {
        match msg {
            SimpleQueryMessage::RowDescription(cols) => {
                // A new result set starts: keep only the last one.
                out.columns = cols.iter().map(|c| c.name().to_string()).collect();
                out.rows.clear();
                out.affected = 0;
            }
            SimpleQueryMessage::Row(row) => {
                let mut values = Vec::with_capacity(row.len());
                for i in 0..row.len() {
                    values.push(match row.get(i) {
                        Some(text) => Value::String(text.to_string()),
                        None => Value::Null,
                    });
                }
                out.rows.push(values);
            }
            SimpleQueryMessage::CommandComplete(n) => {
                out.affected = n as i64;
            }
            _ => {}
        }
    }
    Ok(out)
}

fn first_i64(out: &SimpleOutcome) -> i64 {
    out.rows
        .first()
        .and_then(|r| r.first())
        .and_then(|v| match v {
            Value::String(s) => s.parse::<i64>().ok(),
            Value::Number(n) => n.as_i64(),
            _ => None,
        })
        .unwrap_or(0)
}

fn cell_str(row: &[Value], idx: usize) -> String {
    match row.get(idx) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

#[derive(Debug, Clone)]
struct ColumnInfo {
    /// Declared type (`format_type`), used to cast bound parameters.
    typ: String,
    /// Column has a DEFAULT expression or is an identity column.
    auto_filled: bool,
}

/// Column name → declared type + "server fills this" flag.
fn column_info(
    client: &mut Client,
    schema: &str,
    table: &str,
) -> AppResult<std::collections::HashMap<String, ColumnInfo>> {
    let sql = format!(
        "SELECT a.attname,
                pg_catalog.format_type(a.atttypid, a.atttypmod),
                (a.attidentity <> '' OR d.adbin IS NOT NULL)
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_catalog.pg_attrdef d
                ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE c.relname = {} AND n.nspname = {}
           AND a.attnum > 0 AND NOT a.attisdropped",
        literal(table),
        literal(schema)
    );
    let out = run_simple(client, &sql)?;
    let mut map = std::collections::HashMap::new();
    for row in &out.rows {
        let name = cell_str(row, 0);
        let typ = cell_str(row, 1);
        let auto_filled = cell_str(row, 2).eq_ignore_ascii_case("t");
        if !name.is_empty() && !typ.is_empty() {
            map.insert(
                name,
                ColumnInfo {
                    typ,
                    auto_filled,
                },
            );
        }
    }
    Ok(map)
}

fn current_schema(client: &mut Client) -> String {
    run_simple(client, "SELECT current_schema()")
        .ok()
        .map(|out| out.rows.first().map(|r| cell_str(r, 0)).unwrap_or_default())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "public".to_string())
}

impl PgInner {
    /// Postgres binds a session to one database: reconnect when a different one
    /// is requested (e.g. a tab opened from another database in the tree).
    fn ensure_database(&mut self, database: Option<&str>) -> AppResult<()> {
        let Some(db) = database.map(str::trim).filter(|d| !d.is_empty()) else {
            return Ok(());
        };
        if db == self.database {
            return Ok(());
        }
        let mut next = self.opts.clone();
        next.database = Some(db.to_string());
        let client = open_client(&next)?;
        self.client = PgClient(Some(client));
        self.opts = next;
        self.database = db.to_string();
        Ok(())
    }

    fn schema_of(&mut self, schema: Option<&str>) -> String {
        schema
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| current_schema(&mut self.client))
    }
}

impl PostgresSession {
    pub fn connect(opts: &ConnectOpts) -> AppResult<Self> {
        let opts = normalized(opts)?;
        let client = open_client(&opts)?;
        let database = opts.database.clone().unwrap_or_else(|| "postgres".into());
        Ok(Self {
            inner: Mutex::new(PgInner {
                client: PgClient(Some(client)),
                opts,
                database,
            }),
        })
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, PgInner>> {
        self.inner
            .lock()
            .map_err(|_| AppError::Message("postgres lock".into()))
    }
}

impl PostgresSession {
    fn ping_inner(&self) -> AppResult<()> {
        let mut inner = self.lock()?;
        run_simple(&mut inner.client, "SELECT 1").map(|_| ())
    }

    fn list_databases_inner(&self) -> AppResult<Vec<String>> {
        let mut inner = self.lock()?;
        let out = run_simple(
            &mut inner.client,
            "SELECT datname FROM pg_catalog.pg_database \
             WHERE datistemplate = false AND datallowconn = true ORDER BY datname",
        )?;
        Ok(out
            .rows
            .iter()
            .map(|r| cell_str(r, 0))
            .filter(|s| !s.is_empty())
            .collect())
    }

    fn list_schemas_inner(&self, database: Option<&str>) -> AppResult<Vec<String>> {
        let mut inner = self.lock()?;
        inner.ensure_database(database)?;
        let out = run_simple(
            &mut inner.client,
            "SELECT nspname FROM pg_catalog.pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' \
             ORDER BY nspname",
        )?;
        Ok(out
            .rows
            .iter()
            .map(|r| cell_str(r, 0))
            .filter(|s| !s.is_empty())
            .collect())
    }

    /// Lists every user object of the database. Names outside `public` are
    /// returned as `schema.table` so they stay addressable from the UI.
    fn list_tables_inner(&self, database: Option<&str>, schema: Option<&str>) -> AppResult<Vec<DbObject>> {
        let mut inner = self.lock()?;
        inner.ensure_database(database)?;
        let only_schema = schema
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        // PostgreSQL keeps no table-level CREATE/UPDATE timestamps and no table-level
        // collation: collation lives on columns (pg_attribute.attcollation) and on the
        // database (pg_database.datcollate). We surface the column-level value when all
        // collatable columns agree, fall back to the database default otherwise.
        let sql = format!(
            "SELECT n.nspname, c.relname, c.relkind,
                    GREATEST(c.reltuples, 0)::bigint,
                    pg_catalog.pg_total_relation_size(c.oid)::bigint,
                    COALESCE(pg_catalog.obj_description(c.oid, 'pg_class'), ''),
                    COALESCE(pg_catalog.pg_get_userbyid(c.relowner), ''),
                    COALESCE(t.spcname, ''),
                    COALESCE(d.datcollate, ''),
                    COALESCE(col.coll, '')
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_catalog.pg_tablespace t ON t.oid = c.reltablespace
             JOIN pg_catalog.pg_database d ON d.datname = pg_catalog.current_database()
             LEFT JOIN LATERAL (
               SELECT CASE
                        WHEN count(DISTINCT COALESCE(NULLIF(co.collname, 'default'), d.datcollate)) = 0 THEN ''
                        WHEN count(DISTINCT COALESCE(NULLIF(co.collname, 'default'), d.datcollate)) = 1
                          THEN min(COALESCE(NULLIF(co.collname, 'default'), d.datcollate))
                        ELSE 'mixed'
                      END AS coll
               FROM pg_catalog.pg_attribute a
               JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation
               WHERE a.attrelid = c.oid
                 AND a.attnum > 0
                 AND NOT a.attisdropped
             ) col ON true
             WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND n.nspname NOT IN ({})
               AND n.nspname NOT LIKE 'pg\\_temp%'
               {}
             ORDER BY n.nspname, c.relname",
            SYSTEM_SCHEMAS
                .iter()
                .map(|s| literal(s))
                .collect::<Vec<_>>()
                .join(", "),
            only_schema
                .as_deref()
                .map(|s| format!("AND n.nspname = {}", literal(s)))
                .unwrap_or_default()
        );
        let out = run_simple(&mut inner.client, &sql)?;

        let mut objects = Vec::with_capacity(out.rows.len());
        for row in &out.rows {
            let schema_name = cell_str(row, 0);
            let relname = cell_str(row, 1);
            if relname.is_empty() {
                continue;
            }
            let relkind = cell_str(row, 2);
            let kind = match relkind.as_str() {
                "v" | "m" => "view",
                _ => "table",
            };
            let rows_est: i64 = cell_str(row, 3).parse().unwrap_or(0);
            let bytes: i64 = cell_str(row, 4).parse().unwrap_or(0);
            let comment = cell_str(row, 5);
            let owner = cell_str(row, 6);
            let tablespace = cell_str(row, 7);
            let db_collation = cell_str(row, 8);
            let column_collation = cell_str(row, 9);
            let collation = match column_collation.as_str() {
                "" => db_collation,
                "mixed" => "混合".to_string(),
                other => other.to_string(),
            };
            let display = if schema_name == "public" || schema_name.is_empty() {
                relname
            } else {
                format!("{schema_name}.{relname}")
            };
            objects.push(DbObject {
                name: display,
                kind: kind.into(),
                table_rows: Some(rows_est.max(0)),
                data_length: Some(bytes.max(0)),
                engine: Some(if tablespace.is_empty() {
                    owner
                } else {
                    format!("{owner} · {tablespace}")
                }),
                create_time: None,
                update_time: None,
                collation: if collation.is_empty() {
                    None
                } else {
                    Some(collation)
                },
                comment: if comment.is_empty() { None } else { Some(comment) },
            });
        }
        Ok(objects)
    }

    fn query_page_inner(
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
        let page = page.max(1);
        let page_size = page_size.clamp(1, 5000);
        let offset = (page - 1) * page_size;

        let mut inner = self.lock()?;
        inner.ensure_database(database)?;

        let (inline_schema, name) = split_qualified(table.trim());
        let schema = inner.schema_of(inline_schema);
        let reference = table_ref(Some(&schema), name)?;

        let mut where_sql = String::new();
        if let (Some(col), Some(val)) = (filter_col, filter_value) {
            if ident_ok(col) {
                where_sql = format!(" WHERE {}::text ILIKE {}", quote(col), literal(&format!("%{val}%")));
            }
        }
        let order_sql = match (sort_col, sort_dir) {
            (Some(col), dir) if ident_ok(col) => {
                let d = if dir.unwrap_or("ASC").eq_ignore_ascii_case("DESC") {
                    "DESC"
                } else {
                    "ASC"
                };
                format!(" ORDER BY {} {d}", quote(col))
            }
            _ => String::new(),
        };

        let count_sql = format!("SELECT count(*) FROM {reference}{where_sql}");
        let total = first_i64(&run_simple(&mut inner.client, &count_sql)?);

        let data_sql = format!(
            "SELECT * FROM {reference}{where_sql}{order_sql} LIMIT {page_size} OFFSET {offset}"
        );

        // Prepare first: the statement description carries column names/types
        // even when the page is empty (empty tables still need headers).
        let (mut names, mut types) = {
            let stmt = inner.client.prepare(&data_sql)?;
            let names = stmt
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect::<Vec<_>>();
            let types = stmt
                .columns()
                .iter()
                .map(|c| c.type_().name().to_string())
                .collect::<Vec<_>>();
            (names, types)
        };

        let nullable = column_nullability(&mut inner.client, &schema, name);
        let data = run_simple(&mut inner.client, &data_sql)?;
        if names.is_empty() && !data.columns.is_empty() {
            names = data.columns.clone();
            types = vec![String::new(); names.len()];
        }

        let columns = names
            .iter()
            .enumerate()
            .map(|(i, n)| ColumnMeta {
                name: n.clone(),
                data_type: types.get(i).cloned().unwrap_or_default(),
                nullable: nullable.get(n).copied().unwrap_or(true),
            })
            .collect();

        Ok(RowsPage {
            columns,
            rows: data.rows,
            total,
            page,
            page_size,
        })
    }

    fn backend_pid_inner(&self) -> AppResult<Option<i64>> {
        let mut inner = self.lock()?;
        let out = run_simple(&mut inner.client, "SELECT pg_backend_pid()")?;
        Ok(Some(first_i64(&out)))
    }

    fn execute_sql_inner(&self, sql: &str) -> AppResult<QueryOutcome> {
        let started = Instant::now();
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("SQL 为空".into()));
        }
        let mut inner = self.lock()?;
        // Simple query protocol: supports multiple statements, INSERT..RETURNING,
        // VALUES, TABLE, CALL, DO, and returns every type as text.
        let out = run_simple(&mut inner.client, trimmed)?;
        Ok(QueryOutcome {
            columns: out.columns,
            rows: out.rows,
            rows_affected: out.affected,
            elapsed_ms: started.elapsed().as_millis(),
        })
    }

    fn use_database_inner(&self, database: Option<&str>) -> AppResult<()> {
        let mut inner = self.lock()?;
        inner.ensure_database(database)
    }

    fn apply_row_changes_inner(
        &self,
        database: Option<&str>,
        table: &str,
        changes: &[RowChange],
    ) -> AppResult<i64> {
        let mut inner = self.lock()?;
        inner.ensure_database(database)?;

        let (inline_schema, name) = split_qualified(table.trim());
        let schema = inner.schema_of(inline_schema);
        let reference = table_ref(Some(&schema), name)?;
        if changes.is_empty() {
            return Ok(0);
        }
        // Declared column types let us cast text parameters ($1::text::int4, ...).
        let types = column_info(&mut inner.client, &schema, name)?;

        let mut affected = 0i64;
        let mut tx = inner.client.transaction()?;
        for change in changes {
            match change.op.as_str() {
                "update" => {
                    if change.columns.is_empty()
                        || change.columns.len() != change.values.len()
                        || change.pk_columns.is_empty()
                        || change.pk_columns.len() != change.pk_values.len()
                    {
                        return Err(AppError::Validation("update 变更不合法".into()));
                    }
                    let mut params: Vec<Option<String>> = Vec::new();
                    let mut set_parts = Vec::new();
                    for (i, c) in change.columns.iter().enumerate() {
                        if !ident_ok(c) {
                            return Err(AppError::Validation(format!("非法列名: {c}")));
                        }
                        set_parts.push(format!(
                            "{} = {}",
                            quote(c),
                            placeholder(i + 1, types.get(c).map(|i| &i.typ))
                        ));
                        params.push(json_to_pg_text(&change.values[i]));
                    }
                    let mut where_parts = Vec::new();
                    for (i, c) in change.pk_columns.iter().enumerate() {
                        if !ident_ok(c) {
                            return Err(AppError::Validation(format!("非法列名: {c}")));
                        }
                        where_parts.push(format!(
                            "{} = {}",
                            quote(c),
                            placeholder(
                                change.columns.len() + i + 1,
                                types.get(c).map(|i| &i.typ),
                            )
                        ));
                        params.push(json_to_pg_text(&change.pk_values[i]));
                    }
                    let sql = format!(
                        "UPDATE {reference} SET {} WHERE {}",
                        set_parts.join(", "),
                        where_parts.join(" AND ")
                    );
                    let refs: Vec<&(dyn postgres::types::ToSql + Sync)> =
                        params.iter().map(|p| p as _).collect();
                    affected += tx.execute(&sql, &refs[..])? as i64;
                }
                "insert" => {
                    if change.columns.is_empty() || change.columns.len() != change.values.len() {
                        return Err(AppError::Validation("insert 变更不合法".into()));
                    }
                    let mut cols = Vec::new();
                    let mut marks = Vec::new();
                    let mut params: Vec<Option<String>> = Vec::new();
                    for c in change.columns.iter() {
                        if !ident_ok(c) {
                            return Err(AppError::Validation(format!("非法列名: {c}")));
                        }
                    }
                    for (i, c) in change.columns.iter().enumerate() {
                        let value = json_to_pg_text(&change.values[i]);
                        // Untouched grid cells arrive as NULL: let the server fill
                        // identity columns and DEFAULT expressions.
                        if value.is_none()
                            && types.get(c).map(|i| i.auto_filled).unwrap_or(false)
                        {
                            continue;
                        }
                        let idx = params.len() + 1;
                        cols.push(quote(c));
                        marks.push(placeholder(idx, types.get(c).map(|i| &i.typ)));
                        params.push(value);
                    }
                    if cols.is_empty() {
                        return Err(AppError::Validation(
                            "insert 至少需要一列非默认值".into(),
                        ));
                    }
                    let sql = format!(
                        "INSERT INTO {reference} ({}) VALUES ({})",
                        cols.join(", "),
                        marks.join(", ")
                    );
                    let refs: Vec<&(dyn postgres::types::ToSql + Sync)> =
                        params.iter().map(|p| p as _).collect();
                    affected += tx.execute(&sql, &refs[..])? as i64;
                }
                "delete" => {
                    if change.pk_columns.is_empty()
                        || change.pk_columns.len() != change.pk_values.len()
                    {
                        return Err(AppError::Validation("delete 变更不合法".into()));
                    }
                    let mut where_parts = Vec::new();
                    let mut params: Vec<Option<String>> = Vec::new();
                    for (i, c) in change.pk_columns.iter().enumerate() {
                        if !ident_ok(c) {
                            return Err(AppError::Validation(format!("非法列名: {c}")));
                        }
                        where_parts.push(format!(
                            "{} = {}",
                            quote(c),
                            placeholder(i + 1, types.get(c).map(|i| &i.typ))
                        ));
                        params.push(json_to_pg_text(&change.pk_values[i]));
                    }
                    let sql = format!(
                        "DELETE FROM {reference} WHERE {}",
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

    fn table_ddl_inner(&self, database: Option<&str>, table: &str) -> AppResult<String> {
        let mut inner = self.lock()?;
        inner.ensure_database(database)?;
        let (inline_schema, name) = split_qualified(table.trim());
        let schema = inner.schema_of(inline_schema);
        let reference = table_ref(Some(&schema), name)?;
        build_table_ddl(&mut inner.client, &schema, name, &reference)
    }
}

/// Parameters are always bound as text, then cast to the column type:
/// `$1::text::int4`. Casting straight to the column type would make the server
/// infer e.g. `boolean` for the parameter, which a text value cannot encode.
fn placeholder(idx: usize, typ: Option<&String>) -> String {
    match typ {
        Some(t) if !t.is_empty() => format!("${idx}::text::{t}"),
        _ => format!("${idx}::text"),
    }
}

fn json_to_pg_text(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::Bool(b) => Some(if *b { "true".into() } else { "false".into() }),
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

fn column_nullability(
    client: &mut Client,
    schema: &str,
    table: &str,
) -> std::collections::HashMap<String, bool> {
    let sql = format!(
        "SELECT a.attname, a.attnotnull
         FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = {} AND n.nspname = {}
           AND a.attnum > 0 AND NOT a.attisdropped",
        literal(table),
        literal(schema)
    );
    let mut map = std::collections::HashMap::new();
    if let Ok(out) = run_simple(client, &sql) {
        for row in &out.rows {
            let name = cell_str(row, 0);
            let notnull = cell_str(row, 1).eq_ignore_ascii_case("t");
            if !name.is_empty() {
                map.insert(name, !notnull);
            }
        }
    }
    map
}

/// Real `CREATE TABLE` / `CREATE VIEW` DDL assembled from the catalogs.
fn build_table_ddl(
    client: &mut Client,
    schema: &str,
    name: &str,
    reference: &str,
) -> AppResult<String> {
    let relkind = run_simple(
        client,
        &format!(
            "SELECT c.relkind FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = {} AND n.nspname = {}",
            literal(name),
            literal(schema)
        ),
    )?;
    let kind = relkind
        .rows
        .first()
        .map(|r| cell_str(r, 0))
        .unwrap_or_default();

    if kind == "v" || kind == "m" {
        let keyword = if kind == "m" {
            "CREATE MATERIALIZED VIEW"
        } else {
            "CREATE OR REPLACE VIEW"
        };
        let def = run_simple(
            client,
            &format!(
                "SELECT pg_catalog.pg_get_viewdef(c.oid, true)
                 FROM pg_catalog.pg_class c
                 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relname = {} AND n.nspname = {}",
                literal(name),
                literal(schema)
            ),
        )?;
        let body = def
            .rows
            .first()
            .map(|r| cell_str(r, 0))
            .unwrap_or_default();
        let body = body.trim().trim_end_matches(';');
        return Ok(format!("{keyword} {reference} AS\n{body};\n"));
    }

    let columns = run_simple(
        client,
        &format!(
            "SELECT a.attname,
                    pg_catalog.format_type(a.atttypid, a.atttypmod),
                    a.attnotnull,
                    COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), ''),
                    a.attidentity,
                    a.attgenerated,
                    COALESCE(pg_catalog.col_description(c.oid, a.attnum), '')
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             LEFT JOIN pg_catalog.pg_attrdef d
                    ON d.adrelid = c.oid AND d.adnum = a.attnum
             WHERE c.relname = {} AND n.nspname = {}
               AND a.attnum > 0 AND NOT a.attisdropped
             ORDER BY a.attnum",
            literal(name),
            literal(schema)
        ),
    )?;

    let mut defs: Vec<String> = Vec::new();
    let mut comments: Vec<String> = Vec::new();
    for row in &columns.rows {
        let col = cell_str(row, 0);
        let typ = cell_str(row, 1);
        let notnull = cell_str(row, 2).eq_ignore_ascii_case("t");
        let default = cell_str(row, 3);
        let identity = cell_str(row, 4);
        let generated = cell_str(row, 5);
        let comment = cell_str(row, 6);

        let mut line = format!("  {} {}", quote(&col), typ);
        match identity.as_str() {
            "a" => line.push_str(" GENERATED ALWAYS AS IDENTITY"),
            "d" => line.push_str(" GENERATED BY DEFAULT AS IDENTITY"),
            _ => {
                if !default.is_empty() {
                    if generated == "s" {
                        line.push_str(&format!(" GENERATED ALWAYS AS ({default}) STORED"));
                    } else {
                        line.push_str(&format!(" DEFAULT {default}"));
                    }
                }
            }
        }
        if notnull {
            line.push_str(" NOT NULL");
        }
        defs.push(line);
        if !comment.is_empty() {
            comments.push(format!(
                "COMMENT ON COLUMN {reference}.{} IS {};",
                quote(&col),
                literal(&comment)
            ));
        }
    }

    let constraints = run_simple(
        client,
        &format!(
            "SELECT con.conname, pg_catalog.pg_get_constraintdef(con.oid)
             FROM pg_catalog.pg_constraint con
             JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = {} AND n.nspname = {}
             ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1
                                       WHEN 'f' THEN 2 ELSE 3 END, con.conname",
            literal(name),
            literal(schema)
        ),
    )?;
    for row in &constraints.rows {
        let conname = cell_str(row, 0);
        let condef = cell_str(row, 1);
        if condef.is_empty() {
            continue;
        }
        defs.push(format!("  CONSTRAINT {} {}", quote(&conname), condef));
    }

    let mut out = format!("CREATE TABLE {reference} (\n{}\n);\n", defs.join(",\n"));

    let indexes = run_simple(
        client,
        &format!(
            "SELECT pg_catalog.pg_get_indexdef(x.indexrelid)
             FROM pg_catalog.pg_index x
             JOIN pg_catalog.pg_class c ON c.oid = x.indrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = {} AND n.nspname = {}
               AND NOT x.indisprimary
               AND NOT EXISTS (
                 SELECT 1 FROM pg_catalog.pg_constraint con
                 WHERE con.conindid = x.indexrelid AND con.conrelid = c.oid
               )
             ORDER BY 1",
            literal(name),
            literal(schema)
        ),
    )?;
    for row in &indexes.rows {
        let def = cell_str(row, 0);
        if !def.is_empty() {
            out.push_str(&def);
            out.push_str(";\n");
        }
    }

    let table_comment = run_simple(
        client,
        &format!(
            "SELECT COALESCE(pg_catalog.obj_description(c.oid, 'pg_class'), '')
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = {} AND n.nspname = {}",
            literal(name),
            literal(schema)
        ),
    )?;
    let table_comment = table_comment
        .rows
        .first()
        .map(|r| cell_str(r, 0))
        .unwrap_or_default();
    if !table_comment.is_empty() {
        out.push_str(&format!(
            "COMMENT ON TABLE {reference} IS {};\n",
            literal(&table_comment)
        ));
    }
    for c in comments {
        out.push_str(&c);
        out.push('\n');
    }
    Ok(out)
}


/// The blocking `postgres` driver builds and drives its own tokio runtime, which
/// panics ("Cannot start a runtime from within a runtime") when the call happens on
/// a tokio worker thread — and Tauri dispatches `#[tauri::command(async)]` bodies
/// there. Every public entry point therefore runs on a plain OS thread.
fn off_runtime<T: Send>(f: impl FnOnce() -> AppResult<T> + Send) -> AppResult<T> {
    std::thread::scope(|scope| {
        scope
            .spawn(f)
            .join()
            .unwrap_or_else(|_| Err(AppError::Message("PostgreSQL 工作线程异常退出".into())))
    })
}

impl DriverSession for PostgresSession {
    fn ping(&self) -> AppResult<()> {
        off_runtime(|| self.ping_inner())
    }

    fn list_databases(&self) -> AppResult<Vec<String>> {
        off_runtime(|| self.list_databases_inner())
    }

    fn list_schemas(&self, database: Option<&str>) -> AppResult<Vec<String>> {
        off_runtime(|| self.list_schemas_inner(database))
    }

    fn list_tables(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> AppResult<Vec<DbObject>> {
        off_runtime(|| self.list_tables_inner(database, schema))
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
        off_runtime(|| {
            self.query_page_inner(
                database,
                table,
                page,
                page_size,
                sort_col,
                sort_dir,
                filter_col,
                filter_value,
            )
        })
    }

    fn backend_pid(&self) -> AppResult<Option<i64>> {
        off_runtime(|| self.backend_pid_inner())
    }

    fn execute_sql(&self, sql: &str) -> AppResult<QueryOutcome> {
        off_runtime(|| self.execute_sql_inner(sql))
    }

    fn use_database(&self, database: Option<&str>) -> AppResult<()> {
        off_runtime(|| self.use_database_inner(database))
    }

    fn apply_row_changes(
        &self,
        database: Option<&str>,
        table: &str,
        changes: &[RowChange],
    ) -> AppResult<i64> {
        off_runtime(|| self.apply_row_changes_inner(database, table, changes))
    }

    fn table_ddl(&self, database: Option<&str>, table: &str) -> AppResult<String> {
        off_runtime(|| self.table_ddl_inner(database, table))
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
    fn qualified_names_are_split_and_quoted() {
        assert_eq!(split_qualified("public.t1"), (Some("public"), "t1"));
        assert_eq!(split_qualified("t1"), (None, "t1"));
        assert_eq!(
            table_ref(None, "sales.t1").unwrap(),
            "\"sales\".\"t1\"".to_string()
        );
        assert_eq!(table_ref(Some("public"), "t1").unwrap(), "\"public\".\"t1\"");
        assert_eq!(table_ref(None, "t1").unwrap(), "\"t1\"");
        // schema argument wins over an inline prefix
        assert_eq!(
            table_ref(Some("a"), "b.t1").unwrap(),
            "\"a\".\"t1\"".to_string()
        );
    }

    #[test]
    fn identifiers_and_literals_are_escaped() {
        assert_eq!(quote("a\"b"), "\"a\"\"b\"");
        assert_eq!(literal("o'brien"), "'o''brien'");
        assert_eq!(placeholder(1, None), "$1::text");
        assert_eq!(
            placeholder(2, Some(&"int4".to_string())),
            "$2::text::int4"
        );
    }

    #[test]
    fn json_values_are_bound_as_text() {
        assert_eq!(json_to_pg_text(&Value::Null), None);
        assert_eq!(json_to_pg_text(&Value::Bool(true)), Some("true".into()));
        assert_eq!(json_to_pg_text(&Value::from(42)), Some("42".into()));
        assert_eq!(
            json_to_pg_text(&Value::String("x".into())),
            Some("x".into())
        );
    }

    fn live_opts() -> Option<ConnectOpts> {
        if std::env::var("MYCAT_PG_TEST").ok().as_deref() != Some("1") {
            return None;
        }
        Some(ConnectOpts {
            engine: "postgres".into(),
            host: Some(std::env::var("MYCAT_PG_HOST").unwrap_or_else(|_| "127.0.0.1".into())),
            port: Some(
                std::env::var("MYCAT_PG_PORT")
                    .ok()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(5433),
            ),
            database: Some(std::env::var("MYCAT_PG_DB").unwrap_or_else(|_| "postgres".into())),
            user: Some(std::env::var("MYCAT_PG_USER").unwrap_or_else(|_| "postgres".into())),
            password: Some(std::env::var("MYCAT_PG_PASSWORD").unwrap_or_else(|_| "postgres".into())),
            ssl_mode: Some("disable".into()),
            ssl_trust: None,
            ssh_enabled: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
        })
    }

    /// Tauri dispatches `#[tauri::command(async)]` bodies on a tokio worker, so the
    /// blocking driver must not create a nested runtime there.
    #[test]
    fn postgres_connect_inside_async_runtime() {
        let Some(opts) = live_opts() else {
            return;
        };
        tauri::async_runtime::block_on(async {
            let session = PostgresSession::connect(&opts).expect("connect inside runtime");
            session.ping().expect("ping");
            let dbs = session.list_databases().expect("databases");
            assert!(!dbs.is_empty());
        });
    }

    /// Same, through the session pool used by the Tauri commands.
    #[test]
    fn postgres_pool_inside_async_runtime() {
        let Some(opts) = live_opts() else {
            return;
        };
        tauri::async_runtime::block_on(async {
            let pool = crate::session::SessionPool::new();
            pool.open("pg", opts.clone()).expect("open");
            let dbs = pool
                .with_session("pg", |s| s.list_databases())
                .expect("databases");
            assert!(!dbs.is_empty());
            let tables = pool
                .with_session("pg", |s| s.list_tables(None, None))
                .expect("tables");
            assert!(tables.len() < 100_000);
            pool.close("pg").expect("close");
        });
    }

    /// End-to-end check against a real server: `MYCAT_PG_TEST=1 cargo test --lib postgres_live`.
    #[test]
    fn postgres_live_roundtrip() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = PostgresSession::connect(&opts).expect("connect");
        session.ping().expect("ping");
        session
            .execute_sql(
                "DROP SCHEMA IF EXISTS mycat_test CASCADE;
                 CREATE SCHEMA mycat_test;
                 CREATE TABLE mycat_test.sample (
                   id serial PRIMARY KEY,
                   name text NOT NULL,
                   active boolean DEFAULT true,
                   amount numeric(12,2),
                   created_at timestamptz DEFAULT now(),
                   tags text[],
                   meta jsonb
                 );
                 COMMENT ON TABLE mycat_test.sample IS 'mycat test table';",
            )
            .expect("setup");

        // list_tables exposes non-public schemas with a qualified name
        let tables = session.list_tables(None, None).expect("list");
        assert!(tables.iter().any(|t| t.name == "mycat_test.sample"));

        // PG has no table-level collation: the column falls back to the database
        // default, while create/update timestamps stay unavailable.
        let sample = tables
            .iter()
            .find(|t| t.name == "mycat_test.sample")
            .expect("sample row");
        assert!(sample
            .collation
            .as_deref()
            .map_or(false, |c| !c.is_empty()));
        assert!(sample.create_time.is_none());
        assert!(sample.update_time.is_none());

        // schemas exclude the system catalogs
        let schemas = session.list_schemas(None).expect("schemas");
        assert!(schemas.iter().any(|s| s == "public"));
        assert!(schemas.iter().any(|s| s == "mycat_test"));
        assert!(!schemas.iter().any(|s| s == "pg_catalog"));

        // empty table still reports columns
        let empty = session
            .query_page(None, "mycat_test.sample", 1, 10, None, None, None, None)
            .expect("page");
        assert_eq!(empty.total, 0);
        assert_eq!(empty.columns.len(), 7);
        assert_eq!(empty.columns[1].name, "name");
        assert!(!empty.columns[1].nullable);

        // insert through row changes (non-text columns must be cast, not rejected)
        let inserted = session
            .apply_row_changes(
                None,
                "mycat_test.sample",
                &[RowChange {
                    op: "insert".into(),
                    pk_columns: vec![],
                    pk_values: vec![],
                    columns: vec![
                        "id".into(),
                        "name".into(),
                        "active".into(),
                        "amount".into(),
                        "created_at".into(),
                        "tags".into(),
                        "meta".into(),
                    ],
                    values: vec![
                        // untouched grid cells: identity / DEFAULT must be filled by the server
                        Value::Null,
                        Value::String("第一条".into()),
                        Value::Bool(false),
                        Value::from(12.5),
                        Value::Null,
                        Value::String("{a,b}".into()),
                        Value::String("{\"k\":1}".into()),
                    ],
                }],
            )
            .expect("insert");
        assert_eq!(inserted, 1);

        let page = session
            .query_page(
                None,
                "mycat_test.sample",
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
        assert_eq!(page.rows[0][2], Value::String("f".into()));
        assert_eq!(page.rows[0][5], Value::String("{a,b}".into()));

        let id = page.rows[0][0].clone();
        let updated = session
            .apply_row_changes(
                None,
                "mycat_test.sample",
                &[RowChange {
                    op: "update".into(),
                    pk_columns: vec!["id".into()],
                    pk_values: vec![id.clone()],
                    columns: vec!["name".into(), "amount".into()],
                    values: vec![Value::String("改名".into()), Value::from(99)],
                }],
            )
            .expect("update");
        assert_eq!(updated, 1);

        // multiple statements + RETURNING both work through the simple protocol
        let out = session
            .execute_sql("SELECT count(*) FROM mycat_test.sample; SELECT name FROM mycat_test.sample")
            .expect("multi");
        assert_eq!(out.columns, vec!["name".to_string()]);
        assert_eq!(out.rows[0][0], Value::String("改名".into()));

        let ddl = session
            .table_ddl(None, "mycat_test.sample")
            .expect("ddl");
        assert!(ddl.contains("CREATE TABLE \"mycat_test\".\"sample\""));
        assert!(ddl.contains("PRIMARY KEY"));
        assert!(ddl.contains("COMMENT ON TABLE"));

        // server errors must surface the real message, not just "db error"
        let err = session
            .execute_sql("SELECT * FROM no_such_table_here")
            .expect_err("missing relation");
        let msg = err.to_string();
        assert!(msg.contains("does not exist"), "unexpected error: {msg}");

        // views: page + DDL
        session
            .execute_sql(
                "CREATE VIEW mycat_test.sample_v AS SELECT id, name FROM mycat_test.sample",
            )
            .expect("view");
        let view_page = session
            .query_page(None, "mycat_test.sample_v", 1, 10, None, None, None, None)
            .expect("view page");
        assert_eq!(view_page.columns.len(), 2);
        let view_ddl = session
            .table_ddl(None, "mycat_test.sample_v")
            .expect("view ddl");
        assert!(view_ddl.contains("CREATE OR REPLACE VIEW"));

        let deleted = session
            .apply_row_changes(
                None,
                "mycat_test.sample",
                &[RowChange {
                    op: "delete".into(),
                    pk_columns: vec!["id".into()],
                    pk_values: vec![id],
                    columns: vec![],
                    values: vec![],
                }],
            )
            .expect("delete");
        assert_eq!(deleted, 1);

        session
            .execute_sql("DROP SCHEMA mycat_test CASCADE")
            .expect("cleanup");
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
