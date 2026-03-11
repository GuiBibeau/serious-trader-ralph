use std::sync::{Arc, RwLock};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use exec_client::{
    ExecClient, ExecClientConfig, ExecClientError, ExecReceiptObservation, ExecSubmitResponse,
};
use execution_planner::{
    ExecutionPlanner, ExecutionPlannerConfig, ExecutionPlannerError, ExecutionPlannerInput,
    ExecutionPlannerSnapshot, StrategyPluginRegistry,
};
use feature_cache::{FeatureCache, FeatureCacheConfig, FeatureCacheSnapshot};
use market_adapters::{FeedGateway, FeedGatewayConfig, FeedGatewaySnapshot, FeedReplayFixture};
use portfolio_ledger::{
    PortfolioLedger, PortfolioLedgerConfig, PortfolioLedgerError, PortfolioLedgerSnapshot,
};
use protocol::{
    RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeResearchEvidenceBundleRecord,
    RuntimeResearchExperimentRecord, RuntimeResearchHypothesisRecord, RuntimeResearchSourceRecord,
    RuntimeRunRecord,
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
    build_readiness_report, RuntimeScorecardConfig, RuntimeScorecardError, RuntimeScorecardInput,
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
    let portfolio_ledger = state.portfolio_ledger_snapshot();
    let allocator = state.runtime_allocator_snapshot();
    let risk_engine = state.risk_engine_snapshot();
    let execution_planner = state.execution_planner_snapshot();
    let reconciler = state.reconciler_snapshot();
    let status = if feed_gateway.status == "healthy"
        && feature_cache.status == "healthy"
        && strategy_registry.status == "healthy"
        && research_registry.status == "healthy"
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
                let submit = state
                    .exec_client
                    .submit_plan(&plan)
                    .await
                    .map_err(map_exec_client_error)?;
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
                let reconciliation_expected_ledger = if is_runtime_canary {
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
                        receipt,
                        expected_ledger: reconciliation_expected_ledger,
                        observed_ledger: observed_ledger.clone(),
                    })
                    .map_err(map_reconciler_error)?;
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
                if reconciliation_outcome.should_apply_correction {
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
    let report = build_readiness_report(
        &RuntimeScorecardConfig::default(),
        &RuntimeScorecardInput {
            deployment,
            runs,
            verdicts,
            plans,
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
                            "promotionTarget": "paper",
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
                            "summary": "Evidence bundle for shadow-to-paper review.",
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
}
