use std::{
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeDatasetNormalizationKind, RuntimeDatasetRetentionClass, RuntimeDatasetSnapshotRef,
    RuntimeDatasetStorageFormat, RuntimeHistoricalDatasetAcquisitionKind,
    RuntimeHistoricalDatasetKind, RuntimeHistoricalDatasetProvenance,
    RuntimeHistoricalDatasetSnapshotRecord, RuntimeReplayCorpusKind, RuntimeReplayCorpusRecord,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const SEED_TIMESTAMP: &str = "2026-03-10T00:00:00.000Z";
const FIXTURE_COVERAGE_START: &str = "2026-03-07T00:00:00Z";
const FIXTURE_COVERAGE_END: &str = "2026-03-07T00:00:05Z";
const FIXTURE_RELATIVE_PATH: &str =
    "services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json";
const FIXTURE_URI: &str =
    "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoricalDataLakeConfig {
    pub database_url: String,
}

impl HistoricalDataLakeConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct HistoricalDataLake {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalDataLakeSnapshot {
    pub status: String,
    pub dataset_snapshot_count: u64,
    pub replay_corpus_count: u64,
    pub latest_snapshot_captured_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HistoricalDataLakeQuery {
    pub dataset_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub corpus_id: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub dataset_kind: Option<RuntimeHistoricalDatasetKind>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoricalDataLakeQueryResult {
    pub dataset_snapshots: Vec<RuntimeHistoricalDatasetSnapshotRecord>,
    pub replay_corpora: Vec<RuntimeReplayCorpusRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoricalDataWriteResult<T> {
    pub record: T,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum HistoricalDataLakeError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid historical dataset snapshot {dataset_id}/{snapshot_id}: {reason}")]
    InvalidDatasetSnapshot {
        dataset_id: String,
        snapshot_id: String,
        reason: String,
    },
    #[error("historical dataset snapshot {dataset_id}/{snapshot_id} not found")]
    DatasetSnapshotNotFound {
        dataset_id: String,
        snapshot_id: String,
    },
    #[error(
        "replay corpus {corpus_id} references missing dataset snapshot {dataset_id}/{snapshot_id}"
    )]
    ReplayCorpusDatasetMissing {
        corpus_id: String,
        dataset_id: String,
        snapshot_id: String,
    },
}

impl HistoricalDataLake {
    pub fn new(config: HistoricalDataLakeConfig) -> Result<Self, HistoricalDataLakeError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(lake) => Ok(lake),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn upsert_dataset_snapshot(
        &self,
        record: &RuntimeHistoricalDatasetSnapshotRecord,
    ) -> Result<
        HistoricalDataWriteResult<RuntimeHistoricalDatasetSnapshotRecord>,
        HistoricalDataLakeError,
    > {
        validate_dataset_snapshot(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let existing =
            load_dataset_snapshot(&transaction, &record.dataset_id, &record.snapshot_id)?;
        persist_dataset_snapshot(&transaction, record)?;
        transaction.commit()?;
        Ok(HistoricalDataWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn upsert_replay_corpus(
        &self,
        record: &RuntimeReplayCorpusRecord,
    ) -> Result<HistoricalDataWriteResult<RuntimeReplayCorpusRecord>, HistoricalDataLakeError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_snapshot_refs_exist(&transaction, &record.corpus_id, &record.dataset_snapshots)?;
        let existing = load_replay_corpus(&transaction, &record.corpus_id)?;
        persist_replay_corpus(&transaction, record)?;
        transaction.commit()?;
        Ok(HistoricalDataWriteResult {
            record: record.clone(),
            created: existing.is_none(),
        })
    }

    pub fn query(
        &self,
        query: &HistoricalDataLakeQuery,
    ) -> Result<HistoricalDataLakeQueryResult, HistoricalDataLakeError> {
        let connection = self.open_connection()?;
        let dataset_snapshots = list_dataset_snapshots(&connection, query)?;
        let replay_corpora = list_replay_corpora(&connection, query)?;
        Ok(HistoricalDataLakeQueryResult {
            dataset_snapshots,
            replay_corpora,
        })
    }

    #[must_use]
    pub fn snapshot_now(&self) -> HistoricalDataLakeSnapshot {
        match self.snapshot_counts() {
            Ok((dataset_snapshot_count, replay_corpus_count, latest_snapshot_captured_at)) => {
                HistoricalDataLakeSnapshot {
                    status: "healthy".to_string(),
                    dataset_snapshot_count,
                    replay_corpus_count,
                    latest_snapshot_captured_at,
                    last_error: None,
                }
            }
            Err(error) => HistoricalDataLakeSnapshot {
                status: "degraded".to_string(),
                dataset_snapshot_count: 0,
                replay_corpus_count: 0,
                latest_snapshot_captured_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<(u64, u64, Option<String>), HistoricalDataLakeError> {
        let connection = self.open_connection()?;
        let dataset_snapshot_count = connection.query_row(
            "SELECT COUNT(*) FROM historical_dataset_snapshots",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let replay_corpus_count =
            connection.query_row("SELECT COUNT(*) FROM replay_corpora", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let latest_snapshot_captured_at = connection
            .query_row(
                "SELECT captured_at
                 FROM historical_dataset_snapshots
                 ORDER BY captured_at DESC, dataset_id DESC, snapshot_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok((
            dataset_snapshot_count,
            replay_corpus_count,
            latest_snapshot_captured_at,
        ))
    }

    fn initialize_at_path(path: PathBuf) -> Result<Self, HistoricalDataLakeError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let lake = Self {
            database_path: path.clone(),
        };
        let connection = lake.open_connection()?;
        initialize_schema(&connection)?;
        lake.seed_builtin_replay_corpus()?;
        Ok(lake)
    }

    fn seed_builtin_replay_corpus(&self) -> Result<(), HistoricalDataLakeError> {
        for record in builtin_dataset_snapshots()? {
            let _ = self.upsert_dataset_snapshot(&record)?;
        }
        let _ = self.upsert_replay_corpus(&builtin_replay_corpus()?)?;
        Ok(())
    }

    fn open_connection(&self) -> Result<Connection, HistoricalDataLakeError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(connection)
    }
}

fn builtin_dataset_snapshots(
) -> Result<Vec<RuntimeHistoricalDatasetSnapshotRecord>, HistoricalDataLakeError> {
    let digest = fixture_digest()?;
    Ok(vec![
        RuntimeHistoricalDatasetSnapshotRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
            snapshot_id: "snapshot_2026_03_07_seed".to_string(),
            dataset_kind: RuntimeHistoricalDatasetKind::MarketEvents,
            normalization_kind: RuntimeDatasetNormalizationKind::ReplayReady,
            format: RuntimeDatasetStorageFormat::FixtureJson,
            retention_class: RuntimeDatasetRetentionClass::Seed,
            captured_at: SEED_TIMESTAMP.to_string(),
            coverage_start_at: FIXTURE_COVERAGE_START.to_string(),
            coverage_end_at: FIXTURE_COVERAGE_END.to_string(),
            row_count: 2,
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            pair_symbols: vec!["SOL/USDC".to_string()],
            chain_keys: vec!["solana-mainnet".to_string()],
            uri: format!("{FIXTURE_URI}#marketEvents"),
            content_digest: digest.clone(),
            compression: None,
            time_bucket_seconds: None,
            provenance: fixture_provenance("market events slice"),
            sampling_notes: Some("Complete deterministic market-event fixture.".to_string()),
            compaction_notes: Some("No compaction applied to seed replay slice.".to_string()),
            tags: vec![
                "seed".to_string(),
                "deterministic".to_string(),
                "replay".to_string(),
            ],
            notes: Some("Seed dataset snapshot for runtime feed replay market events.".to_string()),
        },
        RuntimeHistoricalDatasetSnapshotRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            dataset_id: "dataset_feed_replay_sol_usdc_slot_events".to_string(),
            snapshot_id: "snapshot_2026_03_07_seed".to_string(),
            dataset_kind: RuntimeHistoricalDatasetKind::SlotEvents,
            normalization_kind: RuntimeDatasetNormalizationKind::ReplayReady,
            format: RuntimeDatasetStorageFormat::FixtureJson,
            retention_class: RuntimeDatasetRetentionClass::Seed,
            captured_at: SEED_TIMESTAMP.to_string(),
            coverage_start_at: FIXTURE_COVERAGE_START.to_string(),
            coverage_end_at: FIXTURE_COVERAGE_END.to_string(),
            row_count: 3,
            venue_keys: vec!["helius".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            pair_symbols: vec!["SOL/USDC".to_string()],
            chain_keys: vec!["solana-mainnet".to_string()],
            uri: format!("{FIXTURE_URI}#slotEvents"),
            content_digest: digest,
            compression: None,
            time_bucket_seconds: None,
            provenance: fixture_provenance("slot events slice"),
            sampling_notes: Some("Complete deterministic slot-event fixture.".to_string()),
            compaction_notes: Some("No compaction applied to seed replay slice.".to_string()),
            tags: vec![
                "seed".to_string(),
                "deterministic".to_string(),
                "replay".to_string(),
            ],
            notes: Some("Seed dataset snapshot for runtime feed replay slot events.".to_string()),
        },
    ])
}

fn builtin_replay_corpus() -> Result<RuntimeReplayCorpusRecord, HistoricalDataLakeError> {
    let digest = fixture_digest()?;
    Ok(RuntimeReplayCorpusRecord {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        corpus_id: "replay_corpus_sol_usdc_feed_gateway_seed".to_string(),
        title: "SOL/USDC feed gateway seed replay corpus".to_string(),
        summary: "Deterministic replay corpus seeded from the checked-in runtime feed fixture."
            .to_string(),
        replay_kind: RuntimeReplayCorpusKind::FeedGatewayV1,
        created_at: SEED_TIMESTAMP.to_string(),
        updated_at: SEED_TIMESTAMP.to_string(),
        venue_keys: vec!["jupiter".to_string(), "helius".to_string()],
        asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
        pair_symbols: vec!["SOL/USDC".to_string()],
        chain_keys: vec!["solana-mainnet".to_string()],
        dataset_snapshots: vec![
            RuntimeDatasetSnapshotRef {
                dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
                snapshot_id: "snapshot_2026_03_07_seed".to_string(),
                captured_at: SEED_TIMESTAMP.to_string(),
                uri: Some(format!("{FIXTURE_URI}#marketEvents")),
                content_digest: Some(digest.clone()),
            },
            RuntimeDatasetSnapshotRef {
                dataset_id: "dataset_feed_replay_sol_usdc_slot_events".to_string(),
                snapshot_id: "snapshot_2026_03_07_seed".to_string(),
                captured_at: SEED_TIMESTAMP.to_string(),
                uri: Some(format!("{FIXTURE_URI}#slotEvents")),
                content_digest: Some(digest.clone()),
            },
        ],
        fixture_uri: Some(FIXTURE_URI.to_string()),
        content_digest: Some(digest),
        deterministic_seed: Some(100),
        tags: vec![
            "seed".to_string(),
            "deterministic".to_string(),
            "feed-gateway".to_string(),
        ],
        notes: Some("References the checked-in SOL/USDC runtime replay fixture.".to_string()),
    })
}

fn fixture_provenance(slice_name: &str) -> RuntimeHistoricalDatasetProvenance {
    RuntimeHistoricalDatasetProvenance {
        acquisition_kind: RuntimeHistoricalDatasetAcquisitionKind::ResearchFixture,
        collected_from: FIXTURE_RELATIVE_PATH.to_string(),
        provider: Some("repo-fixture".to_string()),
        collected_at: SEED_TIMESTAMP.to_string(),
        generator: Some("runtime-rs".to_string()),
        generator_revision: Some("feed-replay-seed-v1".to_string()),
        notes: Some(format!("Seeded from deterministic {slice_name}.")),
    }
}

fn fixture_digest() -> Result<String, HistoricalDataLakeError> {
    let bytes = fs::read(fixture_path())?;
    let digest = Sha256::digest(bytes);
    Ok(format!("sha256:{digest:x}"))
}

fn fixture_path() -> PathBuf {
    fixture_path_candidates()
        .into_iter()
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../{FIXTURE_RELATIVE_PATH}"))
        })
}

fn fixture_path_candidates() -> Vec<PathBuf> {
    vec![
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../{FIXTURE_RELATIVE_PATH}")),
        PathBuf::from(format!("/app/{FIXTURE_RELATIVE_PATH}")),
        PathBuf::from(format!("./{FIXTURE_RELATIVE_PATH}")),
    ]
}

fn validate_dataset_snapshot(
    record: &RuntimeHistoricalDatasetSnapshotRecord,
) -> Result<(), HistoricalDataLakeError> {
    if record.dataset_id.trim().is_empty() || record.snapshot_id.trim().is_empty() {
        return Err(HistoricalDataLakeError::InvalidDatasetSnapshot {
            dataset_id: record.dataset_id.clone(),
            snapshot_id: record.snapshot_id.clone(),
            reason: "datasetId and snapshotId must not be empty".to_string(),
        });
    }
    if record.coverage_start_at > record.coverage_end_at {
        return Err(HistoricalDataLakeError::InvalidDatasetSnapshot {
            dataset_id: record.dataset_id.clone(),
            snapshot_id: record.snapshot_id.clone(),
            reason: "coverageStartAt must be <= coverageEndAt".to_string(),
        });
    }
    Ok(())
}

fn list_dataset_snapshots(
    connection: &Connection,
    query: &HistoricalDataLakeQuery,
) -> Result<Vec<RuntimeHistoricalDatasetSnapshotRecord>, HistoricalDataLakeError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT d.record_json
         FROM historical_dataset_snapshots d
         LEFT JOIN historical_dataset_snapshot_venues v
           ON v.dataset_id = d.dataset_id AND v.snapshot_id = d.snapshot_id
         LEFT JOIN historical_dataset_snapshot_assets a
           ON a.dataset_id = d.dataset_id AND a.snapshot_id = d.snapshot_id
         WHERE (?1 IS NULL OR d.dataset_id = ?1)
           AND (?2 IS NULL OR d.snapshot_id = ?2)
           AND (?3 IS NULL OR d.dataset_kind = ?3)
           AND (?4 IS NULL OR v.venue_key = ?4)
           AND (?5 IS NULL OR a.asset_key = ?5)
         ORDER BY d.captured_at DESC, d.dataset_id DESC, d.snapshot_id DESC",
    )?;
    let dataset_kind = query.dataset_kind.as_ref().map(dataset_kind_key);
    let rows = statement.query_map(
        params![
            query.dataset_id.as_deref(),
            query.snapshot_id.as_deref(),
            dataset_kind,
            query.venue_key.as_deref(),
            query.asset_key.as_deref(),
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn list_replay_corpora(
    connection: &Connection,
    query: &HistoricalDataLakeQuery,
) -> Result<Vec<RuntimeReplayCorpusRecord>, HistoricalDataLakeError> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT c.record_json
         FROM replay_corpora c
         LEFT JOIN replay_corpus_venues v ON v.corpus_id = c.corpus_id
         LEFT JOIN replay_corpus_assets a ON a.corpus_id = c.corpus_id
         WHERE (?1 IS NULL OR c.corpus_id = ?1)
           AND (?2 IS NULL OR v.venue_key = ?2)
           AND (?3 IS NULL OR a.asset_key = ?3)
         ORDER BY c.updated_at DESC, c.corpus_id DESC",
    )?;
    let rows = statement.query_map(
        params![
            query.corpus_id.as_deref(),
            query.venue_key.as_deref(),
            query.asset_key.as_deref(),
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn ensure_snapshot_refs_exist(
    connection: &Connection,
    corpus_id: &str,
    refs: &[RuntimeDatasetSnapshotRef],
) -> Result<(), HistoricalDataLakeError> {
    for snapshot in refs {
        let exists =
            load_dataset_snapshot(connection, &snapshot.dataset_id, &snapshot.snapshot_id)?;
        if exists.is_none() {
            return Err(HistoricalDataLakeError::ReplayCorpusDatasetMissing {
                corpus_id: corpus_id.to_string(),
                dataset_id: snapshot.dataset_id.clone(),
                snapshot_id: snapshot.snapshot_id.clone(),
            });
        }
    }
    Ok(())
}

fn persist_dataset_snapshot(
    connection: &Connection,
    record: &RuntimeHistoricalDatasetSnapshotRecord,
) -> Result<(), HistoricalDataLakeError> {
    connection.execute(
        "INSERT INTO historical_dataset_snapshots (
            dataset_id,
            snapshot_id,
            dataset_kind,
            captured_at,
            record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(dataset_id, snapshot_id) DO UPDATE SET
            dataset_kind = excluded.dataset_kind,
            captured_at = excluded.captured_at,
            record_json = excluded.record_json",
        params![
            record.dataset_id,
            record.snapshot_id,
            dataset_kind_key(&record.dataset_kind),
            record.captured_at,
            serialize_json(record)?,
        ],
    )?;
    connection.execute(
        "DELETE FROM historical_dataset_snapshot_venues WHERE dataset_id = ?1 AND snapshot_id = ?2",
        params![record.dataset_id, record.snapshot_id],
    )?;
    for venue_key in &record.venue_keys {
        connection.execute(
            "INSERT INTO historical_dataset_snapshot_venues (
                dataset_id,
                snapshot_id,
                venue_key
             ) VALUES (?1, ?2, ?3)",
            params![record.dataset_id, record.snapshot_id, venue_key],
        )?;
    }
    connection.execute(
        "DELETE FROM historical_dataset_snapshot_assets WHERE dataset_id = ?1 AND snapshot_id = ?2",
        params![record.dataset_id, record.snapshot_id],
    )?;
    for asset_key in &record.asset_keys {
        connection.execute(
            "INSERT INTO historical_dataset_snapshot_assets (
                dataset_id,
                snapshot_id,
                asset_key
             ) VALUES (?1, ?2, ?3)",
            params![record.dataset_id, record.snapshot_id, asset_key],
        )?;
    }
    Ok(())
}

fn persist_replay_corpus(
    connection: &Connection,
    record: &RuntimeReplayCorpusRecord,
) -> Result<(), HistoricalDataLakeError> {
    connection.execute(
        "INSERT INTO replay_corpora (
            corpus_id,
            updated_at,
            record_json
         ) VALUES (?1, ?2, ?3)
         ON CONFLICT(corpus_id) DO UPDATE SET
            updated_at = excluded.updated_at,
            record_json = excluded.record_json",
        params![record.corpus_id, record.updated_at, serialize_json(record)?],
    )?;
    connection.execute(
        "DELETE FROM replay_corpus_venues WHERE corpus_id = ?1",
        params![record.corpus_id],
    )?;
    for venue_key in &record.venue_keys {
        connection.execute(
            "INSERT INTO replay_corpus_venues (corpus_id, venue_key) VALUES (?1, ?2)",
            params![record.corpus_id, venue_key],
        )?;
    }
    connection.execute(
        "DELETE FROM replay_corpus_assets WHERE corpus_id = ?1",
        params![record.corpus_id],
    )?;
    for asset_key in &record.asset_keys {
        connection.execute(
            "INSERT INTO replay_corpus_assets (corpus_id, asset_key) VALUES (?1, ?2)",
            params![record.corpus_id, asset_key],
        )?;
    }
    Ok(())
}

fn load_dataset_snapshot(
    connection: &Connection,
    dataset_id: &str,
    snapshot_id: &str,
) -> Result<Option<RuntimeHistoricalDatasetSnapshotRecord>, HistoricalDataLakeError> {
    connection
        .query_row(
            "SELECT record_json
             FROM historical_dataset_snapshots
             WHERE dataset_id = ?1 AND snapshot_id = ?2",
            params![dataset_id, snapshot_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn load_replay_corpus(
    connection: &Connection,
    corpus_id: &str,
) -> Result<Option<RuntimeReplayCorpusRecord>, HistoricalDataLakeError> {
    connection
        .query_row(
            "SELECT record_json
             FROM replay_corpora
             WHERE corpus_id = ?1",
            params![corpus_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| deserialize_json(&json))
        .transpose()
}

fn initialize_schema(connection: &Connection) -> Result<(), HistoricalDataLakeError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS historical_dataset_snapshots (
            dataset_id TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            dataset_kind TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            record_json TEXT NOT NULL,
            PRIMARY KEY (dataset_id, snapshot_id)
        );
        CREATE TABLE IF NOT EXISTS historical_dataset_snapshot_venues (
            dataset_id TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (dataset_id, snapshot_id, venue_key),
            FOREIGN KEY (dataset_id, snapshot_id)
              REFERENCES historical_dataset_snapshots(dataset_id, snapshot_id)
              ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS historical_dataset_snapshot_assets (
            dataset_id TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (dataset_id, snapshot_id, asset_key),
            FOREIGN KEY (dataset_id, snapshot_id)
              REFERENCES historical_dataset_snapshots(dataset_id, snapshot_id)
              ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS replay_corpora (
            corpus_id TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS replay_corpus_venues (
            corpus_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (corpus_id, venue_key),
            FOREIGN KEY (corpus_id) REFERENCES replay_corpora(corpus_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS replay_corpus_assets (
            corpus_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (corpus_id, asset_key),
            FOREIGN KEY (corpus_id) REFERENCES replay_corpora(corpus_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_historical_dataset_snapshots_lookup
            ON historical_dataset_snapshots (dataset_kind, captured_at DESC, dataset_id DESC, snapshot_id DESC);
        CREATE INDEX IF NOT EXISTS idx_historical_dataset_snapshot_venues_lookup
            ON historical_dataset_snapshot_venues (venue_key, dataset_id, snapshot_id);
        CREATE INDEX IF NOT EXISTS idx_historical_dataset_snapshot_assets_lookup
            ON historical_dataset_snapshot_assets (asset_key, dataset_id, snapshot_id);
        CREATE INDEX IF NOT EXISTS idx_replay_corpora_updated_at
            ON replay_corpora (updated_at DESC, corpus_id DESC);
        CREATE INDEX IF NOT EXISTS idx_replay_corpus_venues_lookup
            ON replay_corpus_venues (venue_key, corpus_id);
        CREATE INDEX IF NOT EXISTS idx_replay_corpus_assets_lookup
            ON replay_corpus_assets (asset_key, corpus_id);",
    )?;
    Ok(())
}

fn dataset_kind_key(kind: &RuntimeHistoricalDatasetKind) -> &'static str {
    match kind {
        RuntimeHistoricalDatasetKind::Trades => "trades",
        RuntimeHistoricalDatasetKind::Bars => "bars",
        RuntimeHistoricalDatasetKind::OrderBookL2 => "order_book_l2",
        RuntimeHistoricalDatasetKind::FundingRates => "funding_rates",
        RuntimeHistoricalDatasetKind::BorrowRates => "borrow_rates",
        RuntimeHistoricalDatasetKind::ReferenceMetadata => "reference_metadata",
        RuntimeHistoricalDatasetKind::MarketEvents => "market_events",
        RuntimeHistoricalDatasetKind::SlotEvents => "slot_events",
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
    std::env::temp_dir().join("runtime-rs/historical-data-lake.sqlite3")
}

fn should_fallback_to_tmp(path: &Path, error: &HistoricalDataLakeError) -> bool {
    !path.starts_with(std::env::temp_dir()) && matches!(error, HistoricalDataLakeError::Io(_))
}

fn serialize_json<T>(value: &T) -> Result<String, HistoricalDataLakeError>
where
    T: Serialize,
{
    Ok(serde_json::to_string(value)?)
}

fn deserialize_json<T>(value: &str) -> Result<T, HistoricalDataLakeError>
where
    T: for<'de> Deserialize<'de>,
{
    Ok(serde_json::from_str(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{RuntimeDatasetSnapshotRef, RuntimeReplayCorpusKind};

    fn lake(name: &str) -> HistoricalDataLake {
        let database_url = format!(".tmp/tests/historical-data-lake/{name}.sqlite3");
        HistoricalDataLake::new(HistoricalDataLakeConfig::new(database_url)).expect("lake")
    }

    #[test]
    fn seeds_builtin_dataset_snapshots_and_replay_corpus() {
        let lake = lake("seed");
        let result = lake
            .query(&HistoricalDataLakeQuery {
                asset_key: Some("SOL".to_string()),
                ..HistoricalDataLakeQuery::default()
            })
            .expect("query");
        assert!(result
            .dataset_snapshots
            .iter()
            .any(|record| record.dataset_id == "dataset_feed_replay_sol_usdc_market_events"));
        assert!(result
            .replay_corpora
            .iter()
            .any(|record| record.corpus_id == "replay_corpus_sol_usdc_feed_gateway_seed"));
    }

    #[test]
    fn rejects_replay_corpora_that_reference_missing_snapshots() {
        let lake = lake("missing-snapshot");
        let error = lake
            .upsert_replay_corpus(&RuntimeReplayCorpusRecord {
                schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                corpus_id: "corpus_missing_snapshot".to_string(),
                title: "Invalid corpus".to_string(),
                summary: "Missing dataset reference".to_string(),
                replay_kind: RuntimeReplayCorpusKind::FeedGatewayV1,
                created_at: SEED_TIMESTAMP.to_string(),
                updated_at: SEED_TIMESTAMP.to_string(),
                venue_keys: vec!["jupiter".to_string()],
                asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
                pair_symbols: vec!["SOL/USDC".to_string()],
                chain_keys: vec!["solana-mainnet".to_string()],
                dataset_snapshots: vec![RuntimeDatasetSnapshotRef {
                    dataset_id: "dataset_missing".to_string(),
                    snapshot_id: "snapshot_missing".to_string(),
                    captured_at: SEED_TIMESTAMP.to_string(),
                    uri: None,
                    content_digest: None,
                }],
                fixture_uri: None,
                content_digest: None,
                deterministic_seed: None,
                tags: vec!["test".to_string()],
                notes: None,
            })
            .expect_err("missing snapshot");
        assert!(matches!(
            error,
            HistoricalDataLakeError::ReplayCorpusDatasetMissing { .. }
        ));
    }

    #[test]
    fn filters_dataset_snapshots_by_kind() {
        let lake = lake("kind-filter");
        let result = lake
            .query(&HistoricalDataLakeQuery {
                dataset_kind: Some(RuntimeHistoricalDatasetKind::MarketEvents),
                ..HistoricalDataLakeQuery::default()
            })
            .expect("query");
        assert_eq!(result.dataset_snapshots.len(), 1);
        assert_eq!(
            result.dataset_snapshots[0].dataset_id,
            "dataset_feed_replay_sol_usdc_market_events"
        );
    }

    #[test]
    fn fixture_path_candidates_include_runtime_image_location() {
        let candidates = fixture_path_candidates();
        assert!(candidates
            .iter()
            .any(|candidate| candidate == &PathBuf::from(format!("/app/{FIXTURE_RELATIVE_PATH}"))));
    }
}
