use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use feature_cache::DerivedMarketFeatureSnapshot;
use protocol::{
    RuntimeDeploymentRecord, RuntimeExecutionAction, RuntimeExecutionPlan, RuntimeExecutionSlice,
    RuntimeLane, RuntimeLedgerBalance, RuntimeLedgerSnapshot, RuntimeMode, RuntimeRiskDecision,
    RuntimeRiskVerdict, RuntimeRunRecord, RuntimeStrategySpec, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use strategy_core::{StrategyCatalog, StrategyCatalogError, StrategyKind, SUPPORTED_STRATEGIES};
use thiserror::Error;
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPlannerConfig {
    pub database_url: String,
}

impl ExecutionPlannerConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExecutionPlanner {
    database_path: PathBuf,
    strategy_plugins: Arc<StrategyPluginRegistry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlannerSnapshot {
    pub status: String,
    pub plan_count: u64,
    pub latest_plan_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPlannerInput {
    pub deployment: RuntimeDeploymentRecord,
    pub run: RuntimeRunRecord,
    pub feature_snapshot: DerivedMarketFeatureSnapshot,
    pub ledger_snapshot: RuntimeLedgerSnapshot,
    pub risk_verdict: RuntimeRiskVerdict,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionPlanningResult {
    pub plan: RuntimeExecutionPlan,
    pub created: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwapDirection {
    BuyBase,
    SellBase,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StrategyTradeDecision {
    pub action: RuntimeExecutionAction,
    pub direction: SwapDirection,
    pub notional_cents: i64,
}

pub trait StrategyPlugin: Send + Sync + std::fmt::Debug {
    fn spec(&self) -> &RuntimeStrategySpec;

    fn trade_decision(
        &self,
        input: &ExecutionPlannerInput,
    ) -> Result<StrategyTradeDecision, ExecutionPlannerError>;
}

#[derive(Debug, Clone, Default)]
pub struct StrategyPluginRegistry {
    catalog: StrategyCatalog,
    plugins: BTreeMap<String, Arc<dyn StrategyPlugin>>,
}

#[derive(Debug, Clone)]
struct BuiltinStrategyPlugin {
    spec: RuntimeStrategySpec,
    planner: fn(&ExecutionPlannerInput) -> Result<StrategyTradeDecision, ExecutionPlannerError>,
}

const BREAKOUT_SIGNAL_THRESHOLD_BPS: f64 = 15.0;
const BREAKOUT_CONFIRMATION_THRESHOLD_BPS: f64 = 10.0;
const MACRO_ROTATION_REGIME_THRESHOLD_BPS: f64 = 12.0;
const VOLATILITY_TARGET_LOW_THRESHOLD_BPS: f64 = 12.0;
const VOLATILITY_TARGET_MEDIUM_THRESHOLD_BPS: f64 = 20.0;
const VOLATILITY_TARGET_LOW_BPS: i64 = 7_500;
const VOLATILITY_TARGET_MEDIUM_BPS: i64 = 5_000;
const VOLATILITY_TARGET_HIGH_BPS: i64 = 2_500;

impl BuiltinStrategyPlugin {
    fn new(kind: StrategyKind) -> Self {
        Self {
            spec: kind.spec(),
            planner: match kind {
                StrategyKind::Dca => dca_trade_decision,
                StrategyKind::ThresholdRebalance => threshold_rebalance_trade_decision,
                StrategyKind::Twap => twap_trade_decision,
                StrategyKind::TrendFollowing => trend_following_trade_decision,
                StrategyKind::MeanReversion => mean_reversion_trade_decision,
                StrategyKind::Breakout => breakout_trade_decision,
                StrategyKind::MacroRotation => macro_rotation_trade_decision,
                StrategyKind::VolatilityTarget => volatility_target_trade_decision,
            },
        }
    }
}

impl StrategyPlugin for BuiltinStrategyPlugin {
    fn spec(&self) -> &RuntimeStrategySpec {
        &self.spec
    }

    fn trade_decision(
        &self,
        input: &ExecutionPlannerInput,
    ) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
        (self.planner)(input)
    }
}

impl StrategyPluginRegistry {
    pub fn builtin() -> Result<Self, ExecutionPlannerError> {
        let mut registry = Self::default();
        for strategy in SUPPORTED_STRATEGIES {
            registry.register_plugin(BuiltinStrategyPlugin::new(strategy))?;
        }
        Ok(registry)
    }

    pub fn register_plugin<P>(&mut self, plugin: P) -> Result<(), ExecutionPlannerError>
    where
        P: StrategyPlugin + 'static,
    {
        let strategy_key = plugin.spec().strategy_key.clone();
        self.catalog.register_spec(plugin.spec().clone())?;
        self.plugins.insert(strategy_key, Arc::new(plugin));
        Ok(())
    }

    #[must_use]
    pub fn catalog(&self) -> StrategyCatalog {
        self.catalog.clone()
    }

    #[must_use]
    pub fn strategy_specs(&self) -> Vec<RuntimeStrategySpec> {
        self.catalog.specs()
    }

    #[must_use]
    pub fn supported_strategy_keys(&self) -> Vec<String> {
        self.catalog.keys()
    }

    fn get(&self, strategy_key: &str) -> Option<&Arc<dyn StrategyPlugin>> {
        self.plugins.get(strategy_key)
    }
}

#[derive(Debug, Error)]
pub enum ExecutionPlannerError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid usd amount for {field}: {value}")]
    InvalidUsdAmount { field: &'static str, value: String },
    #[error("invalid numeric value for {field}: {value}")]
    InvalidNumericValue { field: &'static str, value: String },
    #[error("risk verdict {verdict_id} is not allow")]
    RiskNotAllowed { verdict_id: String },
    #[error("execution plan {plan_id} not found")]
    PlanNotFound { plan_id: String },
    #[error("unsupported strategy key: {0}")]
    UnsupportedStrategy(String),
    #[error(transparent)]
    StrategyCatalog(#[from] StrategyCatalogError),
}

impl ExecutionPlanner {
    pub fn new(config: ExecutionPlannerConfig) -> Result<Self, ExecutionPlannerError> {
        Self::with_plugins(config, StrategyPluginRegistry::builtin()?)
    }

    pub fn with_plugins(
        config: ExecutionPlannerConfig,
        strategy_plugins: StrategyPluginRegistry,
    ) -> Result<Self, ExecutionPlannerError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone(), strategy_plugins.clone()) {
            Ok(planner) => Ok(planner),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path(), strategy_plugins)
            }
            Err(error) => Err(error),
        }
    }

    #[must_use]
    pub fn supported_strategy_keys(&self) -> Vec<String> {
        self.strategy_plugins.supported_strategy_keys()
    }

    #[must_use]
    pub fn strategy_specs(&self) -> Vec<RuntimeStrategySpec> {
        self.strategy_plugins.strategy_specs()
    }

    pub fn plan_and_store(
        &self,
        input: &ExecutionPlannerInput,
    ) -> Result<ExecutionPlanningResult, ExecutionPlannerError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;

        if let Some(existing) = load_plan_by_run_id(&transaction, &input.run.run_id)? {
            transaction.commit()?;
            return Ok(ExecutionPlanningResult {
                plan: existing,
                created: false,
            });
        }

        let plan = build_plan(&self.strategy_plugins, input)?;
        persist_plan(&transaction, &plan)?;
        transaction.commit()?;

        Ok(ExecutionPlanningResult {
            plan,
            created: true,
        })
    }

    pub fn get_plan(
        &self,
        plan_id: &str,
    ) -> Result<Option<RuntimeExecutionPlan>, ExecutionPlannerError> {
        let connection = self.open_connection()?;
        load_plan(&connection, plan_id)
    }

    pub fn list_plans(
        &self,
        deployment_id: &str,
    ) -> Result<Vec<RuntimeExecutionPlan>, ExecutionPlannerError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT record_json
             FROM execution_plans
             WHERE deployment_id = ?1
             ORDER BY created_at DESC, plan_id DESC",
        )?;
        let rows = statement.query_map(params![deployment_id], |row| row.get::<_, String>(0))?;
        let mut plans = Vec::new();
        for row in rows {
            plans.push(deserialize_json(&row?)?);
        }
        Ok(plans)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> ExecutionPlannerSnapshot {
        match self.snapshot_counts() {
            Ok((plan_count, latest_plan_at)) => ExecutionPlannerSnapshot {
                status: "healthy".to_string(),
                plan_count,
                latest_plan_at,
                last_error: None,
            },
            Err(error) => ExecutionPlannerSnapshot {
                status: "degraded".to_string(),
                plan_count: 0,
                latest_plan_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<(u64, Option<String>), ExecutionPlannerError> {
        let connection = self.open_connection()?;
        let plan_count =
            connection.query_row("SELECT COUNT(*) FROM execution_plans", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let latest_plan_at = connection
            .query_row(
                "SELECT created_at
                 FROM execution_plans
                 ORDER BY created_at DESC, plan_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok((plan_count, latest_plan_at))
    }

    fn open_connection(&self) -> Result<Connection, ExecutionPlannerError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(
        database_path: PathBuf,
        strategy_plugins: StrategyPluginRegistry,
    ) -> Result<Self, ExecutionPlannerError> {
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let planner = Self {
            database_path,
            strategy_plugins: Arc::new(strategy_plugins),
        };
        let connection = planner.open_connection()?;
        initialize_schema(&connection)?;
        Ok(planner)
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS execution_plans (
            plan_id TEXT PRIMARY KEY,
            deployment_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            lane TEXT NOT NULL,
            mode TEXT NOT NULL,
            created_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_execution_plans_deployment_created
            ON execution_plans (deployment_id, created_at DESC);",
    )
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return PathBuf::from(".tmp/runtime-rs/execution-planner.sqlite3");
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
        .join("execution-planner.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &ExecutionPlannerError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path() {
        return false;
    }

    match error {
        ExecutionPlannerError::Io(inner) => inner.kind() == std::io::ErrorKind::PermissionDenied,
        ExecutionPlannerError::Storage(inner) => {
            matches!(
                inner,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::CannotOpen
            )
        }
        ExecutionPlannerError::Serialization(_)
        | ExecutionPlannerError::InvalidUsdAmount { .. }
        | ExecutionPlannerError::InvalidNumericValue { .. }
        | ExecutionPlannerError::RiskNotAllowed { .. }
        | ExecutionPlannerError::PlanNotFound { .. }
        | ExecutionPlannerError::UnsupportedStrategy(_)
        | ExecutionPlannerError::StrategyCatalog(_) => false,
    }
}

fn build_plan(
    strategy_plugins: &StrategyPluginRegistry,
    input: &ExecutionPlannerInput,
) -> Result<RuntimeExecutionPlan, ExecutionPlannerError> {
    if input.risk_verdict.verdict != RuntimeRiskDecision::Allow {
        return Err(ExecutionPlannerError::RiskNotAllowed {
            verdict_id: input.risk_verdict.verdict_id.clone(),
        });
    }

    let lane = selected_lane(&input.deployment);
    let (simulate_only, dry_run) = execution_flags(&input.deployment.mode);
    let decision = strategy_trade_decision(strategy_plugins, input)?;
    let mid_price = parse_decimal(
        "featureSnapshot.midPriceUsd",
        &input.feature_snapshot.mid_price_usd,
    )?;
    let quote_decimals = balance_decimals(
        &input.ledger_snapshot.balances,
        &input.deployment.pair.quote_mint,
        6,
    );
    let base_decimals = balance_decimals(
        &input.ledger_snapshot.balances,
        &input.deployment.pair.base_mint,
        9,
    );
    let slippage_bps = input.deployment.policy.max_slippage_bps;
    let notional_usd = format_usd_cents(decision.notional_cents);
    let input_amount_atomic = match decision.direction {
        SwapDirection::BuyBase => atomic_from_usd_cents(decision.notional_cents, quote_decimals),
        SwapDirection::SellBase => {
            let quantity = ((decision.notional_cents as f64) / 100.0) / mid_price;
            atomic_from_token_amount(quantity, base_decimals)
        }
    };
    let min_output_amount_atomic = Some(match decision.direction {
        SwapDirection::BuyBase => {
            let quantity = (((decision.notional_cents as f64) / 100.0) / mid_price)
                * (1.0 - (f64::from(slippage_bps) / 10_000.0));
            atomic_from_token_amount(quantity, base_decimals)
        }
        SwapDirection::SellBase => {
            let output_usd = ((decision.notional_cents as f64) / 100.0)
                * (1.0 - (f64::from(slippage_bps) / 10_000.0));
            atomic_from_token_amount(output_usd, quote_decimals)
        }
    });
    let (input_mint, output_mint) = match decision.direction {
        SwapDirection::BuyBase => (
            input.deployment.pair.quote_mint.clone(),
            input.deployment.pair.base_mint.clone(),
        ),
        SwapDirection::SellBase => (
            input.deployment.pair.base_mint.clone(),
            input.deployment.pair.quote_mint.clone(),
        ),
    };
    let idempotency_key = format!("{}:{}", input.deployment.deployment_id, input.run.run_id);

    Ok(RuntimeExecutionPlan {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        plan_id: build_plan_id(&idempotency_key),
        deployment_id: input.deployment.deployment_id.clone(),
        owner_user_id: Some(input.deployment.owner_user_id.clone()),
        sleeve_id: Some(input.deployment.sleeve_id.clone()),
        run_id: input.run.run_id.clone(),
        created_at: now_rfc3339(),
        mode: input.deployment.mode.clone(),
        lane,
        idempotency_key,
        simulate_only,
        dry_run,
        slices: vec![RuntimeExecutionSlice {
            slice_id: "slice_1".to_string(),
            action: decision.action,
            input_mint,
            output_mint,
            input_amount_atomic,
            min_output_amount_atomic,
            notional_usd,
            slippage_bps,
        }],
    })
}

fn strategy_trade_decision(
    strategy_plugins: &StrategyPluginRegistry,
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    let plugin = strategy_plugins
        .get(&input.deployment.strategy_key)
        .ok_or_else(|| {
            ExecutionPlannerError::UnsupportedStrategy(input.deployment.strategy_key.clone())
        })?;
    plugin.trade_decision(input)
}

fn dca_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    Ok(StrategyTradeDecision {
        action: RuntimeExecutionAction::Buy,
        direction: SwapDirection::BuyBase,
        notional_cents: desired_notional_cents(&input.deployment)?,
    })
}

fn threshold_rebalance_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    threshold_rebalance_decision(input, desired_notional_cents(&input.deployment)?)
}

fn twap_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    Ok(twap_decision(
        input,
        desired_notional_cents(&input.deployment)?,
    ))
}

fn trend_following_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    Ok(signal_following_decision(
        short_signal(input)?,
        desired_notional_cents(&input.deployment)?,
    ))
}

fn mean_reversion_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    Ok(mean_reversion_decision(
        short_signal(input)?,
        desired_notional_cents(&input.deployment)?,
    ))
}

fn breakout_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    Ok(breakout_decision(
        short_signal(input)?,
        long_signal(input)?,
        desired_notional_cents(&input.deployment)?,
    ))
}

fn macro_rotation_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    Ok(macro_rotation_decision(
        short_signal(input)?,
        long_signal(input)?,
        desired_notional_cents(&input.deployment)?,
    ))
}

