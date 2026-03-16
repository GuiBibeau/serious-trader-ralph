use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeExecutionPlan, RuntimeLedgerBalance, RuntimeLedgerPosition, RuntimeLedgerSnapshot,
    RuntimeMode, RuntimeReconciliationResult, RuntimeReconciliationStatus, RuntimeWalletDelta,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconcilerConfig {
    pub database_url: String,
}

impl ReconcilerConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Reconciler {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationThresholds {
    pub warn_total_delta_usd: String,
    pub fail_total_delta_usd: String,
    pub auto_correct_max_total_delta_usd: String,
    pub warn_position_delta_usd: String,
    pub fail_position_delta_usd: String,
}

impl Default for ReconciliationThresholds {
    fn default() -> Self {
        Self {
            warn_total_delta_usd: "1.00".to_string(),
            fail_total_delta_usd: "10.00".to_string(),
            auto_correct_max_total_delta_usd: "2.50".to_string(),
            warn_position_delta_usd: "2.00".to_string(),
            fail_position_delta_usd: "15.00".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcilerSnapshot {
    pub status: String,
    pub submit_attempt_count: u64,
    pub receipt_count: u64,
    pub wallet_observation_count: u64,
    pub reconciliation_count: u64,
    pub drift_alert_count: u64,
    pub latest_completed_at: Option<String>,
    pub thresholds: ReconciliationThresholds,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSubmitAttemptRecord {
    pub attempt_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub plan_id: String,
    pub submit_request_id: String,
    pub recorded_at: String,
    pub mode: RuntimeMode,
    pub source: String,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReceiptObservation {
    pub receipt_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub submit_request_id: String,
    pub observed_at: String,
    pub source: String,
    pub status: String,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeWalletObservationRecord {
    pub observation_id: String,
    pub deployment_id: String,
    pub run_id: String,
    pub observed_at: String,
    pub source: String,
    pub snapshot: RuntimeLedgerSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciliationInput {
    pub deployment_id: String,
    pub run_id: String,
    pub plan: RuntimeExecutionPlan,
    pub receipt: RuntimeReceiptObservation,
    pub expected_ledger: RuntimeLedgerSnapshot,
    pub observed_ledger: RuntimeLedgerSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciliationOutcome {
    pub result: RuntimeReconciliationResult,
    pub should_apply_correction: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciliationBundle {
    pub submit_attempts: Vec<RuntimeSubmitAttemptRecord>,
    pub receipts: Vec<RuntimeReceiptObservation>,
    pub wallet_observations: Vec<RuntimeWalletObservationRecord>,
    pub results: Vec<RuntimeReconciliationResult>,
    pub thresholds: ReconciliationThresholds,
}

#[derive(Debug, Error)]
pub enum ReconcilerError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid numeric value for {field}: {value}")]
    InvalidNumericValue { field: &'static str, value: String },
    #[error("reconciliation result {run_id} not found")]
    ResultNotFound { run_id: String },
}

impl Reconciler {
    pub fn new(config: ReconcilerConfig) -> Result<Self, ReconcilerError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(reconciler) => Ok(reconciler),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn record_submit_attempt(
        &self,
        plan: &RuntimeExecutionPlan,
        submit_request_id: &str,
        accepted: bool,
        source: &str,
    ) -> Result<RuntimeSubmitAttemptRecord, ReconcilerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        if let Some(existing) = load_submit_attempt_by_run_id(&transaction, &plan.run_id)? {
            transaction.commit()?;
            return Ok(existing);
        }

        let record = RuntimeSubmitAttemptRecord {
            attempt_id: build_prefixed_id(
                "attempt",
                &format!("{}:{submit_request_id}", plan.run_id),
            ),
            deployment_id: plan.deployment_id.clone(),
            run_id: plan.run_id.clone(),
            plan_id: plan.plan_id.clone(),
            submit_request_id: submit_request_id.to_string(),
            recorded_at: now_rfc3339(),
            mode: plan.mode.clone(),
            source: source.to_string(),
            accepted,
        };
        transaction.execute(
            "INSERT INTO runtime_submit_attempts (
                attempt_id,
                deployment_id,
                run_id,
                plan_id,
                submit_request_id,
                recorded_at,
                mode,
                source,
                accepted,
                record_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &record.attempt_id,
                &record.deployment_id,
                &record.run_id,
                &record.plan_id,
                &record.submit_request_id,
                &record.recorded_at,
                mode_key(&record.mode),
                &record.source,
                record.accepted,
                serialize_json(&record)?,
            ],
        )?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn record_synthetic_receipt(
        &self,
        plan: &RuntimeExecutionPlan,
        submit_request_id: &str,
        source: &str,
        status: &str,
        notes: &[&str],
    ) -> Result<RuntimeReceiptObservation, ReconcilerError> {
        self.record_receipt_observation(
            plan,
            &RuntimeReceiptObservation {
                receipt_id: build_prefixed_id("receipt", submit_request_id),
                deployment_id: plan.deployment_id.clone(),
                run_id: plan.run_id.clone(),
                submit_request_id: submit_request_id.to_string(),
                observed_at: now_rfc3339(),
                source: source.to_string(),
                status: status.to_string(),
                notes: notes.iter().map(|note| (*note).to_string()).collect(),
            },
        )
    }

    pub fn record_receipt_observation(
        &self,
        plan: &RuntimeExecutionPlan,
        receipt: &RuntimeReceiptObservation,
    ) -> Result<RuntimeReceiptObservation, ReconcilerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        if let Some(existing) = load_receipt_by_run_id(&transaction, &plan.run_id)? {
            transaction.commit()?;
            return Ok(existing);
        }
        transaction.execute(
            "INSERT INTO runtime_receipts (
                receipt_id,
                deployment_id,
                run_id,
                submit_request_id,
                observed_at,
                source,
                status,
                record_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &receipt.receipt_id,
                &receipt.deployment_id,
                &receipt.run_id,
                &receipt.submit_request_id,
                &receipt.observed_at,
                &receipt.source,
                &receipt.status,
                serialize_json(receipt)?,
            ],
        )?;
        transaction.commit()?;
        Ok(receipt.clone())
    }

    pub fn record_wallet_observation(
        &self,
        deployment_id: &str,
        run_id: &str,
        source: &str,
        snapshot: &RuntimeLedgerSnapshot,
    ) -> Result<RuntimeWalletObservationRecord, ReconcilerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        if let Some(existing) = load_wallet_observation_by_run_id(&transaction, run_id)? {
            transaction.commit()?;
            return Ok(existing);
        }

        let record = RuntimeWalletObservationRecord {
            observation_id: build_prefixed_id("wallet", run_id),
            deployment_id: deployment_id.to_string(),
            run_id: run_id.to_string(),
            observed_at: now_rfc3339(),
            source: source.to_string(),
            snapshot: snapshot.clone(),
        };
        transaction.execute(
            "INSERT INTO runtime_wallet_observations (
                observation_id,
                deployment_id,
                run_id,
                observed_at,
                source,
                snapshot_json,
                record_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &record.observation_id,
                &record.deployment_id,
                &record.run_id,
                &record.observed_at,
                &record.source,
                serialize_json(snapshot)?,
                serialize_json(&record)?,
            ],
        )?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn reconcile_and_store(
        &self,
        input: &ReconciliationInput,
    ) -> Result<ReconciliationOutcome, ReconcilerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        if let Some(existing) = load_result_by_run_id(&transaction, &input.run_id)? {
            transaction.commit()?;
            return Ok(ReconciliationOutcome {
                result: existing,
                should_apply_correction: false,
            });
        }

        let wallet_deltas = wallet_deltas(&input.expected_ledger, &input.observed_ledger)?;
        let total_wallet_delta_cents =
            total_wallet_delta_usd_cents(&input.expected_ledger, &input.observed_ledger)?;
        let position_delta_cents = position_delta_usd_cents(
            &input.expected_ledger.positions,
            &input.observed_ledger.positions,
        )?;
        let thresholds = ReconciliationThresholds::default();
        let warn_total_cents = parse_usd_cents(
            "thresholds.warnTotalDeltaUsd",
            &thresholds.warn_total_delta_usd,
        )?;
        let fail_total_cents = parse_usd_cents(
            "thresholds.failTotalDeltaUsd",
            &thresholds.fail_total_delta_usd,
        )?;
        let auto_correct_cents = parse_usd_cents(
            "thresholds.autoCorrectMaxTotalDeltaUsd",
            &thresholds.auto_correct_max_total_delta_usd,
        )?;
        let warn_position_cents = parse_usd_cents(
            "thresholds.warnPositionDeltaUsd",
            &thresholds.warn_position_delta_usd,
        )?;
        let fail_position_cents = parse_usd_cents(
            "thresholds.failPositionDeltaUsd",
            &thresholds.fail_position_delta_usd,
        )?;

        let status = if total_wallet_delta_cents >= fail_total_cents
            || position_delta_cents >= fail_position_cents
        {
            RuntimeReconciliationStatus::Failed
        } else if total_wallet_delta_cents > warn_total_cents
            || position_delta_cents > warn_position_cents
        {
            RuntimeReconciliationStatus::NeedsManualReview
        } else {
            RuntimeReconciliationStatus::Passed
        };
        let should_apply_correction = total_wallet_delta_cents > 0
            && total_wallet_delta_cents <= auto_correct_cents
            && status == RuntimeReconciliationStatus::Passed;
        let notes = build_notes(
            &status,
            total_wallet_delta_cents,
            position_delta_cents,
            should_apply_correction,
        );
        let result = RuntimeReconciliationResult {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            reconciliation_id: build_prefixed_id(
                "recon",
                &format!("{}:{}", input.run_id, input.receipt.receipt_id),
            ),
            deployment_id: input.deployment_id.clone(),
            run_id: input.run_id.clone(),
            receipt_id: input.receipt.receipt_id.clone(),
            completed_at: now_rfc3339(),
            status,
            wallet_deltas,
            position_delta_usd: format_usd_cents(position_delta_cents),
            notes,
            correction_applied: should_apply_correction,
        };
        transaction.execute(
            "INSERT INTO runtime_reconciliation_results (
                reconciliation_id,
                deployment_id,
                run_id,
                receipt_id,
                completed_at,
                status,
                correction_applied,
                record_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                &result.reconciliation_id,
                &result.deployment_id,
                &result.run_id,
                &result.receipt_id,
                &result.completed_at,
                reconciliation_status_key(&result.status),
                result.correction_applied,
                serialize_json(&result)?,
            ],
        )?;
        transaction.commit()?;
        Ok(ReconciliationOutcome {
            result,
            should_apply_correction,
        })
    }

    pub fn get_result_by_run_id(
        &self,
        run_id: &str,
    ) -> Result<Option<RuntimeReconciliationResult>, ReconcilerError> {
        let connection = self.open_connection()?;
        load_result_by_run_id(&connection, run_id)
    }

    pub fn get_submit_attempt_by_run_id(
        &self,
        run_id: &str,
    ) -> Result<Option<RuntimeSubmitAttemptRecord>, ReconcilerError> {
        let connection = self.open_connection()?;
        load_submit_attempt_by_run_id(&connection, run_id)
    }

    pub fn get_receipt_by_run_id(
        &self,
        run_id: &str,
    ) -> Result<Option<RuntimeReceiptObservation>, ReconcilerError> {
        let connection = self.open_connection()?;
        load_receipt_by_run_id(&connection, run_id)
    }

    pub fn get_wallet_observation_by_run_id(
        &self,
        run_id: &str,
    ) -> Result<Option<RuntimeWalletObservationRecord>, ReconcilerError> {
        let connection = self.open_connection()?;
        load_wallet_observation_by_run_id(&connection, run_id)
    }

    pub fn bundle_for_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<ReconciliationBundle, ReconcilerError> {
        let connection = self.open_connection()?;
        Ok(ReconciliationBundle {
            submit_attempts: list_records(
                &connection,
                "SELECT record_json FROM runtime_submit_attempts WHERE deployment_id = ?1 ORDER BY recorded_at DESC, attempt_id DESC",
                deployment_id,
            )?,
            receipts: list_records(
                &connection,
                "SELECT record_json FROM runtime_receipts WHERE deployment_id = ?1 ORDER BY observed_at DESC, receipt_id DESC",
                deployment_id,
            )?,
            wallet_observations: list_records(
                &connection,
                "SELECT record_json FROM runtime_wallet_observations WHERE deployment_id = ?1 ORDER BY observed_at DESC, observation_id DESC",
                deployment_id,
            )?,
            results: list_records(
                &connection,
                "SELECT record_json FROM runtime_reconciliation_results WHERE deployment_id = ?1 ORDER BY completed_at DESC, reconciliation_id DESC",
                deployment_id,
            )?,
            thresholds: ReconciliationThresholds::default(),
        })
    }

    #[must_use]
    pub fn snapshot_now(&self) -> ReconcilerSnapshot {
        match self.snapshot_counts() {
            Ok(snapshot) => snapshot,
            Err(error) => ReconcilerSnapshot {
                status: "degraded".to_string(),
                submit_attempt_count: 0,
                receipt_count: 0,
                wallet_observation_count: 0,
                reconciliation_count: 0,
                drift_alert_count: 0,
                latest_completed_at: None,
                thresholds: ReconciliationThresholds::default(),
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<ReconcilerSnapshot, ReconcilerError> {
        let connection = self.open_connection()?;
        let submit_attempt_count =
            connection.query_row("SELECT COUNT(*) FROM runtime_submit_attempts", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let receipt_count =
            connection.query_row("SELECT COUNT(*) FROM runtime_receipts", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let wallet_observation_count = connection.query_row(
            "SELECT COUNT(*) FROM runtime_wallet_observations",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let reconciliation_count = connection.query_row(
            "SELECT COUNT(*) FROM runtime_reconciliation_results",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let drift_alert_count = connection.query_row(
            "SELECT COUNT(*) FROM runtime_reconciliation_results WHERE status != 'passed'",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let latest_completed_at = connection
            .query_row(
                "SELECT completed_at FROM runtime_reconciliation_results ORDER BY completed_at DESC, reconciliation_id DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;

        Ok(ReconcilerSnapshot {
            status: "healthy".to_string(),
            submit_attempt_count,
            receipt_count,
            wallet_observation_count,
            reconciliation_count,
            drift_alert_count,
            latest_completed_at,
            thresholds: ReconciliationThresholds::default(),
            last_error: None,
        })
    }

    fn open_connection(&self) -> Result<Connection, ReconcilerError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(database_path: PathBuf) -> Result<Self, ReconcilerError> {
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let reconciler = Self { database_path };
        let connection = reconciler.open_connection()?;
        initialize_schema(&connection)?;
        Ok(reconciler)
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS runtime_submit_attempts (
            attempt_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            plan_id TEXT NOT NULL,
            submit_request_id TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            mode TEXT NOT NULL,
            source TEXT NOT NULL,
            accepted INTEGER NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_submit_attempts_deployment
            ON runtime_submit_attempts (deployment_id, recorded_at DESC);

        CREATE TABLE IF NOT EXISTS runtime_receipts (
            receipt_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            submit_request_id TEXT NOT NULL,
            observed_at TEXT NOT NULL,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_receipts_deployment
            ON runtime_receipts (deployment_id, observed_at DESC);

        CREATE TABLE IF NOT EXISTS runtime_wallet_observations (
            observation_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            observed_at TEXT NOT NULL,
            source TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_wallet_observations_deployment
            ON runtime_wallet_observations (deployment_id, observed_at DESC);

        CREATE TABLE IF NOT EXISTS runtime_reconciliation_results (
            reconciliation_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            receipt_id TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            status TEXT NOT NULL,
            correction_applied INTEGER NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_reconciliation_results_deployment
            ON runtime_reconciliation_results (deployment_id, completed_at DESC);",
    )
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return PathBuf::from(".tmp/runtime-rs/reconciler.sqlite3");
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
        .join("reconciler.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &ReconcilerError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path() {
        return false;
    }
    match error {
        ReconcilerError::Io(inner) => inner.kind() == std::io::ErrorKind::PermissionDenied,
        ReconcilerError::Storage(inner) => {
            matches!(
                inner,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::CannotOpen
            )
        }
        ReconcilerError::Serialization(_)
        | ReconcilerError::InvalidNumericValue { .. }
        | ReconcilerError::ResultNotFound { .. } => false,
    }
}

fn wallet_deltas(
    expected: &RuntimeLedgerSnapshot,
    observed: &RuntimeLedgerSnapshot,
) -> Result<Vec<RuntimeWalletDelta>, ReconcilerError> {
    let mut expected_by_mint = BTreeMap::new();
    let mut observed_by_mint = BTreeMap::new();
    for balance in &expected.balances {
        expected_by_mint.insert(balance.mint.clone(), balance);
    }
    for balance in &observed.balances {
        observed_by_mint.insert(balance.mint.clone(), balance);
    }

    let mut all_mints = BTreeSet::new();
    all_mints.extend(expected_by_mint.keys().cloned());
    all_mints.extend(observed_by_mint.keys().cloned());

    let mut deltas = Vec::new();
    for mint in all_mints {
        let expected_balance = expected_by_mint.get(&mint).copied();
        let observed_balance = observed_by_mint.get(&mint).copied();
        let expected_atomic = total_atomic(expected_balance)?;
        let actual_atomic = total_atomic(observed_balance)?;
        deltas.push(RuntimeWalletDelta {
            mint,
            expected_atomic: expected_atomic.to_string(),
            actual_atomic: actual_atomic.to_string(),
            delta_atomic: (actual_atomic - expected_atomic).to_string(),
        });
    }
    Ok(deltas)
}

fn total_atomic(balance: Option<&RuntimeLedgerBalance>) -> Result<i128, ReconcilerError> {
    let Some(balance) = balance else {
        return Ok(0);
    };
    let free = parse_atomic_i128("balances.freeAtomic", &balance.free_atomic)?;
    let reserved = parse_atomic_i128("balances.reservedAtomic", &balance.reserved_atomic)?;
    Ok(free + reserved)
}

fn total_wallet_delta_usd_cents(
    expected: &RuntimeLedgerSnapshot,
    observed: &RuntimeLedgerSnapshot,
) -> Result<i64, ReconcilerError> {
    let expected_cents = parse_usd_cents(
        "expectedLedger.totals.equityUsd",
        &expected.totals.equity_usd,
    )?;
    let observed_cents = parse_usd_cents(
        "observedLedger.totals.equityUsd",
        &observed.totals.equity_usd,
    )?;
    Ok((observed_cents - expected_cents).abs())
}

fn position_delta_usd_cents(
    expected: &[RuntimeLedgerPosition],
    observed: &[RuntimeLedgerPosition],
) -> Result<i64, ReconcilerError> {
    let mut expected_by_instrument = BTreeMap::new();
    let mut observed_by_instrument = BTreeMap::new();
    for position in expected {
        expected_by_instrument.insert(position.instrument_id.clone(), position);
    }
    for position in observed {
        observed_by_instrument.insert(position.instrument_id.clone(), position);
    }
    let mut instruments = BTreeSet::new();
    instruments.extend(expected_by_instrument.keys().cloned());
    instruments.extend(observed_by_instrument.keys().cloned());

    let mut total = 0_i64;
    for instrument in instruments {
        let expected_cents = expected_by_instrument
            .get(&instrument)
            .and_then(|position| position.unrealized_pnl_usd.as_deref())
            .map(|value| parse_usd_cents("positions.unrealizedPnlUsd", value))
            .transpose()?
            .unwrap_or(0);
        let observed_cents = observed_by_instrument
            .get(&instrument)
            .and_then(|position| position.unrealized_pnl_usd.as_deref())
            .map(|value| parse_usd_cents("positions.unrealizedPnlUsd", value))
            .transpose()?
            .unwrap_or(0);
        total += (observed_cents - expected_cents).abs();
    }
    Ok(total)
}

fn build_notes(
    status: &RuntimeReconciliationStatus,
    total_wallet_delta_cents: i64,
    position_delta_cents: i64,
    should_apply_correction: bool,
) -> Vec<String> {
    let mut notes = vec![format!(
        "wallet delta {} and position delta {} evaluated",
        format_usd_cents(total_wallet_delta_cents),
        format_usd_cents(position_delta_cents),
    )];
    if should_apply_correction {
        notes.push("wallet state drift is within auto-correction threshold".to_string());
    }
    match status {
        RuntimeReconciliationStatus::Passed => notes
            .push("receipt and wallet state reconciled without manual intervention".to_string()),
        RuntimeReconciliationStatus::NeedsManualReview => {
            notes.push("drift exceeded warning threshold and requires manual review".to_string())
        }
        RuntimeReconciliationStatus::Failed => {
            notes.push("drift exceeded failure threshold and reconciliation failed".to_string())
        }
    }
    notes
}

fn load_submit_attempt_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeSubmitAttemptRecord>, ReconcilerError> {
    load_optional_record(
        connection,
        "SELECT record_json FROM runtime_submit_attempts WHERE run_id = ?1",
        run_id,
    )
}

fn load_receipt_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeReceiptObservation>, ReconcilerError> {
    load_optional_record(
        connection,
        "SELECT record_json FROM runtime_receipts WHERE run_id = ?1",
        run_id,
    )
}

fn load_wallet_observation_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeWalletObservationRecord>, ReconcilerError> {
    load_optional_record(
        connection,
        "SELECT record_json FROM runtime_wallet_observations WHERE run_id = ?1",
        run_id,
    )
}

fn load_result_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeReconciliationResult>, ReconcilerError> {
    load_optional_record(
        connection,
        "SELECT record_json FROM runtime_reconciliation_results WHERE run_id = ?1",
        run_id,
    )
}

fn load_optional_record<T: for<'de> Deserialize<'de>>(
    connection: &Connection,
    sql: &str,
    key: &str,
) -> Result<Option<T>, ReconcilerError> {
    let raw = connection
        .query_row(sql, params![key], |row| row.get::<_, String>(0))
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn list_records<T: for<'de> Deserialize<'de>>(
    connection: &Connection,
    sql: &str,
    deployment_id: &str,
) -> Result<Vec<T>, ReconcilerError> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(params![deployment_id], |row| row.get::<_, String>(0))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(deserialize_json(&row?)?);
    }
    Ok(values)
}

fn parse_atomic_i128(field: &'static str, value: &str) -> Result<i128, ReconcilerError> {
    value
        .trim()
        .parse::<i128>()
        .map_err(|_| ReconcilerError::InvalidNumericValue {
            field,
            value: value.to_string(),
        })
}

fn parse_usd_cents(field: &'static str, value: &str) -> Result<i64, ReconcilerError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ReconcilerError::InvalidNumericValue {
            field,
            value: trimmed.to_string(),
        });
    }

    let (sign, digits) = if let Some(rest) = trimmed.strip_prefix('-') {
        (-1_i64, rest)
    } else if let Some(rest) = trimmed.strip_prefix('+') {
        (1_i64, rest)
    } else {
        (1_i64, trimmed)
    };
    let (whole_raw, fraction_raw) = digits.split_once('.').unwrap_or((digits, ""));
    if whole_raw.is_empty()
        || !whole_raw
            .chars()
            .all(|character| character.is_ascii_digit())
        || !fraction_raw
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(ReconcilerError::InvalidNumericValue {
            field,
            value: trimmed.to_string(),
        });
    }
    let whole = whole_raw
        .parse::<i64>()
        .map_err(|_| ReconcilerError::InvalidNumericValue {
            field,
            value: trimmed.to_string(),
        })?;
    let fraction_bytes = fraction_raw.as_bytes();
    let tenths = fraction_bytes
        .first()
        .map(|digit| i64::from(digit - b'0'))
        .unwrap_or(0);
    let hundredths = fraction_bytes
        .get(1)
        .map(|digit| i64::from(digit - b'0'))
        .unwrap_or(0);
    let mut fraction = tenths * 10 + hundredths;
    if fraction_bytes.get(2).is_some_and(|digit| *digit >= b'5') {
        fraction += 1;
    }
    let cents = whole
        .checked_mul(100)
        .and_then(|value| value.checked_add(fraction))
        .ok_or_else(|| ReconcilerError::InvalidNumericValue {
            field,
            value: trimmed.to_string(),
        })?;
    Ok(sign * cents)
}

fn format_usd_cents(value: i64) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let absolute = value.abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

fn serialize_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

fn deserialize_json<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, serde_json::Error> {
    serde_json::from_str(raw)
}

fn build_prefixed_id(prefix: &str, value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    format!("{prefix}_{}", hex_encode(&digest[..12]))
}

fn mode_key(mode: &RuntimeMode) -> &'static str {
    match mode {
        RuntimeMode::Shadow => "shadow",
        RuntimeMode::Paper => "paper",
        RuntimeMode::Live => "live",
    }
}

fn reconciliation_status_key(status: &RuntimeReconciliationStatus) -> &'static str {
    match status {
        RuntimeReconciliationStatus::Passed => "passed",
        RuntimeReconciliationStatus::NeedsManualReview => "needs_manual_review",
        RuntimeReconciliationStatus::Failed => "failed",
    }
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
        .format(&time::format_description::well_known::Rfc3339)
        .expect("current time to format")
}

#[cfg(test)]
mod tests {
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use protocol::{
        RuntimeExecutionAction, RuntimeExecutionSlice, RuntimeLane, RuntimeLedgerTotals,
        RuntimeMode, RuntimePositionSide, RuntimeVenueMarketType,
    };

    use super::*;

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let sequence = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!(
                "reconciler-{test_name}-{unique}-{sequence}.sqlite3"
            ))
            .display()
            .to_string()
    }

    fn reconciler(test_name: &str) -> Reconciler {
        Reconciler::new(ReconcilerConfig::new(temp_database_url(test_name)))
            .expect("reconciler to initialize")
    }

    fn plan(run_id: &str, mode: RuntimeMode) -> RuntimeExecutionPlan {
        RuntimeExecutionPlan {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            plan_id: format!("plan_{run_id}"),
            deployment_id: "dep_1".to_string(),
            venue_key: "jupiter".to_string(),
            owner_user_id: Some("user_1".to_string()),
            sleeve_id: Some("sleeve_1".to_string()),
            run_id: run_id.to_string(),
            created_at: "2026-03-08T15:00:00Z".to_string(),
            mode: mode.clone(),
            lane: RuntimeLane::Safe,
            idempotency_key: format!("dep_1:{run_id}"),
            simulate_only: mode == RuntimeMode::Shadow,
            dry_run: mode != RuntimeMode::Live,
            slices: vec![RuntimeExecutionSlice {
                slice_id: "slice_1".to_string(),
                action: RuntimeExecutionAction::Buy,
                market_type: RuntimeVenueMarketType::Spot,
                instrument_id: None,
                quantity_atomic: None,
                reference_price_usd: None,
                reduce_only: false,
                input_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                output_mint: "So11111111111111111111111111111111111111112".to_string(),
                input_amount_atomic: "5000000".to_string(),
                min_output_amount_atomic: Some("35000000".to_string()),
                notional_usd: "5.00".to_string(),
                slippage_bps: 50,
            }],
        }
    }

    fn ledger_snapshot(
        deployment_id: &str,
        available_usd: &str,
        reserved_usd: &str,
        equity_usd: &str,
        unrealized_pnl_usd: &str,
    ) -> RuntimeLedgerSnapshot {
        RuntimeLedgerSnapshot {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            snapshot_id: format!("ledger_{deployment_id}"),
            deployment_id: deployment_id.to_string(),
            sleeve_id: "sleeve_1".to_string(),
            as_of: "2026-03-08T15:00:01Z".to_string(),
            balances: vec![RuntimeLedgerBalance {
                mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                symbol: "USDC".to_string(),
                decimals: 6,
                free_atomic: format!(
                    "{}",
                    parse_usd_cents("available", available_usd).expect("cents") * 10_000
                ),
                reserved_atomic: format!(
                    "{}",
                    parse_usd_cents("reserved", reserved_usd).expect("cents") * 10_000
                ),
                price_usd: Some("1.00".to_string()),
            }],
            positions: vec![RuntimeLedgerPosition {
                instrument_id: "SOL".to_string(),
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
                realized_pnl_usd: "0.00".to_string(),
                unrealized_pnl_usd: unrealized_pnl_usd.to_string(),
            },
        }
    }

    #[test]
    fn records_attempts_receipts_and_wallet_observations_idempotently() {
        let reconciler = reconciler("records");
        let plan = plan("run_1", RuntimeMode::Shadow);

        let first_attempt = reconciler
            .record_submit_attempt(&plan, "submit_1", true, "runtime-rs")
            .expect("attempt");
        let second_attempt = reconciler
            .record_submit_attempt(&plan, "submit_2", true, "runtime-rs")
            .expect("attempt");
        assert_eq!(first_attempt.attempt_id, second_attempt.attempt_id);
        assert_eq!(second_attempt.submit_request_id, "submit_1");

        let first_receipt = reconciler
            .record_synthetic_receipt(&plan, "submit_1", "runtime-rs", "accepted", &["dry run"])
            .expect("receipt");
        let second_receipt = reconciler
            .record_synthetic_receipt(&plan, "submit_1", "runtime-rs", "accepted", &["dry run"])
            .expect("receipt");
        assert_eq!(first_receipt.receipt_id, second_receipt.receipt_id);

        let wallet = ledger_snapshot("dep_1", "95.00", "5.00", "100.00", "2.00");
        let first_observation = reconciler
            .record_wallet_observation("dep_1", "run_1", "runtime-rs", &wallet)
            .expect("wallet observation");
        let second_observation = reconciler
            .record_wallet_observation("dep_1", "run_1", "runtime-rs", &wallet)
            .expect("wallet observation");
        assert_eq!(
            first_observation.observation_id,
            second_observation.observation_id
        );

        let bundle = reconciler
            .bundle_for_deployment("dep_1")
            .expect("bundle to load");
        assert_eq!(bundle.submit_attempts.len(), 1);
        assert_eq!(bundle.receipts.len(), 1);
        assert_eq!(bundle.wallet_observations.len(), 1);
    }

    #[test]
    fn passes_zero_drift_reconciliation() {
        let reconciler = reconciler("passes");
        let plan = plan("run_2", RuntimeMode::Shadow);
        let receipt = reconciler
            .record_synthetic_receipt(&plan, "submit_2", "runtime-rs", "accepted", &["dry run"])
            .expect("receipt");
        let expected = ledger_snapshot("dep_1", "95.00", "5.00", "100.00", "2.00");
        let observed = expected.clone();

        let outcome = reconciler
            .reconcile_and_store(&ReconciliationInput {
                deployment_id: "dep_1".to_string(),
                run_id: "run_2".to_string(),
                plan,
                receipt,
                expected_ledger: expected,
                observed_ledger: observed,
            })
            .expect("reconciliation");

        assert_eq!(outcome.result.status, RuntimeReconciliationStatus::Passed);
        assert!(!outcome.should_apply_correction);
        assert_eq!(outcome.result.position_delta_usd, "0.00");
        assert_eq!(outcome.result.wallet_deltas.len(), 1);
    }

    #[test]
    fn auto_corrects_small_wallet_drift() {
        let reconciler = reconciler("autocorrect");
        let plan = plan("run_3", RuntimeMode::Paper);
        let receipt = reconciler
            .record_synthetic_receipt(&plan, "submit_3", "runtime-rs", "accepted", &["paper"])
            .expect("receipt");
        let expected = ledger_snapshot("dep_1", "95.00", "5.00", "100.00", "2.00");
        let observed = ledger_snapshot("dep_1", "94.50", "5.00", "99.50", "2.00");

        let outcome = reconciler
            .reconcile_and_store(&ReconciliationInput {
                deployment_id: "dep_1".to_string(),
                run_id: "run_3".to_string(),
                plan,
                receipt,
                expected_ledger: expected,
                observed_ledger: observed,
            })
            .expect("reconciliation");

        assert_eq!(outcome.result.status, RuntimeReconciliationStatus::Passed);
        assert!(outcome.should_apply_correction);
        assert!(outcome.result.correction_applied);
    }

    #[test]
    fn flags_large_drift_for_manual_intervention() {
        let reconciler = reconciler("large-drift");
        let plan = plan("run_4", RuntimeMode::Paper);
        let receipt = reconciler
            .record_synthetic_receipt(&plan, "submit_4", "runtime-rs", "accepted", &["paper"])
            .expect("receipt");
        let expected = ledger_snapshot("dep_1", "95.00", "5.00", "100.00", "2.00");
        let observed = ledger_snapshot("dep_1", "80.00", "5.00", "85.00", "9.00");

        let outcome = reconciler
            .reconcile_and_store(&ReconciliationInput {
                deployment_id: "dep_1".to_string(),
                run_id: "run_4".to_string(),
                plan,
                receipt,
                expected_ledger: expected,
                observed_ledger: observed,
            })
            .expect("reconciliation");

        assert_eq!(outcome.result.status, RuntimeReconciliationStatus::Failed);
        assert!(!outcome.should_apply_correction);
        assert!(!outcome.result.correction_applied);
    }
}
