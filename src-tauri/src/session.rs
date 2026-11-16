use crate::adapters::{connect, ConnectOpts, DriverSession};
use crate::error::{AppError, AppResult};
use crate::meta::MetaDb;
use crate::tunnel::{SshParams, SshTunnel};
use crate::vault;
use rusqlite::InterruptHandle;
use std::collections::HashMap;
use std::sync::Mutex;

struct LiveSession {
    session: Box<dyn DriverSession>,
    _tunnel: Option<SshTunnel>,
}

pub struct SessionPool {
    sessions: Mutex<HashMap<String, LiveSession>>,
    /// Resolved opts for side-channel KILL / pg_cancel (tunnel-rewritten).
    cancel_opts: Mutex<HashMap<String, ConnectOpts>>,
    /// connection_id → backend pid while a query is running (0 = sqlite / unknown).
    active_pids: Mutex<HashMap<String, i64>>,
    /// SQLite interrupt handles (callable while Connection is busy).
    sqlite_interrupts: Mutex<HashMap<String, InterruptHandle>>,
}

impl SessionPool {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            cancel_opts: Mutex::new(HashMap::new()),
            active_pids: Mutex::new(HashMap::new()),
            sqlite_interrupts: Mutex::new(HashMap::new()),
        }
    }

    pub fn test_connect(opts: &ConnectOpts) -> AppResult<()> {
        let (resolved, _tunnel) = resolve_with_tunnel(opts.clone())?;
        let _session = connect(&resolved)?;
        Ok(())
    }

    pub fn open(&self, connection_id: &str, opts: ConnectOpts) -> AppResult<()> {
        let (resolved, tunnel) = resolve_with_tunnel(opts)?;
        let engine = resolved.engine.clone();
        let session = connect(&resolved)?;

        // Capture SQLite interrupt handle before moving session into the pool.
        let sqlite_ih = if engine == "sqlite" {
            session.sqlite_interrupt_handle()
        } else {
            None
        };

        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| AppError::Message("session lock".into()))?;
        guard.insert(
            connection_id.to_string(),
            LiveSession {
                session,
                _tunnel: tunnel,
            },
        );
        drop(guard);

        let mut opts_guard = self
            .cancel_opts
            .lock()
            .map_err(|_| AppError::Message("cancel opts lock".into()))?;
        opts_guard.insert(connection_id.to_string(), resolved);
        drop(opts_guard);

        if let Some(ih) = sqlite_ih {
            let mut map = self
                .sqlite_interrupts
                .lock()
                .map_err(|_| AppError::Message("interrupt lock".into()))?;
            map.insert(connection_id.to_string(), ih);
        }

        Ok(())
    }

    pub fn close(&self, connection_id: &str) -> AppResult<()> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| AppError::Message("session lock".into()))?;
        guard.remove(connection_id);
        drop(guard);
        if let Ok(mut m) = self.cancel_opts.lock() {
            m.remove(connection_id);
        }
        if let Ok(mut m) = self.active_pids.lock() {
            m.remove(connection_id);
        }
        if let Ok(mut m) = self.sqlite_interrupts.lock() {
            m.remove(connection_id);
        }
        Ok(())
    }

    pub fn with_session<R>(
        &self,
        connection_id: &str,
        f: impl FnOnce(&dyn DriverSession) -> AppResult<R>,
    ) -> AppResult<R> {
        let guard = self
            .sessions
            .lock()
            .map_err(|_| AppError::Message("session lock".into()))?;
        let live = guard
            .get(connection_id)
            .ok_or_else(|| AppError::Message("连接未打开".into()))?;
        f(live.session.as_ref())
    }

    /// Capture backend pid before a long-running execute (call while session is idle).
    pub fn begin_query(&self, connection_id: &str) -> AppResult<()> {
        let pid = self.with_session(connection_id, |s| s.backend_pid())?;
        let mut pids = self
            .active_pids
            .lock()
            .map_err(|_| AppError::Message("cancel lock".into()))?;
        pids.insert(connection_id.to_string(), pid.unwrap_or(0));
        Ok(())
    }

    pub fn end_query(&self, connection_id: &str) {
        if let Ok(mut pids) = self.active_pids.lock() {
            pids.remove(connection_id);
        }
    }

    /// Cancel in-flight query without taking the session lock (side channel / interrupt).
    pub fn cancel_query(&self, connection_id: &str) -> AppResult<()> {
        // SQLite: interrupt from another thread while Connection is busy.
        if let Ok(map) = self.sqlite_interrupts.lock() {
            if let Some(handle) = map.get(connection_id) {
                handle.interrupt();
                return Ok(());
            }
        }

        let pid = {
            let pids = self
                .active_pids
                .lock()
                .map_err(|_| AppError::Message("cancel lock".into()))?;
            pids.get(connection_id).copied()
        };
        let Some(pid) = pid.filter(|p| *p > 0) else {
            return Err(AppError::Message("当前没有可取消的查询".into()));
        };

        let opts = {
            let map = self
                .cancel_opts
                .lock()
                .map_err(|_| AppError::Message("cancel opts lock".into()))?;
            map.get(connection_id)
                .cloned()
                .ok_or_else(|| AppError::Message("连接未打开".into()))?
        };

        let killer = connect(&opts)?;
        match opts.engine.as_str() {
            "mysql" => {
                let _ = killer.execute_sql(&format!("KILL QUERY {pid}"))?;
            }
            "postgres" => {
                let _ = killer.execute_sql(&format!("SELECT pg_cancel_backend({pid})"))?;
            }
            other => {
                return Err(AppError::Message(format!(
                    "引擎 {other} 暂不支持取消查询"
                )));
            }
        }
        Ok(())
    }
}