fn volatility_target_trade_decision(
    input: &ExecutionPlannerInput,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    volatility_target_decision(
        input,
        realized_volatility_bps(input)?,
        desired_notional_cents(&input.deployment)?,
    )
}

fn short_signal(input: &ExecutionPlannerInput) -> Result<f64, ExecutionPlannerError> {
    input
        .feature_snapshot
        .short_return_bps
        .as_deref()
        .map(|value| parse_signed_decimal("featureSnapshot.shortReturnBps", value))
        .transpose()
        .map(|value| value.unwrap_or(0.0))
}

fn long_signal(input: &ExecutionPlannerInput) -> Result<Option<f64>, ExecutionPlannerError> {
    input
        .feature_snapshot
        .long_return_bps
        .as_deref()
        .map(|value| parse_signed_decimal("featureSnapshot.longReturnBps", value))
        .transpose()
}

fn realized_volatility_bps(
    input: &ExecutionPlannerInput,
) -> Result<Option<f64>, ExecutionPlannerError> {
    input
        .feature_snapshot
        .realized_volatility_bps
        .as_deref()
        .map(|value| parse_decimal("featureSnapshot.realizedVolatilityBps", value))
        .transpose()
}

fn signal_following_decision(signal: f64, notional_cents: i64) -> StrategyTradeDecision {
    if signal >= 0.0 {
        StrategyTradeDecision {
            action: RuntimeExecutionAction::Buy,
            direction: SwapDirection::BuyBase,
            notional_cents,
        }
    } else {
        StrategyTradeDecision {
            action: RuntimeExecutionAction::Sell,
            direction: SwapDirection::SellBase,
            notional_cents,
        }
    }
}

