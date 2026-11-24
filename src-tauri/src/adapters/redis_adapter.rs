use crate::adapters::ConnectOpts;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::sync::Mutex;
use std::time::Duration;

const MAX_VALUE_BYTES: usize = 256 * 1024;
const MAX_COLLECTION_ITEMS: usize = 1000;
const MAX_STREAM_ITEMS: usize = 100;
const DEFAULT_DB_COUNT: i64 = 16;
const MAX_DB_INDEX: i64 = 255;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyMeta {
    pub key: String,
    pub kind: String,
    /// -1 = 永久，-2 = 键不存在
    pub ttl: i64,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyPage {
    pub cursor: u64,
    pub keys: Vec<RedisKeyMeta>,
    pub scanned: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyValue {
    pub key: String,
    pub kind: String,
    pub ttl: i64,
    pub size: Option<i64>,
    pub truncated: bool,
    pub value: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisReply {
    /// status | integer | bulk | array | nil | error
    pub kind: String,
    pub text: String,
    pub value: JsonValue,
    pub truncated: bool,
}

struct Inner {
    conn: redis::Connection,
    db: i64,
}

/// Redis 独立部署（standalone）会话。与 SQL 适配器不同，这里不做表/列抽象。
pub struct RedisSession {
    inner: Mutex<Inner>,
}

impl RedisSession {
    pub fn connect(opts: &ConnectOpts) -> AppResult<Self> {
        let url = build_redis_url(opts)?;
        let db = parse_db_index(opts.database.as_deref())?;
        let client = redis::Client::open(url).map_err(map_redis_err)?;
        let mut conn = client
            .get_connection_with_timeout(CONNECT_TIMEOUT)
            .map_err(map_redis_err)?;
        let _ = conn.set_read_timeout(Some(IO_TIMEOUT));
        let _ = conn.set_write_timeout(Some(IO_TIMEOUT));
        let pong: String = redis::cmd("PING")
            .query(&mut conn)
            .map_err(map_redis_err)?;
        if !pong.eq_ignore_ascii_case("PONG") {
            return Err(AppError::Driver(format!("Redis PING 返回异常: {pong}")));
        }
        Ok(Self {
            inner: Mutex::new(Inner { conn, db }),
        })
    }

    pub fn ping(&self) -> AppResult<()> {
        self.with_conn(None, |conn| {
            let pong: String = redis::cmd("PING").query(conn).map_err(map_redis_err)?;
            if pong.eq_ignore_ascii_case("PONG") {
                Ok(())
            } else {
                Err(AppError::Driver(format!("Redis PING 返回异常: {pong}")))
            }
        })
    }

    pub fn list_databases(&self) -> AppResult<Vec<String>> {
        self.with_conn(None, |conn| {
            let count = match redis::cmd("CONFIG")
                .arg("GET")
                .arg("databases")
                .query::<redis::Value>(conn)
            {
                Ok(value) => parse_config_databases(&value).unwrap_or(DEFAULT_DB_COUNT),
                // 托管 Redis 常禁用 CONFIG；回退到默认 16 个库，不阻塞主路径。
                Err(err)
                    if matches!(
                        err.kind(),
                        redis::ErrorKind::Server(_) | redis::ErrorKind::Extension
                    ) =>
                {
                    DEFAULT_DB_COUNT
                }
                Err(err) => return Err(map_redis_err(err)),
            };
            let count = count.clamp(1, MAX_DB_INDEX + 1);
            Ok((0..count).map(|i| i.to_string()).collect())
        })
    }

    pub fn scan_keys(
        &self,
        db: Option<i64>,
        pattern: &str,
        cursor: u64,
        count: u32,
    ) -> AppResult<RedisKeyPage> {
        let pattern = if pattern.trim().is_empty() {
            "*"
        } else {
            pattern
        };
        let count = count.clamp(1, MAX_COLLECTION_ITEMS as u32);
        self.with_conn(db, |conn| {
            let (next, keys): (String, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count)
                .query(conn)
                .map_err(map_redis_err)?;
            let next = next.parse::<u64>().unwrap_or(0);

            let mut metas = Vec::with_capacity(keys.len());
            if !keys.is_empty() {
                let mut pipe = redis::pipe();
                pipe.ignore_errors();
                for key in &keys {
                    pipe.cmd("TYPE").arg(key);
                    pipe.cmd("TTL").arg(key);
                    pipe.cmd("MEMORY").arg("USAGE").arg(key);
                }
                let replies: Vec<redis::RedisResult<redis::Value>> =
                    pipe.query(conn).map_err(map_redis_err)?;
                for (index, key) in keys.iter().enumerate() {
                    let base = index * 3;
                    let kind = replies
                        .get(base)
                        .and_then(|r| r.as_ref().ok())
                        .and_then(value_as_string)
                        .unwrap_or_else(|| "unknown".to_string());
                    let ttl = replies
                        .get(base + 1)
                        .and_then(|r| r.as_ref().ok())
                        .and_then(value_as_i64)
                        .unwrap_or(-1);
                    let size = replies
                        .get(base + 2)
                        .and_then(|r| r.as_ref().ok())
                        .and_then(value_as_i64);
                    metas.push(RedisKeyMeta {
                        key: key.clone(),
                        kind,
                        ttl,
                        size,
                    });
                }
            }

            Ok(RedisKeyPage {
                cursor: next,
                scanned: keys.len() as i64,
                keys: metas,
            })
        })
    }

    pub fn key_detail(&self, db: Option<i64>, key: &str) -> AppResult<RedisKeyValue> {
        self.with_conn(db, |conn| {
            let kind: String = redis::cmd("TYPE")
                .arg(key)
                .query(conn)
                .map_err(map_redis_err)?;
            if kind == "none" {
                return Err(AppError::Message("键不存在或类型已变化".into()));
            }
            let ttl: i64 = redis::cmd("TTL").arg(key).query(conn).unwrap_or(-1);
            if ttl == -2 {
                return Err(AppError::Message("键不存在或类型已变化".into()));
            }
            let size: Option<i64> = redis::cmd("MEMORY")
                .arg("USAGE")
                .arg(key)
                .query(conn)
                .ok();

            let mut truncated = false;
            let value = match kind.as_str() {
                "string" => {
                    let raw: Option<Vec<u8>> = redis::cmd("GET")
                        .arg(key)
                        .query(conn)
                        .map_err(map_redis_err)?;
                    json!(lossy_truncated(
                        raw.as_deref().unwrap_or_default(),
                        &mut truncated
                    ))
                }
                "hash" => {
                    let raw: redis::Value = redis::cmd("HGETALL")
                        .arg(key)
                        .query(conn)
                        .map_err(map_redis_err)?;
                    let items = value_items(&raw);
                    if items.len() / 2 > MAX_COLLECTION_ITEMS {
                        truncated = true;
                    }
                    let mut out = Vec::new();
                    for pair in items.chunks(2).take(MAX_COLLECTION_ITEMS) {
                        if pair.len() < 2 {
                            break;
                        }
                        out.push(json!({
                            "field": value_as_string(&pair[0]).unwrap_or_default(),
                            "value": value_as_string(&pair[1]).unwrap_or_default(),
                        }));
                    }
                    JsonValue::Array(out)
                }
                "list" => {
                    let raw: redis::Value = redis::cmd("LRANGE")
                        .arg(key)
                        .arg(0)
                        .arg((MAX_COLLECTION_ITEMS - 1) as i64)
                        .query(conn)
                        .map_err(map_redis_err)?;
                    let items = value_items(&raw);
                    if items.len() >= MAX_COLLECTION_ITEMS {
                        truncated = true;
                    }
                    JsonValue::Array(
                        items
                            .iter()
                            .take(MAX_COLLECTION_ITEMS)
                            .map(|item| json!(value_as_string(item).unwrap_or_default()))
                            .collect(),
                    )
                }
                "set" => {
                    let raw: redis::Value = redis::cmd("SMEMBERS")
                        .arg(key)
                        .query(conn)
                        .map_err(map_redis_err)?;
                    let items = value_items(&raw);
                    if items.len() > MAX_COLLECTION_ITEMS {
                        truncated = true;
                    }
                    JsonValue::Array(
                        items
                            .iter()
                            .take(MAX_COLLECTION_ITEMS)
                            .map(|item| json!(value_as_string(item).unwrap_or_default()))
                            .collect(),
                    )
                }
                "zset" => {
                    let raw: redis::Value = redis::cmd("ZRANGE")
                        .arg(key)
                        .arg(0)
                        .arg((MAX_COLLECTION_ITEMS - 1) as i64)
                        .arg("WITHSCORES")
                        .query(conn)
                        .map_err(map_redis_err)?;
                    let items = value_items(&raw);
                    if items.len() / 2 > MAX_COLLECTION_ITEMS {
                        truncated = true;
                    }
                    let mut out = Vec::new();
                    for pair in items.chunks(2).take(MAX_COLLECTION_ITEMS) {
                        if pair.len() < 2 {
                            break;
                        }
                        out.push(json!({
                            "member": value_as_string(&pair[0]).unwrap_or_default(),
                            "score": value_as_f64(&pair[1]).unwrap_or(0.0),
                        }));
                    }
                    JsonValue::Array(out)
                }
                "stream" => {
                    let raw: redis::Value = redis::cmd("XRANGE")
                        .arg(key)
                        .arg("-")
                        .arg("+")
                        .arg("COUNT")
                        .arg(MAX_STREAM_ITEMS as i64)
                        .query(conn)
                        .map_err(map_redis_err)?;
                    if value_items(&raw).len() >= MAX_STREAM_ITEMS {
                        truncated = true;
                    }
                    value_to_json(&raw, 0, &mut truncated)
                }
                other => {
                    return Err(AppError::Message(format!("暂不支持的类型: {other}")));
                }
            };

            Ok(RedisKeyValue {
                key: key.to_string(),
                kind,
                ttl,
                size,
                truncated,
                value,
            })
        })
    }

    /// `ttl` 为 None 时保留原 TTL（Redis 6+ `KEEPTTL`）；Some(n>0) 设置秒级过期；Some(<=0) 永久。
    pub fn set_string(
        &self,
        db: Option<i64>,
        key: &str,
        value: &str,
        ttl: Option<i64>,
    ) -> AppResult<()> {
        self.with_conn(db, |conn| {
            let mut cmd = redis::cmd("SET");
            cmd.arg(key).arg(value);
            match ttl {
                Some(seconds) if seconds > 0 => {
                    cmd.arg("EX").arg(seconds);
                }
                Some(_) => {}
                None => {
                    cmd.arg("KEEPTTL");
                }
            }
            let _: () = cmd.query(conn).map_err(map_redis_err)?;
            Ok(())
        })
    }

    pub fn hash_set(
        &self,
        db: Option<i64>,
        key: &str,
        field: &str,
        value: &str,
    ) -> AppResult<()> {
        self.with_conn(db, |conn| {
            let _: i64 = redis::cmd("HSET")
                .arg(key)
                .arg(field)
                .arg(value)
                .query(conn)
                .map_err(map_redis_err)?;
            Ok(())
        })
    }

    pub fn hash_delete(
        &self,
        db: Option<i64>,
        key: &str,
        fields: &[String],
    ) -> AppResult<i64> {
        if fields.is_empty() {
            return Ok(0);
        }
        self.with_conn(db, |conn| {
            let mut cmd = redis::cmd("HDEL");
            cmd.arg(key);
            for field in fields {
                cmd.arg(field);
            }
            cmd.query(conn).map_err(map_redis_err)
        })
    }

    pub fn delete_keys(&self, db: Option<i64>, keys: &[String]) -> AppResult<i64> {
        if keys.is_empty() {
            return Ok(0);
        }
        self.with_conn(db, |conn| {
            let mut cmd = redis::cmd("DEL");
            for key in keys {
                cmd.arg(key);
            }
            cmd.query(conn).map_err(map_redis_err)
        })
    }

    /// `ttl_secs` 为 Some(n>0) 时 `EXPIRE`，否则 `PERSIST`（永久）。
    pub fn expire(&self, db: Option<i64>, key: &str, ttl_secs: Option<i64>) -> AppResult<bool> {
        self.with_conn(db, |conn| {
            let changed: i64 = match ttl_secs {
                Some(seconds) if seconds > 0 => redis::cmd("EXPIRE")
                    .arg(key)
                    .arg(seconds)
                    .query(conn)
                    .map_err(map_redis_err)?,
                _ => redis::cmd("PERSIST")
                    .arg(key)
                    .query(conn)
                    .map_err(map_redis_err)?,
            };
            Ok(changed == 1)
        })
    }

    pub fn execute(&self, db: Option<i64>, command: &str) -> AppResult<RedisReply> {
        let args = tokenize_command(command)?;
        let name = args[0].clone();
        self.with_conn(db, |conn| {
            let mut cmd = redis::cmd(&name);
            for arg in &args[1..] {
                cmd.arg(arg);
            }
            match cmd.query::<redis::Value>(conn) {
                Ok(value) => Ok(value_to_reply(&value)),
                // 服务端业务错误（WRONGTYPE / NOPERM 等）作为结果展示，而不是 IPC 异常。
                // 未知错误码会被 redis-rs 归为 Extension，同样属于服务端回复。
                Err(err)
                    if matches!(
                        err.kind(),
                        redis::ErrorKind::Server(_) | redis::ErrorKind::Extension
                    ) =>
                {
                    Ok(RedisReply {
                        kind: "error".into(),
                        text: err.to_string(),
                        value: JsonValue::Null,
                        truncated: false,
                    })
                }
                Err(err) => Err(map_redis_err(err)),
            }
        })
    }

    fn with_conn<R>(
        &self,
        db: Option<i64>,
        f: impl FnOnce(&mut redis::Connection) -> AppResult<R>,
    ) -> AppResult<R> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| AppError::Message("Redis 会话忙".into()))?;
        if let Some(db) = db {
            if db != inner.db {
                let _: () = redis::cmd("SELECT")
                    .arg(db)
                    .query(&mut inner.conn)
                    .map_err(map_redis_err)?;
                inner.db = db;
            }
        }
        f(&mut inner.conn)
    }
}

pub fn parse_db_index(db: Option<&str>) -> AppResult<i64> {
    let Some(raw) = db.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(0);
    };
    let index = raw
        .parse::<i64>()
        .map_err(|_| AppError::Validation("DB 编号应为 0–255 的整数".into()))?;
    if !(0..=MAX_DB_INDEX).contains(&index) {
        return Err(AppError::Validation("DB 编号应为 0–255 的整数".into()));
    }
    Ok(index)
}

