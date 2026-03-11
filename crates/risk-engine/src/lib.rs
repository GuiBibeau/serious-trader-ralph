use std::{
    fs,
    path::{Path, PathBuf},
};

use feature_cache::DerivedMarketFeatureSnapshot;
use protocol::{
    RuntimeDeploymentRecord, RuntimeLane, RuntimeLedgerSnapshot, RuntimeRiskDecision,
    RuntimeRiskLimits, RuntimeRiskObserved, RuntimeRiskReason, RuntimeRiskSeverity,
    RuntimeRiskVerdict, RuntimeRunRecord, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiskEngineConfig {
    pub database_url: String,
    pub stale_after_ms: u64,
}

impl RiskEngineConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>, stale_after_ms: u64) -> Self {
        Self {
            database_url: database_url.into(),
            stale_after_ms,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RiskEngine {
    database_path: PathBuf,
    stale_after_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskEngineSnapshot {
    pub status: String,
    pub verdict_count: u64,
    pub pause_verdict_count: u64,
    pub latest_verdict_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiskAssessmentInput {
    pub deployment: RuntimeDeploymentRecord,
    pub run: RuntimeRunRecord,
    pub feature_snapshot: DerivedMarketFeatureSnapshot,
    pub ledger_snapshot: RuntimeLedgerSnapshot,
    pub kill_switch_active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiskAssessmentResult {
    pub verdict: RuntimeRiskVerdict,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum RiskEngineError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid usd amount for {field}: {value}")]
    InvalidUsdAmount { field: &'static str, value: String },
    #[error("invalid RFC3339 timestamp for {field}: {value}")]
    InvalidTimestamp { field: &'static str, value: String },
}

impl RiskEngine {
    pub fn new(config: RiskEngineConfig) -> Result<Self, RiskEngineError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone(), config.stale_after_ms) {
            Ok(engine) => Ok(engine),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path(), config.stale_after_ms)
            }
            Err(error) => Err(error),
        }
    }

    pub fn assess_and_store(
        &self,
        input: &RiskAssessmentInput,
    ) -> Result<RiskAssessmentResult, RiskEngineError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;

        if let Some(existing) = load_verdict_by_run_id(&transaction, &input.run.run_id)? {
            transaction.commit()?;
            return Ok(RiskAssessmentResult {
                verdict: existing,
                created: false,
            });
        }

        let latest_prior = load_latest_verdict_for_deployment(
            &transaction,
            &input.deployment.deployment_id,
            Some(&input.run.run_id),
        )?;
        let verdict = build_verdict(input, self.stale_after_ms, latest_prior.as_ref())?;
        persist_verdict(&transaction, &verdict)?;
        transaction.commit()?;

        Ok(RiskAssessmentResult {
            verdict,
            created: true,
        })
    }

    pub fn get_verdict(
        &self,
        verdict_id: &str,
    ) -> Result<Option<RuntimeRiskVerdict>, RiskEngineError> {
        let connection = self.open_connection()?;
        load_verdict(&connection, verdict_id)
    }

    pub fn list_verdicts(
        &self,
        deployment_id: &str,
    ) -> Result<Vec<RuntimeRiskVerdict>, RiskEngineError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT record_json
             FROM risk_verdicts
             WHERE deployment_id = ?1
             ORDER BY decided_at DESC, verdict_id DESC",
        )?;
        let rows = statement.query_map(params![deployment_id], |row| row.get::<_, String>(0))?;
        let mut verdicts = Vec::new();
        for row in rows {
            verdicts.push(deserialize_json(&row?)?);
        }
        Ok(verdicts)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> RiskEngineSnapshot {
        match self.snapshot_counts() {
            Ok((verdict_count, pause_verdict_count, latest_verdict_at)) => RiskEngineSnapshot {
                status: "healthy".to_string(),
                verdict_count,
                pause_verdict_count,
                latest_verdict_at,
                last_error: None,
            },
            Err(error) => RiskEngineSnapshot {
                status: "degraded".to_string(),
                verdict_count: 0,
                pause_verdict_count: 0,
                latest_verdict_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<(u64, u64, Option<String>), RiskEngineError> {
        let connection = self.open_connection()?;
        let verdict_count =
            connection.query_row("SELECT COUNT(*) FROM risk_verdicts", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let pause_verdict_count = connection.query_row(
            "SELECT COUNT(*) FROM risk_verdicts WHERE verdict = 'pause'",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let latest_verdict_at = connection
            .query_row(
                "SELECT decided_at
                 FROM risk_verdicts
                 ORDER BY decided_at DESC, verdict_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok((verdict_count, pause_verdict_count, latest_verdict_at))
    }

    fn open_connection(&self) -> Result<Connection, RiskEngineError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(
        database_path: PathBuf,
        stale_after_ms: u64,
    ) -> Result<Self, RiskEngineError> {
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let engine = Self {
            database_path,
            stale_after_ms,
        };
        let connection = engine.open_connection()?;
        initialize_schema(&connection)?;
        Ok(engine)
    }
}

#[must_use]
pub fn allows_execution(verdict: &RuntimeRiskVerdict) -> bool {
    verdict.verdict == RuntimeRiskDecision::Allow
}

#[must_use]
pub fn should_pause_runtime(verdict: &RuntimeRiskVerdict) -> bool {
    verdict.verdict == RuntimeRiskDecision::Pause
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS risk_verdicts (
            verdict_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            verdict TEXT NOT NULL,
            decided_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_risk_verdicts_deployment_decided
            ON risk_verdicts (deployment_id, decided_at DESC);",
    )
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return PathBuf::from(".tmp/runtime-rs/risk-engine.sqlite3");
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
        .join("risk-engine.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &RiskEngineError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path() {
        return false;
    }

    match error {
        RiskEngineError::Io(inner) => inner.kind() == std::io::ErrorKind::PermissionDenied,
        RiskEngineError::Storage(inner) => {
            matches!(
                inner,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::CannotOpen
            )
        }
        RiskEngineError::Serialization(_)
        | RiskEngineError::InvalidUsdAmount { .. }
        | RiskEngineError::InvalidTimestamp { .. } => false,
    }
}

fn build_verdict(
    input: &RiskAssessmentInput,
    stale_after_ms: u64,
    latest_prior: Option<&RuntimeRiskVerdict>,
) -> Result<RuntimeRiskVerdict, RiskEngineError> {
    let limits = build_limits(&input.deployment, stale_after_ms)?;
    let observed = build_observed(input)?;
    let requested_notional_cents = parse_non_negative_usd_cents(
        "observed.requestedNotionalUsd",
        &observed.requested_notional_usd,
    )?;
    let reserved_cents =
        parse_non_negative_usd_cents("observed.reservedUsd", &observed.reserved_usd)?;
    let max_notional_cents =
        parse_non_negative_usd_cents("limits.maxNotionalUsd", &limits.max_notional_usd)?;
    let max_reserved_cents =
        parse_non_negative_usd_cents("limits.maxReservedUsd", &limits.max_reserved_usd)?;
    let spread_bps = input
        .feature_snapshot
        .spread_bps
        .as_deref()
        .map(|value| parse_non_negative_bps("featureSnapshot.spreadBps", value))
        .transpose()?;

    let mut reasons = Vec::new();
    let mut verdict = RuntimeRiskDecision::Allow;

    if input.kill_switch_active {
        verdict = RuntimeRiskDecision::Pause;
        reasons.push(RuntimeRiskReason {
            code: "kill_switch_active".to_string(),
            message: "Runtime kill switch is active for this deployment.".to_string(),
            severity: RuntimeRiskSeverity::Error,
        });
    }

    if input.feature_snapshot.stale || observed.feature_age_ms > limits.stale_after_ms {
        reasons.push(RuntimeRiskReason {
            code: "feature_stale".to_string(),
            message: format!(
                "Feature snapshot is stale (age={}ms, reasons={}).",
                observed.feature_age_ms,
                stale_reason_message(&input.feature_snapshot)
            ),
            severity: RuntimeRiskSeverity::Error,
        });
        if verdict != RuntimeRiskDecision::Pause {
            verdict = RuntimeRiskDecision::Reject;
        }
    }

    if requested_notional_cents > max_notional_cents {
        reasons.push(RuntimeRiskReason {
            code: "requested_notional_exceeded".to_string(),
            message: format!(
                "Requested notional {} exceeds limit {}.",
                observed.requested_notional_usd, limits.max_notional_usd
            ),
            severity: RuntimeRiskSeverity::Error,
        });
        if verdict != RuntimeRiskDecision::Pause {
            verdict = RuntimeRiskDecision::Reject;
        }
    }

    if reserved_cents > max_reserved_cents {
        reasons.push(RuntimeRiskReason {
            code: "reserved_notional_exceeded".to_string(),
            message: format!(
                "Reserved notional {} exceeds limit {}.",
                observed.reserved_usd, limits.max_reserved_usd
            ),
            severity: RuntimeRiskSeverity::Error,
        });
        if verdict != RuntimeRiskDecision::Pause {
            verdict = RuntimeRiskDecision::Reject;
        }
    }

    if observed.concentration_bps > limits.max_concentration_bps {
        reasons.push(RuntimeRiskReason {
            code: "concentration_limit_exceeded".to_string(),
            message: format!(
                "Observed concentration {}bps exceeds limit {}bps.",
                observed.concentration_bps, limits.max_concentration_bps
            ),
            severity: RuntimeRiskSeverity::Error,
        });
        if verdict != RuntimeRiskDecision::Pause {
            verdict = RuntimeRiskDecision::Reject;
        }
    }

    if spread_bps.is_some_and(|value| value > u64::from(input.deployment.policy.max_slippage_bps)) {
        reasons.push(RuntimeRiskReason {
            code: "spread_bps_exceeded".to_string(),
            message: format!(
                "Observed spread {}bps exceeds policy slippage cap {}bps.",
                spread_bps.expect("checked"),
                input.deployment.policy.max_slippage_bps
            ),
            severity: RuntimeRiskSeverity::Error,
        });
        if verdict != RuntimeRiskDecision::Pause {
            verdict = RuntimeRiskDecision::Reject;
        }
    }

    if cooldown_is_active(input, latest_prior)? {
        reasons.push(RuntimeRiskReason {
            code: "cooldown_active".to_string(),
            message: format!(
                "Runtime cooldown is active for lane {}.",
                lane_key(&input.deployment.lane)
            ),
            severity: RuntimeRiskSeverity::Warn,
        });
        if verdict != RuntimeRiskDecision::Pause {
            verdict = RuntimeRiskDecision::Reject;
        }
    }

    if reasons.is_empty() {
        reasons.push(RuntimeRiskReason {
            code: "within_limits".to_string(),
            message: "Requested notional and concentration are within v1 limits.".to_string(),
            severity: RuntimeRiskSeverity::Info,
        });
    }

    Ok(RuntimeRiskVerdict {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        verdict_id: build_verdict_id(&input.run.run_id),
        deployment_id: input.deployment.deployment_id.clone(),
        run_id: input.run.run_id.clone(),
        decided_at: now_rfc3339(),
        verdict,
        reasons,
        observed,
        limits,
    })
}

fn build_limits(
    deployment: &RuntimeDeploymentRecord,
    stale_after_ms: u64,
) -> Result<RuntimeRiskLimits, RiskEngineError> {
    let max_notional_cents =
        parse_non_negative_usd_cents("policy.maxNotionalUsd", &deployment.policy.max_notional_usd)?;
    let max_reserved_cents = max_notional_cents
        .checked_mul(i64::from(deployment.policy.max_concurrent_runs))
        .ok_or_else(|| RiskEngineError::InvalidUsdAmount {
            field: "policy.maxConcurrentRuns",
            value: deployment.policy.max_concurrent_runs.to_string(),
        })?;
    Ok(RuntimeRiskLimits {
        max_notional_usd: format_usd_cents(max_notional_cents),
        max_reserved_usd: format_usd_cents(max_reserved_cents),
        max_concentration_bps: max_concentration_bps_for_lane(&deployment.lane),
        stale_after_ms,
    })
}

fn build_observed(input: &RiskAssessmentInput) -> Result<RuntimeRiskObserved, RiskEngineError> {
    let requested_notional_cents = parse_non_negative_usd_cents(
        "capital.reservedUsd",
        &input.deployment.capital.reserved_usd,
    )?;
    let reserved_cents = parse_non_negative_usd_cents(
        "ledger.totals.reservedUsd",
        &input.ledger_snapshot.totals.reserved_usd,
    )?;
    let equity_cents = parse_non_negative_usd_cents(
        "ledger.totals.equityUsd",
        &input.ledger_snapshot.totals.equity_usd,
    )?;
    let concentration_bps = if equity_cents == 0 {
        10_000
    } else {
        (((reserved_cents * 10_000) + (equity_cents / 2)) / equity_cents).clamp(0, 10_000) as u16
    };

    Ok(RuntimeRiskObserved {
        requested_notional_usd: format_usd_cents(requested_notional_cents),
        reserved_usd: format_usd_cents(reserved_cents),
        concentration_bps,
        feature_age_ms: input.feature_snapshot.age_ms,
    })
}

fn cooldown_is_active(
    input: &RiskAssessmentInput,
    latest_prior: Option<&RuntimeRiskVerdict>,
) -> Result<bool, RiskEngineError> {
    let Some(latest_prior) = latest_prior else {
        return Ok(false);
    };
    let cooldown_ms = cooldown_ms_for_lane(&input.deployment.lane);
    if cooldown_ms == 0 {
        return Ok(false);
    }

    let current_observed_at =
        parse_timestamp("run.trigger.observedAt", &input.run.trigger.observed_at)?;
    let previous_decided_at = parse_timestamp("riskVerdict.decidedAt", &latest_prior.decided_at)?;
    if current_observed_at <= previous_decided_at {
        return Ok(true);
    }
    Ok((current_observed_at - previous_decided_at) < Duration::milliseconds(cooldown_ms as i64))
}

fn parse_timestamp(field: &'static str, value: &str) -> Result<OffsetDateTime, RiskEngineError> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| RiskEngineError::InvalidTimestamp {
        field,
        value: value.to_string(),
    })
}

fn load_verdict(
    connection: &Connection,
    verdict_id: &str,
) -> Result<Option<RuntimeRiskVerdict>, RiskEngineError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM risk_verdicts WHERE verdict_id = ?1",
            params![verdict_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn load_verdict_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeRiskVerdict>, RiskEngineError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM risk_verdicts WHERE run_id = ?1",
            params![run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn load_latest_verdict_for_deployment(
    connection: &Connection,
    deployment_id: &str,
    exclude_run_id: Option<&str>,
) -> Result<Option<RuntimeRiskVerdict>, RiskEngineError> {
    let raw = match exclude_run_id {
        Some(run_id) => connection
            .query_row(
                "SELECT record_json
                 FROM risk_verdicts
                 WHERE deployment_id = ?1 AND run_id != ?2
                 ORDER BY decided_at DESC, verdict_id DESC
                 LIMIT 1",
                params![deployment_id, run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
        None => connection
            .query_row(
                "SELECT record_json
                 FROM risk_verdicts
                 WHERE deployment_id = ?1
                 ORDER BY decided_at DESC, verdict_id DESC
                 LIMIT 1",
                params![deployment_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?,
    };
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn persist_verdict(
    connection: &Connection,
    verdict: &RuntimeRiskVerdict,
) -> Result<(), RiskEngineError> {
    connection.execute(
        "INSERT INTO risk_verdicts (
            verdict_id,
            deployment_id,
            run_id,
            verdict,
            decided_at,
            record_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            &verdict.verdict_id,
            &verdict.deployment_id,
            &verdict.run_id,
            decision_key(&verdict.verdict),
            &verdict.decided_at,
            serialize_json(verdict)?,
        ],
    )?;
    Ok(())
}

fn build_verdict_id(run_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(run_id.as_bytes());
    let digest = hasher.finalize();
    format!("risk_{}", hex_encode(&digest[..12]))
}

fn lane_key(lane: &RuntimeLane) -> &'static str {
    match lane {
        RuntimeLane::Safe => "safe",
        RuntimeLane::Protected => "protected",
        RuntimeLane::Fast => "fast",
    }
}

fn max_concentration_bps_for_lane(lane: &RuntimeLane) -> u16 {
    match lane {
        RuntimeLane::Safe => 3_500,
        RuntimeLane::Protected => 5_000,
        RuntimeLane::Fast => 6_500,
    }
}

fn cooldown_ms_for_lane(lane: &RuntimeLane) -> u64 {
    match lane {
        RuntimeLane::Safe => 60_000,
        RuntimeLane::Protected => 30_000,
        RuntimeLane::Fast => 15_000,
    }
}

fn decision_key(decision: &RuntimeRiskDecision) -> &'static str {
    match decision {
        RuntimeRiskDecision::Allow => "allow",
        RuntimeRiskDecision::Reject => "reject",
        RuntimeRiskDecision::Pause => "pause",
    }
}

fn stale_reason_message(feature_snapshot: &DerivedMarketFeatureSnapshot) -> String {
    if feature_snapshot.stale_reasons.is_empty() {
        "feature_age_exceeded".to_string()
    } else {
        feature_snapshot.stale_reasons.join(",")
    }
}

fn parse_non_negative_bps(field: &'static str, value: &str) -> Result<u64, RiskEngineError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(RiskEngineError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        });
    }
    let bps = trimmed
        .parse::<f64>()
        .ok()
        .filter(|parsed| parsed.is_finite() && *parsed >= 0.0)
        .map(|parsed| parsed.round() as u64)
        .ok_or_else(|| RiskEngineError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        })?;
    Ok(bps)
}

fn parse_usd_cents(field: &'static str, value: &str) -> Result<i64, RiskEngineError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(RiskEngineError::InvalidUsdAmount {
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
        return Err(RiskEngineError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        });
    }

    let whole = whole_raw
        .parse::<i64>()
        .map_err(|_| RiskEngineError::InvalidUsdAmount {
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
        .ok_or_else(|| RiskEngineError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        })?;
    Ok(sign * cents)
}

fn parse_non_negative_usd_cents(field: &'static str, value: &str) -> Result<i64, RiskEngineError> {
    let cents = parse_usd_cents(field, value)?;
    if cents < 0 {
        return Err(RiskEngineError::InvalidUsdAmount {
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

fn serialize_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}

fn deserialize_json<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, serde_json::Error> {
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

    use protocol::{
        RuntimeCapital, RuntimeDeploymentState, RuntimeLane, RuntimeMode, RuntimePair,
        RuntimePolicy, RuntimeRunState, RuntimeTrigger, RuntimeTriggerKind,
    };

    use super::*;

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("risk-engine-{test_name}-{unique}.sqlite3"))
            .display()
            .to_string()
    }

    fn engine(test_name: &str) -> RiskEngine {
        RiskEngine::new(RiskEngineConfig::new(temp_database_url(test_name), 5_000))
            .expect("risk engine to initialize")
    }

    fn deployment() -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "dep_1".to_string(),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_1".to_string(),
            owner_user_id: "user_1".to_string(),
            venue_key: "jupiter".to_string(),
            pair: RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            },
            mode: RuntimeMode::Shadow,
            state: RuntimeDeploymentState::Shadow,
            lane: RuntimeLane::Safe,
            created_at: "2026-03-07T18:00:00Z".to_string(),
            updated_at: "2026-03-07T18:00:00Z".to_string(),
            promoted_at: None,
            paused_at: None,
            killed_at: None,
            policy: RuntimePolicy {
                max_notional_usd: "25".to_string(),
                daily_loss_limit_usd: "35".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 2,
                rebalance_tolerance_bps: 100,
            },
            capital: RuntimeCapital {
                allocated_usd: "100".to_string(),
                reserved_usd: "5".to_string(),
                available_usd: "95".to_string(),
            },
            tags: vec!["fixture".to_string()],
        }
    }

    fn run(run_id: &str, observed_at: &str) -> RuntimeRunRecord {
        RuntimeRunRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            run_id: run_id.to_string(),
            deployment_id: "dep_1".to_string(),
            run_key: format!("dep_1:{run_id}:signal"),
            trigger: RuntimeTrigger {
                kind: RuntimeTriggerKind::Signal,
                source: "test".to_string(),
                observed_at: observed_at.to_string(),
                feature_snapshot_id: Some("snapshot_1".to_string()),
                reason: Some("test".to_string()),
            },
            state: RuntimeRunState::Pending,
            planned_at: observed_at.to_string(),
            updated_at: observed_at.to_string(),
            risk_verdict_id: None,
            execution_plan_id: None,
            submit_request_id: None,
            receipt_id: None,
            failure_code: None,
            failure_message: None,
        }
    }

    fn feature_snapshot(
        observed_at: &str,
        age_ms: u64,
        stale: bool,
        spread_bps: Option<&str>,
    ) -> DerivedMarketFeatureSnapshot {
        DerivedMarketFeatureSnapshot {
            cache_key: "fixture:SOL/USDC".to_string(),
            symbol: "SOL/USDC".to_string(),
            source: "fixture".to_string(),
            last_sequence: 1,
            observed_at: observed_at.to_string(),
            age_ms,
            stale,
            stale_reasons: if stale {
                vec!["feature_age_exceeded".to_string()]
            } else {
                Vec::new()
            },
            sample_count: 8,
            window_short_ms: 10_000,
            window_long_ms: 25_000,
            mid_price_usd: "150.00".to_string(),
            bid_price_usd: Some("149.95".to_string()),
            ask_price_usd: Some("150.05".to_string()),
            spread_bps: spread_bps.map(str::to_string),
            short_return_bps: Some("12.5".to_string()),
            long_return_bps: Some("20.0".to_string()),
            realized_volatility_bps: Some("18.0".to_string()),
            processed_slot: Some(123),
            slot_age_ms: Some(100),
            slot_gap: Some(0),
            last_ingest_lag_ms: 10,
        }
    }

    fn ledger_snapshot(equity_usd: &str, reserved_usd: &str) -> RuntimeLedgerSnapshot {
        RuntimeLedgerSnapshot {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            snapshot_id: "ledger_1".to_string(),
            deployment_id: "dep_1".to_string(),
            sleeve_id: "sleeve_1".to_string(),
            as_of: "2026-03-07T18:00:00Z".to_string(),
            balances: Vec::new(),
            positions: Vec::new(),
            totals: protocol::RuntimeLedgerTotals {
                equity_usd: equity_usd.to_string(),
                reserved_usd: reserved_usd.to_string(),
                available_usd: "0".to_string(),
                realized_pnl_usd: "0".to_string(),
                unrealized_pnl_usd: "0".to_string(),
            },
        }
    }

    fn input(run_id: &str, observed_at: &str) -> RiskAssessmentInput {
        RiskAssessmentInput {
            deployment: deployment(),
            run: run(run_id, observed_at),
            feature_snapshot: feature_snapshot(observed_at, 850, false, Some("15")),
            ledger_snapshot: ledger_snapshot("100", "5"),
            kill_switch_active: false,
        }
    }

    #[test]
    fn surfaces_allow_and_pause_decisions() {
        let allow = RuntimeRiskVerdict {
            schema_version: "v1".to_string(),
            verdict_id: "risk_1".to_string(),
            deployment_id: "dep_1".to_string(),
            run_id: "run_1".to_string(),
            decided_at: "2026-03-07T19:10:00Z".to_string(),
            verdict: RuntimeRiskDecision::Allow,
            reasons: vec![RuntimeRiskReason {
                code: "sample".to_string(),
                message: "sample".to_string(),
                severity: RuntimeRiskSeverity::Info,
            }],
            observed: RuntimeRiskObserved {
                requested_notional_usd: "5".to_string(),
                reserved_usd: "5".to_string(),
                concentration_bps: 1000,
                feature_age_ms: 100,
            },
            limits: RuntimeRiskLimits {
                max_notional_usd: "25".to_string(),
                max_reserved_usd: "50".to_string(),
                max_concentration_bps: 3500,
                stale_after_ms: 5000,
            },
        };
        let pause = RuntimeRiskVerdict {
            verdict: RuntimeRiskDecision::Pause,
            ..allow.clone()
        };
        let reject = RuntimeRiskVerdict {
            verdict: RuntimeRiskDecision::Reject,
            ..allow.clone()
        };

        assert!(allows_execution(&allow));
        assert!(should_pause_runtime(&pause));
        assert!(!allows_execution(&reject));
    }

    #[test]
    fn persists_allow_verdicts_for_safe_inputs() {
        let engine = engine("allow");
        let result = engine
            .assess_and_store(&input("run_allow", "2026-03-07T18:05:00Z"))
            .expect("verdict to store");

        assert!(result.created);
        assert_eq!(result.verdict.verdict, RuntimeRiskDecision::Allow);
        assert_eq!(result.verdict.reasons[0].code, "within_limits");
        assert_eq!(
            engine
                .get_verdict(&result.verdict.verdict_id)
                .expect("lookup to succeed")
                .expect("verdict to exist")
                .run_id,
            "run_allow"
        );
    }

    #[test]
    fn rejects_stale_feature_inputs() {
        let engine = engine("stale");
        let mut input = input("run_stale", "2026-03-07T18:05:00Z");
        input.feature_snapshot.age_ms = 6_500;
        input.feature_snapshot.stale = true;
        input.feature_snapshot.stale_reasons = vec!["feature_age_exceeded".to_string()];

        let verdict = engine
            .assess_and_store(&input)
            .expect("verdict to store")
            .verdict;

        assert_eq!(verdict.verdict, RuntimeRiskDecision::Reject);
        assert_eq!(verdict.reasons[0].code, "feature_stale");
    }

    #[test]
    fn rejects_concentration_limit_breaches() {
        let engine = engine("concentration");
        let mut input = input("run_concentration", "2026-03-07T18:05:00Z");
        input.ledger_snapshot = ledger_snapshot("10", "5");

        let verdict = engine
            .assess_and_store(&input)
            .expect("verdict to store")
            .verdict;

        assert_eq!(verdict.verdict, RuntimeRiskDecision::Reject);
        assert!(verdict
            .reasons
            .iter()
            .any(|reason| reason.code == "concentration_limit_exceeded"));
    }

    #[test]
    fn rejects_runs_during_cooldown() {
        let engine = engine("cooldown");
        engine
            .assess_and_store(&input("run_first", "2026-03-07T18:05:00Z"))
            .expect("first verdict");

        let verdict = engine
            .assess_and_store(&input("run_second", "2026-03-07T18:05:30Z"))
            .expect("second verdict")
            .verdict;

        assert_eq!(verdict.verdict, RuntimeRiskDecision::Reject);
        assert!(verdict
            .reasons
            .iter()
            .any(|reason| reason.code == "cooldown_active"));
    }

    #[test]
    fn pauses_when_kill_switch_is_active() {
        let engine = engine("kill-switch");
        let mut input = input("run_pause", "2026-03-07T18:05:00Z");
        input.kill_switch_active = true;

        let verdict = engine
            .assess_and_store(&input)
            .expect("verdict to store")
            .verdict;

        assert_eq!(verdict.verdict, RuntimeRiskDecision::Pause);
        assert_eq!(verdict.reasons[0].code, "kill_switch_active");
    }

    #[test]
    fn is_idempotent_for_existing_run_ids() {
        let engine = engine("idempotent");
        let first = engine
            .assess_and_store(&input("run_repeat", "2026-03-07T18:05:00Z"))
            .expect("first verdict");
        let second = engine
            .assess_and_store(&input("run_repeat", "2026-03-07T18:05:00Z"))
            .expect("second verdict");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(first.verdict.verdict_id, second.verdict.verdict_id);
    }
}
