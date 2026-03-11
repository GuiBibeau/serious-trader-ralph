mod paper_execution;

use std::sync::{Arc, RwLock};

use asset_registry::{
    AssetRegistry, AssetRegistryConfig, AssetRegistryError, AssetRegistryQuery,
    AssetRegistrySnapshot,
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use backtesting_engine::{
    BacktestRunRequest, BacktestingEngine, BacktestingEngineConfig, BacktestingEngineError,
    BacktestingEngineSnapshot, BacktestingQuery,
};
use cost_model_registry::{
    CostModelRegistry, CostModelRegistryConfig, CostModelRegistryError, CostModelRegistryQuery,
    CostModelRegistrySnapshot, CostObservationQuery,
};
use exec_client::{
    ExecClient, ExecClientConfig, ExecClientError, ExecReceiptObservation, ExecSubmitResponse,
};
use execution_planner::{
    ExecutionPlanner, ExecutionPlannerConfig, ExecutionPlannerError, ExecutionPlannerInput,
    ExecutionPlannerSnapshot, StrategyPluginRegistry,
};
use feature_cache::{FeatureCache, FeatureCacheConfig, FeatureCacheSnapshot};
use feature_catalog_registry::{
    FeatureCatalogRegistry, FeatureCatalogRegistryConfig, FeatureCatalogRegistryError,
    FeatureCatalogRegistryQuery, FeatureCatalogRegistrySnapshot,
};
use historical_data_lake::{
    HistoricalDataLake, HistoricalDataLakeConfig, HistoricalDataLakeError, HistoricalDataLakeQuery,
    HistoricalDataLakeSnapshot,
};
use market_adapters::{FeedGateway, FeedGatewayConfig, FeedGatewaySnapshot, FeedReplayFixture};
use paper_execution::{simulate_paper_execution, PaperExecutionError};
use portfolio_ledger::{
    PortfolioLedger, PortfolioLedgerConfig, PortfolioLedgerError, PortfolioLedgerSnapshot,
};
use protocol::{
    RuntimeAssetListingState, RuntimeAssetRecord, RuntimeBacktestBaseline,
    RuntimeBacktestWindowMode, RuntimeDeploymentRecord, RuntimeDeploymentState,
    RuntimeExecutionCostModelRecord, RuntimeExecutionCostModelStatus,
    RuntimeExecutionCostObservationRecord, RuntimeFeatureCatalogStatus,
    RuntimeFeatureDefinitionRecord, RuntimeHistoricalDatasetKind,
    RuntimeHistoricalDatasetSnapshotRecord, RuntimeMode, RuntimeRegimeTagRecord,
    RuntimeReplayCorpusRecord, RuntimeResearchEvidenceBundleRecord,
    RuntimeResearchExperimentRecord, RuntimeResearchHypothesisRecord, RuntimeResearchSourceRecord,
    RuntimeRunRecord, RuntimeVenueMarketType,
};
use reconciler::{Reconciler, ReconcilerConfig, ReconcilerError, ReconcilerSnapshot};
use research_registry::{
    ResearchRegistry, ResearchRegistryConfig, ResearchRegistryError, ResearchRegistryQuery,
    ResearchRegistrySnapshot,
};
use risk_engine::{
    should_pause_runtime, RiskAssessmentInput, RiskEngine, RiskEngineConfig, RiskEngineError,
    RiskEngineSnapshot,
};
use runtime_allocator::{
    RuntimeAllocator, RuntimeAllocatorConfig, RuntimeAllocatorError, RuntimeAllocatorSnapshot,
};
use runtime_ops::{health_snapshot, RuntimeConfig};
use runtime_scorecards::{
    build_cost_observation, build_readiness_report, RuntimeCostObservationInput,
    RuntimeScorecardConfig, RuntimeScorecardError, RuntimeScorecardInput,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use strategy_core::StrategyCatalog;
use strategy_registry::{
    ShadowEvaluationTrigger, StrategyRegistry, StrategyRegistryConfig, StrategyRegistryError,
    StrategyRegistrySnapshot,
};
use time::OffsetDateTime;
use tokio::time::{sleep, Duration};

const INTERNAL_RUNTIME_PREFIX: &str = "/api/internal/runtime";
const RUNTIME_KILL_SWITCH_TAG: &str = "runtime:kill-switch";

type JsonPayload = (StatusCode, Json<Value>);
type HandlerResult = Result<JsonPayload, JsonPayload>;

fn plan_has_actionable_slices(plan: &protocol::RuntimeExecutionPlan) -> bool {
    plan.slices.iter().any(|slice| {
        slice
            .input_amount_atomic
            .trim()
            .parse::<u128>()
            .ok()
            .is_some_and(|value| value > 0)
    })
}

#[derive(Debug, Clone)]
pub struct RuntimeAppState {
    config: RuntimeConfig,
    exec_client: ExecClient,
    feed_bootstrap_source: String,
    feed_bootstrap_error: Option<String>,
    feed_gateway: Arc<RwLock<FeedGateway>>,
    feature_cache: Arc<RwLock<FeatureCache>>,
    strategy_registry: StrategyRegistry,
    research_registry: ResearchRegistry,
    asset_registry: AssetRegistry,
    historical_data_lake: HistoricalDataLake,
    backtesting_engine: BacktestingEngine,
    feature_catalog_registry: FeatureCatalogRegistry,
    cost_model_registry: CostModelRegistry,
    portfolio_ledger: PortfolioLedger,
    runtime_allocator: RuntimeAllocator,
    risk_engine: RiskEngine,
    execution_planner: ExecutionPlanner,
    reconciler: Reconciler,
}

impl RuntimeAppState {
    #[must_use]
    pub fn new(config: RuntimeConfig) -> Self {
        let mut feed_gateway = FeedGateway::new(feed_gateway_config(&config));
        let mut feature_cache = FeatureCache::new(feature_cache_config(&config));
        let (feed_bootstrap_source, feed_bootstrap_error) =
            bootstrap_runtime_state(&mut feed_gateway, &mut feature_cache, &config);
        let feed_gateway = Arc::new(RwLock::new(feed_gateway));
        let feature_cache = Arc::new(RwLock::new(feature_cache));
        if should_spawn_fixture_keepalive(&config) {
            spawn_fixture_keepalive(feed_gateway.clone(), feature_cache.clone());
        }
        let strategy_plugins =
            StrategyPluginRegistry::builtin().expect("strategy plugin registry to initialize");
        let strategy_catalog: StrategyCatalog = strategy_plugins.catalog();
        let strategy_registry = StrategyRegistry::with_catalog(
            StrategyRegistryConfig::new(config.database_url.clone()),
            strategy_catalog,
        )
        .expect("strategy registry to initialize");
        let research_registry =
            ResearchRegistry::new(ResearchRegistryConfig::new(config.database_url.clone()))
                .expect("research registry to initialize");
        let asset_registry =
            AssetRegistry::new(AssetRegistryConfig::new(config.database_url.clone()))
                .expect("asset registry to initialize");
        let historical_data_lake =
            HistoricalDataLake::new(HistoricalDataLakeConfig::new(config.database_url.clone()))
                .expect("historical data lake to initialize");
        let backtesting_engine =
            BacktestingEngine::new(BacktestingEngineConfig::new(config.database_url.clone()))
                .expect("backtesting engine to initialize");
        let feature_catalog_registry = FeatureCatalogRegistry::new(
            FeatureCatalogRegistryConfig::new(config.database_url.clone()),
        )
        .expect("feature catalog registry to initialize");
        let cost_model_registry =
            CostModelRegistry::new(CostModelRegistryConfig::new(config.database_url.clone()))
                .expect("cost model registry to initialize");
        let portfolio_ledger =
            PortfolioLedger::new(PortfolioLedgerConfig::new(config.database_url.clone()))
                .expect("portfolio ledger to initialize");
        let runtime_allocator =
            RuntimeAllocator::new(RuntimeAllocatorConfig::new(config.database_url.clone()))
                .expect("runtime allocator to initialize");
        let risk_engine = RiskEngine::new(RiskEngineConfig::new(
            config.database_url.clone(),
            config.feature_stale_after_ms,
        ))
        .expect("risk engine to initialize");
        let execution_planner = ExecutionPlanner::with_plugins(
            ExecutionPlannerConfig::new(config.database_url.clone()),
            strategy_plugins,
        )
        .expect("execution planner to initialize");
        let reconciler = Reconciler::new(ReconcilerConfig::new(config.database_url.clone()))
            .expect("reconciler to initialize");
        let exec_client = ExecClient::new(ExecClientConfig {
            api_base: config.worker_api_base.clone(),
            submit_path: config.worker_execution_plan_path.clone(),
            health_path: config.worker_health_path.clone(),
            service_auth_token: config.internal_service_token.clone(),
        });
        Self {
            config,
            exec_client,
            feed_bootstrap_source,
            feed_bootstrap_error,
            feed_gateway,
            feature_cache,
            strategy_registry,
            research_registry,
            asset_registry,
            historical_data_lake,
            backtesting_engine,
            feature_catalog_registry,
            cost_model_registry,
            portfolio_ledger,
            runtime_allocator,
            risk_engine,
            execution_planner,
            reconciler,
        }
    }

    fn feed_gateway_snapshot(&self) -> FeedGatewaySnapshot {
        self.feed_gateway
            .read()
            .expect("feed gateway read lock")
            .snapshot_now()
    }

    fn feature_cache_snapshot(&self) -> FeatureCacheSnapshot {
        self.feature_cache
            .read()
            .expect("feature cache read lock")
            .snapshot_now()
    }

    fn strategy_registry_snapshot(&self) -> StrategyRegistrySnapshot {
        self.strategy_registry.snapshot_now()
    }

    fn research_registry_snapshot(&self) -> ResearchRegistrySnapshot {
        self.research_registry.snapshot_now()
    }

    fn asset_registry_snapshot(&self) -> AssetRegistrySnapshot {
        self.asset_registry.snapshot_now()
    }

    fn historical_data_lake_snapshot(&self) -> HistoricalDataLakeSnapshot {
        self.historical_data_lake.snapshot_now()
    }

    fn backtesting_engine_snapshot(&self) -> BacktestingEngineSnapshot {
        self.backtesting_engine.snapshot_now()
    }

    fn feature_catalog_registry_snapshot(&self) -> FeatureCatalogRegistrySnapshot {
        self.feature_catalog_registry.snapshot_now()
    }

    fn cost_model_registry_snapshot(&self) -> CostModelRegistrySnapshot {
        self.cost_model_registry.snapshot_now()
    }

    fn portfolio_ledger_snapshot(&self) -> PortfolioLedgerSnapshot {
        self.portfolio_ledger.snapshot_now()
    }

    fn risk_engine_snapshot(&self) -> RiskEngineSnapshot {
        self.risk_engine.snapshot_now()
    }

    fn runtime_allocator_snapshot(&self) -> RuntimeAllocatorSnapshot {
        self.runtime_allocator.snapshot_now()
    }

    fn execution_planner_snapshot(&self) -> ExecutionPlannerSnapshot {
        self.execution_planner.snapshot_now()
    }

    fn reconciler_snapshot(&self) -> ReconcilerSnapshot {
        self.reconciler.snapshot_now()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthResponse {
    pub service_name: String,
    pub status: String,
    pub environment: String,
    pub protocol_version: String,
    pub bind_address: String,
    pub exec_health_url: String,
    pub worker_service_auth_configured: bool,
    pub internal_service_auth_configured: bool,
    pub market_adapter_status: String,
    pub feed_bootstrap_source: String,
    pub feed_bootstrap_error: Option<String>,
    pub feed_gateway: FeedGatewaySnapshot,
    pub feature_cache: FeatureCacheSnapshot,
    pub strategy_registry: StrategyRegistrySnapshot,
    pub research_registry: ResearchRegistrySnapshot,
    pub asset_registry: AssetRegistrySnapshot,
    pub historical_data_lake: HistoricalDataLakeSnapshot,
    pub backtesting_engine: BacktestingEngineSnapshot,
    pub feature_catalog_registry: FeatureCatalogRegistrySnapshot,
    pub cost_model_registry: CostModelRegistrySnapshot,
    pub portfolio_ledger: PortfolioLedgerSnapshot,
    pub allocator: RuntimeAllocatorSnapshot,
    pub risk_engine: RiskEngineSnapshot,
    pub execution_planner: ExecutionPlannerSnapshot,
    pub reconciler: ReconcilerSnapshot,
    pub supported_strategies: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetricsResponse {
    pub service_name: String,
    pub environment: String,
    pub protocol_version: String,
    pub feed_bootstrap_source: String,
    pub feed_bootstrap_error: Option<String>,
    pub feed_gateway: FeedGatewaySnapshot,
    pub feature_cache: FeatureCacheSnapshot,
    pub strategy_registry: StrategyRegistrySnapshot,
    pub research_registry: ResearchRegistrySnapshot,
    pub asset_registry: AssetRegistrySnapshot,
    pub historical_data_lake: HistoricalDataLakeSnapshot,
    pub backtesting_engine: BacktestingEngineSnapshot,
    pub feature_catalog_registry: FeatureCatalogRegistrySnapshot,
    pub cost_model_registry: CostModelRegistrySnapshot,
    pub portfolio_ledger: PortfolioLedgerSnapshot,
    pub allocator: RuntimeAllocatorSnapshot,
    pub risk_engine: RiskEngineSnapshot,
    pub execution_planner: ExecutionPlannerSnapshot,
    pub reconciler: ReconcilerSnapshot,
    pub supported_strategies: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeShadowEvaluationRequest {
    pub trigger: Option<ShadowEvaluationTrigger>,
    pub observed_ledger_snapshot: Option<protocol::RuntimeLedgerSnapshot>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeDeploymentQuery {
    pub deployment_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeAllocatorQuery {
    pub deployment_id: Option<String>,
    pub sleeve_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeResearchQueryParams {
    pub strategy_key: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetQueryParams {
    pub asset_key: Option<String>,
    pub venue_key: Option<String>,
    pub listing_state: Option<RuntimeAssetListingState>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeHistoricalDataLakeQueryParams {
    pub dataset_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub corpus_id: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub dataset_kind: Option<RuntimeHistoricalDatasetKind>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBacktestQueryParams {
    pub report_id: Option<String>,
    pub experiment_id: Option<String>,
    pub strategy_key: Option<String>,
    pub promotion_eligible: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBacktestRunRequestPayload {
    pub report_id: Option<String>,
    pub experiment_id: String,
    pub replay_corpus_id: String,
    pub venue_key: String,
    pub pair_symbol: String,
    pub market_type: RuntimeVenueMarketType,
    pub window_mode: RuntimeBacktestWindowMode,
    pub training_window_observations: u32,
    pub testing_window_observations: u32,
    pub step_observations: u32,
    pub purge_observations: u32,
    pub baseline_strategies: Vec<RuntimeBacktestBaseline>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeCostModelQueryParams {
    pub model_id: Option<String>,
    pub venue_key: Option<String>,
    pub asset_key: Option<String>,
    pub pair_symbol: Option<String>,
    pub market_type: Option<RuntimeVenueMarketType>,
    pub mode: Option<RuntimeMode>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeCostObservationQueryParams {
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

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeFeatureCatalogQueryParams {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RuntimeAssetTransitionRequest {
    pub listing_state: RuntimeAssetListingState,
    pub changed_at: Option<String>,
}

pub fn app(config: RuntimeConfig) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/health"),
            get(internal_health_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments"),
            get(list_deployments_handler).post(create_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}"),
            get(get_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/pause"),
            post(pause_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/resume"),
            post(resume_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/kill"),
            post(kill_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/deployments/{{deployment_id}}/evaluate"),
            post(evaluate_deployment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/runs/{{deployment_id}}"),
            get(list_runs_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/execution-plans"),
            get(execution_plans_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/reconciliations"),
            get(reconciliations_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/scorecards"),
            get(scorecards_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/allocator"),
            get(allocator_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/research"),
            get(research_query_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/research/hypotheses"),
            post(create_research_hypothesis_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/research/sources"),
            post(create_research_source_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/research/experiments"),
            post(create_research_experiment_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/research/evidence-bundles"),
            post(create_research_evidence_bundle_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/assets"),
            get(asset_query_handler).post(create_asset_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/datasets"),
            get(historical_data_lake_query_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/backtests"),
            get(backtests_query_handler).post(run_backtest_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/datasets/snapshots"),
            post(create_historical_dataset_snapshot_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/datasets/replay-corpora"),
            post(create_replay_corpus_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/features"),
            get(feature_catalog_query_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/features/definitions"),
            post(create_feature_definition_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/features/regime-tags"),
            post(create_regime_tag_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/cost-models"),
            get(cost_model_query_handler).post(create_cost_model_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/cost-model-observations"),
            get(cost_observation_query_handler).post(create_cost_observation_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/assets/{{asset_key}}/transition"),
            post(transition_asset_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/risk"),
            get(risk_handler),
        )
        .route(
            &format!("{INTERNAL_RUNTIME_PREFIX}/positions"),
            get(positions_handler),
        )
        .route(&format!("{INTERNAL_RUNTIME_PREFIX}/pnl"), get(pnl_handler))
        .with_state(RuntimeAppState::new(config))
}

fn health_response(state: &RuntimeAppState) -> RuntimeHealthResponse {
    let snapshot = health_snapshot(&state.config);
    let feed_gateway = state.feed_gateway_snapshot();
    let feature_cache = state.feature_cache_snapshot();
    let strategy_registry = state.strategy_registry_snapshot();
    let research_registry = state.research_registry_snapshot();
    let asset_registry = state.asset_registry_snapshot();
    let historical_data_lake = state.historical_data_lake_snapshot();
    let backtesting_engine = state.backtesting_engine_snapshot();
    let feature_catalog_registry = state.feature_catalog_registry_snapshot();
    let cost_model_registry = state.cost_model_registry_snapshot();
    let portfolio_ledger = state.portfolio_ledger_snapshot();
    let allocator = state.runtime_allocator_snapshot();
    let risk_engine = state.risk_engine_snapshot();
    let execution_planner = state.execution_planner_snapshot();
    let reconciler = state.reconciler_snapshot();
    let status = if feed_gateway.status == "healthy"
        && feature_cache.status == "healthy"
        && strategy_registry.status == "healthy"
        && research_registry.status == "healthy"
        && asset_registry.status == "healthy"
        && historical_data_lake.status == "healthy"
        && backtesting_engine.status == "healthy"
        && feature_catalog_registry.status == "healthy"
        && cost_model_registry.status == "healthy"
        && portfolio_ledger.status == "healthy"
        && allocator.status == "healthy"
        && risk_engine.status == "healthy"
        && execution_planner.status == "healthy"
        && reconciler.status == "healthy"
    {
        snapshot.status
    } else {
        "degraded".to_string()
    };
    RuntimeHealthResponse {
        service_name: snapshot.service_name,
        status,
        environment: snapshot.environment,
        protocol_version: snapshot.protocol_version,
        bind_address: snapshot.bind_address,
        exec_health_url: state.exec_client.health_url(),
        worker_service_auth_configured: state.exec_client.has_service_auth(),
        internal_service_auth_configured: state.config.internal_service_token.is_some(),
        market_adapter_status: feed_gateway.status.clone(),
        feed_bootstrap_source: state.feed_bootstrap_source.clone(),
        feed_bootstrap_error: state.feed_bootstrap_error.clone(),
        feed_gateway,
        feature_cache,
        strategy_registry,
        research_registry,
        asset_registry,
        historical_data_lake,
        backtesting_engine,
        feature_catalog_registry,
        cost_model_registry,
        portfolio_ledger,
        allocator,
        risk_engine,
        execution_planner,
        reconciler,
        supported_strategies: state.execution_planner.supported_strategy_keys(),
    }
}

fn metrics_response(state: &RuntimeAppState) -> RuntimeMetricsResponse {
    RuntimeMetricsResponse {
        service_name: state.config.service_name.clone(),
        environment: state.config.environment.as_str().to_string(),
        protocol_version: state.config.protocol_version.clone(),
        feed_bootstrap_source: state.feed_bootstrap_source.clone(),
        feed_bootstrap_error: state.feed_bootstrap_error.clone(),
        feed_gateway: state.feed_gateway_snapshot(),
        feature_cache: state.feature_cache_snapshot(),
        strategy_registry: state.strategy_registry_snapshot(),
        research_registry: state.research_registry_snapshot(),
        asset_registry: state.asset_registry_snapshot(),
        historical_data_lake: state.historical_data_lake_snapshot(),
        backtesting_engine: state.backtesting_engine_snapshot(),
        feature_catalog_registry: state.feature_catalog_registry_snapshot(),
        cost_model_registry: state.cost_model_registry_snapshot(),
        portfolio_ledger: state.portfolio_ledger_snapshot(),
        allocator: state.runtime_allocator_snapshot(),
        risk_engine: state.risk_engine_snapshot(),
        execution_planner: state.execution_planner_snapshot(),
        reconciler: state.reconciler_snapshot(),
        supported_strategies: state.execution_planner.supported_strategy_keys(),
    }
}

async fn health_handler(State(state): State<RuntimeAppState>) -> Json<RuntimeHealthResponse> {
    Json(health_response(&state))
}

async fn metrics_handler(State(state): State<RuntimeAppState>) -> Json<RuntimeMetricsResponse> {
    Json(metrics_response(&state))
}

async fn internal_health_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "health": health_response(&state),
        }),
    ))
}

async fn create_deployment_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment: RuntimeDeploymentRecord = parse_json_body(&body, "invalid-runtime-deployment")?;
    state
        .asset_registry
        .ensure_pair_supported(&deployment)
        .map_err(map_asset_registry_error)?;
    let previous = state
        .strategy_registry
        .get_deployment(&deployment.deployment_id)
        .map_err(map_registry_error)?;
    let result = state
        .strategy_registry
        .upsert_deployment(&deployment)
        .map_err(map_registry_error)?;
    let ledger = sync_ledger_with_rollback(&state, previous, &result.deployment)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "deployment": result.deployment,
            "ledger": ledger.snapshot,
        }),
    ))
}

async fn list_deployments_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployments = state
        .strategy_registry
        .list_deployments()
        .map_err(map_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deployments": deployments,
        }),
    ))
}

async fn get_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment = state
        .strategy_registry
        .get_deployment(&deployment_id)
        .map_err(map_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "deployment-not-found",
                json!({ "deploymentId": deployment_id }),
            )
        })?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deployment": deployment,
        }),
    ))
}

async fn pause_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    transition_deployment_handler(
        headers,
        deployment_id,
        state,
        RuntimeDeploymentState::Paused,
    )
    .await
}

async fn resume_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment = state
        .strategy_registry
        .get_deployment(&deployment_id)
        .map_err(map_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "deployment-not-found",
                json!({ "deploymentId": deployment_id }),
            )
        })?;
    let next_state = match deployment.mode {
        protocol::RuntimeMode::Shadow => RuntimeDeploymentState::Shadow,
        protocol::RuntimeMode::Paper => RuntimeDeploymentState::Paper,
        protocol::RuntimeMode::Live => RuntimeDeploymentState::Live,
    };
    transition_deployment(&deployment_id, &state, next_state)
}

async fn kill_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    transition_deployment_handler(
        headers,
        deployment_id,
        state,
        RuntimeDeploymentState::Killed,
    )
    .await
}

async fn transition_deployment_handler(
    headers: HeaderMap,
    deployment_id: String,
    state: RuntimeAppState,
    next_state: RuntimeDeploymentState,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    transition_deployment(&deployment_id, &state, next_state)
}

fn transition_deployment(
    deployment_id: &str,
    state: &RuntimeAppState,
    next_state: RuntimeDeploymentState,
) -> HandlerResult {
    let previous = state
        .strategy_registry
        .get_deployment(deployment_id)
        .map_err(map_registry_error)?;
    let deployment = state
        .strategy_registry
        .transition_deployment(deployment_id, next_state)
        .map_err(map_registry_error)?;
    let ledger = sync_ledger_with_rollback(state, previous, &deployment)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deployment": deployment,
            "ledger": ledger.snapshot,
        }),
    ))
}

async fn evaluate_deployment_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let request = if body.is_empty() {
        RuntimeShadowEvaluationRequest::default()
    } else {
        parse_json_body::<RuntimeShadowEvaluationRequest>(&body, "invalid-runtime-evaluation")?
    };
    let is_runtime_canary = is_worker_runtime_canary_trigger(request.trigger.as_ref());
    let observed_ledger_override = request.observed_ledger_snapshot.clone();
    let deployment = state
        .strategy_registry
        .get_deployment(&deployment_id)
        .map_err(map_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "deployment-not-found",
                json!({ "deploymentId": deployment_id }),
            )
        })?;
    state
        .asset_registry
        .ensure_pair_supported(&deployment)
        .map_err(map_asset_registry_error)?;
    let result = state
        .strategy_registry
        .evaluate_deployment_trigger(
            &deployment_id,
            &state.feature_cache_snapshot(),
            request.trigger,
        )
        .map_err(map_registry_error)?;
    let ledger_snapshot = state
        .portfolio_ledger
        .snapshot_for_deployment(&deployment_id)
        .map_err(map_ledger_error)?;
    let sleeve_snapshot = state
        .portfolio_ledger
        .sleeve_snapshot(&result.deployment.sleeve_id)
        .map_err(map_ledger_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "sleeve-not-found",
                json!({ "sleeveId": result.deployment.sleeve_id }),
            )
        })?;
    let sleeve_deployments = state
        .strategy_registry
        .list_deployments()
        .map_err(map_registry_error)?
        .into_iter()
        .filter(|deployment| deployment.sleeve_id == result.deployment.sleeve_id)
        .collect::<Vec<_>>();
    let allocation = state
        .runtime_allocator
        .allocate_and_store(&runtime_allocator::RuntimeAllocatorInput {
            run_id: result.run.run_id.clone(),
            deployment: result.deployment.clone(),
            sleeve_equity_usd: sleeve_snapshot.equity_usd.clone(),
            sleeve_deployments,
        })
        .map_err(map_allocator_error)?;
    let coordinated_deployment = allocation.effective_deployment.clone();
    let allocator_decision = Some(allocation.decision.clone());
    let assessment = state
        .risk_engine
        .assess_and_store(&RiskAssessmentInput {
            deployment: coordinated_deployment.clone(),
            run: result.run.clone(),
            feature_snapshot: result.feature_snapshot.clone(),
            ledger_snapshot: ledger_snapshot.clone(),
            kill_switch_active: deployment_has_kill_switch(&result.deployment),
        })
        .map_err(map_risk_error)?;
    let run = state
        .strategy_registry
        .apply_risk_verdict(&assessment.verdict)
        .map_err(map_registry_error)?;
    let mut execution_plan = None;
    let mut coordination = None;
    let mut reconciliation = None;
    let mut observed_ledger_snapshot = None;
    let mut coordinated_run = run.clone();

    if assessment.verdict.verdict == protocol::RuntimeRiskDecision::Allow {
        if let Some(plan_id) = coordinated_run.execution_plan_id.as_deref() {
            execution_plan = Some(
                state
                    .execution_planner
                    .get_plan(plan_id)
                    .map_err(map_execution_planner_error)?
                    .ok_or_else(|| {
                        error_json(
                            StatusCode::NOT_FOUND,
                            "execution-plan-not-found",
                            json!({ "planId": plan_id }),
                        )
                    })?,
            );
            reconciliation = state
                .reconciler
                .get_result_by_run_id(&coordinated_run.run_id)
                .map_err(map_reconciler_error)?;
            observed_ledger_snapshot = state
                .reconciler
                .get_wallet_observation_by_run_id(&coordinated_run.run_id)
                .map_err(map_reconciler_error)?
                .map(|record| record.snapshot);
        } else {
            let planning = state
                .execution_planner
                .plan_and_store(&ExecutionPlannerInput {
                    deployment: coordinated_deployment.clone(),
                    run: coordinated_run.clone(),
                    feature_snapshot: result.feature_snapshot.clone(),
                    ledger_snapshot: ledger_snapshot.clone(),
                    risk_verdict: assessment.verdict.clone(),
                })
                .map_err(map_execution_planner_error)?;
            let plan = planning.plan;
            execution_plan = Some(plan.clone());
            if !plan_has_actionable_slices(&plan) {
                coordinated_run = state
                    .strategy_registry
                    .apply_noop_execution_plan(&coordinated_run.run_id, &plan.plan_id)
                    .map_err(map_registry_error)?;
            } else {
                let paper_simulation = if plan.mode == protocol::RuntimeMode::Paper {
                    Some(
                        simulate_paper_execution(&coordinated_deployment, &plan, &ledger_snapshot)
                            .map_err(map_paper_execution_error)?,
                    )
                } else {
                    None
                };
                let submit = if let Some(simulation) = paper_simulation.as_ref() {
                    simulation.submit.clone()
                } else {
                    state
                        .exec_client
                        .submit_plan(&plan)
                        .await
                        .map_err(map_exec_client_error)?
                };
                state
                    .reconciler
                    .record_submit_attempt(
                        &plan,
                        &submit.submit_request_id,
                        submit.accepted,
                        &submit.source,
                    )
                    .map_err(map_reconciler_error)?;
                coordinated_run = state
                    .strategy_registry
                    .apply_execution_plan(
                        &coordinated_run.run_id,
                        &plan.plan_id,
                        &submit.submit_request_id,
                    )
                    .map_err(map_registry_error)?;
                let receipt = if let Some(receipt) = submit.receipt.as_ref() {
                    state
                        .reconciler
                        .record_receipt_observation(
                            &plan,
                            &runtime_receipt_from_exec_response(&plan, &submit, receipt),
                        )
                        .map_err(map_reconciler_error)?
                } else {
                    state
                        .reconciler
                        .record_synthetic_receipt(
                            &plan,
                            &submit.submit_request_id,
                            &submit.source,
                            "accepted",
                            &["execution coordination accepted"],
                        )
                        .map_err(map_reconciler_error)?
                };
                coordinated_run = state
                    .strategy_registry
                    .apply_receipt(&coordinated_run.run_id, &receipt.receipt_id)
                    .map_err(map_registry_error)?;
                let observed_ledger = observed_ledger_override
                    .or_else(|| submit.observed_ledger.clone())
                    .unwrap_or_else(|| ledger_snapshot.clone());
                let reconciliation_expected_ledger =
                    if let Some(simulation) = paper_simulation.as_ref() {
                        simulation.expected_ledger.clone()
                    } else if is_runtime_canary {
                        observed_ledger.clone()
                    } else {
                        ledger_snapshot.clone()
                    };
                state
                    .reconciler
                    .record_wallet_observation(
                        &deployment_id,
                        &coordinated_run.run_id,
                        "runtime-rs",
                        &observed_ledger,
                    )
                    .map_err(map_reconciler_error)?;
                let reconciliation_outcome = state
                    .reconciler
                    .reconcile_and_store(&reconciler::ReconciliationInput {
                        deployment_id: deployment_id.clone(),
                        run_id: coordinated_run.run_id.clone(),
                        plan: plan.clone(),
                        receipt: receipt.clone(),
                        expected_ledger: reconciliation_expected_ledger,
                        observed_ledger: observed_ledger.clone(),
                    })
                    .map_err(map_reconciler_error)?;
                if let Some(cost_model) = state
                    .cost_model_registry
                    .select_for_deployment(&coordinated_deployment)
                    .map_err(map_cost_model_registry_error)?
                {
                    let cost_observation = build_cost_observation(&RuntimeCostObservationInput {
                        deployment: coordinated_deployment.clone(),
                        run: coordinated_run.clone(),
                        plan: plan.clone(),
                        cost_model,
                        receipt_observed_at: receipt.observed_at.clone(),
                        reconciliation: reconciliation_outcome.result.clone(),
                    })
                    .map_err(map_scorecard_error)?;
                    state
                        .cost_model_registry
                        .upsert_observation(&cost_observation)
                        .map_err(map_cost_model_registry_error)?;
                }
                let reconciliation_failure_code = match reconciliation_outcome.result.status {
                    protocol::RuntimeReconciliationStatus::Passed => None,
                    protocol::RuntimeReconciliationStatus::NeedsManualReview => {
                        Some("reconciliation-needs-manual-review")
                    }
                    protocol::RuntimeReconciliationStatus::Failed => Some("reconciliation-failed"),
                };
                let reconciliation_failure_message =
                    reconciliation_outcome.result.notes.last().cloned();
                coordinated_run = state
                    .strategy_registry
                    .apply_reconciliation_result(
                        &coordinated_run.run_id,
                        reconciliation_outcome.result.status.clone(),
                        reconciliation_failure_code,
                        reconciliation_failure_message.as_deref(),
                    )
                    .map_err(map_registry_error)?;
                let should_sync_paper_snapshot = plan.mode == protocol::RuntimeMode::Paper
                    && reconciliation_outcome.result.status
                        != protocol::RuntimeReconciliationStatus::Failed;
                if reconciliation_outcome.should_apply_correction || should_sync_paper_snapshot {
                    state
                        .portfolio_ledger
                        .apply_observed_snapshot(&deployment_id, &observed_ledger)
                        .map_err(map_ledger_error)?;
                }
                reconciliation = Some(reconciliation_outcome.result);
                observed_ledger_snapshot = Some(observed_ledger);
                coordination = Some(submit);
            }
        }
    }
    let (deployment, ledger_snapshot) = if should_pause_runtime(&assessment.verdict) {
        let previous = Some(result.deployment.clone());
        let deployment = state
            .strategy_registry
            .transition_deployment(&deployment_id, RuntimeDeploymentState::Paused)
            .map_err(map_registry_error)?;
        let ledger = sync_ledger_with_rollback(&state, previous, &deployment)?;
        (deployment, ledger.snapshot)
    } else {
        (
            result.deployment,
            state
                .portfolio_ledger
                .snapshot_for_deployment(&deployment_id)
                .map_err(map_ledger_error)?,
        )
    };
    Ok(shadow_evaluation_json(ShadowEvaluationResponse {
        created: result.created,
        deployment,
        run: coordinated_run,
        risk_verdict: assessment.verdict,
        feature_snapshot: result.feature_snapshot,
        ledger_snapshot,
        allocator_decision,
        execution_plan,
        coordination,
        reconciliation,
        observed_ledger_snapshot,
    }))
}

async fn list_runs_handler(
    headers: HeaderMap,
    Path(deployment_id): Path<String>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let runs: Vec<RuntimeRunRecord> = state
        .strategy_registry
        .list_runs(&deployment_id)
        .map_err(map_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "runs": runs,
        }),
    ))
}

async fn risk_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeDeploymentQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment_id = require_deployment_id(query)?;
    let verdicts = state
        .risk_engine
        .list_verdicts(&deployment_id)
        .map_err(map_risk_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "verdicts": verdicts,
        }),
    ))
}

