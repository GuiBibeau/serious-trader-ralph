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
    ExecutionPlannerSnapshot,
};
use feature_cache::{FeatureCache, FeatureCacheConfig, FeatureCacheSnapshot};
use market_adapters::{FeedGateway, FeedGatewayConfig, FeedGatewaySnapshot, FeedReplayFixture};
use portfolio_ledger::{
    PortfolioLedger, PortfolioLedgerConfig, PortfolioLedgerError, PortfolioLedgerSnapshot,
};
use protocol::{RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeRunRecord};
use reconciler::{Reconciler, ReconcilerConfig, ReconcilerError, ReconcilerSnapshot};
use risk_engine::{
    should_pause_runtime, RiskAssessmentInput, RiskEngine, RiskEngineConfig, RiskEngineError,
    RiskEngineSnapshot,
};
use runtime_ops::{health_snapshot, RuntimeConfig};
use runtime_scorecards::{
    build_readiness_report, RuntimeScorecardConfig, RuntimeScorecardError, RuntimeScorecardInput,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use strategy_core::SUPPORTED_STRATEGIES;
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

#[derive(Debug, Clone)]
pub struct RuntimeAppState {
    config: RuntimeConfig,
    exec_client: ExecClient,
    feed_bootstrap_source: String,
    feed_bootstrap_error: Option<String>,
    feed_gateway: Arc<RwLock<FeedGateway>>,
    feature_cache: Arc<RwLock<FeatureCache>>,
    strategy_registry: StrategyRegistry,
    portfolio_ledger: PortfolioLedger,
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
        let strategy_registry =
            StrategyRegistry::new(StrategyRegistryConfig::new(config.database_url.clone()))
                .expect("strategy registry to initialize");
        let portfolio_ledger =
            PortfolioLedger::new(PortfolioLedgerConfig::new(config.database_url.clone()))
                .expect("portfolio ledger to initialize");
        let risk_engine = RiskEngine::new(RiskEngineConfig::new(
            config.database_url.clone(),
            config.feature_stale_after_ms,
        ))
        .expect("risk engine to initialize");
        let execution_planner =
            ExecutionPlanner::new(ExecutionPlannerConfig::new(config.database_url.clone()))
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
            portfolio_ledger,
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

    fn portfolio_ledger_snapshot(&self) -> PortfolioLedgerSnapshot {
        self.portfolio_ledger.snapshot_now()
    }

    fn risk_engine_snapshot(&self) -> RiskEngineSnapshot {
        self.risk_engine.snapshot_now()
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
    pub portfolio_ledger: PortfolioLedgerSnapshot,
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
    pub portfolio_ledger: PortfolioLedgerSnapshot,
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
    let portfolio_ledger = state.portfolio_ledger_snapshot();
    let risk_engine = state.risk_engine_snapshot();
    let execution_planner = state.execution_planner_snapshot();
    let reconciler = state.reconciler_snapshot();
    let status = if feed_gateway.status == "healthy"
        && feature_cache.status == "healthy"
        && strategy_registry.status == "healthy"
        && portfolio_ledger.status == "healthy"
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
        portfolio_ledger,
        risk_engine,
        execution_planner,
        reconciler,
        supported_strategies: SUPPORTED_STRATEGIES
            .iter()
            .map(|strategy| strategy.as_key().to_string())
            .collect(),
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
        portfolio_ledger: state.portfolio_ledger_snapshot(),
        risk_engine: state.risk_engine_snapshot(),
        execution_planner: state.execution_planner_snapshot(),
        reconciler: state.reconciler_snapshot(),
        supported_strategies: SUPPORTED_STRATEGIES
            .iter()
            .map(|strategy| strategy.as_key().to_string())
            .collect(),
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
    let assessment = state
        .risk_engine
        .assess_and_store(&RiskAssessmentInput {
            deployment: result.deployment.clone(),
            run: result.run.clone(),
            feature_snapshot: result.feature_snapshot.clone(),
            ledger_snapshot: state
                .portfolio_ledger
                .snapshot_for_deployment(&deployment_id)
                .map_err(map_ledger_error)?,
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
    let ledger_snapshot = state
        .portfolio_ledger
        .snapshot_for_deployment(&deployment_id)
        .map_err(map_ledger_error)?;

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
                    deployment: result.deployment.clone(),
                    run: coordinated_run.clone(),
                    feature_snapshot: result.feature_snapshot.clone(),
                    ledger_snapshot: ledger_snapshot.clone(),
                    risk_verdict: assessment.verdict.clone(),
                })
                .map_err(map_execution_planner_error)?;
            let plan = planning.plan;
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
            execution_plan = Some(plan);
            coordination = Some(submit);
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

struct ShadowEvaluationResponse {
    created: bool,
    deployment: RuntimeDeploymentRecord,
    run: RuntimeRunRecord,
    risk_verdict: protocol::RuntimeRiskVerdict,
    feature_snapshot: feature_cache::DerivedMarketFeatureSnapshot,
    ledger_snapshot: protocol::RuntimeLedgerSnapshot,
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
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use axum::{
        body::Body,
        extract::State,
        http::{HeaderMap, Request, StatusCode},
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
        RuntimeConfig::from_lookup(|key| match key {
            "RUNTIME_INTERNAL_SERVICE_TOKEN" => Some("runtime-service-secret".to_string()),
            "RUNTIME_WORKER_API_BASE" => worker_api_base.map(str::to_string),
            "RUNTIME_DATABASE_URL" => Some(temp_database_url("config")),
            _ => None,
        })
        .expect("config to load")
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
        json!({
            "schemaVersion": "v1",
            "deploymentId": deployment_id,
            "strategyKey": "dca",
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
        assert_eq!(payload.portfolio_ledger.status, "healthy");
        assert_eq!(payload.portfolio_ledger.deployment_count, 0);
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
        assert_eq!(payload.portfolio_ledger.status, "healthy");
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
            scorecards_payload["report"]["promotionGates"][0]["targetMode"],
            json!("paper")
        );
        assert!(scorecards_payload["report"]["proofArtifactMarkdown"]
            .as_str()
            .expect("markdown")
            .contains("Runtime Promotion Readiness"));
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
