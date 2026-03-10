use std::collections::HashMap;

use protocol::{
    RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeExecutionPlan,
    RuntimeExpectedObservedScorecard, RuntimeLedgerSnapshot, RuntimeMode,
    RuntimePlanQualityScorecard, RuntimePnlScorecard, RuntimePromotionGateCheck,
    RuntimePromotionGateDecision, RuntimePromotionGateStatus, RuntimePromotionReadinessReport,
    RuntimeReconciliationResult, RuntimeReconciliationStatus, RuntimeRiskDecision,
    RuntimeRiskScorecard, RuntimeRiskVerdict, RuntimeRunRecord, RuntimeRunState, RuntimeScorecard,
    RuntimeTriggerQualityScorecard, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScorecardConfig {
    pub shadow_min_runs: u64,
    pub paper_min_runs: u64,
    pub required_plan_coverage_bps: u16,
    pub required_reconciliation_pass_bps: u16,
    pub shadow_max_failed_runs: u64,
    pub paper_max_failed_runs: u64,
    pub shadow_max_pause_verdicts: u64,
    pub paper_max_pause_verdicts: u64,
    pub paper_max_correction_count: u64,
}

impl Default for RuntimeScorecardConfig {
    fn default() -> Self {
        Self {
            shadow_min_runs: 3,
            paper_min_runs: 5,
            required_plan_coverage_bps: 10_000,
            required_reconciliation_pass_bps: 10_000,
            shadow_max_failed_runs: 0,
            paper_max_failed_runs: 0,
            shadow_max_pause_verdicts: 0,
            paper_max_pause_verdicts: 0,
            paper_max_correction_count: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScorecardInput {
    pub deployment: RuntimeDeploymentRecord,
    pub runs: Vec<RuntimeRunRecord>,
    pub verdicts: Vec<RuntimeRiskVerdict>,
    pub plans: Vec<RuntimeExecutionPlan>,
    pub submit_attempt_count: u64,
    pub receipt_count: u64,
    pub reconciliations: Vec<RuntimeReconciliationResult>,
    pub observed_ledger_snapshots: Vec<RuntimeLedgerSnapshot>,
    pub latest_ledger_snapshot: Option<RuntimeLedgerSnapshot>,
}

#[derive(Debug, Error)]
pub enum RuntimeScorecardError {
    #[error("invalid usd amount for {field}: {value}")]
    InvalidUsdAmount { field: &'static str, value: String },
}

pub fn build_readiness_report(
    config: &RuntimeScorecardConfig,
    input: &RuntimeScorecardInput,
) -> Result<RuntimePromotionReadinessReport, RuntimeScorecardError> {
    let scorecard = build_scorecard(input)?;
    let promotion_gates = build_promotion_gates(config, input, &scorecard)?;
    Ok(RuntimePromotionReadinessReport {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        deployment_id: input.deployment.deployment_id.clone(),
        mode: input.deployment.mode.clone(),
        state: input.deployment.state.clone(),
        generated_at: now_rfc3339(),
        proof_artifact_markdown: build_proof_artifact_markdown(input, &scorecard, &promotion_gates),
        scorecard,
        promotion_gates,
    })
}

fn build_scorecard(
    input: &RuntimeScorecardInput,
) -> Result<RuntimeScorecard, RuntimeScorecardError> {
    let verdict_by_run = verdict_by_run_id(&input.verdicts);
    let total_runs = input.runs.len() as u64;
    let stale_feature_reject_count = input
        .verdicts
        .iter()
        .filter(|verdict| {
            verdict.verdict != RuntimeRiskDecision::Allow
                && verdict
                    .reasons
                    .iter()
                    .any(|reason| reason.code == "feature_stale")
        })
        .count() as u64;
    let fresh_trigger_count = total_runs.saturating_sub(stale_feature_reject_count);

    let allowed_run_count = input
        .runs
        .iter()
        .filter(|run| {
            verdict_by_run
                .get(run.run_id.as_str())
                .is_some_and(|verdict| verdict.verdict == RuntimeRiskDecision::Allow)
        })
        .count() as u64;
    let planned_run_count = input.plans.len() as u64;
    let dry_run_count = input.plans.iter().filter(|plan| plan.dry_run).count() as u64;
    let simulate_only_count = input.plans.iter().filter(|plan| plan.simulate_only).count() as u64;

    let reconciliation_pass_count = input
        .reconciliations
        .iter()
        .filter(|result| result.status == RuntimeReconciliationStatus::Passed)
        .count() as u64;
    let reconciliation_manual_review_count = input
        .reconciliations
        .iter()
        .filter(|result| result.status == RuntimeReconciliationStatus::NeedsManualReview)
        .count() as u64;
    let reconciliation_failed_count = input
        .reconciliations
        .iter()
        .filter(|result| result.status == RuntimeReconciliationStatus::Failed)
        .count() as u64;
    let correction_applied_count = input
        .reconciliations
        .iter()
        .filter(|result| result.correction_applied)
        .count() as u64;
    let drift_alert_count =
        reconciliation_manual_review_count + reconciliation_failed_count + correction_applied_count;
    let completed_run_count = input
        .runs
        .iter()
        .filter(|run| run.state == RuntimeRunState::Completed)
        .count() as u64;
    let failed_run_count = input
        .runs
        .iter()
        .filter(|run| run.state == RuntimeRunState::Failed)
        .count() as u64;
    let manual_review_run_count = input
        .runs
        .iter()
        .filter(|run| run.state == RuntimeRunState::NeedsManualReview)
        .count() as u64;

    let allow_count = input
        .verdicts
        .iter()
        .filter(|verdict| verdict.verdict == RuntimeRiskDecision::Allow)
        .count() as u64;
    let reject_count = input
        .verdicts
        .iter()
        .filter(|verdict| verdict.verdict == RuntimeRiskDecision::Reject)
        .count() as u64;
    let pause_count = input
        .verdicts
        .iter()
        .filter(|verdict| verdict.verdict == RuntimeRiskDecision::Pause)
        .count() as u64;
    let concentration_reject_count = input
        .verdicts
        .iter()
        .filter(|verdict| {
            verdict
                .reasons
                .iter()
                .any(|reason| reason.code == "concentration_limit_exceeded")
        })
        .count() as u64;
    let kill_switch_pause_count = input
        .verdicts
        .iter()
        .filter(|verdict| {
            verdict
                .reasons
                .iter()
                .any(|reason| reason.code == "kill_switch_active")
        })
        .count() as u64;

    let latest_ledger = latest_ledger_snapshot(input);
    let (
        latest_equity_usd,
        latest_reserved_usd,
        latest_available_usd,
        realized_pnl_usd,
        unrealized_pnl_usd,
        total_pnl_usd,
    ) = if let Some(snapshot) = latest_ledger.as_ref() {
        let realized_pnl_cents =
            parse_usd_cents("totals.realizedPnlUsd", &snapshot.totals.realized_pnl_usd)?;
        let unrealized_pnl_cents = parse_usd_cents(
            "totals.unrealizedPnlUsd",
            &snapshot.totals.unrealized_pnl_usd,
        )?;
        (
            snapshot.totals.equity_usd.clone(),
            snapshot.totals.reserved_usd.clone(),
            snapshot.totals.available_usd.clone(),
            snapshot.totals.realized_pnl_usd.clone(),
            snapshot.totals.unrealized_pnl_usd.clone(),
            format_usd_cents(realized_pnl_cents + unrealized_pnl_cents),
        )
    } else {
        zero_pnl_totals()
    };
    let max_drawdown_usd = format_usd_cents(max_drawdown_cents(input)?);

    Ok(RuntimeScorecard {
        trigger_quality: RuntimeTriggerQualityScorecard {
            total_runs,
            fresh_trigger_count,
            stale_feature_reject_count,
            fresh_trigger_rate_bps: ratio_bps(fresh_trigger_count, total_runs),
        },
        plan_quality: RuntimePlanQualityScorecard {
            allowed_run_count,
            planned_run_count,
            plan_coverage_bps: ratio_bps(planned_run_count, allowed_run_count),
            dry_run_count,
            simulate_only_count,
            dry_run_plan_rate_bps: ratio_bps(dry_run_count, planned_run_count),
            simulate_only_plan_rate_bps: ratio_bps(simulate_only_count, planned_run_count),
        },
        expected_vs_observed: RuntimeExpectedObservedScorecard {
            submit_attempt_count: input.submit_attempt_count,
            receipt_count: input.receipt_count,
            reconciliation_count: input.reconciliations.len() as u64,
            reconciliation_pass_count,
            reconciliation_manual_review_count,
            reconciliation_failed_count,
            reconciliation_pass_rate_bps: ratio_bps(
                reconciliation_pass_count,
                input.reconciliations.len() as u64,
            ),
            correction_applied_count,
            drift_alert_count,
            completed_run_count,
            failed_run_count,
            manual_review_run_count,
        },
        pnl: RuntimePnlScorecard {
            latest_equity_usd,
            latest_reserved_usd,
            latest_available_usd,
            realized_pnl_usd,
            unrealized_pnl_usd,
            total_pnl_usd,
            max_drawdown_usd,
        },
        risk: RuntimeRiskScorecard {
            verdict_count: input.verdicts.len() as u64,
            allow_count,
            reject_count,
            pause_count,
            allow_rate_bps: ratio_bps(allow_count, input.verdicts.len() as u64),
            reject_rate_bps: ratio_bps(reject_count, input.verdicts.len() as u64),
            pause_rate_bps: ratio_bps(pause_count, input.verdicts.len() as u64),
            stale_feature_reject_count,
            concentration_reject_count,
            kill_switch_pause_count,
        },
    })
}

fn build_promotion_gates(
    config: &RuntimeScorecardConfig,
    input: &RuntimeScorecardInput,
    scorecard: &RuntimeScorecard,
) -> Result<Vec<RuntimePromotionGateDecision>, RuntimeScorecardError> {
    Ok(vec![
        shadow_to_paper_gate(config, input, scorecard),
        paper_to_live_gate(config, input, scorecard)?,
    ])
}

fn shadow_to_paper_gate(
    config: &RuntimeScorecardConfig,
    input: &RuntimeScorecardInput,
    scorecard: &RuntimeScorecard,
) -> RuntimePromotionGateDecision {
    if input.deployment.mode != RuntimeMode::Shadow {
        return not_applicable_gate(
            RuntimeMode::Shadow,
            RuntimeMode::Paper,
            "deployment-mode",
            input.deployment.mode.as_ref(),
            "shadow",
            "Shadow-to-paper promotion only applies to shadow deployments.",
        );
    }

    let checks = vec![
        exact_match_check(
            "shadow-state-active",
            input.deployment.state == RuntimeDeploymentState::Shadow,
            input.deployment.state.as_ref(),
            "shadow",
            "Deployment must be in active shadow state before promotion.",
        ),
        minimum_check(
            "shadow-min-runs",
            scorecard.trigger_quality.total_runs,
            config.shadow_min_runs,
            "Shadow mode needs enough completed evidence runs.",
        ),
        minimum_bps_check(
            "shadow-plan-coverage",
            scorecard.plan_quality.plan_coverage_bps,
            config.required_plan_coverage_bps,
            "All allow verdicts should produce an execution plan before paper promotion.",
        ),
        minimum_bps_check(
            "shadow-reconciliation-pass-rate",
            scorecard.expected_vs_observed.reconciliation_pass_rate_bps,
            config.required_reconciliation_pass_bps,
            "Shadow reconciliation must pass cleanly before paper promotion.",
        ),
        maximum_check(
            "shadow-max-failed-runs",
            scorecard.expected_vs_observed.failed_run_count,
            config.shadow_max_failed_runs,
            "Failed shadow runs block paper promotion.",
        ),
        maximum_check(
            "shadow-max-pause-verdicts",
            scorecard.risk.pause_count,
            config.shadow_max_pause_verdicts,
            "Pause verdicts must be zero before paper promotion.",
        ),
    ];

    gate_from_checks(
        RuntimeMode::Shadow,
        RuntimeMode::Paper,
        true,
        checks,
        "Shadow promotion gate evaluation complete.",
    )
}

fn paper_to_live_gate(
    config: &RuntimeScorecardConfig,
    input: &RuntimeScorecardInput,
    scorecard: &RuntimeScorecard,
) -> Result<RuntimePromotionGateDecision, RuntimeScorecardError> {
    if input.deployment.mode != RuntimeMode::Paper {
        return Ok(not_applicable_gate(
            RuntimeMode::Paper,
            RuntimeMode::Live,
            "deployment-mode",
            input.deployment.mode.as_ref(),
            "paper",
            "Paper-to-live promotion only applies to paper deployments.",
        ));
    }

    let daily_loss_limit_cents = parse_usd_cents(
        "policy.dailyLossLimitUsd",
        &input.deployment.policy.daily_loss_limit_usd,
    )?;
    let max_drawdown_cents = parse_usd_cents(
        "scorecard.pnl.maxDrawdownUsd",
        &scorecard.pnl.max_drawdown_usd,
    )?;
    let checks = vec![
        exact_match_check(
            "paper-state-active",
            input.deployment.state == RuntimeDeploymentState::Paper,
            input.deployment.state.as_ref(),
            "paper",
            "Deployment must be in active paper state before live promotion.",
        ),
        minimum_check(
            "paper-min-runs",
            scorecard.trigger_quality.total_runs,
            config.paper_min_runs,
            "Paper mode needs enough evidence runs before live promotion.",
        ),
        minimum_bps_check(
            "paper-plan-coverage",
            scorecard.plan_quality.plan_coverage_bps,
            config.required_plan_coverage_bps,
            "Paper promotion requires full plan coverage for allow verdicts.",
        ),
        exact_bps_check(
            "paper-dry-run-rate",
            scorecard.plan_quality.dry_run_plan_rate_bps,
            10_000,
            "Paper runs must remain dry-run only.",
        ),
        minimum_bps_check(
            "paper-reconciliation-pass-rate",
            scorecard.expected_vs_observed.reconciliation_pass_rate_bps,
            config.required_reconciliation_pass_bps,
            "Paper reconciliation must pass before any live promotion.",
        ),
        maximum_check(
            "paper-max-corrections",
            scorecard.expected_vs_observed.correction_applied_count,
            config.paper_max_correction_count,
            "Auto-corrections must be zero before live promotion.",
        ),
        maximum_check(
            "paper-max-failed-runs",
            scorecard.expected_vs_observed.failed_run_count,
            config.paper_max_failed_runs,
            "Failed paper runs block live promotion.",
        ),
        maximum_check(
            "paper-max-pause-verdicts",
            scorecard.risk.pause_count,
            config.paper_max_pause_verdicts,
            "Pause verdicts must be zero before live promotion.",
        ),
        maximum_usd_check(
            "paper-max-drawdown",
            max_drawdown_cents,
            daily_loss_limit_cents,
            "Observed drawdown must stay within the deployment daily loss limit.",
        ),
    ];

    Ok(gate_from_checks(
        RuntimeMode::Paper,
        RuntimeMode::Live,
        true,
        checks,
        "Paper promotion gate evaluation complete.",
    ))
}

fn not_applicable_gate(
    source_mode: RuntimeMode,
    target_mode: RuntimeMode,
    gate_id: &str,
    observed_value: &str,
    threshold_value: &str,
    message: &str,
) -> RuntimePromotionGateDecision {
    RuntimePromotionGateDecision {
        source_mode,
        target_mode,
        eligible: false,
        status: RuntimePromotionGateStatus::NotApplicable,
        summary: message.to_string(),
        checks: vec![RuntimePromotionGateCheck {
            gate_id: gate_id.to_string(),
            status: RuntimePromotionGateStatus::NotApplicable,
            observed_value: observed_value.to_string(),
            threshold_value: threshold_value.to_string(),
            message: message.to_string(),
        }],
    }
}

fn gate_from_checks(
    source_mode: RuntimeMode,
    target_mode: RuntimeMode,
    eligible: bool,
    checks: Vec<RuntimePromotionGateCheck>,
    success_summary: &str,
) -> RuntimePromotionGateDecision {
    let status = if checks
        .iter()
        .all(|check| check.status == RuntimePromotionGateStatus::Pass)
    {
        RuntimePromotionGateStatus::Pass
    } else {
        RuntimePromotionGateStatus::Blocked
    };
    let summary = if status == RuntimePromotionGateStatus::Pass {
        success_summary.to_string()
    } else {
        let failed = checks
            .iter()
            .filter(|check| check.status == RuntimePromotionGateStatus::Blocked)
            .map(|check| check.gate_id.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        format!("Promotion blocked by: {failed}")
    };
    RuntimePromotionGateDecision {
        source_mode,
        target_mode,
        eligible,
        status,
        checks,
        summary,
    }
}

fn minimum_check(
    gate_id: &str,
    observed: u64,
    threshold: u64,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if observed >= threshold {
            RuntimePromotionGateStatus::Pass
        } else {
            RuntimePromotionGateStatus::Blocked
        },
        observed_value: observed.to_string(),
        threshold_value: threshold.to_string(),
        message: message.to_string(),
    }
}

fn maximum_check(
    gate_id: &str,
    observed: u64,
    threshold: u64,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if observed <= threshold {
            RuntimePromotionGateStatus::Pass
        } else {
            RuntimePromotionGateStatus::Blocked
        },
        observed_value: observed.to_string(),
        threshold_value: threshold.to_string(),
        message: message.to_string(),
    }
}

fn minimum_bps_check(
    gate_id: &str,
    observed: u16,
    threshold: u16,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if observed >= threshold {
            RuntimePromotionGateStatus::Pass
        } else {
            RuntimePromotionGateStatus::Blocked
        },
        observed_value: format!("{observed}bps"),
        threshold_value: format!("{threshold}bps"),
        message: message.to_string(),
    }
}

fn exact_bps_check(
    gate_id: &str,
    observed: u16,
    threshold: u16,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if observed == threshold {
            RuntimePromotionGateStatus::Pass
        } else {
            RuntimePromotionGateStatus::Blocked
        },
        observed_value: format!("{observed}bps"),
        threshold_value: format!("{threshold}bps"),
        message: message.to_string(),
    }
}

fn exact_match_check(
    gate_id: &str,
    passes: bool,
    observed: &str,
    expected: &str,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if passes {
            RuntimePromotionGateStatus::Pass
        } else {
            RuntimePromotionGateStatus::Blocked
        },
        observed_value: observed.to_string(),
        threshold_value: expected.to_string(),
        message: message.to_string(),
    }
}

fn maximum_usd_check(
    gate_id: &str,
    observed_cents: i64,
    threshold_cents: i64,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if observed_cents <= threshold_cents {
            RuntimePromotionGateStatus::Pass
        } else {
            RuntimePromotionGateStatus::Blocked
        },
        observed_value: format_usd_cents(observed_cents),
        threshold_value: format_usd_cents(threshold_cents),
        message: message.to_string(),
    }
}

