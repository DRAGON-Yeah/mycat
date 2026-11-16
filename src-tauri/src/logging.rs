use crate::error::AppResult;
use crate::paths::app_data_dir;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static LOGGER: Mutex<Option<std::fs::File>> = Mutex::new(None);

pub fn init() -> AppResult<()> {
    let dir = app_data_dir()?.join("logs");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("app.log");
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    {
        // Must release the mutex before calling log_line (same lock, non-reentrant).
        let mut guard = LOGGER
            .lock()
            .map_err(|_| crate::error::AppError::Message("log lock".into()))?;
        *guard = Some(file);
    }
    log_line("INFO", "logger initialized");
    Ok(())
}

pub fn log_line(level: &str, message: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("[{ts}] [{level}] {message}\n");
    if let Ok(mut guard) = LOGGER.lock() {
        if let Some(file) = guard.as_mut() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
    }
}

#[tauri::command]
pub fn write_log(level: String, message: String) -> Result<(), String> {
    // Basic redaction for accidental secrets in UI-reported logs.
    let redacted = message
        .replace("password=", "password=***")
        .replace("PASSWORD=", "PASSWORD=***");
    log_line(&level, &redacted);
    Ok(())
}