fn mean_reversion_decision(signal: f64, notional_cents: i64) -> StrategyTradeDecision {
    if signal >= 0.0 {
        StrategyTradeDecision {
            action: RuntimeExecutionAction::Sell,
            direction: SwapDirection::SellBase,
            notional_cents,
        }
    } else {
        StrategyTradeDecision {
            action: RuntimeExecutionAction::Buy,
            direction: SwapDirection::BuyBase,
            notional_cents,
        }
    }
}

fn breakout_decision(
    short_signal: f64,
    long_signal: Option<f64>,
    notional_cents: i64,
) -> StrategyTradeDecision {
    let Some(long_signal) = long_signal else {
        return noop_decision(
            RuntimeExecutionAction::Buy,
            if short_signal >= 0.0 {
                SwapDirection::BuyBase
            } else {
                SwapDirection::SellBase
            },
        );
    };

    if short_signal >= BREAKOUT_SIGNAL_THRESHOLD_BPS
        && long_signal >= BREAKOUT_CONFIRMATION_THRESHOLD_BPS
    {
        return StrategyTradeDecision {
            action: RuntimeExecutionAction::Buy,
            direction: SwapDirection::BuyBase,
            notional_cents,
        };
    }

    if short_signal <= -BREAKOUT_SIGNAL_THRESHOLD_BPS
        && long_signal <= -BREAKOUT_CONFIRMATION_THRESHOLD_BPS
    {
        return StrategyTradeDecision {
            action: RuntimeExecutionAction::Sell,
            direction: SwapDirection::SellBase,
            notional_cents,
        };
    }

    noop_decision(
        RuntimeExecutionAction::Buy,
        if short_signal >= 0.0 {
            SwapDirection::BuyBase
        } else {
            SwapDirection::SellBase
        },
    )
}