fn build_proof_artifact_markdown(
    input: &RuntimeScorecardInput,
    scorecard: &RuntimeScorecard,
    promotion_gates: &[RuntimePromotionGateDecision],
) -> String {
    let mut markdown = String::new();
    markdown.push_str("## Runtime Promotion Readiness\n\n");
    markdown.push_str(&format!(
        "- Deployment: `{}`\n- Mode/state: `{}` / `{}`\n- Generated at: `{}`\n",
        input.deployment.deployment_id,
        input.deployment.mode.as_ref(),
        input.deployment.state.as_ref(),
        now_rfc3339(),
    ));
    markdown.push_str("\n### Scorecard\n");
    markdown.push_str(&format!(
        "- Runs: {} total, {} fresh triggers, {} stale-trigger rejects\n",
        scorecard.trigger_quality.total_runs,
        scorecard.trigger_quality.fresh_trigger_count,
        scorecard.trigger_quality.stale_feature_reject_count,
    ));
    markdown.push_str(&format!(
        "- Plans: {} / {} allow verdicts ({})\n",
        scorecard.plan_quality.planned_run_count,
        scorecard.plan_quality.allowed_run_count,
        format_bps(scorecard.plan_quality.plan_coverage_bps),
    ));
    markdown.push_str(&format!(
        "- Reconciliation: {} pass, {} manual review, {} failed, {} corrections\n",
        scorecard.expected_vs_observed.reconciliation_pass_count,
        scorecard
            .expected_vs_observed
            .reconciliation_manual_review_count,
        scorecard.expected_vs_observed.reconciliation_failed_count,
        scorecard.expected_vs_observed.correction_applied_count,
    ));
    markdown.push_str(&format!(
        "- Risk verdicts: {} allow, {} reject, {} pause\n",
        scorecard.risk.allow_count, scorecard.risk.reject_count, scorecard.risk.pause_count,
    ));
    markdown.push_str(&format!(
        "- Latest PnL: total {}, realized {}, unrealized {}, max drawdown {}\n",
        scorecard.pnl.total_pnl_usd,
        scorecard.pnl.realized_pnl_usd,
        scorecard.pnl.unrealized_pnl_usd,
        scorecard.pnl.max_drawdown_usd,
    ));
    markdown.push_str("\n### Promotion Gates\n");
    for gate in promotion_gates {
        markdown.push_str(&format!(
            "- `{}` -> `{}`: `{}` ({})\n",
            gate.source_mode.as_ref(),
            gate.target_mode.as_ref(),
            gate.status.as_ref(),
            gate.summary,
        ));
    }
    markdown
}

