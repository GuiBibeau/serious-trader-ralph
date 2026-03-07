use std::{env, net::SocketAddr};

use protocol::RUNTIME_PROTOCOL_SCHEMA_VERSION;
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeEnvironment {
    Local,
    Preview,
    Production,
}

impl RuntimeEnvironment {
    fn parse(input: Option<String>) -> Result<Self, RuntimeConfigError> {
        match input.unwrap_or_else(|| "local".to_string()).as_str() {
            "local" => Ok(Self::Local),
            "preview" => Ok(Self::Preview),
            "production" => Ok(Self::Production),
            other => Err(RuntimeConfigError::InvalidEnvironment(other.to_string())),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Preview => "preview",
            Self::Production => "production",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub service_name: String,
    pub bind_address: String,
    pub environment: RuntimeEnvironment,
    pub log_level: String,
    pub protocol_version: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RuntimeConfigError {
    #[error("invalid runtime environment: {0}")]
    InvalidEnvironment(String),
    #[error("invalid bind address: {0}")]
    InvalidBindAddress(String),
}

impl RuntimeConfig {
    pub fn from_env() -> Result<Self, RuntimeConfigError> {
        Self::from_lookup(|key| env::var(key).ok())
    }

    pub fn from_lookup<F>(lookup: F) -> Result<Self, RuntimeConfigError>
    where
        F: Fn(&str) -> Option<String>,
    {
        Ok(Self {
            service_name: "runtime-rs".to_string(),
            bind_address: lookup("RUNTIME_RS_BIND_ADDR")
                .unwrap_or_else(|| "127.0.0.1:8081".to_string()),
            environment: RuntimeEnvironment::parse(lookup("RUNTIME_RS_ENV"))?,
            log_level: lookup("RUNTIME_RS_LOG").unwrap_or_else(|| "info".to_string()),
            protocol_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, RuntimeConfigError> {
        self.bind_address
            .parse()
            .map_err(|_| RuntimeConfigError::InvalidBindAddress(self.bind_address.clone()))
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthSnapshot {
    pub service_name: String,
    pub status: String,
    pub environment: String,
    pub protocol_version: String,
    pub bind_address: String,
}

#[must_use]
pub fn health_snapshot(config: &RuntimeConfig) -> RuntimeHealthSnapshot {
    RuntimeHealthSnapshot {
        service_name: config.service_name.clone(),
        status: "ok".to_string(),
        environment: config.environment.as_str().to_string(),
        protocol_version: config.protocol_version.clone(),
        bind_address: config.bind_address.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_default_config() {
        let config = RuntimeConfig::from_lookup(|_| None).expect("defaults to load");

        assert_eq!(config.service_name, "runtime-rs");
        assert_eq!(config.bind_address, "127.0.0.1:8081");
        assert_eq!(config.environment, RuntimeEnvironment::Local);
        assert_eq!(config.protocol_version, "v1");
    }

    #[test]
    fn loads_overrides_from_lookup() {
        let config = RuntimeConfig::from_lookup(|key| match key {
            "RUNTIME_RS_BIND_ADDR" => Some("0.0.0.0:9090".to_string()),
            "RUNTIME_RS_ENV" => Some("preview".to_string()),
            "RUNTIME_RS_LOG" => Some("debug".to_string()),
            _ => None,
        })
        .expect("custom config to load");

        assert_eq!(config.bind_address, "0.0.0.0:9090");
        assert_eq!(config.environment, RuntimeEnvironment::Preview);
        assert_eq!(config.log_level, "debug");
        assert_eq!(
            config.socket_addr().expect("socket addr to parse"),
            "0.0.0.0:9090".parse().expect("address"),
        );
    }
}
