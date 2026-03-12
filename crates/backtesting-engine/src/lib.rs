use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Path, PathBuf},
};

use feature_cache::{
    DerivedMarketFeatureSnapshot, FeatureCache, FeatureCacheConfig, FeatureCacheError,
};
use market_adapters::{FeedGatewayError, FeedReplayFixture};
use protocol::{
    RuntimeBacktestBaseline, RuntimeBacktestBaselineComparison, RuntimeBacktestConfig,
    RuntimeBacktestFoldReport, RuntimeBacktestMetrics, RuntimeBacktestRegimeMetrics,
    RuntimeBacktestReport, RuntimeBacktestStatus, RuntimeBacktestWindowMode,
    RuntimeExecutionCostModelRecord, RuntimeFeatureDefinitionRecord, RuntimeRegimeTagRecord,
    RuntimeReplayCorpusRecord, RuntimeResearchExperimentRecord, RuntimeStrategySpec,
    RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const FEATURE_STALE_AFTER_MS: u64 = 20_000;
const SLOT_STALE_AFTER_MS: u64 = 15_000;
const MAX_SLOT_GAP: u64 = 2;
const SHORT_WINDOW_MS: u64 = 10_000;
const LONG_WINDOW_MS: u64 = 25_000;
const VOLATILITY_WINDOW_SIZE: usize = 4;
const MAX_SAMPLES_PER_STREAM: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacktestingEngineConfig {
    pub database_url: String,
}

impl BacktestingEngineConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct BacktestingEngine {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestingEngineSnapshot {
    pub status: String,
    pub report_count: u64,
    pub latest_report_generated_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BacktestingQuery {
    pub report_id: Option<String>,
    pub experiment_id: Option<String>,
    pub strategy_key: Option<String>,
    pub promotion_eligible: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacktestRunRequest {
    pub report_id: Option<String>,
    pub experiment: RuntimeResearchExperimentRecord,
    pub strategy_spec: RuntimeStrategySpec,
    pub cost_model: Option<RuntimeExecutionCostModelRecord>,
    pub feature_definitions: Vec<RuntimeFeatureDefinitionRecord>,
    pub regime_tags: Vec<RuntimeRegimeTagRecord>,
    pub replay_corpus: RuntimeReplayCorpusRecord,
    pub config: RuntimeBacktestConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacktestRunResult {
    pub report: RuntimeBacktestReport,
    pub created: bool,
}

#[derive(Debug, Error)]
pub enum BacktestingEngineError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("feed fixture error: {0}")]
    FeedFixture(#[from] FeedGatewayError),
    #[error("feature cache error: {0}")]
    FeatureCache(#[from] FeatureCacheError),
    #[error("invalid timestamp for {field}: {value}")]
    InvalidTimestamp { field: &'static str, value: String },
    #[error("invalid numeric value for {field}: {value}")]
    InvalidNumber { field: &'static str, value: String },
    #[error("unsupported fixture uri: {uri}")]
    UnsupportedFixtureUri { uri: String },
    #[error("replay corpus {corpus_id} does not include a fixture uri")]
    MissingFixtureUri { corpus_id: String },
    #[error("invalid backtest config: {reason}")]
    InvalidConfig { reason: String },
    #[error(
        "insufficient observations for backtest: required at least {required}, got {available}"
    )]
    InsufficientObservations { required: usize, available: usize },
    #[error("backtest report {report_id} not found")]
    ReportNotFound { report_id: String },
}

impl BacktestingEngine {
    pub fn new(config: BacktestingEngineConfig) -> Result<Self, BacktestingEngineError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(engine) => Ok(engine),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn run(
        &self,
        input: &BacktestRunRequest,
    ) -> Result<BacktestRunResult, BacktestingEngineError> {
        let report = build_report(input)?;

        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;
        let existing = load_report(&transaction, &report.report_id)?;
        persist_report(&transaction, &report)?;
        transaction.commit()?;
        Ok(BacktestRunResult {
            report,
            created: existing.is_none(),
        })
    }

    pub fn preview(
        &self,
        input: &BacktestRunRequest,
    ) -> Result<RuntimeBacktestReport, BacktestingEngineError> {
        build_report(input)
    }

    pub fn query(
        &self,
        query: &BacktestingQuery,
    ) -> Result<Vec<RuntimeBacktestReport>, BacktestingEngineError> {
        let connection = self.open_connection()?;
        list_reports(&connection, query)
    }

    pub fn get_report(
        &self,
        report_id: &str,
    ) -> Result<Option<RuntimeBacktestReport>, BacktestingEngineError> {
        let connection = self.open_connection()?;
        load_report(&connection, report_id)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> BacktestingEngineSnapshot {
        match self.snapshot_counts() {
            Ok(snapshot) => snapshot,
            Err(error) => BacktestingEngineSnapshot {
                status: "degraded".to_string(),
                report_count: 0,
                latest_report_generated_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<BacktestingEngineSnapshot, BacktestingEngineError> {
        let connection = self.open_connection()?;
        let report_count =
            connection.query_row("SELECT COUNT(*) FROM backtest_reports", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let latest_report_generated_at = connection
            .query_row(
                "SELECT generated_at
                 FROM backtest_reports
                 ORDER BY generated_at DESC, report_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(BacktestingEngineSnapshot {
            status: "healthy".to_string(),
            report_count,
            latest_report_generated_at,
            last_error: None,
        })
    }

    fn initialize_at_path(path: PathBuf) -> Result<Self, BacktestingEngineError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let engine = Self {
            database_path: path.clone(),
        };
        let connection = engine.open_connection()?;
        initialize_schema(&connection)?;
        Ok(engine)
    }

    fn open_connection(&self) -> Result<Connection, BacktestingEngineError> {
        let connection = Connection::open(&self.database_path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(connection)
    }
}

#[derive(Debug, Clone)]
struct Observation {
    observed_at: String,
    observed_at_ts: OffsetDateTime,
    next_observed_at: String,
    next_observed_at_ts: OffsetDateTime,
    next_return_bps: f64,
    feature: DerivedMarketFeatureSnapshot,
    regimes: Vec<(String, String)>,
}

#[derive(Debug, Clone, Default)]
struct Calibration {
    primary_threshold_bps: f64,
    confirmation_threshold_bps: f64,
    low_vol_threshold_bps: f64,
    high_vol_threshold_bps: f64,
}

#[derive(Debug, Clone, Default)]
struct RawMetrics {
    observation_count: u32,
    trade_count: u32,
    gross_return_bps: f64,
    net_return_bps: f64,
    total_cost_bps: f64,
    win_count: u32,
    max_drawdown_bps: f64,
}

#[derive(Debug, Clone, Default)]
struct RegimeAccumulator {
    observation_count: u32,
    trade_count: u32,
    net_return_bps: f64,
    win_count: u32,
}

#[derive(Debug, Clone)]
struct FoldEvaluation {
    fold_report: RuntimeBacktestFoldReport,
    raw_metrics: RawMetrics,
    baseline_totals: BTreeMap<RuntimeBacktestBaseline, f64>,
    regime_totals: BTreeMap<(String, String), RegimeAccumulator>,
}

#[derive(Debug, Clone)]
struct AggregateEvaluation {
    metrics: RuntimeBacktestMetrics,
    baselines: Vec<RuntimeBacktestBaselineComparison>,
    regimes: Vec<RuntimeBacktestRegimeMetrics>,
}

struct FoldEvaluationContext<'a> {
    training: &'a [Observation],
    testing: &'a [Observation],
    purged_observation_count: u32,
    strategy_spec: &'a RuntimeStrategySpec,
    calibration: &'a Calibration,
    cost_model: Option<&'a RuntimeExecutionCostModelRecord>,
    baselines: &'a [RuntimeBacktestBaseline],
}

fn evaluate_walk_forward_folds(
    observations: &[Observation],
    strategy_spec: &RuntimeStrategySpec,
    cost_model: Option<&RuntimeExecutionCostModelRecord>,
    config: &RuntimeBacktestConfig,
) -> Result<Vec<FoldEvaluation>, BacktestingEngineError> {
    let effective = observations.len();
    let train_size = config.training_window_observations as usize;
    let test_size = config.testing_window_observations as usize;
    let step_size = config.step_observations as usize;
    let purge_size = config.purge_observations as usize;
    let mut evaluations = Vec::new();
    let mut test_start = train_size + purge_size;
    let mut fold_index = 0_u32;

    while test_start + test_size <= effective {
        let train_end = test_start.saturating_sub(purge_size);
        let train_start = match config.window_mode {
            RuntimeBacktestWindowMode::Rolling => train_end.saturating_sub(train_size),
            RuntimeBacktestWindowMode::Expanding => 0,
        };
        if train_end <= train_start {
            break;
        }
        let training = &observations[train_start..train_end];
        let testing = &observations[test_start..test_start + test_size];
        let calibration = calibrate_strategy(strategy_spec, training);
        let context = FoldEvaluationContext {
            training,
            testing,
            purged_observation_count: purge_size as u32,
            strategy_spec,
            calibration: &calibration,
            cost_model,
            baselines: &config.baseline_strategies,
        };
        evaluations.push(evaluate_fold(fold_index, &context)?);
        fold_index += 1;
        test_start += step_size.max(1);
    }

    Ok(evaluations)
}

fn evaluate_fold(
    fold_index: u32,
    context: &FoldEvaluationContext<'_>,
) -> Result<FoldEvaluation, BacktestingEngineError> {
    let mut previous_exposure = 0.0_f64;
    let mut cumulative_net = 0.0_f64;
    let mut peak_net = 0.0_f64;
    let mut raw_metrics = RawMetrics::default();
    let mut baseline_totals = BTreeMap::new();
    let mut regime_totals: BTreeMap<(String, String), RegimeAccumulator> = BTreeMap::new();
    for baseline in context.baselines {
        baseline_totals.insert(baseline.clone(), 0.0);
    }

    for observation in context.testing {
        let exposure = target_exposure(context.strategy_spec, observation, context.calibration);
        let turnover = (exposure - previous_exposure).abs();
        let cost_bps = modeled_cost_bps(context.cost_model, turnover, observation)?;
        let gross_return_bps = exposure * observation.next_return_bps;
        let net_return_bps = gross_return_bps - cost_bps;

        raw_metrics.observation_count += 1;
        raw_metrics.gross_return_bps += gross_return_bps;
        raw_metrics.net_return_bps += net_return_bps;
        raw_metrics.total_cost_bps += cost_bps;
        if turnover > 0.0001 {
            raw_metrics.trade_count += 1;
        }
        if net_return_bps > 0.0 {
            raw_metrics.win_count += 1;
        }
        cumulative_net += net_return_bps;
        peak_net = peak_net.max(cumulative_net);
        raw_metrics.max_drawdown_bps = raw_metrics
            .max_drawdown_bps
            .max((peak_net - cumulative_net).max(0.0));

        for baseline in context.baselines {
            let entry = baseline_totals.entry(baseline.clone()).or_insert(0.0);
            *entry += baseline_return_bps(baseline, observation.next_return_bps);
        }
        for (regime_key, regime_value) in &observation.regimes {
            let entry = regime_totals
                .entry((regime_key.clone(), regime_value.clone()))
                .or_default();
            entry.observation_count += 1;
            if turnover > 0.0001 {
                entry.trade_count += 1;
            }
            entry.net_return_bps += net_return_bps;
            if net_return_bps > 0.0 {
                entry.win_count += 1;
            }
        }
        previous_exposure = exposure;
    }

    let fold_metrics = runtime_backtest_metrics(&raw_metrics);
    let baseline_comparisons = baseline_totals
        .iter()
        .map(
            |(baseline, baseline_return)| RuntimeBacktestBaselineComparison {
                baseline: baseline.clone(),
                baseline_return_bps: format_bps(*baseline_return),
                excess_return_bps: format_bps(raw_metrics.net_return_bps - *baseline_return),
            },
        )
        .collect::<Vec<_>>();
    let regime_metrics = regime_totals
        .iter()
        .map(
            |((regime_key, regime_value), accumulator)| RuntimeBacktestRegimeMetrics {
                regime_key: regime_key.clone(),
                regime_value: regime_value.clone(),
                observation_count: accumulator.observation_count,
                trade_count: accumulator.trade_count,
                net_return_bps: format_bps(accumulator.net_return_bps),
                win_rate_bps: rate_bps(accumulator.win_count, accumulator.observation_count),
            },
        )
        .collect::<Vec<_>>();

    Ok(FoldEvaluation {
        fold_report: RuntimeBacktestFoldReport {
            fold_id: format!("fold_{fold_index}"),
            fold_index,
            training_start_at: context
                .training
                .first()
                .map(|record| record.observed_at.clone())
                .unwrap_or_else(now_rfc3339),
            training_end_at: context
                .training
                .last()
                .map(|record| record.next_observed_at.clone())
                .unwrap_or_else(now_rfc3339),
            test_start_at: context
                .testing
                .first()
                .map(|record| record.observed_at.clone())
                .unwrap_or_else(now_rfc3339),
            test_end_at: context
                .testing
                .last()
                .map(|record| record.next_observed_at.clone())
                .unwrap_or_else(now_rfc3339),
            train_observation_count: context.training.len() as u32,
            purged_observation_count: context.purged_observation_count,
            test_observation_count: context.testing.len() as u32,
            metrics: fold_metrics,
            baseline_comparisons,
            regime_metrics,
        },
        raw_metrics,
        baseline_totals,
        regime_totals,
    })
}

fn aggregate_evaluations(
    evaluations: &[FoldEvaluation],
    baselines: &[RuntimeBacktestBaseline],
    strategy_spec: &RuntimeStrategySpec,
    blocking_reasons: &mut Vec<String>,
) -> AggregateEvaluation {
    let mut aggregate_raw = RawMetrics::default();
    let mut baseline_totals: BTreeMap<RuntimeBacktestBaseline, f64> = BTreeMap::new();
    let mut regime_totals: BTreeMap<(String, String), RegimeAccumulator> = BTreeMap::new();
    for baseline in baselines {
        baseline_totals.insert(baseline.clone(), 0.0);
    }

    for evaluation in evaluations {
        aggregate_raw.observation_count += evaluation.raw_metrics.observation_count;
        aggregate_raw.trade_count += evaluation.raw_metrics.trade_count;
        aggregate_raw.gross_return_bps += evaluation.raw_metrics.gross_return_bps;
        aggregate_raw.net_return_bps += evaluation.raw_metrics.net_return_bps;
        aggregate_raw.total_cost_bps += evaluation.raw_metrics.total_cost_bps;
        aggregate_raw.win_count += evaluation.raw_metrics.win_count;
        aggregate_raw.max_drawdown_bps = aggregate_raw
            .max_drawdown_bps
            .max(evaluation.raw_metrics.max_drawdown_bps);
        for (baseline, total) in &evaluation.baseline_totals {
            *baseline_totals.entry(baseline.clone()).or_insert(0.0) += total;
        }
        for (key, accumulator) in &evaluation.regime_totals {
            let entry = regime_totals.entry(key.clone()).or_default();
            entry.observation_count += accumulator.observation_count;
            entry.trade_count += accumulator.trade_count;
            entry.net_return_bps += accumulator.net_return_bps;
            entry.win_count += accumulator.win_count;
        }
    }

    if aggregate_raw.net_return_bps <= 0.0 {
        blocking_reasons.push("aggregate out-of-sample net return must be positive".to_string());
    }
    let flat_cash_total = baseline_totals
        .get(&RuntimeBacktestBaseline::FlatCash)
        .copied()
        .unwrap_or_default();
    if aggregate_raw.net_return_bps <= flat_cash_total {
        blocking_reasons.push("aggregate return must exceed flat-cash baseline".to_string());
    }
    if strategy_spec
        .regime_requirements
        .iter()
        .any(|required| !regime_totals.keys().any(|(key, _)| key == required))
    {
        blocking_reasons.push(
            "aggregate regime metrics did not cover every required strategy regime".to_string(),
        );
    }

    AggregateEvaluation {
        metrics: runtime_backtest_metrics(&aggregate_raw),
        baselines: baseline_totals
            .iter()
            .map(|(baseline, total)| RuntimeBacktestBaselineComparison {
                baseline: baseline.clone(),
                baseline_return_bps: format_bps(*total),
                excess_return_bps: format_bps(aggregate_raw.net_return_bps - *total),
            })
            .collect(),
        regimes: regime_totals
            .iter()
            .map(
                |((regime_key, regime_value), accumulator)| RuntimeBacktestRegimeMetrics {
                    regime_key: regime_key.clone(),
                    regime_value: regime_value.clone(),
                    observation_count: accumulator.observation_count,
                    trade_count: accumulator.trade_count,
                    net_return_bps: format_bps(accumulator.net_return_bps),
                    win_rate_bps: rate_bps(accumulator.win_count, accumulator.observation_count),
                },
            )
            .collect(),
    }
}

fn runtime_backtest_metrics(raw: &RawMetrics) -> RuntimeBacktestMetrics {
    RuntimeBacktestMetrics {
        observation_count: raw.observation_count,
        trade_count: raw.trade_count,
        gross_return_bps: format_bps(raw.gross_return_bps),
        net_return_bps: format_bps(raw.net_return_bps),
        total_cost_bps: format_bps(raw.total_cost_bps),
        win_rate_bps: rate_bps(raw.win_count, raw.observation_count),
        max_drawdown_bps: format_bps(raw.max_drawdown_bps),
    }
}

fn missing_required_feature_keys(
    strategy_spec: &RuntimeStrategySpec,
    feature_definitions: &[RuntimeFeatureDefinitionRecord],
) -> Vec<String> {
    let available = feature_definitions
        .iter()
        .map(|record| record.feature_key.clone())
        .collect::<BTreeSet<_>>();
    strategy_spec
        .feature_requirements
        .iter()
        .filter(|requirement| requirement.required && !available.contains(&requirement.feature_key))
        .map(|requirement| requirement.feature_key.clone())
        .collect()
}

fn missing_required_regime_keys(
    strategy_spec: &RuntimeStrategySpec,
    regime_tags: &[RuntimeRegimeTagRecord],
) -> Vec<String> {
    let available = regime_tags
        .iter()
        .map(|record| record.regime_key.clone())
        .collect::<BTreeSet<_>>();
    strategy_spec
        .regime_requirements
        .iter()
        .filter(|key| !available.contains(*key))
        .cloned()
        .collect()
}

fn build_observations(
    fixture: &FeedReplayFixture,
    regime_tags: &[RuntimeRegimeTagRecord],
) -> Result<Vec<Observation>, BacktestingEngineError> {
    let mut market_events = fixture.market_events.clone();
    market_events.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then(left.sequence.cmp(&right.sequence))
    });
    let mut slot_events = fixture.slot_events.clone();
    slot_events.sort_by(|left, right| {
        left.observed_at
            .cmp(&right.observed_at)
            .then(left.sequence.cmp(&right.sequence))
    });

    let mut feature_cache = FeatureCache::new(default_feature_cache_config());
    let mut slot_index = 0_usize;
    let mut snapshots = Vec::new();
    for event in &market_events {
        let observed_at_ts = parse_timestamp("marketEvent.observedAt", &event.observed_at)?;
        while slot_index < slot_events.len()
            && parse_timestamp("slotEvent.observedAt", &slot_events[slot_index].observed_at)?
                <= observed_at_ts
        {
            feature_cache.ingest_slot_event(slot_events[slot_index].clone())?;
            slot_index += 1;
        }
        feature_cache.ingest_market_event(event.clone())?;
        let snapshot = feature_cache.snapshot_at(observed_at_ts);
        let stream = snapshot
            .feature_streams
            .into_iter()
            .find(|stream| stream.symbol == event.symbol && stream.source == event.source)
            .ok_or_else(|| BacktestingEngineError::InvalidConfig {
                reason: format!(
                    "feature cache did not emit a stream for {} at {}",
                    event.symbol, event.observed_at
                ),
            })?;
        snapshots.push((event.price_usd.clone(), observed_at_ts, stream));
    }

    let regime_keys = regime_tags
        .iter()
        .map(|record| record.regime_key.clone())
        .collect::<BTreeSet<_>>();
    let mut observations = Vec::new();
    for (index, (_price, observed_at_ts, snapshot)) in snapshots.iter().enumerate() {
        if index + 1 >= snapshots.len() {
            break;
        }
        let current_price = parse_number("feature.midPriceUsd", &snapshot.mid_price_usd)?;
        let next_price =
            parse_number("feature.midPriceUsd", &snapshots[index + 1].2.mid_price_usd)?;
        let next_return_bps = if current_price <= 0.0 {
            0.0
        } else {
            ((next_price / current_price) - 1.0) * 10_000.0
        };
        let regimes = regime_keys
            .iter()
            .map(|key| (key.clone(), classify_regime(key, snapshot)))
            .collect::<Vec<_>>();
        observations.push(Observation {
            observed_at: snapshot.observed_at.clone(),
            observed_at_ts: *observed_at_ts,
            next_observed_at: snapshots[index + 1].2.observed_at.clone(),
            next_observed_at_ts: snapshots[index + 1].1,
            next_return_bps,
            feature: snapshot.clone(),
            regimes,
        });
    }
    Ok(observations)
}

fn classify_regime(regime_key: &str, snapshot: &DerivedMarketFeatureSnapshot) -> String {
    match regime_key {
        "short_trend" => classify_trend(snapshot.short_return_bps.as_deref(), 5.0),
        "long_trend" => classify_trend(snapshot.long_return_bps.as_deref(), 10.0),
        "volatility_band" => {
            let value = parse_optional_metric(snapshot.realized_volatility_bps.as_deref());
            match value {
                Some(value) if value < 12.0 => "low".to_string(),
                Some(value) if value < 20.0 => "medium".to_string(),
                Some(_) => "high".to_string(),
                None => "unknown".to_string(),
            }
        }
        "liquidity_state" => {
            let value = parse_optional_metric(snapshot.spread_bps.as_deref());
            match value {
                Some(value) if value < 10.0 => "tight".to_string(),
                Some(value) if value < 18.0 => "normal".to_string(),
                Some(_) => "wide".to_string(),
                None => "unknown".to_string(),
            }
        }
        _ => "unclassified".to_string(),
    }
}

fn classify_trend(value: Option<&str>, flat_threshold_bps: f64) -> String {
    match parse_optional_metric(value) {
        Some(value) if value > flat_threshold_bps => "up".to_string(),
        Some(value) if value < -flat_threshold_bps => "down".to_string(),
        Some(_) => "flat".to_string(),
        None => "unknown".to_string(),
    }
}

fn calibrate_strategy(
    strategy_spec: &RuntimeStrategySpec,
    observations: &[Observation],
) -> Calibration {
    let short_abs = observations
        .iter()
        .filter_map(|record| parse_optional_metric(record.feature.short_return_bps.as_deref()))
        .map(f64::abs)
        .collect::<Vec<_>>();
    let long_abs = observations
        .iter()
        .filter_map(|record| parse_optional_metric(record.feature.long_return_bps.as_deref()))
        .map(f64::abs)
        .collect::<Vec<_>>();
    let volatility = observations
        .iter()
        .filter_map(|record| {
            parse_optional_metric(record.feature.realized_volatility_bps.as_deref())
        })
        .collect::<Vec<_>>();
    let mut calibration = Calibration {
        primary_threshold_bps: percentile(short_abs.clone(), 0.5).unwrap_or(8.0).max(5.0),
        confirmation_threshold_bps: percentile(long_abs.clone(), 0.5).unwrap_or(10.0).max(8.0),
        low_vol_threshold_bps: percentile(volatility.clone(), 0.33)
            .unwrap_or(12.0)
            .max(8.0),
        high_vol_threshold_bps: percentile(volatility, 0.66).unwrap_or(20.0).max(12.0),
    };
    if strategy_spec.strategy_key == "breakout" {
        calibration.primary_threshold_bps = calibration.primary_threshold_bps.max(15.0);
        calibration.confirmation_threshold_bps = calibration.confirmation_threshold_bps.max(10.0);
    }
    calibration
}

fn target_exposure(
    strategy_spec: &RuntimeStrategySpec,
    observation: &Observation,
    calibration: &Calibration,
) -> f64 {
    let short_return =
        parse_optional_metric(observation.feature.short_return_bps.as_deref()).unwrap_or(0.0);
    let long_return =
        parse_optional_metric(observation.feature.long_return_bps.as_deref()).unwrap_or(0.0);
    let realized_volatility =
        parse_optional_metric(observation.feature.realized_volatility_bps.as_deref())
            .unwrap_or(0.0);

    match strategy_spec.strategy_key.as_str() {
        "dca" | "twap" => 1.0,
        "threshold_rebalance" => {
            if long_return.abs() >= calibration.confirmation_threshold_bps {
                long_return.signum()
            } else {
                0.5
            }
        }
        "trend_following" => {
            if short_return.abs() < calibration.primary_threshold_bps {
                0.0
            } else {
                short_return.signum()
            }
        }
        "mean_reversion" => {
            if short_return.abs() < calibration.primary_threshold_bps {
                0.0
            } else {
                -short_return.signum()
            }
        }
        "breakout" => {
            if short_return.abs() < calibration.primary_threshold_bps
                || long_return.abs() < calibration.confirmation_threshold_bps
                || short_return.signum() != long_return.signum()
            {
                0.0
            } else {
                short_return.signum()
            }
        }
        "macro_rotation" => {
            if long_return.abs() < calibration.confirmation_threshold_bps {
                0.0
            } else {
                long_return.signum()
            }
        }
        "volatility_target" => {
            let base_exposure = if realized_volatility <= calibration.low_vol_threshold_bps {
                0.75
            } else if realized_volatility <= calibration.high_vol_threshold_bps {
                0.5
            } else {
                0.25
            };
            if short_return < -calibration.primary_threshold_bps {
                0.0
            } else {
                base_exposure
            }
        }
        _ => 0.0,
    }
}

fn modeled_cost_bps(
    cost_model: Option<&RuntimeExecutionCostModelRecord>,
    turnover: f64,
    observation: &Observation,
) -> Result<f64, BacktestingEngineError> {
    let Some(model) = cost_model else {
        return Ok(0.0);
    };
    let elapsed_ms = (observation.next_observed_at_ts - observation.observed_at_ts)
        .whole_milliseconds()
        .max(0) as f64;
    let financing_per_day = model
        .assumptions
        .financing_cost_bps_per_day
        .as_deref()
        .map(|value| parse_number("financingCostBpsPerDay", value))
        .transpose()?
        .unwrap_or(0.0);
    let variable_cost = model.assumptions.fee_bps as f64
        + model.assumptions.slippage_bps as f64
        + model.assumptions.market_impact_bps as f64
        + ((model.assumptions.partial_fill_rate_bps as f64 / 10_000.0)
            * model.assumptions.partial_fill_penalty_bps as f64);
    let financing_cost = financing_per_day * (elapsed_ms / 86_400_000.0);
    Ok((variable_cost * turnover) + financing_cost)
}

fn baseline_return_bps(baseline: &RuntimeBacktestBaseline, next_return_bps: f64) -> f64 {
    match baseline {
        RuntimeBacktestBaseline::FlatCash => 0.0,
        RuntimeBacktestBaseline::BuyAndHold => next_return_bps,
    }
}

fn validate_config(config: &RuntimeBacktestConfig) -> Result<(), BacktestingEngineError> {
    if config.training_window_observations == 0
        || config.testing_window_observations == 0
        || config.step_observations == 0
    {
        return Err(BacktestingEngineError::InvalidConfig {
            reason: "training, testing, and step observation counts must be positive".to_string(),
        });
    }
    if config.baseline_strategies.is_empty() {
        return Err(BacktestingEngineError::InvalidConfig {
            reason: "at least one baseline strategy is required".to_string(),
        });
    }
    Ok(())
}

fn load_replay_fixture(
    replay_corpus: &RuntimeReplayCorpusRecord,
) -> Result<FeedReplayFixture, BacktestingEngineError> {
    let fixture_uri = replay_corpus
        .fixture_uri
        .clone()
        .or_else(|| {
            replay_corpus
                .dataset_snapshots
                .iter()
                .find_map(|snapshot| snapshot.uri.clone())
        })
        .ok_or_else(|| BacktestingEngineError::MissingFixtureUri {
            corpus_id: replay_corpus.corpus_id.clone(),
        })?;
    let path = resolve_fixture_uri(&fixture_uri)?;
    FeedReplayFixture::load_from_path(path).map_err(BacktestingEngineError::from)
}

fn resolve_fixture_uri(uri: &str) -> Result<PathBuf, BacktestingEngineError> {
    let without_fragment = uri.split('#').next().unwrap_or(uri);
    if let Some(relative) = without_fragment.strip_prefix("repo://") {
        return Ok(resolve_repo_relative_path(
            relative,
            &candidate_repo_roots(),
        ));
    }
    let candidate = PathBuf::from(without_fragment);
    if candidate.is_absolute() {
        return Ok(candidate);
    }
    Err(BacktestingEngineError::UnsupportedFixtureUri {
        uri: uri.to_string(),
    })
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn candidate_repo_roots() -> Vec<PathBuf> {
    let mut candidates = vec![repo_root()];
    if let Ok(current_dir) = env::current_dir() {
        if !candidates.iter().any(|candidate| candidate == &current_dir) {
            candidates.push(current_dir);
        }
    }
    candidates
}

fn resolve_repo_relative_path(relative: &str, roots: &[PathBuf]) -> PathBuf {
    for root in roots {
        let candidate = root.join(relative);
        if candidate.exists() {
            return candidate;
        }
    }
    roots
        .first()
        .cloned()
        .unwrap_or_else(PathBuf::new)
        .join(relative)
}

fn default_feature_cache_config() -> FeatureCacheConfig {
    FeatureCacheConfig::new(
        FEATURE_STALE_AFTER_MS,
        SLOT_STALE_AFTER_MS,
        MAX_SLOT_GAP,
        SHORT_WINDOW_MS,
        LONG_WINDOW_MS,
        VOLATILITY_WINDOW_SIZE,
        MAX_SAMPLES_PER_STREAM,
    )
}

fn build_report(
    input: &BacktestRunRequest,
) -> Result<RuntimeBacktestReport, BacktestingEngineError> {
    validate_config(&input.config)?;
    let fixture = load_replay_fixture(&input.replay_corpus)?;
    let observations = build_observations(&fixture, &input.regime_tags)?;
    let required_observations = input.config.training_window_observations as usize
        + input.config.purge_observations as usize
        + input.config.testing_window_observations as usize;
    if observations.len() < required_observations + 1 {
        return Err(BacktestingEngineError::InsufficientObservations {
            required: required_observations + 1,
            available: observations.len(),
        });
    }

    let strategy_digest = strategy_spec_digest(&input.strategy_spec)?;
    let generated_at = now_rfc3339();
    let report_id = match input.report_id.clone() {
        Some(report_id) => report_id,
        None => default_report_id(
            &input.experiment.experiment_id,
            &strategy_digest,
            &input.config,
        )?,
    };
    let missing_feature_keys =
        missing_required_feature_keys(&input.strategy_spec, &input.feature_definitions);
    let missing_regime_keys =
        missing_required_regime_keys(&input.strategy_spec, &input.regime_tags);
    let evaluations = evaluate_walk_forward_folds(
        &observations,
        &input.strategy_spec,
        input.cost_model.as_ref(),
        &input.config,
    )?;
    let mut blocking_reasons = Vec::new();
    if !missing_feature_keys.is_empty() {
        blocking_reasons.push(format!(
            "missing required feature definitions: {}",
            missing_feature_keys.join(", ")
        ));
    }
    if !missing_regime_keys.is_empty() {
        blocking_reasons.push(format!(
            "missing required regime tags: {}",
            missing_regime_keys.join(", ")
        ));
    }
    if evaluations.len() < 2 {
        blocking_reasons.push("walk-forward evaluation requires at least two folds".to_string());
    }

    let fold_reports = evaluations
        .iter()
        .map(|evaluation| evaluation.fold_report.clone())
        .collect::<Vec<_>>();
    let aggregate = aggregate_evaluations(
        &evaluations,
        &input.config.baseline_strategies,
        &input.strategy_spec,
        &mut blocking_reasons,
    );
    let promotion_eligible = blocking_reasons.is_empty();
    let status = if promotion_eligible {
        RuntimeBacktestStatus::Completed
    } else {
        RuntimeBacktestStatus::Blocked
    };
    let summary = if promotion_eligible {
        format!(
            "Backtest cleared {} walk-forward folds for {} with net return {} bps.",
            fold_reports.len(),
            input.strategy_spec.strategy_key,
            aggregate.metrics.net_return_bps
        )
    } else {
        format!(
            "Backtest blocked for {}: {}.",
            input.strategy_spec.strategy_key,
            blocking_reasons.join("; ")
        )
    };
    let mut tags = input.experiment.tags.clone();
    if !tags.iter().any(|tag| tag == "backtest") {
        tags.push("backtest".to_string());
    }
    Ok(RuntimeBacktestReport {
        schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
        report_id,
        experiment_id: input.experiment.experiment_id.clone(),
        strategy_key: input.strategy_spec.strategy_key.clone(),
        status,
        generated_at,
        venue_keys: input.experiment.venue_keys.clone(),
        asset_keys: input.experiment.asset_keys.clone(),
        code_revision: input.experiment.code_revision.clone(),
        dataset_snapshots: input.experiment.dataset_snapshots.clone(),
        strategy_spec_digest: strategy_digest,
        config: input.config.clone(),
        fold_reports,
        aggregate_metrics: aggregate.metrics,
        aggregate_baseline_comparisons: aggregate.baselines,
        aggregate_regime_metrics: aggregate.regimes,
        promotion_eligible,
        blocking_reasons,
        summary,
        tags,
    })
}

fn default_report_id(
    experiment_id: &str,
    strategy_digest: &str,
    config: &RuntimeBacktestConfig,
) -> Result<String, BacktestingEngineError> {
    let mut hasher = Sha256::new();
    hasher.update(strategy_digest.as_bytes());
    hasher.update(serde_json::to_vec(config)?);
    let digest = format!("{:x}", hasher.finalize());
    Ok(format!("backtest_{experiment_id}_{}", &digest[..12]))
}

fn strategy_spec_digest(
    strategy_spec: &RuntimeStrategySpec,
) -> Result<String, BacktestingEngineError> {
    let serialized = serde_json::to_vec(strategy_spec)?;
    let digest = Sha256::digest(serialized);
    Ok(format!("sha256:{digest:x}"))
}

fn percentile(mut values: Vec<f64>, percentile: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let max_index = values.len().saturating_sub(1);
    let index = ((max_index as f64) * percentile.clamp(0.0, 1.0)).round() as usize;
    values.get(index).copied()
}

fn parse_optional_metric(value: Option<&str>) -> Option<f64> {
    value.and_then(|value| value.parse::<f64>().ok())
}

fn parse_number(field: &'static str, value: &str) -> Result<f64, BacktestingEngineError> {
    value
        .parse::<f64>()
        .map_err(|_| BacktestingEngineError::InvalidNumber {
            field,
            value: value.to_string(),
        })
}

fn parse_timestamp(
    field: &'static str,
    value: &str,
) -> Result<OffsetDateTime, BacktestingEngineError> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| BacktestingEngineError::InvalidTimestamp {
        field,
        value: value.to_string(),
    })
}

fn rate_bps(numerator: u32, denominator: u32) -> u16 {
    if denominator == 0 {
        0
    } else {
        (((numerator as f64 / denominator as f64) * 10_000.0).round() as u16).min(10_000)
    }
}

fn format_bps(value: f64) -> String {
    format!("{value:.4}")
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("timestamp to format")
}

fn persist_report(
    connection: &Connection,
    report: &RuntimeBacktestReport,
) -> Result<(), BacktestingEngineError> {
    connection.execute(
        "INSERT INTO backtest_reports (
            report_id,
            experiment_id,
            strategy_key,
            generated_at,
            status,
            promotion_eligible,
            record_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(report_id) DO UPDATE SET
            experiment_id = excluded.experiment_id,
            strategy_key = excluded.strategy_key,
            generated_at = excluded.generated_at,
            status = excluded.status,
            promotion_eligible = excluded.promotion_eligible,
            record_json = excluded.record_json",
        params![
            report.report_id,
            report.experiment_id,
            report.strategy_key,
            report.generated_at,
            backtest_status_key(&report.status),
            if report.promotion_eligible { 1 } else { 0 },
            serialize_json(report)?,
        ],
    )?;
    Ok(())
}

fn list_reports(
    connection: &Connection,
    query: &BacktestingQuery,
) -> Result<Vec<RuntimeBacktestReport>, BacktestingEngineError> {
    let mut statement = connection.prepare(
        "SELECT record_json
         FROM backtest_reports
         WHERE (?1 IS NULL OR report_id = ?1)
           AND (?2 IS NULL OR experiment_id = ?2)
           AND (?3 IS NULL OR strategy_key = ?3)
           AND (?4 IS NULL OR promotion_eligible = ?4)
         ORDER BY generated_at DESC, report_id DESC",
    )?;
    let promotion_eligible = query.promotion_eligible.map(i64::from);
    let rows = statement.query_map(
        params![
            query.report_id.as_deref(),
            query.experiment_id.as_deref(),
            query.strategy_key.as_deref(),
            promotion_eligible,
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut reports = Vec::new();
    for row in rows {
        reports.push(deserialize_json(&row?)?);
    }
    Ok(reports)
}

fn load_report(
    connection: &Connection,
    report_id: &str,
) -> Result<Option<RuntimeBacktestReport>, BacktestingEngineError> {
    connection
        .query_row(
            "SELECT record_json FROM backtest_reports WHERE report_id = ?1",
            params![report_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|value| deserialize_json(&value))
        .transpose()
}

fn initialize_schema(connection: &Connection) -> Result<(), BacktestingEngineError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS backtest_reports (
            report_id TEXT PRIMARY KEY,
            experiment_id TEXT NOT NULL,
            strategy_key TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            status TEXT NOT NULL,
            promotion_eligible INTEGER NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_backtest_reports_experiment
            ON backtest_reports (experiment_id, generated_at DESC, report_id DESC);
        CREATE INDEX IF NOT EXISTS idx_backtest_reports_strategy
            ON backtest_reports (strategy_key, generated_at DESC, report_id DESC);
        CREATE INDEX IF NOT EXISTS idx_backtest_reports_promotion
            ON backtest_reports (promotion_eligible, generated_at DESC, report_id DESC);",
    )?;
    Ok(())
}

fn backtest_status_key(status: &RuntimeBacktestStatus) -> &'static str {
    match status {
        RuntimeBacktestStatus::Completed => "completed",
        RuntimeBacktestStatus::Blocked => "blocked",
        RuntimeBacktestStatus::Failed => "failed",
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
    std::env::temp_dir().join("runtime-rs/backtesting-engine.sqlite3")
}

fn should_fallback_to_tmp(path: &Path, error: &BacktestingEngineError) -> bool {
    !path.starts_with(std::env::temp_dir()) && matches!(error, BacktestingEngineError::Io(_))
}

fn serialize_json<T>(value: &T) -> Result<String, BacktestingEngineError>
where
    T: Serialize,
{
    Ok(serde_json::to_string(value)?)
}

fn deserialize_json<T>(value: &str) -> Result<T, BacktestingEngineError>
where
    T: for<'de> Deserialize<'de>,
{
    Ok(serde_json::from_str(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{
        RuntimeBacktestBaseline, RuntimeBacktestWindowMode, RuntimeCodeRevisionRef,
        RuntimeDatasetSnapshotRef, RuntimeResearchCitation, RuntimeResearchExperimentStatus,
    };

    fn engine(name: &str) -> BacktestingEngine {
        let database_url = format!(".tmp/tests/backtesting-engine/{name}.sqlite3");
        let path = PathBuf::from(&database_url);
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
        BacktestingEngine::new(BacktestingEngineConfig::new(database_url)).expect("engine")
    }

    fn fixture_uri() -> String {
        "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json"
            .to_string()
    }

    #[test]
    fn resolves_repo_fixtures_from_working_directory_when_manifest_root_is_missing() {
        let root = std::env::temp_dir().join(format!(
            "backtesting-engine-resolve-{}",
            OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        let fixture =
            root.join("services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json");
        fs::create_dir_all(fixture.parent().expect("fixture parent directory to exist"))
            .expect("fixture directory");
        fs::write(&fixture, "{}").expect("fixture file");

        let resolved = resolve_repo_relative_path(
            "services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json",
            &[root.join("missing-root"), root.clone()],
        );

        assert_eq!(resolved, fixture);

        fs::remove_dir_all(root).expect("cleanup temp fixture directory");
    }

    fn experiment() -> RuntimeResearchExperimentRecord {
        RuntimeResearchExperimentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            experiment_id: "experiment_signal_trend_shadow".to_string(),
            hypothesis_id: "hypothesis_signal_trend".to_string(),
            strategy_key: "trend_following".to_string(),
            status: RuntimeResearchExperimentStatus::Completed,
            created_at: "2026-03-10T14:00:00.000Z".to_string(),
            updated_at: "2026-03-10T14:30:00.000Z".to_string(),
            completed_at: Some("2026-03-10T14:30:00.000Z".to_string()),
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            source_citations: vec![RuntimeResearchCitation {
                source_id: "source_paper_microstructure".to_string(),
                locator: None,
                material_digest: None,
                notes: None,
            }],
            code_revision: RuntimeCodeRevisionRef {
                vcs: "git".to_string(),
                repository: "github.com/GuiBibeau/serious-trader-ralph".to_string(),
                revision: "356b539e3ec730663c4025b8f00cd6b47b823d1a".to_string(),
                compared_to: None,
                tree_dirty: false,
            },
            dataset_snapshots: vec![RuntimeDatasetSnapshotRef {
                dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
                snapshot_id: "snapshot_2026_03_07_backtest".to_string(),
                captured_at: "2026-03-10T14:00:00.000Z".to_string(),
                uri: Some(format!("{}#marketEvents", fixture_uri())),
                content_digest: Some("sha256:fixture".to_string()),
            }],
            artifacts: Vec::new(),
            summary: "Backtest experiment fixture".to_string(),
            tags: vec!["backtest".to_string()],
        }
    }

    fn replay_corpus() -> RuntimeReplayCorpusRecord {
        RuntimeReplayCorpusRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            corpus_id: "replay_corpus_sol_usdc_feature_cache".to_string(),
            title: "feature cache replay".to_string(),
            summary: "Replay corpus for backtesting engine tests.".to_string(),
            replay_kind: protocol::RuntimeReplayCorpusKind::FeedGatewayV1,
            created_at: "2026-03-10T14:00:00.000Z".to_string(),
            updated_at: "2026-03-10T14:00:00.000Z".to_string(),
            venue_keys: vec!["jupiter".to_string(), "helius".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            pair_symbols: vec!["SOL/USDC".to_string()],
            chain_keys: vec!["solana-mainnet".to_string()],
            dataset_snapshots: vec![RuntimeDatasetSnapshotRef {
                dataset_id: "dataset_feed_replay_sol_usdc_market_events".to_string(),
                snapshot_id: "snapshot_2026_03_07_backtest".to_string(),
                captured_at: "2026-03-10T14:00:00.000Z".to_string(),
                uri: Some(format!("{}#marketEvents", fixture_uri())),
                content_digest: Some("sha256:fixture".to_string()),
            }],
            fixture_uri: Some(fixture_uri()),
            content_digest: Some("sha256:fixture".to_string()),
            deterministic_seed: Some(100),
            tags: vec!["test".to_string()],
            notes: None,
        }
    }

    fn trend_strategy_spec() -> RuntimeStrategySpec {
        strategy_core::StrategyKind::TrendFollowing.spec()
    }

    fn allocation_strategy_spec() -> RuntimeStrategySpec {
        strategy_core::StrategyKind::Dca.spec()
    }

    fn feature_definitions() -> Vec<RuntimeFeatureDefinitionRecord> {
        vec![RuntimeFeatureDefinitionRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            feature_id: "feature_short_return_bps_v1".to_string(),
            feature_key: "short_return_bps".to_string(),
            version: "1.0.0".to_string(),
            title: "Short return".to_string(),
            summary: "Seed feature".to_string(),
            status: protocol::RuntimeFeatureCatalogStatus::Active,
            market_type: protocol::RuntimeVenueMarketType::Spot,
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            pair_symbols: vec!["SOL/USDC".to_string()],
            input_requirements: vec![protocol::RuntimeFeatureInputRequirement {
                input_key: "mid_price_usd".to_string(),
                required: true,
                freshness_ms: Some(20_000),
                notes: None,
            }],
            derived_from_feature_keys: Vec::new(),
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            min_coverage_bps: 10_000,
            provenance: protocol::RuntimeCatalogProvenance {
                generated_by: "tests".to_string(),
                generated_revision: Some("seed".to_string()),
                generated_at: "2026-03-10T14:00:00.000Z".to_string(),
                notes: None,
            },
            dataset_snapshots: experiment().dataset_snapshots.clone(),
            created_at: "2026-03-10T14:00:00.000Z".to_string(),
            updated_at: "2026-03-10T14:00:00.000Z".to_string(),
            tags: vec!["test".to_string()],
            notes: None,
        }]
    }

    fn regime_tags() -> Vec<RuntimeRegimeTagRecord> {
        vec![RuntimeRegimeTagRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            regime_tag_id: "regime_short_trend_v1".to_string(),
            regime_key: "short_trend".to_string(),
            version: "1.0.0".to_string(),
            title: "Short trend".to_string(),
            summary: "Seed regime".to_string(),
            status: protocol::RuntimeFeatureCatalogStatus::Active,
            dimension: protocol::RuntimeRegimeDimension::Trend,
            value: "classified".to_string(),
            market_type: protocol::RuntimeVenueMarketType::Spot,
            venue_keys: vec!["jupiter".to_string()],
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            pair_symbols: vec!["SOL/USDC".to_string()],
            source_feature_keys: vec!["short_return_bps".to_string()],
            freshness_slo_ms: 20_000,
            max_allowed_drift_bps: 50,
            min_confidence_bps: 8_000,
            provenance: protocol::RuntimeCatalogProvenance {
                generated_by: "tests".to_string(),
                generated_revision: Some("seed".to_string()),
                generated_at: "2026-03-10T14:00:00.000Z".to_string(),
                notes: None,
            },
            dataset_snapshots: experiment().dataset_snapshots.clone(),
            created_at: "2026-03-10T14:00:00.000Z".to_string(),
            updated_at: "2026-03-10T14:00:00.000Z".to_string(),
            tags: vec!["test".to_string()],
            notes: None,
        }]
    }

    fn cost_model() -> RuntimeExecutionCostModelRecord {
        RuntimeExecutionCostModelRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            model_id: "cost_model_jupiter_sol_usdc_spot".to_string(),
            venue_key: "jupiter".to_string(),
            market_type: protocol::RuntimeVenueMarketType::Spot,
            pair_symbol: "SOL/USDC".to_string(),
            instrument_id: Some("SOL/USDC".to_string()),
            asset_keys: vec!["SOL".to_string(), "USDC".to_string()],
            mode_coverage: vec![protocol::RuntimeMode::Shadow, protocol::RuntimeMode::Paper],
            status: protocol::RuntimeExecutionCostModelStatus::Active,
            assumptions: protocol::RuntimeExecutionCostAssumptions {
                fee_bps: 1,
                slippage_bps: 1,
                market_impact_bps: 1,
                partial_fill_rate_bps: 0,
                partial_fill_penalty_bps: 0,
                financing_cost_bps_per_day: None,
            },
            latency_profile: protocol::RuntimeVenueLatencyProfile {
                expected_quote_ms: 100,
                expected_submit_ms: 200,
                expected_settlement_ms: 1000,
            },
            dataset_snapshots: experiment().dataset_snapshots.clone(),
            calibration: protocol::RuntimeExecutionCostCalibration {
                calibration_id: "calibration_jupiter_sol_usdc_spot".to_string(),
                methodology: "seeded-regression".to_string(),
                sample_start_at: "2026-03-01T00:00:00.000Z".to_string(),
                sample_end_at: "2026-03-10T14:00:00.000Z".to_string(),
                sample_count: 120,
                confidence_bps: 9_000,
                reference_notional_usd: "1000.00".to_string(),
                tags: vec!["test".to_string()],
                notes: None,
            },
            drift_guard: protocol::RuntimeExecutionCostDriftGuard {
                max_cost_drift_bps: 25,
                max_latency_drift_ms: 400,
                max_reconciliation_drift_usd: "1.00".to_string(),
            },
            created_at: "2026-03-10T14:00:00.000Z".to_string(),
            updated_at: "2026-03-10T14:00:00.000Z".to_string(),
            tags: vec!["test".to_string()],
            notes: None,
        }
    }

    #[test]
    fn runs_and_persists_backtest_reports() {
        let engine = engine("run");
        let result = engine
            .run(&BacktestRunRequest {
                report_id: Some("backtest_signal_trend".to_string()),
                experiment: experiment(),
                strategy_spec: allocation_strategy_spec(),
                cost_model: Some(cost_model()),
                feature_definitions: feature_definitions(),
                regime_tags: regime_tags(),
                replay_corpus: replay_corpus(),
                config: RuntimeBacktestConfig {
                    replay_corpus_id: "replay_corpus_sol_usdc_feature_cache".to_string(),
                    venue_key: "jupiter".to_string(),
                    pair_symbol: "SOL/USDC".to_string(),
                    market_type: protocol::RuntimeVenueMarketType::Spot,
                    window_mode: RuntimeBacktestWindowMode::Rolling,
                    training_window_observations: 2,
                    testing_window_observations: 1,
                    step_observations: 1,
                    purge_observations: 0,
                    baseline_strategies: vec![
                        RuntimeBacktestBaseline::FlatCash,
                        RuntimeBacktestBaseline::BuyAndHold,
                    ],
                },
            })
            .expect("backtest to run");

        assert!(result.created);
        assert_eq!(result.report.fold_reports.len(), 3);
        assert_eq!(
            result.report.config.window_mode,
            RuntimeBacktestWindowMode::Rolling
        );
        assert_eq!(result.report.aggregate_metrics.observation_count, 3);
        assert!(!result.report.aggregate_regime_metrics.is_empty());
        assert_eq!(result.report.status, RuntimeBacktestStatus::Completed);
        assert!(result.report.promotion_eligible);

        let reports = engine
            .query(&BacktestingQuery {
                experiment_id: Some("experiment_signal_trend_shadow".to_string()),
                ..BacktestingQuery::default()
            })
            .expect("query");
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].report_id, "backtest_signal_trend");
    }

    #[test]
    fn blocks_reports_when_required_feature_coverage_is_missing() {
        let engine = engine("blocked");
        let result = engine
            .run(&BacktestRunRequest {
                report_id: Some("backtest_signal_trend_blocked".to_string()),
                experiment: experiment(),
                strategy_spec: trend_strategy_spec(),
                cost_model: Some(cost_model()),
                feature_definitions: Vec::new(),
                regime_tags: regime_tags(),
                replay_corpus: replay_corpus(),
                config: RuntimeBacktestConfig {
                    replay_corpus_id: "replay_corpus_sol_usdc_feature_cache".to_string(),
                    venue_key: "jupiter".to_string(),
                    pair_symbol: "SOL/USDC".to_string(),
                    market_type: protocol::RuntimeVenueMarketType::Spot,
                    window_mode: RuntimeBacktestWindowMode::Expanding,
                    training_window_observations: 2,
                    testing_window_observations: 1,
                    step_observations: 1,
                    purge_observations: 0,
                    baseline_strategies: vec![RuntimeBacktestBaseline::FlatCash],
                },
            })
            .expect("backtest to run");

        assert_eq!(result.report.status, RuntimeBacktestStatus::Blocked);
        assert!(!result.report.promotion_eligible);
        assert!(result
            .report
            .blocking_reasons
            .iter()
            .any(|reason| reason.contains("missing required feature definitions")));
    }

    #[test]
    fn generated_report_ids_include_full_backtest_config() {
        let strategy_digest = strategy_spec_digest(&allocation_strategy_spec()).expect("digest");
        let base = RuntimeBacktestConfig {
            replay_corpus_id: "replay_corpus_sol_usdc_feature_cache".to_string(),
            venue_key: "jupiter".to_string(),
            pair_symbol: "SOL/USDC".to_string(),
            market_type: protocol::RuntimeVenueMarketType::Spot,
            window_mode: RuntimeBacktestWindowMode::Rolling,
            training_window_observations: 2,
            testing_window_observations: 1,
            step_observations: 1,
            purge_observations: 0,
            baseline_strategies: vec![
                RuntimeBacktestBaseline::FlatCash,
                RuntimeBacktestBaseline::BuyAndHold,
            ],
        };
        let market_variant = RuntimeBacktestConfig {
            market_type: protocol::RuntimeVenueMarketType::Perp,
            ..base.clone()
        };
        let window_variant = RuntimeBacktestConfig {
            window_mode: RuntimeBacktestWindowMode::Expanding,
            ..base.clone()
        };
        let baseline_variant = RuntimeBacktestConfig {
            baseline_strategies: vec![RuntimeBacktestBaseline::FlatCash],
            ..base.clone()
        };

        let base_id = default_report_id("experiment_signal_trend_shadow", &strategy_digest, &base)
            .expect("id");
        let market_id = default_report_id(
            "experiment_signal_trend_shadow",
            &strategy_digest,
            &market_variant,
        )
        .expect("market id");
        let window_id = default_report_id(
            "experiment_signal_trend_shadow",
            &strategy_digest,
            &window_variant,
        )
        .expect("window id");
        let baseline_id = default_report_id(
            "experiment_signal_trend_shadow",
            &strategy_digest,
            &baseline_variant,
        )
        .expect("baseline id");

        assert_ne!(base_id, market_id);
        assert_ne!(base_id, window_id);
        assert_ne!(base_id, baseline_id);
    }
}
