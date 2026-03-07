use axum::{extract::State, routing::get, Json, Router};
use exec_client::{ExecClient, ExecClientConfig};
use market_adapters::MarketAdapterHealth;
use runtime_ops::{health_snapshot, RuntimeConfig};
use serde::{Deserialize, Serialize};
use strategy_core::SUPPORTED_STRATEGIES;

#[derive(Debug, Clone)]
pub struct RuntimeAppState {
    config: RuntimeConfig,
    exec_client: ExecClient,
    market_adapter_health: MarketAdapterHealth,
}

impl RuntimeAppState {
    #[must_use]
    pub fn new(config: RuntimeConfig) -> Self {
        Self {
            config,
            exec_client: ExecClient::new(ExecClientConfig::default()),
            market_adapter_health: MarketAdapterHealth::bootstrap(
                "bootstrap",
                "wss://placeholder.invalid/runtime",
                "https://placeholder.invalid/runtime",
            ),
        }
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
    pub market_adapter_status: String,
    pub supported_strategies: Vec<String>,
}

pub fn app(config: RuntimeConfig) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .with_state(RuntimeAppState::new(config))
}

fn health_response(state: &RuntimeAppState) -> RuntimeHealthResponse {
    let snapshot = health_snapshot(&state.config);
    RuntimeHealthResponse {
        service_name: snapshot.service_name,
        status: snapshot.status,
        environment: snapshot.environment,
        protocol_version: snapshot.protocol_version,
        bind_address: snapshot.bind_address,
        exec_health_url: state.exec_client.health_url(),
        market_adapter_status: state.market_adapter_health.status_label().to_string(),
        supported_strategies: SUPPORTED_STRATEGIES
            .iter()
            .map(|strategy| strategy.as_key().to_string())
            .collect(),
    }
}

async fn health_handler(State(state): State<RuntimeAppState>) -> Json<RuntimeHealthResponse> {
    Json(health_response(&state))
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
    }
}
