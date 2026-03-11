use std::{
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeDatasetSnapshotRef, RuntimeDeploymentRecord, RuntimeExecutionCostAssumptions,
    RuntimeExecutionCostCalibration, RuntimeExecutionCostDriftGuard,
    RuntimeExecutionCostModelRecord, RuntimeExecutionCostModelStatus,
    RuntimeExecutionCostObservationRecord, RuntimeMode, RuntimeVenueLatencyProfile,
    RuntimeVenueMarketType, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SEED_TIMESTAMP: &str = "2026-03-10T00:00:00.000Z";
const FIXTURE_URI: &str =
    "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostModelRegistryConfig {
    pub database_url: String,
}

impl CostModelRegistryConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct CostModelRegistry {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostModelRegistrySnapshot {
    pub status: String,
    pub model_count: u64,
    pub active_model_count: u64,
    pub observation_count: u64,
    pub latest_model_updated_at: Option<String>,
    pub latest_observation_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CostModelRegistryQuery {
    pub model_id: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub pair_symbol: Option<String>,
    pub market_type: Option<RuntimeVenueMarketType>,
    pub mode: Option<RuntimeMode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostModelWriteResult {
    pub record: RuntimeExecutionCostModelRecord,
    pub created: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CostObservationQuery {
    pub observation_id: Option<String>,
    pub model_id: Option<String>,
    pub deployment_id: Option<String>,
    pub run_id: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub pair_symbol: Option<String>,
    pub market_type: Option<RuntimeVenueMarketType>,
    pub mode: Option<RuntimeMode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CostObservationWriteResult {
    pub record: RuntimeExecutionCostObservationRecord,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum CostModelRegistryError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid execution cost model {model_id}: {reason}")]
    InvalidModel { model_id: String, reason: String },
    #[error(
        "execution cost model {model_id} references missing dataset snapshot {dataset_id}/{snapshot_id}"
    )]
    DatasetSnapshotMissing {
        model_id: String,
        dataset_id: String,
        snapshot_id: String,
    },
    #[error("execution cost model {model_id} not found")]
    ModelNotFound { model_id: String },
    #[error("invalid execution cost observation {observation_id}: {reason}")]
    InvalidObservation {
        observation_id: String,
        reason: String,
    },
    #[error(
        "execution cost observation {observation_id} is incompatible with model {model_id}: {reason}"
    )]
    ObservationModelMismatch {
        observation_id: String,
        model_id: String,
        reason: String,
    },
}

impl CostModelRegistry {
    pub fn new(config: CostModelRegistryConfig) -> Result<Self, CostModelRegistryError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(registry) => Ok(registry),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn upsert_model(
        &self,
        record: &RuntimeExecutionCostModelRecord,
    ) -> Result<CostModelWriteResult, CostModelRegistryError> {
        validate_cost_model(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_snapshot_refs_exist(&transaction, record)?;
        let existing = load_model(&transaction, &record.model_id)?;
        persist_model(&transaction, record)?;
        transaction.commit()?;
        Ok(CostModelWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn query(
        &self,
        query: &CostModelRegistryQuery,
    ) -> Result<Vec<RuntimeExecutionCostModelRecord>, CostModelRegistryError> {
        let connection = self.open_connection()?;
        list_models(&connection, query)
    }

    pub fn select_for_deployment(
        &self,
        deployment: &RuntimeDeploymentRecord,
    ) -> Result<Option<RuntimeExecutionCostModelRecord>, CostModelRegistryError> {
        let mut models = self.query(&CostModelRegistryQuery {
            venue_key: Some(deployment.venue_key.clone()),
            pair_symbol: Some(deployment.pair.symbol.clone()),
            market_type: Some(deployment.pair.market_type.clone()),
            mode: Some(deployment.mode.clone()),
            ..CostModelRegistryQuery::default()
        })?;
        models.retain(|model| model.status == RuntimeExecutionCostModelStatus::Active);
        models.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(models.into_iter().next())
    }

    pub fn upsert_observation(
        &self,
        record: &RuntimeExecutionCostObservationRecord,
    ) -> Result<CostObservationWriteResult, CostModelRegistryError> {
        validate_cost_observation(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let model = load_model(&transaction, &record.model_id)?.ok_or_else(|| {
            CostModelRegistryError::ModelNotFound {
                model_id: record.model_id.clone(),
            }
        })?;
        ensure_observation_matches_model(record, &model)?;
        let existing = load_observation(&transaction, &record.observation_id)?;
        persist_observation(&transaction, record)?;
        transaction.commit()?;
        Ok(CostObservationWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn query_observations(
        &self,
        query: &CostObservationQuery,
    ) -> Result<Vec<RuntimeExecutionCostObservationRecord>, CostModelRegistryError> {
        let connection = self.open_connection()?;
        list_observations(&connection, query)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> CostModelRegistrySnapshot {
        match self.snapshot_counts() {
            Ok(snapshot) => snapshot,
            Err(error) => CostModelRegistrySnapshot {
                status: "degraded".to_string(),
                model_count: 0,
                active_model_count: 0,
                observation_count: 0,
                latest_model_updated_at: None,
                latest_observation_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<CostModelRegistrySnapshot, CostModelRegistryError> {
        let connection = self.open_connection()?;
        let model_count =
            connection.query_row("SELECT COUNT(*) FROM execution_cost_models", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let active_model_count = connection.query_row(
            "SELECT COUNT(*) FROM execution_cost_models WHERE status = 'active'",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let observation_count = connection.query_row(
            "SELECT COUNT(*) FROM execution_cost_observations",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let latest_model_updated_at = connection
            .query_row(
                "SELECT updated_at
                 FROM execution_cost_models
                 ORDER BY updated_at DESC, model_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let latest_observation_at = connection
            .query_row(
                "SELECT observed_at
                 FROM execution_cost_observations
                 ORDER BY observed_at DESC, observation_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(CostModelRegistrySnapshot {
            status: "healthy".to_string(),
            model_count,
            active_model_count,
            observation_count,
            latest_model_updated_at,
            latest_observation_at,
            last_error: None,
        })
    }

    fn initialize_at_path(path: PathBuf) -> Result<Self, CostModelRegistryError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let registry = Self {
            database_path: path.clone(),
        };
        let connection = registry.open_connection()?;
        initialize_schema(&connection)?;
        registry.seed_builtin_models()?;
        Ok(registry)
    }

    fn seed_builtin_models(&self) -> Result<(), CostModelRegistryError> {
        for model in builtin_models() {
            let _ = self.upsert_model(&model)?;
        }
        Ok(())
    }

    fn open_connection(&self) -> Result<Connection, CostModelRegistryError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(connection)
    }
}

fn builtin_models() -> Vec<RuntimeExecutionCostModelRecord> {
    vec![
        RuntimeExecutionCostModelRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            model_id: "cost_model_jupiter_sol_usdc_spot".to_string(),
            venue_key: "jupiter".to_string(),
            market_type: RuntimeVenueMarketType::Spot,
            pair_symbol: "SOL/USDC".to_string(),
            instrument_id: Some("SOL/USDC".to_string()),
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            mode_coverage: vec![RuntimeMode::Shadow, RuntimeMode::Paper, RuntimeMode::Live],
            status: RuntimeExecutionCostModelStatus::Active,
            assumptions: RuntimeExecutionCostAssumptions {
                fee_bps: 8,
                slippage_bps: 22,
                market_impact_bps: 12,
                partial_fill_rate_bps: 50,
                partial_fill_penalty_bps: 12,
                financing_cost_bps_per_day: None,
            },
            calibration: RuntimeExecutionCostCalibration {
                calibration_id: "calibration_jupiter_sol_usdc_spot_seed".to_string(),
                methodology: "seed_replay_bootstrap".to_string(),
                sample_start_at: "2026-03-07T00:00:00.000Z".to_string(),
                sample_end_at: "2026-03-10T00:00:00.000Z".to_string(),
                sample_count: 240,
                confidence_bps: 8_600,
                reference_notional_usd: "25.00".to_string(),
                tags: vec!["seed".to_string(), "bootstrap".to_string()],
                notes: Some(
                    "Bootstrap calibration from the checked-in SOL/USDC replay corpus.".to_string(),
                ),
            },
            drift_guard: RuntimeExecutionCostDriftGuard {
                max_cost_drift_bps: 90,
                max_latency_drift_ms: 8_000,
                max_reconciliation_drift_usd: "1.50".to_string(),
            },
            latency_profile: RuntimeVenueLatencyProfile {
                expected_quote_ms: 250,
                expected_submit_ms: 750,
                expected_settlement_ms: 5_000,
            },
            dataset_snapshots: builtin_snapshot_refs(),
            created_at: SEED_TIMESTAMP.to_string(),
            updated_at: SEED_TIMESTAMP.to_string(),
            tags: vec!["seed".to_string(), "spot".to_string(), "broad_live".to_string()],
            notes: Some("Bootstrap Jupiter SOL/USDC spot cost model from the checked-in replay corpus.".to_string()),
        },
        RuntimeExecutionCostModelRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            model_id: "cost_model_magicblock_sol_usdc_spot".to_string(),
            venue_key: "magicblock".to_string(),
            market_type: RuntimeVenueMarketType::Spot,
            pair_symbol: "SOL/USDC".to_string(),
            instrument_id: Some("SOL/USDC".to_string()),
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            mode_coverage: vec![RuntimeMode::Shadow, RuntimeMode::Paper],
            status: RuntimeExecutionCostModelStatus::Active,
            assumptions: RuntimeExecutionCostAssumptions {
                fee_bps: 6,
                slippage_bps: 18,
                market_impact_bps: 8,
                partial_fill_rate_bps: 25,
                partial_fill_penalty_bps: 8,
                financing_cost_bps_per_day: None,
            },
            calibration: RuntimeExecutionCostCalibration {
                calibration_id: "calibration_magicblock_sol_usdc_spot_seed".to_string(),
                methodology: "seed_replay_bootstrap".to_string(),
                sample_start_at: "2026-03-07T00:00:00.000Z".to_string(),
                sample_end_at: "2026-03-10T00:00:00.000Z".to_string(),
                sample_count: 180,
                confidence_bps: 8_100,
                reference_notional_usd: "25.00".to_string(),
                tags: vec!["seed".to_string(), "bootstrap".to_string()],
                notes: Some(
                    "Bootstrap calibration pending venue-specific paper observations.".to_string(),
                ),
            },
            drift_guard: RuntimeExecutionCostDriftGuard {
                max_cost_drift_bps: 80,
                max_latency_drift_ms: 6_000,
                max_reconciliation_drift_usd: "1.25".to_string(),
            },
            latency_profile: RuntimeVenueLatencyProfile {
                expected_quote_ms: 200,
                expected_submit_ms: 400,
                expected_settlement_ms: 3_000,
            },
            dataset_snapshots: builtin_snapshot_refs(),
            created_at: SEED_TIMESTAMP.to_string(),
            updated_at: SEED_TIMESTAMP.to_string(),
            tags: vec!["seed".to_string(), "spot".to_string(), "paper_ready".to_string()],
            notes: Some("Bootstrap MagicBlock SOL/USDC spot cost model pending venue-specific replay coverage.".to_string()),
        },
        RuntimeExecutionCostModelRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            model_id: "cost_model_phoenix_sol_usdc_spot".to_string(),
            venue_key: "phoenix".to_string(),
            market_type: RuntimeVenueMarketType::Spot,
            pair_symbol: "SOL/USDC".to_string(),
            instrument_id: Some("SOL/USDC".to_string()),
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            mode_coverage: vec![RuntimeMode::Shadow, RuntimeMode::Paper],
            status: RuntimeExecutionCostModelStatus::Active,
            assumptions: RuntimeExecutionCostAssumptions {
                fee_bps: 4,
                slippage_bps: 10,
                market_impact_bps: 6,
                partial_fill_rate_bps: 125,
                partial_fill_penalty_bps: 10,
                financing_cost_bps_per_day: None,
            },
            calibration: RuntimeExecutionCostCalibration {
                calibration_id: "calibration_phoenix_sol_usdc_spot_seed".to_string(),
                methodology: "seed_replay_bootstrap".to_string(),
                sample_start_at: "2026-03-07T00:00:00.000Z".to_string(),
                sample_end_at: "2026-03-10T00:00:00.000Z".to_string(),
                sample_count: 160,
                confidence_bps: 7_900,
                reference_notional_usd: "25.00".to_string(),
                tags: vec!["seed".to_string(), "bootstrap".to_string()],
                notes: Some(
                    "Bootstrap calibration seeded for shadow and paper evaluation.".to_string(),
                ),
            },
            drift_guard: RuntimeExecutionCostDriftGuard {
                max_cost_drift_bps: 70,
                max_latency_drift_ms: 5_000,
                max_reconciliation_drift_usd: "1.00".to_string(),
            },
            latency_profile: RuntimeVenueLatencyProfile {
                expected_quote_ms: 150,
                expected_submit_ms: 350,
                expected_settlement_ms: 4_000,
            },
            dataset_snapshots: builtin_snapshot_refs(),
            created_at: SEED_TIMESTAMP.to_string(),
            updated_at: SEED_TIMESTAMP.to_string(),
            tags: vec!["seed".to_string(), "spot".to_string(), "candidate".to_string()],
            notes: Some("Bootstrap Phoenix SOL/USDC spot cost model seeded for shadow and paper evaluation.".to_string()),
        },
    ]
}

fn builtin_snapshot_refs() -> Vec<RuntimeDatasetSnapshotRef> {
    vec![
        RuntimeDatasetSnapshotRef {
            dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
            snapshot_id: "snapshot_2026_03_07_seed".to_string(),
            captured_at: SEED_TIMESTAMP.to_string(),
            uri: Some(format!("{FIXTURE_URI}#marketEvents")),
            content_digest: Some("sha256:fixture".to_string()),
        },
        RuntimeDatasetSnapshotRef {
            dataset_id: "dataset_feed_replay_sol_usdc_slot_events".to_string(),
            snapshot_id: "snapshot_2026_03_07_seed".to_string(),
            captured_at: SEED_TIMESTAMP.to_string(),
            uri: Some(format!("{FIXTURE_URI}#slotEvents")),
            content_digest: Some("sha256:fixture".to_string()),
        },
    ]
}

fn validate_cost_model(
    record: &RuntimeExecutionCostModelRecord,
) -> Result<(), CostModelRegistryError> {
    if record.model_id.trim().is_empty() {
        return Err(CostModelRegistryError::InvalidModel {
            model_id: record.model_id.clone(),
            reason: "modelId must not be empty".to_string(),
        });
    }
    if record.asset_keys.is_empty()
        || record.mode_coverage.is_empty()
        || record.dataset_snapshots.is_empty()
    {
        return Err(CostModelRegistryError::InvalidModel {
            model_id: record.model_id.clone(),
            reason: "assetKeys, modeCoverage, and datasetSnapshots must not be empty".to_string(),
        });
    }
    if record.calibration.sample_count == 0 {
        return Err(CostModelRegistryError::InvalidModel {
            model_id: record.model_id.clone(),
            reason: "calibration.sampleCount must be positive".to_string(),
        });
    }
    if record.calibration.reference_notional_usd.trim().is_empty() {
        return Err(CostModelRegistryError::InvalidModel {
            model_id: record.model_id.clone(),
            reason: "calibration.referenceNotionalUsd must not be empty".to_string(),
        });
    }
    Ok(())
}

fn validate_cost_observation(
    record: &RuntimeExecutionCostObservationRecord,
) -> Result<(), CostModelRegistryError> {
    if record.observation_id.trim().is_empty()
        || record.model_id.trim().is_empty()
        || record.deployment_id.trim().is_empty()
        || record.run_id.trim().is_empty()
        || record.receipt_id.trim().is_empty()
        || record.pair_symbol.trim().is_empty()
        || record.asset_keys.is_empty()
    {
        return Err(CostModelRegistryError::InvalidObservation {
            observation_id: record.observation_id.clone(),
            reason:
                "observationId, modelId, deploymentId, runId, receiptId, pairSymbol, and assetKeys must be present"
                    .to_string(),
        });
    }
    Ok(())
}

fn ensure_observation_matches_model(
    record: &RuntimeExecutionCostObservationRecord,
    model: &RuntimeExecutionCostModelRecord,
) -> Result<(), CostModelRegistryError> {
    if record.venue_key != model.venue_key
        || record.market_type != model.market_type
        || record.pair_symbol != model.pair_symbol
        || record.asset_keys != model.asset_keys
    {
        return Err(CostModelRegistryError::ObservationModelMismatch {
            observation_id: record.observation_id.clone(),
            model_id: model.model_id.clone(),
            reason: "observation venue, marketType, pairSymbol, or assetKeys do not match the referenced model".to_string(),
        });
    }
    if !model.mode_coverage.contains(&record.mode) {
        return Err(CostModelRegistryError::ObservationModelMismatch {
            observation_id: record.observation_id.clone(),
            model_id: model.model_id.clone(),
            reason: "observation mode is not covered by the referenced model".to_string(),
        });
    }
    Ok(())
}

fn ensure_snapshot_refs_exist(
    connection: &Connection,
    record: &RuntimeExecutionCostModelRecord,
) -> Result<(), CostModelRegistryError> {
    for snapshot in &record.dataset_snapshots {
        let exists = connection
            .query_row(
                "SELECT record_json
                 FROM historical_dataset_snapshots
                 WHERE dataset_id = ?1 AND snapshot_id = ?2",
                params![snapshot.dataset_id, snapshot.snapshot_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(CostModelRegistryError::DatasetSnapshotMissing {
                model_id: record.model_id.clone(),
                dataset_id: snapshot.dataset_id.clone(),
                snapshot_id: snapshot.snapshot_id.clone(),
            });
        }
    }
    Ok(())
}

fn list_models(
    connection: &Connection,
    query: &CostModelRegistryQuery,
) -> Result<Vec<RuntimeExecutionCostModelRecord>, CostModelRegistryError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT m.record_json
         FROM execution_cost_models m
         LEFT JOIN execution_cost_model_assets a ON a.model_id = m.model_id
         LEFT JOIN execution_cost_model_modes o ON o.model_id = m.model_id
         WHERE (?1 IS NULL OR m.model_id = ?1)
           AND (?2 IS NULL OR m.venue_key = ?2)
           AND (?3 IS NULL OR a.asset_key = ?3)
           AND (?4 IS NULL OR m.pair_symbol = ?4)
           AND (?5 IS NULL OR m.market_type = ?5)
           AND (?6 IS NULL OR o.mode = ?6)
         ORDER BY m.updated_at DESC, m.model_id DESC",
    )?;
    let rows = statement.query_map(
        params![
            query.model_id.as_deref(),
            query.venue_key.as_deref(),
            query.asset_key.as_deref(),
            query.pair_symbol.as_deref(),
            query.market_type.as_ref().map(market_type_key),
            query.mode.as_ref().map(mode_key),
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn persist_model(
    connection: &Connection,
    record: &RuntimeExecutionCostModelRecord,
) -> Result<(), CostModelRegistryError> {
    connection.execute(
        "INSERT INTO execution_cost_models (
            model_id,
            venue_key,
            pair_symbol,
            market_type,
            status,
            updated_at,
            record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(model_id) DO UPDATE SET
            venue_key = excluded.venue_key,
            pair_symbol = excluded.pair_symbol,
            market_type = excluded.market_type,
            status = excluded.status,
            updated_at = excluded.updated_at,
            record_json = excluded.record_json",
        params![
            record.model_id,
            record.venue_key,
            record.pair_symbol,
            market_type_key(&record.market_type),
            status_key(&record.status),
            record.updated_at,
            serialize_json(record)?,
        ],
    )?;
    connection.execute(
        "DELETE FROM execution_cost_model_assets WHERE model_id = ?1",
        params![record.model_id],
    )?;
    for asset_key in &record.asset_keys {
        connection.execute(
            "INSERT INTO execution_cost_model_assets (model_id, asset_key) VALUES (?1, ?2)",
            params![record.model_id, asset_key],
        )?;
    }
    connection.execute(
        "DELETE FROM execution_cost_model_modes WHERE model_id = ?1",
        params![record.model_id],
    )?;
    for mode in &record.mode_coverage {
        connection.execute(
            "INSERT INTO execution_cost_model_modes (model_id, mode) VALUES (?1, ?2)",
            params![record.model_id, mode_key(mode)],
        )?;
    }
    Ok(())
}

fn load_model(
    connection: &Connection,
    model_id: &str,
) -> Result<Option<RuntimeExecutionCostModelRecord>, CostModelRegistryError> {
    connection
        .query_row(
            "SELECT record_json FROM execution_cost_models WHERE model_id = ?1",
            params![model_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn list_observations(
    connection: &Connection,
    query: &CostObservationQuery,
) -> Result<Vec<RuntimeExecutionCostObservationRecord>, CostModelRegistryError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT o.record_json
         FROM execution_cost_observations o
         LEFT JOIN execution_cost_observation_assets a
           ON a.observation_id = o.observation_id
         WHERE (?1 IS NULL OR o.observation_id = ?1)
           AND (?2 IS NULL OR o.model_id = ?2)
           AND (?3 IS NULL OR o.deployment_id = ?3)
           AND (?4 IS NULL OR o.run_id = ?4)
           AND (?5 IS NULL OR o.venue_key = ?5)
           AND (?6 IS NULL OR a.asset_key = ?6)
           AND (?7 IS NULL OR o.pair_symbol = ?7)
           AND (?8 IS NULL OR o.market_type = ?8)
           AND (?9 IS NULL OR o.mode = ?9)
         ORDER BY o.observed_at DESC, o.observation_id DESC",
    )?;
    let rows = statement.query_map(
        params![
            query.observation_id.as_deref(),
            query.model_id.as_deref(),
            query.deployment_id.as_deref(),
            query.run_id.as_deref(),
            query.venue_key.as_deref(),
            query.asset_key.as_deref(),
            query.pair_symbol.as_deref(),
            query.market_type.as_ref().map(market_type_key),
            query.mode.as_ref().map(mode_key),
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn persist_observation(
    connection: &Connection,
    record: &RuntimeExecutionCostObservationRecord,
) -> Result<(), CostModelRegistryError> {
    connection.execute(
        "INSERT INTO execution_cost_observations (
            observation_id,
            model_id,
            deployment_id,
            run_id,
            receipt_id,
            venue_key,
            pair_symbol,
            market_type,
            mode,
            observed_at,
            record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(observation_id) DO UPDATE SET
            model_id = excluded.model_id,
            deployment_id = excluded.deployment_id,
            run_id = excluded.run_id,
            receipt_id = excluded.receipt_id,
            venue_key = excluded.venue_key,
            pair_symbol = excluded.pair_symbol,
            market_type = excluded.market_type,
            mode = excluded.mode,
            observed_at = excluded.observed_at,
            record_json = excluded.record_json",
        params![
            record.observation_id,
            record.model_id,
            record.deployment_id,
            record.run_id,
            record.receipt_id,
            record.venue_key,
            record.pair_symbol,
            market_type_key(&record.market_type),
            mode_key(&record.mode),
            record.observed_at,
            serialize_json(record)?,
        ],
    )?;
    connection.execute(
        "DELETE FROM execution_cost_observation_assets WHERE observation_id = ?1",
        params![record.observation_id],
    )?;
    for asset_key in &record.asset_keys {
        connection.execute(
            "INSERT INTO execution_cost_observation_assets (observation_id, asset_key) VALUES (?1, ?2)",
            params![record.observation_id, asset_key],
        )?;
    }
    Ok(())
}

fn load_observation(
    connection: &Connection,
    observation_id: &str,
) -> Result<Option<RuntimeExecutionCostObservationRecord>, CostModelRegistryError> {
    connection
        .query_row(
            "SELECT record_json FROM execution_cost_observations WHERE observation_id = ?1",
            params![observation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn initialize_schema(connection: &Connection) -> Result<(), CostModelRegistryError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS execution_cost_models (
            model_id TEXT PRIMARY KEY,
            venue_key TEXT NOT NULL,
            pair_symbol TEXT NOT NULL,
            market_type TEXT NOT NULL,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_cost_model_assets (
            model_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (model_id, asset_key),
            FOREIGN KEY (model_id) REFERENCES execution_cost_models(model_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS execution_cost_model_modes (
            model_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            PRIMARY KEY (model_id, mode),
            FOREIGN KEY (model_id) REFERENCES execution_cost_models(model_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_execution_cost_models_lookup
            ON execution_cost_models (venue_key, pair_symbol, market_type, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_cost_model_assets_lookup
            ON execution_cost_model_assets (asset_key, model_id);
        CREATE INDEX IF NOT EXISTS idx_execution_cost_model_modes_lookup
            ON execution_cost_model_modes (mode, model_id);
        CREATE TABLE IF NOT EXISTS execution_cost_observations (
            observation_id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            receipt_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            pair_symbol TEXT NOT NULL,
            market_type TEXT NOT NULL,
            mode TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            record_json TEXT NOT NULL,
            FOREIGN KEY (model_id) REFERENCES execution_cost_models(model_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS execution_cost_observation_assets (
            observation_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (observation_id, asset_key),
            FOREIGN KEY (observation_id) REFERENCES execution_cost_observations(observation_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_execution_cost_observations_model
            ON execution_cost_observations (model_id, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_cost_observations_deployment
            ON execution_cost_observations (deployment_id, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_cost_observations_run
            ON execution_cost_observations (run_id, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_cost_observations_lookup
            ON execution_cost_observations (venue_key, pair_symbol, market_type, mode, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_execution_cost_observation_assets_lookup
            ON execution_cost_observation_assets (asset_key, observation_id);",
    )?;
    Ok(())
}

fn mode_key(mode: &RuntimeMode) -> &'static str {
    match mode {
        RuntimeMode::Shadow => "shadow",
        RuntimeMode::Paper => "paper",
        RuntimeMode::Live => "live",
    }
}

fn market_type_key(market_type: &RuntimeVenueMarketType) -> &'static str {
    match market_type {
        RuntimeVenueMarketType::Spot => "spot",
        RuntimeVenueMarketType::Perp => "perp",
        RuntimeVenueMarketType::Options => "options",
    }
}

fn status_key(status: &RuntimeExecutionCostModelStatus) -> &'static str {
    match status {
        RuntimeExecutionCostModelStatus::Draft => "draft",
        RuntimeExecutionCostModelStatus::Active => "active",
        RuntimeExecutionCostModelStatus::Deprecated => "deprecated",
    }
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    let without_scheme = trimmed
        .strip_prefix("sqlite://")
        .or_else(|| trimmed.strip_prefix("file:"))
        .unwrap_or(trimmed);
    let candidate = PathBuf::from(without_scheme);
    if candidate.is_absolute() {
        candidate
    } else {
        PathBuf::from(".").join(candidate)
    }
}

fn fallback_database_path() -> PathBuf {
    std::env::temp_dir().join("runtime-rs/cost-model-registry.sqlite3")
}

fn should_fallback_to_tmp(path: &Path, error: &CostModelRegistryError) -> bool {
    !path.starts_with(std::env::temp_dir()) && matches!(error, CostModelRegistryError::Io(_))
}

fn serialize_json<T>(value: &T) -> Result<String, CostModelRegistryError>
where
    T: Serialize,
{
    Ok(serde_json::to_string(value)?)
}

fn deserialize_json<T>(value: &str) -> Result<T, CostModelRegistryError>
where
    T: for<'de> Deserialize<'de>,
{
    Ok(serde_json::from_str(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(name: &str) -> CostModelRegistry {
        let database_url = format!(".tmp/tests/cost-model-registry/{name}.sqlite3");
        let path = PathBuf::from(&database_url);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent dir");
        }
        if path.exists() {
            fs::remove_file(&path).expect("existing test database cleanup");
        }
        let connection = Connection::open(&path).expect("connection");
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS historical_dataset_snapshots (
                    dataset_id TEXT NOT NULL,
                    snapshot_id TEXT NOT NULL,
                    dataset_kind TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    PRIMARY KEY (dataset_id, snapshot_id)
                );",
            )
            .expect("seed schema");
        connection
            .execute(
                "INSERT OR REPLACE INTO historical_dataset_snapshots (
                    dataset_id,
                    snapshot_id,
                    dataset_kind,
                    captured_at,
                    record_json
                ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    "dataset_feed_replay_sol_usdc_market_events",
                    "snapshot_2026_03_07_seed",
                    dataset_kind_key(&protocol::RuntimeHistoricalDatasetKind::MarketEvents),
                    SEED_TIMESTAMP,
                    "{}"
                ],
            )
            .expect("market snapshot");
        connection
            .execute(
                "INSERT OR REPLACE INTO historical_dataset_snapshots (
                    dataset_id,
                    snapshot_id,
                    dataset_kind,
                    captured_at,
                    record_json
                ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    "dataset_feed_replay_sol_usdc_slot_events",
                    "snapshot_2026_03_07_seed",
                    dataset_kind_key(&protocol::RuntimeHistoricalDatasetKind::SlotEvents),
                    SEED_TIMESTAMP,
                    "{}"
                ],
            )
            .expect("slot snapshot");
        CostModelRegistry::new(CostModelRegistryConfig::new(database_url)).expect("registry")
    }

    #[test]
    fn seeds_builtin_models() {
        let registry = registry("seed");
        let models = registry
            .query(&CostModelRegistryQuery {
                venue_key: Some("jupiter".to_string()),
                ..CostModelRegistryQuery::default()
            })
            .expect("query");
        assert!(models
            .iter()
            .any(|model| model.model_id == "cost_model_jupiter_sol_usdc_spot"));
        assert_eq!(registry.snapshot_now().active_model_count, 3);
    }

    #[test]
    fn selects_active_model_for_deployment() {
        let registry = registry("select");
        let deployment = RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "deployment_jupiter".to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_1".to_string(),
            venue_key: "jupiter".to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: RuntimeVenueMarketType::Spot,
            },
            mode: RuntimeMode::Paper,
            state: protocol::RuntimeDeploymentState::Paper,
            lane: protocol::RuntimeLane::Safe,
            created_at: SEED_TIMESTAMP.to_string(),
            updated_at: SEED_TIMESTAMP.to_string(),
            promoted_at: None,
            paused_at: None,
            killed_at: None,
            policy: protocol::RuntimePolicy {
                max_notional_usd: "25.00".to_string(),
                daily_loss_limit_usd: "10.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: protocol::RuntimeCapital {
                allocated_usd: "100.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "95.00".to_string(),
            },
            tags: vec!["test".to_string()],
        };
        let selected = registry
            .select_for_deployment(&deployment)
            .expect("selection")
            .expect("model");
        assert_eq!(selected.model_id, "cost_model_jupiter_sol_usdc_spot");
    }

    #[test]
    fn rejects_missing_dataset_references() {
        let registry = registry("missing-snapshot");
        let error = registry
            .upsert_model(&RuntimeExecutionCostModelRecord {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                model_id: "cost_model_missing_snapshot".to_string(),
                venue_key: "jupiter".to_string(),
                market_type: RuntimeVenueMarketType::Spot,
                pair_symbol: "SOL/USDC".to_string(),
                instrument_id: Some("SOL/USDC".to_string()),
                asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
                mode_coverage: vec![RuntimeMode::Shadow],
                status: RuntimeExecutionCostModelStatus::Draft,
                assumptions: RuntimeExecutionCostAssumptions {
                    fee_bps: 1,
                    slippage_bps: 1,
                    market_impact_bps: 1,
                    partial_fill_rate_bps: 1,
                    partial_fill_penalty_bps: 1,
                    financing_cost_bps_per_day: None,
                },
                calibration: RuntimeExecutionCostCalibration {
                    calibration_id: "calibration_missing_snapshot".to_string(),
                    methodology: "test_fixture".to_string(),
                    sample_start_at: SEED_TIMESTAMP.to_string(),
                    sample_end_at: SEED_TIMESTAMP.to_string(),
                    sample_count: 1,
                    confidence_bps: 10_000,
                    reference_notional_usd: "10.00".to_string(),
                    tags: vec!["test".to_string()],
                    notes: None,
                },
                drift_guard: RuntimeExecutionCostDriftGuard {
                    max_cost_drift_bps: 100,
                    max_latency_drift_ms: 1_000,
                    max_reconciliation_drift_usd: "1.00".to_string(),
                },
                latency_profile: RuntimeVenueLatencyProfile {
                    expected_quote_ms: 100,
                    expected_submit_ms: 100,
                    expected_settlement_ms: 100,
                },
                dataset_snapshots: vec![RuntimeDatasetSnapshotRef {
                    dataset_id: "dataset_missing".to_string(),
                    snapshot_id: "snapshot_missing".to_string(),
                    captured_at: SEED_TIMESTAMP.to_string(),
                    uri: None,
                    content_digest: None,
                }],
                created_at: SEED_TIMESTAMP.to_string(),
                updated_at: SEED_TIMESTAMP.to_string(),
                tags: vec!["test".to_string()],
                notes: None,
            })
            .expect_err("missing snapshot");
        assert!(matches!(
            error,
            CostModelRegistryError::DatasetSnapshotMissing { .. }
        ));
    }

    fn dataset_kind_key(kind: &protocol::RuntimeHistoricalDatasetKind) -> &'static str {
        match kind {
            protocol::RuntimeHistoricalDatasetKind::Trades => "trades",
            protocol::RuntimeHistoricalDatasetKind::Bars => "bars",
            protocol::RuntimeHistoricalDatasetKind::OrderBookL2 => "order_book_l2",
            protocol::RuntimeHistoricalDatasetKind::FundingRates => "funding_rates",
            protocol::RuntimeHistoricalDatasetKind::BorrowRates => "borrow_rates",
            protocol::RuntimeHistoricalDatasetKind::ReferenceMetadata => "reference_metadata",
            protocol::RuntimeHistoricalDatasetKind::MarketEvents => "market_events",
            protocol::RuntimeHistoricalDatasetKind::SlotEvents => "slot_events",
        }
    }
}