fn latest_ledger_snapshot(input: &RuntimeScorecardInput) -> Option<RuntimeLedgerSnapshot> {
    if let Some(snapshot) = input.latest_ledger_snapshot.clone() {
        return Some(snapshot);
    }
    input
        .observed_ledger_snapshots
        .iter()
        .cloned()
        .max_by(|left, right| left.as_of.cmp(&right.as_of))
}

fn max_drawdown_cents(input: &RuntimeScorecardInput) -> Result<i64, RuntimeScorecardError> {
    let mut snapshots = input.observed_ledger_snapshots.clone();
    if let Some(latest) = input.latest_ledger_snapshot.as_ref() {
        snapshots.push(latest.clone());
    }
    snapshots.sort_by(|left, right| left.as_of.cmp(&right.as_of));

    let mut peak = None::<i64>;
    let mut max_drawdown = 0_i64;
    for snapshot in snapshots {
        let equity = parse_usd_cents("totals.equityUsd", &snapshot.totals.equity_usd)?;
        peak = Some(match peak {
            Some(current_peak) => current_peak.max(equity),
            None => equity,
        });
        if let Some(current_peak) = peak {
            max_drawdown = max_drawdown.max(current_peak - equity);
        }
    }
    Ok(max_drawdown)
}

fn zero_pnl_totals() -> (String, String, String, String, String, String) {
    (
        "0.00".to_string(),
        "0.00".to_string(),
        "0.00".to_string(),
        "0.00".to_string(),
        "0.00".to_string(),
        "0.00".to_string(),
    )
}

