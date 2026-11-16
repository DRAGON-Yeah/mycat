mod adapters;
mod commands;
mod error;
mod logging;
mod meta;
mod paths;
mod session;
mod settings;
mod tunnel;
mod vault;

use meta::MetaDb;
use session::SessionPool;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_setting(state: tauri::State<'_, MetaDb>, key: String) -> Result<Option<String>, String> {
    state.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(state: tauri::State<'_, MetaDb>, key: String, value: String) -> Result<(), String> {
    state.set_setting(&key, &value).map_err(|e| e.to_string())
}

fn migrate_legacy_settings(db: &MetaDb) {
    if db.get_setting("theme").ok().flatten().is_some() {
        return;
    }
    if let Ok(Some(theme)) = settings::get_setting("theme") {
        let _ = db.set_setting("theme", &theme);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _ = logging::init();
            let db = MetaDb::open().map_err(|e| {
                logging::log_line("ERROR", &format!("meta open failed: {e}"));
                e.to_string()
            })?;
            migrate_legacy_settings(&db);
            app.manage(db);
            app.manage(SessionPool::new());
            logging::log_line("INFO", "application setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_setting,
            set_setting,
            logging::write_log,
            commands::connections::list_connections,
            commands::connections::upsert_connection,
            commands::connections::delete_connection,
            commands::connections::export_connections,
            commands::connections::import_connections,
            commands::session::test_connection,
            commands::session::open_connection,
            commands::session::close_connection,
            commands::session::list_databases,
            commands::session::list_schemas,
            commands::session::list_tables,
            commands::session::fetch_table_page,
            commands::session::execute_sql,
            commands::session::apply_row_changes,
            commands::dump::dump_table_sql,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
