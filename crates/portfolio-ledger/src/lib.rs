use std::{
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeLedgerBalance, RuntimeLedgerPosition,
    RuntimeLedgerSnapshot, RuntimeLedgerTotals, RuntimePositionSide,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortfolioLedgerConfig {
    pub database_url: String,
}

impl PortfolioLedgerConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PortfolioLedger {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioLedgerSnapshot {
    pub status: String,
    pub sleeve_count: u64,
    pub deployment_count: u64,
    pub total_reserved_usd: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerSyncResult {
    pub snapshot: RuntimeLedgerSnapshot,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum PortfolioLedgerError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("deployment {deployment_id} not found in ledger")]
    DeploymentNotFound { deployment_id: String },
    #[error("sleeve {sleeve_id} is oversubscribed: requested {requested_usd} > available {available_usd}")]
    SleeveOversubscribed {
        sleeve_id: String,
        requested_usd: String,
        available_usd: String,
    },
    #[error("invalid usd amount for {field}: {value}")]
    InvalidUsdAmount { field: &'static str, value: String },
    #[error("correction for sleeve {sleeve_id} would break allocation invariants")]
    InvalidCorrection { sleeve_id: String },
}

impl PortfolioLedger {
    pub fn new(config: PortfolioLedgerConfig) -> Result<Self, PortfolioLedgerError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(ledger) => Ok(ledger),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    #[must_use]
    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn sync_deployment(
        &self,
        deployment: &RuntimeDeploymentRecord,
    ) -> Result<LedgerSyncResult, PortfolioLedgerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;

        let allocated_cents = parse_non_negative_usd_cents(
            "capital.allocatedUsd",
            &deployment.capital.allocated_usd,
        )?;
        let reserved_cents = effective_reserved_cents(deployment)?;
        let existing = load_deployment_state(&transaction, &deployment.deployment_id)?;
        let sleeve = load_sleeve_state(&transaction, &deployment.sleeve_id)?;
        let quote_symbol = quote_symbol(&deployment.pair.symbol);

        let sleeve_equity_cents = sleeve
            .as_ref()
            .map(|state| state.equity_cents)
            .unwrap_or(allocated_cents);

        let other_allocated_cents = sum_deployment_cents(
            &transaction,
            &deployment.sleeve_id,
            "allocated_cents",
            Some(&deployment.deployment_id),
        )?;
        let other_reserved_cents = sum_deployment_cents(
            &transaction,
            &deployment.sleeve_id,
            "reserved_cents",
            Some(&deployment.deployment_id),
        )?;

        ensure_within_sleeve_capacity(
            &deployment.sleeve_id,
            sleeve_equity_cents,
            other_allocated_cents + allocated_cents,
        )?;
        ensure_within_sleeve_capacity(
            &deployment.sleeve_id,
            sleeve_equity_cents,
            other_reserved_cents + reserved_cents,
        )?;

        upsert_sleeve_state(
            &transaction,
            &deployment.sleeve_id,
            sleeve_equity_cents,
            other_reserved_cents + reserved_cents,
            &deployment.pair.quote_mint,
            &quote_symbol,
        )?;

        let available_cents = allocated_cents.saturating_sub(reserved_cents);
        upsert_deployment_state(
            &transaction,
            deployment,
            allocated_cents,
            reserved_cents,
            available_cents,
        )?;

        let snapshot = build_snapshot(&transaction, &deployment.deployment_id)?;
        transaction.commit()?;

        Ok(LedgerSyncResult {
            snapshot,
            created: existing.is_none(),
        })
    }

    pub fn apply_sleeve_correction(
        &self,
        sleeve_id: &str,
        corrected_equity_usd: &str,
    ) -> Result<(), PortfolioLedgerError> {
        let corrected_equity_cents =
            parse_non_negative_usd_cents("correctedEquityUsd", corrected_equity_usd)?;
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let sleeve = load_sleeve_state(&transaction, sleeve_id)?.ok_or_else(|| {
            PortfolioLedgerError::InvalidCorrection {
                sleeve_id: sleeve_id.to_string(),
            }
        })?;

        let allocated_cents =
            sum_deployment_cents(&transaction, sleeve_id, "allocated_cents", None)?;
        let reserved_cents = sum_deployment_cents(&transaction, sleeve_id, "reserved_cents", None)?;
        if corrected_equity_cents < allocated_cents || corrected_equity_cents < reserved_cents {
            return Err(PortfolioLedgerError::InvalidCorrection {
                sleeve_id: sleeve_id.to_string(),
            });
        }

        upsert_sleeve_state(
            &transaction,
            sleeve_id,
            corrected_equity_cents,
            sleeve.reserved_cents,
            &sleeve.quote_mint,
            &sleeve.quote_symbol,
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn apply_observed_snapshot(
        &self,
        deployment_id: &str,
        snapshot: &RuntimeLedgerSnapshot,
    ) -> Result<RuntimeLedgerSnapshot, PortfolioLedgerError> {
        let observed_equity_cents =
            parse_non_negative_usd_cents("snapshot.totals.equityUsd", &snapshot.totals.equity_usd)?;
        let observed_reserved_cents = parse_non_negative_usd_cents(
            "snapshot.totals.reservedUsd",
            &snapshot.totals.reserved_usd,
        )?;
        let observed_available_cents = parse_non_negative_usd_cents(
            "snapshot.totals.availableUsd",
            &snapshot.totals.available_usd,
        )?;
        let observed_realized_pnl_cents = parse_usd_cents(
            "snapshot.totals.realizedPnlUsd",
            &snapshot.totals.realized_pnl_usd,
        )?;
        if observed_reserved_cents + observed_available_cents != observed_equity_cents {
            return Err(PortfolioLedgerError::InvalidCorrection {
                sleeve_id: snapshot.sleeve_id.clone(),
            });
        }

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let deployment = load_deployment_state(&transaction, deployment_id)?.ok_or_else(|| {
            PortfolioLedgerError::DeploymentNotFound {
                deployment_id: deployment_id.to_string(),
            }
        })?;
        let sleeve = load_sleeve_state(&transaction, &deployment.sleeve_id)?.ok_or_else(|| {
            PortfolioLedgerError::DeploymentNotFound {
                deployment_id: deployment_id.to_string(),
            }
        })?;

        let other_allocated_cents = sum_deployment_cents(
            &transaction,
            &deployment.sleeve_id,
            "allocated_cents",
            Some(deployment_id),
        )?;
        let other_reserved_cents = sum_deployment_cents(
            &transaction,
            &deployment.sleeve_id,
            "reserved_cents",
            Some(deployment_id),
        )?;
        let corrected_sleeve_equity_cents = sleeve
            .equity_cents
            .saturating_sub(deployment.allocated_cents)
            .saturating_add(observed_equity_cents);

        ensure_within_sleeve_capacity(
            &deployment.sleeve_id,
            corrected_sleeve_equity_cents,
            other_allocated_cents + observed_equity_cents,
        )?;
        ensure_within_sleeve_capacity(
            &deployment.sleeve_id,
            corrected_sleeve_equity_cents,
            other_reserved_cents + observed_reserved_cents,
        )?;

        upsert_sleeve_state(
            &transaction,
            &deployment.sleeve_id,
            corrected_sleeve_equity_cents,
            other_reserved_cents + observed_reserved_cents,
            &deployment.quote_mint,
            &deployment.quote_symbol,
        )?;
        upsert_deployment_ledger_state(
            &transaction,
            &deployment,
            observed_equity_cents,
            observed_reserved_cents,
            observed_available_cents,
            observed_realized_pnl_cents,
        )?;
        replace_positions(&transaction, deployment_id, &snapshot.positions)?;

        let corrected_snapshot = build_snapshot(&transaction, deployment_id)?;
        transaction.commit()?;
        Ok(corrected_snapshot)
    }

    pub fn upsert_position(
        &self,
        deployment_id: &str,
        position: &RuntimeLedgerPosition,
    ) -> Result<(), PortfolioLedgerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO ledger_positions (
                deployment_id,
                instrument_id,
                side,
                quantity_atomic,
                entry_price_usd,
                mark_price_usd,
                unrealized_pnl_usd
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(deployment_id, instrument_id) DO UPDATE SET
                side = excluded.side,
                quantity_atomic = excluded.quantity_atomic,
                entry_price_usd = excluded.entry_price_usd,
                mark_price_usd = excluded.mark_price_usd,
                unrealized_pnl_usd = excluded.unrealized_pnl_usd",
            params![
                deployment_id,
                &position.instrument_id,
                side_key(&position.side),
                &position.quantity_atomic,
                &position.entry_price_usd,
                &position.mark_price_usd,
                &position.unrealized_pnl_usd,
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn snapshot_for_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<RuntimeLedgerSnapshot, PortfolioLedgerError> {
        let connection = self.open_connection()?;
        build_snapshot(&connection, deployment_id)
    }

    pub fn pnl_for_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<RuntimeLedgerTotals, PortfolioLedgerError> {
        Ok(self.snapshot_for_deployment(deployment_id)?.totals)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> PortfolioLedgerSnapshot {
        match self.counts_and_reserved() {
            Ok((sleeve_count, deployment_count, total_reserved_cents)) => PortfolioLedgerSnapshot {
                status: "healthy".to_string(),
                sleeve_count,
                deployment_count,
                total_reserved_usd: format_usd_cents(total_reserved_cents),
                last_error: None,
            },
            Err(error) => PortfolioLedgerSnapshot {
                status: "degraded".to_string(),
                sleeve_count: 0,
                deployment_count: 0,
                total_reserved_usd: "0.00".to_string(),
                last_error: Some(error.to_string()),
            },
        }
    }

    fn counts_and_reserved(&self) -> Result<(u64, u64, i64), PortfolioLedgerError> {
        let connection = self.open_connection()?;
        let sleeve_count =
            connection.query_row("SELECT COUNT(*) FROM ledger_sleeves", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let deployment_count =
            connection.query_row("SELECT COUNT(*) FROM ledger_deployments", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let total_reserved = connection.query_row(
            "SELECT COALESCE(SUM(reserved_cents), 0) FROM ledger_deployments",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        Ok((sleeve_count, deployment_count, total_reserved))
    }

    fn open_connection(&self) -> Result<Connection, PortfolioLedgerError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(database_path: PathBuf) -> Result<Self, PortfolioLedgerError> {
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let ledger = Self { database_path };
        let connection = ledger.open_connection()?;
        initialize_schema(&connection)?;
        Ok(ledger)
    }
}

#[derive(Debug, Clone)]
struct SleeveState {
    sleeve_id: String,
    equity_cents: i64,
    reserved_cents: i64,
    quote_mint: String,
    quote_symbol: String,
}

#[derive(Debug, Clone)]
struct DeploymentLedgerState {
    deployment_id: String,
    sleeve_id: String,
    strategy_key: String,
    state: String,
    allocated_cents: i64,
    reserved_cents: i64,
    available_cents: i64,
    realized_pnl_cents: i64,
    quote_mint: String,
    quote_symbol: String,
}

struct DeploymentLedgerStateUpsert<'a> {
    deployment_id: &'a str,
    sleeve_id: &'a str,
    strategy_key: &'a str,
    state: &'a str,
    allocated_cents: i64,
    reserved_cents: i64,
    available_cents: i64,
    realized_pnl_cents: i64,
    quote_mint: &'a str,
    quote_symbol: &'a str,
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS ledger_sleeves (
            sleeve_id TEXT PRIMARY KEY,
            equity_cents INTEGER NOT NULL,
            reserved_cents INTEGER NOT NULL,
            quote_mint TEXT NOT NULL,
            quote_symbol TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ledger_deployments (
            deployment_id TEXT PRIMARY KEY,
            sleeve_id TEXT NOT NULL,
            strategy_key TEXT NOT NULL,
            state TEXT NOT NULL,
            allocated_cents INTEGER NOT NULL,
            reserved_cents INTEGER NOT NULL,
            available_cents INTEGER NOT NULL,
            realized_pnl_cents INTEGER NOT NULL,
            quote_mint TEXT NOT NULL,
            quote_symbol TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (sleeve_id) REFERENCES ledger_sleeves(sleeve_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS ledger_positions (
            deployment_id TEXT NOT NULL,
            instrument_id TEXT NOT NULL,
            side TEXT NOT NULL,
            quantity_atomic TEXT NOT NULL,
            entry_price_usd TEXT,
            mark_price_usd TEXT,
            unrealized_pnl_usd TEXT,
            PRIMARY KEY (deployment_id, instrument_id),
            FOREIGN KEY (deployment_id) REFERENCES ledger_deployments(deployment_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ledger_deployments_sleeve
            ON ledger_deployments (sleeve_id);",
    )
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return PathBuf::from(".tmp/runtime-rs/portfolio-ledger.sqlite3");
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
        .join("portfolio-ledger.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &PortfolioLedgerError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path() {
        return false;
    }

    match error {
        PortfolioLedgerError::Io(inner) => inner.kind() == std::io::ErrorKind::PermissionDenied,
        PortfolioLedgerError::Storage(inner) => {
            matches!(
                inner,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::CannotOpen
            )
        }
        PortfolioLedgerError::DeploymentNotFound { .. }
        | PortfolioLedgerError::SleeveOversubscribed { .. }
        | PortfolioLedgerError::InvalidUsdAmount { .. }
        | PortfolioLedgerError::InvalidCorrection { .. } => false,
    }
}

fn effective_reserved_cents(
    deployment: &RuntimeDeploymentRecord,
) -> Result<i64, PortfolioLedgerError> {
    let reserved_cents =
        parse_non_negative_usd_cents("capital.reservedUsd", &deployment.capital.reserved_usd)?;
    Ok(
        if matches!(
            deployment.state,
            RuntimeDeploymentState::Killed | RuntimeDeploymentState::Archived
        ) {
            0
        } else {
            reserved_cents
        },
    )
}

fn ensure_within_sleeve_capacity(
    sleeve_id: &str,
    sleeve_equity_cents: i64,
    requested_cents: i64,
) -> Result<(), PortfolioLedgerError> {
    if requested_cents <= sleeve_equity_cents {
        return Ok(());
    }
    Err(PortfolioLedgerError::SleeveOversubscribed {
        sleeve_id: sleeve_id.to_string(),
        requested_usd: format_usd_cents(requested_cents),
        available_usd: format_usd_cents(sleeve_equity_cents),
    })
}

fn upsert_sleeve_state(
    connection: &Connection,
    sleeve_id: &str,
    equity_cents: i64,
    reserved_cents: i64,
    quote_mint: &str,
    quote_symbol: &str,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO ledger_sleeves (
            sleeve_id,
            equity_cents,
            reserved_cents,
            quote_mint,
            quote_symbol,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(sleeve_id) DO UPDATE SET
            equity_cents = excluded.equity_cents,
            reserved_cents = excluded.reserved_cents,
            quote_mint = excluded.quote_mint,
            quote_symbol = excluded.quote_symbol,
            updated_at = excluded.updated_at",
        params![
            sleeve_id,
            equity_cents,
            reserved_cents,
            quote_mint,
            quote_symbol,
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

fn upsert_deployment_state(
    connection: &Connection,
    deployment: &RuntimeDeploymentRecord,
    allocated_cents: i64,
    reserved_cents: i64,
    available_cents: i64,
) -> Result<(), rusqlite::Error> {
    let quote_symbol = quote_symbol(&deployment.pair.symbol);
    upsert_deployment_ledger_state_record(
        connection,
        &DeploymentLedgerStateUpsert {
            deployment_id: &deployment.deployment_id,
            sleeve_id: &deployment.sleeve_id,
            strategy_key: &deployment.strategy_key,
            state: state_key(&deployment.state),
            allocated_cents,
            reserved_cents,
            available_cents,
            realized_pnl_cents: 0,
            quote_mint: &deployment.pair.quote_mint,
            quote_symbol: &quote_symbol,
        },
    )
}

fn upsert_deployment_ledger_state(
    connection: &Connection,
    deployment: &DeploymentLedgerState,
    allocated_cents: i64,
    reserved_cents: i64,
    available_cents: i64,
    realized_pnl_cents: i64,
) -> Result<(), rusqlite::Error> {
    upsert_deployment_ledger_state_record(
        connection,
        &DeploymentLedgerStateUpsert {
            deployment_id: &deployment.deployment_id,
            sleeve_id: &deployment.sleeve_id,
            strategy_key: &deployment.strategy_key,
            state: &deployment.state,
            allocated_cents,
            reserved_cents,
            available_cents,
            realized_pnl_cents,
            quote_mint: &deployment.quote_mint,
            quote_symbol: &deployment.quote_symbol,
        },
    )
}

fn upsert_deployment_ledger_state_record(
    connection: &Connection,
    record: &DeploymentLedgerStateUpsert<'_>,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO ledger_deployments (
            deployment_id,
            sleeve_id,
            strategy_key,
            state,
            allocated_cents,
            reserved_cents,
            available_cents,
            realized_pnl_cents,
            quote_mint,
            quote_symbol,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(deployment_id) DO UPDATE SET
            sleeve_id = excluded.sleeve_id,
            strategy_key = excluded.strategy_key,
            state = excluded.state,
            allocated_cents = excluded.allocated_cents,
            reserved_cents = excluded.reserved_cents,
            available_cents = excluded.available_cents,
            realized_pnl_cents = excluded.realized_pnl_cents,
            quote_mint = excluded.quote_mint,
            quote_symbol = excluded.quote_symbol,
            updated_at = excluded.updated_at",
        params![
            record.deployment_id,
            record.sleeve_id,
            record.strategy_key,
            record.state,
            record.allocated_cents,
            record.reserved_cents,
            record.available_cents,
            record.realized_pnl_cents,
            record.quote_mint,
            record.quote_symbol,
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

fn replace_positions(
    connection: &Connection,
    deployment_id: &str,
    positions: &[RuntimeLedgerPosition],
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "DELETE FROM ledger_positions WHERE deployment_id = ?1",
        params![deployment_id],
    )?;
    for position in positions {
        connection.execute(
            "INSERT INTO ledger_positions (
                deployment_id,
                instrument_id,
                side,
                quantity_atomic,
                entry_price_usd,
                mark_price_usd,
                unrealized_pnl_usd
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                deployment_id,
                &position.instrument_id,
                side_key(&position.side),
                &position.quantity_atomic,
                &position.entry_price_usd,
                &position.mark_price_usd,
                &position.unrealized_pnl_usd,
            ],
        )?;
    }
    Ok(())
}

fn load_sleeve_state(
    connection: &Connection,
    sleeve_id: &str,
) -> Result<Option<SleeveState>, PortfolioLedgerError> {
    connection
        .query_row(
            "SELECT sleeve_id, equity_cents, reserved_cents, quote_mint, quote_symbol
             FROM ledger_sleeves
             WHERE sleeve_id = ?1",
            params![sleeve_id],
            |row| {
                Ok(SleeveState {
                    sleeve_id: row.get(0)?,
                    equity_cents: row.get(1)?,
                    reserved_cents: row.get(2)?,
                    quote_mint: row.get(3)?,
                    quote_symbol: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(PortfolioLedgerError::from)
}

fn load_deployment_state(
    connection: &Connection,
    deployment_id: &str,
) -> Result<Option<DeploymentLedgerState>, PortfolioLedgerError> {
    connection
        .query_row(
            "SELECT deployment_id, sleeve_id, strategy_key, state, allocated_cents, reserved_cents, available_cents,
                    realized_pnl_cents, quote_mint, quote_symbol
             FROM ledger_deployments
             WHERE deployment_id = ?1",
            params![deployment_id],
            |row| {
                Ok(DeploymentLedgerState {
                    deployment_id: row.get(0)?,
                    sleeve_id: row.get(1)?,
                    strategy_key: row.get(2)?,
                    state: row.get(3)?,
                    allocated_cents: row.get(4)?,
                    reserved_cents: row.get(5)?,
                    available_cents: row.get(6)?,
                    realized_pnl_cents: row.get(7)?,
                    quote_mint: row.get(8)?,
                    quote_symbol: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(PortfolioLedgerError::from)
}

fn sum_deployment_cents(
    connection: &Connection,
    sleeve_id: &str,
    column: &str,
    exclude_deployment_id: Option<&str>,
) -> Result<i64, PortfolioLedgerError> {
    let sql = if exclude_deployment_id.is_some() {
        format!(
            "SELECT COALESCE(SUM({column}), 0) FROM ledger_deployments WHERE sleeve_id = ?1 AND deployment_id != ?2"
        )
    } else {
        format!("SELECT COALESCE(SUM({column}), 0) FROM ledger_deployments WHERE sleeve_id = ?1")
    };

    let total = match exclude_deployment_id {
        Some(deployment_id) => {
            connection.query_row(&sql, params![sleeve_id, deployment_id], |row| {
                row.get::<_, i64>(0)
            })?
        }
        None => connection.query_row(&sql, params![sleeve_id], |row| row.get::<_, i64>(0))?,
    };
    Ok(total)
}

fn build_snapshot(
    connection: &Connection,
    deployment_id: &str,
) -> Result<RuntimeLedgerSnapshot, PortfolioLedgerError> {
    let deployment_state = load_deployment_state(connection, deployment_id)?.ok_or_else(|| {
        PortfolioLedgerError::DeploymentNotFound {
            deployment_id: deployment_id.to_string(),
        }
    })?;
    let sleeve = load_sleeve_state(connection, &deployment_state.sleeve_id)?.ok_or_else(|| {
        PortfolioLedgerError::DeploymentNotFound {
            deployment_id: deployment_id.to_string(),
        }
    })?;
    let positions = load_positions(connection, deployment_id)?;
    let unrealized_pnl_cents = positions
        .iter()
        .filter_map(|position| position.unrealized_pnl_usd.as_deref())
        .map(|value| parse_usd_cents("positions.unrealizedPnlUsd", value))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum::<i64>();

    Ok(RuntimeLedgerSnapshot {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        snapshot_id: format!("ledger_{deployment_id}_{}", timestamp_compact()),
        deployment_id: deployment_state.deployment_id,
        sleeve_id: sleeve.sleeve_id,
        as_of: now_rfc3339(),
        balances: vec![RuntimeLedgerBalance {
            mint: deployment_state.quote_mint,
            symbol: deployment_state.quote_symbol,
            decimals: 6,
            free_atomic: format_atomic_from_cents(deployment_state.available_cents),
            reserved_atomic: format_atomic_from_cents(deployment_state.reserved_cents),
            price_usd: Some("1.00".to_string()),
        }],
        positions,
        totals: RuntimeLedgerTotals {
            equity_usd: format_usd_cents(deployment_state.allocated_cents),
            reserved_usd: format_usd_cents(deployment_state.reserved_cents),
            available_usd: format_usd_cents(deployment_state.available_cents),
            realized_pnl_usd: format_usd_cents(deployment_state.realized_pnl_cents),
            unrealized_pnl_usd: format_usd_cents(unrealized_pnl_cents),
        },
    })
}

fn load_positions(
    connection: &Connection,
    deployment_id: &str,
) -> Result<Vec<RuntimeLedgerPosition>, PortfolioLedgerError> {
    let mut statement = connection.prepare(
        "SELECT instrument_id, side, quantity_atomic, entry_price_usd, mark_price_usd, unrealized_pnl_usd
         FROM ledger_positions
         WHERE deployment_id = ?1
         ORDER BY instrument_id ASC",
    )?;

    let rows = statement.query_map(params![deployment_id], |row| {
        Ok(RuntimeLedgerPosition {
            instrument_id: row.get(0)?,
            side: parse_side(&row.get::<_, String>(1)?),
            quantity_atomic: row.get(2)?,
            entry_price_usd: row.get(3)?,
            mark_price_usd: row.get(4)?,
            unrealized_pnl_usd: row.get(5)?,
        })
    })?;

    let mut positions = Vec::new();
    for row in rows {
        positions.push(row?);
    }
    Ok(positions)
}

fn parse_usd_cents(field: &'static str, value: &str) -> Result<i64, PortfolioLedgerError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(PortfolioLedgerError::InvalidUsdAmount {
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
        return Err(PortfolioLedgerError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        });
    }

    let whole = whole_raw
        .parse::<i64>()
        .map_err(|_| PortfolioLedgerError::InvalidUsdAmount {
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
        .ok_or_else(|| PortfolioLedgerError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        })?;

    Ok(sign * cents)
}

fn parse_non_negative_usd_cents(
    field: &'static str,
    value: &str,
) -> Result<i64, PortfolioLedgerError> {
    let cents = parse_usd_cents(field, value)?;
    if cents < 0 {
        return Err(PortfolioLedgerError::InvalidUsdAmount {
            field,
            value: value.trim().to_string(),
        });
    }
    Ok(cents)
}

fn format_usd_cents(value: i64) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let absolute = value.abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

fn format_atomic_from_cents(value: i64) -> String {
    (value * 10_000).to_string()
}

fn quote_symbol(pair_symbol: &str) -> String {
    pair_symbol.split('/').nth(1).unwrap_or("USDC").to_string()
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

fn side_key(side: &RuntimePositionSide) -> &'static str {
    match side {
        RuntimePositionSide::Long => "long",
        RuntimePositionSide::Short => "short",
        RuntimePositionSide::Flat => "flat",
    }
}

fn parse_side(value: &str) -> RuntimePositionSide {
    match value {
        "long" => RuntimePositionSide::Long,
        "short" => RuntimePositionSide::Short,
        _ => RuntimePositionSide::Flat,
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("current time to format")
}

fn timestamp_compact() -> String {
    OffsetDateTime::now_utc().unix_timestamp_nanos().to_string()
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use protocol::{RuntimeCapital, RuntimeLane, RuntimePair, RuntimePolicy};

    use super::*;

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("portfolio-ledger-{test_name}-{unique}.sqlite3"))
            .display()
            .to_string()
    }

    fn ledger(test_name: &str) -> PortfolioLedger {
        PortfolioLedger::new(PortfolioLedgerConfig::new(temp_database_url(test_name)))
            .expect("ledger to initialize")
    }

    fn deployment(
        deployment_id: &str,
        sleeve_id: &str,
        allocated_usd: &str,
        reserved_usd: &str,
    ) -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: deployment_id.to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: sleeve_id.to_string(),
            owner_user_id: "user_123".to_string(),
            pair: RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            },
            mode: protocol::RuntimeMode::Shadow,
            state: RuntimeDeploymentState::Shadow,
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
                allocated_usd: allocated_usd.to_string(),
                reserved_usd: reserved_usd.to_string(),
                available_usd: format_usd_cents(
                    parse_usd_cents("available", allocated_usd).expect("allocated")
                        - parse_usd_cents("reserved", reserved_usd).expect("reserved"),
                ),
            },
            tags: vec!["test".to_string()],
        }
    }

    #[test]
    fn builds_ledger_snapshots_from_deployments() {
        let ledger = ledger("snapshot");

        let result = ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "100.00",
                "5.00",
            ))
            .expect("deployment to sync");

        assert!(result.created);
        assert_eq!(result.snapshot.totals.equity_usd, "100.00");
        assert_eq!(result.snapshot.totals.reserved_usd, "5.00");
        assert_eq!(result.snapshot.totals.available_usd, "95.00");
        assert_eq!(result.snapshot.balances.len(), 1);
    }

    #[test]
    fn prevents_conflicting_reservations_across_deployments() {
        let ledger = ledger("conflict");
        ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "100.00",
                "60.00",
            ))
            .expect("first deployment to sync");

        let error = ledger
            .sync_deployment(&deployment(
                "deployment_2",
                "sleeve_alpha",
                "50.00",
                "50.00",
            ))
            .expect_err("second deployment should oversubscribe the sleeve");

        assert!(matches!(
            error,
            PortfolioLedgerError::SleeveOversubscribed { .. }
        ));
    }

    #[test]
    fn supports_deterministic_recovery_via_sleeve_correction() {
        let ledger = ledger("recovery");
        ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "100.00",
                "60.00",
            ))
            .expect("first deployment to sync");
        assert!(matches!(
            ledger.sync_deployment(&deployment(
                "deployment_2",
                "sleeve_alpha",
                "50.00",
                "20.00"
            )),
            Err(PortfolioLedgerError::SleeveOversubscribed { .. })
        ));

        ledger
            .apply_sleeve_correction("sleeve_alpha", "200.00")
            .expect("correction to apply");

        let result = ledger
            .sync_deployment(&deployment(
                "deployment_2",
                "sleeve_alpha",
                "50.00",
                "20.00",
            ))
            .expect("second deployment to sync after correction");

        assert_eq!(result.snapshot.totals.available_usd, "30.00");
    }

    #[test]
    fn includes_positions_and_cost_basis_in_snapshots() {
        let ledger = ledger("positions");
        ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "100.00",
                "5.00",
            ))
            .expect("deployment to sync");
        ledger
            .upsert_position(
                "deployment_1",
                &RuntimeLedgerPosition {
                    instrument_id: "SOL/USDC".to_string(),
                    side: RuntimePositionSide::Long,
                    quantity_atomic: "100000000".to_string(),
                    entry_price_usd: Some("140.00".to_string()),
                    mark_price_usd: Some("142.00".to_string()),
                    unrealized_pnl_usd: Some("2.00".to_string()),
                },
            )
            .expect("position to store");

        let snapshot = ledger
            .snapshot_for_deployment("deployment_1")
            .expect("snapshot to load");

        assert_eq!(snapshot.positions.len(), 1);
        assert_eq!(
            snapshot.positions[0].entry_price_usd.as_deref(),
            Some("140.00")
        );
        assert_eq!(snapshot.totals.unrealized_pnl_usd, "2.00");
    }

    #[test]
    fn applies_observed_snapshots_as_auditable_corrections() {
        let ledger = ledger("observed-correction");
        ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "100.00",
                "5.00",
            ))
            .expect("deployment to sync");

        let corrected = ledger
            .apply_observed_snapshot(
                "deployment_1",
                &RuntimeLedgerSnapshot {
                    schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
                    snapshot_id: "wallet_1".to_string(),
                    deployment_id: "deployment_1".to_string(),
                    sleeve_id: "sleeve_alpha".to_string(),
                    as_of: "2026-03-08T15:10:00Z".to_string(),
                    balances: vec![RuntimeLedgerBalance {
                        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                        symbol: "USDC".to_string(),
                        decimals: 6,
                        free_atomic: "103000000".to_string(),
                        reserved_atomic: "7000000".to_string(),
                        price_usd: Some("1.00".to_string()),
                    }],
                    positions: vec![RuntimeLedgerPosition {
                        instrument_id: "SOL/USDC".to_string(),
                        side: RuntimePositionSide::Long,
                        quantity_atomic: "150000000".to_string(),
                        entry_price_usd: Some("141.00".to_string()),
                        mark_price_usd: Some("143.00".to_string()),
                        unrealized_pnl_usd: Some("3.00".to_string()),
                    }],
                    totals: RuntimeLedgerTotals {
                        equity_usd: "110.00".to_string(),
                        reserved_usd: "7.00".to_string(),
                        available_usd: "103.00".to_string(),
                        realized_pnl_usd: "1.50".to_string(),
                        unrealized_pnl_usd: "3.00".to_string(),
                    },
                },
            )
            .expect("observed snapshot to apply");

        assert_eq!(corrected.totals.equity_usd, "110.00");
        assert_eq!(corrected.totals.reserved_usd, "7.00");
        assert_eq!(corrected.totals.available_usd, "103.00");
        assert_eq!(corrected.totals.realized_pnl_usd, "1.50");
        assert_eq!(corrected.positions.len(), 1);
        assert_eq!(
            corrected.positions[0].entry_price_usd.as_deref(),
            Some("141.00")
        );
    }

    #[test]
    fn accepts_subcent_precision_and_rounds_to_cents() {
        let ledger = ledger("subcent");

        let result = ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "100.005",
                "5.125",
            ))
            .expect("deployment to sync");

        assert_eq!(result.snapshot.totals.equity_usd, "100.01");
        assert_eq!(result.snapshot.totals.reserved_usd, "5.13");
        assert_eq!(result.snapshot.totals.available_usd, "94.88");
    }

    #[test]
    fn rejects_negative_capital_amounts() {
        let ledger = ledger("negative-capital");

        let error = ledger
            .sync_deployment(&deployment(
                "deployment_1",
                "sleeve_alpha",
                "-100.00",
                "5.00",
            ))
            .expect_err("negative capital should fail");

        assert!(matches!(
            error,
            PortfolioLedgerError::InvalidUsdAmount {
                field: "capital.allocatedUsd",
                ..
            }
        ));
    }
}
