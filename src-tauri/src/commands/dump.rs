use crate::adapters::{DriverSession, RowsPage};
use crate::error::{AppError, AppResult};
use crate::session::SessionPool;
use serde_json::Value;
use tauri::State;

fn ident_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn sql_literal(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

fn quote_ident(engine: &str, name: &str) -> String {
    if engine == "mysql" {
        format!("`{}`", name.replace('`', "``"))
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

fn dump_inserts(engine: &str, table: &str, page: &RowsPage) -> String {
    if page.rows.is_empty() {
        return String::new();
    }
    let table_q = quote_ident(engine, table);
    let cols = page
        .columns
        .iter()
        .map(|c| quote_ident(engine, &c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let mut out = String::new();
    const BATCH: usize = 100;
    for chunk in page.rows.chunks(BATCH) {
        let values_list = chunk
            .iter()
            .map(|row| {
                let values = row.iter().map(sql_literal).collect::<Vec<_>>().join(", ");
                format!("({values})")
            })
            .collect::<Vec<_>>()
            .join(",\n  ");
        out.push_str(&format!(
            "INSERT INTO {table_q} ({cols}) VALUES\n  {values_list};\n"
        ));
    }
    out
}

fn dump_structure(
    session: &dyn DriverSession,
    engine_hint: &str,
    database: Option<&str>,
    table: &str,
) -> AppResult<String> {
    if engine_hint == "sqlite" || engine_hint.is_empty() {
        if let Ok(out) = session.execute_sql(&format!(
            "SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = '{table}'"
        )) {
            if let Some(row) = out.rows.first() {
                if let Some(Value::String(sql)) = row.first() {
                    return Ok(format!("{sql};\n\n"));
                }
            }
        }
    }
    if engine_hint == "mysql" {
        let table_sql = match database.map(str::trim).filter(|d| !d.is_empty()) {
            Some(db) if ident_ok(db) => format!("`{db}`.`{table}`"),
            _ => format!("`{table}`"),
        };
        if let Ok(out) = session.execute_sql(&format!("SHOW CREATE TABLE {table_sql}")) {
            if let Some(row) = out.rows.first() {
                if let Some(Value::String(sql)) = row.get(1).or_else(|| row.first()) {
                    return Ok(format!("{sql};\n\n"));
                }
            }
        }
    }
    // Postgres / fallback: emit a comment + column list from one page
    let page = session.query_page(database, table, 1, 1, None, None, None, None)?;
    let cols = page
        .columns
        .iter()
        .map(|c| format!("  \"{}\" {}", c.name, c.data_type))
        .collect::<Vec<_>>()
        .join(",\n");
    Ok(format!(
        "-- Structure inferred from live metadata\nCREATE TABLE IF NOT EXISTS \"{table}\" (\n{cols}\n);\n\n"
    ))
}

fn export_all_pages(
    session: &dyn DriverSession,
    database: Option<&str>,
    table: &str,
) -> AppResult<RowsPage> {
    let page_size = 500i64;
    let mut page = 1i64;
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total = 0i64;
    loop {
        let chunk = session.query_page(database, table, page, page_size, None, None, None, None)?;
        if page == 1 {
            columns = chunk.columns.clone();
            total = chunk.total;
        }
        let empty = chunk.rows.is_empty();
        rows.extend(chunk.rows);
        if rows.len() as i64 >= total || empty {
            break;
        }
        page += 1;
    }
    Ok(RowsPage {
        columns,
        rows,
        total,
        page: 1,
        page_size: total.max(1),
    })
}

#[tauri::command]
pub fn dump_table_sql(
    pool: State<'_, SessionPool>,
    connection_id: String,
    table: String,
    include_data: bool,
    engine: String,
    database: Option<String>,
) -> Result<String, String> {
    if !ident_ok(&table) {
        return Err(AppError::Validation("非法表名".into()).to_string());
    }
    pool.with_session(&connection_id, |session| {
        let mut out = String::new();
        out.push_str(&format!("-- Dump of {table}\n"));
        out.push_str(&dump_structure(
            session,
            &engine,
            database.as_deref(),
            &table,
        )?);
        if include_data {
            if engine == "mysql" {
                out.push_str("SET FOREIGN_KEY_CHECKS=0;\n");
            }
            let data = export_all_pages(session, database.as_deref(), &table)?;
            out.push_str(&dump_inserts(&engine, &table, &data));
            if engine == "mysql" {
                out.push_str("SET FOREIGN_KEY_CHECKS=1;\n");
            }
        }
        Ok(out)
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::{sqlite::SqliteSession, ConnectOpts};
    use std::fs;

    #[test]
    fn dump_sqlite_includes_create_and_insert() {
        let path = std::env::temp_dir().join(format!("dump-{}.db", uuid::Uuid::new_v4()));
        let _ = fs::remove_file(&path);
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE demo(id INTEGER PRIMARY KEY, name TEXT);
                 INSERT INTO demo(name) VALUES ('x');",
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
        let mut sql = String::new();
        sql.push_str(&dump_structure(&session, "sqlite", None, "demo").unwrap());
        let data = export_all_pages(&session, None, "demo").unwrap();
        sql.push_str(&dump_inserts("sqlite", "demo", &data));
        assert!(sql.contains("CREATE TABLE"));
        assert!(sql.contains("INSERT INTO"));
        let _ = fs::remove_file(&path);
    }
}
