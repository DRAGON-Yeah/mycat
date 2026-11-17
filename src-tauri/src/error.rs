use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("validation: {0}")]
    Validation(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("crypto: {0}")]
    Crypto(String),
    #[error("vault: {0}")]
    Vault(String),
    #[error("driver: {0}")]
    Driver(String),
}

impl From<mysql::Error> for AppError {
    fn from(value: mysql::Error) -> Self {
        AppError::Driver(value.to_string())
    }
}

impl From<postgres::Error> for AppError {
    fn from(value: postgres::Error) -> Self {
        AppError::Driver(postgres_message(&value))
    }
}

/// `postgres::Error`'s `Display` is just "db error" for server-side failures;
/// surface the actual message so the UI can show what went wrong.
pub fn postgres_message(e: &postgres::Error) -> String {
    if let Some(db) = e.as_db_error() {
        let mut out = format!("ERROR: {}", db.message());
        if let Some(detail) = db.detail() {
            out.push_str(&format!("\nDETAIL: {detail}"));
        }
        if let Some(hint) = db.hint() {
            out.push_str(&format!("\nHINT: {hint}"));
        } else if db.code().code() == "42P01" {
            // undefined_table: by far the most common cause is case folding.
            out.push_str(
                "\nHINT: PostgreSQL 会把未加引号的标识符折叠为小写；混合大小写的表名请加双引号，如 \"MyTable\"。",
            );
        }
        if let Some(ctx) = db.where_() {
            out.push_str(&format!("\nCONTEXT: {ctx}"));
        }
        return out;
    }
    e.to_string()
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        AppError::Message(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        AppError::Message(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
