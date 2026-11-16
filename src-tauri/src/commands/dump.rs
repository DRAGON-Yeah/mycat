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

fn dump_inserts(table: &str, page: &RowsPage) -> String {
    if page.rows.is_empty() {
        return String::new();
    }
    let cols = page
        .columns
        .iter()
        .map(|c| format!("\"{}\"", c.name))
        .collect::<Vec<_>>()
        .join(", ");
    let mut out = String::new();
    for row in &page.rows {
        let values = row.iter().map(sql_literal).collect::<Vec<_>>().join(", ");
        out.push_str(&format!(
            "INSERT INTO \"{table}\" ({cols}) VALUES ({values});\n"
        ));
    }
    out
}

fn dump_structure(session: &dyn DriverSession, engine_hint: &str, table: &str) -> AppResult<String> {
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
        if let Ok(out) = session.execute_sql(&format!("SHOW CREATE TABLE `{table}`")) {
            if let Some(row) = out.rows.first() {
                if let Some(Value::String(sql)) = row.get(1).or_else(|| row.first()) {
                    return Ok(format!("{sql};\n\n"));
                }
            }
        }
    }
    // Postgres / fallback: emit a comment + column list from one page
    let page = session.query_page(table, 1, 1, None, None, None, None)?;
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

fn export_all_pages(session: &dyn DriverSession, table: &str) -> AppResult<RowsPage> {
    let page_size = 500i64;
    let mut page = 1i64;
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    let mut total = 0i64;
    loop {
        let chunk = session.query_page(table, page, page_size, None, None, None, None)?;
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
) -> Result<String, String> {
    if !ident_ok(&table) {
        return Err(AppError::Validation("非法表名".into()).to_string());
    }
    pool.with_session(&connection_id, |session| {
        let mut out = String::new();
        out.push_str(&format!("-- Dump of {table}\n"));
        out.push_str(&dump_structure(session, &engine, &table)?);
        if include_data {
            let data = export_all_pages(session, &table)?;
            out.push_str(&dump_inserts(&table, &data));
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
        sql.push_str(&dump_structure(&session, "sqlite", "demo").unwrap());
        let data = export_all_pages(&session, "demo").unwrap();
        sql.push_str(&dump_inserts("demo", &data));
        assert!(sql.contains("CREATE TABLE"));
        assert!(sql.contains("INSERT INTO"));
        let _ = fs::remove_file(&path);
    }
}
