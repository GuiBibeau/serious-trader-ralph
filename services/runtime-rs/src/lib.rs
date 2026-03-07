use std::{
    env,
    sync::{Arc, RwLock},
};

use axum::{extract::State, routing::get, Json, Router};
use exec_client::ExecClient;
use market_adapters::{FeedGateway, FeedGatewayConfig, FeedGatewaySnapshot, FeedReplayFixture};
use runtime_ops::{health_snapshot, RuntimeConfig};
use serde::{Deserialize, Serialize};
use strategy_core::SUPPORTED_STRATEGIES;
use time::OffsetDateTime;
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone)]
pub struct RuntimeAppState {
    config: RuntimeConfig,
    exec_client: ExecClient,
    feed_bootstrap_source: String,
    feed_bootstrap_error: Option<String>,
    feed_gateway: Arc<RwLock<FeedGateway>>,
}

impl RuntimeAppState {
    #[must_use]
    pub fn new(config: RuntimeConfig) -> Self {
        let mut feed_gateway = FeedGateway::new(feed_gateway_config(&config));
        let (feed_bootstrap_source, feed_bootstrap_error) =
            bootstrap_feed_gateway(&mut feed_gateway, &config);
        let feed_gateway = Arc::new(RwLock::new(feed_gateway));
        if should_spawn_fixture_keepalive(&config) {
            spawn_fixture_keepalive(feed_gateway.clone());
        }
        Self {
            config,
            exec_client: ExecClient::from_lookup(|key| env::var(key).ok()),
            feed_bootstrap_source,
            feed_bootstrap_error,
            feed_gateway,
        }
    }

