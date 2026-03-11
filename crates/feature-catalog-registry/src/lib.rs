use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeCatalogProvenance, RuntimeDatasetSnapshotRef, RuntimeDeploymentRecord,
    RuntimeFeatureCatalogStatus, RuntimeFeatureDefinitionRecord, RuntimeFeatureInputRequirement,
    RuntimeRegimeDimension, RuntimeRegimeTagRecord, RuntimeStrategySpec, RuntimeVenueMarketType,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const SEED_TIMESTAMP: &str = "2026-03-10T00:00:00.000Z";
const FIXTURE_URI: &str =
    "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureCatalogRegistryConfig {
    pub database_url: String,
}

impl FeatureCatalogRegistryConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct FeatureCatalogRegistry {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureCatalogRegistrySnapshot {
    pub status: String,
    pub feature_definition_count: u64,
    pub active_feature_definition_count: u64,
    pub regime_tag_count: u64,
    pub active_regime_tag_count: u64,
    pub latest_updated_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FeatureCatalogRegistryQuery {
    pub feature_id: Option<String>,
    pub feature_key: Option<String>,
    pub regime_tag_id: Option<String>,
    pub regime_key: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub pair_symbol: Option<String>,
    pub market_type: Option<RuntimeVenueMarketType>,
    pub status: Option<RuntimeFeatureCatalogStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureCatalogRegistryQueryResult {
    pub feature_definitions: Vec<RuntimeFeatureDefinitionRecord>,
    pub regime_tags: Vec<RuntimeRegimeTagRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureCatalogSelection {
    pub feature_definitions: Vec<RuntimeFeatureDefinitionRecord>,
    pub regime_tags: Vec<RuntimeRegimeTagRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureCatalogWriteResult<T> {
    pub record: T,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum FeatureCatalogRegistryError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid feature definition {feature_id}: {reason}")]
    InvalidFeatureDefinition { feature_id: String, reason: String },
    #[error("invalid regime tag {regime_tag_id}: {reason}")]
    InvalidRegimeTag {
        regime_tag_id: String,
        reason: String,
    },
    #[error(
        "feature catalog record {record_id} references missing dataset snapshot {dataset_id}/{snapshot_id}"
    )]
    DatasetSnapshotMissing {
        record_id: String,
        dataset_id: String,
        snapshot_id: String,
    },
}

impl FeatureCatalogRegistry {
    pub fn new(config: FeatureCatalogRegistryConfig) -> Result<Self, FeatureCatalogRegistryError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(registry) => Ok(registry),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn upsert_feature_definition(
        &self,
        record: &RuntimeFeatureDefinitionRecord,
    ) -> Result<
        FeatureCatalogWriteResult<RuntimeFeatureDefinitionRecord>,
        FeatureCatalogRegistryError,
    > {
        validate_feature_definition(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_snapshot_refs_exist(&transaction, &record.feature_id, &record.dataset_snapshots)?;
        let existing = load_feature_definition(&transaction, &record.feature_id)?;
        persist_feature_definition(&transaction, record)?;
        transaction.commit()?;
        Ok(FeatureCatalogWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn upsert_regime_tag(
        &self,
        record: &RuntimeRegimeTagRecord,
    ) -> Result<FeatureCatalogWriteResult<RuntimeRegimeTagRecord>, FeatureCatalogRegistryError>
    {
        validate_regime_tag(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_snapshot_refs_exist(
            &transaction,
            &record.regime_tag_id,
            &record.dataset_snapshots,
        )?;
        let existing = load_regime_tag(&transaction, &record.regime_tag_id)?;
        persist_regime_tag(&transaction, record)?;
        transaction.commit()?;
        Ok(FeatureCatalogWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn query(
        &self,
        query: &FeatureCatalogRegistryQuery,
    ) -> Result<FeatureCatalogRegistryQueryResult, FeatureCatalogRegistryError> {
        let connection = self.open_connection()?;
        Ok(FeatureCatalogRegistryQueryResult {
            feature_definitions: list_feature_definitions(&connection, query)?,
            regime_tags: list_regime_tags(&connection, query)?,
        })
    }

    pub fn select_for_strategy(
        &self,
        deployment: &RuntimeDeploymentRecord,
        strategy_spec: &RuntimeStrategySpec,
    ) -> Result<FeatureCatalogSelection, FeatureCatalogRegistryError> {
        let query = FeatureCatalogRegistryQuery {
            venue_key: Some(deployment.venue_key.clone()),
            pair_symbol: Some(deployment.pair.symbol.clone()),
            market_type: Some(RuntimeVenueMarketType::Spot),
            status: Some(RuntimeFeatureCatalogStatus::Active),
            ..FeatureCatalogRegistryQuery::default()
        };
        let result = self.query(&query)?;
        let pair_assets = pair_assets(&deployment.pair.symbol);
        let required_feature_keys: BTreeSet<String> = strategy_spec
            .feature_requirements
            .iter()
            .filter(|requirement| requirement.required)
            .map(|requirement| requirement.feature_key.clone())
            .collect();
        let required_regime_keys: BTreeSet<String> =
            strategy_spec.regime_requirements.iter().cloned().collect();
        Ok(FeatureCatalogSelection {
            feature_definitions: select_latest_feature_definitions(
                result.feature_definitions,
                &required_feature_keys,
                &deployment.venue_key,
                &deployment.pair.symbol,
                &pair_assets,
            ),
            regime_tags: select_latest_regime_tags(
                result.regime_tags,
                &required_regime_keys,
                &deployment.venue_key,
                &deployment.pair.symbol,
                &pair_assets,
            ),
        })
    }

    #[must_use]
    pub fn snapshot_now(&self) -> FeatureCatalogRegistrySnapshot {
        match self.snapshot_counts() {
            Ok(snapshot) => snapshot,
            Err(error) => FeatureCatalogRegistrySnapshot {
                status: "degraded".to_string(),
                feature_definition_count: 0,
                active_feature_definition_count: 0,
                regime_tag_count: 0,
                active_regime_tag_count: 0,
                latest_updated_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(
        &self,
    ) -> Result<FeatureCatalogRegistrySnapshot, FeatureCatalogRegistryError> {
        let connection = self.open_connection()?;
        let feature_definition_count =
            connection.query_row("SELECT COUNT(*) FROM feature_definitions", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let active_feature_definition_count = connection.query_row(
            "SELECT COUNT(*) FROM feature_definitions WHERE status = 'active'",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let regime_tag_count =
            connection.query_row("SELECT COUNT(*) FROM regime_tags", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let active_regime_tag_count = connection.query_row(
            "SELECT COUNT(*) FROM regime_tags WHERE status = 'active'",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let latest_feature_updated_at = connection
            .query_row(
                "SELECT updated_at
                 FROM feature_definitions
                 ORDER BY updated_at DESC, feature_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let latest_regime_updated_at = connection
            .query_row(
                "SELECT updated_at
                 FROM regime_tags
                 ORDER BY updated_at DESC, regime_tag_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(FeatureCatalogRegistrySnapshot {
            status: "healthy".to_string(),
            feature_definition_count,
            active_feature_definition_count,
            regime_tag_count,
            active_regime_tag_count,
            latest_updated_at: latest_feature_updated_at
                .into_iter()
                .chain(latest_regime_updated_at)
                .max(),
            last_error: None,
        })
    }

    fn initialize_at_path(path: PathBuf) -> Result<Self, FeatureCatalogRegistryError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let registry = Self {
            database_path: path.clone(),
        };
        let connection = registry.open_connection()?;
        initialize_schema(&connection)?;
        registry.seed_builtin_catalog()?;
        Ok(registry)
    }

    fn seed_builtin_catalog(&self) -> Result<(), FeatureCatalogRegistryError> {
        for record in builtin_feature_definitions() {
            let _ = self.upsert_feature_definition(&record)?;
        }
        for record in builtin_regime_tags() {
            let _ = self.upsert_regime_tag(&record)?;
        }
        Ok(())
    }

    fn open_connection(&self) -> Result<Connection, FeatureCatalogRegistryError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(connection)
    }
}

fn builtin_feature_definitions() -> Vec<RuntimeFeatureDefinitionRecord> {
    vec![
        feature_definition(&FeatureDefinitionSeed {
            feature_id: "feature_short_return_bps_v1",
            feature_key: "short_return_bps",
            title: "Short-window return",
            summary: "Short-window signed return used by directional signal templates.",
            input_keys: &["mid_price_usd"],
            derived_from_feature_keys: &[],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            tags: &["signal", "seed"],
        }),
        feature_definition(&FeatureDefinitionSeed {
            feature_id: "feature_long_return_bps_v1",
            feature_key: "long_return_bps",
            title: "Long-window return",
            summary: "Long-window signed return used to confirm regime direction.",
            input_keys: &["mid_price_usd"],
            derived_from_feature_keys: &[],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            tags: &["signal", "seed"],
        }),
        feature_definition(&FeatureDefinitionSeed {
            feature_id: "feature_realized_volatility_bps_v1",
            feature_key: "realized_volatility_bps",
            title: "Realized volatility",
            summary:
                "Short-horizon realized volatility used for target sizing and volatility regimes.",
            input_keys: &["mid_price_usd"],
            derived_from_feature_keys: &[],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 75,
            tags: &["risk", "seed"],
        }),
        feature_definition(&FeatureDefinitionSeed {
            feature_id: "feature_spread_bps_v1",
            feature_key: "spread_bps",
            title: "Spread",
            summary: "Best bid/ask spread proxy used to classify liquidity and execution quality.",
            input_keys: &["best_bid_usd", "best_ask_usd"],
            derived_from_feature_keys: &[],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            tags: &["microstructure", "seed"],
        }),
    ]
}

fn builtin_regime_tags() -> Vec<RuntimeRegimeTagRecord> {
    vec![
        regime_tag(&RegimeTagSeed {
            regime_tag_id: "regime_short_trend_v1",
            regime_key: "short_trend",
            title: "Short trend regime",
            summary: "Classifies short-window market direction for directional strategies.",
            dimension: RuntimeRegimeDimension::Trend,
            value: "directional",
            source_feature_keys: &["short_return_bps"],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            min_confidence_bps: 8_500,
            tags: &["signal", "seed"],
        }),
        regime_tag(&RegimeTagSeed {
            regime_tag_id: "regime_long_trend_v1",
            regime_key: "long_trend",
            title: "Long trend regime",
            summary: "Classifies long-window directional bias for confirmation and macro rotation.",
            dimension: RuntimeRegimeDimension::Trend,
            value: "confirmed",
            source_feature_keys: &["long_return_bps"],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            min_confidence_bps: 8_500,
            tags: &["signal", "seed"],
        }),
        regime_tag(&RegimeTagSeed {
            regime_tag_id: "regime_volatility_band_v1",
            regime_key: "volatility_band",
            title: "Volatility band",
            summary: "Buckets realized volatility into low, medium, or high regimes for sizing.",
            dimension: RuntimeRegimeDimension::Volatility,
            value: "bucketed",
            source_feature_keys: &["realized_volatility_bps"],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 75,
            min_confidence_bps: 8_000,
            tags: &["risk", "seed"],
        }),
        regime_tag(&RegimeTagSeed {
            regime_tag_id: "regime_liquidity_state_v1",
            regime_key: "liquidity_state",
            title: "Liquidity state",
            summary: "Classifies spread and execution quality into liquid and stressed states.",
            dimension: RuntimeRegimeDimension::Liquidity,
            value: "classified",
            source_feature_keys: &["spread_bps"],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            min_confidence_bps: 8_000,
            tags: &["microstructure", "seed"],
        }),
    ]
}

struct FeatureDefinitionSeed<'a> {
    feature_id: &'a str,
    feature_key: &'a str,
    title: &'a str,
    summary: &'a str,
    input_keys: &'a [&'a str],
    derived_from_feature_keys: &'a [&'a str],
    freshness_slo_ms: u64,
    max_allowed_drift_bps: u16,
    tags: &'a [&'a str],
}

struct RegimeTagSeed<'a> {
    regime_tag_id: &'a str,
    regime_key: &'a str,
    title: &'a str,
    summary: &'a str,
    dimension: RuntimeRegimeDimension,
    value: &'a str,
    source_feature_keys: &'a [&'a str],
    freshness_slo_ms: u64,
    max_allowed_drift_bps: u16,
    min_confidence_bps: u16,
    tags: &'a [&'a str],
}

fn feature_definition(seed: &FeatureDefinitionSeed<'_>) -> RuntimeFeatureDefinitionRecord {
    RuntimeFeatureDefinitionRecord {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        feature_id: seed.feature_id.to_string(),
        feature_key: seed.feature_key.to_string(),
        version: "1.0.0".to_string(),
        title: seed.title.to_string(),
        summary: seed.summary.to_string(),
        status: RuntimeFeatureCatalogStatus::Active,
        market_type: RuntimeVenueMarketType::Spot,
        venue_keys: vec![
            "jupiter".to_string(),
            "magicblock".to_string(),
            "phoenix".to_string(),
        ],
        asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
        pair_symbols: vec!["SOL/USDC".to_string()],
        input_requirements: seed
            .input_keys
            .iter()
            .map(|input_key| RuntimeFeatureInputRequirement {
                input_key: (*input_key).to_string(),
                required: true,
                freshness_ms: Some(seed.freshness_slo_ms),
                notes: Some("Seed feature definition input requirement.".to_string()),
            })
            .collect(),
        derived_from_feature_keys: seed
            .derived_from_feature_keys
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        freshness_slo_ms: seed.freshness_slo_ms,
        max_allowed_drift_bps: seed.max_allowed_drift_bps,
        min_coverage_bps: 10_000,
        provenance: catalog_provenance("strategy-lab::feature-catalog"),
        dataset_snapshots: builtin_snapshot_refs(),
        created_at: SEED_TIMESTAMP.to_string(),
        updated_at: SEED_TIMESTAMP.to_string(),
        tags: seed.tags.iter().map(|value| (*value).to_string()).collect(),
        notes: Some("Seed feature definition for the runtime feature catalog.".to_string()),
    }
}

fn regime_tag(seed: &RegimeTagSeed<'_>) -> RuntimeRegimeTagRecord {
    RuntimeRegimeTagRecord {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        regime_tag_id: seed.regime_tag_id.to_string(),
        regime_key: seed.regime_key.to_string(),
        version: "1.0.0".to_string(),
        title: seed.title.to_string(),
        summary: seed.summary.to_string(),
        status: RuntimeFeatureCatalogStatus::Active,
        dimension: seed.dimension.clone(),
        value: seed.value.to_string(),
        market_type: RuntimeVenueMarketType::Spot,
        venue_keys: vec![
            "jupiter".to_string(),
            "magicblock".to_string(),
            "phoenix".to_string(),
        ],
        asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
        pair_symbols: vec!["SOL/USDC".to_string()],
        source_feature_keys: seed
            .source_feature_keys
            .iter()
            .map(|feature_key| (*feature_key).to_string())
            .collect(),
        freshness_slo_ms: seed.freshness_slo_ms,
        max_allowed_drift_bps: seed.max_allowed_drift_bps,
        min_confidence_bps: seed.min_confidence_bps,
        provenance: catalog_provenance("strategy-lab::regime-catalog"),
        dataset_snapshots: builtin_snapshot_refs(),
        created_at: SEED_TIMESTAMP.to_string(),
        updated_at: SEED_TIMESTAMP.to_string(),
        tags: seed.tags.iter().map(|value| (*value).to_string()).collect(),
        notes: Some("Seed regime tag definition for the runtime feature catalog.".to_string()),
    }
}

fn catalog_provenance(generated_by: &str) -> RuntimeCatalogProvenance {
    RuntimeCatalogProvenance {
        generated_by: generated_by.to_string(),
        generated_revision: Some("seed".to_string()),
        generated_at: SEED_TIMESTAMP.to_string(),
        notes: Some("Generated from checked-in runtime fixtures and catalog defaults.".to_string()),
    }
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

fn validate_feature_definition(
    record: &RuntimeFeatureDefinitionRecord,
) -> Result<(), FeatureCatalogRegistryError> {
    if record.feature_id.trim().is_empty() || record.feature_key.trim().is_empty() {
        return Err(FeatureCatalogRegistryError::InvalidFeatureDefinition {
            feature_id: record.feature_id.clone(),
            reason: "featureId and featureKey must not be empty".to_string(),
        });
    }
    if record.asset_keys.is_empty()
        || record.pair_symbols.is_empty()
        || record.input_requirements.is_empty()
        || record.dataset_snapshots.is_empty()
    {
        return Err(FeatureCatalogRegistryError::InvalidFeatureDefinition {
            feature_id: record.feature_id.clone(),
            reason:
                "assetKeys, pairSymbols, inputRequirements, and datasetSnapshots must not be empty"
                    .to_string(),
        });
    }
    Ok(())
}

fn validate_regime_tag(record: &RuntimeRegimeTagRecord) -> Result<(), FeatureCatalogRegistryError> {
    if record.regime_tag_id.trim().is_empty() || record.regime_key.trim().is_empty() {
        return Err(FeatureCatalogRegistryError::InvalidRegimeTag {
            regime_tag_id: record.regime_tag_id.clone(),
            reason: "regimeTagId and regimeKey must not be empty".to_string(),
        });
    }
    if record.asset_keys.is_empty()
        || record.pair_symbols.is_empty()
        || record.source_feature_keys.is_empty()
        || record.dataset_snapshots.is_empty()
    {
        return Err(FeatureCatalogRegistryError::InvalidRegimeTag {
            regime_tag_id: record.regime_tag_id.clone(),
            reason:
                "assetKeys, pairSymbols, sourceFeatureKeys, and datasetSnapshots must not be empty"
                    .to_string(),
        });
    }
    Ok(())
}

fn ensure_snapshot_refs_exist(
    connection: &Connection,
    record_id: &str,
    dataset_snapshots: &[RuntimeDatasetSnapshotRef],
) -> Result<(), FeatureCatalogRegistryError> {
    for snapshot in dataset_snapshots {
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
            return Err(FeatureCatalogRegistryError::DatasetSnapshotMissing {
                record_id: record_id.to_string(),
                dataset_id: snapshot.dataset_id.clone(),
                snapshot_id: snapshot.snapshot_id.clone(),
            });
        }
    }
    Ok(())
}

fn list_feature_definitions(
    connection: &Connection,
    query: &FeatureCatalogRegistryQuery,
) -> Result<Vec<RuntimeFeatureDefinitionRecord>, FeatureCatalogRegistryError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT f.record_json
         FROM feature_definitions f
         LEFT JOIN feature_definition_assets a ON a.feature_id = f.feature_id
         LEFT JOIN feature_definition_venues v ON v.feature_id = f.feature_id
         LEFT JOIN feature_definition_pairs p ON p.feature_id = f.feature_id
         WHERE (?1 IS NULL OR f.feature_id = ?1)
           AND (?2 IS NULL OR f.feature_key = ?2)
           AND (?3 IS NULL OR v.venue_key = ?3)
           AND (?4 IS NULL OR a.asset_key = ?4)
           AND (?5 IS NULL OR p.pair_symbol = ?5)
           AND (?6 IS NULL OR f.market_type = ?6)
           AND (?7 IS NULL OR f.status = ?7)
         ORDER BY f.updated_at DESC, f.feature_id DESC",
    )?;
    let rows = statement.query_map(
        params![
            query.feature_id.as_deref(),
            query.feature_key.as_deref(),
            query.venue_key.as_deref(),
            query.asset_key.as_deref(),
            query.pair_symbol.as_deref(),
            query.market_type.as_ref().map(market_type_key),
            query.status.as_ref().map(status_key),
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn list_regime_tags(
    connection: &Connection,
    query: &FeatureCatalogRegistryQuery,
) -> Result<Vec<RuntimeRegimeTagRecord>, FeatureCatalogRegistryError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT r.record_json
         FROM regime_tags r
         LEFT JOIN regime_tag_assets a ON a.regime_tag_id = r.regime_tag_id
         LEFT JOIN regime_tag_venues v ON v.regime_tag_id = r.regime_tag_id
         LEFT JOIN regime_tag_pairs p ON p.regime_tag_id = r.regime_tag_id
         WHERE (?1 IS NULL OR r.regime_tag_id = ?1)
           AND (?2 IS NULL OR r.regime_key = ?2)
           AND (?3 IS NULL OR v.venue_key = ?3)
           AND (?4 IS NULL OR a.asset_key = ?4)
           AND (?5 IS NULL OR p.pair_symbol = ?5)
           AND (?6 IS NULL OR r.market_type = ?6)
           AND (?7 IS NULL OR r.status = ?7)
         ORDER BY r.updated_at DESC, r.regime_tag_id DESC",
    )?;
    let rows = statement.query_map(
        params![
            query.regime_tag_id.as_deref(),
            query.regime_key.as_deref(),
            query.venue_key.as_deref(),
            query.asset_key.as_deref(),
            query.pair_symbol.as_deref(),
            query.market_type.as_ref().map(market_type_key),
            query.status.as_ref().map(status_key),
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn persist_feature_definition(
    connection: &Connection,
    record: &RuntimeFeatureDefinitionRecord,
) -> Result<(), FeatureCatalogRegistryError> {
    connection.execute(
        "INSERT INTO feature_definitions (
            feature_id,
            feature_key,
            market_type,
            status,
            updated_at,
            record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(feature_id) DO UPDATE SET
            feature_key = excluded.feature_key,
            market_type = excluded.market_type,
            status = excluded.status,
            updated_at = excluded.updated_at,
            record_json = excluded.record_json",
        params![
            record.feature_id,
            record.feature_key,
            market_type_key(&record.market_type),
            status_key(&record.status),
            record.updated_at,
            serialize_json(record)?,
        ],
    )?;
    replace_keyed_rows(
        connection,
        "feature_definition_assets",
        "feature_id",
        &record.feature_id,
        "asset_key",
        &record.asset_keys,
    )?;
    replace_keyed_rows(
        connection,
        "feature_definition_venues",
        "feature_id",
        &record.feature_id,
        "venue_key",
        &record.venue_keys,
    )?;
    replace_keyed_rows(
        connection,
        "feature_definition_pairs",
        "feature_id",
        &record.feature_id,
        "pair_symbol",
        &record.pair_symbols,
    )?;
    Ok(())
}

fn persist_regime_tag(
    connection: &Connection,
    record: &RuntimeRegimeTagRecord,
) -> Result<(), FeatureCatalogRegistryError> {
    connection.execute(
        "INSERT INTO regime_tags (
            regime_tag_id,
            regime_key,
            market_type,
            status,
            updated_at,
            record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(regime_tag_id) DO UPDATE SET
            regime_key = excluded.regime_key,
            market_type = excluded.market_type,
            status = excluded.status,
            updated_at = excluded.updated_at,
            record_json = excluded.record_json",
        params![
            record.regime_tag_id,
            record.regime_key,
            market_type_key(&record.market_type),
            status_key(&record.status),
            record.updated_at,
            serialize_json(record)?,
        ],
    )?;
    replace_keyed_rows(
        connection,
        "regime_tag_assets",
        "regime_tag_id",
        &record.regime_tag_id,
        "asset_key",
        &record.asset_keys,
    )?;
    replace_keyed_rows(
        connection,
        "regime_tag_venues",
        "regime_tag_id",
        &record.regime_tag_id,
        "venue_key",
        &record.venue_keys,
    )?;
    replace_keyed_rows(
        connection,
        "regime_tag_pairs",
        "regime_tag_id",
        &record.regime_tag_id,
        "pair_symbol",
        &record.pair_symbols,
    )?;
    replace_keyed_rows(
        connection,
        "regime_tag_source_features",
        "regime_tag_id",
        &record.regime_tag_id,
        "feature_key",
        &record.source_feature_keys,
    )?;
    Ok(())
}

fn replace_keyed_rows(
    connection: &Connection,
    table: &str,
    owner_column: &str,
    owner_value: &str,
    value_column: &str,
    values: &[String],
) -> Result<(), FeatureCatalogRegistryError> {
    connection.execute(
        &format!("DELETE FROM {table} WHERE {owner_column} = ?1"),
        params![owner_value],
    )?;
    for value in values {
        connection.execute(
            &format!("INSERT INTO {table} ({owner_column}, {value_column}) VALUES (?1, ?2)"),
            params![owner_value, value],
        )?;
    }
    Ok(())
}

fn load_feature_definition(
    connection: &Connection,
    feature_id: &str,
) -> Result<Option<RuntimeFeatureDefinitionRecord>, FeatureCatalogRegistryError> {
    connection
        .query_row(
            "SELECT record_json FROM feature_definitions WHERE feature_id = ?1",
            params![feature_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn load_regime_tag(
    connection: &Connection,
    regime_tag_id: &str,
) -> Result<Option<RuntimeRegimeTagRecord>, FeatureCatalogRegistryError> {
    connection
        .query_row(
            "SELECT record_json FROM regime_tags WHERE regime_tag_id = ?1",
            params![regime_tag_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn select_latest_feature_definitions(
    records: Vec<RuntimeFeatureDefinitionRecord>,
    required_feature_keys: &BTreeSet<String>,
    venue_key: &str,
    pair_symbol: &str,
    pair_assets: &[String],
) -> Vec<RuntimeFeatureDefinitionRecord> {
    let mut selected = BTreeMap::new();
    for record in records {
        if !required_feature_keys.contains(&record.feature_key)
            || !record_applies(
                &record.venue_keys,
                &record.asset_keys,
                &record.pair_symbols,
                venue_key,
                pair_symbol,
                pair_assets,
            )
        {
            continue;
        }
        selected.entry(record.feature_key.clone()).or_insert(record);
    }
    selected.into_values().collect()
}

fn select_latest_regime_tags(
    records: Vec<RuntimeRegimeTagRecord>,
    required_regime_keys: &BTreeSet<String>,
    venue_key: &str,
    pair_symbol: &str,
    pair_assets: &[String],
) -> Vec<RuntimeRegimeTagRecord> {
    let mut selected = BTreeMap::new();
    for record in records {
        if !required_regime_keys.contains(&record.regime_key)
            || !record_applies(
                &record.venue_keys,
                &record.asset_keys,
                &record.pair_symbols,
                venue_key,
                pair_symbol,
                pair_assets,
            )
        {
            continue;
        }
        selected.entry(record.regime_key.clone()).or_insert(record);
    }
    selected.into_values().collect()
}

fn record_applies(
    venue_keys: &[String],
    asset_keys: &[String],
    pair_symbols: &[String],
    venue_key: &str,
    pair_symbol: &str,
    pair_assets: &[String],
) -> bool {
    let venue_matches = venue_keys.is_empty() || venue_keys.iter().any(|value| value == venue_key);
    let pair_matches =
        pair_symbols.is_empty() || pair_symbols.iter().any(|value| value == pair_symbol);
    let asset_matches = asset_keys.is_empty()
        || asset_keys
            .iter()
            .any(|value| pair_assets.iter().any(|asset| asset == value));
    venue_matches && pair_matches && asset_matches
}

fn pair_assets(pair_symbol: &str) -> Vec<String> {
    pair_symbol
        .split('/')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn initialize_schema(connection: &Connection) -> Result<(), FeatureCatalogRegistryError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS feature_definitions (
            feature_id TEXT PRIMARY KEY,
            feature_key TEXT NOT NULL,
            market_type TEXT NOT NULL,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feature_definition_assets (
            feature_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (feature_id, asset_key),
            FOREIGN KEY (feature_id) REFERENCES feature_definitions(feature_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS feature_definition_venues (
            feature_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (feature_id, venue_key),
            FOREIGN KEY (feature_id) REFERENCES feature_definitions(feature_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS feature_definition_pairs (
            feature_id TEXT NOT NULL,
            pair_symbol TEXT NOT NULL,
            PRIMARY KEY (feature_id, pair_symbol),
            FOREIGN KEY (feature_id) REFERENCES feature_definitions(feature_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS regime_tags (
            regime_tag_id TEXT PRIMARY KEY,
            regime_key TEXT NOT NULL,
            market_type TEXT NOT NULL,
            status TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS regime_tag_assets (
            regime_tag_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (regime_tag_id, asset_key),
            FOREIGN KEY (regime_tag_id) REFERENCES regime_tags(regime_tag_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS regime_tag_venues (
            regime_tag_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (regime_tag_id, venue_key),
            FOREIGN KEY (regime_tag_id) REFERENCES regime_tags(regime_tag_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS regime_tag_pairs (
            regime_tag_id TEXT NOT NULL,
            pair_symbol TEXT NOT NULL,
            PRIMARY KEY (regime_tag_id, pair_symbol),
            FOREIGN KEY (regime_tag_id) REFERENCES regime_tags(regime_tag_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS regime_tag_source_features (
            regime_tag_id TEXT NOT NULL,
            feature_key TEXT NOT NULL,
            PRIMARY KEY (regime_tag_id, feature_key),
            FOREIGN KEY (regime_tag_id) REFERENCES regime_tags(regime_tag_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_feature_definitions_lookup
            ON feature_definitions (feature_key, market_type, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_feature_definition_assets_lookup
            ON feature_definition_assets (asset_key, feature_id);
        CREATE INDEX IF NOT EXISTS idx_feature_definition_venues_lookup
            ON feature_definition_venues (venue_key, feature_id);
        CREATE INDEX IF NOT EXISTS idx_feature_definition_pairs_lookup
            ON feature_definition_pairs (pair_symbol, feature_id);
        CREATE INDEX IF NOT EXISTS idx_regime_tags_lookup
            ON regime_tags (regime_key, market_type, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_regime_tag_assets_lookup
            ON regime_tag_assets (asset_key, regime_tag_id);
        CREATE INDEX IF NOT EXISTS idx_regime_tag_venues_lookup
            ON regime_tag_venues (venue_key, regime_tag_id);
        CREATE INDEX IF NOT EXISTS idx_regime_tag_pairs_lookup
            ON regime_tag_pairs (pair_symbol, regime_tag_id);
        CREATE INDEX IF NOT EXISTS idx_regime_tag_source_features_lookup
            ON regime_tag_source_features (feature_key, regime_tag_id);",
    )?;
    Ok(())
}

fn market_type_key(market_type: &RuntimeVenueMarketType) -> &'static str {
    match market_type {
        RuntimeVenueMarketType::Spot => "spot",
        RuntimeVenueMarketType::Perp => "perp",
        RuntimeVenueMarketType::Options => "options",
    }
}

fn status_key(status: &RuntimeFeatureCatalogStatus) -> &'static str {
    match status {
        RuntimeFeatureCatalogStatus::Draft => "draft",
        RuntimeFeatureCatalogStatus::Active => "active",
        RuntimeFeatureCatalogStatus::Deprecated => "deprecated",
    }
}

#[cfg(test)]
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
    std::env::temp_dir().join("runtime-rs/feature-catalog-registry.sqlite3")
}

fn should_fallback_to_tmp(path: &Path, error: &FeatureCatalogRegistryError) -> bool {
    !path.starts_with(std::env::temp_dir()) && matches!(error, FeatureCatalogRegistryError::Io(_))
}

fn serialize_json<T>(value: &T) -> Result<String, FeatureCatalogRegistryError>
where
    T: Serialize,
{
    Ok(serde_json::to_string(value)?)
}

fn deserialize_json<T>(value: &str) -> Result<T, FeatureCatalogRegistryError>
where
    T: for<'de> Deserialize<'de>,
{
    Ok(serde_json::from_str(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(name: &str) -> FeatureCatalogRegistry {
        let database_url = format!(".tmp/tests/feature-catalog-registry/{name}.sqlite3");
        let path = PathBuf::from(&database_url);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent dir");
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
        for (dataset_id, kind) in [
            (
                "dataset_feed_replay_sol_usdc_market_events",
                protocol::RuntimeHistoricalDatasetKind::MarketEvents,
            ),
            (
                "dataset_feed_replay_sol_usdc_slot_events",
                protocol::RuntimeHistoricalDatasetKind::SlotEvents,
            ),
        ] {
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
                        dataset_id,
                        "snapshot_2026_03_07_seed",
                        dataset_kind_key(&kind),
                        SEED_TIMESTAMP,
                        "{}"
                    ],
                )
                .expect("snapshot");
        }
        FeatureCatalogRegistry::new(FeatureCatalogRegistryConfig::new(database_url))
            .expect("registry")
    }

    #[test]
    fn seeds_builtin_feature_definitions_and_regime_tags() {
        let registry = registry("seed");
        let result = registry
            .query(&FeatureCatalogRegistryQuery {
                venue_key: Some("jupiter".to_string()),
                ..FeatureCatalogRegistryQuery::default()
            })
            .expect("query");
        assert!(result
            .feature_definitions
            .iter()
            .any(|record| record.feature_key == "short_return_bps"));
        assert!(result
            .regime_tags
            .iter()
            .any(|record| record.regime_key == "volatility_band"));
        let snapshot = registry.snapshot_now();
        assert_eq!(snapshot.active_feature_definition_count, 4);
        assert_eq!(snapshot.active_regime_tag_count, 4);
    }

    #[test]
    fn selects_active_catalog_for_strategy() {
        let registry = registry("select");
        let mut strategy_spec = strategy_core::StrategyKind::MacroRotation.spec();
        strategy_spec.regime_requirements = vec!["long_trend".to_string()];
        let deployment = RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "deployment_jupiter".to_string(),
            strategy_key: "macro_rotation".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_1".to_string(),
            venue_key: "jupiter".to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            },
            mode: protocol::RuntimeMode::Paper,
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
            .select_for_strategy(&deployment, &strategy_spec)
            .expect("selection");
        assert!(selected
            .feature_definitions
            .iter()
            .any(|record| record.feature_key == "short_return_bps"));
        assert!(selected
            .feature_definitions
            .iter()
            .any(|record| record.feature_key == "long_return_bps"));
        assert!(selected
            .regime_tags
            .iter()
            .any(|record| record.regime_key == "long_trend"));
    }

    #[test]
    fn rejects_missing_dataset_references() {
        let registry = registry("missing-snapshot");
        let mut record = feature_definition(&FeatureDefinitionSeed {
            feature_id: "feature_missing_snapshot_v1",
            feature_key: "spread_bps",
            title: "Spread",
            summary: "Spread",
            input_keys: &["best_bid_usd", "best_ask_usd"],
            derived_from_feature_keys: &[],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            tags: &["test"],
        });
        record.dataset_snapshots = vec![RuntimeDatasetSnapshotRef {
            dataset_id: "dataset_missing".to_string(),
            snapshot_id: "snapshot_missing".to_string(),
            captured_at: SEED_TIMESTAMP.to_string(),
            uri: None,
            content_digest: None,
        }];
        let error = registry
            .upsert_feature_definition(&record)
            .expect_err("missing snapshot");
        assert!(matches!(
            error,
            FeatureCatalogRegistryError::DatasetSnapshotMissing { .. }
        ));
    }
}