fn verdict_by_run_id(verdicts: &[RuntimeRiskVerdict]) -> HashMap<&str, &RuntimeRiskVerdict> {
    let mut map = HashMap::new();
    for verdict in verdicts {
        map.insert(verdict.run_id.as_str(), verdict);
    }
    map
}

fn ratio_bps(numerator: u64, denominator: u64) -> u16 {
    if denominator == 0 {
        return 0;
    }
    ((numerator.saturating_mul(10_000)) / denominator) as u16
}

fn parse_usd_cents(field: &'static str, value: &str) -> Result<i64, RuntimeScorecardError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(RuntimeScorecardError::InvalidUsdAmount {
            field,
            value: value.to_string(),
        });
    }
    let (negative, raw) = if let Some(stripped) = trimmed.strip_prefix('-') {
        (true, stripped)
    } else {
        (false, trimmed)
    };
    let (whole, frac) = raw.split_once('.').unwrap_or((raw, "0"));
    if frac.len() > 2
        || !whole.chars().all(|c| c.is_ascii_digit())
        || !frac.chars().all(|c| c.is_ascii_digit())
    {
        return Err(RuntimeScorecardError::InvalidUsdAmount {
            field,
            value: value.to_string(),
        });
    }
    let whole: i64 = whole
        .parse()
        .map_err(|_| RuntimeScorecardError::InvalidUsdAmount {
            field,
            value: value.to_string(),
        })?;
    let frac_value: i64 = match frac.len() {
        0 => Ok(0),
        1 => frac.parse::<i64>().map(|value| value * 10),
        _ => frac.parse::<i64>(),
    }
    .map_err(|_| RuntimeScorecardError::InvalidUsdAmount {
        field,
        value: value.to_string(),
    })?;
    let cents = whole
        .checked_mul(100)
        .and_then(|value| value.checked_add(frac_value))
        .ok_or_else(|| RuntimeScorecardError::InvalidUsdAmount {
            field,
            value: value.to_string(),
        })?;
    Ok(if negative { -cents } else { cents })
}