fn macro_rotation_decision(
    short_signal: f64,
    long_signal: Option<f64>,
    notional_cents: i64,
) -> StrategyTradeDecision {
    let Some(long_signal) = long_signal else {
        return noop_decision(
            RuntimeExecutionAction::Buy,
            if short_signal >= 0.0 {
                SwapDirection::BuyBase
            } else {
                SwapDirection::SellBase
            },
        );
    };

    if long_signal >= MACRO_ROTATION_REGIME_THRESHOLD_BPS && short_signal >= 0.0 {
        return StrategyTradeDecision {
            action: RuntimeExecutionAction::Buy,
            direction: SwapDirection::BuyBase,
            notional_cents,
        };
    }

    if long_signal <= -MACRO_ROTATION_REGIME_THRESHOLD_BPS && short_signal <= 0.0 {
        return StrategyTradeDecision {
            action: RuntimeExecutionAction::Sell,
            direction: SwapDirection::SellBase,
            notional_cents,
        };
    }

    noop_decision(
        RuntimeExecutionAction::Buy,
        if long_signal >= 0.0 {
            SwapDirection::BuyBase
        } else {
            SwapDirection::SellBase
        },
    )
}

fn volatility_target_decision(
    input: &ExecutionPlannerInput,
    realized_volatility_bps: Option<f64>,
    notional_cents: i64,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    let equity_cents = parse_non_negative_usd_cents(
        "ledgerSnapshot.totals.equityUsd",
        &input.ledger_snapshot.totals.equity_usd,
    )?;
    let base_exposure_cents = current_base_exposure_cents(input, &input.deployment.pair.base_mint)?;
    let Some(realized_volatility_bps) = realized_volatility_bps else {
        return Ok(noop_decision(
            RuntimeExecutionAction::Rebalance,
            if base_exposure_cents > 0 {
                SwapDirection::SellBase
            } else {
                SwapDirection::BuyBase
            },
        ));
    };
    let target_bps = if realized_volatility_bps <= VOLATILITY_TARGET_LOW_THRESHOLD_BPS {
        VOLATILITY_TARGET_LOW_BPS
    } else if realized_volatility_bps <= VOLATILITY_TARGET_MEDIUM_THRESHOLD_BPS {
        VOLATILITY_TARGET_MEDIUM_BPS
    } else {
        VOLATILITY_TARGET_HIGH_BPS
    };
    let target_base_cents = (equity_cents * target_bps) / 10_000;
    let delta_cents = target_base_cents - base_exposure_cents;
    let trade_cents = notional_cents.min(delta_cents.abs());

    if trade_cents == 0 {
        return Ok(noop_decision(
            RuntimeExecutionAction::Rebalance,
            if delta_cents >= 0 {
                SwapDirection::BuyBase
            } else {
                SwapDirection::SellBase
            },
        ));
    }

    Ok(StrategyTradeDecision {
        action: RuntimeExecutionAction::Rebalance,
        direction: if delta_cents >= 0 {
            SwapDirection::BuyBase
        } else {
            SwapDirection::SellBase
        },
        notional_cents: trade_cents,
    })
}

fn twap_decision(input: &ExecutionPlannerInput, notional_cents: i64) -> StrategyTradeDecision {
    let divisor = i64::from(input.deployment.policy.max_concurrent_runs.max(1));
    let per_run_notional = (notional_cents / divisor).max(1);
    let base_exposure_cents =
        current_base_exposure_cents(input, &input.deployment.pair.base_mint).unwrap_or(0);

    if base_exposure_cents > 0 {
        StrategyTradeDecision {
            action: RuntimeExecutionAction::Sell,
            direction: SwapDirection::SellBase,
            notional_cents: per_run_notional.min(base_exposure_cents),
        }
    } else {
        StrategyTradeDecision {
            action: RuntimeExecutionAction::Buy,
            direction: SwapDirection::BuyBase,
            notional_cents: per_run_notional,
        }
    }
}

fn noop_decision(
    action: RuntimeExecutionAction,
    direction: SwapDirection,
) -> StrategyTradeDecision {
    StrategyTradeDecision {
        action,
        direction,
        notional_cents: 0,
    }
}

fn threshold_rebalance_decision(
    input: &ExecutionPlannerInput,
    notional_cents: i64,
) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
    let equity_cents = parse_non_negative_usd_cents(
        "ledgerSnapshot.totals.equityUsd",
        &input.ledger_snapshot.totals.equity_usd,
    )?;
    let base_exposure_cents = current_base_exposure_cents(input, &input.deployment.pair.base_mint)?;
    let target_base_cents = equity_cents / 2;
    let delta_cents = target_base_cents - base_exposure_cents;
    let tolerance_cents =
        (equity_cents * i64::from(input.deployment.policy.rebalance_tolerance_bps)) / 10_000;
    let trade_cents = if delta_cents.abs() <= tolerance_cents {
        0
    } else {
        notional_cents.min(delta_cents.abs())
    };

    Ok(StrategyTradeDecision {
        action: RuntimeExecutionAction::Rebalance,
        direction: if delta_cents >= 0 {
            SwapDirection::BuyBase
        } else {
            SwapDirection::SellBase
        },
        notional_cents: trade_cents,
    })
}

fn current_base_exposure_cents(
    input: &ExecutionPlannerInput,
    base_mint: &str,
) -> Result<i64, ExecutionPlannerError> {
    if let Some(position) = input
        .ledger_snapshot
        .positions
        .iter()
        .find(|position| position.instrument_id == input.deployment.pair.symbol)
    {
        let quantity = parse_decimal(
            "ledgerSnapshot.position.quantityAtomic",
            &position.quantity_atomic,
        )?;
        let decimals = balance_decimals(&input.ledger_snapshot.balances, base_mint, 9);
        let quantity_tokens = quantity / 10_f64.powi(i32::from(decimals));
        let mark_price = position
            .mark_price_usd
            .as_deref()
            .or(position.entry_price_usd.as_deref())
            .map(|value| parse_decimal("ledgerSnapshot.position.markPriceUsd", value))
            .transpose()?
            .unwrap_or(0.0);
        return Ok((quantity_tokens * mark_price * 100.0).round() as i64);
    }

    let maybe_balance = input
        .ledger_snapshot
        .balances
        .iter()
        .find(|balance| balance.mint == base_mint);
    let Some(balance) = maybe_balance else {
        return Ok(0);
    };
    let free = parse_decimal("ledgerSnapshot.balance.freeAtomic", &balance.free_atomic)?;
    let reserved = parse_decimal(
        "ledgerSnapshot.balance.reservedAtomic",
        &balance.reserved_atomic,
    )?;
    let price = balance
        .price_usd
        .as_deref()
        .map(|value| parse_decimal("ledgerSnapshot.balance.priceUsd", value))
        .transpose()?
        .unwrap_or(0.0);
    let tokens = (free + reserved) / 10_f64.powi(i32::from(balance.decimals));
    Ok((tokens * price * 100.0).round() as i64)
}

