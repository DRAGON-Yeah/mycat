use crate::error::{AppError, AppResult};
use std::fs;
use std::path::PathBuf;

pub fn app_data_dir() -> AppResult<PathBuf> {
    let dir = dirs::data_dir()
        .ok_or_else(|| AppError::Message("无法定位应用数据目录".into()))?
        .join("my-navicat");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn meta_db_path() -> AppResult<PathBuf> {
    Ok(app_data_dir()?.join("meta.db"))
}

pub fn credentials_enc_path() -> AppResult<PathBuf> {
    Ok(app_data_dir()?.join("credentials.enc"))
}

pub fn master_key_fallback_path() -> AppResult<PathBuf> {
    Ok(app_data_dir()?.join("master.key"))
}