fn build_redis_url(opts: &ConnectOpts) -> AppResult<String> {
    let host = opts
        .host
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("主机不能为空".into()))?;
    let port = opts.port.unwrap_or(6379);
    if !(1..=65535).contains(&port) {
        return Err(AppError::Validation("端口非法，应在 1–65535".into()));
    }
    let db = parse_db_index(opts.database.as_deref())?;
    let ssl = opts
        .ssl_mode
        .as_deref()
        .map(|mode| mode.eq_ignore_ascii_case("require"))
        .unwrap_or(false);
    let scheme = if ssl { "rediss" } else { "redis" };
    let user = opts.user.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let password = opts.password.as_deref().filter(|s| !s.is_empty());
    let auth = match (user, password) {
        (Some(user), Some(password)) => format!(
            "{}:{}@",
            encode_component(user),
            encode_component(password)
        ),
        (Some(user), None) => format!("{}@", encode_component(user)),
        (None, Some(password)) => format!(":{}@", encode_component(password)),
        (None, None) => String::new(),
    };
    let fragment = if ssl && opts.ssl_trust.unwrap_or(false) {
        "#insecure"
    } else {
        ""
    };
    Ok(format!("{scheme}://{auth}{host}:{port}/{db}{fragment}"))
}

fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn map_redis_err(err: redis::RedisError) -> AppError {
    AppError::Driver(format!("Redis: {err}"))
}