fn selected_lane(deployment: &RuntimeDeploymentRecord) -> RuntimeLane {
    if deployment.mode == RuntimeMode::Shadow {
        RuntimeLane::Safe
    } else {
        deployment.lane.clone()
    }
}

fn execution_flags(mode: &RuntimeMode) -> (bool, bool) {
    match mode {
        RuntimeMode::Shadow => (true, true),
        RuntimeMode::Paper => (false, true),
        RuntimeMode::Live => (false, false),
    }
}

fn desired_notional_cents(
    deployment: &RuntimeDeploymentRecord,
) -> Result<i64, ExecutionPlannerError> {
    let reserved_cents =
        parse_non_negative_usd_cents("capital.reservedUsd", &deployment.capital.reserved_usd)?;
    let max_notional_cents =
        parse_non_negative_usd_cents("policy.maxNotionalUsd", &deployment.policy.max_notional_usd)?;
    Ok(reserved_cents.min(max_notional_cents))
}

fn balance_decimals(balances: &[RuntimeLedgerBalance], mint: &str, fallback: u8) -> u8 {
    balances
        .iter()
        .find(|balance| balance.mint == mint)
        .map(|balance| balance.decimals)
        .unwrap_or(fallback)
}

fn atomic_from_usd_cents(cents: i64, decimals: u8) -> String {
    let multiplier = 10_i128.pow(u32::from(decimals.saturating_sub(2)));
    (i128::from(cents) * multiplier).to_string()
}

fn atomic_from_token_amount(amount: f64, decimals: u8) -> String {
    let scale = 10_f64.powi(i32::from(decimals));
    amount.max(0.0).mul_add(scale, 0.0).floor().to_string()
}

fn parse_decimal(field: &'static str, value: &str) -> Result<f64, ExecutionPlannerError> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|parsed| parsed.is_finite() && *parsed >= 0.0)
        .ok_or_else(|| ExecutionPlannerError::InvalidNumericValue {
            field,
            value: value.to_string(),
        })
}

fn parse_signed_decimal(field: &'static str, value: &str) -> Result<f64, ExecutionPlannerError> {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|parsed| parsed.is_finite())
        .ok_or_else(|| ExecutionPlannerError::InvalidNumericValue {
            field,
            value: value.to_string(),
        })
}

fn load_plan(
    connection: &Connection,
    plan_id: &str,
) -> Result<Option<RuntimeExecutionPlan>, ExecutionPlannerError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM execution_plans WHERE plan_id = ?1",
            params![plan_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn load_plan_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeExecutionPlan>, ExecutionPlannerError> {
    let raw = connection
        .query_row(
            "SELECT record_json FROM execution_plans WHERE run_id = ?1",
            params![run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

fn persist_plan(
    connection: &Connection,
    plan: &RuntimeExecutionPlan,
) -> Result<(), ExecutionPlannerError> {
    connection.execute(
        "INSERT INTO execution_plans (
            plan_id,
            deployment_id,
            run_id,
            lane,
            mode,
            created_at,
            record_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &plan.plan_id,
            &plan.deployment_id,
            &plan.run_id,
            lane_key(&plan.lane),
            mode_key(&plan.mode),
            &plan.created_at,
            serialize_json(plan)?,
        ],
    )?;
    Ok(())
}

fn lane_key(lane: &RuntimeLane) -> &'static str {
    match lane {
        RuntimeLane::Safe => "safe",
        RuntimeLane::Protected => "protected",
        RuntimeLane::Fast => "fast",
    }
}

fn mode_key(mode: &RuntimeMode) -> &'static str {
    match mode {
        RuntimeMode::Shadow => "shadow",
        RuntimeMode::Paper => "paper",
        RuntimeMode::Live => "live",
    }
}

fn build_plan_id(idempotency_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(idempotency_key.as_bytes());
    let digest = hasher.finalize();
    format!("plan_{}", hex_encode(&digest[..12]))
}

fn parse_usd_cents(field: &'static str, value: &str) -> Result<i64, ExecutionPlannerError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ExecutionPlannerError::InvalidUsdAmount {
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
        return Err(ExecutionPlannerError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        });
    }

    let whole = whole_raw
        .parse::<i64>()
        .map_err(|_| ExecutionPlannerError::InvalidUsdAmount {
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
        .ok_or_else(|| ExecutionPlannerError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        })?;

    Ok(sign * cents)
}

