use crate::error::{AppError, AppResult};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub struct SshParams {
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub ssh_password: String,
    pub remote_host: String,
    pub remote_port: u16,
}

/// Local TCP forwarder kept alive for the lifetime of a DB session.
pub struct SshTunnel {
    pub local_port: u16,
    stop: Arc<AtomicBool>,
    _accept: Option<JoinHandle<()>>,
}

impl SshTunnel {
    pub fn open(params: &SshParams) -> AppResult<Self> {
        let tcp = TcpStream::connect((params.ssh_host.as_str(), params.ssh_port)).map_err(|e| {
            AppError::Message(format!(
                "SSH 隧道连接失败 {}:{} — {e}",
                params.ssh_host, params.ssh_port
            ))
        })?;
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(20)));
        let _ = tcp.set_write_timeout(Some(Duration::from_secs(20)));

        let mut sess = Session::new().map_err(|e| {
            AppError::Message(format!("SSH 会话创建失败: {e}"))
        })?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| AppError::Message(format!("SSH 握手失败: {e}")))?;
        sess.userauth_password(&params.ssh_user, &params.ssh_password)
            .map_err(|e| AppError::Message(format!("SSH 认证失败: {e}")))?;
        if !sess.authenticated() {
            return Err(AppError::Message("SSH 认证失败：用户名或密码不正确".into()));
        }

        let listener = TcpListener::bind("127.0.0.1:0")?;
        let local_port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let session = Arc::new(Mutex::new(sess));
        let remote_host = params.remote_host.clone();
        let remote_port = params.remote_port;

        let accept = thread::spawn(move || {
            while !stop_flag.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((client, _)) => {
                        let session = session.clone();
                        let remote_host = remote_host.clone();
                        thread::spawn(move || {
                            if let Err(err) =
                                forward_stream(session, client, &remote_host, remote_port)
                            {
                                crate::logging::log_line(
                                    "WARN",
                                    &format!("SSH forward ended: {err}"),
                                );
                            }
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(40));
                    }
                    Err(_) => break,
                }
            }
        });

        Ok(Self {
            local_port,
            stop,
            _accept: Some(accept),
        })
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Nudge the accept loop in case it is mid-sleep.
        let _ = TcpStream::connect(("127.0.0.1", self.local_port));
        if let Some(handle) = self._accept.take() {
            let _ = handle.join();
        }
    }
}

fn forward_stream(
    session: Arc<Mutex<Session>>,
    mut client: TcpStream,
    remote_host: &str,
    remote_port: u16,
) -> AppResult<()> {
    let mut channel = {
        let sess = session
            .lock()
            .map_err(|_| AppError::Message("SSH session lock".into()))?;
        sess.set_blocking(false);
        sess.channel_direct_tcpip(remote_host, remote_port, None)
            .map_err(|e| AppError::Message(format!("SSH 端口转发失败: {e}")))?
    };

    let _ = client.set_nonblocking(true);

    let mut buf = [0u8; 16 * 1024];
    loop {
        let mut progressed = false;

        match client.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                channel
                    .write_all(&buf[..n])
                    .map_err(|e| AppError::Message(format!("SSH 写出失败: {e}")))?;
                let _ = channel.flush();
                progressed = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(AppError::Message(format!("本地读取失败: {e}"))),
        }

        match channel.read(&mut buf) {
            Ok(0) => {
                if channel.eof() {
                    break;
                }
            }
            Ok(n) => {
                client
                    .write_all(&buf[..n])
                    .map_err(|e| AppError::Message(format!("本地写出失败: {e}")))?;
                progressed = true;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(AppError::Message(format!("SSH 读取失败: {e}"))),
        }

        if channel.eof() {
            break;
        }
        if !progressed {
            thread::sleep(Duration::from_millis(2));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_unreachable_host_returns_tunnel_error() {
        let err = match SshTunnel::open(&SshParams {
            ssh_host: "127.0.0.1".into(),
            ssh_port: 1,
            ssh_user: "nobody".into(),
            ssh_password: "bad".into(),
            remote_host: "127.0.0.1".into(),
            remote_port: 3307,
        }) {
            Ok(_) => panic!("port 1 should fail"),
            Err(e) => e,
        };
        let msg = err.to_string();
        assert!(
            msg.contains("SSH"),
            "expected SSH-prefixed error, got {msg}"
        );
    }
}