fn value_items(value: &redis::Value) -> &[redis::Value] {
    match value {
        redis::Value::Array(items) | redis::Value::Set(items) => items,
        _ => &[],
    }
}

fn value_as_string(value: &redis::Value) -> Option<String> {
    match value {
        redis::Value::BulkString(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        redis::Value::SimpleString(text) => Some(text.clone()),
        redis::Value::Okay => Some("OK".into()),
        redis::Value::VerbatimString { text, .. } => Some(text.clone()),
        redis::Value::Int(number) => Some(number.to_string()),
        redis::Value::Double(number) => Some(number.to_string()),
        redis::Value::Boolean(flag) => Some(if *flag { "1".into() } else { "0".into() }),
        redis::Value::ServerError(err) => Some(err.to_string()),
        _ => None,
    }
}

fn value_as_i64(value: &redis::Value) -> Option<i64> {
    match value {
        redis::Value::Int(number) => Some(*number),
        redis::Value::BulkString(bytes) => String::from_utf8_lossy(bytes).parse().ok(),
        redis::Value::SimpleString(text) => text.parse().ok(),
        redis::Value::Double(number) => Some(*number as i64),
        redis::Value::Boolean(flag) => Some(i64::from(*flag)),
        _ => None,
    }
}

fn value_as_f64(value: &redis::Value) -> Option<f64> {
    match value {
        redis::Value::Double(number) => Some(*number),
        redis::Value::Int(number) => Some(*number as f64),
        redis::Value::BulkString(bytes) => String::from_utf8_lossy(bytes).parse().ok(),
        redis::Value::SimpleString(text) => text.parse().ok(),
        _ => None,
    }
}

fn parse_config_databases(value: &redis::Value) -> Option<i64> {
    match value {
        redis::Value::Map(pairs) => pairs.iter().find_map(|(key, value)| {
            if value_as_string(key).as_deref() == Some("databases") {
                value_as_string(value).and_then(|text| text.parse().ok())
            } else {
                None
            }
        }),
        redis::Value::Array(items) => items.chunks(2).find_map(|pair| {
            if pair.len() < 2 {
                return None;
            }
            if value_as_string(&pair[0]).as_deref() == Some("databases") {
                value_as_string(&pair[1]).and_then(|text| text.parse().ok())
            } else {
                None
            }
        }),
        _ => None,
    }
}

fn truncate_str(value: &str, truncated: &mut bool) -> String {
    if value.len() <= MAX_VALUE_BYTES {
        return value.to_string();
    }
    *truncated = true;
    let end = value
        .char_indices()
        .take_while(|(index, _)| *index < MAX_VALUE_BYTES)
        .last()
        .map(|(index, ch)| index + ch.len_utf8())
        .unwrap_or(0);
    value[..end].to_string()
}

fn lossy_truncated(bytes: &[u8], truncated: &mut bool) -> String {
    let slice = if bytes.len() > MAX_VALUE_BYTES {
        *truncated = true;
        &bytes[..MAX_VALUE_BYTES]
    } else {
        bytes
    };
    String::from_utf8_lossy(slice).into_owned()
}

fn value_to_json(value: &redis::Value, depth: usize, truncated: &mut bool) -> JsonValue {
    if depth > 8 {
        *truncated = true;
        return json!("…");
    }
    match value {
        redis::Value::Nil => JsonValue::Null,
        redis::Value::Int(number) => json!(number),
        redis::Value::BulkString(bytes) => json!(lossy_truncated(bytes, truncated)),
        redis::Value::SimpleString(text) => json!(truncate_str(text, truncated)),
        redis::Value::Okay => json!("OK"),
        redis::Value::Array(items) | redis::Value::Set(items) => {
            if items.len() > MAX_COLLECTION_ITEMS {
                *truncated = true;
            }
            JsonValue::Array(
                items
                    .iter()
                    .take(MAX_COLLECTION_ITEMS)
                    .map(|item| value_to_json(item, depth + 1, truncated))
                    .collect(),
            )
        }
        redis::Value::Map(pairs) => {
            if pairs.len() > MAX_COLLECTION_ITEMS {
                *truncated = true;
            }
            JsonValue::Array(
                pairs
                    .iter()
                    .take(MAX_COLLECTION_ITEMS)
                    .map(|(key, value)| {
                        json!([
                            value_to_json(key, depth + 1, truncated),
                            value_to_json(value, depth + 1, truncated)
                        ])
                    })
                    .collect(),
            )
        }
        redis::Value::Double(number) => json!(number),
        redis::Value::Boolean(flag) => json!(flag),
        redis::Value::VerbatimString { text, .. } => json!(truncate_str(text, truncated)),
        redis::Value::Attribute { data, .. } => value_to_json(data, depth, truncated),
        redis::Value::ServerError(err) => json!(err.to_string()),
        redis::Value::Push { data, .. } => JsonValue::Array(
            data.iter()
                .take(MAX_COLLECTION_ITEMS)
                .map(|item| value_to_json(item, depth + 1, truncated))
                .collect(),
        ),
        _ => JsonValue::Null,
    }
}

fn value_to_reply(value: &redis::Value) -> RedisReply {
    let mut truncated = false;
    let json_value = value_to_json(value, 0, &mut truncated);
    let (kind, text) = match value {
        redis::Value::Nil => ("nil", "(nil)".to_string()),
        redis::Value::Int(number) => ("integer", number.to_string()),
        redis::Value::BulkString(bytes) => ("bulk", lossy_truncated(bytes, &mut truncated)),
        redis::Value::SimpleString(text) => ("status", truncate_str(text, &mut truncated)),
        redis::Value::Okay => ("status", "OK".to_string()),
        redis::Value::Array(items) | redis::Value::Set(items) => {
            ("array", format!("(array) {} items", items.len()))
        }
        redis::Value::Map(pairs) => ("array", format!("(map) {} entries", pairs.len())),
        redis::Value::Double(number) => ("bulk", number.to_string()),
        redis::Value::Boolean(flag) => ("integer", if *flag { "1".into() } else { "0".into() }),
        redis::Value::VerbatimString { text, .. } => {
            ("bulk", truncate_str(text, &mut truncated))
        }
        redis::Value::Attribute { data, .. } => return value_to_reply(data),
        redis::Value::ServerError(err) => ("error", err.to_string()),
        redis::Value::Push { data, .. } => ("array", format!("(push) {} items", data.len())),
        _ => ("bulk", String::new()),
    };
    RedisReply {
        kind: kind.to_string(),
        text,
        value: json_value,
        truncated,
    }
}

/// 解析命令行为参数列表：支持空白分隔、单/双引号、反斜杠转义（\n \r \t \\ \" \' \xHH）。
pub fn tokenize_command(input: &str) -> AppResult<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        match quote {
            Some(quote_char) => {
                if ch == '\\' {
                    let escaped = chars
                        .next()
                        .ok_or_else(|| AppError::Validation("命令转义不完整".into()))?;
                    current.push(match escaped {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        '\\' => '\\',
                        '"' => '"',
                        '\'' => '\'',
                        'x' => parse_hex_escape(&mut chars)?,
                        other => other,
                    });
                } else if ch == quote_char {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            None => {
                if ch.is_whitespace() {
                    if in_token {
                        args.push(std::mem::take(&mut current));
                        in_token = false;
                    }
                } else if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                    in_token = true;
                } else if ch == '\\' {
                    let escaped = chars
                        .next()
                        .ok_or_else(|| AppError::Validation("命令转义不完整".into()))?;
                    current.push(escaped);
                    in_token = true;
                } else {
                    current.push(ch);
                    in_token = true;
                }
            }
        }
    }

    if quote.is_some() {
        return Err(AppError::Validation("命令引号未闭合".into()));
    }
    if in_token {
        args.push(current);
    }
    if args.is_empty() {
        return Err(AppError::Validation("命令不能为空".into()));
    }
    Ok(args)
}

