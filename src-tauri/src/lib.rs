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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let _ = logging::init();
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
            }
            let db = MetaDb::open().map_err(|e| {
                logging::log_line("ERROR", &format!("meta open failed: {e}"));
                e.to_string()
            })?;
            migrate_legacy_settings(&db);
            app.manage(db);
            app.manage(SessionPool::new());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.center();
                let _ = window.set_focus();
                logging::log_line("INFO", "main window focused");
            } else {
                logging::log_line("ERROR", "main window missing after setup");
            }
            logging::log_line("INFO", "application setup complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 点关闭按钮不退出进程：macOS 隐藏窗口（点 Dock 图标恢复），
                // 其它平台最小化到任务栏。真正退出用 ⌘Q / 菜单「退出」。
                api.prevent_close();
                #[cfg(target_os = "macos")]
                let _ = window.hide();
                #[cfg(not(target_os = "macos"))]
                let _ = window.minimize();
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_setting,
            set_setting,
            logging::write_log,
            commands::connections::list_connections,
            commands::connections::upsert_connection,
            commands::connections::delete_connection,
            commands::connections::get_connection_secrets,
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
            commands::session::execute_sql_batch,
            commands::session::cancel_query,
            commands::session::cancel_sql_batch,
            commands::session::apply_row_changes,
            commands::session::get_table_ddl,
            commands::dump::dump_table_sql,
            commands::files::write_text_file,
            commands::queries::list_saved_queries,
            commands::queries::upsert_saved_query,
            commands::queries::delete_saved_query,
            commands::queries::get_saved_query,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS：点击 Dock 图标时把隐藏的主窗口重新显示出来。
            #[cfg(target_os = "macos")]
            {
                if let tauri::RunEvent::Reopen {
                    has_visible_windows,
                    ..
                } = event
                {
                    if !has_visible_windows {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app_handle, event);
            }
        });
}
