use protocol::RuntimeExecutionPlan;

pub const RUNTIME_INTERNAL_AUTH_HEADER: &str = "authorization";
const DEFAULT_RUNTIME_WORKER_API_BASE: &str = "http://127.0.0.1:8888";
const DEFAULT_RUNTIME_EXECUTION_PLAN_PATH: &str = "/api/internal/runtime/execution-plans";
const DEFAULT_RUNTIME_HEALTH_PATH: &str = "/api/internal/runtime/health";

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
}

#[cfg(test)]
mod tests {
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
}
