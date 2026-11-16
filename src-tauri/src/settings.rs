use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub values: HashMap<String, String>,
}

fn settings_path() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "无法定位应用数据目录".to_string())?
        .join("mycat");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn get_setting(key: &str) -> Result<Option<String>, String> {
    let settings = load_settings()?;
    Ok(settings.values.get(key).cloned())
}

#[cfg(test)]
fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[cfg(test)]
pub fn set_setting(key: String, value: String) -> Result<(), String> {
    let mut settings = load_settings()?;
    settings.values.insert(key, value);
    save_settings(&settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn persists_theme_roundtrip() {
        let _guard = LOCK.lock().unwrap();
        set_setting("theme".into(), "dark".into()).expect("set");
        let got = get_setting("theme").expect("get");
        assert_eq!(got.as_deref(), Some("dark"));
        set_setting("theme".into(), "light".into()).expect("reset");
    }
}
