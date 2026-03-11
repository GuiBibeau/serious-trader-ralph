use std::collections::{BTreeSet, HashMap};

use protocol::{
    RuntimeAllocatorDecisionRecord, RuntimeAllocatorScorecard, RuntimeCostScorecard,
    RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeExecutionCostModelRecord,
    RuntimeExecutionCostModelStatus, RuntimeExecutionCostObservationRecord, RuntimeExecutionPlan,
    RuntimeExpectedObservedScorecard, RuntimeFeatureCatalogScorecard,
    RuntimeFeatureDefinitionRecord, RuntimeLedgerSnapshot, RuntimeMode,
    RuntimePlanQualityScorecard, RuntimePnlScorecard, RuntimePromotionGateCheck,
    RuntimePromotionGateDecision, RuntimePromotionGateStatus, RuntimePromotionReadinessReport,
    RuntimeReconciliationResult, RuntimeReconciliationStatus, RuntimeRegimeTagRecord,
    RuntimeRiskDecision, RuntimeRiskScorecard, RuntimeRiskVerdict, RuntimeRunRecord,
    RuntimeRunState, RuntimeScorecard, RuntimeStrategySpec, RuntimeTriggerQualityScorecard,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScorecardConfig {
    pub shadow_min_runs: u64,
    pub paper_min_runs: u64,
    pub advanced_shadow_min_runs: u64,
    pub advanced_paper_min_runs: u64,
    pub required_plan_coverage_bps: u16,
    pub required_reconciliation_pass_bps: u16,
    pub shadow_max_failed_runs: u64,
    pub paper_max_failed_runs: u64,
    pub shadow_max_pause_verdicts: u64,
    pub paper_max_pause_verdicts: u64,
    pub paper_max_correction_count: u64,
    pub signal_max_stale_feature_rejects: u64,
    pub required_cost_model_coverage_bps: u16,
    pub required_cost_observation_coverage_bps: u16,
    pub required_feature_definition_coverage_bps: u16,
    pub required_regime_tag_coverage_bps: u16,
    pub shadow_max_cost_drift_bps: u16,
    pub paper_max_cost_drift_bps: u16,
    pub shadow_max_latency_drift_ms: u64,
    pub paper_max_latency_drift_ms: u64,
}

impl Default for RuntimeScorecardConfig {
    fn default() -> Self {
        Self {
            shadow_min_runs: 3,
            paper_min_runs: 5,
            advanced_shadow_min_runs: 5,
            advanced_paper_min_runs: 7,
            required_plan_coverage_bps: 10_000,
            required_reconciliation_pass_bps: 10_000,
            shadow_max_failed_runs: 0,
            paper_max_failed_runs: 0,
            shadow_max_pause_verdicts: 0,
            paper_max_pause_verdicts: 0,
            paper_max_correction_count: 0,
            signal_max_stale_feature_rejects: 0,
            required_cost_model_coverage_bps: 10_000,
            required_cost_observation_coverage_bps: 10_000,
            required_feature_definition_coverage_bps: 10_000,
            required_regime_tag_coverage_bps: 10_000,
            shadow_max_cost_drift_bps: 100,
            paper_max_cost_drift_bps: 75,
            shadow_max_latency_drift_ms: 15_000,
            paper_max_latency_drift_ms: 10_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeScorecardInput {
    pub deployment: RuntimeDeploymentRecord,
    pub strategy_spec: RuntimeStrategySpec,
    pub runs: Vec<RuntimeRunRecord>,
    pub verdicts: Vec<RuntimeRiskVerdict>,
    pub plans: Vec<RuntimeExecutionPlan>,
    pub cost_model: Option<RuntimeExecutionCostModelRecord>,
    pub cost_observations: Vec<RuntimeExecutionCostObservationRecord>,
    pub feature_definitions: Vec<RuntimeFeatureDefinitionRecord>,
    pub regime_tags: Vec<RuntimeRegimeTagRecord>,
    pub allocator_decisions: Vec<RuntimeAllocatorDecisionRecord>,
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
    #[error("invalid timestamp for {field}: {value}")]
    InvalidTimestamp { field: &'static str, value: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeCostObservationInput {
    pub deployment: RuntimeDeploymentRecord,
    pub run: RuntimeRunRecord,
    pub plan: RuntimeExecutionPlan,
    pub cost_model: RuntimeExecutionCostModelRecord,
    pub receipt_observed_at: String,
    pub reconciliation: RuntimeReconciliationResult,
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

pub fn build_cost_observation(
    input: &RuntimeCostObservationInput,
) -> Result<RuntimeExecutionCostObservationRecord, RuntimeScorecardError> {
    let modeled_total_cost_cents = modeled_plan_cost_cents(&input.plan, &input.cost_model)?;
    let reconciliation_drift_cents = parse_usd_cents(
        "reconciliation.positionDeltaUsd",
        &input.reconciliation.position_delta_usd,
    )?
    .abs();
    let observed_total_cost_cents = modeled_total_cost_cents + reconciliation_drift_cents;
    let evaluated_notional_cents = plan_notional_cents(std::slice::from_ref(&input.plan))?;
    let expected_end_to_end_latency_ms = input.cost_model.latency_profile.expected_submit_ms
        + input.cost_model.latency_profile.expected_settlement_ms;
    let planned_at = parse_timestamp("run.plannedAt", &input.run.planned_at)?;
    let receipt_observed_at = parse_timestamp("receipt.observedAt", &input.receipt_observed_at)?;
    let observed_end_to_end_latency_ms = timestamp_diff_ms(planned_at, receipt_observed_at);

    Ok(RuntimeExecutionCostObservationRecord {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        observation_id: format!("costobs_{}", input.run.run_id),
        model_id: input.cost_model.model_id.clone(),
        deployment_id: input.deployment.deployment_id.clone(),
        run_id: input.run.run_id.clone(),
        receipt_id: input.reconciliation.receipt_id.clone(),
        venue_key: input.deployment.venue_key.clone(),
        market_type: input.deployment.pair.market_type.clone(),
        pair_symbol: input.deployment.pair.symbol.clone(),
        asset_keys: input.cost_model.asset_keys.clone(),
        mode: input.deployment.mode.clone(),
        observed_at: input.receipt_observed_at.clone(),
        evaluated_notional_usd: format_usd_cents(evaluated_notional_cents),
        modeled_total_cost_usd: format_usd_cents(modeled_total_cost_cents),
        observed_total_cost_usd: format_usd_cents(observed_total_cost_cents),
        cost_drift_usd: format_usd_cents(reconciliation_drift_cents),
        cost_drift_bps: ratio_bps_from_cents(reconciliation_drift_cents, evaluated_notional_cents),
        expected_end_to_end_latency_ms,
        observed_end_to_end_latency_ms,
        latency_drift_ms: expected_end_to_end_latency_ms.abs_diff(observed_end_to_end_latency_ms),
        reconciliation_status: input.reconciliation.status.clone(),
        reconciliation_drift_usd: format_usd_cents(reconciliation_drift_cents),
        tags: vec![
            "cost-observation".to_string(),
            input.deployment.mode.as_ref().to_string(),
        ],
        notes: Some(
            "Derived from runtime plan, receipt, and reconciliation artifacts.".to_string(),
        ),
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
    let allocator_decision_count = input.allocator_decisions.len() as u64;
    let allocator_full_grant_count = input
        .allocator_decisions
        .iter()
        .filter(|decision| !decision.constrained)
        .count() as u64;
    let allocator_constrained_count = input
        .allocator_decisions
        .iter()
        .filter(|decision| decision.constrained)
        .count() as u64;
    let allocator_zero_grant_count = input
        .allocator_decisions
        .iter()
        .filter(|decision| decision.granted_reserved_usd == "0.00")
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
    let cost = build_cost_scorecard(input)?;
    let feature_catalog = build_feature_catalog_scorecard(input);

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
        cost,
        feature_catalog,
        allocator: RuntimeAllocatorScorecard {
            decision_count: allocator_decision_count,
            full_grant_count: allocator_full_grant_count,
            constrained_count: allocator_constrained_count,
            zero_grant_count: allocator_zero_grant_count,
            full_grant_rate_bps: ratio_bps(allocator_full_grant_count, allocator_decision_count),
        },
    })
}

fn build_cost_scorecard(
    input: &RuntimeScorecardInput,
) -> Result<RuntimeCostScorecard, RuntimeScorecardError> {
    let evaluated_notional_cents = plan_notional_cents(&input.plans)?;
    let reconciliation_drift_cents =
        input
            .reconciliations
            .iter()
            .try_fold(0_i64, |total, reconciliation| {
                Ok(total
                    + parse_usd_cents(
                        "reconciliation.positionDeltaUsd",
                        &reconciliation.position_delta_usd,
                    )?
                    .abs())
            })?;
    let reconciliation_drift_count = input
        .reconciliations
        .iter()
        .filter(|result| {
            result.status != RuntimeReconciliationStatus::Passed || result.correction_applied
        })
        .count() as u64;
    let observed_end_to_end_latency_ms = average_observed_end_to_end_latency_ms(input)?;

    let Some(model) = input.cost_model.as_ref() else {
        return Ok(RuntimeCostScorecard {
            model_id: None,
            model_status: None,
            calibration_id: None,
            calibration_confidence_bps: None,
            covered_run_count: 0,
            model_coverage_bps: 0,
            observation_count: 0,
            observation_coverage_bps: 0,
            evaluated_notional_usd: format_usd_cents(evaluated_notional_cents),
            modeled_total_cost_usd: "0.00".to_string(),
            observed_total_cost_usd: format_usd_cents(reconciliation_drift_cents),
            cost_drift_usd: format_usd_cents(reconciliation_drift_cents),
            cost_drift_bps: ratio_bps_from_cents(
                reconciliation_drift_cents,
                evaluated_notional_cents,
            ),
            expected_end_to_end_latency_ms: 0,
            observed_end_to_end_latency_ms,
            latency_drift_ms: observed_end_to_end_latency_ms,
            reconciliation_drift_count,
        });
    };

    let active = model.status == RuntimeExecutionCostModelStatus::Active;
    let covered_run_count = if active { input.plans.len() as u64 } else { 0 };
    let observation_count = input.cost_observations.len() as u64;
    let (
        modeled_total_cost_cents,
        observed_total_cost_cents,
        latency_expected_ms,
        latency_observed_ms,
    ) = if !input.cost_observations.is_empty() {
        let modeled_total_cost_cents =
            input
                .cost_observations
                .iter()
                .try_fold(0_i64, |total, observation| {
                    Ok(total
                        + parse_usd_cents(
                            "costObservation.modeledTotalCostUsd",
                            &observation.modeled_total_cost_usd,
                        )?)
                })?;
        let observed_total_cost_cents =
            input
                .cost_observations
                .iter()
                .try_fold(0_i64, |total, observation| {
                    Ok(total
                        + parse_usd_cents(
                            "costObservation.observedTotalCostUsd",
                            &observation.observed_total_cost_usd,
                        )?)
                })?;
        let latency_expected_total_ms = input
            .cost_observations
            .iter()
            .map(|observation| observation.expected_end_to_end_latency_ms)
            .sum::<u64>();
        let latency_observed_total_ms = input
            .cost_observations
            .iter()
            .map(|observation| observation.observed_end_to_end_latency_ms)
            .sum::<u64>();
        (
            modeled_total_cost_cents,
            observed_total_cost_cents,
            latency_expected_total_ms / observation_count.max(1),
            latency_observed_total_ms / observation_count.max(1),
        )
    } else if active {
        let modeled_total_cost_cents = input.plans.iter().try_fold(0_i64, |total, plan| {
            modeled_plan_cost_cents(plan, model).map(|plan_cost| total + plan_cost)
        })?;
        (
            modeled_total_cost_cents,
            modeled_total_cost_cents + reconciliation_drift_cents,
            model.latency_profile.expected_submit_ms + model.latency_profile.expected_settlement_ms,
            observed_end_to_end_latency_ms,
        )
    } else {
        (
            0,
            reconciliation_drift_cents,
            0,
            observed_end_to_end_latency_ms,
        )
    };
    let expected_end_to_end_latency_ms = if active { latency_expected_ms } else { 0 };
    let latency_drift_ms = expected_end_to_end_latency_ms.abs_diff(latency_observed_ms);
    let cost_drift_cents = (observed_total_cost_cents - modeled_total_cost_cents).abs();

    Ok(RuntimeCostScorecard {
        model_id: Some(model.model_id.clone()),
        model_status: Some(model.status.clone()),
        calibration_id: Some(model.calibration.calibration_id.clone()),
        calibration_confidence_bps: Some(model.calibration.confidence_bps),
        covered_run_count,
        model_coverage_bps: ratio_bps(covered_run_count, input.plans.len() as u64),
        observation_count,
        observation_coverage_bps: ratio_bps(observation_count, input.plans.len() as u64),
        evaluated_notional_usd: format_usd_cents(evaluated_notional_cents),
        modeled_total_cost_usd: format_usd_cents(modeled_total_cost_cents),
        observed_total_cost_usd: format_usd_cents(observed_total_cost_cents),
        cost_drift_usd: format_usd_cents(cost_drift_cents),
        cost_drift_bps: ratio_bps_from_cents(cost_drift_cents, evaluated_notional_cents),
        expected_end_to_end_latency_ms,
        observed_end_to_end_latency_ms: latency_observed_ms,
        latency_drift_ms,
        reconciliation_drift_count,
    })
}

fn build_feature_catalog_scorecard(
    input: &RuntimeScorecardInput,
) -> RuntimeFeatureCatalogScorecard {
    let required_feature_keys = input
        .strategy_spec
        .feature_requirements
        .iter()
        .filter(|requirement| requirement.required)
        .map(|requirement| requirement.feature_key.clone())
        .collect::<BTreeSet<_>>();
    let defined_feature_keys = input
        .feature_definitions
        .iter()
        .map(|record| record.feature_key.clone())
        .collect::<BTreeSet<_>>();
    let missing_feature_keys = required_feature_keys
        .iter()
        .filter(|feature_key| !defined_feature_keys.contains(*feature_key))
        .cloned()
        .collect::<Vec<_>>();
    let required_regime_keys = input
        .strategy_spec
        .regime_requirements
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let defined_regime_keys = input
        .regime_tags
        .iter()
        .map(|record| record.regime_key.clone())
        .collect::<BTreeSet<_>>();
    let missing_regime_keys = required_regime_keys
        .iter()
        .filter(|regime_key| !defined_regime_keys.contains(*regime_key))
        .cloned()
        .collect::<Vec<_>>();
    let defined_feature_count = required_feature_keys
        .iter()
        .filter(|feature_key| defined_feature_keys.contains(*feature_key))
        .count() as u64;
    let defined_regime_tag_count = required_regime_keys
        .iter()
        .filter(|regime_key| defined_regime_keys.contains(*regime_key))
        .count() as u64;
    let max_observed_feature_age_ms = input
        .verdicts
        .iter()
        .map(|verdict| verdict.observed.feature_age_ms)
        .max()
        .unwrap_or(0);
    let freshness_slo_ms = input
        .strategy_spec
        .feature_requirements
        .iter()
        .filter_map(|requirement| requirement.freshness_ms)
        .chain(
            input
                .feature_definitions
                .iter()
                .map(|record| record.freshness_slo_ms),
        )
        .min();
    let max_allowed_feature_drift_bps = input
        .feature_definitions
        .iter()
        .map(|record| record.max_allowed_drift_bps)
        .chain(
            input
                .regime_tags
                .iter()
                .map(|record| record.max_allowed_drift_bps),
        )
        .max();
    RuntimeFeatureCatalogScorecard {
        required_feature_count: required_feature_keys.len() as u64,
        defined_feature_count,
        feature_definition_coverage_bps: full_ratio_bps(
            defined_feature_count,
            required_feature_keys.len() as u64,
        ),
        required_regime_tag_count: required_regime_keys.len() as u64,
        defined_regime_tag_count,
        regime_tag_coverage_bps: full_ratio_bps(
            defined_regime_tag_count,
            required_regime_keys.len() as u64,
        ),
        max_observed_feature_age_ms,
        freshness_slo_ms,
        max_allowed_feature_drift_bps,
        missing_feature_keys,
        missing_regime_keys,
    }
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

    let mut checks = vec![
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
        exact_match_check(
            "shadow-cost-model-status",
            scorecard.cost.model_status == Some(RuntimeExecutionCostModelStatus::Active),
            cost_model_status_value(scorecard.cost.model_status.as_ref()),
            "active",
            "Shadow promotion requires an active, auditable execution cost model.",
        ),
        minimum_bps_check(
            "shadow-cost-model-coverage",
            scorecard.cost.model_coverage_bps,
            config.required_cost_model_coverage_bps,
            "Every planned shadow run must be covered by the active execution cost model.",
        ),
        minimum_bps_check(
            "shadow-cost-observation-coverage",
            scorecard.cost.observation_coverage_bps,
            config.required_cost_observation_coverage_bps,
            "Shadow promotion requires modeled-versus-observed cost observations for every planned run.",
        ),
        minimum_bps_check(
            "shadow-feature-definition-coverage",
            scorecard.feature_catalog.feature_definition_coverage_bps,
            config.required_feature_definition_coverage_bps,
            "Shadow promotion requires all declared feature definitions to be published and active.",
        ),
        minimum_bps_check(
            "shadow-regime-tag-coverage",
            scorecard.feature_catalog.regime_tag_coverage_bps,
            config.required_regime_tag_coverage_bps,
            "Shadow promotion requires all declared regime tags to be published and active.",
        ),
        maximum_bps_check(
            "shadow-max-cost-drift",
            scorecard.cost.cost_drift_bps,
            max_cost_drift_threshold_bps(config, input.cost_model.as_ref(), RuntimeMode::Shadow),
            "Shadow cost drift must stay within the configured robustness budget.",
        ),
        maximum_check(
            "shadow-max-latency-drift-ms",
            scorecard.cost.latency_drift_ms,
            max_latency_drift_threshold_ms(config, input.cost_model.as_ref(), RuntimeMode::Shadow),
            "Shadow observed execution latency must remain close to the modeled latency budget.",
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
    if advanced_strategy_requires_extended_evidence(&input.deployment) {
        checks.push(minimum_check(
            "shadow-advanced-min-runs",
            scorecard.trigger_quality.total_runs,
            config.advanced_shadow_min_runs,
            "Advanced templates require a wider shadow evidence window before paper promotion.",
        ));
    }
    if feature_driven_strategy_requires_fresh_features(&input.deployment) {
        checks.push(maximum_check(
            "shadow-signal-max-stale-feature-rejects",
            scorecard.trigger_quality.stale_feature_reject_count,
            config.signal_max_stale_feature_rejects,
            "Signal-driven templates require fresh feature inputs for every shadow evidence run.",
        ));
    }
    if allocator_coordination_required(&input.deployment) {
        checks.push(maximum_check(
            "shadow-allocator-zero-grant-runs",
            scorecard.allocator.zero_grant_count,
            0,
            "Allocator zero-grant outcomes block promotion until sleeve coordination is stable.",
        ));
    }

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
    let mut checks = vec![
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
        exact_match_check(
            "paper-cost-model-status",
            scorecard.cost.model_status == Some(RuntimeExecutionCostModelStatus::Active),
            cost_model_status_value(scorecard.cost.model_status.as_ref()),
            "active",
            "Paper promotion requires an active, auditable execution cost model.",
        ),
        minimum_bps_check(
            "paper-cost-model-coverage",
            scorecard.cost.model_coverage_bps,
            config.required_cost_model_coverage_bps,
            "Every planned paper run must be covered by the active execution cost model.",
        ),
        minimum_bps_check(
            "paper-cost-observation-coverage",
            scorecard.cost.observation_coverage_bps,
            config.required_cost_observation_coverage_bps,
            "Paper promotion requires modeled-versus-observed cost observations for every planned run.",
        ),
        minimum_bps_check(
            "paper-feature-definition-coverage",
            scorecard.feature_catalog.feature_definition_coverage_bps,
            config.required_feature_definition_coverage_bps,
            "Paper promotion requires all declared feature definitions to remain published and active.",
        ),
        minimum_bps_check(
            "paper-regime-tag-coverage",
            scorecard.feature_catalog.regime_tag_coverage_bps,
            config.required_regime_tag_coverage_bps,
            "Paper promotion requires all declared regime tags to remain published and active.",
        ),
        maximum_bps_check(
            "paper-max-cost-drift",
            scorecard.cost.cost_drift_bps,
            max_cost_drift_threshold_bps(config, input.cost_model.as_ref(), RuntimeMode::Paper),
            "Paper-mode cost drift must remain within the live-promotion budget.",
        ),
        maximum_check(
            "paper-max-latency-drift-ms",
            scorecard.cost.latency_drift_ms,
            max_latency_drift_threshold_ms(config, input.cost_model.as_ref(), RuntimeMode::Paper),
            "Paper-mode observed execution latency must remain close to the modeled latency budget.",
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
    if advanced_strategy_requires_extended_evidence(&input.deployment) {
        checks.push(minimum_check(
            "paper-advanced-min-runs",
            scorecard.trigger_quality.total_runs,
            config.advanced_paper_min_runs,
            "Advanced templates require a wider paper evidence window before bounded live promotion.",
        ));
    }
    if feature_driven_strategy_requires_fresh_features(&input.deployment) {
        checks.push(maximum_check(
            "paper-signal-max-stale-feature-rejects",
            scorecard.trigger_quality.stale_feature_reject_count,
            config.signal_max_stale_feature_rejects,
            "Signal-driven templates require fresh feature inputs for every paper evidence run.",
        ));
    }
    if allocator_coordination_required(&input.deployment) {
        checks.push(maximum_check(
            "paper-allocator-constrained-runs",
            scorecard.allocator.constrained_count,
            0,
            "Allocator-constrained paper runs block bounded live promotion.",
        ));
        checks.push(maximum_check(
            "paper-allocator-zero-grant-runs",
            scorecard.allocator.zero_grant_count,
            0,
            "Allocator zero-grant paper runs block bounded live promotion.",
        ));
    }

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

fn feature_driven_strategy_requires_fresh_features(deployment: &RuntimeDeploymentRecord) -> bool {
    matches!(
        deployment.strategy_key.as_str(),
        "trend_following" | "mean_reversion" | "breakout" | "macro_rotation" | "volatility_target"
    )
}

fn advanced_strategy_requires_extended_evidence(deployment: &RuntimeDeploymentRecord) -> bool {
    matches!(
        deployment.strategy_key.as_str(),
        "breakout" | "macro_rotation" | "volatility_target"
    )
}

fn allocator_coordination_required(deployment: &RuntimeDeploymentRecord) -> bool {
    !matches!(
        deployment.state,
        RuntimeDeploymentState::Killed | RuntimeDeploymentState::Archived
    )
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

fn maximum_bps_check(
    gate_id: &str,
    observed: u16,
    threshold: u16,
    message: &str,
) -> RuntimePromotionGateCheck {
    RuntimePromotionGateCheck {
        gate_id: gate_id.to_string(),
        status: if observed <= threshold {
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
        "- Allocator: {} decisions, {} constrained, {} zero-grant ({})\n",
        scorecard.allocator.decision_count,
        scorecard.allocator.constrained_count,
        scorecard.allocator.zero_grant_count,
        format_bps(scorecard.allocator.full_grant_rate_bps),
    ));
    markdown.push_str(&format!(
        "- Latest PnL: total {}, realized {}, unrealized {}, max drawdown {}\n",
        scorecard.pnl.total_pnl_usd,
        scorecard.pnl.realized_pnl_usd,
        scorecard.pnl.unrealized_pnl_usd,
        scorecard.pnl.max_drawdown_usd,
    ));
    markdown.push_str(&format!(
        "- Cost model: `{}` calibration `{}` confidence {} coverage {}, observation coverage {}, modeled {}, observed {}, drift {}, latency drift {}ms\n",
        scorecard.cost.model_id.as_deref().unwrap_or("missing"),
        scorecard.cost.calibration_id.as_deref().unwrap_or("missing"),
        scorecard
            .cost
            .calibration_confidence_bps
            .map(format_bps)
            .unwrap_or_else(|| "n/a".to_string()),
        format_bps(scorecard.cost.model_coverage_bps),
        format_bps(scorecard.cost.observation_coverage_bps),
        scorecard.cost.modeled_total_cost_usd,
        scorecard.cost.observed_total_cost_usd,
        scorecard.cost.cost_drift_usd,
        scorecard.cost.latency_drift_ms,
    ));
    markdown.push_str(&format!(
        "- Feature catalog: {} / {} features ({}), {} / {} regime tags ({}), max age {}ms{}\n",
        scorecard.feature_catalog.defined_feature_count,
        scorecard.feature_catalog.required_feature_count,
        format_bps(scorecard.feature_catalog.feature_definition_coverage_bps),
        scorecard.feature_catalog.defined_regime_tag_count,
        scorecard.feature_catalog.required_regime_tag_count,
        format_bps(scorecard.feature_catalog.regime_tag_coverage_bps),
        scorecard.feature_catalog.max_observed_feature_age_ms,
        scorecard
            .feature_catalog
            .freshness_slo_ms
            .map(|value| format!(", slo {}ms", value))
            .unwrap_or_default(),
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

fn max_cost_drift_threshold_bps(
    config: &RuntimeScorecardConfig,
    model: Option<&RuntimeExecutionCostModelRecord>,
    source_mode: RuntimeMode,
) -> u16 {
    let configured = match source_mode {
        RuntimeMode::Shadow => config.shadow_max_cost_drift_bps,
        RuntimeMode::Paper | RuntimeMode::Live => config.paper_max_cost_drift_bps,
    };
    model
        .map(|record| configured.min(record.drift_guard.max_cost_drift_bps))
        .unwrap_or(configured)
}

fn max_latency_drift_threshold_ms(
    config: &RuntimeScorecardConfig,
    model: Option<&RuntimeExecutionCostModelRecord>,
    source_mode: RuntimeMode,
) -> u64 {
    let configured = match source_mode {
        RuntimeMode::Shadow => config.shadow_max_latency_drift_ms,
        RuntimeMode::Paper | RuntimeMode::Live => config.paper_max_latency_drift_ms,
    };
    model
        .map(|record| configured.min(record.drift_guard.max_latency_drift_ms))
        .unwrap_or(configured)
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

fn cost_model_status_value(status: Option<&RuntimeExecutionCostModelStatus>) -> &'static str {
    match status {
        Some(RuntimeExecutionCostModelStatus::Draft) => "draft",
        Some(RuntimeExecutionCostModelStatus::Active) => "active",
        Some(RuntimeExecutionCostModelStatus::Deprecated) => "deprecated",
        None => "missing",
    }
}

fn plan_notional_cents(plans: &[RuntimeExecutionPlan]) -> Result<i64, RuntimeScorecardError> {
    plans.iter().try_fold(0_i64, |total, plan| {
        plan.slices.iter().try_fold(total, |slice_total, slice| {
            Ok(slice_total + parse_usd_cents("plan.slices[].notionalUsd", &slice.notional_usd)?)
        })
    })
}

fn modeled_plan_cost_cents(
    plan: &RuntimeExecutionPlan,
    model: &RuntimeExecutionCostModelRecord,
) -> Result<i64, RuntimeScorecardError> {
    let expected_partial_fill_bps = (u64::from(model.assumptions.partial_fill_rate_bps)
        * u64::from(model.assumptions.partial_fill_penalty_bps)
        / 10_000) as i64;
    let total_cost_bps = i64::from(model.assumptions.fee_bps)
        + i64::from(model.assumptions.slippage_bps)
        + i64::from(model.assumptions.market_impact_bps)
        + expected_partial_fill_bps;
    plan.slices.iter().try_fold(0_i64, |total, slice| {
        let notional_cents = parse_usd_cents("plan.slices[].notionalUsd", &slice.notional_usd)?;
        Ok(total + ((notional_cents * total_cost_bps) / 10_000))
    })
}

fn average_observed_end_to_end_latency_ms(
    input: &RuntimeScorecardInput,
) -> Result<u64, RuntimeScorecardError> {
    let run_by_id = input
        .runs
        .iter()
        .map(|run| (run.run_id.as_str(), run))
        .collect::<HashMap<_, _>>();
    let mut total_ms = 0_u64;
    let mut count = 0_u64;
    for reconciliation in &input.reconciliations {
        let Some(run) = run_by_id.get(reconciliation.run_id.as_str()) else {
            continue;
        };
        let planned_at = parse_timestamp("run.plannedAt", &run.planned_at)?;
        let completed_at =
            parse_timestamp("reconciliation.completedAt", &reconciliation.completed_at)?;
        total_ms = total_ms.saturating_add(timestamp_diff_ms(planned_at, completed_at));
        count = count.saturating_add(1);
    }
    if count == 0 {
        return Ok(0);
    }
    Ok(total_ms / count)
}

fn ratio_bps(numerator: u64, denominator: u64) -> u16 {
    if denominator == 0 {
        return 0;
    }
    ((numerator.saturating_mul(10_000)) / denominator) as u16
}

fn full_ratio_bps(numerator: u64, denominator: u64) -> u16 {
    if denominator == 0 {
        return 10_000;
    }
    ratio_bps(numerator, denominator)
}

fn ratio_bps_from_cents(numerator_cents: i64, denominator_cents: i64) -> u16 {
    if denominator_cents <= 0 || numerator_cents <= 0 {
        return 0;
    }
    let numerator = u64::try_from(numerator_cents).unwrap_or(u64::MAX);
    let denominator = u64::try_from(denominator_cents).unwrap_or(u64::MAX);
    ratio_bps(numerator, denominator)
}

fn parse_timestamp(
    field: &'static str,
    value: &str,
) -> Result<OffsetDateTime, RuntimeScorecardError> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| RuntimeScorecardError::InvalidTimestamp {
        field,
        value: value.to_string(),
    })
}

fn timestamp_diff_ms(start: OffsetDateTime, end: OffsetDateTime) -> u64 {
    let diff = (end - start).whole_milliseconds();
    if diff <= 0 {
        0
    } else {
        diff as u64
    }
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
        RuntimeCapital, RuntimeDeploymentState, RuntimeExecutionAction,
        RuntimeExecutionCostAssumptions, RuntimeExecutionCostModelRecord,
        RuntimeExecutionCostModelStatus, RuntimeExecutionSlice, RuntimeFeatureCatalogStatus,
        RuntimeFeatureDefinitionRecord, RuntimeLane, RuntimeLedgerBalance, RuntimeLedgerTotals,
        RuntimePair, RuntimePolicy, RuntimePositionSide, RuntimeReconciliationStatus,
        RuntimeRegimeDimension, RuntimeRegimeTagRecord, RuntimeRiskLimits, RuntimeRiskObserved,
        RuntimeRiskReason, RuntimeRiskSeverity, RuntimeTrigger, RuntimeTriggerKind,
        RuntimeVenueLatencyProfile, RuntimeVenueMarketType,
    };
    use strategy_core::StrategyKind;

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
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
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
            report.scorecard.cost.model_id.as_deref(),
            Some("cost_model_jupiter_sol_usdc_spot")
        );
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
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
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
    fn blocks_shadow_promotion_without_active_cost_model() {
        let deployment = deployment(
            "deployment_shadow_missing_cost",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Shadow,
        );
        let runs = (1..=3)
            .map(|index| {
                run(
                    &format!("run_shadow_missing_cost_{index}"),
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
            .map(|run| plan(&deployment, run, true, true))
            .collect::<Vec<_>>();
        let reconciliations = runs
            .iter()
            .map(|run| reconciliation(&deployment, run, RuntimeReconciliationStatus::Passed, false))
            .collect::<Vec<_>>();
        let snapshots = vec![ledger_snapshot(
            &deployment,
            "1000.00",
            "0.00",
            "1000.00",
            "0.50",
            "0.00",
            "2026-03-08T10:05:00Z",
        )];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs,
                verdicts,
                plans,
                cost_model: None,
                cost_observations: vec![],
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
                submit_attempt_count: 3,
                receipt_count: 3,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(
            report.promotion_gates[0].status,
            RuntimePromotionGateStatus::Blocked
        );
        assert!(report.promotion_gates[0]
            .checks
            .iter()
            .any(|check| check.gate_id == "shadow-cost-model-status"
                && check.status == RuntimePromotionGateStatus::Blocked));
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
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
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
        assert!(report.promotion_gates[1]
            .checks
            .iter()
            .any(|check| check.gate_id == "paper-max-cost-drift"
                && check.status == RuntimePromotionGateStatus::Blocked));
    }

    #[test]
    fn blocks_trend_following_shadow_promotion_on_stale_feature_rejects() {
        let deployment = deployment_with_strategy(
            "deployment_trend_shadow",
            "trend_following",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Shadow,
        );
        let runs = vec![
            run(
                "run_trend_shadow_1",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
            run(
                "run_trend_shadow_2",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
            run(
                "run_trend_shadow_3",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
        ];
        let verdicts = vec![
            allow_verdict(&deployment, &runs[0]),
            allow_verdict(&deployment, &runs[1]),
            stale_feature_reject_verdict(&deployment, &runs[2]),
        ];
        let plans = runs[..2]
            .iter()
            .map(|run| plan(&deployment, run, true, true))
            .collect::<Vec<_>>();
        let reconciliations = runs[..2]
            .iter()
            .map(|run| reconciliation(&deployment, run, RuntimeReconciliationStatus::Passed, false))
            .collect::<Vec<_>>();
        let snapshots = vec![ledger_snapshot(
            &deployment,
            "1000.00",
            "0.00",
            "1000.00",
            "1.00",
            "0.00",
            "2026-03-08T10:00:00Z",
        )];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
                submit_attempt_count: 2,
                receipt_count: 2,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(
            report.promotion_gates[0].status,
            RuntimePromotionGateStatus::Blocked
        );
        assert!(report.promotion_gates[0]
            .checks
            .iter()
            .any(
                |check| check.gate_id == "shadow-signal-max-stale-feature-rejects"
                    && check.status == RuntimePromotionGateStatus::Blocked
            ));
    }

    #[test]
    fn blocks_mean_reversion_live_promotion_on_stale_feature_rejects() {
        let deployment = deployment_with_strategy(
            "deployment_mean_paper",
            "mean_reversion",
            RuntimeMode::Paper,
            RuntimeDeploymentState::Paper,
        );
        let runs = (1..=5)
            .map(|index| {
                run(
                    &format!("run_mean_paper_{index}"),
                    RuntimeRunState::Completed,
                    trigger("signal"),
                )
            })
            .collect::<Vec<_>>();
        let verdicts = vec![
            allow_verdict(&deployment, &runs[0]),
            allow_verdict(&deployment, &runs[1]),
            allow_verdict(&deployment, &runs[2]),
            allow_verdict(&deployment, &runs[3]),
            stale_feature_reject_verdict(&deployment, &runs[4]),
        ];
        let plans = runs[..4]
            .iter()
            .map(|run| plan(&deployment, run, true, false))
            .collect::<Vec<_>>();
        let reconciliations = runs[..4]
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
                "1001.00",
                "5.00",
                "996.00",
                "1.50",
                "0.25",
                "2026-03-08T10:05:00Z",
            ),
        ];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
                submit_attempt_count: 4,
                receipt_count: 4,
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
            .any(
                |check| check.gate_id == "paper-signal-max-stale-feature-rejects"
                    && check.status == RuntimePromotionGateStatus::Blocked
            ));
    }

    #[test]
    fn blocks_breakout_shadow_promotion_without_extended_evidence_window() {
        let deployment = deployment_with_strategy(
            "deployment_breakout_shadow",
            "breakout",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Shadow,
        );
        let runs = vec![
            run(
                "run_breakout_shadow_1",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
            run(
                "run_breakout_shadow_2",
                RuntimeRunState::Completed,
                trigger("signal"),
            ),
            run(
                "run_breakout_shadow_3",
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
        let snapshots = vec![ledger_snapshot(
            &deployment,
            "1000.00",
            "0.00",
            "1000.00",
            "1.00",
            "0.00",
            "2026-03-08T10:00:00Z",
        )];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
                submit_attempt_count: 3,
                receipt_count: 3,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(
            report.promotion_gates[0].status,
            RuntimePromotionGateStatus::Blocked
        );
        assert!(report.promotion_gates[0]
            .checks
            .iter()
            .any(|check| check.gate_id == "shadow-advanced-min-runs"
                && check.status == RuntimePromotionGateStatus::Blocked));
    }

    #[test]
    fn blocks_volatility_target_live_promotion_on_stale_feature_rejects() {
        let deployment = deployment_with_strategy(
            "deployment_vol_target_paper",
            "volatility_target",
            RuntimeMode::Paper,
            RuntimeDeploymentState::Paper,
        );
        let runs = (1..=7)
            .map(|index| {
                run(
                    &format!("run_vol_target_{index}"),
                    RuntimeRunState::Completed,
                    trigger("signal"),
                )
            })
            .collect::<Vec<_>>();
        let verdicts = vec![
            allow_verdict(&deployment, &runs[0]),
            allow_verdict(&deployment, &runs[1]),
            allow_verdict(&deployment, &runs[2]),
            allow_verdict(&deployment, &runs[3]),
            allow_verdict(&deployment, &runs[4]),
            allow_verdict(&deployment, &runs[5]),
            stale_feature_reject_verdict(&deployment, &runs[6]),
        ];
        let plans = runs[..6]
            .iter()
            .map(|run| plan(&deployment, run, true, false))
            .collect::<Vec<_>>();
        let reconciliations = runs[..6]
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
                "1003.00",
                "5.00",
                "998.00",
                "2.00",
                "0.50",
                "2026-03-08T10:05:00Z",
            ),
        ];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions: vec![],
                submit_attempt_count: 6,
                receipt_count: 6,
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
            .any(
                |check| check.gate_id == "paper-signal-max-stale-feature-rejects"
                    && check.status == RuntimePromotionGateStatus::Blocked
            ));
        assert!(report.promotion_gates[1]
            .checks
            .iter()
            .any(|check| check.gate_id == "paper-advanced-min-runs"
                && check.status == RuntimePromotionGateStatus::Pass));
    }

    #[test]
    fn blocks_live_promotion_when_allocator_constrains_paper_runs() {
        let deployment = deployment(
            "deployment_allocator_paper",
            RuntimeMode::Paper,
            RuntimeDeploymentState::Paper,
        );
        let runs = (1..=5)
            .map(|index| {
                run(
                    &format!("run_allocator_{index}"),
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
        let snapshots = vec![ledger_snapshot(
            &deployment,
            "1000.00",
            "5.00",
            "995.00",
            "1.00",
            "0.00",
            "2026-03-08T10:00:00Z",
        )];
        let allocator_decisions = vec![
            allocator_decision(&deployment, &runs[0], false, "25.00", "5.00"),
            allocator_decision(&deployment, &runs[1], true, "20.00", "4.00"),
        ];

        let report = build_readiness_report(
            &RuntimeScorecardConfig::default(),
            &RuntimeScorecardInput {
                deployment: deployment.clone(),
                strategy_spec: strategy_spec(&deployment),
                runs: runs.clone(),
                verdicts,
                plans: plans.clone(),
                cost_model: Some(cost_model(&deployment)),
                cost_observations: cost_observations(&deployment, &runs, &plans, &reconciliations),
                feature_definitions: feature_definitions(&deployment),
                regime_tags: regime_tags(&deployment),
                allocator_decisions,
                submit_attempt_count: 5,
                receipt_count: 5,
                reconciliations,
                observed_ledger_snapshots: snapshots.clone(),
                latest_ledger_snapshot: snapshots.last().cloned(),
            },
        )
        .expect("report to build");

        assert_eq!(report.scorecard.allocator.decision_count, 2);
        assert_eq!(report.scorecard.allocator.constrained_count, 1);
        assert_eq!(
            report.promotion_gates[1].status,
            RuntimePromotionGateStatus::Blocked
        );
        assert!(report.promotion_gates[1]
            .checks
            .iter()
            .any(|check| check.gate_id == "paper-allocator-constrained-runs"
                && check.status == RuntimePromotionGateStatus::Blocked));
    }

    fn deployment(
        deployment_id: &str,
        mode: RuntimeMode,
        state: RuntimeDeploymentState,
    ) -> RuntimeDeploymentRecord {
        deployment_with_strategy(deployment_id, "dca", mode, state)
    }

    fn deployment_with_strategy(
        deployment_id: &str,
        strategy_key: &str,
        mode: RuntimeMode,
        state: RuntimeDeploymentState,
    ) -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: deployment_id.to_string(),
            strategy_key: strategy_key.to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: "jupiter".to_string(),
            pair: RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: RuntimeVenueMarketType::Spot,
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

    fn stale_feature_reject_verdict(
        deployment: &RuntimeDeploymentRecord,
        run: &RuntimeRunRecord,
    ) -> RuntimeRiskVerdict {
        RuntimeRiskVerdict {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            verdict_id: format!("stale_{}", run.run_id),
            deployment_id: deployment.deployment_id.clone(),
            run_id: run.run_id.clone(),
            decided_at: "2026-03-08T10:00:00Z".to_string(),
            verdict: RuntimeRiskDecision::Reject,
            reasons: vec![RuntimeRiskReason {
                code: "feature_stale".to_string(),
                message: "Feature snapshot is stale".to_string(),
                severity: RuntimeRiskSeverity::Warn,
            }],
            observed: RuntimeRiskObserved {
                requested_notional_usd: "5.00".to_string(),
                reserved_usd: "5.00".to_string(),
                concentration_bps: 500,
                feature_age_ms: 25_000,
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
            venue_key: deployment.venue_key.clone(),
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

    fn cost_model(deployment: &RuntimeDeploymentRecord) -> RuntimeExecutionCostModelRecord {
        RuntimeExecutionCostModelRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            model_id: format!("cost_model_{}_sol_usdc_spot", deployment.venue_key),
            venue_key: deployment.venue_key.clone(),
            market_type: RuntimeVenueMarketType::Spot,
            pair_symbol: deployment.pair.symbol.clone(),
            instrument_id: Some(deployment.pair.symbol.clone()),
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            mode_coverage: vec![RuntimeMode::Shadow, RuntimeMode::Paper, RuntimeMode::Live],
            status: RuntimeExecutionCostModelStatus::Active,
            assumptions: RuntimeExecutionCostAssumptions {
                fee_bps: 8,
                slippage_bps: 22,
                market_impact_bps: 12,
                partial_fill_rate_bps: 100,
                partial_fill_penalty_bps: 10,
                financing_cost_bps_per_day: None,
            },
            calibration: protocol::RuntimeExecutionCostCalibration {
                calibration_id: format!("calibration_{}_sol_usdc_spot", deployment.venue_key),
                methodology: "seeded-regression".to_string(),
                sample_start_at: "2026-03-01T00:00:00.000Z".to_string(),
                sample_end_at: "2026-03-10T00:00:00.000Z".to_string(),
                sample_count: 64,
                confidence_bps: 9_200,
                reference_notional_usd: "1000.00".to_string(),
                tags: vec!["seed".to_string(), "spot".to_string()],
                notes: Some("Synthetic calibration fixture.".to_string()),
            },
            drift_guard: protocol::RuntimeExecutionCostDriftGuard {
                max_cost_drift_bps: 500,
                max_latency_drift_ms: 500,
                max_reconciliation_drift_usd: "1.00".to_string(),
            },
            latency_profile: RuntimeVenueLatencyProfile {
                expected_quote_ms: 250,
                expected_submit_ms: 750,
                expected_settlement_ms: 5_000,
            },
            dataset_snapshots: vec![protocol::RuntimeDatasetSnapshotRef {
                dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
                snapshot_id: "snapshot_2026_03_07_seed".to_string(),
                captured_at: "2026-03-10T00:00:00.000Z".to_string(),
                uri: Some(
                    "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents"
                        .to_string(),
                ),
                content_digest: Some("sha256:fixture".to_string()),
            }],
            created_at: "2026-03-10T00:00:00.000Z".to_string(),
            updated_at: "2026-03-10T00:00:00.000Z".to_string(),
            tags: vec!["seed".to_string(), "spot".to_string()],
            notes: Some("Synthetic test cost model.".to_string()),
        }
    }

    fn cost_observations(
        deployment: &RuntimeDeploymentRecord,
        runs: &[RuntimeRunRecord],
        plans: &[RuntimeExecutionPlan],
        reconciliations: &[RuntimeReconciliationResult],
    ) -> Vec<protocol::RuntimeExecutionCostObservationRecord> {
        let model = cost_model(deployment);
        plans
            .iter()
            .zip(reconciliations.iter())
            .map(|(plan, reconciliation)| {
                let run = runs
                    .iter()
                    .find(|candidate| candidate.run_id == reconciliation.run_id)
                    .expect("matching run for reconciliation");
                build_cost_observation(&RuntimeCostObservationInput {
                    deployment: deployment.clone(),
                    run: run.clone(),
                    plan: plan.clone(),
                    cost_model: model.clone(),
                    receipt_observed_at: "2026-03-08T10:00:06Z".to_string(),
                    reconciliation: reconciliation.clone(),
                })
                .expect("cost observation to build")
            })
            .collect()
    }

    fn strategy_spec(deployment: &RuntimeDeploymentRecord) -> RuntimeStrategySpec {
        strategy_kind(&deployment.strategy_key).spec()
    }

    fn strategy_kind(strategy_key: &str) -> StrategyKind {
        match strategy_key {
            "dca" => StrategyKind::Dca,
            "threshold_rebalance" => StrategyKind::ThresholdRebalance,
            "twap" => StrategyKind::Twap,
            "trend_following" => StrategyKind::TrendFollowing,
            "mean_reversion" => StrategyKind::MeanReversion,
            "breakout" => StrategyKind::Breakout,
            "macro_rotation" => StrategyKind::MacroRotation,
            "volatility_target" => StrategyKind::VolatilityTarget,
            other => panic!("unsupported strategy key in test helper: {other}"),
        }
    }

    fn feature_definitions(
        deployment: &RuntimeDeploymentRecord,
    ) -> Vec<RuntimeFeatureDefinitionRecord> {
        strategy_spec(deployment)
            .feature_requirements
            .into_iter()
            .map(|requirement| RuntimeFeatureDefinitionRecord {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                feature_id: format!("feature_{}_v1", requirement.feature_key),
                feature_key: requirement.feature_key,
                version: "1.0.0".to_string(),
                title: "Feature definition".to_string(),
                summary: "Synthetic feature definition for scorecard tests.".to_string(),
                status: RuntimeFeatureCatalogStatus::Active,
                market_type: RuntimeVenueMarketType::Spot,
                venue_keys: vec![deployment.venue_key.clone()],
                asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
                pair_symbols: vec![deployment.pair.symbol.clone()],
                input_requirements: vec![protocol::RuntimeFeatureInputRequirement {
                    input_key: "mid_price_usd".to_string(),
                    required: true,
                    freshness_ms: requirement.freshness_ms,
                    notes: Some("Synthetic feature input requirement.".to_string()),
                }],
                derived_from_feature_keys: vec![],
                freshness_slo_ms: requirement.freshness_ms.unwrap_or(20_000),
                max_allowed_drift_bps: 50,
                min_coverage_bps: 10_000,
                provenance: protocol::RuntimeCatalogProvenance {
                    generated_by: "runtime-scorecards::tests".to_string(),
                    generated_revision: Some("seed".to_string()),
                    generated_at: "2026-03-10T00:00:00.000Z".to_string(),
                    notes: Some("Synthetic test provenance.".to_string()),
                },
                dataset_snapshots: vec![protocol::RuntimeDatasetSnapshotRef {
                    dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
                    snapshot_id: "snapshot_2026_03_07_seed".to_string(),
                    captured_at: "2026-03-10T00:00:00.000Z".to_string(),
                    uri: Some(
                        "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents"
                            .to_string(),
                    ),
                    content_digest: Some("sha256:fixture".to_string()),
                }],
                created_at: "2026-03-10T00:00:00.000Z".to_string(),
                updated_at: "2026-03-10T00:00:00.000Z".to_string(),
                tags: vec!["test".to_string()],
                notes: Some("Synthetic test feature definition.".to_string()),
            })
            .collect()
    }

    fn regime_tags(deployment: &RuntimeDeploymentRecord) -> Vec<RuntimeRegimeTagRecord> {
        strategy_spec(deployment)
            .regime_requirements
            .into_iter()
            .map(|regime_key| RuntimeRegimeTagRecord {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                regime_tag_id: format!("regime_{}_v1", regime_key),
                regime_key: regime_key.clone(),
                version: "1.0.0".to_string(),
                title: "Regime tag".to_string(),
                summary: "Synthetic regime tag for scorecard tests.".to_string(),
                status: RuntimeFeatureCatalogStatus::Active,
                dimension: match regime_key.as_str() {
                    "volatility_band" => RuntimeRegimeDimension::Volatility,
                    "liquidity_state" => RuntimeRegimeDimension::Liquidity,
                    _ => RuntimeRegimeDimension::Trend,
                },
                value: "classified".to_string(),
                market_type: RuntimeVenueMarketType::Spot,
                venue_keys: vec![deployment.venue_key.clone()],
                asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
                pair_symbols: vec![deployment.pair.symbol.clone()],
                source_feature_keys: vec!["short_return_bps".to_string()],
                freshness_slo_ms: 20_000,
                max_allowed_drift_bps: 50,
                min_confidence_bps: 8_000,
                provenance: protocol::RuntimeCatalogProvenance {
                    generated_by: "runtime-scorecards::tests".to_string(),
                    generated_revision: Some("seed".to_string()),
                    generated_at: "2026-03-10T00:00:00.000Z".to_string(),
                    notes: Some("Synthetic test provenance.".to_string()),
                },
                dataset_snapshots: vec![protocol::RuntimeDatasetSnapshotRef {
                    dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
                    snapshot_id: "snapshot_2026_03_07_seed".to_string(),
                    captured_at: "2026-03-10T00:00:00.000Z".to_string(),
                    uri: Some(
                        "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents"
                            .to_string(),
                    ),
                    content_digest: Some("sha256:fixture".to_string()),
                }],
                created_at: "2026-03-10T00:00:00.000Z".to_string(),
                updated_at: "2026-03-10T00:00:00.000Z".to_string(),
                tags: vec!["test".to_string()],
                notes: Some("Synthetic test regime tag.".to_string()),
            })
            .collect()
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
            status: status.clone(),
            wallet_deltas: vec![],
            position_delta_usd: if correction_applied {
                "1.00".to_string()
            } else {
                match status {
                    RuntimeReconciliationStatus::Passed => "0.00".to_string(),
                    RuntimeReconciliationStatus::NeedsManualReview => "1.50".to_string(),
                    RuntimeReconciliationStatus::Failed => "3.00".to_string(),
                }
            },
            notes: vec![],
            correction_applied,
        }
    }

    fn allocator_decision(
        deployment: &RuntimeDeploymentRecord,
        run: &RuntimeRunRecord,
        constrained: bool,
        granted_allocated_usd: &str,
        granted_reserved_usd: &str,
    ) -> RuntimeAllocatorDecisionRecord {
        RuntimeAllocatorDecisionRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            decision_id: format!("alloc_{}", run.run_id),
            run_id: run.run_id.clone(),
            deployment_id: deployment.deployment_id.clone(),
            sleeve_id: deployment.sleeve_id.clone(),
            decided_at: "2026-03-08T10:00:00Z".to_string(),
            sleeve_equity_usd: "1000.00".to_string(),
            total_requested_allocated_usd: "1000.00".to_string(),
            total_granted_allocated_usd: "1000.00".to_string(),
            total_requested_reserved_usd: "25.00".to_string(),
            total_granted_reserved_usd: if constrained {
                "24.00".to_string()
            } else {
                "25.00".to_string()
            },
            requested_allocated_usd: deployment.capital.allocated_usd.clone(),
            granted_allocated_usd: granted_allocated_usd.to_string(),
            requested_reserved_usd: deployment.capital.reserved_usd.clone(),
            granted_reserved_usd: granted_reserved_usd.to_string(),
            granted_available_usd: if constrained {
                "16.00".to_string()
            } else {
                "20.00".to_string()
            },
            priority_rank: 1,
            priority_score: 100,
            constrained,
            peer_grants: vec![],
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
