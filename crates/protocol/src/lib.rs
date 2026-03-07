use serde::{Deserialize, Serialize};

pub const RUNTIME_PROTOCOL_SCHEMA_VERSION: &str = "v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeMode {
    Shadow,
    Paper,
    Live,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLane {
    Safe,
    Protected,
    Fast,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeDeploymentState {
    Draft,
    Shadow,
    Paper,
    Live,
    Paused,
    Killed,
    Archived,
}

impl RuntimeDeploymentState {
    #[must_use]
    pub fn can_transition_to(&self, next: &Self) -> bool {
        matches!(
            (self, next),
            (
                Self::Draft,
                Self::Shadow | Self::Paper | Self::Live | Self::Archived
            ) | (
                Self::Shadow,
                Self::Paper | Self::Paused | Self::Killed | Self::Archived
            ) | (
                Self::Paper,
                Self::Live | Self::Paused | Self::Killed | Self::Archived
            ) | (Self::Live, Self::Paused | Self::Killed | Self::Archived)
                | (
                    Self::Paused,
                    Self::Shadow | Self::Paper | Self::Live | Self::Killed | Self::Archived
                )
                | (Self::Killed, Self::Archived)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRunState {
    Pending,
    RiskChecked,
    Planned,
    Submitted,
    ReceiptPending,
    Reconciled,
    NeedsManualReview,
    Completed,
    Rejected,
    Failed,
    Killed,
}

impl RuntimeRunState {
    #[must_use]
    pub fn can_transition_to(&self, next: &Self) -> bool {
        matches!(
            (self, next),
            (
                Self::Pending,
                Self::RiskChecked | Self::Rejected | Self::Killed
            ) | (
                Self::RiskChecked,
                Self::Planned | Self::Rejected | Self::Killed
            ) | (
                Self::Planned,
                Self::Submitted | Self::Completed | Self::Killed
            ) | (
                Self::Submitted,
                Self::ReceiptPending | Self::Failed | Self::Killed
            ) | (
                Self::ReceiptPending,
                Self::Reconciled | Self::Failed | Self::Killed
            ) | (
                Self::Reconciled,
                Self::Completed | Self::NeedsManualReview | Self::Failed
            ) | (Self::NeedsManualReview, Self::Completed | Self::Failed)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTriggerKind {
    Cron,
    Signal,
    Rebalance,
    Operator,
    Canary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRiskDecision {
    Allow,
    Reject,
    Pause,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeRiskSeverity {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeExecutionAction {
    Buy,
    Sell,
    Rebalance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeReconciliationStatus {
    Passed,
    NeedsManualReview,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePositionSide {
    Long,
    Short,
    Flat,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePair {
    pub symbol: String,
    pub base_mint: String,
    pub quote_mint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePolicy {
    pub max_notional_usd: String,
    pub daily_loss_limit_usd: String,
    pub max_slippage_bps: u16,
    pub max_concurrent_runs: u32,
    pub rebalance_tolerance_bps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapital {
    pub allocated_usd: String,
    pub reserved_usd: String,
    pub available_usd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDeploymentRecord {
    pub schema_version: String,
    pub deployment_id: String,
    pub strategy_key: String,
    pub sleeve_id: String,
    pub owner_user_id: String,
    pub pair: RuntimePair,
    pub mode: RuntimeMode,
    pub state: RuntimeDeploymentState,
    pub lane: RuntimeLane,
    pub created_at: String,
    pub updated_at: String,
    pub promoted_at: Option<String>,
    pub paused_at: Option<String>,
    pub killed_at: Option<String>,
    pub policy: RuntimePolicy,
    pub capital: RuntimeCapital,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTrigger {
    pub kind: RuntimeTriggerKind,
    pub source: String,
    pub observed_at: String,
    pub feature_snapshot_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunRecord {
    pub schema_version: String,
    pub run_id: String,
    pub deployment_id: String,
    pub run_key: String,
    pub trigger: RuntimeTrigger,
    pub state: RuntimeRunState,
    pub planned_at: String,
    pub updated_at: String,
    pub risk_verdict_id: Option<String>,
    pub execution_plan_id: Option<String>,
    pub submit_request_id: Option<String>,
    pub receipt_id: Option<String>,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLedgerBalance {
    pub mint: String,
    pub symbol: String,
    pub decimals: u8,
    pub free_atomic: String,
    pub reserved_atomic: String,
    pub price_usd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLedgerPosition {
    pub instrument_id: String,
    pub side: RuntimePositionSide,
    pub quantity_atomic: String,
    pub entry_price_usd: Option<String>,
    pub mark_price_usd: Option<String>,
    pub unrealized_pnl_usd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLedgerTotals {
    pub equity_usd: String,
    pub reserved_usd: String,
    pub available_usd: String,
    pub realized_pnl_usd: String,
    pub unrealized_pnl_usd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLedgerSnapshot {
    pub schema_version: String,
    pub snapshot_id: String,
    pub deployment_id: String,
    pub sleeve_id: String,
    pub as_of: String,
    pub balances: Vec<RuntimeLedgerBalance>,
    pub positions: Vec<RuntimeLedgerPosition>,
    pub totals: RuntimeLedgerTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskReason {
    pub code: String,
    pub message: String,
    pub severity: RuntimeRiskSeverity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskObserved {
    pub requested_notional_usd: String,
    pub reserved_usd: String,
    pub concentration_bps: u16,
    pub feature_age_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskLimits {
    pub max_notional_usd: String,
    pub max_reserved_usd: String,
    pub max_concentration_bps: u16,
    pub stale_after_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskVerdict {
    pub schema_version: String,
    pub verdict_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub decided_at: String,
    pub verdict: RuntimeRiskDecision,
    pub reasons: Vec<RuntimeRiskReason>,
    pub observed: RuntimeRiskObserved,
    pub limits: RuntimeRiskLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExecutionSlice {
    pub slice_id: String,
    pub action: RuntimeExecutionAction,
    pub input_mint: String,
    pub output_mint: String,
    pub input_amount_atomic: String,
    pub min_output_amount_atomic: Option<String>,
    pub notional_usd: String,
    pub slippage_bps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExecutionPlan {
    pub schema_version: String,
    pub plan_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub created_at: String,
    pub mode: RuntimeMode,
    pub lane: RuntimeLane,
    pub idempotency_key: String,
    pub simulate_only: bool,
    pub dry_run: bool,
    pub slices: Vec<RuntimeExecutionSlice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeWalletDelta {
    pub mint: String,
    pub expected_atomic: String,
    pub actual_atomic: String,
    pub delta_atomic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReconciliationResult {
    pub schema_version: String,
    pub reconciliation_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub receipt_id: String,
    pub completed_at: String,
    pub status: RuntimeReconciliationStatus,
    pub wallet_deltas: Vec<RuntimeWalletDelta>,
    pub position_delta_usd: String,
    pub notes: Vec<String>,
    pub correction_applied: bool,
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;

    fn fixture_path(file_name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/runtime-contracts/fixtures")
            .join(file_name)
    }

    fn read_fixture(file_name: &str) -> String {
        fs::read_to_string(fixture_path(file_name)).expect("fixture to load")
    }

    #[test]
    fn deserializes_runtime_contract_fixtures() {
        let deployment: RuntimeDeploymentRecord =
            serde_json::from_str(&read_fixture("runtime.deployment.valid.v1.json"))
                .expect("deployment fixture to deserialize");
        let run: RuntimeRunRecord =
            serde_json::from_str(&read_fixture("runtime.run.valid.v1.json"))
                .expect("run fixture to deserialize");
        let ledger: RuntimeLedgerSnapshot =
            serde_json::from_str(&read_fixture("runtime.ledger_snapshot.valid.v1.json"))
                .expect("ledger fixture to deserialize");
        let verdict: RuntimeRiskVerdict =
            serde_json::from_str(&read_fixture("runtime.risk_verdict.valid.v1.json"))
                .expect("risk fixture to deserialize");
        let plan: RuntimeExecutionPlan =
            serde_json::from_str(&read_fixture("runtime.execution_plan.valid.v1.json"))
                .expect("plan fixture to deserialize");
        let reconciliation: RuntimeReconciliationResult =
            serde_json::from_str(&read_fixture("runtime.reconciliation_result.valid.v1.json"))
                .expect("reconciliation fixture to deserialize");

        assert_eq!(deployment.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(run.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(ledger.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(verdict.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(plan.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(
            reconciliation.schema_version,
            RUNTIME_PROTOCOL_SCHEMA_VERSION
        );
        assert_eq!(plan.slices.len(), 1);
    }

    #[test]
    fn enforces_transition_guards() {
        assert!(RuntimeDeploymentState::Draft.can_transition_to(&RuntimeDeploymentState::Shadow,));
        assert!(!RuntimeDeploymentState::Live.can_transition_to(&RuntimeDeploymentState::Draft,));
        assert!(RuntimeRunState::Pending.can_transition_to(&RuntimeRunState::RiskChecked,));
        assert!(!RuntimeRunState::Completed.can_transition_to(&RuntimeRunState::Planned,));
    }
}