fn parse_hex_escape(
    chars: &mut std::iter::Peekable<std::str::Chars<'_>>,
) -> AppResult<char> {
    let high = chars
        .next()
        .ok_or_else(|| AppError::Validation("命令转义不完整".into()))?;
    let low = chars
        .next()
        .ok_or_else(|| AppError::Validation("命令转义不完整".into()))?;
    let byte = u8::from_str_radix(&format!("{high}{low}"), 16)
        .map_err(|_| AppError::Validation("命令中的 \\x 转义非法".into()))?;
    Ok(byte as char)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_opts() -> ConnectOpts {
        ConnectOpts {
            engine: "redis".into(),
            host: Some("127.0.0.1".into()),
            port: Some(6379),
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
        }
    }

    fn live_opts() -> Option<ConnectOpts> {
        if std::env::var("MYCAT_REDIS_TEST").ok().as_deref() != Some("1") {
            return None;
        }
        let host = std::env::var("MYCAT_REDIS_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port = std::env::var("MYCAT_REDIS_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(6380);
        let password =
            std::env::var("MYCAT_REDIS_PASSWORD").unwrap_or_else(|_| "navicat".into());
        let db = std::env::var("MYCAT_REDIS_DB").unwrap_or_else(|_| "15".into());
        Some(ConnectOpts {
            engine: "redis".into(),
            host: Some(host),
            port: Some(port),
            database: Some(db),
            user: None,
            password: Some(password),
            ssl_mode: Some("disable".into()),
            ssl_trust: Some(false),
            ssh_enabled: Some(false),
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
        })
    }

    #[test]
    fn redis_url_plain() {
        assert_eq!(
            build_redis_url(&base_opts()).unwrap(),
            "redis://127.0.0.1:6379/0"
        );
    }

    #[test]
    fn redis_url_password_encoded() {
        let mut opts = base_opts();
        opts.password = Some("p@ss:w/rd".into());
        assert_eq!(
            build_redis_url(&opts).unwrap(),
            "redis://:p%40ss%3Aw%2Frd@127.0.0.1:6379/0"
        );
    }

    #[test]
    fn redis_url_acl_user() {
        let mut opts = base_opts();
        opts.user = Some("app".into());
        opts.password = Some("pw".into());
        opts.database = Some("2".into());
        assert_eq!(
            build_redis_url(&opts).unwrap(),
            "redis://app:pw@127.0.0.1:6379/2"
        );
    }

    #[test]
    fn redis_url_tls_insecure() {
        let mut opts = base_opts();
        opts.ssl_mode = Some("require".into());
        opts.ssl_trust = Some(true);
        opts.database = Some("3".into());
        assert_eq!(
            build_redis_url(&opts).unwrap(),
            "rediss://127.0.0.1:6379/3#insecure"
        );
    }

    #[test]
    fn redis_db_index_validation() {
        assert_eq!(parse_db_index(None).unwrap(), 0);
        assert_eq!(parse_db_index(Some(" 15 ")).unwrap(), 15);
        assert!(parse_db_index(Some("300")).is_err());
        assert!(parse_db_index(Some("abc")).is_err());
    }

    #[test]
    fn redis_config_databases_array() {
        let value = redis::Value::Array(vec![
            redis::Value::BulkString(b"databases".to_vec()),
            redis::Value::BulkString(b"32".to_vec()),
        ]);
        assert_eq!(parse_config_databases(&value), Some(32));
    }

    #[test]
    fn redis_tokenize_quotes() {
        assert_eq!(
            tokenize_command("SET k \"hello world\"").unwrap(),
            vec!["SET", "k", "hello world"]
        );
        assert_eq!(
            tokenize_command("SET k 'a\\'b'").unwrap(),
            vec!["SET", "k", "a'b"]
        );
    }

    #[test]
    fn redis_tokenize_errors() {
        assert!(tokenize_command("   ").is_err());
        assert!(tokenize_command("SET k \"oops").is_err());
        assert!(tokenize_command("SET k \\").is_err());
    }

    #[test]
    fn redis_reply_shapes() {
        let nil = value_to_reply(&redis::Value::Nil);
        assert_eq!(nil.kind, "nil");
        let int = value_to_reply(&redis::Value::Int(7));
        assert_eq!(int.kind, "integer");
        assert_eq!(int.text, "7");
        let array = value_to_reply(&redis::Value::Array(vec![
            redis::Value::BulkString(b"a".to_vec()),
            redis::Value::Int(1),
        ]));
        assert_eq!(array.kind, "array");
    }

    #[test]
    fn redis_live_connect() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = RedisSession::connect(&opts).expect("connect");
        session.ping().expect("ping");
        let databases = session.list_databases().expect("list databases");
        assert!(!databases.is_empty());
    }

    #[test]
    fn redis_live_execute() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = RedisSession::connect(&opts).expect("connect");
        let prefix = format!("mycat:test:{}:", uuid::Uuid::new_v4());
        let key = format!("{prefix}cmd");

        let reply = session
            .execute(None, &format!("SET {key} \"hello world\""))
            .expect("set");
        assert_eq!(reply.kind, "status");

        let reply = session
            .execute(None, &format!("GET {key}"))
            .expect("get");
        assert_eq!(reply.kind, "bulk");
        assert_eq!(reply.value, json!("hello world"));

        let reply = session
            .execute(None, &format!("HGETALL {key}"))
            .expect("wrongtype");
        assert_eq!(reply.kind, "error");
        assert!(reply.text.contains("WRONGTYPE"));

        assert!(session.execute(None, "   ").is_err());
        assert!(session.execute(None, "SET k \"oops").is_err());

        session.delete_keys(None, &[key]).expect("cleanup");
    }

    #[test]
    fn redis_live_edit() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = RedisSession::connect(&opts).expect("connect");
        let prefix = format!("mycat:test:{}:", uuid::Uuid::new_v4());
        let key = format!("{prefix}edit");

        session
            .set_string(None, &key, "v1", Some(120))
            .expect("set v1");
        let ttl_before = session.key_detail(None, &key).expect("detail v1").ttl;
        assert!(ttl_before > 0);

        // KEEPTTL：修改值但保留原 TTL。
        session
            .set_string(None, &key, "v2", None)
            .expect("set v2");
        let detail = session.key_detail(None, &key).expect("detail v2");
        assert_eq!(detail.value, json!("v2"));
        assert!(detail.ttl > 0 && detail.ttl <= ttl_before);

        // 永久。
        session
            .set_string(None, &key, "v3", Some(-1))
            .expect("set persist");
        assert_eq!(session.key_detail(None, &key).expect("detail v3").ttl, -1);

        assert!(session.expire(None, &key, Some(30)).expect("expire"));
        assert!(session.key_detail(None, &key).expect("detail ttl").ttl > 0);
        assert!(session.expire(None, &key, None).expect("persist"));
        assert_eq!(session.key_detail(None, &key).expect("detail persist").ttl, -1);

        let hash = format!("{prefix}hash");
        session.hash_set(None, &hash, "a", "1").expect("hset a");
        session.hash_set(None, &hash, "b", "2").expect("hset b");
        assert_eq!(
            session
                .hash_delete(None, &hash, &["a".to_string()])
                .expect("hdel"),
            1
        );
        let hash_detail = session.key_detail(None, &hash).expect("hash detail");
        assert_eq!(hash_detail.value.as_array().map(Vec::len), Some(1));

        assert_eq!(
            session
                .delete_keys(None, &[key, hash])
                .expect("delete keys"),
            2
        );
    }

    #[test]
    fn redis_live_value() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = RedisSession::connect(&opts).expect("connect");
        let prefix = format!("mycat:test:{}:", uuid::Uuid::new_v4());
        let string_key = format!("{prefix}str");
        session
            .set_string(None, &string_key, "hello", Some(60))
            .expect("set string");
        let detail = session.key_detail(None, &string_key).expect("string detail");
        assert_eq!(detail.kind, "string");
        assert_eq!(detail.value, json!("hello"));
        assert!(detail.ttl > 0);

        let hash_key = format!("{prefix}hash");
        session
            .hash_set(None, &hash_key, "f1", "v1")
            .expect("hset 1");
        session
            .hash_set(None, &hash_key, "f2", "v2")
            .expect("hset 2");
        let hash = session.key_detail(None, &hash_key).expect("hash detail");
        assert_eq!(hash.kind, "hash");
        assert_eq!(hash.value.as_array().map(Vec::len), Some(2));

        assert!(session.key_detail(None, &format!("{prefix}missing")).is_err());
        session
            .delete_keys(None, &[string_key, hash_key])
            .expect("cleanup");
    }

    #[test]
    fn redis_live_scan() {
        let Some(opts) = live_opts() else {
            return;
        };
        let session = RedisSession::connect(&opts).expect("connect");
        let prefix = format!("mycat:test:{}:", uuid::Uuid::new_v4());
        let key = format!("{prefix}key");
        session
            .set_string(None, &key, "value", Some(60))
            .expect("set");
        let page = session
            .scan_keys(None, &format!("{prefix}*"), 0, 100)
            .expect("scan");
        assert!(page.keys.iter().any(|item| item.key == key));
        let meta = page.keys.iter().find(|item| item.key == key).unwrap();
        assert_eq!(meta.kind, "string");
        assert!(meta.ttl > 0);
        session.delete_keys(None, &[key]).expect("cleanup");
    }
}
