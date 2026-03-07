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
    pub feed_provider: String,
    pub feed_websocket_url: String,
    pub feed_http_url: String,
    pub feed_market_stale_after_ms: u64,
    pub feed_slot_stale_after_ms: u64,
    pub feed_max_slot_gap: u64,
    pub feed_replay_fixture_path: Option<String>,
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
            feed_provider: lookup("RUNTIME_FEED_PROVIDER").unwrap_or_else(|| "fixture".to_string()),
            feed_websocket_url: lookup("RUNTIME_FEED_WS_URL")
                .unwrap_or_else(|| "wss://price-feed.example/runtime".to_string()),
            feed_http_url: lookup("RUNTIME_FEED_HTTP_URL")
                .unwrap_or_else(|| "https://rpc.example/runtime".to_string()),
            feed_market_stale_after_ms: parse_u64_env(
                lookup("RUNTIME_FEED_MARKET_STALE_AFTER_MS"),
                30_000,
            ),
            feed_slot_stale_after_ms: parse_u64_env(
                lookup("RUNTIME_FEED_SLOT_STALE_AFTER_MS"),
                15_000,
            ),
            feed_max_slot_gap: parse_u64_env(lookup("RUNTIME_FEED_MAX_SLOT_GAP"), 2),
            feed_replay_fixture_path: lookup("RUNTIME_FEED_REPLAY_FIXTURE_PATH")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, RuntimeConfigError> {
        self.bind_address
            .parse()
            .map_err(|_| RuntimeConfigError::InvalidBindAddress(self.bind_address.clone()))
    }
}

fn parse_u64_env(raw: Option<String>, default_value: u64) -> u64 {
    raw.and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_value)
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
        assert_eq!(config.feed_provider, "fixture");
        assert_eq!(config.feed_market_stale_after_ms, 30_000);
        assert_eq!(config.feed_slot_stale_after_ms, 15_000);
        assert_eq!(config.feed_max_slot_gap, 2);
        assert_eq!(config.feed_replay_fixture_path, None);
    }

    #[test]
    fn loads_overrides_from_lookup() {
        let config = RuntimeConfig::from_lookup(|key| match key {
            "RUNTIME_RS_BIND_ADDR" => Some("0.0.0.0:9090".to_string()),
            "RUNTIME_RS_ENV" => Some("preview".to_string()),
            "RUNTIME_RS_LOG" => Some("debug".to_string()),
            "RUNTIME_FEED_PROVIDER" => Some("jupiter".to_string()),
            "RUNTIME_FEED_WS_URL" => Some("wss://feeds.jupiter.example/runtime".to_string()),
            "RUNTIME_FEED_HTTP_URL" => Some("https://rpc.jupiter.example/runtime".to_string()),
            "RUNTIME_FEED_MARKET_STALE_AFTER_MS" => Some("45000".to_string()),
            "RUNTIME_FEED_SLOT_STALE_AFTER_MS" => Some("22000".to_string()),
            "RUNTIME_FEED_MAX_SLOT_GAP" => Some("4".to_string()),
            "RUNTIME_FEED_REPLAY_FIXTURE_PATH" => Some("/tmp/runtime-feed.json".to_string()),
            _ => None,
        })
        .expect("custom config to load");

        assert_eq!(config.bind_address, "0.0.0.0:9090");
        assert_eq!(config.environment, RuntimeEnvironment::Preview);
        assert_eq!(config.log_level, "debug");
        assert_eq!(config.feed_provider, "jupiter");
        assert_eq!(
            config.feed_websocket_url,
            "wss://feeds.jupiter.example/runtime",
        );
        assert_eq!(config.feed_http_url, "https://rpc.jupiter.example/runtime");
        assert_eq!(config.feed_market_stale_after_ms, 45_000);
        assert_eq!(config.feed_slot_stale_after_ms, 22_000);
        assert_eq!(config.feed_max_slot_gap, 4);
        assert_eq!(
            config.feed_replay_fixture_path.as_deref(),
            Some("/tmp/runtime-feed.json"),
        );
        assert_eq!(
            config.socket_addr().expect("socket addr to parse"),
            "0.0.0.0:9090".parse().expect("address"),
        );
    }
}
