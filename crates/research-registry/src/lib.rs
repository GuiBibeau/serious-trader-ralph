use std::{
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeResearchCitation, RuntimeResearchEvidenceBundleRecord, RuntimeResearchExperimentRecord,
    RuntimeResearchHypothesisRecord, RuntimeResearchSourceRecord,
};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchRegistryConfig {
    pub database_url: String,
}

impl ResearchRegistryConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResearchRegistry {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRegistrySnapshot {
    pub status: String,
    pub hypothesis_count: u64,
    pub source_count: u64,
    pub experiment_count: u64,
    pub evidence_bundle_count: u64,
    pub latest_experiment_completed_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResearchRegistryQuery {
    pub strategy_key: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchRegistryQueryResult {
    pub hypotheses: Vec<RuntimeResearchHypothesisRecord>,
    pub sources: Vec<RuntimeResearchSourceRecord>,
    pub experiments: Vec<RuntimeResearchExperimentRecord>,
    pub evidence_bundles: Vec<RuntimeResearchEvidenceBundleRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchWriteResult<T> {
    pub record: T,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum ResearchRegistryError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{record_type} {record_id} conflicts with existing identity for {existing_record_id}")]
    IdentityConflict {
        record_type: &'static str,
        record_id: String,
        existing_record_id: String,
    },
    #[error("research source {source_id} not found")]
    SourceNotFound { source_id: String },
    #[error("research hypothesis {hypothesis_id} not found")]
    HypothesisNotFound { hypothesis_id: String },
    #[error("research experiment {experiment_id} not found")]
    ExperimentNotFound { experiment_id: String },
}

impl ResearchRegistry {
    pub fn new(config: ResearchRegistryConfig) -> Result<Self, ResearchRegistryError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(registry) => Ok(registry),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    #[must_use]
    pub fn snapshot_now(&self) -> ResearchRegistrySnapshot {
        match self.snapshot_counts() {
            Ok((
                hypothesis_count,
                source_count,
                experiment_count,
                evidence_bundle_count,
                latest_experiment_completed_at,
            )) => ResearchRegistrySnapshot {
                status: "healthy".to_string(),
                hypothesis_count,
                source_count,
                experiment_count,
                evidence_bundle_count,
                latest_experiment_completed_at,
                last_error: None,
            },
            Err(error) => ResearchRegistrySnapshot {
                status: "degraded".to_string(),
                hypothesis_count: 0,
                source_count: 0,
                experiment_count: 0,
                evidence_bundle_count: 0,
                latest_experiment_completed_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    pub fn upsert_hypothesis(
        &self,
        record: &RuntimeResearchHypothesisRecord,
    ) -> Result<ResearchWriteResult<RuntimeResearchHypothesisRecord>, ResearchRegistryError> {
        let identity_key = hypothesis_identity_key(record)?;
        let source_ids = citation_source_ids(&record.source_citations);
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_sources_exist(&transaction, &record.source_citations)?;
        let outcome = persist_record(
            &transaction,
            PersistSpec {
                table: "research_hypotheses",
                id_column: "hypothesis_id",
                id_value: &record.hypothesis_id,
                identity_key: &identity_key,
                record_type: "research hypothesis",
                record_json: serialize_json(record)?,
                order_column: "updated_at",
                order_value: &record.updated_at,
                venue_keys: &record.venue_keys,
                asset_keys: &record.asset_keys,
                source_ids: &source_ids,
                strategy_key: Some(&record.strategy_key),
                hypothesis_id: None,
                completed_at: None,
                experiment_id: None,
            },
        )?;
        transaction.commit()?;
        let created = persist_result_created(&outcome);
        let record = persist_result_record(outcome, record);
        Ok(ResearchWriteResult { record, created })
    }

    pub fn upsert_source(
        &self,
        record: &RuntimeResearchSourceRecord,
    ) -> Result<ResearchWriteResult<RuntimeResearchSourceRecord>, ResearchRegistryError> {
        let identity_key = source_identity_key(record)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let outcome = persist_record(
            &transaction,
            PersistSpec {
                table: "research_sources",
                id_column: "source_id",
                id_value: &record.source_id,
                identity_key: &identity_key,
                record_type: "research source",
                record_json: serialize_json(record)?,
                order_column: "updated_at",
                order_value: &record.retrieved_at,
                venue_keys: &record.venue_keys,
                asset_keys: &record.asset_keys,
                source_ids: &[],
                strategy_key: None,
                hypothesis_id: None,
                completed_at: None,
                experiment_id: None,
            },
        )?;
        transaction.commit()?;
        let created = persist_result_created(&outcome);
        let record = persist_result_record(outcome, record);
        Ok(ResearchWriteResult { record, created })
    }

    pub fn upsert_experiment(
        &self,
        record: &RuntimeResearchExperimentRecord,
    ) -> Result<ResearchWriteResult<RuntimeResearchExperimentRecord>, ResearchRegistryError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_hypothesis_exists(&transaction, &record.hypothesis_id)?;
        ensure_sources_exist(&transaction, &record.source_citations)?;
        let identity_key = experiment_identity_key(record)?;
        let source_ids = citation_source_ids(&record.source_citations);
        let outcome = persist_record(
            &transaction,
            PersistSpec {
                table: "research_experiments",
                id_column: "experiment_id",
                id_value: &record.experiment_id,
                identity_key: &identity_key,
                record_type: "research experiment",
                record_json: serialize_json(record)?,
                order_column: "updated_at",
                order_value: &record.updated_at,
                venue_keys: &record.venue_keys,
                asset_keys: &record.asset_keys,
                source_ids: &source_ids,
                strategy_key: Some(&record.strategy_key),
                hypothesis_id: Some(&record.hypothesis_id),
                completed_at: record.completed_at.as_deref(),
                experiment_id: None,
            },
        )?;
        transaction.commit()?;
        let created = persist_result_created(&outcome);
        let record = persist_result_record(outcome, record);
        Ok(ResearchWriteResult { record, created })
    }

    pub fn upsert_evidence_bundle(
        &self,
        record: &RuntimeResearchEvidenceBundleRecord,
    ) -> Result<ResearchWriteResult<RuntimeResearchEvidenceBundleRecord>, ResearchRegistryError>
    {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        ensure_experiment_exists(&transaction, &record.experiment_id)?;
        ensure_sources_exist(&transaction, &record.source_citations)?;
        let identity_key = evidence_bundle_identity_key(record)?;
        let source_ids = citation_source_ids(&record.source_citations);
        let outcome = persist_record(
            &transaction,
            PersistSpec {
                table: "research_evidence_bundles",
                id_column: "evidence_bundle_id",
                id_value: &record.evidence_bundle_id,
                identity_key: &identity_key,
                record_type: "research evidence bundle",
                record_json: serialize_json(record)?,
                order_column: "updated_at",
                order_value: &record.updated_at,
                venue_keys: &record.venue_keys,
                asset_keys: &record.asset_keys,
                source_ids: &source_ids,
                strategy_key: Some(&record.strategy_key),
                hypothesis_id: None,
                completed_at: None,
                experiment_id: Some(&record.experiment_id),
            },
        )?;
        transaction.commit()?;
        let created = persist_result_created(&outcome);
        let record = persist_result_record(outcome, record);
        Ok(ResearchWriteResult { record, created })
    }

    pub fn query(
        &self,
        query: &ResearchRegistryQuery,
    ) -> Result<ResearchRegistryQueryResult, ResearchRegistryError> {
        let connection = self.open_connection()?;
        Ok(ResearchRegistryQueryResult {
            hypotheses: query_records::<RuntimeResearchHypothesisRecord>(
                &connection,
                "research_hypotheses",
                "hypothesis_id",
                query,
            )?,
            sources: query_records::<RuntimeResearchSourceRecord>(
                &connection,
                "research_sources",
                "source_id",
                query,
            )?,
            experiments: query_records::<RuntimeResearchExperimentRecord>(
                &connection,
                "research_experiments",
                "experiment_id",
                query,
            )?,
            evidence_bundles: query_records::<RuntimeResearchEvidenceBundleRecord>(
                &connection,
                "research_evidence_bundles",
                "evidence_bundle_id",
                query,
            )?,
        })
    }

    fn snapshot_counts(
        &self,
    ) -> Result<(u64, u64, u64, u64, Option<String>), ResearchRegistryError> {
        let connection = self.open_connection()?;
        let hypothesis_count =
            connection.query_row("SELECT COUNT(*) FROM research_hypotheses", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let source_count =
            connection.query_row("SELECT COUNT(*) FROM research_sources", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let experiment_count =
            connection.query_row("SELECT COUNT(*) FROM research_experiments", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let evidence_bundle_count = connection.query_row(
            "SELECT COUNT(*) FROM research_evidence_bundles",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let latest_experiment_completed_at = connection
            .query_row(
                "SELECT completed_at
                 FROM research_experiments
                 WHERE completed_at IS NOT NULL
                 ORDER BY completed_at DESC, experiment_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok((
            hypothesis_count,
            source_count,
            experiment_count,
            evidence_bundle_count,
            latest_experiment_completed_at,
        ))
    }

    fn open_connection(&self) -> Result<Connection, ResearchRegistryError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(database_path: PathBuf) -> Result<Self, ResearchRegistryError> {
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
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS research_hypotheses (
            hypothesis_id TEXT PRIMARY KEY,
            identity_key TEXT NOT NULL UNIQUE,
            strategy_key TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_hypothesis_venues (
            hypothesis_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (hypothesis_id, venue_key),
            FOREIGN KEY (hypothesis_id) REFERENCES research_hypotheses(hypothesis_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_hypothesis_assets (
            hypothesis_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (hypothesis_id, asset_key),
            FOREIGN KEY (hypothesis_id) REFERENCES research_hypotheses(hypothesis_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_hypothesis_sources (
            hypothesis_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            PRIMARY KEY (hypothesis_id, source_id),
            FOREIGN KEY (hypothesis_id) REFERENCES research_hypotheses(hypothesis_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_sources (
            source_id TEXT PRIMARY KEY,
            identity_key TEXT NOT NULL UNIQUE,
            updated_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_source_venues (
            source_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (source_id, venue_key),
            FOREIGN KEY (source_id) REFERENCES research_sources(source_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_source_assets (
            source_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (source_id, asset_key),
            FOREIGN KEY (source_id) REFERENCES research_sources(source_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_experiments (
            experiment_id TEXT PRIMARY KEY,
            identity_key TEXT NOT NULL UNIQUE,
            strategy_key TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            hypothesis_id TEXT NOT NULL,
            record_json TEXT NOT NULL,
            FOREIGN KEY (hypothesis_id) REFERENCES research_hypotheses(hypothesis_id)
        );
        CREATE TABLE IF NOT EXISTS research_experiment_venues (
            experiment_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (experiment_id, venue_key),
            FOREIGN KEY (experiment_id) REFERENCES research_experiments(experiment_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_experiment_assets (
            experiment_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (experiment_id, asset_key),
            FOREIGN KEY (experiment_id) REFERENCES research_experiments(experiment_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_experiment_sources (
            experiment_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            PRIMARY KEY (experiment_id, source_id),
            FOREIGN KEY (experiment_id) REFERENCES research_experiments(experiment_id) ON DELETE CASCADE,
            FOREIGN KEY (source_id) REFERENCES research_sources(source_id)
        );
        CREATE TABLE IF NOT EXISTS research_evidence_bundles (
            evidence_bundle_id TEXT PRIMARY KEY,
            identity_key TEXT NOT NULL UNIQUE,
            strategy_key TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            experiment_id TEXT NOT NULL,
            record_json TEXT NOT NULL,
            FOREIGN KEY (experiment_id) REFERENCES research_experiments(experiment_id)
        );
        CREATE TABLE IF NOT EXISTS research_evidence_venues (
            evidence_bundle_id TEXT NOT NULL,
            venue_key TEXT NOT NULL,
            PRIMARY KEY (evidence_bundle_id, venue_key),
            FOREIGN KEY (evidence_bundle_id) REFERENCES research_evidence_bundles(evidence_bundle_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_evidence_assets (
            evidence_bundle_id TEXT NOT NULL,
            asset_key TEXT NOT NULL,
            PRIMARY KEY (evidence_bundle_id, asset_key),
            FOREIGN KEY (evidence_bundle_id) REFERENCES research_evidence_bundles(evidence_bundle_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS research_evidence_sources (
            evidence_bundle_id TEXT NOT NULL,
            source_id TEXT NOT NULL,
            PRIMARY KEY (evidence_bundle_id, source_id),
            FOREIGN KEY (evidence_bundle_id) REFERENCES research_evidence_bundles(evidence_bundle_id) ON DELETE CASCADE,
            FOREIGN KEY (source_id) REFERENCES research_sources(source_id)
        );",
    )
}

struct PersistSpec<'a> {
    table: &'static str,
    id_column: &'static str,
    id_value: &'a str,
    identity_key: &'a str,
    record_type: &'static str,
    record_json: String,
    order_column: &'static str,
    order_value: &'a str,
    venue_keys: &'a [String],
    asset_keys: &'a [String],
    source_ids: &'a [String],
    strategy_key: Option<&'a str>,
    hypothesis_id: Option<&'a str>,
    completed_at: Option<&'a str>,
    experiment_id: Option<&'a str>,
}

enum PersistResult<T> {
    Created,
    Updated,
    Existing(T),
}

fn persist_record<T>(
    connection: &Connection,
    spec: PersistSpec<'_>,
) -> Result<PersistResult<T>, ResearchRegistryError>
where
    T: DeserializeOwned + Clone,
{
    if find_record_json_by_id(connection, &spec)?.is_some() {
        let existing_identity = find_identity_key_by_id(connection, &spec)?;
        if existing_identity.as_deref() != Some(spec.identity_key) {
            return Err(ResearchRegistryError::IdentityConflict {
                record_type: spec.record_type,
                record_id: spec.id_value.to_string(),
                existing_record_id: spec.id_value.to_string(),
            });
        }
        update_record(connection, &spec)?;
        return Ok(PersistResult::Updated);
    }

    if let Some(existing_json) = find_record_json_by_identity(connection, &spec)? {
        let existing: T = deserialize_json(&existing_json)?;
        return Ok(PersistResult::Existing(existing));
    }

    let mut columns = vec![spec.id_column, "identity_key"];
    let mut values = vec![
        Value::Text(spec.id_value.to_string()),
        Value::Text(spec.identity_key.to_string()),
    ];

    if let Some(strategy_key) = spec.strategy_key {
        columns.push("strategy_key");
        values.push(Value::Text(strategy_key.to_string()));
    }
    columns.push(spec.order_column);
    values.push(Value::Text(spec.order_value.to_string()));
    if let Some(hypothesis_id) = spec.hypothesis_id {
        columns.push("hypothesis_id");
        values.push(Value::Text(hypothesis_id.to_string()));
    }
    if spec.table == "research_experiments" {
        columns.push("completed_at");
        values.push(match spec.completed_at {
            Some(value) => Value::Text(value.to_string()),
            None => Value::Null,
        });
    }
    if let Some(experiment_id) = spec.experiment_id {
        columns.push("experiment_id");
        values.push(Value::Text(experiment_id.to_string()));
    }
    columns.push("record_json");
    values.push(Value::Text(spec.record_json.clone()));

    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        spec.table,
        columns.join(", "),
        placeholders
    );
    connection.execute(&sql, params_from_iter(values.into_iter()))?;

    replace_key_rows(
        connection,
        spec.table,
        spec.id_column,
        spec.id_value,
        "venue",
        spec.venue_keys,
    )?;
    replace_key_rows(
        connection,
        spec.table,
        spec.id_column,
        spec.id_value,
        "asset",
        spec.asset_keys,
    )?;
    if spec.table != "research_sources" {
        replace_source_rows(
            connection,
            spec.table,
            spec.id_column,
            spec.id_value,
            spec.source_ids,
        )?;
    }

    Ok(PersistResult::Created)
}

fn update_record(
    connection: &Connection,
    spec: &PersistSpec<'_>,
) -> Result<(), ResearchRegistryError> {
    let mut assignments = vec![
        "identity_key = ?1".to_string(),
        "record_json = ?2".to_string(),
    ];
    let mut values = vec![
        Value::Text(spec.identity_key.to_string()),
        Value::Text(spec.record_json.clone()),
    ];

    let mut next_index = values.len() + 1;

    assignments.push(format!("{} = ?{}", spec.order_column, next_index));
    values.push(Value::Text(spec.order_value.to_string()));
    next_index += 1;

    if spec.table != "research_sources" {
        assignments.push(format!("strategy_key = ?{}", next_index));
        values.push(match spec.strategy_key {
            Some(strategy_key) => Value::Text(strategy_key.to_string()),
            None => Value::Null,
        });
        next_index += 1;
    }

    if spec.table == "research_experiments" {
        assignments.push(format!("completed_at = ?{}", next_index));
        values.push(match spec.completed_at {
            Some(completed_at) => Value::Text(completed_at.to_string()),
            None => Value::Null,
        });
        next_index += 1;

        assignments.push(format!("hypothesis_id = ?{}", next_index));
        values.push(match spec.hypothesis_id {
            Some(hypothesis_id) => Value::Text(hypothesis_id.to_string()),
            None => Value::Null,
        });
        next_index += 1;
    }

    if spec.table == "research_evidence_bundles" {
        assignments.push(format!("experiment_id = ?{}", next_index));
        values.push(match spec.experiment_id {
            Some(experiment_id) => Value::Text(experiment_id.to_string()),
            None => Value::Null,
        });
        next_index += 1;
    }

    values.push(Value::Text(spec.id_value.to_string()));
    let sql = format!(
        "UPDATE {} SET {} WHERE {} = ?{}",
        spec.table,
        assignments.join(", "),
        spec.id_column,
        next_index
    );
    connection.execute(&sql, params_from_iter(values.into_iter()))?;

    replace_key_rows(
        connection,
        spec.table,
        spec.id_column,
        spec.id_value,
        "venue",
        spec.venue_keys,
    )?;
    replace_key_rows(
        connection,
        spec.table,
        spec.id_column,
        spec.id_value,
        "asset",
        spec.asset_keys,
    )?;
    if spec.table != "research_sources" {
        replace_source_rows(
            connection,
            spec.table,
            spec.id_column,
            spec.id_value,
            spec.source_ids,
        )?;
    }

    Ok(())
}

fn persist_result_created<T>(result: &PersistResult<T>) -> bool {
    matches!(result, PersistResult::Created)
}

fn persist_result_record<T: Clone>(result: PersistResult<T>, fallback: &T) -> T {
    match result {
        PersistResult::Existing(existing) => existing,
        PersistResult::Created | PersistResult::Updated => fallback.clone(),
    }
}

fn replace_key_rows(
    connection: &Connection,
    table: &str,
    id_column: &str,
    id_value: &str,
    suffix: &str,
    keys: &[String],
) -> Result<(), rusqlite::Error> {
    let link_table = link_table_name(table, suffix);
    let key_column = format!("{}_key", suffix);
    connection.execute(
        &format!("DELETE FROM {link_table} WHERE {id_column} = ?1"),
        params![id_value],
    )?;
    for key in keys {
        connection.execute(
            &format!("INSERT INTO {link_table} ({id_column}, {key_column}) VALUES (?1, ?2)"),
            params![id_value, key],
        )?;
    }
    Ok(())
}

fn replace_source_rows(
    connection: &Connection,
    table: &str,
    id_column: &str,
    id_value: &str,
    source_ids: &[String],
) -> Result<(), rusqlite::Error> {
    let link_table = link_table_name(table, "source");
    connection.execute(
        &format!("DELETE FROM {link_table} WHERE {id_column} = ?1"),
        params![id_value],
    )?;
    for source_id in source_ids {
        connection.execute(
            &format!("INSERT INTO {link_table} ({id_column}, source_id) VALUES (?1, ?2)"),
            params![id_value, source_id],
        )?;
    }
    Ok(())
}

fn query_records<T>(
    connection: &Connection,
    table: &str,
    id_column: &str,
    query: &ResearchRegistryQuery,
) -> Result<Vec<T>, ResearchRegistryError>
where
    T: DeserializeOwned,
{
    let alias = "records";
    let mut sql = format!("SELECT {alias}.record_json FROM {table} {alias} WHERE 1 = 1");
    let mut values = Vec::new();

    if table != "research_sources" {
        if let Some(strategy_key) = query
            .strategy_key
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            sql.push_str(&format!(" AND {alias}.strategy_key = ?"));
            values.push(strategy_key.clone());
        }
    }

    if let Some(venue_key) = query
        .venue_key
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        sql.push_str(&format!(
            " AND EXISTS (
                SELECT 1 FROM {} venue_filter
                WHERE venue_filter.{id_column} = {alias}.{id_column}
                  AND venue_filter.venue_key = ?
            )",
            link_table_name(table, "venue")
        ));
        values.push(venue_key.clone());
    }

    if let Some(asset_key) = query
        .asset_key
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        sql.push_str(&format!(
            " AND EXISTS (
                SELECT 1 FROM {} asset_filter
                WHERE asset_filter.{id_column} = {alias}.{id_column}
                  AND asset_filter.asset_key = ?
            )",
            link_table_name(table, "asset")
        ));
        values.push(asset_key.clone());
    }

    if let Some(source_id) = query
        .source_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        if table == "research_sources" {
            sql.push_str(&format!(" AND {alias}.source_id = ?"));
        } else {
            sql.push_str(&format!(
                " AND EXISTS (
                    SELECT 1 FROM {} source_filter
                    WHERE source_filter.{id_column} = {alias}.{id_column}
                      AND source_filter.source_id = ?
                )",
                link_table_name(table, "source")
            ));
        }
        values.push(source_id.clone());
    }

    sql.push_str(&format!(
        " ORDER BY {alias}.updated_at DESC, {alias}.{id_column} DESC"
    ));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    let mut records = Vec::new();
    for row in rows {
        records.push(deserialize_json(&row?)?);
    }
    Ok(records)
}

fn ensure_sources_exist(
    connection: &Connection,
    citations: &[RuntimeResearchCitation],
) -> Result<(), ResearchRegistryError> {
    for source_id in citation_source_ids(citations) {
        let exists = connection
            .query_row(
                "SELECT 1 FROM research_sources WHERE source_id = ?1 LIMIT 1",
                params![source_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        if !exists {
            return Err(ResearchRegistryError::SourceNotFound { source_id });
        }
    }
    Ok(())
}

fn ensure_hypothesis_exists(
    connection: &Connection,
    hypothesis_id: &str,
) -> Result<(), ResearchRegistryError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM research_hypotheses WHERE hypothesis_id = ?1 LIMIT 1",
            params![hypothesis_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(ResearchRegistryError::HypothesisNotFound {
            hypothesis_id: hypothesis_id.to_string(),
        })
    }
}

fn ensure_experiment_exists(
    connection: &Connection,
    experiment_id: &str,
) -> Result<(), ResearchRegistryError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM research_experiments WHERE experiment_id = ?1 LIMIT 1",
            params![experiment_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(ResearchRegistryError::ExperimentNotFound {
            experiment_id: experiment_id.to_string(),
        })
    }
}

fn find_record_json_by_id(
    connection: &Connection,
    spec: &PersistSpec<'_>,
) -> Result<Option<String>, rusqlite::Error> {
    connection
        .query_row(
            &format!(
                "SELECT record_json FROM {} WHERE {} = ?1 LIMIT 1",
                spec.table, spec.id_column
            ),
            params![spec.id_value],
            |row| row.get::<_, String>(0),
        )
        .optional()
}

fn find_identity_key_by_id(
    connection: &Connection,
    spec: &PersistSpec<'_>,
) -> Result<Option<String>, rusqlite::Error> {
    connection
        .query_row(
            &format!(
                "SELECT identity_key FROM {} WHERE {} = ?1 LIMIT 1",
                spec.table, spec.id_column
            ),
            params![spec.id_value],
            |row| row.get::<_, String>(0),
        )
        .optional()
}

fn find_record_json_by_identity(
    connection: &Connection,
    spec: &PersistSpec<'_>,
) -> Result<Option<String>, rusqlite::Error> {
    connection
        .query_row(
            &format!(
                "SELECT record_json FROM {} WHERE identity_key = ?1 LIMIT 1",
                spec.table
            ),
            params![spec.identity_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
}

fn link_table_name(table: &str, suffix: &str) -> &'static str {
    match (table, suffix) {
        ("research_hypotheses", "venue") => "research_hypothesis_venues",
        ("research_hypotheses", "asset") => "research_hypothesis_assets",
        ("research_hypotheses", "source") => "research_hypothesis_sources",
        ("research_sources", "venue") => "research_source_venues",
        ("research_sources", "asset") => "research_source_assets",
        ("research_experiments", "venue") => "research_experiment_venues",
        ("research_experiments", "asset") => "research_experiment_assets",
        ("research_experiments", "source") => "research_experiment_sources",
        ("research_evidence_bundles", "venue") => "research_evidence_venues",
        ("research_evidence_bundles", "asset") => "research_evidence_assets",
        ("research_evidence_bundles", "source") => "research_evidence_sources",
        _ => panic!("unsupported link table mapping: {table}/{suffix}"),
    }
}

fn citation_source_ids(citations: &[RuntimeResearchCitation]) -> Vec<String> {
    let mut values = citations
        .iter()
        .map(|citation| citation.source_id.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn serialize_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

fn deserialize_json<T: DeserializeOwned>(value: &str) -> Result<T, serde_json::Error> {
    serde_json::from_str(value)
}

fn identity_key<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let canonical = serde_json::to_vec(value)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical);
    Ok(format!("{:x}", hasher.finalize()))
}

fn hypothesis_identity_key(
    record: &RuntimeResearchHypothesisRecord,
) -> Result<String, serde_json::Error> {
    identity_key(&serde_json::json!({
        "strategyKey": record.strategy_key,
        "title": record.title,
        "thesis": record.thesis,
        "venueKeys": sorted_slice(&record.venue_keys),
        "assetKeys": sorted_slice(&record.asset_keys),
        "sourceCitations": sorted_citations(&record.source_citations),
    }))
}

fn source_identity_key(record: &RuntimeResearchSourceRecord) -> Result<String, serde_json::Error> {
    identity_key(&serde_json::json!({
        "sourceId": record.source_id,
    }))
}

fn experiment_identity_key(
    record: &RuntimeResearchExperimentRecord,
) -> Result<String, serde_json::Error> {
    identity_key(&serde_json::json!({
        "hypothesisId": record.hypothesis_id,
        "strategyKey": record.strategy_key,
        "venueKeys": sorted_slice(&record.venue_keys),
        "assetKeys": sorted_slice(&record.asset_keys),
        "sourceCitations": sorted_citations(&record.source_citations),
        "codeRevision": record.code_revision,
        "datasetSnapshots": sorted_dataset_snapshots(&record.dataset_snapshots),
    }))
}

fn evidence_bundle_identity_key(
    record: &RuntimeResearchEvidenceBundleRecord,
) -> Result<String, serde_json::Error> {
    identity_key(&serde_json::json!({
        "experimentId": record.experiment_id,
        "promotionTarget": record.promotion_target,
        "venueKeys": sorted_slice(&record.venue_keys),
        "assetKeys": sorted_slice(&record.asset_keys),
        "sourceCitations": sorted_citations(&record.source_citations),
        "codeRevision": record.code_revision,
        "datasetSnapshots": sorted_dataset_snapshots(&record.dataset_snapshots),
        "artifacts": sorted_artifacts(&record.artifacts),
    }))
}

fn sorted_slice(values: &[String]) -> Vec<String> {
    let mut normalized = values
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn sorted_citations(citations: &[RuntimeResearchCitation]) -> Vec<RuntimeResearchCitation> {
    let mut normalized = citations.to_vec();
    normalized.sort_by(|left, right| {
        (
            left.source_id.as_str(),
            left.locator.as_deref().unwrap_or(""),
            left.material_digest.as_deref().unwrap_or(""),
            left.notes.as_deref().unwrap_or(""),
        )
            .cmp(&(
                right.source_id.as_str(),
                right.locator.as_deref().unwrap_or(""),
                right.material_digest.as_deref().unwrap_or(""),
                right.notes.as_deref().unwrap_or(""),
            ))
    });
    normalized
}

fn sorted_dataset_snapshots(
    values: &[protocol::RuntimeDatasetSnapshotRef],
) -> Vec<protocol::RuntimeDatasetSnapshotRef> {
    let mut normalized = values.to_vec();
    normalized.sort_by(|left, right| {
        (
            left.dataset_id.as_str(),
            left.snapshot_id.as_str(),
            left.captured_at.as_str(),
        )
            .cmp(&(
                right.dataset_id.as_str(),
                right.snapshot_id.as_str(),
                right.captured_at.as_str(),
            ))
    });
    normalized
}

fn sorted_artifacts(values: &[protocol::RuntimeArtifactRef]) -> Vec<protocol::RuntimeArtifactRef> {
    let mut normalized = values.to_vec();
    normalized.sort_by(|left, right| {
        (
            left.artifact_id.as_str(),
            left.kind.as_str(),
            left.uri.as_str(),
        )
            .cmp(&(
                right.artifact_id.as_str(),
                right.kind.as_str(),
                right.uri.as_str(),
            ))
    });
    normalized
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return fallback_database_path();
    }
    if trimmed == ":memory:" {
        return PathBuf::from(trimmed);
    }
    PathBuf::from(trimmed)
}

fn fallback_database_path() -> PathBuf {
    if let Ok(workspace_root) = std::env::var("CARGO_WORKSPACE_DIR") {
        return PathBuf::from(workspace_root)
            .join(".tmp/runtime-rs")
            .join("research-registry.sqlite3");
    }
    PathBuf::from(".tmp/runtime-rs/research-registry.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &ResearchRegistryError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path().as_path()
    {
        return false;
    }
    matches!(
        error,
        ResearchRegistryError::Io(_) | ResearchRegistryError::Storage(_)
    )
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use protocol::{
        RuntimeArtifactRef, RuntimeCodeRevisionRef, RuntimeDatasetSnapshotRef,
        RuntimeResearchEvidenceStatus, RuntimeResearchExperimentStatus,
        RuntimeResearchHypothesisStatus, RuntimeResearchSourceKind,
        RUNTIME_PROTOCOL_SCHEMA_VERSION,
    };

    use super::*;

    fn database_path(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time to move forward")
            .as_nanos();
        PathBuf::from(".tmp/runtime-rs/tests")
            .join(format!("research-registry-{test_name}-{unique}.sqlite3"))
    }

    fn registry(test_name: &str) -> ResearchRegistry {
        ResearchRegistry::new(ResearchRegistryConfig::new(
            database_path(test_name).to_string_lossy().to_string(),
        ))
        .expect("research registry to initialize")
    }

    fn citation(source_id: &str) -> RuntimeResearchCitation {
        RuntimeResearchCitation {
            source_id: source_id.to_string(),
            locator: Some("sec-2".to_string()),
            material_digest: Some("sha256:citation".to_string()),
            notes: Some("evidence".to_string()),
        }
    }

    fn code_revision() -> RuntimeCodeRevisionRef {
        RuntimeCodeRevisionRef {
            vcs: "git".to_string(),
            repository: "github.com/GuiBibeau/serious-trader-ralph".to_string(),
            revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a".to_string(),
            compared_to: Some("main~1".to_string()),
            tree_dirty: false,
        }
    }

    fn dataset_snapshot() -> RuntimeDatasetSnapshotRef {
        RuntimeDatasetSnapshotRef {
            dataset_id: "dataset_features_sol_usdc".to_string(),
            snapshot_id: "snapshot_2026_03_10".to_string(),
            captured_at: "2026-03-10T15:00:00Z".to_string(),
            uri: Some("r2://datasets/features/2026-03-10.parquet".to_string()),
            content_digest: Some("sha256:dataset".to_string()),
        }
    }

    fn artifact(id: &str, kind: &str) -> RuntimeArtifactRef {
        RuntimeArtifactRef {
            artifact_id: id.to_string(),
            kind: kind.to_string(),
            uri: format!("r2://artifacts/{id}.json"),
            content_digest: Some(format!("sha256:{id}")),
            created_at: Some("2026-03-10T15:10:00Z".to_string()),
            notes: None,
        }
    }

    fn source_record() -> RuntimeResearchSourceRecord {
        RuntimeResearchSourceRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            source_id: "source_paper_microstructure".to_string(),
            source_kind: RuntimeResearchSourceKind::Paper,
            title: "Microstructure signals for crypto execution".to_string(),
            url: "https://example.com/papers/microstructure".to_string(),
            canonical_url: "https://example.com/papers/microstructure".to_string(),
            authors: vec!["Ada Researcher".to_string()],
            published_at: Some("2026-02-01T00:00:00Z".to_string()),
            retrieved_at: "2026-03-10T14:00:00Z".to_string(),
            content_digest: "sha256:paper".to_string(),
            provenance: protocol::RuntimeResearchSourceProvenance {
                acquisition_kind: protocol::RuntimeResearchSourceAcquisitionKind::PaperFeed,
                collected_from: "https://example.com/feed/crypto.xml".to_string(),
                hostname: "example.com".to_string(),
                publisher: Some("Example Research".to_string()),
                first_seen_at: Some("2026-03-10T14:00:00Z".to_string()),
                last_seen_at: "2026-03-10T14:00:00Z".to_string(),
            },
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            tags: vec!["signal".to_string()],
        }
    }

    fn hypothesis_record() -> RuntimeResearchHypothesisRecord {
        RuntimeResearchHypothesisRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            hypothesis_id: "hypothesis_signal_trend".to_string(),
            strategy_key: "trend_following".to_string(),
            title: "Trend continuation after liquidity shocks".to_string(),
            thesis: "High-quality liquidity shocks should resolve into short continuation bursts."
                .to_string(),
            status: RuntimeResearchHypothesisStatus::Candidate,
            created_at: "2026-03-10T14:05:00Z".to_string(),
            updated_at: "2026-03-10T14:05:00Z".to_string(),
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            source_citations: vec![citation("source_paper_microstructure")],
            tags: vec!["candidate".to_string()],
        }
    }

    fn experiment_record() -> RuntimeResearchExperimentRecord {
        RuntimeResearchExperimentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            experiment_id: "experiment_signal_trend_shadow".to_string(),
            hypothesis_id: "hypothesis_signal_trend".to_string(),
            strategy_key: "trend_following".to_string(),
            status: RuntimeResearchExperimentStatus::Completed,
            created_at: "2026-03-10T14:10:00Z".to_string(),
            updated_at: "2026-03-10T14:20:00Z".to_string(),
            completed_at: Some("2026-03-10T14:20:00Z".to_string()),
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            source_citations: vec![citation("source_paper_microstructure")],
            code_revision: code_revision(),
            dataset_snapshots: vec![dataset_snapshot()],
            artifacts: vec![artifact("replay-1", "replay-report")],
            summary: "Shadow replay passed the initial trigger-quality gate.".to_string(),
            tags: vec!["shadow".to_string()],
        }
    }

    fn evidence_bundle_record() -> RuntimeResearchEvidenceBundleRecord {
        RuntimeResearchEvidenceBundleRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            evidence_bundle_id: "evidence_signal_trend_shadow".to_string(),
            experiment_id: "experiment_signal_trend_shadow".to_string(),
            strategy_key: "trend_following".to_string(),
            status: RuntimeResearchEvidenceStatus::ReadyForReview,
            promotion_target: "paper".to_string(),
            created_at: "2026-03-10T14:21:00Z".to_string(),
            updated_at: "2026-03-10T14:21:00Z".to_string(),
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            source_citations: vec![citation("source_paper_microstructure")],
            code_revision: code_revision(),
            dataset_snapshots: vec![dataset_snapshot()],
            artifacts: vec![
                artifact("proof-markdown", "proof-bundle"),
                artifact("shadow-scorecard", "scorecard"),
            ],
            summary: "Evidence bundle for shadow-to-paper review.".to_string(),
            tags: vec!["promotion".to_string()],
        }
    }

    #[test]
    fn stores_and_queries_research_records() {
        let registry = registry("query");
        assert!(
            registry
                .upsert_source(&source_record())
                .expect("source")
                .created
        );
        assert!(
            registry
                .upsert_hypothesis(&hypothesis_record())
                .expect("hypothesis")
                .created
        );
        assert!(
            registry
                .upsert_experiment(&experiment_record())
                .expect("experiment")
                .created
        );
        assert!(
            registry
                .upsert_evidence_bundle(&evidence_bundle_record())
                .expect("evidence")
                .created
        );

        let result = registry
            .query(&ResearchRegistryQuery {
                strategy_key: Some("trend_following".to_string()),
                venue_key: Some("jupiter".to_string()),
                asset_key: Some("SOL".to_string()),
                source_id: Some("source_paper_microstructure".to_string()),
            })
            .expect("query");

        assert_eq!(result.hypotheses.len(), 1);
        assert_eq!(result.sources.len(), 1);
        assert_eq!(result.experiments.len(), 1);
        assert_eq!(result.evidence_bundles.len(), 1);
        assert_eq!(
            result.experiments[0].code_revision.revision,
            code_revision().revision
        );

        let snapshot = registry.snapshot_now();
        assert_eq!(snapshot.hypothesis_count, 1);
        assert_eq!(snapshot.source_count, 1);
        assert_eq!(snapshot.experiment_count, 1);
        assert_eq!(snapshot.evidence_bundle_count, 1);
        assert_eq!(
            snapshot.latest_experiment_completed_at,
            Some("2026-03-10T14:20:00Z".to_string())
        );
    }

    #[test]
    fn deduplicates_same_experiment_identity() {
        let registry = registry("idempotent");
        registry.upsert_source(&source_record()).expect("source");
        registry
            .upsert_hypothesis(&hypothesis_record())
            .expect("hypothesis");

        let first = registry
            .upsert_experiment(&experiment_record())
            .expect("first experiment");
        let mut duplicate = experiment_record();
        duplicate.experiment_id = "experiment_duplicate_id".to_string();
        let second = registry
            .upsert_experiment(&duplicate)
            .expect("duplicate experiment");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(
            second.record.experiment_id,
            "experiment_signal_trend_shadow"
        );
    }

    #[test]
    fn updates_existing_experiment_with_same_id() {
        let registry = registry("update-existing");
        registry.upsert_source(&source_record()).expect("source");
        registry
            .upsert_hypothesis(&hypothesis_record())
            .expect("hypothesis");

        let first = registry
            .upsert_experiment(&experiment_record())
            .expect("first experiment");
        let mut updated = experiment_record();
        updated.status = RuntimeResearchExperimentStatus::Running;
        updated.updated_at = "2026-03-10T14:25:00Z".to_string();
        updated.completed_at = None;
        updated.summary = "Experiment is still running after a replay extension.".to_string();
        updated.tags = vec!["shadow".to_string(), "extended".to_string()];
        let second = registry
            .upsert_experiment(&updated)
            .expect("updated experiment");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(
            second.record.status,
            RuntimeResearchExperimentStatus::Running
        );
        assert_eq!(second.record.updated_at, updated.updated_at);
        assert_eq!(second.record.completed_at, None);
        assert_eq!(second.record.summary, updated.summary);
        assert_eq!(second.record.tags, updated.tags);

        let query = registry
            .query(&ResearchRegistryQuery {
                strategy_key: Some("trend_following".to_string()),
                venue_key: Some("jupiter".to_string()),
                asset_key: Some("SOL".to_string()),
                source_id: Some("source_paper_microstructure".to_string()),
            })
            .expect("query");
        assert_eq!(query.experiments.len(), 1);
        assert_eq!(
            query.experiments[0].status,
            RuntimeResearchExperimentStatus::Running
        );
        assert_eq!(query.experiments[0].completed_at, None);
    }

    #[test]
    fn refreshes_existing_source_when_content_digest_changes() {
        let registry = registry("refresh-source");
        let first = registry
            .upsert_source(&source_record())
            .expect("first source write");
        let mut refreshed = source_record();
        refreshed.retrieved_at = "2026-03-12T14:00:00Z".to_string();
        refreshed.content_digest = "sha256:paper-refreshed".to_string();
        refreshed.provenance.last_seen_at = refreshed.retrieved_at.clone();
        let second = registry
            .upsert_source(&refreshed)
            .expect("refreshed source write");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(second.record.source_id, first.record.source_id);
        assert_eq!(second.record.content_digest, "sha256:paper-refreshed");
        assert_eq!(second.record.retrieved_at, "2026-03-12T14:00:00Z");

        let query = registry
            .query(&ResearchRegistryQuery {
                strategy_key: None,
                venue_key: Some("jupiter".to_string()),
                asset_key: Some("SOL".to_string()),
                source_id: Some("source_paper_microstructure".to_string()),
            })
            .expect("query");
        assert_eq!(query.sources.len(), 1);
        assert_eq!(query.sources[0].content_digest, "sha256:paper-refreshed");
    }

    #[test]
    fn rejects_hypothesis_citations_for_missing_source() {
        let registry = registry("missing-source");
        let error = registry
            .upsert_hypothesis(&hypothesis_record())
            .expect_err("missing source should be rejected");

        assert!(matches!(
            error,
            ResearchRegistryError::SourceNotFound { source_id }
                if source_id == "source_paper_microstructure"
        ));
    }
}