fn format_usd_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let absolute = cents.unsigned_abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

fn format_bps(value: u16) -> String {
    format!("{value}bps")
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("current time to format")
}

trait RuntimeModeKey {
    fn as_ref(&self) -> &'static str;
}

impl RuntimeModeKey for RuntimeMode {
    fn as_ref(&self) -> &'static str {
        match self {
            RuntimeMode::Shadow => "shadow",
            RuntimeMode::Paper => "paper",
            RuntimeMode::Live => "live",
        }
    }
}

trait RuntimeStateKey {
    fn as_ref(&self) -> &'static str;
}

impl RuntimeStateKey for RuntimeDeploymentState {
    fn as_ref(&self) -> &'static str {
        match self {
            RuntimeDeploymentState::Draft => "draft",
            RuntimeDeploymentState::Shadow => "shadow",
            RuntimeDeploymentState::Paper => "paper",
            RuntimeDeploymentState::Live => "live",
            RuntimeDeploymentState::Paused => "paused",
            RuntimeDeploymentState::Killed => "killed",
            RuntimeDeploymentState::Archived => "archived",
        }
    }
}

trait PromotionGateStatusKey {
    fn as_ref(&self) -> &'static str;
}

impl PromotionGateStatusKey for RuntimePromotionGateStatus {
    fn as_ref(&self) -> &'static str {
        match self {
            RuntimePromotionGateStatus::Pass => "pass",
            RuntimePromotionGateStatus::Blocked => "blocked",
            RuntimePromotionGateStatus::NotApplicable => "not_applicable",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{
        RuntimeCapital, RuntimeDeploymentState, RuntimeExecutionAction, RuntimeExecutionSlice,
        RuntimeLane, RuntimeLedgerBalance, RuntimeLedgerTotals, RuntimePair, RuntimePolicy,
        RuntimePositionSide, RuntimeReconciliationStatus, RuntimeRiskLimits, RuntimeRiskObserved,
        RuntimeRiskReason, RuntimeRiskSeverity, RuntimeTrigger, RuntimeTriggerKind,
    };

    #[test]
    fn builds_shadow_scorecard_and_promotion_gate() {
        let deployment = deployment(
            "deployment_shadow",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Shadow,
        );
        let runs = vec![
            run(
                "run_shadow_1",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
            run(
                "run_shadow_2",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
            run(
                "run_shadow_3",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
        ];
        let verdicts = runs
            .iter()
            .map(|run| allow_verdict(&deployment, run))
            .collect::<Vec<_>>();
        let plans = runs
            .iter()
            .map(|run| plan(&deployment, run, true, true))
            .collect::<Vec<_>>();
        let reconciliations = runs
            .iter()
            .map(|run| reconciliation(&deployment, run, RuntimeReconciliationStatus::Passed, false))
            .collect::<Vec<_>>();
        let snapshots = vec![
            ledger_snapshot(
                &deployment,
                "1000.00",
                "0.00",
                "1000.00",
                "1.00",
                "0.00",
                "2026-03-08T10:00:00Z",
            ),
            ledger_snapshot(
                &deployment,
                "1010.00",
                "0.00",
                "1010.00",
                "2.00",
                "0.50",
                "2026-03-08T10:05:00Z",
            ),
        ];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                runs,
                verdicts,
                plans,
                submit_attempt_count: 3,
                receipt_count: 3,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(report.scorecard.trigger_quality.total_runs, 3);
        assert_eq!(report.scorecard.plan_quality.plan_coverage_bps, 10_000);
        assert_eq!(
            report.promotion_gates[0].status,
            RuntimePromotionGateStatus::Pass
        );
        assert_eq!(
            report.promotion_gates[1].status,
            RuntimePromotionGateStatus::NotApplicable
        );
        assert!(report.proof_artifact_markdown.contains("Shadow"));
    }

    #[test]
    fn builds_paper_scorecard_and_live_gate() {
        let deployment = deployment(
            "deployment_paper",
            RuntimeMode::Paper,
            RuntimeDeploymentState::Paper,
        );
        let runs = (1..=5)
            .map(|index| {
                run(
                    &format!("run_paper_{index}"),
                    RuntimeRunState::Completed,
                    trigger("operator"),
                )
            })
            .collect::<Vec<_>>();
        let verdicts = runs
            .iter()
            .map(|run| allow_verdict(&deployment, run))
            .collect::<Vec<_>>();
        let plans = runs
            .iter()
            .map(|run| plan(&deployment, run, true, false))
            .collect::<Vec<_>>();
        let reconciliations = runs
            .iter()
            .map(|run| reconciliation(&deployment, run, RuntimeReconciliationStatus::Passed, false))
            .collect::<Vec<_>>();
        let snapshots = vec![
            ledger_snapshot(
                &deployment,
                "1000.00",
                "5.00",
                "995.00",
                "1.00",
                "0.00",
                "2026-03-08T10:00:00Z",
            ),
            ledger_snapshot(
                &deployment,
                "996.00",
                "5.00",
                "991.00",
                "1.50",
                "-1.00",
                "2026-03-08T10:05:00Z",
            ),
            ledger_snapshot(
                &deployment,
                "998.00",
                "5.00",
                "993.00",
                "2.00",
                "-0.50",
                "2026-03-08T10:10:00Z",
            ),
        ];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment,
                runs,
                verdicts,
                plans,
                submit_attempt_count: 5,
                receipt_count: 5,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(report.scorecard.pnl.max_drawdown_usd, "4.00");
        assert_eq!(
            report.promotion_gates[1].status,
            RuntimePromotionGateStatus::Pass
        );
    }

    #[test]
    fn blocks_paper_live_gate_on_corrections_and_drawdown() {
        let deployment = deployment(
            "deployment_blocked",
            RuntimeMode::Paper,
            RuntimeDeploymentState::Paper,
        );
        let runs = (1..=5)
            .map(|index| {
                run(
                    &format!("run_blocked_{index}"),
                    if index == 5 {
                        RuntimeRunState::Failed
                    } else {
                        RuntimeRunState::Completed
                    },
                    trigger("signal"),
                )
            })
            .collect::<Vec<_>>();
        let mut verdicts = runs
            .iter()
            .map(|run| allow_verdict(&deployment, run))
            .collect::<Vec<_>>();
        verdicts.push(pause_verdict(&deployment, &runs[0]));
        let plans = runs
            .iter()
            .map(|run| plan(&deployment, run, true, false))
            .collect::<Vec<_>>();
        let reconciliations = runs
            .iter()
            .enumerate()
            .map(|(index, run)| {
                reconciliation(
                    &deployment,
                    run,
                    if index == 4 {
                        RuntimeReconciliationStatus::Failed
                    } else {
                        RuntimeReconciliationStatus::Passed
                    },
                    index == 0,
                )
            })
            .collect::<Vec<_>>();
        let snapshots = vec![
            ledger_snapshot(
                &deployment,
                "1000.00",
                "5.00",
                "995.00",
                "0.00",
                "0.00",
                "2026-03-08T10:00:00Z",
            ),
            ledger_snapshot(
                &deployment,
                "960.00",
                "5.00",
                "955.00",
                "-20.00",
                "-20.00",
                "2026-03-08T10:05:00Z",
            ),
        ];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment,
                runs,
                verdicts,
                plans,
                submit_attempt_count: 5,
                receipt_count: 5,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(
            report.promotion_gates[1].status,
            RuntimePromotionGateStatus::Blocked
        );
        assert!(report.promotion_gates[1]
            .checks
            .iter()
            .any(|check| check.gate_id == "paper-max-corrections"
                && check.status == RuntimePromotionGateStatus::Blocked));
        assert!(report.promotion_gates[1]
            .checks
            .iter()
            .any(|check| check.gate_id == "paper-max-drawdown"
                && check.status == RuntimePromotionGateStatus::Blocked));
    }

    fn deployment(
        deployment_id: &str,
        mode: RuntimeMode,
        state: RuntimeDeploymentState,
    ) -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: deployment_id.to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            pair: RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            },
            mode,
            state,
            lane: RuntimeLane::Safe,
            created_at: "2026-03-08T10:00:00Z".to_string(),
            updated_at: "2026-03-08T10:00:00Z".to_string(),
            promoted_at: None,
            paused_at: None,
            killed_at: None,
            policy: RuntimePolicy {
                max_notional_usd: "25.00".to_string(),
                daily_loss_limit_usd: "10.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: RuntimeCapital {
                allocated_usd: "1000.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "995.00".to_string(),
            },
            tags: vec!["runtime:test".to_string()],
        }
    }

    fn run(run_id: &str, state: RuntimeRunState, trigger: RuntimeTrigger) -> RuntimeRunRecord {
        RuntimeRunRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            run_id: run_id.to_string(),
            deployment_id: "unused".to_string(),
            run_key: format!("key_{run_id}"),
            trigger,
            state,
            planned_at: "2026-03-08T10:00:00Z".to_string(),
            updated_at: "2026-03-08T10:00:00Z".to_string(),
            risk_verdict_id: Some(format!("verdict_{run_id}")),
            execution_plan_id: Some(format!("plan_{run_id}")),
            submit_request_id: Some(format!("submit_{run_id}")),
            receipt_id: Some(format!("receipt_{run_id}")),
            failure_code: None,
            failure_message: None,
        }
    }