async fn execution_plans_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeDeploymentQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment_id = require_deployment_id(query)?;
    let plans = state
        .execution_planner
        .list_plans(&deployment_id)
        .map_err(map_execution_planner_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "plans": plans,
        }),
    ))
}

async fn reconciliations_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeDeploymentQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment_id = require_deployment_id(query)?;
    let bundle = state
        .reconciler
        .bundle_for_deployment(&deployment_id)
        .map_err(map_reconciler_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "submitAttempts": bundle.submit_attempts,
            "receipts": bundle.receipts,
            "walletObservations": bundle.wallet_observations,
            "results": bundle.results,
            "thresholds": bundle.thresholds,
        }),
    ))
}

async fn scorecards_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeDeploymentQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment_id = require_deployment_id(query)?;
    let deployment = state
        .strategy_registry
        .get_deployment(&deployment_id)
        .map_err(map_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "deployment-not-found",
                json!({ "deploymentId": deployment_id }),
            )
        })?;
    let runs = state
        .strategy_registry
        .list_runs(&deployment_id)
        .map_err(map_registry_error)?;
    let verdicts = state
        .risk_engine
        .list_verdicts(&deployment_id)
        .map_err(map_risk_error)?;
    let plans = state
        .execution_planner
        .list_plans(&deployment_id)
        .map_err(map_execution_planner_error)?;
    let reconciliation_bundle = state
        .reconciler
        .bundle_for_deployment(&deployment_id)
        .map_err(map_reconciler_error)?;
    let allocator_decisions = state
        .runtime_allocator
        .list_decisions_for_deployment(&deployment_id)
        .map_err(map_allocator_error)?;
    let latest_ledger_snapshot = state
        .portfolio_ledger
        .snapshot_for_deployment(&deployment_id)
        .map_err(map_ledger_error)?;
    let strategy_spec = state
        .execution_planner
        .strategy_specs()
        .into_iter()
        .find(|spec| spec.strategy_key == deployment.strategy_key)
        .ok_or_else(|| {
            error_json(
                StatusCode::BAD_REQUEST,
                "unsupported-strategy",
                json!({ "strategyKey": deployment.strategy_key }),
            )
        })?;
    let feature_catalog = state
        .feature_catalog_registry
        .select_for_strategy(&deployment, &strategy_spec)
        .map_err(map_feature_catalog_registry_error)?;
    let cost_model = state
        .cost_model_registry
        .select_for_deployment(&deployment)
        .map_err(map_cost_model_registry_error)?;
    let cost_observations = state
        .cost_model_registry
        .query_observations(&CostObservationQuery {
            deployment_id: Some(deployment_id.clone()),
            ..CostObservationQuery::default()
        })
        .map_err(map_cost_model_registry_error)?;
    let report = build_readiness_report(
        &RuntimeScorecardConfig::default(),
        &RuntimeScorecardInput {
            deployment,
            strategy_spec,
            runs,
            verdicts,
            plans,
            cost_model,
            cost_observations,
            feature_definitions: feature_catalog.feature_definitions,
            regime_tags: feature_catalog.regime_tags,
            allocator_decisions,
            submit_attempt_count: reconciliation_bundle.submit_attempts.len() as u64,
            receipt_count: reconciliation_bundle.receipts.len() as u64,
            reconciliations: reconciliation_bundle.results,
            observed_ledger_snapshots: reconciliation_bundle
                .wallet_observations
                .into_iter()
                .map(|record| record.snapshot)
                .collect(),
            latest_ledger_snapshot: Some(latest_ledger_snapshot),
        },
    )
    .map_err(map_scorecard_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "report": report,
        }),
    ))
}

async fn positions_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeDeploymentQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment_id = require_deployment_id(query)?;
    let snapshot = state
        .portfolio_ledger
        .snapshot_for_deployment(&deployment_id)
        .map_err(map_ledger_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "snapshot": snapshot,
        }),
    ))
}

