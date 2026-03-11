use std::{
    fs,
    path::{Path, PathBuf},
};

use feature_cache::{DerivedMarketFeatureSnapshot, FeatureCacheSnapshot};
use protocol::{
    RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeMode, RuntimeRiskDecision,
    RuntimeRiskVerdict, RuntimeRunRecord, RuntimeRunState, RuntimeTrigger, RuntimeTriggerKind,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strategy_core::{StrategyCatalog, StrategyCatalogError, VenueCatalog, VenueCatalogError};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyRegistryConfig {
    pub database_url: String,
}

impl StrategyRegistryConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct StrategyRegistry {
    database_path: PathBuf,
    strategy_catalog: StrategyCatalog,
    venue_catalog: VenueCatalog,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyRegistrySnapshot {
    pub status: String,
    pub deployment_count: u64,
    pub run_count: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowEvaluationTrigger {
    pub kind: RuntimeTriggerKind,
    pub source: String,
    pub observed_at: Option<String>,
    pub feature_snapshot_id: Option<String>,
    pub reason: Option<String>,
}

impl Default for ShadowEvaluationTrigger {
    fn default() -> Self {
        Self {
            kind: RuntimeTriggerKind::Signal,
            source: "strategy-registry".to_string(),
            observed_at: None,
            feature_snapshot_id: None,
            reason: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowEvaluationResult {
    pub deployment: RuntimeDeploymentRecord,
    pub run: RuntimeRunRecord,
    pub created: bool,
    pub feature_snapshot: DerivedMarketFeatureSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeploymentWriteResult {
    pub deployment: RuntimeDeploymentRecord,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum StrategyRegistryError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("deployment {deployment_id} not found")]
    DeploymentNotFound { deployment_id: String },
    #[error("unsupported strategy key: {0}")]
    UnsupportedStrategy(String),
    #[error("strategy {strategy_key} does not support venue {venue_key}")]
    StrategyVenueUnsupported {
        strategy_key: String,
        venue_key: String,
    },
    #[error(transparent)]
    StrategyCatalog(#[from] StrategyCatalogError),
    #[error(transparent)]
    VenueCatalog(#[from] VenueCatalogError),
    #[error("immutable deployment field changed for {deployment_id}: {field}")]
    ImmutableFieldChanged {
        deployment_id: String,
        field: &'static str,
    },
    #[error("invalid deployment transition for {deployment_id}: {from_state:?} -> {to_state:?}")]
    InvalidStateTransition {
        deployment_id: String,
        from_state: RuntimeDeploymentState,
        to_state: RuntimeDeploymentState,
    },
    #[error("deployment {deployment_id} must be in shadow state to evaluate, found {state:?}")]
    DeploymentNotShadow {
        deployment_id: String,
        state: RuntimeDeploymentState,
    },
    #[error("deployment {deployment_id} is not runnable, found {state:?}")]
    DeploymentNotRunnable {
        deployment_id: String,
        state: RuntimeDeploymentState,
    },
    #[error("feature stream missing for pair {symbol}")]
    FeatureStreamMissing { symbol: String },
    #[error("feature stream stale for pair {symbol}: {reasons}")]
    FeatureStreamStale { symbol: String, reasons: String },
    #[error("invalid observedAt timestamp: {0}")]
    InvalidObservedAt(String),
    #[error("run {run_id} not found")]
    RunNotFound { run_id: String },
    #[error("invalid run transition for {run_id}: {from_state:?} -> {to_state:?}")]
    InvalidRunStateTransition {
        run_id: String,
        from_state: RuntimeRunState,
        to_state: RuntimeRunState,
    },
}

impl StrategyRegistry {
    pub fn new(config: StrategyRegistryConfig) -> Result<Self, StrategyRegistryError> {
        Self::with_catalogs(
            config,
            StrategyCatalog::builtin()?,
            VenueCatalog::builtin()?,
        )
    }

    pub fn with_catalog(
        config: StrategyRegistryConfig,
        strategy_catalog: StrategyCatalog,
    ) -> Result<Self, StrategyRegistryError> {
        Self::with_catalogs(config, strategy_catalog, VenueCatalog::builtin()?)
    }

    pub fn with_catalogs(
        config: StrategyRegistryConfig,
        strategy_catalog: StrategyCatalog,
        venue_catalog: VenueCatalog,
    ) -> Result<Self, StrategyRegistryError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(
            requested_path.clone(),
            strategy_catalog.clone(),
            venue_catalog.clone(),
        ) {
            Ok(registry) => Ok(registry),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path(), strategy_catalog, venue_catalog)
            }
            Err(error) => Err(error),
        }
    }

    #[must_use]
    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    #[must_use]
    pub fn supported_strategy_keys(&self) -> Vec<String> {
        self.strategy_catalog.keys()
    }

    pub fn upsert_deployment(
        &self,
        deployment: &RuntimeDeploymentRecord,
    ) -> Result<DeploymentWriteResult, StrategyRegistryError> {
        ensure_supported_strategy(&self.strategy_catalog, &deployment.strategy_key)?;
        ensure_supported_venue(&self.strategy_catalog, &self.venue_catalog, deployment)?;

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let existing = load_deployment(&transaction, &deployment.deployment_id)?;

        if let Some(existing_deployment) = existing.as_ref() {
            ensure_immutable_deployment_fields(existing_deployment, deployment)?;
            if existing_deployment.state != deployment.state
                && !existing_deployment
                    .state
                    .can_transition_to(&deployment.state)
            {
                return Err(StrategyRegistryError::InvalidStateTransition {
                    deployment_id: deployment.deployment_id.clone(),
                    from_state: existing_deployment.state.clone(),
                    to_state: deployment.state.clone(),
                });
            }
        }

        persist_deployment(&transaction, deployment)?;
        transaction.commit()?;

        Ok(DeploymentWriteResult {
            deployment: deployment.clone(),
            created: existing.is_none(),
        })
    }

    pub fn get_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<Option<RuntimeDeploymentRecord>, StrategyRegistryError> {
        let connection = self.open_connection()?;
        load_deployment(&connection, deployment_id)
    }

    pub fn list_deployments(&self) -> Result<Vec<RuntimeDeploymentRecord>, StrategyRegistryError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT record_json
             FROM deployments
             ORDER BY updated_at DESC, deployment_id DESC",
        )?;

        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut deployments = Vec::new();
        for row in rows {
            deployments.push(deserialize_json(&row?)?);
        }

        Ok(deployments)
    }

    pub fn transition_deployment(
        &self,
        deployment_id: &str,
        next_state: RuntimeDeploymentState,
    ) -> Result<RuntimeDeploymentRecord, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut deployment = load_deployment(&transaction, deployment_id)?.ok_or_else(|| {
            StrategyRegistryError::DeploymentNotFound {
                deployment_id: deployment_id.to_string(),
            }
        })?;

        if deployment.state != next_state && !deployment.state.can_transition_to(&next_state) {
            return Err(StrategyRegistryError::InvalidStateTransition {
                deployment_id: deployment_id.to_string(),
                from_state: deployment.state.clone(),
                to_state: next_state,
            });
        }

        let now = now_rfc3339();
        deployment.state = next_state.clone();
        deployment.updated_at = now.clone();
        if next_state == RuntimeDeploymentState::Paused {
            deployment.paused_at = Some(now.clone());
        }
        if next_state == RuntimeDeploymentState::Killed {
            deployment.killed_at = Some(now.clone());
        }
        if matches!(
            next_state,
            RuntimeDeploymentState::Paper | RuntimeDeploymentState::Live
        ) {
            deployment.promoted_at = Some(now);
        }

        persist_deployment(&transaction, &deployment)?;
        transaction.commit()?;

        Ok(deployment)
    }

    pub fn delete_deployment(&self, deployment_id: &str) -> Result<bool, StrategyRegistryError> {
        let connection = self.open_connection()?;
        let deleted = connection.execute(
            "DELETE FROM deployments WHERE deployment_id = ?1",
            params![deployment_id],
        )?;
        Ok(deleted > 0)
    }

    pub fn list_runs(
        &self,
        deployment_id: &str,
    ) -> Result<Vec<RuntimeRunRecord>, StrategyRegistryError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT record_json
             FROM runs
             WHERE deployment_id = ?1
             ORDER BY planned_at DESC, updated_at DESC, run_id DESC",
        )?;

        let rows = statement.query_map(params![deployment_id], |row| row.get::<_, String>(0))?;
        let mut runs = Vec::new();
        for row in rows {
            runs.push(deserialize_json(&row?)?);
        }

        Ok(runs)
    }

    pub fn get_run(&self, run_id: &str) -> Result<Option<RuntimeRunRecord>, StrategyRegistryError> {
        let connection = self.open_connection()?;
        load_run(&connection, run_id)
    }

    pub fn apply_risk_verdict(
        &self,
        verdict: &RuntimeRiskVerdict,
    ) -> Result<RuntimeRunRecord, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut run = load_run(&transaction, &verdict.run_id)?.ok_or_else(|| {
            StrategyRegistryError::RunNotFound {
                run_id: verdict.run_id.clone(),
            }
        })?;

        if run.risk_verdict_id.as_deref() == Some(verdict.verdict_id.as_str())
            && run_state_matches_verdict(&run.state, &verdict.verdict)
        {
            transaction.commit()?;
            return Ok(run);
        }

        match verdict.verdict {
            RuntimeRiskDecision::Allow => {
                if run.state == RuntimeRunState::Pending {
                    transition_run_state(&mut run, RuntimeRunState::RiskChecked)?;
                }
                if run.state == RuntimeRunState::RiskChecked {
                    transition_run_state(&mut run, RuntimeRunState::Planned)?;
                }
            }
            RuntimeRiskDecision::Reject => {
                transition_run_state(&mut run, RuntimeRunState::Rejected)?;
            }
            RuntimeRiskDecision::Pause => {
                transition_run_state(&mut run, RuntimeRunState::Killed)?;
            }
        }

        run.risk_verdict_id = Some(verdict.verdict_id.clone());
        run.updated_at = now_rfc3339();
        if verdict.verdict == RuntimeRiskDecision::Allow {
            run.failure_code = None;
            run.failure_message = None;
        } else if let Some(reason) = verdict.reasons.first() {
            run.failure_code = Some(reason.code.clone());
            run.failure_message = Some(reason.message.clone());
        }

        update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn apply_execution_plan(
        &self,
        run_id: &str,
        plan_id: &str,
        submit_request_id: &str,
    ) -> Result<RuntimeRunRecord, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut run =
            load_run(&transaction, run_id)?.ok_or_else(|| StrategyRegistryError::RunNotFound {
                run_id: run_id.to_string(),
            })?;

        if run.execution_plan_id.as_deref() == Some(plan_id) && execution_state_matches(&run.state)
        {
            transaction.commit()?;
            return Ok(run);
        }

        run.execution_plan_id = Some(plan_id.to_string());
        run.submit_request_id = Some(submit_request_id.to_string());
        transition_run_state(&mut run, RuntimeRunState::Submitted)?;
        run.updated_at = now_rfc3339();
        run.failure_code = None;
        run.failure_message = None;

        update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn apply_noop_execution_plan(
        &self,
        run_id: &str,
        plan_id: &str,
    ) -> Result<RuntimeRunRecord, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut run =
            load_run(&transaction, run_id)?.ok_or_else(|| StrategyRegistryError::RunNotFound {
                run_id: run_id.to_string(),
            })?;

        if run.execution_plan_id.as_deref() == Some(plan_id)
            && run.state == RuntimeRunState::Completed
        {
            transaction.commit()?;
            return Ok(run);
        }

        run.execution_plan_id = Some(plan_id.to_string());
        run.submit_request_id = None;
        transition_run_state(&mut run, RuntimeRunState::Completed)?;
        run.updated_at = now_rfc3339();
        run.failure_code = None;
        run.failure_message = None;

        update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn apply_receipt(
        &self,
        run_id: &str,
        receipt_id: &str,
    ) -> Result<RuntimeRunRecord, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut run =
            load_run(&transaction, run_id)?.ok_or_else(|| StrategyRegistryError::RunNotFound {
                run_id: run_id.to_string(),
            })?;

        if run.receipt_id.as_deref() == Some(receipt_id) && receipt_state_matches(&run.state) {
            transaction.commit()?;
            return Ok(run);
        }

        run.receipt_id = Some(receipt_id.to_string());
        transition_run_state(&mut run, RuntimeRunState::ReceiptPending)?;
        run.updated_at = now_rfc3339();
        run.failure_code = None;
        run.failure_message = None;

        update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn apply_reconciliation_result(
        &self,
        run_id: &str,
        status: protocol::RuntimeReconciliationStatus,
        failure_code: Option<&str>,
        failure_message: Option<&str>,
    ) -> Result<RuntimeRunRecord, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let mut run =
            load_run(&transaction, run_id)?.ok_or_else(|| StrategyRegistryError::RunNotFound {
                run_id: run_id.to_string(),
            })?;

        if reconciliation_state_matches(&run.state, &status) {
            transaction.commit()?;
            return Ok(run);
        }

        match status {
            protocol::RuntimeReconciliationStatus::Passed => {
                transition_run_state(&mut run, RuntimeRunState::Reconciled)?;
                transition_run_state(&mut run, RuntimeRunState::Completed)?;
                run.failure_code = None;
                run.failure_message = None;
            }
            protocol::RuntimeReconciliationStatus::NeedsManualReview => {
                transition_run_state(&mut run, RuntimeRunState::Reconciled)?;
                transition_run_state(&mut run, RuntimeRunState::NeedsManualReview)?;
                run.failure_code = Some(
                    failure_code
                        .unwrap_or("reconciliation-needs-manual-review")
                        .to_string(),
                );
                run.failure_message = Some(
                    failure_message
                        .unwrap_or("reconciliation requires manual review")
                        .to_string(),
                );
            }
            protocol::RuntimeReconciliationStatus::Failed => {
                transition_run_state(&mut run, RuntimeRunState::Failed)?;
                run.failure_code =
                    Some(failure_code.unwrap_or("reconciliation-failed").to_string());
                run.failure_message = Some(
                    failure_message
                        .unwrap_or("reconciliation failed")
                        .to_string(),
                );
            }
        }
        run.updated_at = now_rfc3339();

        update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(run)
    }

    pub fn evaluate_shadow_trigger(
        &self,
        deployment_id: &str,
        feature_cache_snapshot: &FeatureCacheSnapshot,
        trigger: Option<ShadowEvaluationTrigger>,
    ) -> Result<ShadowEvaluationResult, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let deployment = load_deployment(&transaction, deployment_id)?.ok_or_else(|| {
            StrategyRegistryError::DeploymentNotFound {
                deployment_id: deployment_id.to_string(),
            }
        })?;

        if deployment.state != RuntimeDeploymentState::Shadow {
            return Err(StrategyRegistryError::DeploymentNotShadow {
                deployment_id: deployment_id.to_string(),
                state: deployment.state,
            });
        }

        let result = self.evaluate_trigger_with_deployment(
            &transaction,
            deployment,
            feature_cache_snapshot,
            trigger,
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn evaluate_deployment_trigger(
        &self,
        deployment_id: &str,
        feature_cache_snapshot: &FeatureCacheSnapshot,
        trigger: Option<ShadowEvaluationTrigger>,
    ) -> Result<ShadowEvaluationResult, StrategyRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let deployment = load_deployment(&transaction, deployment_id)?.ok_or_else(|| {
            StrategyRegistryError::DeploymentNotFound {
                deployment_id: deployment_id.to_string(),
            }
        })?;

        if !deployment_is_runnable(&deployment.state) {
            return Err(StrategyRegistryError::DeploymentNotRunnable {
                deployment_id: deployment_id.to_string(),
                state: deployment.state,
            });
        }

        let result = self.evaluate_trigger_with_deployment(
            &transaction,
            deployment,
            feature_cache_snapshot,
            trigger,
        )?;
        transaction.commit()?;
        Ok(result)
    }

    fn evaluate_trigger_with_deployment(
        &self,
        transaction: &Connection,
        deployment: RuntimeDeploymentRecord,
        feature_cache_snapshot: &FeatureCacheSnapshot,
        trigger: Option<ShadowEvaluationTrigger>,
    ) -> Result<ShadowEvaluationResult, StrategyRegistryError> {
        let deployment_id = deployment.deployment_id.clone();

        let feature_snapshot =
            select_feature_snapshot(feature_cache_snapshot, &deployment.pair.symbol)?;
        let trigger = build_runtime_trigger(trigger, &feature_snapshot)?;
        let run_key = build_run_key(&deployment_id, &trigger);
        if let Some(existing_run) = load_run_by_key(transaction, &run_key)? {
            return Ok(ShadowEvaluationResult {
                deployment,
                run: existing_run,
                created: false,
                feature_snapshot,
            });
        }

        let run = RuntimeRunRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            run_id: build_run_id(&run_key),
            deployment_id: deployment_id.to_string(),
            run_key: run_key.clone(),
            trigger,
            state: RuntimeRunState::Pending,
            planned_at: feature_snapshot.observed_at.clone(),
            updated_at: now_rfc3339(),
            risk_verdict_id: None,
            execution_plan_id: None,
            submit_request_id: None,
            receipt_id: None,
            failure_code: None,
            failure_message: None,
        };

        persist_run(transaction, &run)?;

        Ok(ShadowEvaluationResult {
            deployment,
            run,
            created: true,
            feature_snapshot,
        })
    }

    #[must_use]
    pub fn snapshot_now(&self) -> StrategyRegistrySnapshot {
        match self.snapshot_counts() {
            Ok((deployment_count, run_count)) => StrategyRegistrySnapshot {
                status: "healthy".to_string(),
                deployment_count,
                run_count,
                last_error: None,
            },
            Err(error) => StrategyRegistrySnapshot {
                status: "degraded".to_string(),
                deployment_count: 0,
                run_count: 0,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<(u64, u64), StrategyRegistryError> {
        let connection = self.open_connection()?;
        let deployment_count =
            connection.query_row("SELECT COUNT(*) FROM deployments", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let run_count =
            connection.query_row("SELECT COUNT(*) FROM runs", [], |row| row.get::<_, u64>(0))?;
        Ok((deployment_count, run_count))
    }

    fn open_connection(&self) -> Result<Connection, StrategyRegistryError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(
        database_path: PathBuf,
        strategy_catalog: StrategyCatalog,
        venue_catalog: VenueCatalog,
    ) -> Result<Self, StrategyRegistryError> {
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let registry = Self {
            database_path,
            strategy_catalog,
            venue_catalog,
        };
        let connection = registry.open_connection()?;
        initialize_schema(&connection)?;
        Ok(registry)
    }
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return PathBuf::from(".tmp/runtime-rs/strategy-registry.sqlite3");
    }
    if let Some(stripped) = trimmed.strip_prefix("sqlite://") {
        return PathBuf::from(stripped);
    }
    if let Some(stripped) = trimmed.strip_prefix("file:") {
        return PathBuf::from(stripped);
    }
    PathBuf::from(trimmed)
}

fn fallback_database_path() -> PathBuf {
    std::env::temp_dir()
        .join("runtime-rs")
        .join("strategy-registry.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &StrategyRegistryError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path() {
        return false;
    }

    match error {
        StrategyRegistryError::Io(inner) => inner.kind() == std::io::ErrorKind::PermissionDenied,
        StrategyRegistryError::Storage(inner) => {
            matches!(
                inner,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::CannotOpen
            )
        }
        StrategyRegistryError::Serialization(_)
        | StrategyRegistryError::DeploymentNotFound { .. }
        | StrategyRegistryError::UnsupportedStrategy(_)
        | StrategyRegistryError::StrategyVenueUnsupported { .. }
        | StrategyRegistryError::StrategyCatalog(_)
        | StrategyRegistryError::VenueCatalog(_)
        | StrategyRegistryError::ImmutableFieldChanged { .. }
        | StrategyRegistryError::InvalidStateTransition { .. }
        | StrategyRegistryError::DeploymentNotShadow { .. }
        | StrategyRegistryError::DeploymentNotRunnable { .. }
        | StrategyRegistryError::FeatureStreamMissing { .. }
        | StrategyRegistryError::FeatureStreamStale { .. }
        | StrategyRegistryError::InvalidObservedAt(_)
        | StrategyRegistryError::RunNotFound { .. }
        | StrategyRegistryError::InvalidRunStateTransition { .. } => false,
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS deployments (
            deployment_id TEXT PRIMARY KEY,
            strategy_key TEXT NOT NULL,
            sleeve_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            state TEXT NOT NULL,
            pair_symbol TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_key TEXT NOT NULL UNIQUE,
            planned_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL,
            FOREIGN KEY (deployment_id) REFERENCES deployments(deployment_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_runs_deployment_planned_at
            ON runs (deployment_id, planned_at DESC, updated_at DESC);",
    )
}

fn ensure_supported_strategy(
    strategy_catalog: &StrategyCatalog,
    strategy_key: &str,
) -> Result<(), StrategyRegistryError> {
    strategy_catalog
        .get(strategy_key)
        .map(|_| ())
        .ok_or_else(|| StrategyRegistryError::UnsupportedStrategy(strategy_key.to_string()))
}

fn ensure_supported_venue(
    strategy_catalog: &StrategyCatalog,
    venue_catalog: &VenueCatalog,
    deployment: &RuntimeDeploymentRecord,
) -> Result<(), StrategyRegistryError> {
    let strategy_spec = strategy_catalog.require(&deployment.strategy_key)?;
    if !strategy_spec
        .supported_venues
        .iter()
        .any(|support| support.venue_key == deployment.venue_key)
    {
        return Err(StrategyRegistryError::StrategyVenueUnsupported {
            strategy_key: deployment.strategy_key.clone(),
            venue_key: deployment.venue_key.clone(),
        });
    }
    venue_catalog.ensure_mode_supported(&deployment.venue_key, &deployment.mode)?;
    Ok(())
}

fn deployment_is_runnable(state: &RuntimeDeploymentState) -> bool {
    matches!(
        state,
        RuntimeDeploymentState::Shadow
            | RuntimeDeploymentState::Paper
            | RuntimeDeploymentState::Live
    )
}

fn ensure_immutable_deployment_fields(
    existing: &RuntimeDeploymentRecord,
    incoming: &RuntimeDeploymentRecord,
) -> Result<(), StrategyRegistryError> {
    if existing.strategy_key != incoming.strategy_key {
        return Err(StrategyRegistryError::ImmutableFieldChanged {
            deployment_id: incoming.deployment_id.clone(),
            field: "strategyKey",
        });
    }
    if existing.sleeve_id != incoming.sleeve_id {
        return Err(StrategyRegistryError::ImmutableFieldChanged {
            deployment_id: incoming.deployment_id.clone(),
            field: "sleeveId",
        });
    }
    if existing.owner_user_id != incoming.owner_user_id {
        return Err(StrategyRegistryError::ImmutableFieldChanged {
            deployment_id: incoming.deployment_id.clone(),
            field: "ownerUserId",
        });
    }
    if existing.pair != incoming.pair {
        return Err(StrategyRegistryError::ImmutableFieldChanged {
            deployment_id: incoming.deployment_id.clone(),
            field: "pair",
        });
    }
    if existing.mode != incoming.mode {
        return Err(StrategyRegistryError::ImmutableFieldChanged {
            deployment_id: incoming.deployment_id.clone(),
            field: "mode",
        });
    }
    if existing.venue_key != incoming.venue_key {
        return Err(StrategyRegistryError::ImmutableFieldChanged {
            deployment_id: incoming.deployment_id.clone(),
            field: "venueKey",
        });
    }
    Ok(())
}

fn persist_deployment(
    connection: &Connection,
    deployment: &RuntimeDeploymentRecord,
) -> Result<(), StrategyRegistryError> {
    connection.execute(
        "INSERT INTO deployments (
            deployment_id,
            strategy_key,
            sleeve_id,
            owner_user_id,
            mode,
            state,
            pair_symbol,
            updated_at,
            record_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(deployment_id) DO UPDATE SET
            strategy_key = excluded.strategy_key,
            sleeve_id = excluded.sleeve_id,
            owner_user_id = excluded.owner_user_id,
            mode = excluded.mode,
            state = excluded.state,
            pair_symbol = excluded.pair_symbol,
            updated_at = excluded.updated_at,
            record_json = excluded.record_json",
        params![
            &deployment.deployment_id,
            &deployment.strategy_key,
            &deployment.sleeve_id,
            &deployment.owner_user_id,
            state_mode_key(&deployment.mode),
            state_key(&deployment.state),
            &deployment.pair.symbol,
            &deployment.updated_at,
            serialize_json(deployment)?,
        ],
    )?;
    Ok(())
}

fn load_deployment(
    connection: &Connection,
    deployment_id: &str,
) -> Result<Option<RuntimeDeploymentRecord>, StrategyRegistryError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM deployments WHERE deployment_id = ?1",
            params![deployment_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn persist_run(
    connection: &Connection,
    run: &RuntimeRunRecord,
) -> Result<(), StrategyRegistryError> {
    connection.execute(
        "INSERT INTO runs (
            run_id,
            deployment_id,
            run_key,
            planned_at,
            updated_at,
            record_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &run.run_id,
            &run.deployment_id,
            &run.run_key,
            &run.planned_at,
            &run.updated_at,
            serialize_json(run)?,
        ],
    )?;
    Ok(())
}

fn update_run(
    connection: &Connection,
    run: &RuntimeRunRecord,
) -> Result<(), StrategyRegistryError> {
    connection.execute(
        "UPDATE runs
         SET deployment_id = ?2,
             run_key = ?3,
             planned_at = ?4,
             updated_at = ?5,
             record_json = ?6
         WHERE run_id = ?1",
        params![
            &run.run_id,
            &run.deployment_id,
            &run.run_key,
            &run.planned_at,
            &run.updated_at,
            serialize_json(run)?,
        ],
    )?;
    Ok(())
}

fn load_run(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeRunRecord>, StrategyRegistryError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM runs WHERE run_id = ?1",
            params![run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn load_run_by_key(
    connection: &Connection,
    run_key: &str,
) -> Result<Option<RuntimeRunRecord>, StrategyRegistryError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM runs WHERE run_key = ?1",
            params![run_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn transition_run_state(
    run: &mut RuntimeRunRecord,
    next_state: RuntimeRunState,
) -> Result<(), StrategyRegistryError> {
    if run.state == next_state {
        return Ok(());
    }
    if !run.state.can_transition_to(&next_state) {
        return Err(StrategyRegistryError::InvalidRunStateTransition {
            run_id: run.run_id.clone(),
            from_state: run.state.clone(),
            to_state: next_state,
        });
    }
    run.state = next_state;
    Ok(())
}

fn run_state_matches_verdict(state: &RuntimeRunState, verdict: &RuntimeRiskDecision) -> bool {
    matches!(
        (state, verdict),
        (RuntimeRunState::Planned, RuntimeRiskDecision::Allow)
            | (RuntimeRunState::Submitted, RuntimeRiskDecision::Allow)
            | (RuntimeRunState::ReceiptPending, RuntimeRiskDecision::Allow)
            | (
                RuntimeRunState::NeedsManualReview,
                RuntimeRiskDecision::Allow
            )
            | (RuntimeRunState::Completed, RuntimeRiskDecision::Allow)
            | (RuntimeRunState::Rejected, RuntimeRiskDecision::Reject)
            | (RuntimeRunState::Killed, RuntimeRiskDecision::Pause)
    )
}

fn execution_state_matches(state: &RuntimeRunState) -> bool {
    matches!(
        state,
        RuntimeRunState::Submitted
            | RuntimeRunState::ReceiptPending
            | RuntimeRunState::Completed
            | RuntimeRunState::NeedsManualReview
    )
}

fn receipt_state_matches(state: &RuntimeRunState) -> bool {
    matches!(
        state,
        RuntimeRunState::ReceiptPending
            | RuntimeRunState::Completed
            | RuntimeRunState::NeedsManualReview
    )
}

fn reconciliation_state_matches(
    state: &RuntimeRunState,
    status: &protocol::RuntimeReconciliationStatus,
) -> bool {
    matches!(
        (state, status),
        (
            RuntimeRunState::Completed,
            protocol::RuntimeReconciliationStatus::Passed
        ) | (
            RuntimeRunState::NeedsManualReview,
            protocol::RuntimeReconciliationStatus::NeedsManualReview,
        ) | (
            RuntimeRunState::Failed,
            protocol::RuntimeReconciliationStatus::Failed
        )
    )
}

fn select_feature_snapshot(
    feature_cache_snapshot: &FeatureCacheSnapshot,
    symbol: &str,
) -> Result<DerivedMarketFeatureSnapshot, StrategyRegistryError> {
    feature_cache_snapshot
        .feature_streams
        .iter()
        .filter(|snapshot| snapshot.symbol == symbol)
        .max_by_key(|snapshot| snapshot.last_sequence)
        .cloned()
        .ok_or_else(|| StrategyRegistryError::FeatureStreamMissing {
            symbol: symbol.to_string(),
        })
}

fn build_runtime_trigger(
    trigger: Option<ShadowEvaluationTrigger>,
    feature_snapshot: &DerivedMarketFeatureSnapshot,
) -> Result<RuntimeTrigger, StrategyRegistryError> {
    let trigger = trigger.unwrap_or_default();
    let observed_at = trigger
        .observed_at
        .unwrap_or_else(|| feature_snapshot.observed_at.clone());
    OffsetDateTime::parse(&observed_at, &Rfc3339)
        .map_err(|_| StrategyRegistryError::InvalidObservedAt(observed_at.clone()))?;

    Ok(RuntimeTrigger {
        kind: trigger.kind,
        source: if trigger.source.trim().is_empty() {
            "strategy-registry".to_string()
        } else {
            trigger.source
        },
        observed_at,
        feature_snapshot_id: Some(
            trigger
                .feature_snapshot_id
                .unwrap_or_else(|| feature_snapshot_identity(feature_snapshot)),
        ),
        reason: Some(
            trigger
                .reason
                .unwrap_or_else(|| "shadow-feature-evaluation".to_string()),
        ),
    })
}

fn build_run_key(deployment_id: &str, trigger: &RuntimeTrigger) -> String {
    let identity = trigger
        .feature_snapshot_id
        .as_deref()
        .unwrap_or(trigger.observed_at.as_str());
    format!(
        "{deployment_id}:{identity}:{}",
        trigger_kind_key(&trigger.kind)
    )
}

fn build_run_id(run_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(run_key.as_bytes());
    let digest = hasher.finalize();
    let hex = hex_encode(&digest[..12]);
    format!("run_{hex}")
}

fn feature_snapshot_identity(feature_snapshot: &DerivedMarketFeatureSnapshot) -> String {
    format!(
        "{}:{}:{}",
        feature_snapshot.cache_key, feature_snapshot.last_sequence, feature_snapshot.observed_at
    )
}

fn state_key(state: &RuntimeDeploymentState) -> &'static str {
    match state {
        RuntimeDeploymentState::Draft => "draft",
        RuntimeDeploymentState::Shadow => "shadow",
        RuntimeDeploymentState::Paper => "paper",
        RuntimeDeploymentState::Live => "live",
        RuntimeDeploymentState::Paused => "paused",
        RuntimeDeploymentState::Killed => "killed",
        RuntimeDeploymentState::Archived => "archived",
    }
}

fn state_mode_key(mode: &RuntimeMode) -> &'static str {
    match mode {
        RuntimeMode::Shadow => "shadow",
        RuntimeMode::Paper => "paper",
        RuntimeMode::Live => "live",
    }
}

fn trigger_kind_key(kind: &RuntimeTriggerKind) -> &'static str {
    match kind {
        RuntimeTriggerKind::Cron => "cron",
        RuntimeTriggerKind::Signal => "signal",
        RuntimeTriggerKind::Rebalance => "rebalance",
        RuntimeTriggerKind::Operator => "operator",
        RuntimeTriggerKind::Canary => "canary",
    }
}

fn serialize_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

fn deserialize_json<T: DeserializeOwned>(raw: &str) -> Result<T, serde_json::Error> {
    serde_json::from_str(raw)
}

fn hex_encode(input: &[u8]) -> String {
    let mut output = String::with_capacity(input.len() * 2);
    for byte in input {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("current time to format")
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use protocol::{
        RuntimeCapital, RuntimeLane, RuntimePair, RuntimePolicy, RuntimeVenueMarketType,
    };
    use strategy_core::{StrategyCatalog, StrategyKind};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("strategy-registry-{test_name}-{unique}.sqlite3"))
            .display()
            .to_string()
    }

    fn registry(test_name: &str) -> StrategyRegistry {
        StrategyRegistry::new(StrategyRegistryConfig::new(temp_database_url(test_name)))
            .expect("registry to initialize")
    }

    fn custom_catalog(strategy_key: &str) -> StrategyCatalog {
        let mut catalog = StrategyCatalog::default();
        let mut spec = StrategyKind::Dca.spec();
        spec.strategy_key = strategy_key.to_string();
        spec.plugin_key = format!("test::{strategy_key}");
        spec.title = "Custom strategy".to_string();
        catalog.register_spec(spec).expect("custom spec");
        catalog
    }

    #[cfg(unix)]
    #[test]
    fn falls_back_to_tmp_when_requested_path_is_not_writable() {
        let root = std::env::temp_dir().join(format!(
            "strategy-registry-perms-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("root directory");
        let blocked = root.join("blocked");
        fs::create_dir_all(&blocked).expect("blocked directory");
        let original_permissions = fs::metadata(&blocked).expect("metadata").permissions();
        let mut readonly_permissions = original_permissions.clone();
        readonly_permissions.set_mode(0o500);
        fs::set_permissions(&blocked, readonly_permissions).expect("permissions to set");

        let requested_path = blocked.join("registry.sqlite3");
        let registry = StrategyRegistry::new(StrategyRegistryConfig::new(
            requested_path.display().to_string(),
        ))
        .expect("registry to initialize");

        assert_ne!(registry.database_path(), requested_path.as_path());
        assert_eq!(registry.database_path(), fallback_database_path().as_path());

        fs::set_permissions(&blocked, original_permissions).expect("permissions to restore");
        fs::remove_dir_all(&root).expect("temporary directory cleanup");
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
            created_at: "2026-03-07T00:00:00.000Z".to_string(),
            updated_at: "2026-03-07T00:00:00.000Z".to_string(),
            promoted_at: None,
            paused_at: None,
            killed_at: None,
            policy: RuntimePolicy {
                max_notional_usd: "250.00".to_string(),
                daily_loss_limit_usd: "35.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 2,
                rebalance_tolerance_bps: 100,
            },
            capital: RuntimeCapital {
                allocated_usd: "1000.00".to_string(),
                reserved_usd: "125.00".to_string(),
                available_usd: "875.00".to_string(),
            },
            tags: vec!["test".to_string()],
        }
    }

    fn feature_cache_snapshot(stale: bool) -> FeatureCacheSnapshot {
        FeatureCacheSnapshot {
            status: if stale {
                "degraded".to_string()
            } else {
                "healthy".to_string()
            },
            freshness: feature_cache::FeatureFreshnessContracts {
                feature_stale_after_ms: 20_000,
                slot_stale_after_ms: 15_000,
                max_slot_gap: 2,
                short_window_ms: 10_000,
                long_window_ms: 25_000,
                volatility_window_size: 4,
                max_samples_per_stream: 64,
            },
            feature_streams: vec![DerivedMarketFeatureSnapshot {
                cache_key: "fixture:SOL/USDC".to_string(),
                symbol: "SOL/USDC".to_string(),
                source: "fixture".to_string(),
                last_sequence: 42,
                observed_at: "2026-03-07T00:00:05.000Z".to_string(),
                age_ms: 100,
                stale,
                stale_reasons: if stale {
                    vec!["feature_age_exceeded".to_string()]
                } else {
                    Vec::new()
                },
                sample_count: 4,
                window_short_ms: 10_000,
                window_long_ms: 25_000,
                mid_price_usd: "142.00".to_string(),
                bid_price_usd: Some("141.95".to_string()),
                ask_price_usd: Some("142.05".to_string()),
                spread_bps: Some("7.04".to_string()),
                short_return_bps: Some("12.00".to_string()),
                long_return_bps: Some("18.00".to_string()),
                realized_volatility_bps: Some("9.00".to_string()),
                processed_slot: Some(321),
                slot_age_ms: Some(20),
                slot_gap: Some(0),
                last_ingest_lag_ms: 10,
            }],
            stale_feature_keys: if stale {
                vec!["fixture:SOL/USDC".to_string()]
            } else {
                Vec::new()
            },
            max_feature_age_ms: 100,
            max_slot_age_ms: 20,
            max_slot_gap_observed: 0,
            max_ingest_lag_ms: 10,
            total_market_samples: 4,
            last_error: None,
        }
    }

    #[test]
    fn stores_and_fetches_deployments() {
        let registry = registry("store-deployment");
        let deployment = deployment(
            "deployment_store",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Draft,
        );

        let result = registry
            .upsert_deployment(&deployment)
            .expect("deployment to store");

        assert!(result.created);
        assert_eq!(
            registry
                .get_deployment("deployment_store")
                .expect("deployment lookup")
                .expect("deployment to exist"),
            deployment
        );
    }

    #[test]
    fn accepts_deployments_from_custom_catalog() {
        let registry = StrategyRegistry::with_catalog(
            StrategyRegistryConfig::new(temp_database_url("custom-catalog")),
            custom_catalog("custom_signal"),
        )
        .expect("registry to initialize");
        let mut deployment = deployment(
            "deployment_custom",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Draft,
        );
        deployment.strategy_key = "custom_signal".to_string();

        let result = registry
            .upsert_deployment(&deployment)
            .expect("custom deployment to store");

        assert!(result.created);
        assert_eq!(
            registry.supported_strategy_keys(),
            vec!["custom_signal".to_string()]
        );
    }

    #[test]
    fn enforces_state_transitions() {
        let registry = registry("transition");
        let deployment = deployment(
            "deployment_transition",
            RuntimeMode::Shadow,
            RuntimeDeploymentState::Killed,
        );
        registry
            .upsert_deployment(&deployment)
            .expect("deployment to store");

        let error = registry
            .transition_deployment("deployment_transition", RuntimeDeploymentState::Live)
            .expect_err("transition should fail");

        assert!(matches!(
            error,
            StrategyRegistryError::InvalidStateTransition { .. }
        ));
    }

    #[test]
    fn creates_deterministic_shadow_runs_and_prevents_duplicates() {
        let registry = registry("duplicates");
        registry
            .upsert_deployment(&deployment(
                "deployment_shadow",
                RuntimeMode::Shadow,
                RuntimeDeploymentState::Shadow,
            ))
            .expect("deployment to store");

        let first = registry
            .evaluate_shadow_trigger("deployment_shadow", &feature_cache_snapshot(false), None)
            .expect("first evaluation");
        let second = registry
            .evaluate_shadow_trigger("deployment_shadow", &feature_cache_snapshot(false), None)
            .expect("second evaluation");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(first.run.run_key, second.run.run_key);
        assert_eq!(first.run.run_id, second.run.run_id);
        assert_eq!(first.run.state, RuntimeRunState::Pending);
        assert_eq!(
            registry
                .list_runs("deployment_shadow")
                .expect("runs to load")
                .len(),
            1
        );
    }

    #[test]
    fn allows_stale_feature_streams_to_progress_to_risk_checks() {
        let registry = registry("stale");
        registry
            .upsert_deployment(&deployment(
                "deployment_stale",
                RuntimeMode::Shadow,
                RuntimeDeploymentState::Shadow,
            ))
            .expect("deployment to store");

        let result = registry
            .evaluate_shadow_trigger("deployment_stale", &feature_cache_snapshot(true), None)
            .expect("stale feature stream should still create a pending run");

        assert!(result.feature_snapshot.stale);
        assert_eq!(result.run.state, RuntimeRunState::Pending);
        assert!(result.run.risk_verdict_id.is_none());
    }

    #[test]
    fn evaluates_live_deployments_through_the_general_trigger_path() {
        let registry = registry("live-evaluation");
        registry
            .upsert_deployment(&deployment(
                "deployment_live",
                RuntimeMode::Live,
                RuntimeDeploymentState::Live,
            ))
            .expect("deployment to store");

        let result = registry
            .evaluate_deployment_trigger(
                "deployment_live",
                &feature_cache_snapshot(false),
                Some(ShadowEvaluationTrigger {
                    kind: RuntimeTriggerKind::Canary,
                    source: "runtime-canary".to_string(),
                    observed_at: Some("2026-03-08T12:00:00.000Z".to_string()),
                    feature_snapshot_id: Some("snapshot_live".to_string()),
                    reason: Some("limited-live-canary".to_string()),
                }),
            )
            .expect("live evaluation to create a run");

        assert!(result.created);
        assert_eq!(result.deployment.state, RuntimeDeploymentState::Live);
        assert_eq!(result.run.trigger.kind, RuntimeTriggerKind::Canary);
        assert_eq!(result.run.state, RuntimeRunState::Pending);
    }

    #[test]
    fn rejects_non_runnable_deployments_from_general_evaluation() {
        let registry = registry("paused-evaluation");
        registry
            .upsert_deployment(&deployment(
                "deployment_paused",
                RuntimeMode::Live,
                RuntimeDeploymentState::Paused,
            ))
            .expect("deployment to store");

        let error = registry
            .evaluate_deployment_trigger("deployment_paused", &feature_cache_snapshot(false), None)
            .expect_err("paused deployment should not evaluate");

        assert!(matches!(
            error,
            StrategyRegistryError::DeploymentNotRunnable { .. }
        ));
    }

    #[test]
    fn applies_risk_verdicts_to_runs() {
        let registry = registry("risk-verdict");
        registry
            .upsert_deployment(&deployment(
                "deployment_shadow",
                RuntimeMode::Shadow,
                RuntimeDeploymentState::Shadow,
            ))
            .expect("deployment to store");

        let evaluation = registry
            .evaluate_shadow_trigger("deployment_shadow", &feature_cache_snapshot(false), None)
            .expect("run to create");
        let planned = registry
            .apply_risk_verdict(&RuntimeRiskVerdict {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                verdict_id: "risk_allow".to_string(),
                deployment_id: "deployment_shadow".to_string(),
                run_id: evaluation.run.run_id.clone(),
                decided_at: "2026-03-07T00:00:06.000Z".to_string(),
                verdict: RuntimeRiskDecision::Allow,
                reasons: Vec::new(),
                observed: protocol::RuntimeRiskObserved {
                    requested_notional_usd: "5.00".to_string(),
                    reserved_usd: "5.00".to_string(),
                    concentration_bps: 500,
                    feature_age_ms: 100,
                },
                limits: protocol::RuntimeRiskLimits {
                    max_notional_usd: "25.00".to_string(),
                    max_reserved_usd: "50.00".to_string(),
                    max_concentration_bps: 3500,
                    stale_after_ms: 20_000,
                },
            })
            .expect("allow verdict to apply");

        assert_eq!(planned.state, RuntimeRunState::Planned);
        assert_eq!(planned.risk_verdict_id.as_deref(), Some("risk_allow"));

        let rejected = registry
            .apply_risk_verdict(&RuntimeRiskVerdict {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                verdict_id: "risk_reject".to_string(),
                deployment_id: "deployment_shadow".to_string(),
                run_id: registry
                    .evaluate_shadow_trigger(
                        "deployment_shadow",
                        &feature_cache_snapshot(false),
                        Some(ShadowEvaluationTrigger {
                            observed_at: Some("2026-03-07T00:02:00.000Z".to_string()),
                            feature_snapshot_id: Some("snapshot_2".to_string()),
                            ..ShadowEvaluationTrigger::default()
                        }),
                    )
                    .expect("second run to create")
                    .run
                    .run_id,
                decided_at: "2026-03-07T00:02:01.000Z".to_string(),
                verdict: RuntimeRiskDecision::Reject,
                reasons: vec![protocol::RuntimeRiskReason {
                    code: "cooldown_active".to_string(),
                    message: "cooldown".to_string(),
                    severity: protocol::RuntimeRiskSeverity::Warn,
                }],
                observed: protocol::RuntimeRiskObserved {
                    requested_notional_usd: "5.00".to_string(),
                    reserved_usd: "5.00".to_string(),
                    concentration_bps: 500,
                    feature_age_ms: 100,
                },
                limits: protocol::RuntimeRiskLimits {
                    max_notional_usd: "25.00".to_string(),
                    max_reserved_usd: "50.00".to_string(),
                    max_concentration_bps: 3500,
                    stale_after_ms: 20_000,
                },
            })
            .expect("reject verdict to apply");

        assert_eq!(rejected.state, RuntimeRunState::Rejected);
        assert_eq!(rejected.failure_code.as_deref(), Some("cooldown_active"));
    }

    #[test]
    fn applies_execution_plans_to_allowed_runs() {
        let registry = registry("execution-plan");
        registry
            .upsert_deployment(&deployment(
                "deployment_shadow",
                RuntimeMode::Shadow,
                RuntimeDeploymentState::Shadow,
            ))
            .expect("deployment to store");

        let evaluation = registry
            .evaluate_shadow_trigger("deployment_shadow", &feature_cache_snapshot(false), None)
            .expect("run to create");
        let planned = registry
            .apply_risk_verdict(&RuntimeRiskVerdict {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                verdict_id: "risk_allow".to_string(),
                deployment_id: "deployment_shadow".to_string(),
                run_id: evaluation.run.run_id.clone(),
                decided_at: "2026-03-07T00:00:06.000Z".to_string(),
                verdict: RuntimeRiskDecision::Allow,
                reasons: Vec::new(),
                observed: protocol::RuntimeRiskObserved {
                    requested_notional_usd: "5.00".to_string(),
                    reserved_usd: "5.00".to_string(),
                    concentration_bps: 500,
                    feature_age_ms: 100,
                },
                limits: protocol::RuntimeRiskLimits {
                    max_notional_usd: "25.00".to_string(),
                    max_reserved_usd: "50.00".to_string(),
                    max_concentration_bps: 3500,
                    stale_after_ms: 20_000,
                },
            })
            .expect("allow verdict to apply");

        let submitted = registry
            .apply_execution_plan(&planned.run_id, "plan_123", "submit_123")
            .expect("plan to apply");
        let receipt_pending = registry
            .apply_receipt(&planned.run_id, "receipt_123")
            .expect("receipt to apply");
        let completed = registry
            .apply_reconciliation_result(
                &planned.run_id,
                protocol::RuntimeReconciliationStatus::Passed,
                None,
                None,
            )
            .expect("reconciliation to apply");

        assert_eq!(submitted.state, RuntimeRunState::Submitted);
        assert_eq!(submitted.submit_request_id.as_deref(), Some("submit_123"));
        assert_eq!(receipt_pending.state, RuntimeRunState::ReceiptPending);
        assert_eq!(receipt_pending.receipt_id.as_deref(), Some("receipt_123"));
        assert_eq!(completed.state, RuntimeRunState::Completed);
        assert_eq!(completed.execution_plan_id.as_deref(), Some("plan_123"));
    }

    #[test]
    fn deletes_deployments_and_associated_runs() {
        let registry = registry("delete");
        registry
            .upsert_deployment(&deployment(
                "deployment_delete",
                RuntimeMode::Shadow,
                RuntimeDeploymentState::Shadow,
            ))
            .expect("deployment to store");
        registry
            .evaluate_shadow_trigger("deployment_delete", &feature_cache_snapshot(false), None)
            .expect("run to store");

        let deleted = registry
            .delete_deployment("deployment_delete")
            .expect("deployment to delete");

        assert!(deleted);
        assert!(registry
            .get_deployment("deployment_delete")
            .expect("lookup to succeed")
            .is_none());
        assert!(registry
            .list_runs("deployment_delete")
            .expect("runs lookup to succeed")
            .is_empty());
    }
}