fn resolve_with_tunnel(mut opts: ConnectOpts) -> AppResult<(ConnectOpts, Option<SshTunnel>)> {
    if !opts.ssh_enabled.unwrap_or(false) {
        return Ok((opts, None));
    }
    if opts.engine == "sqlite" {
        return Err(AppError::Validation("SQLite 不支持 SSH Tunnel".into()));
    }

    let ssh_host = opts
        .ssh_host
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("SSH 主机不能为空".into()))?;
    let ssh_port = opts.ssh_port.unwrap_or(22) as u16;
    let ssh_user = opts
        .ssh_user
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("SSH 用户不能为空".into()))?;
    let ssh_password = opts
        .ssh_password
        .clone()
        .ok_or_else(|| AppError::Validation("SSH 密码不能为空".into()))?;
    let remote_host = opts
        .host
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "127.0.0.1".into());
    let remote_port = opts.port.unwrap_or(match opts.engine.as_str() {
        "postgres" => 5432,
        _ => 3306,
    }) as u16;

    let tunnel = SshTunnel::open(&SshParams {
        ssh_host,
        ssh_port,
        ssh_user,
        ssh_password,
        remote_host,
        remote_port,
    })?;

    opts.host = Some("127.0.0.1".into());
    opts.port = Some(i64::from(tunnel.local_port));
    opts.ssh_enabled = Some(false);
    opts.ssh_password = None;
    Ok((opts, Some(tunnel)))
}

pub fn opts_from_connection(db: &MetaDb, connection_id: &str) -> AppResult<ConnectOpts> {
    let record = db
        .get_connection(connection_id)?
        .ok_or_else(|| AppError::Message("连接不存在".into()))?;
    let password = match record.secret_ref.as_ref() {
        Some(secret_ref) => vault::get_secret(secret_ref)?,
        None => None,
    };
    let ssh_password = match record.secret_ref.as_ref() {
        Some(secret_ref) if record.ssh_enabled => {
            vault::get_secret(&format!("{secret_ref}:ssh"))?
        }
        _ => None,
    };
    Ok(ConnectOpts {
        engine: record.engine,
        host: record.host,
        port: record.port,
        database: record.database,
        user: record.user,
        password,
        ssl_mode: Some(record.ssl_mode),
        ssl_trust: Some(record.ssl_trust),
        ssh_enabled: Some(record.ssh_enabled),
        ssh_host: record.ssh_host,
        ssh_port: record.ssh_port,
        ssh_user: record.ssh_user,
        ssh_password,
    })
}
