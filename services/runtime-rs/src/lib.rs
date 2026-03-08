use std::{
    env,
    sync::{Arc, RwLock},
};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use exec_client::ExecClient;
use feature_cache::{FeatureCache, FeatureCacheConfig, FeatureCacheSnapshot};
use market_adapters::{FeedGateway, FeedGatewayConfig, FeedGatewaySnapshot, FeedReplayFixture};
use protocol::{RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeRunRecord};
use runtime_ops::{health_snapshot, RuntimeConfig};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use strategy_core::SUPPORTED_STRATEGIES;
use strategy_registry::{
    ShadowEvaluationResult, ShadowEvaluationTrigger, StrategyRegistry, StrategyRegistryConfig,
    StrategyRegistryError, StrategyRegistrySnapshot,
};
use time::OffsetDateTime;
use tokio::time::{sleep, Duration};

const INTERNAL_RUNTIME_PREFIX: &str = "/api/internal/runtime";

type JsonPayload = (StatusCode, Json<Value>);
type HandlerResult = Result<JsonPayload, JsonPayload>;

#[derive(Debug, Clone)]
pub struct RuntimeAppState {
    config: RuntimeConfig,
    exec_client: ExecClient,
    feed_bootstrap_source: String,
    feed_bootstrap_error: Option<String>,
    feed_gateway: Arc<RwLock<FeedGateway>>,
    feature_cache: Arc<RwLock<FeatureCache>>,
    strategy_registry: StrategyRegistry,
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
        let strategy_registry =
            StrategyRegistry::new(StrategyRegistryConfig::new(config.database_url.clone()))
                .expect("strategy registry to initialize");
        Self {
            config,
            exec_client: ExecClient::from_lookup(|key| env::var(key).ok()),
            feed_bootstrap_source,
            feed_bootstrap_error,
            feed_gateway,
            feature_cache,
            strategy_registry,
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

    fn strategy_registry_snapshot(&self) -> StrategyRegistrySnapshot {
        self.strategy_registry.snapshot_now()
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
    pub internal_service_auth_configured: bool,
    pub market_adapter_status: String,
    pub feed_bootstrap_source: String,
    pub feed_bootstrap_error: Option<String>,
    pub feed_gateway: FeedGatewaySnapshot,
    pub feature_cache: FeatureCacheSnapshot,
    pub strategy_registry: StrategyRegistrySnapshot,
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
    pub strategy_registry: StrategyRegistrySnapshot,
    pub supported_strategies: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeShadowEvaluationRequest {
    pub trigger: Option<ShadowEvaluationTrigger>,
}

pub fn app(config: RuntimeConfig) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/health"),
            get(internal_health_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments"),
            post(create_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}"),
            get(get_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/pause"),
            post(pause_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/resume"),
            post(resume_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/kill"),
            post(kill_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/evaluate"),
            post(evaluate_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/runs/{{deployment_id}}"),
            get(list_runs_handler),
        )
        .with_state(RuntimeAppState::new(config))
}

fn health_response(state: &RuntimeAppState) -> RuntimeHealthResponse {
    let snapshot = health_snapshot(&state.config);
    let feed_gateway = state.feed_gateway_snapshot();
    let feature_cache = state.feature_cache_snapshot();
    let strategy_registry = state.strategy_registry_snapshot();
    let status = if feed_gateway.status == "healthy"
        && feature_cache.status == "healthy"
        && strategy_registry.status == "healthy"
    {
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
        internal_service_auth_configured: state.config.internal_service_token.is_some(),
        market_adapter_status: feed_gateway.status.clone(),
        feed_bootstrap_source: state.feed_bootstrap_source.clone(),
        feed_bootstrap_error: state.feed_bootstrap_error.clone(),
        feed_gateway,
        feature_cache,
        strategy_registry,
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
        strategy_registry: state.strategy_registry_snapshot(),
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

async fn internal_health_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "health": health_response(&state),
        }),
    ))
}

async fn create_deployment_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment: RuntimeDeploymentRecord = parse_json_body(&body, "invalid-runtime-deployment")?;
    let result = state
        .strategy_registry
        .upsert_deployment(&deployment)
        .map_err(map_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "deployment": result.deployment,
        }),
    ))
}

async fn get_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment = state
        .strategy_registry
        .get_deployment(&deployment_id)
        .map_err(map_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "deployment-not-found",
                json!({ "deploymentId": deployment_id }),
            )
        })?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deployment": deployment,
        }),
    ))
}

async fn pause_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    transition_deployment_handler(
        headers,
        deployment_id,
        state,
        RuntimeDeploymentState::Paused,
    )
    .await
}

