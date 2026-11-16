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
        AppError::Driver(value.to_string())
    }
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
