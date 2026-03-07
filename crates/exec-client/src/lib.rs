use protocol::RuntimeExecutionPlan;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecClientConfig {
    pub api_base: String,
    pub submit_path: String,
    pub health_path: String,
}

impl Default for ExecClientConfig {
    fn default() -> Self {
        Self {
            api_base: "http://127.0.0.1:8888".to_string(),
            submit_path: "/api/internal/runtime/deployments".to_string(),
            health_path: "/api/internal/runtime/health".to_string(),
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
    pub fn submit_url(&self) -> String {
        format!("{}{}", self.config.api_base, self.config.submit_path)
    }

    #[must_use]
    pub fn health_url(&self) -> String {
        format!("{}{}", self.config.api_base, self.config.health_path)
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
            "http://127.0.0.1:8888/api/internal/runtime/deployments#plan_1",
        );
    }
}