async fn resume_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment = state
        .strategy_registry
        .get_deployment(&deployment_id)
        .map_err(map_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "deployment-not-found",
                json!({ "deploymentId": deployment_id }),
            )
        })?;
    let next_state = match deployment.mode {
        protocol::RuntimeMode::Shadow => RuntimeDeploymentState::Shadow,
        protocol::RuntimeMode::Paper => RuntimeDeploymentState::Paper,
        protocol::RuntimeMode::Live => RuntimeDeploymentState::Live,
    };
    transition_deployment(deployment_id, state, next_state)
}

async fn kill_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    transition_deployment_handler(
        headers,
        deployment_id,
        state,
        RuntimeDeploymentState::Killed,
    )
    .await
}

async fn transition_deployment_handler(
    headers: HeaderMap,
    deployment_id: String,
    state: RuntimeAppState,
    next_state: RuntimeDeploymentState,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    transition_deployment(deployment_id, state, next_state)
}

fn transition_deployment(
    deployment_id: String,
    state: RuntimeAppState,
    next_state: RuntimeDeploymentState,
) -> HandlerResult {
    let deployment = state
        .strategy_registry
        .transition_deployment(&deployment_id, next_state)
        .map_err(map_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deployment": deployment,
        }),
    ))
}

async fn evaluate_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let request = if body.is_empty() {
        RuntimeShadowEvaluationRequest::default()
    } else {
        parse_json_body::<RuntimeShadowEvaluationRequest>(&body, "invalid-runtime-evaluation")?
    };
    let result = state
        .strategy_registry
        .evaluate_shadow_trigger(
            &deployment_id,
            &state.feature_cache_snapshot(),
            request.trigger,
        )
        .map_err(map_registry_error)?;
    Ok(shadow_evaluation_json(result))
}

async fn list_runs_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let runs: Vec<RuntimeRunRecord> = state
        .strategy_registry
        .list_runs(&deployment_id)
        .map_err(map_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "runs": runs,
        }),
    ))
}

fn shadow_evaluation_json(result: ShadowEvaluationResult) -> JsonPayload {
    OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "deployment": result.deployment,
            "run": result.run,
            "featureSnapshot": result.feature_snapshot,
        }),
    )
}

fn parse_json_body<T: DeserializeOwned>(body: &[u8], error_code: &str) -> Result<T, JsonPayload> {
    serde_json::from_slice(body).map_err(|error| {
        error_json(
            StatusCode::BAD_REQUEST,
            error_code,
            json!({ "reason": error.to_string() }),
        )
    })
}

fn authorize_internal_request(
    headers: &HeaderMap,
    state: &RuntimeAppState,
) -> Result<(), JsonPayload> {
    let configured_token = state
        .config
        .internal_service_token
        .as_deref()
        .unwrap_or("")
        .trim();
    if configured_token.is_empty() {
        return Err(error_json(
            StatusCode::SERVICE_UNAVAILABLE,
            "runtime-service-auth-not-configured",
            json!({}),
        ));
    }

    let provided_token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_bearer_token);

    if provided_token.as_deref() != Some(configured_token) {
        return Err(error_json(
            StatusCode::UNAUTHORIZED,
            "auth-required",
            json!({}),
        ));
    }

    Ok(())
}