async fn pnl_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeDeploymentQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let deployment_id = require_deployment_id(query)?;
    let snapshot = state
        .portfolio_ledger
        .snapshot_for_deployment(&deployment_id)
        .map_err(map_ledger_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "deploymentId": deployment_id,
            "asOf": snapshot.as_of,
            "totals": snapshot.totals,
        }),
    ))
}

async fn allocator_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeAllocatorQuery>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;

    if let Some(deployment_id) = query.deployment_id.filter(|value| !value.trim().is_empty()) {
        let deployment = state
            .strategy_registry
            .get_deployment(&deployment_id)
            .map_err(map_registry_error)?
            .ok_or_else(|| {
                error_json(
                    StatusCode::NOT_FOUND,
                    "deployment-not-found",
                    json!({ "deploymentId": deployment_id }),
                )
            })?;
        let decisions = state
            .runtime_allocator
            .list_decisions_for_deployment(&deployment_id)
            .map_err(map_allocator_error)?;
        let sleeve = state
            .portfolio_ledger
            .sleeve_snapshot(&deployment.sleeve_id)
            .map_err(map_ledger_error)?;
        return Ok(OkJson::with_status(
            StatusCode::OK,
            json!({
                "ok": true,
                "source": "runtime-rs",
                "deploymentId": deployment_id,
                "sleeveId": deployment.sleeve_id,
                "currentDecision": decisions.first(),
                "decisions": decisions,
                "sleeve": sleeve,
            }),
        ));
    }

    if let Some(sleeve_id) = query.sleeve_id.filter(|value| !value.trim().is_empty()) {
        let decisions = state
            .runtime_allocator
            .list_decisions_for_sleeve(&sleeve_id)
            .map_err(map_allocator_error)?;
        let sleeve = state
            .portfolio_ledger
            .sleeve_snapshot(&sleeve_id)
            .map_err(map_ledger_error)?;
        return Ok(OkJson::with_status(
            StatusCode::OK,
            json!({
                "ok": true,
                "source": "runtime-rs",
                "sleeveId": sleeve_id,
                "currentDecision": decisions.first(),
                "decisions": decisions,
                "sleeve": sleeve,
            }),
        ));
    }

    Err(error_json(
        StatusCode::BAD_REQUEST,
        "allocator-query-required",
        json!({ "fields": ["deploymentId", "sleeveId"] }),
    ))
}

async fn research_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeResearchQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let result = state
        .research_registry
        .query(&ResearchRegistryQuery {
            strategy_key: query.strategy_key.filter(|value| !value.trim().is_empty()),
            venue_key: query.venue_key.filter(|value| !value.trim().is_empty()),
            asset_key: query.asset_key.filter(|value| !value.trim().is_empty()),
            source_id: query.source_id.filter(|value| !value.trim().is_empty()),
        })
        .map_err(map_research_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "registry": {
                "hypotheses": result.hypotheses,
                "sources": result.sources,
                "experiments": result.experiments,
                "evidenceBundles": result.evidence_bundles,
            },
        }),
    ))
}

async fn create_research_hypothesis_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeResearchHypothesisRecord =
        parse_json_body(&body, "invalid-runtime-research-hypothesis")?;
    let result = state
        .research_registry
        .upsert_hypothesis(&record)
        .map_err(map_research_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "hypothesis": result.record,
        }),
    ))
}

async fn create_research_source_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeResearchSourceRecord =
        parse_json_body(&body, "invalid-runtime-research-source")?;
    let result = state
        .research_registry
        .upsert_source(&record)
        .map_err(map_research_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "sourceRecord": result.record,
        }),
    ))
}

async fn create_research_experiment_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeResearchExperimentRecord =
        parse_json_body(&body, "invalid-runtime-research-experiment")?;
    let result = state
        .research_registry
        .upsert_experiment(&record)
        .map_err(map_research_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "experiment": result.record,
        }),
    ))
}

async fn create_research_evidence_bundle_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeResearchEvidenceBundleRecord =
        parse_json_body(&body, "invalid-runtime-research-evidence-bundle")?;
    enforce_backtest_evidence_gate(&state, &record)?;
    let result = state
        .research_registry
        .upsert_evidence_bundle(&record)
        .map_err(map_research_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "evidenceBundle": result.record,
        }),
    ))
}

async fn backtests_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeBacktestQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let reports = state
        .backtesting_engine
        .query(&BacktestingQuery {
            report_id: query.report_id.filter(|value| !value.trim().is_empty()),
            experiment_id: query.experiment_id.filter(|value| !value.trim().is_empty()),
            strategy_key: query.strategy_key.filter(|value| !value.trim().is_empty()),
            promotion_eligible: query.promotion_eligible,
        })
        .map_err(map_backtesting_engine_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "reports": reports,
        }),
    ))
}

async fn run_backtest_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let request: RuntimeBacktestRunRequestPayload =
        parse_json_body(&body, "invalid-runtime-backtest-run")?;
    let experiment = state
        .research_registry
        .get_experiment(&request.experiment_id)
        .map_err(map_research_registry_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "research-experiment-not-found",
                json!({ "experimentId": request.experiment_id }),
            )
        })?;
    let strategy_spec = state
        .execution_planner
        .strategy_specs()
        .into_iter()
        .find(|spec| spec.strategy_key == experiment.strategy_key)
        .ok_or_else(|| {
            error_json(
                StatusCode::BAD_REQUEST,
                "unsupported-strategy",
                json!({ "strategyKey": experiment.strategy_key }),
            )
        })?;
    let replay_corpus = state
        .historical_data_lake
        .query(&HistoricalDataLakeQuery {
            corpus_id: Some(request.replay_corpus_id.clone()),
            venue_key: Some(request.venue_key.clone()),
            ..HistoricalDataLakeQuery::default()
        })
        .map_err(map_historical_data_lake_error)?
        .replay_corpora
        .into_iter()
        .find(|record| record.corpus_id == request.replay_corpus_id)
        .ok_or_else(|| {
            error_json(
                StatusCode::NOT_FOUND,
                "replay-corpus-not-found",
                json!({ "corpusId": request.replay_corpus_id }),
            )
        })?;
    let feature_catalog = state
        .feature_catalog_registry
        .query(&FeatureCatalogRegistryQuery {
            venue_key: Some(request.venue_key.clone()),
            pair_symbol: Some(request.pair_symbol.clone()),
            market_type: Some(request.market_type.clone()),
            status: Some(RuntimeFeatureCatalogStatus::Active),
            ..FeatureCatalogRegistryQuery::default()
        })
        .map_err(map_feature_catalog_registry_error)?;
    let mut cost_models = state
        .cost_model_registry
        .query(&CostModelRegistryQuery {
            venue_key: Some(request.venue_key.clone()),
            pair_symbol: Some(request.pair_symbol.clone()),
            market_type: Some(request.market_type.clone()),
            ..CostModelRegistryQuery::default()
        })
        .map_err(map_cost_model_registry_error)?;
    cost_models.retain(|model| model.status == RuntimeExecutionCostModelStatus::Active);
    cost_models.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let result = state
        .backtesting_engine
        .run(&BacktestRunRequest {
            report_id: request.report_id,
            experiment,
            strategy_spec,
            cost_model: cost_models.into_iter().next(),
            feature_definitions: feature_catalog.feature_definitions,
            regime_tags: feature_catalog.regime_tags,
            replay_corpus,
            config: protocol::RuntimeBacktestConfig {
                replay_corpus_id: request.replay_corpus_id,
                venue_key: request.venue_key,
                pair_symbol: request.pair_symbol,
                market_type: request.market_type,
                window_mode: request.window_mode,
                training_window_observations: request.training_window_observations,
                testing_window_observations: request.testing_window_observations,
                step_observations: request.step_observations,
                purge_observations: request.purge_observations,
                baseline_strategies: request.baseline_strategies,
            },
        })
        .map_err(map_backtesting_engine_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "report": result.report,
        }),
    ))
}

fn enforce_backtest_evidence_gate(
    state: &RuntimeAppState,
    record: &RuntimeResearchEvidenceBundleRecord,
) -> Result<(), JsonPayload> {
    if !promotion_target_requires_backtest(&record.promotion_target) {
        return Ok(());
    }
    let Some(report_id) = record
        .artifacts
        .iter()
        .find(|artifact| artifact.kind == "backtest-report")
        .and_then(|artifact| parse_backtest_artifact_uri(&artifact.uri))
    else {
        return Err(error_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            "backtest-evidence-required",
            json!({
                "promotionTarget": record.promotion_target,
                "requiredArtifactKind": "backtest-report",
            }),
        ));
    };
    let report = state
        .backtesting_engine
        .get_report(&report_id)
        .map_err(map_backtesting_engine_error)?
        .ok_or_else(|| {
            error_json(
                StatusCode::UNPROCESSABLE_ENTITY,
                "backtest-report-not-found",
                json!({ "reportId": report_id }),
            )
        })?;
    if !report.promotion_eligible {
        return Err(error_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            "backtest-promotion-blocked",
            json!({
                "reportId": report.report_id,
                "blockingReasons": report.blocking_reasons,
            }),
        ));
    }
    if report.experiment_id != record.experiment_id || report.strategy_key != record.strategy_key {
        return Err(error_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            "backtest-report-mismatch",
            json!({
                "reportId": report.report_id,
                "reportExperimentId": report.experiment_id,
                "reportStrategyKey": report.strategy_key,
                "evidenceExperimentId": record.experiment_id,
                "evidenceStrategyKey": record.strategy_key,
            }),
        ));
    }
    Ok(())
}

fn promotion_target_requires_backtest(promotion_target: &str) -> bool {
    matches!(
        promotion_target,
        "paper" | "limited_live" | "broad_live" | "live"
    )
}

fn parse_backtest_artifact_uri(uri: &str) -> Option<String> {
    uri.strip_prefix("runtime-backtest://")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn asset_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeAssetQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let assets = state
        .asset_registry
        .list_assets(&AssetRegistryQuery {
            asset_key: query.asset_key.filter(|value| !value.trim().is_empty()),
            venue_key: query.venue_key.filter(|value| !value.trim().is_empty()),
            listing_state: query.listing_state,
        })
        .map_err(map_asset_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "registry": {
                "assets": assets,
            },
        }),
    ))
}

async fn create_asset_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeAssetRecord = parse_json_body(&body, "invalid-runtime-asset")?;
    let result = state
        .asset_registry
        .upsert_asset(&record)
        .map_err(map_asset_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "asset": result.record,
        }),
    ))
}

async fn transition_asset_handler(
    headers: HeaderMap,
    Path(asset_key): Path<String>,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let request: RuntimeAssetTransitionRequest =
        parse_json_body(&body, "invalid-runtime-asset-transition")?;
    let changed_at = request.changed_at.unwrap_or_else(|| {
        OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .expect("timestamp")
    });
    let asset = state
        .asset_registry
        .transition_asset(&asset_key, request.listing_state, &changed_at)
        .map_err(map_asset_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "asset": asset,
        }),
    ))
}

async fn historical_data_lake_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeHistoricalDataLakeQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let registry = state
        .historical_data_lake
        .query(&HistoricalDataLakeQuery {
            dataset_id: query.dataset_id.filter(|value| !value.trim().is_empty()),
            snapshot_id: query.snapshot_id.filter(|value| !value.trim().is_empty()),
            corpus_id: query.corpus_id.filter(|value| !value.trim().is_empty()),
            venue_key: query.venue_key.filter(|value| !value.trim().is_empty()),
            asset_key: query.asset_key.filter(|value| !value.trim().is_empty()),
            dataset_kind: query.dataset_kind,
        })
        .map_err(map_historical_data_lake_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "registry": {
                "datasetSnapshots": registry.dataset_snapshots,
                "replayCorpora": registry.replay_corpora,
            },
        }),
    ))
}

async fn create_historical_dataset_snapshot_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeHistoricalDatasetSnapshotRecord =
        parse_json_body(&body, "invalid-runtime-historical-dataset-snapshot")?;
    let result = state
        .historical_data_lake
        .upsert_dataset_snapshot(&record)
        .map_err(map_historical_data_lake_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "datasetSnapshot": result.record,
        }),
    ))
}

async fn create_replay_corpus_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeReplayCorpusRecord =
        parse_json_body(&body, "invalid-runtime-replay-corpus")?;
    let result = state
        .historical_data_lake
        .upsert_replay_corpus(&record)
        .map_err(map_historical_data_lake_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "replayCorpus": result.record,
        }),
    ))
}

async fn feature_catalog_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeFeatureCatalogQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let registry = state
        .feature_catalog_registry
        .query(&FeatureCatalogRegistryQuery {
            feature_id: query.feature_id.filter(|value| !value.trim().is_empty()),
            feature_key: query.feature_key.filter(|value| !value.trim().is_empty()),
            regime_tag_id: query.regime_tag_id.filter(|value| !value.trim().is_empty()),
            regime_key: query.regime_key.filter(|value| !value.trim().is_empty()),
            venue_key: query.venue_key.filter(|value| !value.trim().is_empty()),
            asset_key: query.asset_key.filter(|value| !value.trim().is_empty()),
            pair_symbol: query.pair_symbol.filter(|value| !value.trim().is_empty()),
            market_type: query.market_type,
            status: query.status,
        })
        .map_err(map_feature_catalog_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "registry": {
                "featureDefinitions": registry.feature_definitions,
                "regimeTags": registry.regime_tags,
            },
        }),
    ))
}

async fn create_feature_definition_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeFeatureDefinitionRecord =
        parse_json_body(&body, "invalid-runtime-feature-definition")?;
    let result = state
        .feature_catalog_registry
        .upsert_feature_definition(&record)
        .map_err(map_feature_catalog_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "featureDefinition": result.record,
        }),
    ))
}

async fn create_regime_tag_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeRegimeTagRecord = parse_json_body(&body, "invalid-runtime-regime-tag")?;
    let result = state
        .feature_catalog_registry
        .upsert_regime_tag(&record)
        .map_err(map_feature_catalog_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "regimeTag": result.record,
        }),
    ))
}

async fn cost_model_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeCostModelQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let registry = state
        .cost_model_registry
        .query(&CostModelRegistryQuery {
            model_id: query.model_id.filter(|value| !value.trim().is_empty()),
            venue_key: query.venue_key.filter(|value| !value.trim().is_empty()),
            asset_key: query.asset_key.filter(|value| !value.trim().is_empty()),
            pair_symbol: query.pair_symbol.filter(|value| !value.trim().is_empty()),
            market_type: query.market_type,
            mode: query.mode,
        })
        .map_err(map_cost_model_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "registry": {
                "costModels": registry,
            },
        }),
    ))
}

async fn create_cost_model_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeExecutionCostModelRecord =
        parse_json_body(&body, "invalid-runtime-execution-cost-model")?;
    let result = state
        .cost_model_registry
        .upsert_model(&record)
        .map_err(map_cost_model_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "costModel": result.record,
        }),
    ))
}

async fn cost_observation_query_handler(
    headers: HeaderMap,
    Query(query): Query<RuntimeCostObservationQueryParams>,
    State(state): State<RuntimeAppState>,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let filters = query.clone();
    let observations = state
        .cost_model_registry
        .query_observations(&CostObservationQuery {
            observation_id: query
                .observation_id
                .filter(|value| !value.trim().is_empty()),
            model_id: query.model_id.filter(|value| !value.trim().is_empty()),
            deployment_id: query.deployment_id.filter(|value| !value.trim().is_empty()),
            run_id: query.run_id.filter(|value| !value.trim().is_empty()),
            venue_key: query.venue_key.filter(|value| !value.trim().is_empty()),
            asset_key: query.asset_key.filter(|value| !value.trim().is_empty()),
            pair_symbol: query.pair_symbol.filter(|value| !value.trim().is_empty()),
            market_type: query.market_type,
            mode: query.mode,
        })
        .map_err(map_cost_model_registry_error)?;
    Ok(OkJson::with_status(
        StatusCode::OK,
        json!({
            "ok": true,
            "source": "runtime-rs",
            "filters": filters,
            "registry": {
                "costObservations": observations,
            },
        }),
    ))
}

async fn create_cost_observation_handler(
    headers: HeaderMap,
    State(state): State<RuntimeAppState>,
    body: Bytes,
) -> HandlerResult {
    authorize_internal_request(&headers, &state)?;
    let record: RuntimeExecutionCostObservationRecord =
        parse_json_body(&body, "invalid-runtime-execution-cost-observation")?;
    let result = state
        .cost_model_registry
        .upsert_observation(&record)
        .map_err(map_cost_model_registry_error)?;
    Ok(OkJson::with_status(
        if result.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": result.created,
            "costObservation": result.record,
        }),
    ))
}

struct ShadowEvaluationResponse {
    created: bool,
    deployment: RuntimeDeploymentRecord,
    run: RuntimeRunRecord,
    risk_verdict: protocol::RuntimeRiskVerdict,
    feature_snapshot: feature_cache::DerivedMarketFeatureSnapshot,
    ledger_snapshot: protocol::RuntimeLedgerSnapshot,
    allocator_decision: Option<protocol::RuntimeAllocatorDecisionRecord>,
    execution_plan: Option<protocol::RuntimeExecutionPlan>,
    coordination: Option<ExecSubmitResponse>,
    reconciliation: Option<protocol::RuntimeReconciliationResult>,
    observed_ledger_snapshot: Option<protocol::RuntimeLedgerSnapshot>,
}

fn shadow_evaluation_json(payload: ShadowEvaluationResponse) -> JsonPayload {
    OkJson::with_status(
        if payload.created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        json!({
            "ok": true,
            "source": "runtime-rs",
            "created": payload.created,
            "deployment": payload.deployment,
            "run": payload.run,
            "riskVerdict": payload.risk_verdict,
            "featureSnapshot": payload.feature_snapshot,
            "ledger": payload.ledger_snapshot,
            "allocatorDecision": payload.allocator_decision,
            "executionPlan": payload.execution_plan,
            "coordination": payload.coordination,
            "reconciliation": payload.reconciliation,
            "observedLedger": payload.observed_ledger_snapshot,
        }),
    )
}

fn runtime_receipt_from_exec_response(
    plan: &protocol::RuntimeExecutionPlan,
    submit: &ExecSubmitResponse,
    receipt: &ExecReceiptObservation,
) -> reconciler::RuntimeReceiptObservation {
    reconciler::RuntimeReceiptObservation {
        receipt_id: receipt.receipt_id.clone(),
        deployment_id: plan.deployment_id.clone(),
        run_id: plan.run_id.clone(),
        submit_request_id: submit.submit_request_id.clone(),
        observed_at: receipt.observed_at.clone(),
        source: submit.source.clone(),
        status: receipt.status.clone(),
        notes: receipt.notes.clone(),
    }
}

fn parse_json_body<T: DeserializeOwned>(body: &[u8], error_code: &str) -> Result<T, JsonPayload> {
    serde_json::from_slice(body).map_err(|error| {
        error_json(
            StatusCode::BAD_REQUEST,
            error_code,
            json!({ "reason": error.to_string() }),
        )
    })
}

fn require_deployment_id(query: RuntimeDeploymentQuery) -> Result<String, JsonPayload> {
    query
        .deployment_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| error_json(StatusCode::BAD_REQUEST, "deployment-id-required", json!({})))
}

