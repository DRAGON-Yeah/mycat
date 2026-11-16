use crate::error::{AppError, AppResult};
use crate::paths::{credentials_enc_path, master_key_fallback_path};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

const SERVICE: &str = "my-navicat";
const MASTER_ACCOUNT: &str = "master-key";

#[derive(Default, Serialize, Deserialize)]
struct EncFile {
    /// hex(nonce || ciphertext) per secret_ref
    secrets: HashMap<String, String>,
}

fn try_keyring_set(account: &str, secret: &str) -> AppResult<()> {
    // Unit tests must not block on macOS Keychain UI prompts.
    if cfg!(test) {
        return Err(AppError::Vault("keyring skipped in tests".into()));
    }
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Vault(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| AppError::Vault(e.to_string()))
}

fn try_keyring_get(account: &str) -> AppResult<Option<String>> {
    if cfg!(test) {
        return Ok(None);
    }
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Vault(e.to_string()))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Vault(e.to_string())),
    }
}

fn try_keyring_delete(account: &str) -> AppResult<()> {
    if cfg!(test) {
        return Ok(());
    }
    let entry = keyring::Entry::new(SERVICE, account)
        .map_err(|e| AppError::Vault(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Vault(e.to_string())),
    }
}

fn load_or_create_master_key() -> AppResult<[u8; 32]> {
    if let Ok(Some(hex_key)) = try_keyring_get(MASTER_ACCOUNT) {
        let bytes = hex::decode(hex_key).map_err(|e| AppError::Crypto(e.to_string()))?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
    }

    let path = master_key_fallback_path()?;
    if path.exists() {
        let hex_key = fs::read_to_string(&path)?;
        let bytes = hex::decode(hex_key.trim()).map_err(|e| AppError::Crypto(e.to_string()))?;
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            let _ = try_keyring_set(MASTER_ACCOUNT, &hex::encode(key));
            return Ok(key);
        }
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let encoded = hex::encode(key);
    if try_keyring_set(MASTER_ACCOUNT, &encoded).is_err() {
        fs::write(path, &encoded)?;
    }
    Ok(key)
}

fn load_enc_file() -> AppResult<EncFile> {
    let path = credentials_enc_path()?;
    if !path.exists() {
        return Ok(EncFile::default());
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn save_enc_file(file: &EncFile) -> AppResult<()> {
    let path = credentials_enc_path()?;
    let raw = serde_json::to_string_pretty(file).map_err(|e| AppError::Message(e.to_string()))?;
    fs::write(path, raw)?;
    Ok(())
}

fn encrypt_to_hex(key: &[u8; 32], plaintext: &str) -> AppResult<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(hex::encode(out))
}

fn decrypt_from_hex(key: &[u8; 32], payload: &str) -> AppResult<String> {
    let bytes = hex::decode(payload).map_err(|e| AppError::Crypto(e.to_string()))?;
    if bytes.len() < 13 {
        return Err(AppError::Crypto("密载荷过短".into()));
    }
    let (nonce_bytes, ciphertext) = bytes.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    String::from_utf8(plain).map_err(|e| AppError::Crypto(e.to_string()))
}

/// Store secret. Prefer OS keyring; always mirror into encrypted file for CI/fallback.
pub fn set_secret(secret_ref: &str, secret: &str) -> AppResult<()> {
    let account = format!("conn:{secret_ref}");
    let _ = try_keyring_set(&account, secret);

    let master = load_or_create_master_key()?;
    let mut file = load_enc_file()?;
    file.secrets
        .insert(secret_ref.to_string(), encrypt_to_hex(&master, secret)?);
    save_enc_file(&file)
}

pub fn get_secret(secret_ref: &str) -> AppResult<Option<String>> {
    let account = format!("conn:{secret_ref}");
    if let Ok(Some(v)) = try_keyring_get(&account) {
        return Ok(Some(v));
    }

    let master = load_or_create_master_key()?;
    let file = load_enc_file()?;
    match file.secrets.get(secret_ref) {
        Some(payload) => Ok(Some(decrypt_from_hex(&master, payload)?)),
        None => Ok(None),
    }
}

pub fn delete_secret(secret_ref: &str) -> AppResult<()> {
    let account = format!("conn:{secret_ref}");
    let _ = try_keyring_delete(&account);
    let mut file = load_enc_file()?;
    file.secrets.remove(secret_ref);
    save_enc_file(&file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn secret_roundtrip_not_plaintext_in_enc_file() {
        let _guard = LOCK.lock().unwrap();
        let secret_ref = "test-secret-ref";
        let password = "S3cret-P@ssw0rd!";
        set_secret(secret_ref, password).expect("set");
        let got = get_secret(secret_ref).expect("get").expect("present");
        assert_eq!(got, password);

        let raw = fs::read_to_string(credentials_enc_path().unwrap()).unwrap();
        assert!(
            !raw.contains(password),
            "credentials.enc must not contain plaintext password"
        );
        let _ = delete_secret(secret_ref);
    }
}
