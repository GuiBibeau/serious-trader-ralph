use protocol::{RuntimeRiskDecision, RuntimeRiskVerdict};

#[must_use]
pub fn allows_execution(verdict: &RuntimeRiskVerdict) -> bool {
    verdict.verdict == RuntimeRiskDecision::Allow
}

#[must_use]
pub fn should_pause_runtime(verdict: &RuntimeRiskVerdict) -> bool {
    verdict.verdict == RuntimeRiskDecision::Pause
}

#[cfg(test)]
mod tests {
    use protocol::{
        RuntimeRiskLimits, RuntimeRiskObserved, RuntimeRiskReason, RuntimeRiskSeverity,
    };

    use super::*;

    fn sample_verdict(decision: RuntimeRiskDecision) -> RuntimeRiskVerdict {
        RuntimeRiskVerdict {
            schema_version: "v1".to_string(),
            verdict_id: "risk_1".to_string(),
            deployment_id: "dep_1".to_string(),
            run_id: "run_1".to_string(),
            decided_at: "2026-03-07T19:10:00Z".to_string(),
            verdict: decision,
            reasons: vec![RuntimeRiskReason {
                code: "sample".to_string(),
                message: "sample".to_string(),
                severity: RuntimeRiskSeverity::Info,
            }],
            observed: RuntimeRiskObserved {
                requested_notional_usd: "5".to_string(),
                reserved_usd: "5".to_string(),
                concentration_bps: 1000,
                feature_age_ms: 100,
            },
            limits: RuntimeRiskLimits {
                max_notional_usd: "25".to_string(),
                max_reserved_usd: "50".to_string(),
                max_concentration_bps: 3500,
                stale_after_ms: 5000,
            },
        }
    }

    #[test]
    fn surfaces_allow_and_pause_decisions() {
        assert!(allows_execution(&sample_verdict(
            RuntimeRiskDecision::Allow
        )));
        assert!(should_pause_runtime(&sample_verdict(
            RuntimeRiskDecision::Pause
        )));
        assert!(!allows_execution(&sample_verdict(
            RuntimeRiskDecision::Reject
        )));
    }
}