    fn trigger(source: &str) -> RuntimeTrigger {
        RuntimeTrigger {
            kind: RuntimeTriggerKind::Signal,
            source: source.to_string(),
            observed_at: "2026-03-08T10:00:00Z".to_string(),
            feature_snapshot_id: Some("feature_1".to_string()),
            reason: Some("test".to_string()),
        }
    }

    fn allow_verdict(
        deployment: &RuntimeDeploymentRecord,
        run: &RuntimeRunRecord,
    ) -> RuntimeRiskVerdict {
        RuntimeRiskVerdict {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            verdict_id: format!("verdict_{}", run.run_id),
            deployment_id: deployment.deployment_id.clone(),
            run_id: run.run_id.clone(),
            decided_at: "2026-03-08T10:00:00Z".to_string(),
            verdict: RuntimeRiskDecision::Allow,
            reasons: vec![RuntimeRiskReason {
                code: "within_limits".to_string(),
                message: "Within limits".to_string(),
                severity: RuntimeRiskSeverity::Info,
            }],
            observed: RuntimeRiskObserved {
                requested_notional_usd: "5.00".to_string(),
                reserved_usd: "5.00".to_string(),
                concentration_bps: 500,
                feature_age_ms: 500,
            },
            limits: RuntimeRiskLimits {
                max_notional_usd: "25.00".to_string(),
                max_reserved_usd: "25.00".to_string(),
                max_concentration_bps: 3500,
                stale_after_ms: 20_000,
            },
        }
    }

