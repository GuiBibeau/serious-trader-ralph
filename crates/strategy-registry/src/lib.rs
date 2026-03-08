use std::{
    fs,
    path::{Path, PathBuf},
};

use feature_cache::{DerivedMarketFeatureSnapshot, FeatureCacheSnapshot};
use protocol::{
    RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeMode, RuntimeRunRecord,
    RuntimeRunState, RuntimeTrigger, RuntimeTriggerKind, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strategy_core::SUPPORTED_STRATEGIES;
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
    #[error("feature stream missing for pair {symbol}")]
    FeatureStreamMissing { symbol: String },
    #[error("feature stream stale for pair {symbol}: {reasons}")]
    FeatureStreamStale { symbol: String, reasons: String },
    #[error("invalid observedAt timestamp: {0}")]
    InvalidObservedAt(String),
}

impl StrategyRegistry {
    pub fn new(config: StrategyRegistryConfig) -> Result<Self, StrategyRegistryError> {
        let database_path = normalize_database_path(&config.database_url);
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let registry = Self { database_path };
        let connection = registry.open_connection()?;
        initialize_schema(&connection)?;
        Ok(registry)
    }

    pub fn upsert_deployment(
        &self,
        deployment: &RuntimeDeploymentRecord,
    ) -> Result<DeploymentWriteResult, StrategyRegistryError> {
        ensure_supported_strategy(&deployment.strategy_key)?;

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

        let feature_snapshot =
            select_feature_snapshot(feature_cache_snapshot, &deployment.pair.symbol)?;
        if feature_snapshot.stale {
            return Err(StrategyRegistryError::FeatureStreamStale {
                symbol: deployment.pair.symbol.clone(),
                reasons: feature_snapshot.stale_reasons.join(","),
            });
        }

        let trigger = build_runtime_trigger(trigger, &feature_snapshot)?;
        let run_key = build_run_key(deployment_id, &trigger);
        if let Some(existing_run) = load_run_by_key(&transaction, &run_key)? {
            transaction.commit()?;
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
            state: RuntimeRunState::Planned,
            planned_at: feature_snapshot.observed_at.clone(),
            updated_at: now_rfc3339(),
            risk_verdict_id: None,
            execution_plan_id: None,
            submit_request_id: None,
            receipt_id: None,
            failure_code: None,
            failure_message: None,
        };

        persist_run(&transaction, &run)?;
        transaction.commit()?;

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

fn ensure_supported_strategy(strategy_key: &str) -> Result<(), StrategyRegistryError> {
    if SUPPORTED_STRATEGIES
        .iter()
        .any(|strategy| strategy.as_key() == strategy_key)
    {
        return Ok(());
    }
    Err(StrategyRegistryError::UnsupportedStrategy(
        strategy_key.to_string(),
    ))
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
    use protocol::{RuntimeCapital, RuntimeLane, RuntimePair, RuntimePolicy};

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
        assert_eq!(
            registry
                .list_runs("deployment_shadow")
                .expect("runs to load")
                .len(),
            1
        );
    }

    #[test]
    fn rejects_stale_feature_streams() {
        let registry = registry("stale");
        registry
            .upsert_deployment(&deployment(
                "deployment_stale",
                RuntimeMode::Shadow,
                RuntimeDeploymentState::Shadow,
            ))
            .expect("deployment to store");

        let error = registry
            .evaluate_shadow_trigger("deployment_stale", &feature_cache_snapshot(true), None)
            .expect_err("stale feature stream should fail");

        assert!(matches!(
            error,
            StrategyRegistryError::FeatureStreamStale { .. }
        ));
    }
}