fn sync_ledger_with_rollback(
    state: &RuntimeAppState,
    previous: Option<RuntimeDeploymentRecord>,
    deployment: &RuntimeDeploymentRecord,
) -> Result<portfolio_ledger::LedgerSyncResult, JsonPayload> {
    match state.portfolio_ledger.sync_deployment(deployment) {
        Ok(result) => Ok(result),
        Err(error) => {
            rollback_registry_change(
                &state.strategy_registry,
                previous,
                &deployment.deployment_id,
            )
            .map_err(|rollback_error| {
                error_json(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "runtime-ledger-rollback-failed",
                    json!({
                        "deploymentId": deployment.deployment_id,
                        "reason": error.to_string(),
                        "rollbackReason": rollback_error.to_string(),
                    }),
                )
            })?;
            Err(map_ledger_error(error))
        }
    }
}

fn rollback_registry_change(
    strategy_registry: &StrategyRegistry,
    previous: Option<RuntimeDeploymentRecord>,
    deployment_id: &str,
) -> Result<(), StrategyRegistryError> {
    if let Some(previous) = previous {
        strategy_registry.upsert_deployment(&previous)?;
    } else {
        let _ = strategy_registry.delete_deployment(deployment_id)?;
    }
    Ok(())
}

fn authorize_internal_request(
    headers: &HeaderMap,
    state: &RuntimeAppState,
) -> Result<(), JsonPayload> {
    let configured_token = state
        .config
        .internal_service_token
        .as_deref()
        .unwrap_or("")
        .trim();
    if configured_token.is_empty() {
        return Err(error_json(
            StatusCode::SERVICE_UNAVAILABLE,
            "runtime-service-auth-not-configured",
            json!({}),
        ));
    }

    let provided_token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_bearer_token);

    if provided_token.as_deref() != Some(configured_token) {
        return Err(error_json(
            StatusCode::UNAUTHORIZED,
            "auth-required",
            json!({}),
        ));
    }

    Ok(())
}

fn parse_bearer_token(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.len() < 7 {
        return None;
    }
    let (scheme, token) = raw.split_at(7);
    if !scheme.eq_ignore_ascii_case("bearer ") {
        return None;
    }
    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn map_registry_error(error: StrategyRegistryError) -> JsonPayload {
    match error {
        StrategyRegistryError::DeploymentNotFound { deployment_id } => error_json(
            StatusCode::NOT_FOUND,
            "deployment-not-found",
            json!({ "deploymentId": deployment_id }),
        ),
        StrategyRegistryError::UnsupportedStrategy(strategy_key) => error_json(
            StatusCode::BAD_REQUEST,
            "unsupported-strategy",
            json!({ "strategyKey": strategy_key }),
        ),
        StrategyRegistryError::StrategyVenueUnsupported {
            strategy_key,
            venue_key,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "strategy-venue-unsupported",
            json!({ "strategyKey": strategy_key, "venueKey": venue_key }),
        ),
        StrategyRegistryError::StrategyCatalog(error) => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-strategy-spec",
            json!({ "reason": error.to_string() }),
        ),
        StrategyRegistryError::VenueCatalog(error) => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-venue-capability",
            json!({ "reason": error.to_string() }),
        ),
        StrategyRegistryError::ImmutableFieldChanged {
            deployment_id,
            field,
        } => error_json(
            StatusCode::CONFLICT,
            "deployment-conflict",
            json!({ "deploymentId": deployment_id, "field": field }),
        ),
        StrategyRegistryError::InvalidStateTransition {
            deployment_id,
            from_state,
            to_state,
        } => error_json(
            StatusCode::CONFLICT,
            "invalid-state-transition",
            json!({
                "deploymentId": deployment_id,
                "fromState": from_state,
                "toState": to_state,
            }),
        ),
        StrategyRegistryError::DeploymentNotShadow {
            deployment_id,
            state,
        } => error_json(
            StatusCode::CONFLICT,
            "deployment-not-shadow",
            json!({
                "deploymentId": deployment_id,
                "state": state,
            }),
        ),
        StrategyRegistryError::DeploymentNotRunnable {
            deployment_id,
            state,
        } => error_json(
            StatusCode::CONFLICT,
            "deployment-not-runnable",
            json!({
                "deploymentId": deployment_id,
                "state": state,
            }),
        ),
        StrategyRegistryError::FeatureStreamMissing { symbol } => error_json(
            StatusCode::CONFLICT,
            "feature-stream-missing",
            json!({ "symbol": symbol }),
        ),
        StrategyRegistryError::FeatureStreamStale { symbol, reasons } => error_json(
            StatusCode::CONFLICT,
            "feature-stream-stale",
            json!({ "symbol": symbol, "reasons": reasons }),
        ),
        StrategyRegistryError::InvalidObservedAt(value) => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-trigger",
            json!({ "observedAt": value }),
        ),
        StrategyRegistryError::RunNotFound { run_id } => error_json(
            StatusCode::NOT_FOUND,
            "run-not-found",
            json!({ "runId": run_id }),
        ),
        StrategyRegistryError::InvalidRunStateTransition {
            run_id,
            from_state,
            to_state,
        } => error_json(
            StatusCode::CONFLICT,
            "invalid-run-state-transition",
            json!({
                "runId": run_id,
                "fromState": from_state,
                "toState": to_state,
            }),
        ),
        StrategyRegistryError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        StrategyRegistryError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        StrategyRegistryError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-registry-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_risk_error(error: RiskEngineError) -> JsonPayload {
    match error {
        RiskEngineError::InvalidUsdAmount { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-risk-amount",
            json!({ "field": field, "value": value }),
        ),
        RiskEngineError::InvalidTimestamp { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-risk-timestamp",
            json!({ "field": field, "value": value }),
        ),
        RiskEngineError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-risk-error",
            json!({ "reason": error.to_string() }),
        ),
        RiskEngineError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-risk-error",
            json!({ "reason": error.to_string() }),
        ),
        RiskEngineError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-risk-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_execution_planner_error(error: ExecutionPlannerError) -> JsonPayload {
    match error {
        ExecutionPlannerError::InvalidUsdAmount { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-execution-plan-amount",
            json!({ "field": field, "value": value }),
        ),
        ExecutionPlannerError::InvalidNumericValue { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-execution-plan-number",
            json!({ "field": field, "value": value }),
        ),
        ExecutionPlannerError::RiskNotAllowed { verdict_id } => error_json(
            StatusCode::CONFLICT,
            "risk-not-allowed",
            json!({ "verdictId": verdict_id }),
        ),
        ExecutionPlannerError::PlanNotFound { plan_id } => error_json(
            StatusCode::NOT_FOUND,
            "execution-plan-not-found",
            json!({ "planId": plan_id }),
        ),
        ExecutionPlannerError::UnsupportedStrategy(strategy_key) => error_json(
            StatusCode::BAD_REQUEST,
            "unsupported-strategy",
            json!({ "strategyKey": strategy_key }),
        ),
        ExecutionPlannerError::UnsupportedVenueCapability { venue_key, reason } => error_json(
            StatusCode::BAD_REQUEST,
            "unsupported-venue-capability",
            json!({ "venueKey": venue_key, "reason": reason }),
        ),
        ExecutionPlannerError::StrategyCatalog(error) => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-strategy-spec",
            json!({ "reason": error.to_string() }),
        ),
        ExecutionPlannerError::VenueCatalog(error) => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-venue-capability",
            json!({ "reason": error.to_string() }),
        ),
        ExecutionPlannerError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-execution-plan-error",
            json!({ "reason": error.to_string() }),
        ),
        ExecutionPlannerError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-execution-plan-error",
            json!({ "reason": error.to_string() }),
        ),
        ExecutionPlannerError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-execution-plan-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_reconciler_error(error: ReconcilerError) -> JsonPayload {
    match error {
        ReconcilerError::InvalidNumericValue { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-reconciliation-number",
            json!({ "field": field, "value": value }),
        ),
        ReconcilerError::ResultNotFound { run_id } => error_json(
            StatusCode::NOT_FOUND,
            "reconciliation-not-found",
            json!({ "runId": run_id }),
        ),
        ReconcilerError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-reconciliation-error",
            json!({ "reason": error.to_string() }),
        ),
        ReconcilerError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-reconciliation-error",
            json!({ "reason": error.to_string() }),
        ),
        ReconcilerError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-reconciliation-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_scorecard_error(error: RuntimeScorecardError) -> JsonPayload {
    match error {
        RuntimeScorecardError::InvalidUsdAmount { field, value } => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-scorecard-error",
            json!({ "field": field, "value": value }),
        ),
        RuntimeScorecardError::InvalidTimestamp { field, value } => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-scorecard-error",
            json!({ "field": field, "value": value }),
        ),
    }
}

fn map_exec_client_error(error: ExecClientError) -> JsonPayload {
    error_json(
        StatusCode::from_u16(error.status).unwrap_or(StatusCode::BAD_GATEWAY),
        "runtime-exec-coordination-error",
        json!({
            "code": error.code,
            "message": error.message,
        }),
    )
}

fn map_paper_execution_error(error: PaperExecutionError) -> JsonPayload {
    error_json(
        StatusCode::INTERNAL_SERVER_ERROR,
        "paper-execution-failed",
        json!({
            "reason": error.to_string(),
        }),
    )
}

fn map_allocator_error(error: RuntimeAllocatorError) -> JsonPayload {
    match error {
        RuntimeAllocatorError::InvalidUsdAmount { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-allocator-amount",
            json!({ "field": field, "value": value }),
        ),
        RuntimeAllocatorError::DecisionNotFound { run_id } => error_json(
            StatusCode::NOT_FOUND,
            "allocator-decision-not-found",
            json!({ "runId": run_id }),
        ),
        RuntimeAllocatorError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-allocator-error",
            json!({ "reason": error.to_string() }),
        ),
        RuntimeAllocatorError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-allocator-error",
            json!({ "reason": error.to_string() }),
        ),
        RuntimeAllocatorError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-allocator-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_feature_catalog_registry_error(error: FeatureCatalogRegistryError) -> JsonPayload {
    match error {
        FeatureCatalogRegistryError::InvalidFeatureDefinition { feature_id, reason } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-feature-definition",
            json!({ "featureId": feature_id, "reason": reason }),
        ),
        FeatureCatalogRegistryError::InvalidRegimeTag {
            regime_tag_id,
            reason,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-regime-tag",
            json!({ "regimeTagId": regime_tag_id, "reason": reason }),
        ),
        FeatureCatalogRegistryError::DatasetSnapshotMissing {
            record_id,
            dataset_id,
            snapshot_id,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "runtime-feature-catalog-dataset-missing",
            json!({
                "recordId": record_id,
                "datasetId": dataset_id,
                "snapshotId": snapshot_id,
            }),
        ),
        FeatureCatalogRegistryError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-feature-catalog-error",
            json!({ "reason": error.to_string() }),
        ),
        FeatureCatalogRegistryError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-feature-catalog-error",
            json!({ "reason": error.to_string() }),
        ),
        FeatureCatalogRegistryError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-feature-catalog-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_cost_model_registry_error(error: CostModelRegistryError) -> JsonPayload {
    match error {
        CostModelRegistryError::InvalidModel { model_id, reason } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-execution-cost-model",
            json!({ "modelId": model_id, "reason": reason }),
        ),
        CostModelRegistryError::DatasetSnapshotMissing {
            model_id,
            dataset_id,
            snapshot_id,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "execution-cost-model-dataset-missing",
            json!({
                "modelId": model_id,
                "datasetId": dataset_id,
                "snapshotId": snapshot_id,
            }),
        ),
        CostModelRegistryError::ModelNotFound { model_id } => error_json(
            StatusCode::NOT_FOUND,
            "execution-cost-model-not-found",
            json!({ "modelId": model_id }),
        ),
        CostModelRegistryError::InvalidObservation {
            observation_id,
            reason,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-execution-cost-observation",
            json!({ "observationId": observation_id, "reason": reason }),
        ),
        CostModelRegistryError::ObservationModelMismatch {
            observation_id,
            model_id,
            reason,
        } => error_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            "execution-cost-observation-model-mismatch",
            json!({
                "observationId": observation_id,
                "modelId": model_id,
                "reason": reason,
            }),
        ),
        CostModelRegistryError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-execution-cost-model-error",
            json!({ "reason": error.to_string() }),
        ),
        CostModelRegistryError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-execution-cost-model-error",
            json!({ "reason": error.to_string() }),
        ),
        CostModelRegistryError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-execution-cost-model-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_backtesting_engine_error(error: BacktestingEngineError) -> JsonPayload {
    match error {
        BacktestingEngineError::InvalidConfig { reason } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-backtest-config",
            json!({ "reason": reason }),
        ),
        BacktestingEngineError::InvalidTimestamp { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-backtest-timestamp",
            json!({ "field": field, "value": value }),
        ),
        BacktestingEngineError::InvalidNumber { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-backtest-number",
            json!({ "field": field, "value": value }),
        ),
        BacktestingEngineError::UnsupportedFixtureUri { uri } => error_json(
            StatusCode::BAD_REQUEST,
            "unsupported-runtime-backtest-fixture-uri",
            json!({ "uri": uri }),
        ),
        BacktestingEngineError::MissingFixtureUri { corpus_id } => error_json(
            StatusCode::BAD_REQUEST,
            "runtime-backtest-fixture-missing",
            json!({ "corpusId": corpus_id }),
        ),
        BacktestingEngineError::InsufficientObservations {
            required,
            available,
        } => error_json(
            StatusCode::UNPROCESSABLE_ENTITY,
            "runtime-backtest-insufficient-observations",
            json!({ "required": required, "available": available }),
        ),
        BacktestingEngineError::ReportNotFound { report_id } => error_json(
            StatusCode::NOT_FOUND,
            "runtime-backtest-report-not-found",
            json!({ "reportId": report_id }),
        ),
        BacktestingEngineError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-backtest-error",
            json!({ "reason": error.to_string() }),
        ),
        BacktestingEngineError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-backtest-error",
            json!({ "reason": error.to_string() }),
        ),
        BacktestingEngineError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-backtest-error",
            json!({ "reason": error.to_string() }),
        ),
        BacktestingEngineError::FeedFixture(error) => error_json(
            StatusCode::BAD_REQUEST,
            "runtime-backtest-fixture-error",
            json!({ "reason": error.to_string() }),
        ),
        BacktestingEngineError::FeatureCache(error) => error_json(
            StatusCode::BAD_REQUEST,
            "runtime-backtest-feature-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_research_registry_error(error: ResearchRegistryError) -> JsonPayload {
    match error {
        ResearchRegistryError::SourceNotFound { source_id } => error_json(
            StatusCode::NOT_FOUND,
            "research-source-not-found",
            json!({ "sourceId": source_id }),
        ),
        ResearchRegistryError::HypothesisNotFound { hypothesis_id } => error_json(
            StatusCode::NOT_FOUND,
            "research-hypothesis-not-found",
            json!({ "hypothesisId": hypothesis_id }),
        ),
        ResearchRegistryError::ExperimentNotFound { experiment_id } => error_json(
            StatusCode::NOT_FOUND,
            "research-experiment-not-found",
            json!({ "experimentId": experiment_id }),
        ),
        ResearchRegistryError::IdentityConflict {
            record_type,
            record_id,
            existing_record_id,
        } => error_json(
            StatusCode::CONFLICT,
            "research-identity-conflict",
            json!({
                "recordType": record_type,
                "recordId": record_id,
                "existingRecordId": existing_record_id,
            }),
        ),
        ResearchRegistryError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-research-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        ResearchRegistryError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-research-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        ResearchRegistryError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-research-registry-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_asset_registry_error(error: AssetRegistryError) -> JsonPayload {
    match error {
        AssetRegistryError::AssetNotFound { asset_key } => error_json(
            StatusCode::NOT_FOUND,
            "asset-not-found",
            json!({ "assetKey": asset_key }),
        ),
        AssetRegistryError::InvalidStateTransition {
            asset_key,
            from_state,
            to_state,
        } => error_json(
            StatusCode::CONFLICT,
            "invalid-asset-state-transition",
            json!({
                "assetKey": asset_key,
                "fromState": from_state,
                "toState": to_state,
            }),
        ),
        AssetRegistryError::AssetModeUnsupported {
            asset_key,
            listing_state,
            mode,
        } => error_json(
            StatusCode::CONFLICT,
            "asset-mode-not-supported",
            json!({
                "assetKey": asset_key,
                "listingState": listing_state,
                "mode": mode,
            }),
        ),
        AssetRegistryError::VenueMappingMissing {
            asset_key,
            venue_key,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "asset-venue-mapping-missing",
            json!({ "assetKey": asset_key, "venueKey": venue_key }),
        ),
        AssetRegistryError::QuoteAssetUnsupported {
            base_asset_key,
            quote_asset_key,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "asset-quote-not-supported",
            json!({
                "baseAssetKey": base_asset_key,
                "quoteAssetKey": quote_asset_key,
            }),
        ),
        AssetRegistryError::VenueMappingModeUnsupported {
            asset_key,
            venue_key,
            listing_state,
            mode,
        } => error_json(
            StatusCode::CONFLICT,
            "asset-venue-mode-not-supported",
            json!({
                "assetKey": asset_key,
                "venueKey": venue_key,
                "listingState": listing_state,
                "mode": mode,
            }),
        ),
        AssetRegistryError::VenueMappingQuoteUnsupported {
            base_asset_key,
            quote_asset_key,
            venue_key,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "asset-venue-quote-not-supported",
            json!({
                "baseAssetKey": base_asset_key,
                "quoteAssetKey": quote_asset_key,
                "venueKey": venue_key,
            }),
        ),
        AssetRegistryError::VenueNativeIdNotFound {
            venue_key,
            native_id,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "asset-venue-native-id-not-found",
            json!({ "venueKey": venue_key, "nativeId": native_id }),
        ),
        AssetRegistryError::InvalidRecord { asset_key, reason } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-asset",
            json!({ "assetKey": asset_key, "reason": reason }),
        ),
        AssetRegistryError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-asset-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        AssetRegistryError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-asset-registry-error",
            json!({ "reason": error.to_string() }),
        ),
        AssetRegistryError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-asset-registry-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn map_historical_data_lake_error(error: HistoricalDataLakeError) -> JsonPayload {
    match error {
        HistoricalDataLakeError::DatasetSnapshotNotFound {
            dataset_id,
            snapshot_id,
        } => error_json(
            StatusCode::NOT_FOUND,
            "historical-dataset-snapshot-not-found",
            json!({ "datasetId": dataset_id, "snapshotId": snapshot_id }),
        ),
        HistoricalDataLakeError::ReplayCorpusDatasetMissing {
            corpus_id,
            dataset_id,
            snapshot_id,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "replay-corpus-dataset-missing",
            json!({
                "corpusId": corpus_id,
                "datasetId": dataset_id,
                "snapshotId": snapshot_id,
            }),
        ),
        HistoricalDataLakeError::InvalidDatasetSnapshot {
            dataset_id,
            snapshot_id,
            reason,
        } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-runtime-historical-dataset-snapshot",
            json!({
                "datasetId": dataset_id,
                "snapshotId": snapshot_id,
                "reason": reason,
            }),
        ),
        HistoricalDataLakeError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-historical-data-lake-error",
            json!({ "reason": error.to_string() }),
        ),
        HistoricalDataLakeError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-historical-data-lake-error",
            json!({ "reason": error.to_string() }),
        ),
        HistoricalDataLakeError::Serialization(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-historical-data-lake-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn deployment_has_kill_switch(deployment: &RuntimeDeploymentRecord) -> bool {
    deployment
        .tags
        .iter()
        .any(|tag| tag.eq_ignore_ascii_case(RUNTIME_KILL_SWITCH_TAG))
}

fn is_worker_runtime_canary_trigger(trigger: Option<&ShadowEvaluationTrigger>) -> bool {
    matches!(
        trigger,
        Some(ShadowEvaluationTrigger {
            kind: protocol::RuntimeTriggerKind::Canary,
            source,
            ..
        }) if source == "worker-runtime-canary"
    )
}

fn map_ledger_error(error: PortfolioLedgerError) -> JsonPayload {
    match error {
        PortfolioLedgerError::DeploymentNotFound { deployment_id } => error_json(
            StatusCode::NOT_FOUND,
            "deployment-not-found",
            json!({ "deploymentId": deployment_id }),
        ),
        PortfolioLedgerError::SleeveOversubscribed {
            sleeve_id,
            requested_usd,
            available_usd,
        } => error_json(
            StatusCode::CONFLICT,
            "sleeve-oversubscribed",
            json!({
                "sleeveId": sleeve_id,
                "requestedUsd": requested_usd,
                "availableUsd": available_usd,
            }),
        ),
        PortfolioLedgerError::InvalidUsdAmount { field, value } => error_json(
            StatusCode::BAD_REQUEST,
            "invalid-ledger-amount",
            json!({ "field": field, "value": value }),
        ),
        PortfolioLedgerError::InvalidCorrection { sleeve_id } => error_json(
            StatusCode::CONFLICT,
            "invalid-ledger-correction",
            json!({ "sleeveId": sleeve_id }),
        ),
        PortfolioLedgerError::Io(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-ledger-error",
            json!({ "reason": error.to_string() }),
        ),
        PortfolioLedgerError::Storage(error) => error_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            "runtime-ledger-error",
            json!({ "reason": error.to_string() }),
        ),
    }
}

fn error_json(status: StatusCode, error: &str, details: Value) -> JsonPayload {
    (
        status,
        Json(json!({
            "ok": false,
            "error": error,
            "details": details,
        })),
    )
}

struct OkJson;

impl OkJson {
    fn with_status(status: StatusCode, payload: Value) -> JsonPayload {
        (status, Json(payload))
    }
}

fn feed_gateway_config(config: &RuntimeConfig) -> FeedGatewayConfig {
    FeedGatewayConfig::new(
        &config.feed_provider,
        &config.feed_websocket_url,
        &config.feed_http_url,
        config.feed_market_stale_after_ms,
        config.feed_slot_stale_after_ms,
        config.feed_max_slot_gap,
    )
}

fn feature_cache_config(config: &RuntimeConfig) -> FeatureCacheConfig {
    FeatureCacheConfig::new(
        config.feature_stale_after_ms,
        config.feed_slot_stale_after_ms,
        config.feed_max_slot_gap,
        config.feature_short_window_ms,
        config.feature_long_window_ms,
        config.feature_volatility_window_size,
        config.feature_max_samples_per_stream,
    )
}

fn bootstrap_runtime_state(
    feed_gateway: &mut FeedGateway,
    feature_cache: &mut FeatureCache,
    config: &RuntimeConfig,
) -> (String, Option<String>) {
    if let Some(path) = config.feed_replay_fixture_path.as_deref() {
        match FeedReplayFixture::load_from_path(path)
            .map_err(BootstrapError::Feed)
            .and_then(|fixture| apply_fixture(feed_gateway, feature_cache, &fixture))
        {
            Ok(_) => return (format!("replay:{path}"), None),
            Err(error) => {
                let error_message = format!("replay-fixture-load-failed:{error}");
                feed_gateway.mark_degraded(&error_message);
                feature_cache.mark_degraded(&error_message);
                let (_, fallback_error) = seed_synthetic_bootstrap(feed_gateway, feature_cache);
                return (
                    "synthetic-bootstrap".to_string(),
                    Some(match fallback_error {
                        Some(fallback_error) => {
                            format!("{error_message}; fallback-bootstrap-failed:{fallback_error}")
                        }
                        None => error_message,
                    }),
                );
            }
        }
    }

    seed_synthetic_bootstrap(feed_gateway, feature_cache)
}

fn seed_synthetic_bootstrap(
    feed_gateway: &mut FeedGateway,
    feature_cache: &mut FeatureCache,
) -> (String, Option<String>) {
    match FeedReplayFixture::bootstrap(OffsetDateTime::now_utc())
        .map_err(BootstrapError::Feed)
        .and_then(|fixture| apply_fixture(feed_gateway, feature_cache, &fixture))
    {
        Ok(_) => ("synthetic-bootstrap".to_string(), None),
        Err(error) => {
            let error_message = format!("synthetic-bootstrap-failed:{error}");
            feed_gateway.mark_degraded(&error_message);
            feature_cache.mark_degraded(&error_message);
            ("synthetic-bootstrap".to_string(), Some(error_message))
        }
    }
}

fn should_spawn_fixture_keepalive(config: &RuntimeConfig) -> bool {
    config.feed_provider == "fixture" && config.feed_replay_fixture_path.is_none()
}

fn spawn_fixture_keepalive(
    feed_gateway: Arc<RwLock<FeedGateway>>,
    feature_cache: Arc<RwLock<FeatureCache>>,
) {
    tokio::spawn(async move {
        let mut sequence_seed: u64 = 100;
        loop {
            sleep(Duration::from_secs(5)).await;
            sequence_seed = sequence_seed.saturating_add(100);
            let fixture = match FeedReplayFixture::bootstrap_with_sequence_seed(
                OffsetDateTime::now_utc(),
                sequence_seed,
            ) {
                Ok(fixture) => fixture,
                Err(error) => {
                    feed_gateway
                        .write()
                        .expect("feed gateway write lock")
                        .mark_degraded(&format!("fixture-keepalive-build-failed:{error}"));
                    feature_cache
                        .write()
                        .expect("feature cache write lock")
                        .mark_degraded(&format!("fixture-keepalive-build-failed:{error}"));
                    continue;
                }
            };

            let apply_result = {
                let mut feed_gateway = feed_gateway.write().expect("feed gateway write lock");
                let mut feature_cache = feature_cache.write().expect("feature cache write lock");
                apply_fixture(&mut feed_gateway, &mut feature_cache, &fixture)
            };
            if let Err(error) = apply_result {
                feed_gateway
                    .write()
                    .expect("feed gateway write lock")
                    .mark_degraded(&format!("fixture-keepalive-apply-failed:{error}"));
                feature_cache
                    .write()
                    .expect("feature cache write lock")
                    .mark_degraded(&format!("fixture-keepalive-apply-failed:{error}"));
            }
        }
    });
}

#[derive(Debug)]
enum BootstrapError {
    Feed(market_adapters::FeedGatewayError),
    Features(feature_cache::FeatureCacheError),
}

impl std::fmt::Display for BootstrapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Feed(error) => write!(f, "{error}"),
            Self::Features(error) => write!(f, "{error}"),
        }
    }
}