fn parse_non_negative_usd_cents(
    field: &'static str,
    value: &str,
) -> Result<i64, ExecutionPlannerError> {
    let cents = parse_usd_cents(field, value)?;
    if cents < 0 {
        return Err(ExecutionPlannerError::InvalidUsdAmount {
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
        .format(&time::format_description::well_known::Rfc3339)
        .expect("current time to format")
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use protocol::{
        RuntimeCapital, RuntimeDeploymentState, RuntimeLedgerTotals, RuntimePair, RuntimePolicy,
        RuntimeRiskLimits, RuntimeRiskObserved, RuntimeRiskReason, RuntimeRiskSeverity,
        RuntimeRunState, RuntimeStrategySpec, RuntimeTrigger, RuntimeTriggerKind,
    };
    use strategy_core::StrategyKind;

    use super::*;

    #[derive(Debug)]
    struct TestStrategyPlugin {
        spec: RuntimeStrategySpec,
    }

    impl StrategyPlugin for TestStrategyPlugin {
        fn spec(&self) -> &RuntimeStrategySpec {
            &self.spec
        }

        fn trade_decision(
            &self,
            _input: &ExecutionPlannerInput,
        ) -> Result<StrategyTradeDecision, ExecutionPlannerError> {
            Ok(StrategyTradeDecision {
                action: RuntimeExecutionAction::Buy,
                direction: SwapDirection::BuyBase,
                notional_cents: 1_234,
            })
        }
    }

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("execution-planner-{test_name}-{unique}.sqlite3"))
            .display()
            .to_string()
    }

    fn planner(test_name: &str) -> ExecutionPlanner {
        ExecutionPlanner::new(ExecutionPlannerConfig::new(temp_database_url(test_name)))
            .expect("planner to initialize")
    }

    fn planner_with_plugin(test_name: &str, strategy_key: &str) -> ExecutionPlanner {
        let mut plugins = StrategyPluginRegistry::default();
        plugins
            .register_plugin(TestStrategyPlugin {
                spec: custom_strategy_spec(strategy_key),
            })
            .expect("custom strategy plugin");
        ExecutionPlanner::with_plugins(
            ExecutionPlannerConfig::new(temp_database_url(test_name)),
            plugins,
        )
        .expect("planner to initialize")
    }

    fn custom_strategy_spec(strategy_key: &str) -> RuntimeStrategySpec {
        let mut spec = StrategyKind::Dca.spec();
        spec.strategy_key = strategy_key.to_string();
        spec.plugin_key = format!("test::{strategy_key}");
        spec.title = "Custom strategy".to_string();
        spec
    }

    fn deployment(
        strategy_key: &str,
        mode: RuntimeMode,
        lane: RuntimeLane,
    ) -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: "dep_1".to_string(),
            strategy_key: strategy_key.to_string(),
            sleeve_id: "sleeve_1".to_string(),
            owner_user_id: "user_1".to_string(),
            pair: RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            },
            mode,
            state: RuntimeDeploymentState::Shadow,
            lane,
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

    fn run(run_id: &str) -> RuntimeRunRecord {
        RuntimeRunRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            run_id: run_id.to_string(),
            deployment_id: "dep_1".to_string(),
            run_key: format!("dep_1:{run_id}"),
            trigger: RuntimeTrigger {
                kind: RuntimeTriggerKind::Signal,
                source: "test".to_string(),
                observed_at: "2026-03-07T18:05:00Z".to_string(),
                feature_snapshot_id: Some("snapshot_1".to_string()),
                reason: Some("test".to_string()),
            },
            state: RuntimeRunState::Planned,
            planned_at: "2026-03-07T18:05:00Z".to_string(),
            updated_at: "2026-03-07T18:05:00Z".to_string(),
            risk_verdict_id: Some("risk_1".to_string()),
            execution_plan_id: None,
            submit_request_id: None,
            receipt_id: None,
            failure_code: None,
            failure_message: None,
        }
    }

    fn feature_snapshot(short_return_bps: &str) -> DerivedMarketFeatureSnapshot {
        DerivedMarketFeatureSnapshot {
            cache_key: "fixture:SOL/USDC".to_string(),
            symbol: "SOL/USDC".to_string(),
            source: "fixture".to_string(),
            last_sequence: 1,
            observed_at: "2026-03-07T18:05:00Z".to_string(),
            age_ms: 100,
            stale: false,
            stale_reasons: Vec::new(),
            sample_count: 8,
            window_short_ms: 10_000,
            window_long_ms: 25_000,
            mid_price_usd: "150.00".to_string(),
            bid_price_usd: Some("149.95".to_string()),
            ask_price_usd: Some("150.05".to_string()),
            spread_bps: Some("15.0".to_string()),
            short_return_bps: Some(short_return_bps.to_string()),
            long_return_bps: Some("20.0".to_string()),
            realized_volatility_bps: Some("18.0".to_string()),
            processed_slot: Some(123),
            slot_age_ms: Some(100),
            slot_gap: Some(0),
            last_ingest_lag_ms: 10,
        }
    }

    fn ledger_snapshot() -> RuntimeLedgerSnapshot {
        RuntimeLedgerSnapshot {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            snapshot_id: "ledger_1".to_string(),
            deployment_id: "dep_1".to_string(),
            sleeve_id: "sleeve_1".to_string(),
            as_of: "2026-03-07T18:05:00Z".to_string(),
            balances: vec![
                RuntimeLedgerBalance {
                    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    symbol: "USDC".to_string(),
                    decimals: 6,
                    free_atomic: "95000000".to_string(),
                    reserved_atomic: "5000000".to_string(),
                    price_usd: Some("1.00".to_string()),
                },
                RuntimeLedgerBalance {
                    mint: "So11111111111111111111111111111111111111112".to_string(),
                    symbol: "SOL".to_string(),
                    decimals: 9,
                    free_atomic: "100000000".to_string(),
                    reserved_atomic: "0".to_string(),
                    price_usd: Some("150.00".to_string()),
                },
            ],
            positions: Vec::new(),
            totals: RuntimeLedgerTotals {
                equity_usd: "100".to_string(),
                reserved_usd: "5".to_string(),
                available_usd: "95".to_string(),
                realized_pnl_usd: "0".to_string(),
                unrealized_pnl_usd: "0".to_string(),
            },
        }
    }

    fn ledger_snapshot_with_balances(
        base_free_atomic: &str,
        usdc_free_atomic: &str,
        equity_usd: &str,
    ) -> RuntimeLedgerSnapshot {
        RuntimeLedgerSnapshot {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            snapshot_id: "ledger_custom".to_string(),
            deployment_id: "dep_1".to_string(),
            sleeve_id: "sleeve_1".to_string(),
            as_of: "2026-03-07T18:05:00Z".to_string(),
            balances: vec![
                RuntimeLedgerBalance {
                    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    symbol: "USDC".to_string(),
                    decimals: 6,
                    free_atomic: usdc_free_atomic.to_string(),
                    reserved_atomic: "5000000".to_string(),
                    price_usd: Some("1.00".to_string()),
                },
                RuntimeLedgerBalance {
                    mint: "So11111111111111111111111111111111111111112".to_string(),
                    symbol: "SOL".to_string(),
                    decimals: 9,
                    free_atomic: base_free_atomic.to_string(),
                    reserved_atomic: "0".to_string(),
                    price_usd: Some("150.00".to_string()),
                },
            ],
            positions: Vec::new(),
            totals: RuntimeLedgerTotals {
                equity_usd: equity_usd.to_string(),
                reserved_usd: "5".to_string(),
                available_usd: "95".to_string(),
                realized_pnl_usd: "0".to_string(),
                unrealized_pnl_usd: "0".to_string(),
            },
        }
    }

    fn allow_verdict() -> RuntimeRiskVerdict {
        RuntimeRiskVerdict {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            verdict_id: "risk_1".to_string(),
            deployment_id: "dep_1".to_string(),
            run_id: "run_1".to_string(),
            decided_at: "2026-03-07T18:05:01Z".to_string(),
            verdict: RuntimeRiskDecision::Allow,
            reasons: vec![RuntimeRiskReason {
                code: "within_limits".to_string(),
                message: "within limits".to_string(),
                severity: RuntimeRiskSeverity::Info,
            }],
            observed: RuntimeRiskObserved {
                requested_notional_usd: "5".to_string(),
                reserved_usd: "5".to_string(),
                concentration_bps: 500,
                feature_age_ms: 100,
            },
            limits: RuntimeRiskLimits {
                max_notional_usd: "25".to_string(),
                max_reserved_usd: "50".to_string(),
                max_concentration_bps: 3500,
                stale_after_ms: 5000,
            },
        }
    }

    fn input(
        run_id: &str,
        strategy_key: &str,
        mode: RuntimeMode,
        lane: RuntimeLane,
        short_return_bps: &str,
    ) -> ExecutionPlannerInput {
        let mut verdict = allow_verdict();
        verdict.run_id = run_id.to_string();
        ExecutionPlannerInput {
            deployment: deployment(strategy_key, mode, lane),
            run: run(run_id),
            feature_snapshot: feature_snapshot(short_return_bps),
            ledger_snapshot: ledger_snapshot(),
            risk_verdict: verdict,
        }
    }

    fn input_with_ledger_snapshot(
        run_id: &str,
        strategy_key: &str,
        mode: RuntimeMode,
        lane: RuntimeLane,
        short_return_bps: &str,
        ledger_snapshot: RuntimeLedgerSnapshot,
    ) -> ExecutionPlannerInput {
        let mut input = input(run_id, strategy_key, mode, lane, short_return_bps);
        input.ledger_snapshot = ledger_snapshot;
        input
    }

    fn input_with_feature_snapshot(
        run_id: &str,
        strategy_key: &str,
        mode: RuntimeMode,
        lane: RuntimeLane,
        short_return_bps: &str,
        long_return_bps: &str,
        realized_volatility_bps: &str,
    ) -> ExecutionPlannerInput {
        let mut input = input(run_id, strategy_key, mode, lane, short_return_bps);
        input.feature_snapshot.long_return_bps = Some(long_return_bps.to_string());
        input.feature_snapshot.realized_volatility_bps = Some(realized_volatility_bps.to_string());
        input
    }

    fn input_with_missing_feature_windows(
        run_id: &str,
        strategy_key: &str,
        mode: RuntimeMode,
        lane: RuntimeLane,
        short_return_bps: &str,
    ) -> ExecutionPlannerInput {
        let mut input = input(run_id, strategy_key, mode, lane, short_return_bps);
        input.feature_snapshot.long_return_bps = None;
        input.feature_snapshot.realized_volatility_bps = None;
        input
    }

    #[test]
    fn builds_shadow_dca_plans_deterministically() {
        let planner = planner("shadow-dca");
        let result = planner
            .plan_and_store(&input(
                "run_1",
                "dca",
                RuntimeMode::Shadow,
                RuntimeLane::Fast,
                "10.0",
            ))
            .expect("plan to store");

        assert!(result.created);
        assert_eq!(result.plan.lane, RuntimeLane::Safe);
        assert!(result.plan.simulate_only);
        assert!(result.plan.dry_run);
        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Buy);
        assert_eq!(result.plan.slices[0].input_amount_atomic, "5000000");
    }

    #[test]
    fn can_register_custom_strategy_plugins() {
        let planner = planner_with_plugin("custom-plugin", "custom_signal");
        let result = planner
            .plan_and_store(&input(
                "run_custom",
                "custom_signal",
                RuntimeMode::Shadow,
                RuntimeLane::Safe,
                "0.0",
            ))
            .expect("custom plan to store");

        assert!(result.created);
        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Buy);
        assert_eq!(result.plan.slices[0].input_amount_atomic, "12340000");
        assert_eq!(
            planner.supported_strategy_keys(),
            vec!["custom_signal".to_string()]
        );
    }

    #[test]
    fn preserves_lane_for_paper_mode() {
        let planner = planner("paper-lane");
        let result = planner
            .plan_and_store(&input(
                "run_2",
                "dca",
                RuntimeMode::Paper,
                RuntimeLane::Protected,
                "10.0",
            ))
            .expect("plan to store");

        assert_eq!(result.plan.lane, RuntimeLane::Protected);
        assert!(!result.plan.simulate_only);
        assert!(result.plan.dry_run);
    }

    #[test]
    fn trend_following_can_plan_sells() {
        let planner = planner("sell");
        let result = planner
            .plan_and_store(&input(
                "run_3",
                "trend_following",
                RuntimeMode::Paper,
                RuntimeLane::Fast,
                "-15.0",
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Sell);
        assert_eq!(
            result.plan.slices[0].input_mint,
            "So11111111111111111111111111111111111111112"
        );
    }

    #[test]
    fn is_idempotent_for_existing_run_ids() {
        let planner = planner("idempotent");
        let first = planner
            .plan_and_store(&input(
                "run_4",
                "dca",
                RuntimeMode::Shadow,
                RuntimeLane::Safe,
                "10.0",
            ))
            .expect("first plan");
        let second = planner
            .plan_and_store(&input(
                "run_4",
                "dca",
                RuntimeMode::Shadow,
                RuntimeLane::Safe,
                "10.0",
            ))
            .expect("second plan");

        assert!(first.created);
        assert!(!second.created);
        assert_eq!(first.plan.plan_id, second.plan.plan_id);
    }

    #[test]
    fn rejects_non_allow_risk_verdicts() {
        let planner = planner("deny");
        let mut input = input(
            "run_5",
            "dca",
            RuntimeMode::Shadow,
            RuntimeLane::Safe,
            "10.0",
        );
        input.risk_verdict.verdict = RuntimeRiskDecision::Reject;

        let error = planner
            .plan_and_store(&input)
            .expect_err("rejected verdict should fail");

        assert!(matches!(
            error,
            ExecutionPlannerError::RiskNotAllowed { .. }
        ));
    }

    #[test]
    fn threshold_rebalance_sells_when_base_exposure_is_overweight() {
        let planner = planner("threshold-rebalance-sell");
        let result = planner
            .plan_and_store(&input_with_ledger_snapshot(
                "run_6",
                "threshold_rebalance",
                RuntimeMode::Paper,
                RuntimeLane::Safe,
                "0.0",
                ledger_snapshot_with_balances("400000000", "35000000", "100"),
            ))
            .expect("plan to store");

        assert_eq!(
            result.plan.slices[0].action,
            RuntimeExecutionAction::Rebalance
        );
        assert_eq!(
            result.plan.slices[0].input_mint,
            "So11111111111111111111111111111111111111112"
        );
        assert_eq!(result.plan.slices[0].input_amount_atomic, "33333333");
        assert_eq!(result.plan.slices[0].notional_usd, "5.00");
    }

    #[test]
    fn threshold_rebalance_noops_inside_tolerance_band() {
        let planner = planner("threshold-rebalance-noop");
        let result = planner
            .plan_and_store(&input_with_ledger_snapshot(
                "run_7",
                "threshold_rebalance",
                RuntimeMode::Shadow,
                RuntimeLane::Safe,
                "0.0",
                ledger_snapshot_with_balances("330000000", "45500000", "100"),
            ))
            .expect("plan to store");

        assert_eq!(
            result.plan.slices[0].action,
            RuntimeExecutionAction::Rebalance
        );
        assert_eq!(result.plan.slices[0].input_amount_atomic, "0");
        assert_eq!(
            result.plan.slices[0].min_output_amount_atomic.as_deref(),
            Some("0")
        );
        assert_eq!(result.plan.slices[0].notional_usd, "0.00");
    }

    #[test]
    fn twap_scales_entry_notional_by_max_concurrent_runs() {
        let planner = planner("twap-buy");
        let result = planner
            .plan_and_store(&input_with_ledger_snapshot(
                "run_8",
                "twap",
                RuntimeMode::Paper,
                RuntimeLane::Protected,
                "0.0",
                ledger_snapshot_with_balances("0", "95000000", "95"),
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Buy);
        assert_eq!(result.plan.slices[0].input_amount_atomic, "2500000");
        assert_eq!(result.plan.slices[0].notional_usd, "2.50");
    }

    #[test]
    fn twap_exits_with_sell_when_base_exposure_exists() {
        let planner = planner("twap-sell");
        let result = planner
            .plan_and_store(&input_with_ledger_snapshot(
                "run_9",
                "twap",
                RuntimeMode::Live,
                RuntimeLane::Safe,
                "0.0",
                ledger_snapshot_with_balances("100000000", "90000000", "105"),
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Sell);
        assert_eq!(
            result.plan.slices[0].input_mint,
            "So11111111111111111111111111111111111111112"
        );
        assert_eq!(result.plan.slices[0].notional_usd, "2.50");
    }

    #[test]
    fn mean_reversion_buys_after_negative_signal() {
        let planner = planner("mean-reversion-buy");
        let result = planner
            .plan_and_store(&input(
                "run_10",
                "mean_reversion",
                RuntimeMode::Paper,
                RuntimeLane::Safe,
                "-12.0",
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Buy);
        assert_eq!(
            result.plan.slices[0].input_mint,
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        );
    }

    #[test]
    fn breakout_waits_for_directional_confirmation() {
        let planner = planner("breakout-confirmation");
        let result = planner
            .plan_and_store(&input_with_feature_snapshot(
                "run_11",
                "breakout",
                RuntimeMode::Shadow,
                RuntimeLane::Safe,
                "24.0",
                "-2.0",
                "18.0",
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Buy);
        assert_eq!(result.plan.slices[0].input_amount_atomic, "0");
        assert_eq!(result.plan.slices[0].notional_usd, "0.00");
    }

    #[test]
    fn breakout_noops_without_long_window_confirmation() {
        let planner = planner("breakout-no-long-window");
        let result = planner
            .plan_and_store(&input_with_missing_feature_windows(
                "run_12",
                "breakout",
                RuntimeMode::Shadow,
                RuntimeLane::Safe,
                "24.0",
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].input_amount_atomic, "0");
        assert_eq!(result.plan.slices[0].notional_usd, "0.00");
    }

    #[test]
    fn macro_rotation_sells_in_negative_regime() {
        let planner = planner("macro-rotation-sell");
        let result = planner
            .plan_and_store(&input_with_feature_snapshot(
                "run_13",
                "macro_rotation",
                RuntimeMode::Paper,
                RuntimeLane::Safe,
                "-4.0",
                "-18.0",
                "18.0",
            ))
            .expect("plan to store");

        assert_eq!(result.plan.slices[0].action, RuntimeExecutionAction::Sell);
        assert_eq!(
            result.plan.slices[0].input_mint,
            "So11111111111111111111111111111111111111112"
        );
    }

    #[test]
    fn volatility_target_reduces_base_when_realized_volatility_is_high() {
        let planner = planner("volatility-target-sell");
        let result = planner
            .plan_and_store(&input_with_ledger_snapshot(
                "run_14",
                "volatility_target",
                RuntimeMode::Live,
                RuntimeLane::Safe,
                "0.0",
                ledger_snapshot_with_balances("400000000", "35000000", "100"),
            ))
            .expect("plan to store");

        assert_eq!(
            result.plan.slices[0].action,
            RuntimeExecutionAction::Rebalance
        );
        assert_eq!(
            result.plan.slices[0].input_mint,
            "So11111111111111111111111111111111111111112"
        );
        assert_eq!(result.plan.slices[0].notional_usd, "5.00");
    }

    #[test]
    fn volatility_target_noops_without_realized_volatility() {
        let planner = planner("volatility-target-no-vol");
        let result = planner
            .plan_and_store(&input_with_missing_feature_windows(
                "run_15",
                "volatility_target",
                RuntimeMode::Paper,
                RuntimeLane::Safe,
                "0.0",
            ))
            .expect("plan to store");

        assert_eq!(
            result.plan.slices[0].action,
            RuntimeExecutionAction::Rebalance
        );
        assert_eq!(result.plan.slices[0].input_amount_atomic, "0");
        assert_eq!(result.plan.slices[0].notional_usd, "0.00");
    }
}