    fn pause_verdict(
        deployment: &RuntimeDeploymentRecord,
        run: &RuntimeRunRecord,
    ) -> RuntimeRiskVerdict {
        RuntimeRiskVerdict {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            verdict_id: format!("pause_{}", run.run_id),
            deployment_id: deployment.deployment_id.clone(),
            run_id: run.run_id.clone(),
            decided_at: "2026-03-08T10:01:00Z".to_string(),
            verdict: RuntimeRiskDecision::Pause,
            reasons: vec![RuntimeRiskReason {
                code: "kill_switch_active".to_string(),
                message: "Kill switch active".to_string(),
                severity: RuntimeRiskSeverity::Error,
            }],
            observed: RuntimeRiskObserved {
                requested_notional_usd: "5.00".to_string(),
                reserved_usd: "5.00".to_string(),
                concentration_bps: 500,
                feature_age_ms: 500,
            },
            limits: RuntimeRiskLimits {
                max_notional_usd: "25.00".to_string(),
                max_reserved_usd: "25.00".to_string(),
                max_concentration_bps: 3500,
                stale_after_ms: 20_000,
            },
        }
    }

    fn plan(
        deployment: &RuntimeDeploymentRecord,
        run: &RuntimeRunRecord,
        dry_run: bool,
        simulate_only: bool,
    ) -> RuntimeExecutionPlan {
        RuntimeExecutionPlan {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            plan_id: format!("plan_{}", run.run_id),
            deployment_id: deployment.deployment_id.clone(),
            owner_user_id: Some(deployment.owner_user_id.clone()),
            sleeve_id: Some(deployment.sleeve_id.clone()),
            run_id: run.run_id.clone(),
            created_at: "2026-03-08T10:00:00Z".to_string(),
            mode: deployment.mode.clone(),
            lane: RuntimeLane::Safe,
            idempotency_key: format!("{}:{}", deployment.deployment_id, run.run_id),
            simulate_only,
            dry_run,
            slices: vec![RuntimeExecutionSlice {
                slice_id: "slice_1".to_string(),
                action: RuntimeExecutionAction::Buy,
                input_mint: deployment.pair.quote_mint.clone(),
                output_mint: deployment.pair.base_mint.clone(),
                input_amount_atomic: "5000000".to_string(),
                min_output_amount_atomic: Some("30000000".to_string()),
                notional_usd: "5.00".to_string(),
                slippage_bps: 50,
            }],
        }
    }