fn parse_bearer_token(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.len() < 7 {
        return None;
    }
    let (scheme, token) = raw.split_at(7);
    if !scheme.eq_ignore_ascii_case("bearer ") {
        return None;
    }
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn map_registry_error(error: StrategyRegistryError) -> JsonPayload {
    match error {
        StrategyRegistryError::DeploymentNotFound { deployment_id } => error_json(
            StatusCode::NOT_FOUND,
            "deployment-not-found",
            json!({ "deploymentId": deployment_id }),
        ),
        StrategyRegistryError::UnsupportedStrategy(strategy_key) => error_json(
            StatusCode::BAD_REQUEST,
            "unsupported-strategy",
            json!({ "strategyKey": strategy_key }),
        ),
        StrategyRegistryError::ImmutableFieldChanged {
            deployment_id,
            field,
        } => error_json(
            StatusCode::CONFLICT,
            "deployment-conflict",
            json!({ "deploymentId": deployment_id, "field": field }),
        ),
        StrategyRegistryError::InvalidStateTransition {
            deployment_id,
            from_state,
            to_state,
        } => error_json(
            StatusCode::CONFLICT,
            "invalid-state-transition",
            json!({
                "deploymentId": deployment_id,
                "fromState": from_state,
                "toState": to_state,
            }),
        ),
        StrategyRegistryError::DeploymentNotShadow {
            deployment_id,
            state,
        } => error_json(
            StatusCode::CONFLICT,
            "deployment-not-shadow",
            json!({
                "deploymentId": deployment_id,
                "state": state,
            }),
        ),
        StrategyRegistryError::FeatureStreamMissing { symbol } => error_json(
            StatusCode::CONFLICT,
            "feature-stream-missing",
            json!({ "symbol": symbol }),
        ),
        StrategyRegistryError::FeatureStreamStale { symbol, reasons } => error_json(
            StatusCode::CONFLICT,
            "feature-stream-stale",
            json!({ "symbol": symbol, "reasons": reasons }),
        ),
        StrategyRegistryError::InvalidObservedAt(value) => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-trigger",
            json!({ "observedAt": value }),
        ),
        StrategyRegistryError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        StrategyRegistryError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        StrategyRegistryError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-registry-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn error_json(status: StatusCode, error: &str, details: Value) -> JsonPayload {
    (
        status,
        Json(json!({
            "ok": false,
            "error": error,
            "details": details,
        })),
    )
}

struct OkJson;

impl OkJson {
    fn with_status(status: StatusCode, payload: Value) -> JsonPayload {
        (status, Json(payload))
    }
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
    use std::time::{SystemTime, UNIX_EPOCH};

    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("runtime-rs-{test_name}-{unique}.sqlite3"))
            .display()
            .to_string()
    }

    fn test_config() -> RuntimeConfig {
        RuntimeConfig::from_lookup(|key| match key {
            "RUNTIME_INTERNAL_SERVICE_TOKEN" => Some("runtime-service-secret".to_string()),
            "RUNTIME_DATABASE_URL" => Some(temp_database_url("config")),
            _ => None,
        })
        .expect("config to load")
    }

    async fn read_json(response: axum::response::Response) -> Value {
        let body = response
            .into_body()
            .collect()
            .await
            .expect("body to collect")
            .to_bytes();
        serde_json::from_slice(&body).expect("json payload")
    }

    #[tokio::test]
    async fn serves_health_endpoint() {
        let response = app(test_config())
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: RuntimeHealthResponse =
            serde_json::from_value(read_json(response).await).expect("health response");

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
        assert_eq!(payload.strategy_registry.status, "healthy");
        assert_eq!(payload.strategy_registry.deployment_count, 0);
        assert!(payload.internal_service_auth_configured);
    }

    #[tokio::test]
    async fn serves_metrics_endpoint() {
        let response = app(test_config())
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: RuntimeMetricsResponse =
            serde_json::from_value(read_json(response).await).expect("metrics response");

        assert_eq!(payload.service_name, "runtime-rs");
        assert_eq!(payload.environment, "local");
        assert_eq!(payload.protocol_version, "v1");
        assert_eq!(payload.feed_bootstrap_source, "synthetic-bootstrap");
        assert_eq!(payload.feed_gateway.market_events_accepted, 1);
        assert_eq!(payload.feed_gateway.slot_events_accepted, 3);
        assert_eq!(payload.feature_cache.feature_streams.len(), 1);
        assert_eq!(payload.feature_cache.total_market_samples, 1);
        assert_eq!(payload.strategy_registry.status, "healthy");
    }

    #[tokio::test]
    async fn internal_routes_require_service_auth() {
        let response = app(test_config())
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            read_json(response).await,
            json!({
                "ok": false,
                "error": "auth-required",
                "details": {},
            })
        );
    }

    #[tokio::test]
    async fn stores_and_evaluates_shadow_deployments() {
        let router = app(test_config());
        let deployment = json!({
            "schemaVersion": "v1",
            "deploymentId": "deployment_123",
            "strategyKey": "dca",
            "sleeveId": "sleeve_alpha",
            "ownerUserId": "user_123",
            "pair": {
                "symbol": "SOL/USDC",
                "baseMint": "So11111111111111111111111111111111111111112",
                "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            "mode": "shadow",
            "state": "shadow",
            "lane": "safe",
            "createdAt": "2026-03-07T00:00:00.000Z",
            "updatedAt": "2026-03-07T00:00:00.000Z",
            "policy": {
                "maxNotionalUsd": "250.00",
                "dailyLossLimitUsd": "35.00",
                "maxSlippageBps": 50,
                "maxConcurrentRuns": 2,
                "rebalanceToleranceBps": 100
            },
            "capital": {
                "allocatedUsd": "1000.00",
                "reservedUsd": "125.00",
                "availableUsd": "875.00"
            },
            "tags": ["fixture"]
        });

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_123/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(evaluation_payload["ok"], json!(true));
        assert_eq!(evaluation_payload["created"], json!(true));
        assert_eq!(evaluation_payload["run"]["state"], json!("planned"));

        let duplicate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_123/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(duplicate_response.status(), StatusCode::OK);
        let duplicate_payload = read_json(duplicate_response).await;
        assert_eq!(duplicate_payload["created"], json!(false));
        assert_eq!(
            duplicate_payload["run"]["runKey"],
            evaluation_payload["run"]["runKey"]
        );

        let runs_response = router
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/runs/deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(runs_response.status(), StatusCode::OK);
        let runs_payload = read_json(runs_response).await;
        assert_eq!(runs_payload["runs"].as_array().expect("array").len(), 1);
    }
}