fn apply_fixture(
    feed_gateway: &mut FeedGateway,
    feature_cache: &mut FeatureCache,
    fixture: &FeedReplayFixture,
) -> Result<(), BootstrapError> {
    feed_gateway
        .apply_replay_fixture(fixture)
        .map_err(BootstrapError::Feed)?;
    feature_cache
        .apply_replay_fixture(fixture)
        .map_err(BootstrapError::Features)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use axum::{
        body::Body,
        extract::State,
        http::{HeaderMap, HeaderValue, Request, StatusCode},
        routing::{get, post},
        Json, Router,
    };
    use http_body_util::BodyExt;
    use tokio::net::TcpListener;
    use tower::ServiceExt;

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
                "runtime-rs-{test_name}-{unique}-{sequence}.sqlite3"
            ))
            .display()
            .to_string()
    }

    #[derive(Clone)]
    struct ExecStubState {
        expected_auth: String,
    }

    fn test_config() -> RuntimeConfig {
        test_config_with_worker_api_base(None)
    }

    fn test_config_with_worker_api_base(worker_api_base: Option<&str>) -> RuntimeConfig {
        test_config_with_runtime(worker_api_base, None)
    }

    fn test_config_with_runtime(
        worker_api_base: Option<&str>,
        replay_fixture_path: Option<&str>,
    ) -> RuntimeConfig {
        RuntimeConfig::from_lookup(|key| match key {
            "RUNTIME_INTERNAL_SERVICE_TOKEN" => Some("runtime-service-secret".to_string()),
            "RUNTIME_WORKER_API_BASE" => worker_api_base.map(str::to_string),
            "RUNTIME_FEED_REPLAY_FIXTURE_PATH" => replay_fixture_path.map(str::to_string),
            "RUNTIME_DATABASE_URL" => Some(temp_database_url("config")),
            _ => None,
        })
        .expect("config to load")
    }

    fn write_replay_fixture(test_name: &str, prices: &[&str]) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let base_time = OffsetDateTime::now_utc() - time::Duration::seconds(10);
        let path =
            std::env::temp_dir().join(format!("runtime-rs-replay-{test_name}-{unique}.json"));
        let market_events = prices
            .iter()
            .enumerate()
            .map(|(index, price)| {
                let observed_at = (base_time + time::Duration::seconds((index as i64) * 5))
                    .format(&time::format_description::well_known::Rfc3339)
                    .expect("timestamp");
                market_adapters::MarketFeedEvent {
                    source: "fixture.jupiter".to_string(),
                    symbol: "SOL/USDC".to_string(),
                    base_mint: "So11111111111111111111111111111111111111112".to_string(),
                    quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                    price_usd: (*price).to_string(),
                    bid_price_usd: Some((*price).to_string()),
                    ask_price_usd: Some((*price).to_string()),
                    observed_at: observed_at.clone(),
                    received_at: observed_at,
                    sequence: 100 + index as u64,
                }
            })
            .collect::<Vec<_>>();
        let slot_observed_at = (base_time + time::Duration::seconds(10))
            .format(&time::format_description::well_known::Rfc3339)
            .expect("timestamp");
        let fixture = FeedReplayFixture {
            schema_version: "v1".to_string(),
            market_events,
            slot_events: vec![
                market_adapters::SlotFeedEvent {
                    source: "fixture.helius".to_string(),
                    commitment: market_adapters::SlotCommitment::Processed,
                    slot: 310_000_000,
                    observed_at: slot_observed_at.clone(),
                    sequence: 201,
                },
                market_adapters::SlotFeedEvent {
                    source: "fixture.helius".to_string(),
                    commitment: market_adapters::SlotCommitment::Confirmed,
                    slot: 309_999_999,
                    observed_at: slot_observed_at.clone(),
                    sequence: 202,
                },
                market_adapters::SlotFeedEvent {
                    source: "fixture.helius".to_string(),
                    commitment: market_adapters::SlotCommitment::Finalized,
                    slot: 309_999_998,
                    observed_at: slot_observed_at,
                    sequence: 203,
                },
            ],
        };
        fs::write(
            &path,
            serde_json::to_string(&fixture).expect("fixture to serialize"),
        )
        .expect("fixture to write");
        path.display().to_string()
    }

    async fn spawn_exec_coordination_stub() -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener to bind");
        let address = listener.local_addr().expect("local addr");
        let app = Router::new()
            .route(
                "/api/internal/runtime/health",
                get(|| async { Json(json!({ "ok": true, "source": "test-stub" })) }),
            )
            .route(
                "/api/internal/runtime/execution-plans",
                post(
                    |State(state): State<ExecStubState>,
                     headers: HeaderMap,
                     Json(plan): Json<protocol::RuntimeExecutionPlan>| async move {
                        assert_eq!(
                            headers
                                .get("authorization")
                                .and_then(|value| value.to_str().ok()),
                            Some(state.expected_auth.as_str())
                        );
                        (
                            StatusCode::ACCEPTED,
                            Json(json!({
                                "ok": true,
                                "accepted": true,
                                "source": "test-stub",
                                "submitRequestId": "submit_runtime_123",
                                "coordination": {
                                    "planId": plan.plan_id,
                                    "deploymentId": plan.deployment_id,
                                    "runId": plan.run_id,
                                    "mode": plan.mode,
                                    "lane": plan.lane,
                                    "sliceCount": plan.slices.len(),
                                }
                            })),
                        )
                    },
                ),
            )
            .with_state(ExecStubState {
                expected_auth: "Bearer runtime-service-secret".to_string(),
            });
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("exec stub to serve");
        });
        format!("http://{address}")
    }

    fn runtime_deployment(
        deployment_id: &str,
        sleeve_id: &str,
        allocated_usd: &str,
        reserved_usd: &str,
    ) -> Value {
        runtime_deployment_with_strategy(
            deployment_id,
            sleeve_id,
            "dca",
            allocated_usd,
            reserved_usd,
        )
    }

    fn runtime_deployment_with_strategy(
        deployment_id: &str,
        sleeve_id: &str,
        strategy_key: &str,
        allocated_usd: &str,
        reserved_usd: &str,
    ) -> Value {
        json!({
            "schemaVersion": "v1",
            "deploymentId": deployment_id,
            "strategyKey": strategy_key,
            "sleeveId": sleeve_id,
            "ownerUserId": "user_123",
            "pair": {
                "symbol": "SOL/USDC",
                "baseMint": "So11111111111111111111111111111111111111112",
                "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            "mode": "shadow",
            "state": "shadow",
            "lane": "safe",
            "createdAt": "2026-03-07T00:00:00.000Z",
            "updatedAt": "2026-03-07T00:00:00.000Z",
            "policy": {
                "maxNotionalUsd": "250.00",
                "dailyLossLimitUsd": "35.00",
                "maxSlippageBps": 50,
                "maxConcurrentRuns": 2,
                "rebalanceToleranceBps": 100
            },
            "capital": {
                "allocatedUsd": allocated_usd,
                "reservedUsd": reserved_usd,
                "availableUsd": "0.00"
            },
            "tags": ["fixture"]
        })
    }

    fn runtime_feature_definition(feature_id: &str, feature_key: &str, status: &str) -> Value {
        json!({
            "schemaVersion": "v1",
            "featureId": feature_id,
            "featureKey": feature_key,
            "version": "1.0.0",
            "title": "Candidate feature definition",
            "summary": "Candidate feature definition published through the runtime operator surface.",
            "status": status,
            "marketType": "spot",
            "venueKeys": ["jupiter"],
            "assetKeys": ["SOL", "USDC"],
            "pairSymbols": ["SOL/USDC"],
            "inputRequirements": [
                {
                    "inputKey": "mid_price_usd",
                    "required": true,
                    "freshnessMs": 20000
                }
            ],
            "derivedFromFeatureKeys": [],
            "freshnessSloMs": 20000,
            "maxAllowedDriftBps": 50,
            "minCoverageBps": 9800,
            "provenance": {
                "generatedBy": "strategy-lab::feature-catalog",
                "generatedRevision": "candidate",
                "generatedAt": "2026-03-10T16:05:00.000Z"
            },
            "datasetSnapshots": [
                {
                    "datasetId": "dataset_feed_replay_sol_usdc_market_events",
                    "snapshotId": "snapshot_2026_03_07_seed",
                    "capturedAt": "2026-03-10T00:00:00.000Z",
                    "uri": "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
                    "contentDigest": "sha256:fixture"
                }
            ],
            "createdAt": "2026-03-10T16:05:00.000Z",
            "updatedAt": "2026-03-10T16:05:00.000Z",
            "tags": ["candidate", "signal"]
        })
    }

    fn runtime_regime_tag(regime_tag_id: &str, regime_key: &str, status: &str) -> Value {
        json!({
            "schemaVersion": "v1",
            "regimeTagId": regime_tag_id,
            "regimeKey": regime_key,
            "version": "1.0.0",
            "title": "Candidate regime tag",
            "summary": "Candidate regime tag published through the runtime operator surface.",
            "status": status,
            "dimension": "trend",
            "value": "confirmed",
            "marketType": "spot",
            "venueKeys": ["jupiter"],
            "assetKeys": ["SOL", "USDC"],
            "pairSymbols": ["SOL/USDC"],
            "sourceFeatureKeys": ["short_return_bps"],
            "freshnessSloMs": 20000,
            "maxAllowedDriftBps": 50,
            "minConfidenceBps": 8600,
            "provenance": {
                "generatedBy": "strategy-lab::regime-catalog",
                "generatedRevision": "candidate",
                "generatedAt": "2026-03-10T16:10:00.000Z"
            },
            "datasetSnapshots": [
                {
                    "datasetId": "dataset_feed_replay_sol_usdc_market_events",
                    "snapshotId": "snapshot_2026_03_07_seed",
                    "capturedAt": "2026-03-10T00:00:00.000Z",
                    "uri": "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
                    "contentDigest": "sha256:fixture"
                }
            ],
            "createdAt": "2026-03-10T16:10:00.000Z",
            "updatedAt": "2026-03-10T16:10:00.000Z",
            "tags": ["candidate", "signal"]
        })
    }

    async fn read_json(response: axum::response::Response) -> Value {
        let body = response
            .into_body()
            .collect()
            .await
            .expect("body to collect")
            .to_bytes();
        serde_json::from_slice(&body).expect("json payload")
    }

    #[tokio::test]
    async fn serves_health_endpoint() {
        let response = app(test_config())
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: RuntimeHealthResponse =
            serde_json::from_value(read_json(response).await).expect("health response");

        assert_eq!(payload.service_name, "runtime-rs");
        assert_eq!(payload.environment, "local");
        assert_eq!(payload.protocol_version, "v1");
        assert_eq!(payload.market_adapter_status, "healthy");
        assert_eq!(payload.feed_bootstrap_source, "synthetic-bootstrap");
        assert!(payload.feed_bootstrap_error.is_none());
        assert_eq!(payload.feature_cache.status, "healthy");
        assert_eq!(payload.feed_gateway.market_streams.len(), 1);
        assert_eq!(payload.feed_gateway.slot_commitments.len(), 3);
        assert_eq!(payload.feed_gateway.status, "healthy");
        assert_eq!(payload.strategy_registry.status, "healthy");
        assert_eq!(payload.strategy_registry.deployment_count, 0);
        assert_eq!(payload.research_registry.status, "healthy");
        assert_eq!(payload.research_registry.hypothesis_count, 0);
        assert_eq!(payload.asset_registry.status, "healthy");
        assert_eq!(payload.asset_registry.asset_count, 2);
        assert_eq!(payload.asset_registry.live_asset_count, 2);
        assert_eq!(payload.historical_data_lake.status, "healthy");
        assert_eq!(payload.historical_data_lake.dataset_snapshot_count, 2);
        assert_eq!(payload.historical_data_lake.replay_corpus_count, 1);
        assert_eq!(payload.feature_catalog_registry.status, "healthy");
        assert_eq!(payload.feature_catalog_registry.feature_definition_count, 4);
        assert_eq!(
            payload
                .feature_catalog_registry
                .active_feature_definition_count,
            4
        );
        assert_eq!(payload.feature_catalog_registry.regime_tag_count, 4);
        assert_eq!(payload.feature_catalog_registry.active_regime_tag_count, 4);
        assert_eq!(payload.cost_model_registry.status, "healthy");
        assert_eq!(payload.cost_model_registry.model_count, 3);
        assert_eq!(payload.cost_model_registry.active_model_count, 3);
        assert_eq!(payload.portfolio_ledger.status, "healthy");
        assert_eq!(payload.portfolio_ledger.deployment_count, 0);
        assert_eq!(payload.allocator.status, "healthy");
        assert_eq!(payload.allocator.decision_count, 0);
        assert_eq!(payload.risk_engine.status, "healthy");
        assert_eq!(payload.risk_engine.verdict_count, 0);
        assert_eq!(payload.execution_planner.status, "healthy");
        assert_eq!(payload.execution_planner.plan_count, 0);
        assert_eq!(payload.reconciler.status, "healthy");
        assert_eq!(payload.reconciler.reconciliation_count, 0);
        assert!(payload.internal_service_auth_configured);
    }

    #[tokio::test]
    async fn serves_metrics_endpoint() {
        let response = app(test_config())
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::OK);
        let payload: RuntimeMetricsResponse =
            serde_json::from_value(read_json(response).await).expect("metrics response");

        assert_eq!(payload.service_name, "runtime-rs");
        assert_eq!(payload.environment, "local");
        assert_eq!(payload.protocol_version, "v1");
        assert_eq!(payload.feed_bootstrap_source, "synthetic-bootstrap");
        assert_eq!(payload.feed_gateway.market_events_accepted, 1);
        assert_eq!(payload.feed_gateway.slot_events_accepted, 3);
        assert_eq!(payload.feature_cache.feature_streams.len(), 1);
        assert_eq!(payload.feature_cache.total_market_samples, 1);
        assert_eq!(payload.strategy_registry.status, "healthy");
        assert_eq!(payload.research_registry.status, "healthy");
        assert_eq!(payload.asset_registry.status, "healthy");
        assert_eq!(payload.asset_registry.asset_count, 2);
        assert_eq!(payload.historical_data_lake.status, "healthy");
        assert_eq!(payload.historical_data_lake.dataset_snapshot_count, 2);
        assert_eq!(payload.feature_catalog_registry.status, "healthy");
        assert_eq!(payload.feature_catalog_registry.feature_definition_count, 4);
        assert_eq!(payload.feature_catalog_registry.regime_tag_count, 4);
        assert_eq!(payload.cost_model_registry.status, "healthy");
        assert_eq!(payload.cost_model_registry.model_count, 3);
        assert_eq!(payload.portfolio_ledger.status, "healthy");
        assert_eq!(payload.allocator.status, "healthy");
        assert_eq!(payload.risk_engine.status, "healthy");
        assert_eq!(payload.execution_planner.status, "healthy");
        assert_eq!(payload.reconciler.status, "healthy");
    }

    #[tokio::test]
    async fn internal_routes_require_service_auth() {
        let response = app(test_config())
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            read_json(response).await,
            json!({
                "ok": false,
                "error": "auth-required",
                "details": {},
            })
        );
    }

    #[tokio::test]
    async fn stores_and_evaluates_shadow_deployments() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let router = app(test_config_with_worker_api_base(Some(&worker_api_base)));
        let deployment = runtime_deployment("deployment_123", "sleeve_alpha", "1000.00", "125.00");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);
        let create_payload = read_json(create_response).await;
        assert_eq!(
            create_payload["ledger"]["totals"]["reservedUsd"],
            json!("125.00")
        );

        let deployments_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(deployments_response.status(), StatusCode::OK);
        let deployments_payload = read_json(deployments_response).await;
        assert_eq!(
            deployments_payload["deployments"]
                .as_array()
                .expect("array")
                .len(),
            1
        );
        assert_eq!(
            deployments_payload["deployments"][0]["deploymentId"],
            json!("deployment_123")
        );

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_123/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(evaluation_payload["ok"], json!(true));
        assert_eq!(evaluation_payload["created"], json!(true));
        assert_eq!(evaluation_payload["run"]["state"], json!("completed"));
        assert_eq!(evaluation_payload["riskVerdict"]["verdict"], json!("allow"));
        assert_eq!(
            evaluation_payload["run"]["riskVerdictId"],
            evaluation_payload["riskVerdict"]["verdictId"]
        );
        assert_eq!(
            evaluation_payload["ledger"]["totals"]["reservedUsd"],
            json!("125.00")
        );
        assert_eq!(
            evaluation_payload["allocatorDecision"]["grantedReservedUsd"],
            json!("125.00")
        );
        assert_eq!(evaluation_payload["executionPlan"]["lane"], json!("safe"));
        assert_eq!(
            evaluation_payload["executionPlan"]["runId"],
            evaluation_payload["run"]["runId"]
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["deploymentId"],
            json!("deployment_123")
        );
        assert_eq!(
            evaluation_payload["run"]["submitRequestId"],
            json!("submit_runtime_123")
        );
        assert_eq!(
            evaluation_payload["run"]["receiptId"],
            evaluation_payload["reconciliation"]["receiptId"]
        );
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
        assert_eq!(
            evaluation_payload["coordination"]["submitRequestId"],
            json!("submit_runtime_123")
        );
        assert_eq!(
            evaluation_payload["reconciliation"]["status"],
            json!("passed")
        );
        assert_eq!(
            evaluation_payload["observedLedger"]["totals"]["equityUsd"],
            json!("1000.00")
        );

        let duplicate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_123/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(duplicate_response.status(), StatusCode::OK);
        let duplicate_payload = read_json(duplicate_response).await;
        assert_eq!(duplicate_payload["created"], json!(false));
        assert_eq!(
            duplicate_payload["run"]["runKey"],
            evaluation_payload["run"]["runKey"]
        );

        let runs_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/runs/deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(runs_response.status(), StatusCode::OK);
        let runs_payload = read_json(runs_response).await;
        assert_eq!(runs_payload["runs"].as_array().expect("array").len(), 1);

        let risk_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/risk?deploymentId=deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(risk_response.status(), StatusCode::OK);
        let risk_payload = read_json(risk_response).await;
        assert_eq!(risk_payload["verdicts"].as_array().expect("array").len(), 1);

        let plans_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/execution-plans?deploymentId=deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(plans_response.status(), StatusCode::OK);
        let plans_payload = read_json(plans_response).await;
        assert_eq!(plans_payload["plans"].as_array().expect("array").len(), 1);

        let reconciliations_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/reconciliations?deploymentId=deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(reconciliations_response.status(), StatusCode::OK);
        let reconciliations_payload = read_json(reconciliations_response).await;
        assert_eq!(
            reconciliations_payload["submitAttempts"]
                .as_array()
                .expect("array")
                .len(),
            1
        );
        assert_eq!(
            reconciliations_payload["receipts"]
                .as_array()
                .expect("array")
                .len(),
            1
        );
        assert_eq!(
            reconciliations_payload["walletObservations"]
                .as_array()
                .expect("array")
                .len(),
            1
        );
        assert_eq!(
            reconciliations_payload["results"]
                .as_array()
                .expect("array")
                .len(),
            1
        );

        let scorecards_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/scorecards?deploymentId=deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(scorecards_response.status(), StatusCode::OK);
        let scorecards_payload = read_json(scorecards_response).await;
        assert_eq!(
            scorecards_payload["report"]["scorecard"]["triggerQuality"]["totalRuns"],
            json!(1)
        );
        assert_eq!(
            scorecards_payload["report"]["scorecard"]["allocator"]["decisionCount"],
            json!(1)
        );
        assert_eq!(
            scorecards_payload["report"]["promotionGates"][0]["targetMode"],
            json!("paper")
        );
        assert!(scorecards_payload["report"]["proofArtifactMarkdown"]
            .as_str()
            .expect("markdown")
            .contains("Runtime Promotion Readiness"));

        let allocator_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/allocator?deploymentId=deployment_123")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(allocator_response.status(), StatusCode::OK);
        let allocator_payload = read_json(allocator_response).await;
        assert_eq!(allocator_payload["deploymentId"], json!("deployment_123"));
        assert_eq!(
            allocator_payload["currentDecision"]["deploymentId"],
            json!("deployment_123")
        );
        assert_eq!(allocator_payload["sleeve"]["availableUsd"], json!("875.00"));
    }

    #[tokio::test]
    async fn stores_and_queries_research_registry_records() {
        let router = app(test_config());

        let source_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/sources")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "sourceId": "source_paper_microstructure",
                            "sourceKind": "paper",
                            "title": "Microstructure signals for crypto execution",
                            "url": "https://example.com/papers/microstructure",
                            "canonicalUrl": "https://example.com/papers/microstructure",
                            "authors": ["Ada Researcher"],
                            "retrievedAt": "2026-03-10T14:00:00.000Z",
                            "contentDigest": "sha256:paper",
                            "provenance": {
                                "acquisitionKind": "paper_feed",
                                "collectedFrom": "https://example.com/feed/crypto.xml",
                                "hostname": "example.com",
                                "publisher": "Example Research",
                                "firstSeenAt": "2026-03-10T14:00:00.000Z",
                                "lastSeenAt": "2026-03-10T14:00:00.000Z"
                            },
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "tags": ["signal"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(source_response.status(), StatusCode::CREATED);

        let hypothesis_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/hypotheses")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "hypothesisId": "hypothesis_signal_trend",
                            "strategyKey": "trend_following",
                            "title": "Trend continuation after liquidity shocks",
                            "thesis": "High-quality liquidity shocks should resolve into short continuation bursts.",
                            "status": "candidate",
                            "createdAt": "2026-03-10T14:05:00.000Z",
                            "updatedAt": "2026-03-10T14:05:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [
                                {
                                    "sourceId": "source_paper_microstructure"
                                }
                            ],
                            "tags": ["candidate"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(hypothesis_response.status(), StatusCode::CREATED);

        let experiment_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/experiments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "experimentId": "experiment_signal_trend_shadow",
                            "hypothesisId": "hypothesis_signal_trend",
                            "strategyKey": "trend_following",
                            "status": "completed",
                            "createdAt": "2026-03-10T14:10:00.000Z",
                            "updatedAt": "2026-03-10T14:20:00.000Z",
                            "completedAt": "2026-03-10T14:20:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [
                                {
                                    "sourceId": "source_paper_microstructure"
                                }
                            ],
                            "codeRevision": {
                                "vcs": "git",
                                "repository": "github.com/GuiBibeau/serious-trader-ralph",
                                "revision": "356b539e3ec730663c4025b8f00cd6b47b823d1a",
                                "treeDirty": false
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_features_sol_usdc",
                                    "snapshotId": "snapshot_2026_03_10",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                }
                            ],
                            "artifacts": [],
                            "summary": "Shadow replay passed the initial trigger-quality gate.",
                            "tags": ["shadow"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(experiment_response.status(), StatusCode::CREATED);

        let evidence_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/evidence-bundles")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "evidenceBundleId": "evidence_signal_trend_shadow",
                            "experimentId": "experiment_signal_trend_shadow",
                            "strategyKey": "trend_following",
                            "status": "ready_for_review",
                            "promotionTarget": "shadow",
                            "createdAt": "2026-03-10T14:21:00.000Z",
                            "updatedAt": "2026-03-10T14:21:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [
                                {
                                    "sourceId": "source_paper_microstructure"
                                }
                            ],
                            "codeRevision": {
                                "vcs": "git",
                                "repository": "github.com/GuiBibeau/serious-trader-ralph",
                                "revision": "356b539e3ec730663c4025b8f00cd6b47b823d1a",
                                "treeDirty": false
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_features_sol_usdc",
                                    "snapshotId": "snapshot_2026_03_10",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                }
                            ],
                            "artifacts": [
                                {
                                    "artifactId": "proof-markdown",
                                    "kind": "proof-bundle",
                                    "uri": "r2://artifacts/proof-markdown.md"
                                }
                            ],
                            "summary": "Evidence bundle for shadow review.",
                            "tags": ["promotion"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evidence_response.status(), StatusCode::CREATED);

        let query_response = router
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/research?strategyKey=trend_following&venueKey=jupiter&assetKey=SOL&sourceId=source_paper_microstructure")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(query_response.status(), StatusCode::OK);
        let query_payload = read_json(query_response).await;
        assert_eq!(
            query_payload["registry"]["hypotheses"][0]["hypothesisId"],
            json!("hypothesis_signal_trend")
        );
        assert_eq!(
            query_payload["registry"]["experiments"][0]["experimentId"],
            json!("experiment_signal_trend_shadow")
        );
        assert_eq!(
            query_payload["registry"]["evidenceBundles"][0]["evidenceBundleId"],
            json!("evidence_signal_trend_shadow")
        );
    }

    #[tokio::test]
    async fn runs_backtests_and_requires_passing_reports_for_paper_evidence() {
        let router = app(test_config());

        for snapshot in [
            json!({
                "schemaVersion": "v1",
                "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                "snapshotId": "snapshot_2026_03_07_backtest",
                "datasetKind": "market_events",
                "normalizationKind": "replay_ready",
                "format": "fixture_json",
                "retentionClass": "research",
                "capturedAt": "2026-03-10T14:00:00.000Z",
                "coverageStartAt": "2026-03-07T00:00:00Z",
                "coverageEndAt": "2026-03-07T00:00:25Z",
                "rowCount": 6,
                "venueKeys": ["jupiter"],
                "assetKeys": ["SOL", "USDC"],
                "pairSymbols": ["SOL/USDC"],
                "chainKeys": ["solana-mainnet"],
                "uri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#marketEvents",
                "contentDigest": "sha256:feature-cache",
                "provenance": {
                    "acquisitionKind": "research_fixture",
                    "collectedFrom": "services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json",
                    "provider": "repo-fixture",
                    "collectedAt": "2026-03-10T14:00:00.000Z",
                    "generator": "strategy-lab-tests",
                    "generatorRevision": "seed",
                    "notes": "Test market-event snapshot."
                },
                "samplingNotes": "Full deterministic market-event fixture.",
                "compactionNotes": "No compaction applied.",
                "tags": ["research", "backtest"]
            }),
            json!({
                "schemaVersion": "v1",
                "datasetId": "dataset_feature_cache_sol_usdc_slot_events",
                "snapshotId": "snapshot_2026_03_07_backtest",
                "datasetKind": "slot_events",
                "normalizationKind": "replay_ready",
                "format": "fixture_json",
                "retentionClass": "research",
                "capturedAt": "2026-03-10T14:00:00.000Z",
                "coverageStartAt": "2026-03-07T00:00:23Z",
                "coverageEndAt": "2026-03-07T00:00:25Z",
                "rowCount": 3,
                "venueKeys": ["helius"],
                "assetKeys": ["SOL", "USDC"],
                "pairSymbols": ["SOL/USDC"],
                "chainKeys": ["solana-mainnet"],
                "uri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#slotEvents",
                "contentDigest": "sha256:feature-cache",
                "provenance": {
                    "acquisitionKind": "research_fixture",
                    "collectedFrom": "services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json",
                    "provider": "repo-fixture",
                    "collectedAt": "2026-03-10T14:00:00.000Z",
                    "generator": "strategy-lab-tests",
                    "generatorRevision": "seed",
                    "notes": "Test slot-event snapshot."
                },
                "samplingNotes": "Full deterministic slot-event fixture.",
                "compactionNotes": "No compaction applied.",
                "tags": ["research", "backtest"]
            }),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/internal/runtime/datasets/snapshots")
                        .header("authorization", "Bearer runtime-service-secret")
                        .header("content-type", "application/json")
                        .body(Body::from(snapshot.to_string()))
                        .expect("request"),
                )
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::CREATED);
        }

        let replay_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/datasets/replay-corpora")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "corpusId": "replay_corpus_sol_usdc_feature_cache",
                            "title": "SOL/USDC feature cache replay corpus",
                            "summary": "Deterministic replay corpus for runtime backtest coverage.",
                            "replayKind": "feed_gateway_v1",
                            "createdAt": "2026-03-10T14:00:00.000Z",
                            "updatedAt": "2026-03-10T14:00:00.000Z",
                            "venueKeys": ["jupiter", "helius"],
                            "assetKeys": ["SOL", "USDC"],
                            "pairSymbols": ["SOL/USDC"],
                            "chainKeys": ["solana-mainnet"],
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z",
                                    "uri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#marketEvents",
                                    "contentDigest": "sha256:feature-cache"
                                },
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_slot_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z",
                                    "uri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#slotEvents",
                                    "contentDigest": "sha256:feature-cache"
                                }
                            ],
                            "fixtureUri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json",
                            "contentDigest": "sha256:feature-cache",
                            "deterministicSeed": 100,
                            "tags": ["research", "backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(replay_response.status(), StatusCode::CREATED);

        let source_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/sources")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "sourceId": "source_strategy_lab_seed",
                            "sourceKind": "paper",
                            "title": "Deterministic backtest seed",
                            "url": "https://example.com/papers/seed",
                            "canonicalUrl": "https://example.com/papers/seed",
                            "authors": ["Ada Researcher"],
                            "retrievedAt": "2026-03-10T14:00:00.000Z",
                            "contentDigest": "sha256:seed",
                            "provenance": {
                                "acquisitionKind": "paper_feed",
                                "collectedFrom": "https://example.com/feed/seed.xml",
                                "hostname": "example.com",
                                "publisher": "Example Research",
                                "firstSeenAt": "2026-03-10T14:00:00.000Z",
                                "lastSeenAt": "2026-03-10T14:00:00.000Z"
                            },
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "tags": ["backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(source_response.status(), StatusCode::CREATED);

        let hypothesis_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/hypotheses")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "hypothesisId": "hypothesis_alloc_dca",
                            "strategyKey": "dca",
                            "title": "DCA replay confidence",
                            "thesis": "A deterministic upward replay should keep bounded accumulation positive.",
                            "status": "candidate",
                            "createdAt": "2026-03-10T14:05:00.000Z",
                            "updatedAt": "2026-03-10T14:05:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [{ "sourceId": "source_strategy_lab_seed" }],
                            "tags": ["backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(hypothesis_response.status(), StatusCode::CREATED);

        let experiment_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/experiments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "experimentId": "experiment_alloc_dca_backtest",
                            "hypothesisId": "hypothesis_alloc_dca",
                            "strategyKey": "dca",
                            "status": "completed",
                            "createdAt": "2026-03-10T14:10:00.000Z",
                            "updatedAt": "2026-03-10T14:20:00.000Z",
                            "completedAt": "2026-03-10T14:20:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [{ "sourceId": "source_strategy_lab_seed" }],
                            "codeRevision": {
                                "vcs": "git",
                                "repository": "github.com/GuiBibeau/serious-trader-ralph",
                                "revision": "356b539e3ec730663c4025b8f00cd6b47b823d1a",
                                "treeDirty": false
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z",
                                    "uri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#marketEvents",
                                    "contentDigest": "sha256:feature-cache"
                                },
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_slot_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z",
                                    "uri": "repo://services/runtime-rs/fixtures/runtime-feature-cache-replay.sol_usdc.v1.json#slotEvents",
                                    "contentDigest": "sha256:feature-cache"
                                }
                            ],
                            "artifacts": [],
                            "summary": "DCA backtest experiment ready for evaluation.",
                            "tags": ["backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(experiment_response.status(), StatusCode::CREATED);

        let cost_model_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/cost-models")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "modelId": "cost_model_jupiter_sol_usdc_spot_backtest",
                            "venueKey": "jupiter",
                            "marketType": "spot",
                            "pairSymbol": "SOL/USDC",
                            "instrumentId": "SOL/USDC",
                            "assetKeys": ["SOL", "USDC"],
                            "modeCoverage": ["shadow", "paper"],
                            "status": "active",
                            "assumptions": {
                                "feeBps": 0,
                                "slippageBps": 0,
                                "marketImpactBps": 0,
                                "partialFillRateBps": 0,
                                "partialFillPenaltyBps": 0
                            },
                            "calibration": {
                                "calibrationId": "calibration_jupiter_sol_usdc_spot_backtest",
                                "methodology": "backtest_bootstrap",
                                "sampleStartAt": "2026-03-01T00:00:00.000Z",
                                "sampleEndAt": "2026-03-10T14:00:00.000Z",
                                "sampleCount": 48,
                                "confidenceBps": 9100,
                                "referenceNotionalUsd": "25.00",
                                "tags": ["backtest"]
                            },
                            "driftGuard": {
                                "maxCostDriftBps": 50,
                                "maxLatencyDriftMs": 2500,
                                "maxReconciliationDriftUsd": "1.00"
                            },
                            "latencyProfile": {
                                "expectedQuoteMs": 100,
                                "expectedSubmitMs": 200,
                                "expectedSettlementMs": 1000
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                },
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_slot_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                }
                            ],
                            "createdAt": "2026-03-10T14:20:30.000Z",
                            "updatedAt": "2026-03-10T14:20:30.000Z",
                            "tags": ["backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(cost_model_response.status(), StatusCode::CREATED);

        let missing_backtest_evidence = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/evidence-bundles")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "evidenceBundleId": "evidence_alloc_dca_missing_backtest",
                            "experimentId": "experiment_alloc_dca_backtest",
                            "strategyKey": "dca",
                            "status": "ready_for_review",
                            "promotionTarget": "paper",
                            "createdAt": "2026-03-10T14:21:00.000Z",
                            "updatedAt": "2026-03-10T14:21:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [{ "sourceId": "source_strategy_lab_seed" }],
                            "codeRevision": {
                                "vcs": "git",
                                "repository": "github.com/GuiBibeau/serious-trader-ralph",
                                "revision": "356b539e3ec730663c4025b8f00cd6b47b823d1a",
                                "treeDirty": false
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                }
                            ],
                            "artifacts": [
                                {
                                    "artifactId": "proof-markdown",
                                    "kind": "proof-bundle",
                                    "uri": "r2://artifacts/proof-markdown.md"
                                }
                            ],
                            "summary": "Paper promotion without backtest evidence should fail.",
                            "tags": ["promotion"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            missing_backtest_evidence.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );

        let backtest_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/backtests")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "reportId": "backtest_alloc_dca_report",
                            "experimentId": "experiment_alloc_dca_backtest",
                            "replayCorpusId": "replay_corpus_sol_usdc_feature_cache",
                            "venueKey": "jupiter",
                            "pairSymbol": "SOL/USDC",
                            "marketType": "spot",
                            "windowMode": "rolling",
                            "trainingWindowObservations": 2,
                            "testingWindowObservations": 1,
                            "stepObservations": 1,
                            "purgeObservations": 0,
                            "baselineStrategies": ["flat_cash", "buy_and_hold"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(backtest_response.status(), StatusCode::CREATED);
        let backtest_payload = read_json(backtest_response).await;
        assert_eq!(
            backtest_payload["report"]["status"],
            json!("completed"),
            "{backtest_payload:?}"
        );
        assert_eq!(backtest_payload["report"]["promotionEligible"], json!(true));

        let mismatched_evidence_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/evidence-bundles")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "evidenceBundleId": "evidence_alloc_dca_wrong_backtest",
                            "experimentId": "experiment_alloc_dca_backtest",
                            "strategyKey": "trend_following",
                            "status": "ready_for_review",
                            "promotionTarget": "paper",
                            "createdAt": "2026-03-10T14:21:30.000Z",
                            "updatedAt": "2026-03-10T14:21:30.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [{ "sourceId": "source_strategy_lab_seed" }],
                            "codeRevision": {
                                "vcs": "git",
                                "repository": "github.com/GuiBibeau/serious-trader-ralph",
                                "revision": "356b539e3ec730663c4025b8f00cd6b47b823d1a",
                                "treeDirty": false
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                }
                            ],
                            "artifacts": [
                                {
                                    "artifactId": "backtest-report",
                                    "kind": "backtest-report",
                                    "uri": "runtime-backtest://backtest_alloc_dca_report"
                                }
                            ],
                            "summary": "Paper promotion with a mismatched backtest report should fail.",
                            "tags": ["promotion", "backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(
            mismatched_evidence_response.status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mismatched_evidence_payload = read_json(mismatched_evidence_response).await;
        assert_eq!(
            mismatched_evidence_payload["error"],
            json!("backtest-report-mismatch")
        );

        let evidence_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/research/evidence-bundles")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "schemaVersion": "v1",
                            "evidenceBundleId": "evidence_alloc_dca_paper",
                            "experimentId": "experiment_alloc_dca_backtest",
                            "strategyKey": "dca",
                            "status": "ready_for_review",
                            "promotionTarget": "paper",
                            "createdAt": "2026-03-10T14:22:00.000Z",
                            "updatedAt": "2026-03-10T14:22:00.000Z",
                            "venueKeys": ["jupiter"],
                            "assetKeys": ["SOL", "USDC"],
                            "sourceCitations": [{ "sourceId": "source_strategy_lab_seed" }],
                            "codeRevision": {
                                "vcs": "git",
                                "repository": "github.com/GuiBibeau/serious-trader-ralph",
                                "revision": "356b539e3ec730663c4025b8f00cd6b47b823d1a",
                                "treeDirty": false
                            },
                            "datasetSnapshots": [
                                {
                                    "datasetId": "dataset_feature_cache_sol_usdc_market_events",
                                    "snapshotId": "snapshot_2026_03_07_backtest",
                                    "capturedAt": "2026-03-10T14:00:00.000Z"
                                }
                            ],
                            "artifacts": [
                                {
                                    "artifactId": "backtest-report",
                                    "kind": "backtest-report",
                                    "uri": "runtime-backtest://backtest_alloc_dca_report"
                                }
                            ],
                            "summary": "Paper promotion backed by a passing backtest report.",
                            "tags": ["promotion", "backtest"]
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evidence_response.status(), StatusCode::CREATED);
    }

    #[tokio::test]
    async fn threshold_rebalance_can_complete_without_coordination_when_inside_tolerance() {
        let state = RuntimeAppState::new(test_config());
        let deployment: RuntimeDeploymentRecord =
            serde_json::from_value(runtime_deployment_with_strategy(
                "deployment_rebalance_noop",
                "sleeve_alpha",
                "threshold_rebalance",
                "100.00",
                "5.00",
            ))
            .expect("deployment");
        state
            .strategy_registry
            .upsert_deployment(&deployment)
            .expect("deployment to store");
        state
            .portfolio_ledger
            .sync_deployment(&deployment)
            .expect("ledger to sync");
        state
            .portfolio_ledger
            .apply_observed_snapshot(
                "deployment_rebalance_noop",
                &serde_json::from_value(json!({
                    "schemaVersion": "v1",
                    "snapshotId": "wallet_threshold_noop",
                    "deploymentId": "deployment_rebalance_noop",
                    "sleeveId": "sleeve_alpha",
                    "asOf": "2026-03-10T03:15:00Z",
                    "balances": [
                        {
                            "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                            "symbol": "USDC",
                            "decimals": 6,
                            "freeAtomic": "45500000",
                            "reservedAtomic": "5000000",
                            "priceUsd": "1.00"
                        },
                        {
                            "mint": "So11111111111111111111111111111111111111112",
                            "symbol": "SOL",
                            "decimals": 9,
                            "freeAtomic": "330000000",
                            "reservedAtomic": "0",
                            "priceUsd": "150.00"
                        }
                    ],
                    "positions": [
                        {
                            "instrumentId": "SOL/USDC",
                            "side": "long",
                            "quantityAtomic": "330000000",
                            "entryPriceUsd": "149.00",
                            "markPriceUsd": "150.00",
                            "unrealizedPnlUsd": "0.33"
                        }
                    ],
                    "totals": {
                        "equityUsd": "100.00",
                        "reservedUsd": "5.00",
                        "availableUsd": "95.00",
                        "realizedPnlUsd": "0.00",
                        "unrealizedPnlUsd": "0.00"
                    }
                }))
                .expect("observed snapshot"),
            )
            .expect("observed snapshot to apply");

        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer runtime-service-secret"),
        );
        let (status, Json(evaluation_payload)) = evaluate_deployment_handler(
            headers,
            Path("deployment_rebalance_noop".to_string()),
            State(state),
            Bytes::from_static(b"{}"),
        )
        .await
        .expect("response");

        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(evaluation_payload["run"]["state"], json!("completed"));
        assert_eq!(evaluation_payload["coordination"], Value::Null);
        assert_eq!(evaluation_payload["reconciliation"], Value::Null);
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("rebalance")
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["inputAmountAtomic"],
            json!("0")
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["notionalUsd"],
            json!("0.00")
        );
    }

    #[tokio::test]
    async fn twap_deployments_use_sliced_notional_coordination() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let router = app(test_config_with_worker_api_base(Some(&worker_api_base)));
        let deployment = runtime_deployment_with_strategy(
            "deployment_twap",
            "sleeve_alpha",
            "twap",
            "1000.00",
            "5.00",
        );

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_twap/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(evaluation_payload["run"]["state"], json!("completed"));
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("buy")
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["notionalUsd"],
            json!("2.50")
        );
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
        assert_eq!(
            evaluation_payload["coordination"]["submitRequestId"],
            json!("submit_runtime_123")
        );
    }

    #[tokio::test]
    async fn trend_following_replay_buys_in_shadow_mode() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let fixture_path = write_replay_fixture("trend-up", &["140.00", "141.20", "142.80"]);
        let router = app(test_config_with_runtime(
            Some(&worker_api_base),
            Some(&fixture_path),
        ));
        let deployment = runtime_deployment_with_strategy(
            "deployment_trend_shadow",
            "sleeve_alpha",
            "trend_following",
            "1000.00",
            "5.00",
        );

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_trend_shadow/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("buy")
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["simulateOnly"],
            json!(true)
        );
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
    }

    #[tokio::test]
    async fn mean_reversion_replay_sells_in_paper_mode() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let fixture_path = write_replay_fixture("mean-up", &["140.00", "141.20", "142.80"]);
        let router = app(test_config_with_runtime(
            Some(&worker_api_base),
            Some(&fixture_path),
        ));
        let mut deployment = runtime_deployment_with_strategy(
            "deployment_mean_paper",
            "sleeve_alpha",
            "mean_reversion",
            "1000.00",
            "5.00",
        );
        deployment["mode"] = json!("paper");
        deployment["state"] = json!("paper");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_mean_paper/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("sell")
        );
        assert_eq!(evaluation_payload["executionPlan"]["dryRun"], json!(true));
        assert_eq!(
            evaluation_payload["executionPlan"]["simulateOnly"],
            json!(false)
        );
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
        assert_eq!(
            evaluation_payload["coordination"]["source"],
            json!("runtime-rs-paper")
        );
        assert_eq!(
            evaluation_payload["reconciliation"]["receiptId"],
            evaluation_payload["coordination"]["receipt"]["receiptId"]
        );
        assert_eq!(
            evaluation_payload["observedLedger"]["deploymentId"],
            json!("deployment_mean_paper")
        );
    }

    #[tokio::test]
    async fn paper_runs_emit_auditable_execution_artifacts() {
        let fixture_path = write_replay_fixture("paper-auditable", &["140.00", "140.40", "140.80"]);
        let router = app(test_config_with_runtime(None, Some(&fixture_path)));
        let mut deployment = runtime_deployment(
            "deployment_auditable_paper",
            "sleeve_alpha",
            "1000.00",
            "5.00",
        );
        deployment["mode"] = json!("paper");
        deployment["state"] = json!("paper");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_auditable_paper/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["coordination"]["source"],
            json!("runtime-rs-paper")
        );
        assert_eq!(
            evaluation_payload["coordination"]["receipt"]["status"],
            json!("filled")
        );
        assert!(evaluation_payload["coordination"]["receipt"]["notes"]
            .as_array()
            .expect("receipt notes")
            .iter()
            .any(|note| note == "paper-profile:jupiter"));
        assert_eq!(
            evaluation_payload["reconciliation"]["status"],
            json!("passed")
        );

        let reconciliations_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(
                        "/api/internal/runtime/reconciliations?deploymentId=deployment_auditable_paper",
                    )
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(reconciliations_response.status(), StatusCode::OK);
        let reconciliations_payload = read_json(reconciliations_response).await;
        assert_eq!(
            reconciliations_payload["receipts"][0]["source"],
            json!("runtime-rs-paper")
        );
        assert_eq!(
            reconciliations_payload["results"][0]["receiptId"],
            evaluation_payload["coordination"]["receipt"]["receiptId"]
        );

        let positions_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/positions?deploymentId=deployment_auditable_paper")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(positions_response.status(), StatusCode::OK);
        let positions_payload = read_json(positions_response).await;
        assert_eq!(
            positions_payload["snapshot"]["deploymentId"],
            json!("deployment_auditable_paper")
        );
        assert!(positions_payload["snapshot"]["positions"]
            .as_array()
            .expect("positions")
            .iter()
            .any(|position| position["instrumentId"] == "SOL/USDC"));
    }

    #[tokio::test]
    async fn trend_following_replay_sells_on_bounded_live_path() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let fixture_path = write_replay_fixture("trend-down", &["142.80", "141.20", "140.00"]);
        let router = app(test_config_with_runtime(
            Some(&worker_api_base),
            Some(&fixture_path),
        ));
        let mut deployment = runtime_deployment_with_strategy(
            "deployment_trend_live",
            "sleeve_alpha",
            "trend_following",
            "1000.00",
            "5.00",
        );
        deployment["mode"] = json!("live");
        deployment["state"] = json!("live");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_trend_live/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("sell")
        );
        assert_eq!(evaluation_payload["executionPlan"]["dryRun"], json!(false));
        assert_eq!(
            evaluation_payload["executionPlan"]["simulateOnly"],
            json!(false)
        );
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
    }

    #[tokio::test]
    async fn breakout_replay_buys_in_shadow_mode() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let fixture_path = write_replay_fixture("breakout-up", &["140.00", "141.80", "144.60"]);
        let router = app(test_config_with_runtime(
            Some(&worker_api_base),
            Some(&fixture_path),
        ));
        let deployment = runtime_deployment_with_strategy(
            "deployment_breakout_shadow",
            "sleeve_alpha",
            "breakout",
            "1000.00",
            "5.00",
        );

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_breakout_shadow/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("buy")
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["simulateOnly"],
            json!(true)
        );
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
    }

    #[tokio::test]
    async fn macro_rotation_replay_sells_in_paper_mode() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let fixture_path = write_replay_fixture("macro-down", &["144.60", "141.80", "140.00"]);
        let router = app(test_config_with_runtime(
            Some(&worker_api_base),
            Some(&fixture_path),
        ));
        let mut deployment = runtime_deployment_with_strategy(
            "deployment_macro_paper",
            "sleeve_alpha",
            "macro_rotation",
            "1000.00",
            "5.00",
        );
        deployment["mode"] = json!("paper");
        deployment["state"] = json!("paper");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_macro_paper/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("sell")
        );
        assert_eq!(evaluation_payload["executionPlan"]["dryRun"], json!(true));
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
    }

    #[tokio::test]
    async fn volatility_target_replay_sells_on_bounded_live_path() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let fixture_path = write_replay_fixture(
            "vol-target-live",
            &["140.00", "150.00", "136.00", "151.00", "135.00"],
        );
        let state = RuntimeAppState::new(test_config_with_runtime(
            Some(&worker_api_base),
            Some(&fixture_path),
        ));
        let mut deployment = runtime_deployment_with_strategy(
            "deployment_vol_target_live",
            "sleeve_alpha",
            "volatility_target",
            "1000.00",
            "5.00",
        );
        deployment["mode"] = json!("live");
        deployment["state"] = json!("live");
        let deployment: RuntimeDeploymentRecord =
            serde_json::from_value(deployment).expect("deployment");
        state
            .strategy_registry
            .upsert_deployment(&deployment)
            .expect("deployment to store");
        state
            .portfolio_ledger
            .sync_deployment(&deployment)
            .expect("ledger to sync");
        let observed_ledger: protocol::RuntimeLedgerSnapshot = serde_json::from_value(json!({
            "schemaVersion": "v1",
            "snapshotId": "wallet_vol_target_live_1",
            "deploymentId": "deployment_vol_target_live",
            "sleeveId": "sleeve_alpha",
            "asOf": "2026-03-10T19:00:10Z",
            "balances": [
                {
                    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    "symbol": "USDC",
                    "decimals": 6,
                    "freeAtomic": "35000000",
                    "reservedAtomic": "5000000",
                    "priceUsd": "1.00"
                },
                {
                    "mint": "So11111111111111111111111111111111111111112",
                    "symbol": "SOL",
                    "decimals": 9,
                    "freeAtomic": "400000000",
                    "reservedAtomic": "0",
                    "priceUsd": "150.00"
                }
            ],
            "positions": [
                {
                    "instrumentId": "SOL/USDC",
                    "side": "long",
                    "quantityAtomic": "400000000",
                    "entryPriceUsd": "149.00",
                    "markPriceUsd": "150.00",
                    "unrealizedPnlUsd": "0.40"
                }
            ],
            "totals": {
                "equityUsd": "100.00",
                "reservedUsd": "5.00",
                "availableUsd": "95.00",
                "realizedPnlUsd": "0.00",
                "unrealizedPnlUsd": "0.40"
            }
        }))
        .expect("observed ledger");
        state
            .portfolio_ledger
            .apply_observed_snapshot("deployment_vol_target_live", &observed_ledger)
            .expect("observed snapshot to apply");

        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer runtime-service-secret"),
        );
        let (status, Json(evaluation_payload)) = evaluate_deployment_handler(
            headers,
            Path("deployment_vol_target_live".to_string()),
            State(state),
            Bytes::from(
                json!({
                    "observedLedgerSnapshot": observed_ledger,
                })
                .to_string(),
            ),
        )
        .await
        .expect("response");

        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["action"],
            json!("rebalance")
        );
        assert_eq!(
            evaluation_payload["executionPlan"]["slices"][0]["inputMint"],
            json!("So11111111111111111111111111111111111111112")
        );
        assert_eq!(evaluation_payload["executionPlan"]["dryRun"], json!(false));
        assert_eq!(evaluation_payload["coordination"]["accepted"], json!(true));
    }

    #[tokio::test]
    async fn applies_small_reconciliation_drift_corrections() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let router = app(test_config_with_worker_api_base(Some(&worker_api_base)));
        let deployment =
            runtime_deployment("deployment_drift", "sleeve_alpha", "1000.00", "125.00");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_drift/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "observedLedgerSnapshot": {
                                "schemaVersion": "v1",
                                "snapshotId": "wallet_drift_1",
                                "deploymentId": "deployment_drift",
                                "sleeveId": "sleeve_alpha",
                                "asOf": "2026-03-08T15:00:10Z",
                                "balances": [
                                    {
                                        "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                                        "symbol": "USDC",
                                        "decimals": 6,
                                        "freeAtomic": "874500000",
                                        "reservedAtomic": "125000000",
                                        "priceUsd": "1.00"
                                    }
                                ],
                                "positions": [],
                                "totals": {
                                    "equityUsd": "999.50",
                                    "reservedUsd": "125.00",
                                    "availableUsd": "874.50",
                                    "realizedPnlUsd": "0.00",
                                    "unrealizedPnlUsd": "0.00"
                                }
                            }
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(
            evaluation_payload["reconciliation"]["correctionApplied"],
            json!(true)
        );
        assert_eq!(
            evaluation_payload["ledger"]["totals"]["equityUsd"],
            json!("999.50")
        );
        assert_eq!(
            evaluation_payload["ledger"]["totals"]["availableUsd"],
            json!("874.50")
        );
        assert_eq!(evaluation_payload["run"]["state"], json!("completed"));
    }

    #[tokio::test]
    async fn runtime_canary_reconciles_against_observed_ledger() {
        let worker_api_base = spawn_exec_coordination_stub().await;
        let router = app(test_config_with_worker_api_base(Some(&worker_api_base)));
        let mut deployment =
            runtime_deployment("runtime_canary_live_dca", "sleeve_alpha", "25.00", "5.00");
        deployment["mode"] = json!("live");
        deployment["state"] = json!("live");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/runtime_canary_live_dca/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "trigger": {
                                "kind": "canary",
                                "source": "worker-runtime-canary",
                                "observedAt": "2026-03-10T01:03:10Z",
                                "reason": "post_deploy"
                            },
                            "observedLedgerSnapshot": {
                                "schemaVersion": "v1",
                                "snapshotId": "runtime_canary_wallet_1",
                                "deploymentId": "runtime_canary_live_dca",
                                "sleeveId": "sleeve_runtime_canary",
                                "asOf": "2026-03-10T01:03:19Z",
                                "balances": [
                                    {
                                        "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                                        "symbol": "USDC",
                                        "decimals": 6,
                                        "freeAtomic": "79865010",
                                        "reservedAtomic": "5000000",
                                        "priceUsd": "1.00"
                                    },
                                    {
                                        "mint": "So11111111111111111111111111111111111111112",
                                        "symbol": "SOL",
                                        "decimals": 9,
                                        "freeAtomic": "1000000000",
                                        "reservedAtomic": "0",
                                        "priceUsd": "85.65"
                                    }
                                ],
                                "positions": [
                                    {
                                        "instrumentId": "SOL/USDC",
                                        "side": "long",
                                        "quantityAtomic": "1000000000",
                                        "entryPriceUsd": "85.65",
                                        "markPriceUsd": "85.65",
                                        "unrealizedPnlUsd": "0.00"
                                    }
                                ],
                                "totals": {
                                    "equityUsd": "170.52",
                                    "reservedUsd": "5.00",
                                    "availableUsd": "165.52",
                                    "realizedPnlUsd": "0.00",
                                    "unrealizedPnlUsd": "0.00"
                                }
                            }
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(evaluation_payload["ok"], json!(true));
        assert_eq!(
            evaluation_payload["reconciliation"]["status"],
            json!("passed")
        );
        assert_eq!(evaluation_payload["run"]["state"], json!("completed"));
        assert_eq!(
            evaluation_payload["ledger"]["totals"]["equityUsd"],
            json!("25.00")
        );
        assert_eq!(
            evaluation_payload["observedLedger"]["totals"]["equityUsd"],
            json!("170.52")
        );
    }

    #[tokio::test]
    async fn rejects_runs_when_risk_limits_fail() {
        let router = app(test_config());
        let deployment =
            runtime_deployment("deployment_reject", "sleeve_alpha", "1000.00", "300.00");

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_reject/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(evaluation_payload["run"]["state"], json!("rejected"));
        assert_eq!(
            evaluation_payload["riskVerdict"]["verdict"],
            json!("reject")
        );
        assert_eq!(
            evaluation_payload["run"]["failureCode"],
            json!("requested_notional_exceeded")
        );
        assert_eq!(evaluation_payload["executionPlan"], json!(null));
    }

    #[tokio::test]
    async fn kill_switch_tags_pause_the_deployment() {
        let router = app(test_config());
        let mut deployment =
            runtime_deployment("deployment_pause", "sleeve_alpha", "1000.00", "125.00");
        deployment["tags"] = json!(["fixture", "runtime:kill-switch"]);

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let evaluate_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments/deployment_pause/evaluate")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(evaluate_response.status(), StatusCode::CREATED);
        let evaluation_payload = read_json(evaluate_response).await;
        assert_eq!(evaluation_payload["run"]["state"], json!("killed"));
        assert_eq!(evaluation_payload["riskVerdict"]["verdict"], json!("pause"));
        assert_eq!(evaluation_payload["deployment"]["state"], json!("paused"));
        assert_eq!(evaluation_payload["executionPlan"], json!(null));
    }

    #[tokio::test]
    async fn serves_real_ledger_snapshots_and_rolls_back_conflicts() {
        let router = app(test_config());

        let create_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        runtime_deployment("deployment_alpha", "sleeve_alpha", "100.00", "60.00")
                            .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(create_response.status(), StatusCode::CREATED);

        let positions_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/positions?deploymentId=deployment_alpha")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(positions_response.status(), StatusCode::OK);
        let positions_payload = read_json(positions_response).await;
        assert_eq!(
            positions_payload["snapshot"]["totals"]["reservedUsd"],
            json!("60.00")
        );
        assert_eq!(
            positions_payload["snapshot"]["totals"]["availableUsd"],
            json!("40.00")
        );

        let pnl_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/pnl?deploymentId=deployment_alpha")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(pnl_response.status(), StatusCode::OK);
        let pnl_payload = read_json(pnl_response).await;
        assert_eq!(pnl_payload["totals"]["equityUsd"], json!("100.00"));
        assert_eq!(pnl_payload["totals"]["reservedUsd"], json!("60.00"));

        let conflict_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        runtime_deployment("deployment_beta", "sleeve_alpha", "50.00", "50.00")
                            .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(conflict_response.status(), StatusCode::CONFLICT);
        assert_eq!(
            read_json(conflict_response).await["error"],
            json!("sleeve-oversubscribed")
        );

        let missing_response = router
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/deployments/deployment_beta")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(missing_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn serves_asset_registry_and_transitions_assets() {
        let router = app(test_config());
        let asset = json!({
            "schemaVersion": "v1",
            "assetKey": "BONK",
            "displayName": "Bonk",
            "symbol": "BONK",
            "chainKey": "solana-mainnet",
            "canonicalId": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            "assetKind": "token",
            "riskClass": "volatile",
            "listingState": "candidate",
            "decimals": 5,
            "aliases": ["Bonk Inu"],
            "quoteAssetKeys": ["USDC"],
            "venueMappings": [
                {
                    "venueKey": "jupiter",
                    "nativeId": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
                    "venueSymbol": "BONK",
                    "decimals": 5,
                    "listingState": "candidate",
                    "quoteAssetKeys": ["USDC"],
                    "priceDecimals": 8,
                    "sizeDecimals": 5,
                    "minNotionalUsd": "0.10"
                }
            ],
            "createdAt": "2026-03-10T14:25:00.000Z",
            "updatedAt": "2026-03-10T14:25:00.000Z",
            "tags": ["candidate", "meme"]
        });

        let write_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/assets")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(asset.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(write_response.status(), StatusCode::CREATED);
        let write_payload = read_json(write_response).await;
        assert_eq!(write_payload["asset"]["assetKey"], json!("BONK"));
        assert_eq!(write_payload["asset"]["listingState"], json!("candidate"));

        let list_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/assets?assetKey=BONK&venueKey=jupiter")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(list_response.status(), StatusCode::OK);
        let list_payload = read_json(list_response).await;
        assert_eq!(
            list_payload["registry"]["assets"]
                .as_array()
                .expect("array")
                .len(),
            1
        );
        assert_eq!(
            list_payload["registry"]["assets"][0]["assetKey"],
            json!("BONK")
        );

        let transition_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/assets/BONK/transition")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "listingState": "paper",
                            "changedAt": "2026-03-10T14:30:00.000Z"
                        })
                        .to_string(),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(transition_response.status(), StatusCode::OK);
        let transition_payload = read_json(transition_response).await;
        assert_eq!(transition_payload["asset"]["assetKey"], json!("BONK"));
        assert_eq!(transition_payload["asset"]["listingState"], json!("paper"));
        assert_eq!(
            transition_payload["asset"]["updatedAt"],
            json!("2026-03-10T14:30:00.000Z")
        );
    }

    #[tokio::test]
    async fn serves_historical_data_lake_and_accepts_replay_writes() {
        let router = app(test_config());

        let list_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/datasets?datasetId=dataset_feed_replay_sol_usdc_market_events&snapshotId=snapshot_2026_03_07_seed&corpusId=replay_corpus_sol_usdc_feed_gateway_seed&venueKey=jupiter&assetKey=SOL&datasetKind=market_events")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(list_response.status(), StatusCode::OK);
        let list_payload = read_json(list_response).await;
        assert_eq!(
            list_payload["registry"]["datasetSnapshots"][0]["datasetId"],
            json!("dataset_feed_replay_sol_usdc_market_events")
        );
        assert_eq!(
            list_payload["registry"]["replayCorpora"][0]["corpusId"],
            json!("replay_corpus_sol_usdc_feed_gateway_seed")
        );

        let dataset_snapshot = json!({
            "schemaVersion": "v1",
            "datasetId": "dataset_feed_replay_sol_usdc_trades",
            "snapshotId": "snapshot_2026_03_10_candidate",
            "datasetKind": "trades",
            "normalizationKind": "normalized",
            "format": "jsonl",
            "retentionClass": "research",
            "capturedAt": "2026-03-10T15:00:00.000Z",
            "coverageStartAt": "2026-03-10T14:00:00.000Z",
            "coverageEndAt": "2026-03-10T15:00:00.000Z",
            "rowCount": 64,
            "venueKeys": ["jupiter"],
            "assetKeys": ["SOL", "USDC"],
            "pairSymbols": ["SOL/USDC"],
            "chainKeys": ["solana-mainnet"],
            "uri": "r2://datasets/trades/sol-usdc/2026-03-10.jsonl",
            "contentDigest": "sha256:trades",
            "compression": "gzip",
            "provenance": {
                "acquisitionKind": "exchange_export",
                "collectedFrom": "https://api.jupiter.test.local/export/trades",
                "provider": "jupiter",
                "collectedAt": "2026-03-10T15:00:00.000Z"
            },
            "tags": ["research", "candidate"]
        });
        let write_dataset_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/datasets/snapshots")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(dataset_snapshot.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(write_dataset_response.status(), StatusCode::CREATED);
        let write_dataset_payload = read_json(write_dataset_response).await;
        assert_eq!(
            write_dataset_payload["datasetSnapshot"]["datasetId"],
            json!("dataset_feed_replay_sol_usdc_trades")
        );

        let replay_corpus = json!({
            "schemaVersion": "v1",
            "corpusId": "replay_corpus_sol_usdc_candidate",
            "title": "Candidate replay corpus",
            "summary": "Corpus for candidate walk-forward runs.",
            "replayKind": "feed_gateway_v1",
            "createdAt": "2026-03-10T15:01:00.000Z",
            "updatedAt": "2026-03-10T15:01:00.000Z",
            "venueKeys": ["jupiter"],
            "assetKeys": ["SOL", "USDC"],
            "pairSymbols": ["SOL/USDC"],
            "chainKeys": ["solana-mainnet"],
            "datasetSnapshots": [
                {
                    "datasetId": "dataset_feed_replay_sol_usdc_trades",
                    "snapshotId": "snapshot_2026_03_10_candidate",
                    "capturedAt": "2026-03-10T15:00:00.000Z",
                    "uri": "r2://datasets/trades/sol-usdc/2026-03-10.jsonl",
                    "contentDigest": "sha256:trades"
                }
            ],
            "deterministicSeed": 42,
            "tags": ["candidate"]
        });
        let write_replay_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/datasets/replay-corpora")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(replay_corpus.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(write_replay_response.status(), StatusCode::CREATED);
        let write_replay_payload = read_json(write_replay_response).await;
        assert_eq!(
            write_replay_payload["replayCorpus"]["corpusId"],
            json!("replay_corpus_sol_usdc_candidate")
        );
    }

    #[tokio::test]
    async fn serves_cost_model_registry_and_accepts_writes() {
        let router = app(test_config());

        let list_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/cost-models?venueKey=jupiter&assetKey=SOL&pairSymbol=SOL%2FUSDC&marketType=spot&mode=paper")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(list_response.status(), StatusCode::OK);
        let list_payload = read_json(list_response).await;
        assert_eq!(
            list_payload["registry"]["costModels"][0]["modelId"],
            json!("cost_model_jupiter_sol_usdc_spot")
        );

        let cost_model = json!({
            "schemaVersion": "v1",
            "modelId": "cost_model_jupiter_sol_usdc_candidate",
            "venueKey": "jupiter",
            "marketType": "spot",
            "pairSymbol": "SOL/USDC",
            "instrumentId": "SOL/USDC",
            "assetKeys": ["SOL", "USDC"],
            "modeCoverage": ["shadow", "paper"],
            "status": "draft",
            "assumptions": {
                "feeBps": 10,
                "slippageBps": 30,
                "marketImpactBps": 15,
                "partialFillRateBps": 50,
                "partialFillPenaltyBps": 10
            },
            "calibration": {
                "calibrationId": "calibration_jupiter_sol_usdc_candidate",
                "methodology": "candidate_bootstrap",
                "sampleStartAt": "2026-03-01T00:00:00.000Z",
                "sampleEndAt": "2026-03-10T15:05:00.000Z",
                "sampleCount": 64,
                "confidenceBps": 8800,
                "referenceNotionalUsd": "25.00",
                "tags": ["candidate", "spot"]
            },
            "driftGuard": {
                "maxCostDriftBps": 60,
                "maxLatencyDriftMs": 3000,
                "maxReconciliationDriftUsd": "1.25"
            },
            "latencyProfile": {
                "expectedQuoteMs": 275,
                "expectedSubmitMs": 800,
                "expectedSettlementMs": 5500
            },
            "datasetSnapshots": [
                {
                    "datasetId": "dataset_feed_replay_sol_usdc_market_events",
                    "snapshotId": "snapshot_2026_03_07_seed",
                    "capturedAt": "2026-03-10T00:00:00.000Z",
                    "uri": "repo://services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json#marketEvents",
                    "contentDigest": "sha256:fixture"
                }
            ],
            "createdAt": "2026-03-10T15:05:00.000Z",
            "updatedAt": "2026-03-10T15:05:00.000Z",
            "tags": ["candidate", "spot"]
        });

        let write_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/cost-models")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(cost_model.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(write_response.status(), StatusCode::CREATED);
        let write_payload = read_json(write_response).await;
        assert_eq!(
            write_payload["costModel"]["modelId"],
            json!("cost_model_jupiter_sol_usdc_candidate")
        );
        assert_eq!(write_payload["costModel"]["status"], json!("draft"));
    }

    #[tokio::test]
    async fn serves_feature_catalog_registry_and_accepts_writes() {
        let router = app(test_config());

        let list_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/features?venueKey=jupiter&assetKey=SOL&pairSymbol=SOL%2FUSDC&marketType=spot&status=active")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(list_response.status(), StatusCode::OK);
        let list_payload = read_json(list_response).await;
        let feature_ids = list_payload["registry"]["featureDefinitions"]
            .as_array()
            .expect("feature definitions")
            .iter()
            .map(|entry| entry["featureId"].as_str().expect("featureId").to_string())
            .collect::<Vec<_>>();
        let regime_tag_ids = list_payload["registry"]["regimeTags"]
            .as_array()
            .expect("regime tags")
            .iter()
            .map(|entry| {
                entry["regimeTagId"]
                    .as_str()
                    .expect("regimeTagId")
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert!(feature_ids.contains(&"feature_long_return_bps_v1".to_string()));
        assert!(regime_tag_ids.contains(&"regime_liquidity_state_v1".to_string()));

        let feature_definition = runtime_feature_definition(
            "feature_microprice_delta_bps_v1",
            "microprice_delta_bps",
            "draft",
        );
        let feature_write_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/features/definitions")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(feature_definition.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(feature_write_response.status(), StatusCode::CREATED);
        let feature_write_payload = read_json(feature_write_response).await;
        assert_eq!(
            feature_write_payload["featureDefinition"]["featureId"],
            json!("feature_microprice_delta_bps_v1")
        );
        assert_eq!(
            feature_write_payload["featureDefinition"]["status"],
            json!("draft")
        );

        let regime_tag = runtime_regime_tag(
            "regime_microprice_confirmation_v1",
            "microprice_confirmation",
            "draft",
        );
        let regime_write_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/features/regime-tags")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(regime_tag.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(regime_write_response.status(), StatusCode::CREATED);
        let regime_write_payload = read_json(regime_write_response).await;
        assert_eq!(
            regime_write_payload["regimeTag"]["regimeTagId"],
            json!("regime_microprice_confirmation_v1")
        );
        assert_eq!(regime_write_payload["regimeTag"]["status"], json!("draft"));

        let filtered_response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/internal/runtime/features?featureKey=microprice_delta_bps&regimeKey=microprice_confirmation&status=draft")
                    .header("authorization", "Bearer runtime-service-secret")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(filtered_response.status(), StatusCode::OK);
        let filtered_payload = read_json(filtered_response).await;
        assert_eq!(
            filtered_payload["registry"]["featureDefinitions"][0]["featureKey"],
            json!("microprice_delta_bps")
        );
        assert_eq!(
            filtered_payload["registry"]["regimeTags"][0]["regimeKey"],
            json!("microprice_confirmation")
        );
    }

    #[tokio::test]
    async fn unsupported_asset_evaluation_does_not_persist_runs() {
        let state = RuntimeAppState::new(test_config());
        let mut deployment: RuntimeDeploymentRecord = serde_json::from_value(runtime_deployment(
            "deployment_unknown_asset_eval",
            "sleeve_alpha",
            "1000.00",
            "125.00",
        ))
        .expect("deployment");
        deployment.pair = protocol::RuntimePair {
            symbol: "BONK/USDC".to_string(),
            base_mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263".to_string(),
            quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
            market_type: protocol::RuntimeVenueMarketType::Spot,
        };
        state
            .strategy_registry
            .upsert_deployment(&deployment)
            .expect("deployment to store");

        let mut headers = HeaderMap::new();
        headers.insert(
            "authorization",
            HeaderValue::from_static("Bearer runtime-service-secret"),
        );
        let error = evaluate_deployment_handler(
            headers,
            Path("deployment_unknown_asset_eval".to_string()),
            State(state.clone()),
            Bytes::from("{}"),
        )
        .await
        .expect_err("unsupported pair to fail before run creation");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        let runs = state
            .strategy_registry
            .list_runs("deployment_unknown_asset_eval")
            .expect("runs to list");
        assert!(runs.is_empty());
    }

    #[tokio::test]
    async fn rejects_deployments_for_unlisted_assets() {
        let router = app(test_config());
        let mut deployment = runtime_deployment(
            "deployment_unknown_asset",
            "sleeve_alpha",
            "1000.00",
            "125.00",
        );
        deployment["pair"] = json!({
            "symbol": "BONK/USDC",
            "baseMint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        });

        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/runtime/deployments")
                    .header("authorization", "Bearer runtime-service-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(deployment.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let payload = read_json(response).await;
        assert_eq!(payload["error"], json!("asset-venue-native-id-not-found"));
        assert_eq!(
            payload["details"]["nativeId"],
            deployment["pair"]["baseMint"]
        );
    }
}