    fn reconciliation(
        deployment: &RuntimeDeploymentRecord,
        run: &RuntimeRunRecord,
        status: RuntimeReconciliationStatus,
        correction_applied: bool,
    ) -> RuntimeReconciliationResult {
        RuntimeReconciliationResult {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            reconciliation_id: format!("recon_{}", run.run_id),
            deployment_id: deployment.deployment_id.clone(),
            run_id: run.run_id.clone(),
            receipt_id: format!("receipt_{}", run.run_id),
            completed_at: "2026-03-08T10:00:00Z".to_string(),
            status,
            wallet_deltas: vec![],
            position_delta_usd: "0.00".to_string(),
            notes: vec![],
            correction_applied,
        }
    }

    fn ledger_snapshot(
        deployment: &RuntimeDeploymentRecord,
        equity_usd: &str,
        reserved_usd: &str,
        available_usd: &str,
        realized_pnl_usd: &str,
        unrealized_pnl_usd: &str,
        as_of: &str,
    ) -> RuntimeLedgerSnapshot {
        RuntimeLedgerSnapshot {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            snapshot_id: format!("ledger_{}_{}", deployment.deployment_id, as_of),
            deployment_id: deployment.deployment_id.clone(),
            sleeve_id: deployment.sleeve_id.clone(),
            as_of: as_of.to_string(),
            balances: vec![RuntimeLedgerBalance {
                mint: deployment.pair.quote_mint.clone(),
                symbol: "USDC".to_string(),
                decimals: 6,
                free_atomic: "995000000".to_string(),
                reserved_atomic: "5000000".to_string(),
                price_usd: Some("1.00".to_string()),
            }],
            positions: vec![protocol::RuntimeLedgerPosition {
                instrument_id: deployment.pair.symbol.clone(),
                side: RuntimePositionSide::Long,
                quantity_atomic: "1000000000".to_string(),
                entry_price_usd: Some("140.00".to_string()),
                mark_price_usd: Some("142.00".to_string()),
                unrealized_pnl_usd: Some(unrealized_pnl_usd.to_string()),
            }],
            totals: RuntimeLedgerTotals {
                equity_usd: equity_usd.to_string(),
                reserved_usd: reserved_usd.to_string(),
                available_usd: available_usd.to_string(),
                realized_pnl_usd: realized_pnl_usd.to_string(),
                unrealized_pnl_usd: unrealized_pnl_usd.to_string(),
            },
        }
    }
}
