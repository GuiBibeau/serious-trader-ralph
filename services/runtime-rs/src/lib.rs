use std::{
    env,
    sync::{Arc, RwLock},
};

use axum::{extract::State, routing::get, Json, Router};
use exec_client::ExecClient;
use feature_cache::{FeatureCache, FeatureCacheConfig, FeatureCacheSnapshot};
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
    feature_cache: Arc<RwLock<FeatureCache>>,
}

impl RuntimeAppState {
    #[must_use]
    pub fn new(config: RuntimeConfig) -> Self {
        let mut feed_gateway = FeedGateway::new(feed_gateway_config(&config));
        let mut feature_cache = FeatureCache::new(feature_cache_config(&config));
        let (feed_bootstrap_source, feed_bootstrap_error) =
            bootstrap_runtime_state(&mut feed_gateway, &mut feature_cache, &config);
        let feed_gateway = Arc::new(RwLock::new(feed_gateway));
        let feature_cache = Arc::new(RwLock::new(feature_cache));
        if should_spawn_fixture_keepalive(&config) {
            spawn_fixture_keepalive(feed_gateway.clone(), feature_cache.clone());
        }
        Self {
            config,
            exec_client: ExecClient::from_lookup(|key| env::var(key).ok()),
            feed_bootstrap_source,
            feed_bootstrap_error,
            feed_gateway,
            feature_cache,
        }
    }

    fn feed_gateway_snapshot(&self) -> FeedGatewaySnapshot {
        self.feed_gateway
            .read()
            .expect("feed gateway read lock")
            .snapshot_now()
    }

    fn feature_cache_snapshot(&self) -> FeatureCacheSnapshot {
        self.feature_cache
            .read()
            .expect("feature cache read lock")
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
    pub feature_cache: FeatureCacheSnapshot,
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
    pub feature_cache: FeatureCacheSnapshot,
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
    let feature_cache = state.feature_cache_snapshot();
    let status = if feed_gateway.status == "healthy" && feature_cache.status == "healthy" {
        snapshot.status
    } else {
        "degraded".to_string()
    };
    RuntimeHealthResponse {
        service_name: snapshot.service_name,
        status,
        environment: snapshot.environment,
        protocol_version: snapshot.protocol_version,
        bind_address: snapshot.bind_address,
        exec_health_url: state.exec_client.health_url(),
        worker_service_auth_configured: state.exec_client.has_service_auth(),
        market_adapter_status: feed_gateway.status.clone(),
        feed_bootstrap_source: state.feed_bootstrap_source.clone(),
        feed_bootstrap_error: state.feed_bootstrap_error.clone(),
        feed_gateway,
        feature_cache,
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
        feature_cache: state.feature_cache_snapshot(),
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

fn feature_cache_config(config: &RuntimeConfig) -> FeatureCacheConfig {
    FeatureCacheConfig::new(
        config.feature_stale_after_ms,
        config.feed_slot_stale_after_ms,
        config.feed_max_slot_gap,
        config.feature_short_window_ms,
        config.feature_long_window_ms,
        config.feature_volatility_window_size,
        config.feature_max_samples_per_stream,
    )
}

fn bootstrap_runtime_state(
    feed_gateway: &mut FeedGateway,
    feature_cache: &mut FeatureCache,
    config: &RuntimeConfig,
) -> (String, Option<String>) {
    if let Some(path) = config.feed_replay_fixture_path.as_deref() {
        match FeedReplayFixture::load_from_path(path)
            .map_err(BootstrapError::Feed)
            .and_then(|fixture| apply_fixture(feed_gateway, feature_cache, &fixture))
        {
            Ok(_) => return (format!("replay:{path}"), None),
            Err(error) => {
                let error_message = format!("replay-fixture-load-failed:{error}");
                feed_gateway.mark_degraded(&error_message);
                feature_cache.mark_degraded(&error_message);
                let (_, fallback_error) = seed_synthetic_bootstrap(feed_gateway, feature_cache);
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

    seed_synthetic_bootstrap(feed_gateway, feature_cache)
}

fn seed_synthetic_bootstrap(
    feed_gateway: &mut FeedGateway,
    feature_cache: &mut FeatureCache,
) -> (String, Option<String>) {
    match FeedReplayFixture::bootstrap(OffsetDateTime::now_utc())
        .map_err(BootstrapError::Feed)
        .and_then(|fixture| apply_fixture(feed_gateway, feature_cache, &fixture))
    {
        Ok(_) => ("synthetic-bootstrap".to_string(), None),
        Err(error) => {
            let error_message = format!("synthetic-bootstrap-failed:{error}");
            feed_gateway.mark_degraded(&error_message);
            feature_cache.mark_degraded(&error_message);
            ("synthetic-bootstrap".to_string(), Some(error_message))
        }
    }
}

fn should_spawn_fixture_keepalive(config: &RuntimeConfig) -> bool {
    config.feed_provider == "fixture" && config.feed_replay_fixture_path.is_none()
}

fn spawn_fixture_keepalive(
    feed_gateway: Arc<RwLock<FeedGateway>>,
    feature_cache: Arc<RwLock<FeatureCache>>,
) {
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
                    feature_cache
                        .write()
                        .expect("feature cache write lock")
                        .mark_degraded(&format!("fixture-keepalive-build-failed:{error}"));
                    continue;
                }
            };

            let apply_result = {
                let mut feed_gateway = feed_gateway.write().expect("feed gateway write lock");
                let mut feature_cache = feature_cache.write().expect("feature cache write lock");
                apply_fixture(&mut feed_gateway, &mut feature_cache, &fixture)
            };
            if let Err(error) = apply_result {
                feed_gateway
                    .write()
                    .expect("feed gateway write lock")
                    .mark_degraded(&format!("fixture-keepalive-apply-failed:{error}"));
                feature_cache
                    .write()
                    .expect("feature cache write lock")
                    .mark_degraded(&format!("fixture-keepalive-apply-failed:{error}"));
            }
        }
    });
}

#[derive(Debug)]
enum BootstrapError {
    Feed(market_adapters::FeedGatewayError),
    Features(feature_cache::FeatureCacheError),
}

impl std::fmt::Display for BootstrapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Feed(error) => write!(f, "{error}"),
            Self::Features(error) => write!(f, "{error}"),
        }
    }
}

fn apply_fixture(
    feed_gateway: &mut FeedGateway,
    feature_cache: &mut FeatureCache,
    fixture: &FeedReplayFixture,
) -> Result<(), BootstrapError> {
    feed_gateway
        .apply_replay_fixture(fixture)
        .map_err(BootstrapError::Feed)?;
    feature_cache
        .apply_replay_fixture(fixture)
        .map_err(BootstrapError::Features)?;
    Ok(())
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
        assert_eq!(payload.feature_cache.status, "healthy");
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
        assert_eq!(payload.feature_cache.feature_streams.len(), 1);
        assert_eq!(payload.feature_cache.total_market_samples, 1);
    }
}
