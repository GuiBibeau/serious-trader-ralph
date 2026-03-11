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
    pub owner_user_id: Option<String>,
    pub sleeve_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePromotionGateStatus {
    Pass,
    Blocked,
    NotApplicable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTriggerQualityScorecard {
    pub total_runs: u64,
    pub fresh_trigger_count: u64,
    pub stale_feature_reject_count: u64,
    pub fresh_trigger_rate_bps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePlanQualityScorecard {
    pub allowed_run_count: u64,
    pub planned_run_count: u64,
    pub plan_coverage_bps: u16,
    pub dry_run_count: u64,
    pub simulate_only_count: u64,
    pub dry_run_plan_rate_bps: u16,
    pub simulate_only_plan_rate_bps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExpectedObservedScorecard {
    pub submit_attempt_count: u64,
    pub receipt_count: u64,
    pub reconciliation_count: u64,
    pub reconciliation_pass_count: u64,
    pub reconciliation_manual_review_count: u64,
    pub reconciliation_failed_count: u64,
    pub reconciliation_pass_rate_bps: u16,
    pub correction_applied_count: u64,
    pub drift_alert_count: u64,
    pub completed_run_count: u64,
    pub failed_run_count: u64,
    pub manual_review_run_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePnlScorecard {
    pub latest_equity_usd: String,
    pub latest_reserved_usd: String,
    pub latest_available_usd: String,
    pub realized_pnl_usd: String,
    pub unrealized_pnl_usd: String,
    pub total_pnl_usd: String,
    pub max_drawdown_usd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRiskScorecard {
    pub verdict_count: u64,
    pub allow_count: u64,
    pub reject_count: u64,
    pub pause_count: u64,
    pub allow_rate_bps: u16,
    pub reject_rate_bps: u16,
    pub pause_rate_bps: u16,
    pub stale_feature_reject_count: u64,
    pub concentration_reject_count: u64,
    pub kill_switch_pause_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorPeerGrant {
    pub deployment_id: String,
    pub strategy_key: String,
    pub mode: RuntimeMode,
    pub state: RuntimeDeploymentState,
    pub priority_rank: u32,
    pub priority_score: i64,
    pub requested_allocated_usd: String,
    pub granted_allocated_usd: String,
    pub requested_reserved_usd: String,
    pub granted_reserved_usd: String,
    pub constrained: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorDecisionRecord {
    pub schema_version: String,
    pub decision_id: String,
    pub run_id: String,
    pub deployment_id: String,
    pub sleeve_id: String,
    pub decided_at: String,
    pub sleeve_equity_usd: String,
    pub total_requested_allocated_usd: String,
    pub total_granted_allocated_usd: String,
    pub total_requested_reserved_usd: String,
    pub total_granted_reserved_usd: String,
    pub requested_allocated_usd: String,
    pub granted_allocated_usd: String,
    pub requested_reserved_usd: String,
    pub granted_reserved_usd: String,
    pub granted_available_usd: String,
    pub priority_rank: u32,
    pub priority_score: i64,
    pub constrained: bool,
    pub peer_grants: Vec<RuntimeAllocatorPeerGrant>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorScorecard {
    pub decision_count: u64,
    pub full_grant_count: u64,
    pub constrained_count: u64,
    pub zero_grant_count: u64,
    pub full_grant_rate_bps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeScorecard {
    pub trigger_quality: RuntimeTriggerQualityScorecard,
    pub plan_quality: RuntimePlanQualityScorecard,
    pub expected_vs_observed: RuntimeExpectedObservedScorecard,
    pub pnl: RuntimePnlScorecard,
    pub risk: RuntimeRiskScorecard,
    pub allocator: RuntimeAllocatorScorecard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePromotionGateCheck {
    pub gate_id: String,
    pub status: RuntimePromotionGateStatus,
    pub observed_value: String,
    pub threshold_value: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePromotionGateDecision {
    pub source_mode: RuntimeMode,
    pub target_mode: RuntimeMode,
    pub eligible: bool,
    pub status: RuntimePromotionGateStatus,
    pub checks: Vec<RuntimePromotionGateCheck>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePromotionReadinessReport {
    pub schema_version: String,
    pub deployment_id: String,
    pub mode: RuntimeMode,
    pub state: RuntimeDeploymentState,
    pub generated_at: String,
    pub scorecard: RuntimeScorecard,
    pub promotion_gates: Vec<RuntimePromotionGateDecision>,
    pub proof_artifact_markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResearchHypothesisStatus {
    Candidate,
    Testing,
    Promoted,
    Rejected,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResearchSourceKind {
    Paper,
    Article,
    Repository,
    Dataset,
    Notebook,
    InternalNote,
    MarketReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResearchSourceAcquisitionKind {
    ManualUrl,
    PaperFeed,
    VenueDocs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResearchExperimentStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResearchEvidenceStatus {
    Draft,
    ReadyForReview,
    Approved,
    Rejected,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResearchCitation {
    pub source_id: String,
    pub locator: Option<String>,
    pub material_digest: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCodeRevisionRef {
    pub vcs: String,
    pub repository: String,
    pub revision: String,
    pub compared_to: Option<String>,
    pub tree_dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDatasetSnapshotRef {
    pub dataset_id: String,
    pub snapshot_id: String,
    pub captured_at: String,
    pub uri: Option<String>,
    pub content_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifactRef {
    pub artifact_id: String,
    pub kind: String,
    pub uri: String,
    pub content_digest: Option<String>,
    pub created_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResearchSourceProvenance {
    pub acquisition_kind: RuntimeResearchSourceAcquisitionKind,
    pub collected_from: String,
    pub hostname: String,
    pub publisher: Option<String>,
    pub first_seen_at: Option<String>,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResearchHypothesisRecord {
    pub schema_version: String,
    pub hypothesis_id: String,
    pub strategy_key: String,
    pub title: String,
    pub thesis: String,
    pub status: RuntimeResearchHypothesisStatus,
    pub created_at: String,
    pub updated_at: String,
    pub venue_keys: Vec<String>,
    pub asset_keys: Vec<String>,
    pub source_citations: Vec<RuntimeResearchCitation>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResearchSourceRecord {
    pub schema_version: String,
    pub source_id: String,
    pub source_kind: RuntimeResearchSourceKind,
    pub title: String,
    pub url: String,
    pub canonical_url: String,
    pub authors: Vec<String>,
    pub published_at: Option<String>,
    pub retrieved_at: String,
    pub content_digest: String,
    pub provenance: RuntimeResearchSourceProvenance,
    pub venue_keys: Vec<String>,
    pub asset_keys: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResearchExperimentRecord {
    pub schema_version: String,
    pub experiment_id: String,
    pub hypothesis_id: String,
    pub strategy_key: String,
    pub status: RuntimeResearchExperimentStatus,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub venue_keys: Vec<String>,
    pub asset_keys: Vec<String>,
    pub source_citations: Vec<RuntimeResearchCitation>,
    pub code_revision: RuntimeCodeRevisionRef,
    pub dataset_snapshots: Vec<RuntimeDatasetSnapshotRef>,
    pub artifacts: Vec<RuntimeArtifactRef>,
    pub summary: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResearchEvidenceBundleRecord {
    pub schema_version: String,
    pub evidence_bundle_id: String,
    pub experiment_id: String,
    pub strategy_key: String,
    pub status: RuntimeResearchEvidenceStatus,
    pub promotion_target: String,
    pub created_at: String,
    pub updated_at: String,
    pub venue_keys: Vec<String>,
    pub asset_keys: Vec<String>,
    pub source_citations: Vec<RuntimeResearchCitation>,
    pub code_revision: RuntimeCodeRevisionRef,
    pub dataset_snapshots: Vec<RuntimeDatasetSnapshotRef>,
    pub artifacts: Vec<RuntimeArtifactRef>,
    pub summary: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStrategyCategory {
    Allocation,
    Signal,
    Advanced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStrategyParameterKind {
    Decimal,
    Integer,
    Bps,
    Boolean,
    Enum,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeStrategyAssetRole {
    Base,
    Quote,
    Either,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOnboardingState {
    Candidate,
    Integrated,
    ShadowReady,
    PaperReady,
    LimitedLiveReady,
    BroadLiveReady,
    Paused,
    Deprecated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStrategyVenueSupport {
    pub venue_key: String,
    pub onboarding_state: RuntimeOnboardingState,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStrategyAssetConstraint {
    pub role: RuntimeStrategyAssetRole,
    pub asset_keys: Vec<String>,
    pub required: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStrategyFeatureRequirement {
    pub feature_key: String,
    pub required: bool,
    pub freshness_ms: Option<u64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStrategyParameterSpec {
    pub key: String,
    pub label: String,
    pub kind: RuntimeStrategyParameterKind,
    pub required: bool,
    pub default_value: Option<String>,
    pub min_value: Option<String>,
    pub max_value: Option<String>,
    pub allowed_values: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStrategyPromotionPolicy {
    pub requires_human_approval: bool,
    pub shadow_min_runs: u32,
    pub paper_min_runs: u32,
    pub live_lane_allowlist: Vec<RuntimeLane>,
    pub requires_fresh_features: bool,
    pub limited_live_only: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStrategySpec {
    pub schema_version: String,
    pub strategy_key: String,
    pub title: String,
    pub summary: String,
    pub category: RuntimeStrategyCategory,
    pub plugin_key: String,
    pub default_lane: RuntimeLane,
    pub supported_modes: Vec<RuntimeMode>,
    pub lane_eligibility: Vec<RuntimeLane>,
    pub supported_venues: Vec<RuntimeStrategyVenueSupport>,
    pub asset_constraints: Vec<RuntimeStrategyAssetConstraint>,
    pub feature_requirements: Vec<RuntimeStrategyFeatureRequirement>,
    pub parameter_specs: Vec<RuntimeStrategyParameterSpec>,
    pub promotion_policy: RuntimeStrategyPromotionPolicy,
    pub tags: Vec<String>,
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
        let hypothesis: RuntimeResearchHypothesisRecord =
            serde_json::from_str(&read_fixture("runtime.research_hypothesis.valid.v1.json"))
                .expect("research hypothesis fixture to deserialize");
        let source: RuntimeResearchSourceRecord =
            serde_json::from_str(&read_fixture("runtime.research_source.valid.v1.json"))
                .expect("research source fixture to deserialize");
        let experiment: RuntimeResearchExperimentRecord =
            serde_json::from_str(&read_fixture("runtime.research_experiment.valid.v1.json"))
                .expect("research experiment fixture to deserialize");
        let evidence: RuntimeResearchEvidenceBundleRecord = serde_json::from_str(&read_fixture(
            "runtime.research_evidence_bundle.valid.v1.json",
        ))
        .expect("research evidence bundle fixture to deserialize");
        let strategy_spec: RuntimeStrategySpec =
            serde_json::from_str(&read_fixture("runtime.strategy_spec.valid.v1.json"))
                .expect("strategy spec fixture to deserialize");

        assert_eq!(deployment.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(run.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(ledger.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(verdict.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(plan.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(
            reconciliation.schema_version,
            RUNTIME_PROTOCOL_SCHEMA_VERSION
        );
        assert_eq!(hypothesis.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(source.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(experiment.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(evidence.schema_version, RUNTIME_PROTOCOL_SCHEMA_VERSION);
        assert_eq!(
            strategy_spec.schema_version,
            RUNTIME_PROTOCOL_SCHEMA_VERSION
        );
        assert_eq!(plan.slices.len(), 1);
        assert_eq!(experiment.dataset_snapshots.len(), 1);
        assert_eq!(evidence.artifacts.len(), 2);
        assert_eq!(strategy_spec.strategy_key, "trend_following");
    }

    #[test]
    fn enforces_transition_guards() {
        assert!(RuntimeDeploymentState::Draft.can_transition_to(&RuntimeDeploymentState::Shadow,));
        assert!(!RuntimeDeploymentState::Live.can_transition_to(&RuntimeDeploymentState::Draft,));
        assert!(RuntimeRunState::Pending.can_transition_to(&RuntimeRunState::RiskChecked,));
        assert!(!RuntimeRunState::Completed.can_transition_to(&RuntimeRunState::Planned,));
    }
}
