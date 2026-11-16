use crate::error::{AppError, AppResult};
use crate::paths::meta_db_path;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct MetaDb {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub user: Option<String>,
    pub ssl_mode: String,
    pub ssl_trust: bool,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub color: Option<String>,
    pub starred: bool,
    pub group_name: Option<String>,
    pub hidden: bool,
    pub secret_ref: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl MetaDb {
    pub fn open() -> AppResult<Self> {
        let path = meta_db_path()?;
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Message("meta lock".into()))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY NOT NULL,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS connections (
              id TEXT PRIMARY KEY NOT NULL,
              name TEXT NOT NULL,
              engine TEXT NOT NULL,
              host TEXT,
              port INTEGER,
              database_name TEXT,
              user_name TEXT,
              ssl_mode TEXT NOT NULL DEFAULT 'disable',
              ssl_trust INTEGER NOT NULL DEFAULT 0,
              ssh_enabled INTEGER NOT NULL DEFAULT 0,
              ssh_host TEXT,
              ssh_port INTEGER,
              ssh_user TEXT,
              color TEXT,
              starred INTEGER NOT NULL DEFAULT 0,
              group_name TEXT,
              hidden INTEGER NOT NULL DEFAULT 0,
              secret_ref TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            "#,
        )?;
        // Soft migrate for older meta.db created before ssl_trust.
        let _ = conn.execute(
            "ALTER TABLE connections ADD COLUMN ssl_trust INTEGER NOT NULL DEFAULT 0",
            [],
        );
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().map_err(|_| AppError::Message("meta lock".into()))?;
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Message("meta lock".into()))?;
        conn.execute(
            "INSERT INTO app_settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn upsert_connection(&self, record: &ConnectionRecord) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Message("meta lock".into()))?;
        conn.execute(
            r#"
            INSERT INTO connections (
              id, name, engine, host, port, database_name, user_name, ssl_mode, ssl_trust,
              ssh_enabled, ssh_host, ssh_port, ssh_user, color, starred, group_name,
              hidden, secret_ref, created_at, updated_at
            ) VALUES (
              ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20
            )
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name,
              engine=excluded.engine,
              host=excluded.host,
              port=excluded.port,
              database_name=excluded.database_name,
              user_name=excluded.user_name,
              ssl_mode=excluded.ssl_mode,
              ssl_trust=excluded.ssl_trust,
              ssh_enabled=excluded.ssh_enabled,
              ssh_host=excluded.ssh_host,
              ssh_port=excluded.ssh_port,
              ssh_user=excluded.ssh_user,
              color=excluded.color,
              starred=excluded.starred,
              group_name=excluded.group_name,
              hidden=excluded.hidden,
              secret_ref=excluded.secret_ref,
              updated_at=excluded.updated_at
            "#,
            params![
                record.id,
                record.name,
                record.engine,
                record.host,
                record.port,
                record.database,
                record.user,
                record.ssl_mode,
                record.ssl_trust as i64,
                record.ssh_enabled as i64,
                record.ssh_host,
                record.ssh_port,
                record.ssh_user,
                record.color,
                record.starred as i64,
                record.group_name,
                record.hidden as i64,
                record.secret_ref,
                record.created_at,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_connections(&self) -> AppResult<Vec<ConnectionRecord>> {
        let conn = self.conn.lock().map_err(|_| AppError::Message("meta lock".into()))?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, name, engine, host, port, database_name, user_name, ssl_mode, ssl_trust,
                   ssh_enabled, ssh_host, ssh_port, ssh_user, color, starred, group_name,
                   hidden, secret_ref, created_at, updated_at
            FROM connections
            ORDER BY starred DESC, name ASC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ConnectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                engine: row.get(2)?,
                host: row.get(3)?,
                port: row.get(4)?,
                database: row.get(5)?,
                user: row.get(6)?,
                ssl_mode: row.get(7)?,
                ssl_trust: row.get::<_, i64>(8)? != 0,
                ssh_enabled: row.get::<_, i64>(9)? != 0,
                ssh_host: row.get(10)?,
                ssh_port: row.get(11)?,
                ssh_user: row.get(12)?,
                color: row.get(13)?,
                starred: row.get::<_, i64>(14)? != 0,
                group_name: row.get(15)?,
                hidden: row.get::<_, i64>(16)? != 0,
                secret_ref: row.get(17)?,
                created_at: row.get(18)?,
                updated_at: row.get(19)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn delete_connection(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(|_| AppError::Message("meta lock".into()))?;
        conn.execute("DELETE FROM connections WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_connection(&self, id: &str) -> AppResult<Option<ConnectionRecord>> {
        Ok(self
            .list_connections()?
            .into_iter()
            .find(|c| c.id == id))
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault;
    use std::fs;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn connection_password_not_stored_in_meta_db() {
        let _guard = LOCK.lock().unwrap();
        let db = MetaDb::open().expect("open meta");
        let secret_ref = uuid::Uuid::new_v4().to_string();
        let password = "PlainTextMustNotAppear";
        vault::set_secret(&secret_ref, password).expect("vault");

        let now = "2026-11-16T00:00:00Z".to_string();
        let record = ConnectionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            name: "demo".into(),
            engine: "sqlite".into(),
            host: Some("/tmp/demo.db".into()),
            port: None,
            database: None,
            user: None,
            ssl_mode: "disable".into(),
            ssl_trust: false,
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            color: None,
            starred: false,
            group_name: None,
            hidden: false,
            secret_ref: Some(secret_ref.clone()),
            created_at: now.clone(),
            updated_at: now,
        };
        db.upsert_connection(&record).expect("upsert");

        let meta_path = meta_db_path().expect("meta path");
        let meta_bytes = fs::read(&meta_path).unwrap();
        let haystack = String::from_utf8_lossy(&meta_bytes);
        assert!(
            !haystack.contains(password),
            "meta.db must not contain plaintext password (path={})",
            meta_path.display()
        );

        let got = vault::get_secret(&secret_ref).unwrap().unwrap();
        assert_eq!(got, password);
        let _ = vault::delete_secret(&secret_ref);
        let _ = db.delete_connection(&record.id);
    }
}