    fn feed_gateway_snapshot(&self) -> FeedGatewaySnapshot {
        self.feed_gateway
            .read()
            .expect("feed gateway read lock")
            .snapshot_now()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthResponse {
    pub service_name: String,
    pub status: String,
    pub environment: String,
    pub protocol_version: String,
    pub bind_address: String,
    pub exec_health_url: String,
    pub worker_service_auth_configured: bool,
    pub market_adapter_status: String,
    pub feed_bootstrap_source: String,
    pub feed_bootstrap_error: Option<String>,
    pub feed_gateway: FeedGatewaySnapshot,
    pub supported_strategies: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetricsResponse {
    pub service_name: String,
    pub environment: String,
    pub protocol_version: String,
    pub feed_bootstrap_source: String,
    pub feed_bootstrap_error: Option<String>,
    pub feed_gateway: FeedGatewaySnapshot,
    pub supported_strategies: Vec<String>,
}

pub fn app(config: RuntimeConfig) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(RuntimeAppState::new(config))
}

fn health_response(state: &RuntimeAppState) -> RuntimeHealthResponse {
    let snapshot = health_snapshot(&state.config);
    let feed_gateway = state.feed_gateway_snapshot();
    RuntimeHealthResponse {
        service_name: snapshot.service_name,
        status: snapshot.status,
        environment: snapshot.environment,
        protocol_version: snapshot.protocol_version,
        bind_address: snapshot.bind_address,
        exec_health_url: state.exec_client.health_url(),
        worker_service_auth_configured: state.exec_client.has_service_auth(),
        market_adapter_status: feed_gateway.status.clone(),
        feed_bootstrap_source: state.feed_bootstrap_source.clone(),
        feed_bootstrap_error: state.feed_bootstrap_error.clone(),
        feed_gateway,
        supported_strategies: SUPPORTED_STRATEGIES
            .iter()
            .map(|strategy| strategy.as_key().to_string())
            .collect(),
    }
}

fn metrics_response(state: &RuntimeAppState) -> RuntimeMetricsResponse {
    RuntimeMetricsResponse {
        service_name: state.config.service_name.clone(),
        environment: state.config.environment.as_str().to_string(),
        protocol_version: state.config.protocol_version.clone(),
        feed_bootstrap_source: state.feed_bootstrap_source.clone(),
        feed_bootstrap_error: state.feed_bootstrap_error.clone(),
        feed_gateway: state.feed_gateway_snapshot(),
        supported_strategies: SUPPORTED_STRATEGIES
            .iter()
            .map(|strategy| strategy.as_key().to_string())
            .collect(),
    }
}

async fn health_handler(State(state): State<RuntimeAppState>) -> Json<RuntimeHealthResponse> {
    Json(health_response(&state))
}

async fn metrics_handler(State(state): State<RuntimeAppState>) -> Json<RuntimeMetricsResponse> {
    Json(metrics_response(&state))
}

fn feed_gateway_config(config: &RuntimeConfig) -> FeedGatewayConfig {
    FeedGatewayConfig::new(
        &config.feed_provider,
        &config.feed_websocket_url,
        &config.feed_http_url,
        config.feed_market_stale_after_ms,
        config.feed_slot_stale_after_ms,
        config.feed_max_slot_gap,
    )
}

fn bootstrap_feed_gateway(
    feed_gateway: &mut FeedGateway,
    config: &RuntimeConfig,
) -> (String, Option<String>) {
    if let Some(path) = config.feed_replay_fixture_path.as_deref() {
        match FeedReplayFixture::load_from_path(path)
            .and_then(|fixture| feed_gateway.apply_replay_fixture(&fixture))
        {
            Ok(_) => return (format!("replay:{path}"), None),
            Err(error) => {
                let error_message = format!("replay-fixture-load-failed:{error}");
                feed_gateway.mark_degraded(&error_message);
                let (_, fallback_error) = seed_synthetic_bootstrap(feed_gateway);
                return (
                    "synthetic-bootstrap".to_string(),
                    Some(match fallback_error {
                        Some(fallback_error) => {
                            format!("{error_message}; fallback-bootstrap-failed:{fallback_error}")
                        }
                        None => error_message,
                    }),
                );
            }
        }
    }

    seed_synthetic_bootstrap(feed_gateway)
}

fn seed_synthetic_bootstrap(feed_gateway: &mut FeedGateway) -> (String, Option<String>) {
    match FeedReplayFixture::bootstrap(OffsetDateTime::now_utc())
        .and_then(|fixture| feed_gateway.apply_replay_fixture(&fixture))
    {
        Ok(_) => ("synthetic-bootstrap".to_string(), None),
        Err(error) => {
            let error_message = format!("synthetic-bootstrap-failed:{error}");
            feed_gateway.mark_degraded(&error_message);
            ("synthetic-bootstrap".to_string(), Some(error_message))
        }
    }
}

fn should_spawn_fixture_keepalive(config: &RuntimeConfig) -> bool {
    config.feed_provider == "fixture" && config.feed_replay_fixture_path.is_none()
}

fn spawn_fixture_keepalive(feed_gateway: Arc<RwLock<FeedGateway>>) {
    tokio::spawn(async move {
        let mut sequence_seed: u64 = 100;
        loop {
            sleep(Duration::from_secs(5)).await;
            sequence_seed = sequence_seed.saturating_add(100);
            let fixture = match FeedReplayFixture::bootstrap_with_sequence_seed(
                OffsetDateTime::now_utc(),
                sequence_seed,
            ) {
                Ok(fixture) => fixture,
                Err(error) => {
                    feed_gateway
                        .write()
                        .expect("feed gateway write lock")
                        .mark_degraded(&format!("fixture-keepalive-build-failed:{error}"));
                    continue;
                }
            };

            if let Err(error) = feed_gateway
                .write()
                .expect("feed gateway write lock")
                .apply_replay_fixture(&fixture)
            {
                feed_gateway
                    .write()
                    .expect("feed gateway write lock")
                    .mark_degraded(&format!("fixture-keepalive-apply-failed:{error}"));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn serves_health_endpoint() {
        let config = RuntimeConfig::from_lookup(|_| None).expect("config to load");
        let response = app(config)
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(axum::body::Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = response
            .into_body()
            .collect()
            .await
            .expect("body to collect")
            .to_bytes();
        let payload: RuntimeHealthResponse =
            serde_json::from_slice(&body).expect("health response");

        assert_eq!(payload.service_name, "runtime-rs");
        assert_eq!(payload.environment, "local");
        assert_eq!(payload.protocol_version, "v1");
        assert_eq!(payload.market_adapter_status, "healthy");
        assert_eq!(payload.feed_bootstrap_source, "synthetic-bootstrap");
        assert!(payload.feed_bootstrap_error.is_none());
        assert_eq!(payload.feed_gateway.market_streams.len(), 1);
        assert_eq!(payload.feed_gateway.slot_commitments.len(), 3);
        assert_eq!(payload.feed_gateway.status, "healthy");
    }

    #[tokio::test]
    async fn serves_metrics_endpoint() {
        let config = RuntimeConfig::from_lookup(|_| None).expect("config to load");
        let response = app(config)
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(axum::body::Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = response
            .into_body()
            .collect()
            .await
            .expect("body to collect")
            .to_bytes();
        let payload: RuntimeMetricsResponse =
            serde_json::from_slice(&body).expect("metrics response");

        assert_eq!(payload.service_name, "runtime-rs");
        assert_eq!(payload.environment, "local");
        assert_eq!(payload.protocol_version, "v1");
        assert_eq!(payload.feed_bootstrap_source, "synthetic-bootstrap");
        assert_eq!(payload.feed_gateway.market_events_accepted, 1);
        assert_eq!(payload.feed_gateway.slot_events_accepted, 3);
    }
}
