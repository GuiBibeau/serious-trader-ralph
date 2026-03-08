use protocol::{RuntimeExecutionPlan, RuntimeLane, RuntimeMode};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

pub const RUNTIME_INTERNAL_AUTH_HEADER: &str = "authorization";
const DEFAULT_RUNTIME_WORKER_API_BASE: &str = "http://127.0.0.1:8888";
const DEFAULT_RUNTIME_EXECUTION_PLAN_PATH: &str = "/api/internal/runtime/execution-plans";
const DEFAULT_RUNTIME_HEALTH_PATH: &str = "/api/internal/runtime/health";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecPlanCoordination {
    pub plan_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub mode: RuntimeMode,
    pub lane: RuntimeLane,
    pub slice_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecSubmitResponse {
    pub ok: bool,
    pub accepted: bool,
    pub source: String,
    pub submit_request_id: String,
    pub coordination: ExecPlanCoordination,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecClientError {
    pub code: ExecClientErrorCode,
    pub status: u16,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecClientErrorCode {
    PaymentRequired,
    AuthRequired,
    InvalidRequest,
    InvalidTransaction,
    PolicyDenied,
    UnsupportedLane,
    InsufficientBalance,
    VenueTimeout,
    SubmissionFailed,
    ExpiredBlockhash,
    NotFound,
    NotReady,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecClientConfig {
    pub api_base: String,
    pub submit_path: String,
    pub health_path: String,
    pub service_auth_token: Option<String>,
}

impl Default for ExecClientConfig {
    fn default() -> Self {
        Self {
            api_base: DEFAULT_RUNTIME_WORKER_API_BASE.to_string(),
            submit_path: DEFAULT_RUNTIME_EXECUTION_PLAN_PATH.to_string(),
            health_path: DEFAULT_RUNTIME_HEALTH_PATH.to_string(),
            service_auth_token: None,
        }
    }
}

impl ExecClientConfig {
    #[must_use]
    pub fn from_lookup<F>(lookup: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        let api_base = lookup("RUNTIME_WORKER_API_BASE")
            .unwrap_or_else(|| DEFAULT_RUNTIME_WORKER_API_BASE.to_string())
            .trim_end_matches('/')
            .to_string();
        let submit_path = lookup("RUNTIME_WORKER_EXECUTION_PLAN_PATH")
            .unwrap_or_else(|| DEFAULT_RUNTIME_EXECUTION_PLAN_PATH.to_string());
        let health_path = lookup("RUNTIME_WORKER_HEALTH_PATH")
            .unwrap_or_else(|| DEFAULT_RUNTIME_HEALTH_PATH.to_string());
        let service_auth_token = lookup("RUNTIME_INTERNAL_SERVICE_TOKEN")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        Self {
            api_base,
            submit_path,
            health_path,
            service_auth_token,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExecClient {
    config: ExecClientConfig,
}

impl ExecClient {
    #[must_use]
    pub fn new(config: ExecClientConfig) -> Self {
        Self { config }
    }

    #[must_use]
    pub fn from_lookup<F>(lookup: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        Self::new(ExecClientConfig::from_lookup(lookup))
    }

    #[must_use]
    pub fn submit_url(&self) -> String {
        format!("{}{}", self.config.api_base, self.config.submit_path)
    }

    #[must_use]
    pub fn health_url(&self) -> String {
        format!("{}{}", self.config.api_base, self.config.health_path)
    }

    #[must_use]
    pub fn auth_header_name(&self) -> Option<&'static str> {
        self.config
            .service_auth_token
            .as_ref()
            .map(|_| RUNTIME_INTERNAL_AUTH_HEADER)
    }

    #[must_use]
    pub fn auth_header_value(&self) -> Option<String> {
        self.config
            .service_auth_token
            .as_ref()
            .map(|token| format!("Bearer {token}"))
    }

    #[must_use]
    pub fn has_service_auth(&self) -> bool {
        self.config.service_auth_token.is_some()
    }

    #[must_use]
    pub fn submit_reference(&self, plan: &RuntimeExecutionPlan) -> String {
        format!("{}#{}", self.submit_url(), plan.plan_id)
    }

    pub async fn submit_plan(
        &self,
        plan: &RuntimeExecutionPlan,
    ) -> Result<ExecSubmitResponse, ExecClientError> {
        let client = reqwest::Client::new();
        let mut request = client
            .post(self.submit_url())
            .header("content-type", "application/json")
            .json(plan);
        if let Some(value) = self.auth_header_value() {
            request = request.header(RUNTIME_INTERNAL_AUTH_HEADER, value);
        }

        let response = request.send().await.map_err(|error| ExecClientError {
            code: ExecClientErrorCode::SubmissionFailed,
            status: 502,
            message: error.to_string(),
        })?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(map_error_response(status, &body));
        }

        serde_json::from_str::<ExecSubmitResponse>(&body).map_err(|error| ExecClientError {
            code: ExecClientErrorCode::SubmissionFailed,
            status: 502,
            message: error.to_string(),
        })
    }
}

fn map_error_response(status: StatusCode, body: &str) -> ExecClientError {
    let lower = body.trim().to_lowercase();
    let code = if status == StatusCode::PAYMENT_REQUIRED || lower.contains("payment-required") {
        ExecClientErrorCode::PaymentRequired
    } else if status == StatusCode::UNAUTHORIZED || lower.contains("auth-required") {
        ExecClientErrorCode::AuthRequired
    } else if lower.contains("invalid-request") || lower.contains("invalid-runtime-execution-plan")
    {
        ExecClientErrorCode::InvalidRequest
    } else if lower.contains("invalid-transaction") {
        ExecClientErrorCode::InvalidTransaction
    } else if lower.contains("policy-denied") {
        ExecClientErrorCode::PolicyDenied
    } else if lower.contains("unsupported-lane") {
        ExecClientErrorCode::UnsupportedLane
    } else if lower.contains("insufficient-balance") {
        ExecClientErrorCode::InsufficientBalance
    } else if lower.contains("timeout") {
        ExecClientErrorCode::VenueTimeout
    } else if lower.contains("expired-blockhash") {
        ExecClientErrorCode::ExpiredBlockhash
    } else if status == StatusCode::NOT_FOUND || lower.contains("not-found") {
        ExecClientErrorCode::NotFound
    } else if status == StatusCode::SERVICE_UNAVAILABLE
        || lower.contains("runtime-integration-not-configured")
        || lower.contains("not-ready")
    {
        ExecClientErrorCode::NotReady
    } else {
        ExecClientErrorCode::SubmissionFailed
    };
    ExecClientError {
        code,
        status: status.as_u16(),
        message: if body.trim().is_empty() {
            format!(
                "runtime execution coordination failed with status {}",
                status.as_u16()
            )
        } else {
            body.trim().to_string()
        },
    }
}

#[cfg(test)]
mod tests {
    use axum::{routing::post, Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    use protocol::{RuntimeLane, RuntimeMode};

    use super::*;

    #[test]
    fn builds_internal_urls() {
        let client = ExecClient::new(ExecClientConfig::default());
        let plan = RuntimeExecutionPlan {
            schema_version: "v1".to_string(),
            plan_id: "plan_1".to_string(),
            deployment_id: "dep_1".to_string(),
            run_id: "run_1".to_string(),
            created_at: "2026-03-07T19:00:00Z".to_string(),
            mode: RuntimeMode::Shadow,
            lane: RuntimeLane::Safe,
            idempotency_key: "dep_1:run_1".to_string(),
            simulate_only: true,
            dry_run: true,
            slices: vec![],
        };

        assert_eq!(
            client.health_url(),
            "http://127.0.0.1:8888/api/internal/runtime/health",
        );
        assert_eq!(
            client.submit_reference(&plan),
            "http://127.0.0.1:8888/api/internal/runtime/execution-plans#plan_1",
        );
        assert_eq!(client.auth_header_name(), None);
        assert_eq!(client.auth_header_value(), None);
    }

    #[test]
    fn loads_service_auth_from_lookup() {
        let client = ExecClient::from_lookup(|key| match key {
            "RUNTIME_WORKER_API_BASE" => Some("https://worker.internal/".to_string()),
            "RUNTIME_INTERNAL_SERVICE_TOKEN" => Some("runtime-secret".to_string()),
            _ => None,
        });

        assert_eq!(
            client.submit_url(),
            "https://worker.internal/api/internal/runtime/execution-plans",
        );
        assert_eq!(
            client.auth_header_name(),
            Some(RUNTIME_INTERNAL_AUTH_HEADER),
        );
        assert_eq!(
            client.auth_header_value().as_deref(),
            Some("Bearer runtime-secret"),
        );
        assert!(client.has_service_auth());
    }

    #[tokio::test]
    async fn submits_execution_plans_with_service_auth() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/api/internal/runtime/execution-plans",
                    post(
                        |headers: axum::http::HeaderMap,
                         Json(plan): Json<RuntimeExecutionPlan>| async move {
                            assert_eq!(
                                headers
                                    .get("authorization")
                                    .and_then(|value| value.to_str().ok()),
                                Some("Bearer runtime-secret"),
                            );
                            Json(json!({
                                "ok": true,
                                "accepted": true,
                                "source": "stub",
                                "submitRequestId": "submit_runtime_1",
                                "coordination": {
                                    "planId": plan.plan_id,
                                    "deploymentId": plan.deployment_id,
                                    "runId": plan.run_id,
                                    "mode": plan.mode,
                                    "lane": plan.lane,
                                    "sliceCount": plan.slices.len(),
                                }
                            }))
                        },
                    ),
                ),
            )
            .await
            .expect("server");
        });

        let client = ExecClient::from_lookup(|key| match key {
            "RUNTIME_WORKER_API_BASE" => Some(format!("http://{address}")),
            "RUNTIME_INTERNAL_SERVICE_TOKEN" => Some("runtime-secret".to_string()),
            _ => None,
        });
        let plan = RuntimeExecutionPlan {
            schema_version: "v1".to_string(),
            plan_id: "plan_1".to_string(),
            deployment_id: "dep_1".to_string(),
            run_id: "run_1".to_string(),
            created_at: "2026-03-07T19:00:00Z".to_string(),
            mode: RuntimeMode::Paper,
            lane: RuntimeLane::Protected,
            idempotency_key: "dep_1:run_1".to_string(),
            simulate_only: false,
            dry_run: true,
            slices: vec![],
        };

        let response = client.submit_plan(&plan).await.expect("submit to succeed");
        assert!(response.accepted);
        assert_eq!(response.submit_request_id, "submit_runtime_1");
        assert_eq!(response.coordination.plan_id, "plan_1");
        assert_eq!(response.coordination.lane, RuntimeLane::Protected);

        server.abort();
    }

    #[tokio::test]
    async fn maps_internal_route_errors_to_canonical_codes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/api/internal/runtime/execution-plans",
                    post(|| async move {
                        (
                            StatusCode::SERVICE_UNAVAILABLE,
                            Json(json!({
                                "ok": false,
                                "error": "runtime-integration-not-configured"
                            })),
                        )
                    }),
                ),
            )
            .await
            .expect("server");
        });

        let client = ExecClient::from_lookup(|key| match key {
            "RUNTIME_WORKER_API_BASE" => Some(format!("http://{address}")),
            _ => None,
        });
        let plan = RuntimeExecutionPlan {
            schema_version: "v1".to_string(),
            plan_id: "plan_2".to_string(),
            deployment_id: "dep_2".to_string(),
            run_id: "run_2".to_string(),
            created_at: "2026-03-07T19:00:00Z".to_string(),
            mode: RuntimeMode::Shadow,
            lane: RuntimeLane::Safe,
            idempotency_key: "dep_2:run_2".to_string(),
            simulate_only: true,
            dry_run: true,
            slices: vec![],
        };

        let error = client
            .submit_plan(&plan)
            .await
            .expect_err("submit should fail");
        assert_eq!(error.code, ExecClientErrorCode::NotReady);
        assert_eq!(error.status, 503);

        server.abort();
    }
}
