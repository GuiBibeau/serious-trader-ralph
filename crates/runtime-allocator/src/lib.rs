use std::{
    fs,
    path::{Path, PathBuf},
};

use protocol::{
    RuntimeAllocatorDecisionRecord, RuntimeAllocatorPeerGrant, RuntimeAssetListingState,
    RuntimeAssetRiskClass, RuntimeDeploymentRecord, RuntimeDeploymentState, RuntimeLane,
    RuntimeMode, RuntimeOnboardingState, RUNTIME_PROTOCOL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeAllocatorConfig {
    pub database_url: String,
}

impl RuntimeAllocatorConfig {
    #[must_use]
    pub fn new(database_url: impl Into<String>) -> Self {
        Self {
            database_url: database_url.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeAllocator {
    database_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeAllocatorInput {
    pub run_id: String,
    pub deployment: RuntimeDeploymentRecord,
    pub sleeve_equity_usd: String,
    pub sleeve_deployments: Vec<RuntimeDeploymentRecord>,
    pub deployment_contexts: Vec<RuntimeAllocatorDeploymentContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeAllocatorResult {
    pub decision: RuntimeAllocatorDecisionRecord,
    pub effective_deployment: RuntimeDeploymentRecord,
    pub pressure_summary: RuntimeAllocatorPressureSummary,
    pub created: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeAllocatorPressureInput {
    pub sleeve_equity_usd: String,
    pub sleeve_deployments: Vec<RuntimeDeploymentRecord>,
    pub current_decisions: Vec<RuntimeAllocatorDecisionRecord>,
    pub deployment_contexts: Vec<RuntimeAllocatorDeploymentContext>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorDeploymentContext {
    pub deployment_id: String,
    pub venue_key: String,
    pub venue_onboarding_state: RuntimeOnboardingState,
    pub exposure_asset_key: String,
    pub exposure_asset_listing_state: RuntimeAssetListingState,
    pub exposure_asset_risk_class: RuntimeAssetRiskClass,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorPressureBucket {
    pub subject_key: String,
    pub limit_bps: u16,
    pub requested_allocated_usd: String,
    pub granted_allocated_usd: String,
    pub requested_reserved_usd: String,
    pub granted_reserved_usd: String,
    pub max_allocated_usd: String,
    pub utilization_bps: u16,
    pub constrained: bool,
    pub subject_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorPressureSummary {
    pub by_strategy: Vec<RuntimeAllocatorPressureBucket>,
    pub by_venue: Vec<RuntimeAllocatorPressureBucket>,
    pub by_asset: Vec<RuntimeAllocatorPressureBucket>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAllocatorSnapshot {
    pub status: String,
    pub decision_count: u64,
    pub constrained_decision_count: u64,
    pub latest_decision_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Error)]
pub enum RuntimeAllocatorError {
    #[error("storage io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid usd amount for {field}: {value}")]
    InvalidUsdAmount { field: &'static str, value: String },
    #[error("allocator decision {run_id} not found")]
    DecisionNotFound { run_id: String },
}

impl RuntimeAllocator {
    pub fn new(config: RuntimeAllocatorConfig) -> Result<Self, RuntimeAllocatorError> {
        let requested_path = normalize_database_path(&config.database_url);
        match Self::initialize_at_path(requested_path.clone()) {
            Ok(allocator) => Ok(allocator),
            Err(error) if should_fallback_to_tmp(&requested_path, &error) => {
                Self::initialize_at_path(fallback_database_path())
            }
            Err(error) => Err(error),
        }
    }

    pub fn allocate_and_store(
        &self,
        input: &RuntimeAllocatorInput,
    ) -> Result<RuntimeAllocatorResult, RuntimeAllocatorError> {
        let mut connection = self.open_connection()?;
        let transaction = connection.transaction()?;

        if let Some(existing) = load_decision_by_run_id(&transaction, &input.run_id)? {
            let effective_deployment = apply_grant(&input.deployment, &existing);
            let pressure_summary = self.summarize_pressure(&RuntimeAllocatorPressureInput {
                sleeve_equity_usd: input.sleeve_equity_usd.clone(),
                sleeve_deployments: input.sleeve_deployments.clone(),
                current_decisions: vec![existing.clone()],
                deployment_contexts: input.deployment_contexts.clone(),
            })?;
            transaction.commit()?;
            return Ok(RuntimeAllocatorResult {
                decision: existing,
                effective_deployment,
                pressure_summary,
                created: false,
            });
        }

        let (decision, pressure_summary) = build_decision(input)?;
        persist_decision(&transaction, &decision)?;
        transaction.commit()?;

        Ok(RuntimeAllocatorResult {
            effective_deployment: apply_grant(&input.deployment, &decision),
            decision,
            pressure_summary,
            created: true,
        })
    }

    pub fn list_decisions_for_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<Vec<RuntimeAllocatorDecisionRecord>, RuntimeAllocatorError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT record_json
             FROM allocator_decisions
             WHERE deployment_id = ?1
             ORDER BY decided_at DESC, decision_id DESC",
        )?;
        let rows = statement.query_map(params![deployment_id], |row| row.get::<_, String>(0))?;
        let mut decisions = Vec::new();
        for row in rows {
            decisions.push(deserialize_json(&row?)?);
        }
        Ok(decisions)
    }

    pub fn list_decisions_for_sleeve(
        &self,
        sleeve_id: &str,
    ) -> Result<Vec<RuntimeAllocatorDecisionRecord>, RuntimeAllocatorError> {
        let connection = self.open_connection()?;
        let mut statement = connection.prepare(
            "SELECT record_json
             FROM allocator_decisions
             WHERE sleeve_id = ?1
             ORDER BY decided_at DESC, decision_id DESC",
        )?;
        let rows = statement.query_map(params![sleeve_id], |row| row.get::<_, String>(0))?;
        let mut decisions = Vec::new();
        for row in rows {
            decisions.push(deserialize_json(&row?)?);
        }
        Ok(decisions)
    }

    pub fn latest_decision_for_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<Option<RuntimeAllocatorDecisionRecord>, RuntimeAllocatorError> {
        let connection = self.open_connection()?;
        let raw = connection
            .query_row(
                "SELECT record_json
                 FROM allocator_decisions
                 WHERE deployment_id = ?1
                 ORDER BY decided_at DESC, decision_id DESC
                 LIMIT 1",
                params![deployment_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
    }

    pub fn summarize_pressure(
        &self,
        input: &RuntimeAllocatorPressureInput,
    ) -> Result<RuntimeAllocatorPressureSummary, RuntimeAllocatorError> {
        let sleeve_equity_cents =
            parse_non_negative_usd_cents("sleeveEquityUsd", &input.sleeve_equity_usd)?;
        let contexts = build_context_lookup(&input.sleeve_deployments, &input.deployment_contexts);
        let latest_decisions = latest_decisions_by_deployment(&input.current_decisions);
        let mut grants = Vec::with_capacity(input.sleeve_deployments.len());
        for deployment in &input.sleeve_deployments {
            grants.push(current_grant_for_deployment(
                deployment,
                latest_decisions.get(&deployment.deployment_id),
            )?);
        }
        let peers = build_ranked_deployments(&input.sleeve_deployments);
        build_pressure_summary(sleeve_equity_cents, &peers, &grants, &contexts)
    }

    #[must_use]
    pub fn snapshot_now(&self) -> RuntimeAllocatorSnapshot {
        match self.snapshot_counts() {
            Ok((decision_count, constrained_decision_count, latest_decision_at)) => {
                RuntimeAllocatorSnapshot {
                    status: "healthy".to_string(),
                    decision_count,
                    constrained_decision_count,
                    latest_decision_at,
                    last_error: None,
                }
            }
            Err(error) => RuntimeAllocatorSnapshot {
                status: "degraded".to_string(),
                decision_count: 0,
                constrained_decision_count: 0,
                latest_decision_at: None,
                last_error: Some(error.to_string()),
            },
        }
    }

    fn snapshot_counts(&self) -> Result<(u64, u64, Option<String>), RuntimeAllocatorError> {
        let connection = self.open_connection()?;
        let decision_count =
            connection.query_row("SELECT COUNT(*) FROM allocator_decisions", [], |row| {
                row.get::<_, u64>(0)
            })?;
        let constrained_decision_count = connection.query_row(
            "SELECT COUNT(*) FROM allocator_decisions WHERE constrained = 1",
            [],
            |row| row.get::<_, u64>(0),
        )?;
        let latest_decision_at = connection
            .query_row(
                "SELECT decided_at
                 FROM allocator_decisions
                 ORDER BY decided_at DESC, decision_id DESC
                 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok((
            decision_count,
            constrained_decision_count,
            latest_decision_at,
        ))
    }

    fn open_connection(&self) -> Result<Connection, RuntimeAllocatorError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn initialize_at_path(database_path: PathBuf) -> Result<Self, RuntimeAllocatorError> {
        if database_path != Path::new(":memory:") {
            if let Some(parent) = database_path
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
            {
                fs::create_dir_all(parent)?;
            }
        }
        let allocator = Self { database_path };
        let connection = allocator.open_connection()?;
        initialize_schema(&connection)?;
        Ok(allocator)
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS allocator_decisions (
            decision_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL UNIQUE,
            deployment_id TEXT NOT NULL,
            sleeve_id TEXT NOT NULL,
            constrained INTEGER NOT NULL,
            decided_at TEXT NOT NULL,
            record_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_allocator_decisions_deployment_decided
            ON allocator_decisions (deployment_id, decided_at DESC);
        CREATE INDEX IF NOT EXISTS idx_allocator_decisions_sleeve_decided
            ON allocator_decisions (sleeve_id, decided_at DESC);",
    )
}

fn build_decision(
    input: &RuntimeAllocatorInput,
) -> Result<
    (
        RuntimeAllocatorDecisionRecord,
        RuntimeAllocatorPressureSummary,
    ),
    RuntimeAllocatorError,
> {
    let sleeve_equity_cents =
        parse_non_negative_usd_cents("sleeveEquityUsd", &input.sleeve_equity_usd)?;
    let peers = build_ranked_deployments(&input.sleeve_deployments);
    let contexts = build_context_lookup(&input.sleeve_deployments, &input.deployment_contexts);

    let mut total_requested_allocated_cents = 0_i64;
    let mut total_requested_reserved_cents = 0_i64;
    for peer in &peers {
        total_requested_allocated_cents += parse_non_negative_usd_cents(
            "capital.allocatedUsd",
            &peer.deployment.capital.allocated_usd,
        )?;
        total_requested_reserved_cents += effective_reserved_cents(&peer.deployment)?;
    }

    let mut remaining_cents = sleeve_equity_cents;
    let mut granted_by_strategy = std::collections::BTreeMap::new();
    let mut granted_by_venue = std::collections::BTreeMap::new();
    let mut granted_by_asset = std::collections::BTreeMap::new();
    let mut peer_grants = Vec::with_capacity(peers.len());
    for (index, peer) in peers.iter().enumerate() {
        let requested_allocated_cents = parse_non_negative_usd_cents(
            "capital.allocatedUsd",
            &peer.deployment.capital.allocated_usd,
        )?;
        let requested_reserved_cents = effective_reserved_cents(&peer.deployment)?;
        let context = contexts
            .get(&peer.deployment.deployment_id)
            .cloned()
            .unwrap_or_else(|| fallback_context(&peer.deployment));
        let granted_allocated_cents = if deployment_is_eligible_for_grant(&peer.deployment) {
            let strategy_remaining = remaining_subject_capacity(
                strategy_limit_bps(&peer.deployment.strategy_key),
                sleeve_equity_cents,
                granted_by_strategy
                    .get(&peer.deployment.strategy_key)
                    .copied()
                    .unwrap_or_default(),
            );
            let venue_remaining = remaining_subject_capacity(
                venue_limit_bps(&context.venue_onboarding_state),
                sleeve_equity_cents,
                granted_by_venue
                    .get(&context.venue_key)
                    .copied()
                    .unwrap_or_default(),
            );
            let asset_remaining = remaining_subject_capacity(
                asset_limit_bps(
                    &context.exposure_asset_risk_class,
                    &context.exposure_asset_listing_state,
                ),
                sleeve_equity_cents,
                granted_by_asset
                    .get(&context.exposure_asset_key)
                    .copied()
                    .unwrap_or_default(),
            );
            requested_allocated_cents
                .min(remaining_cents)
                .min(strategy_remaining)
                .min(venue_remaining)
                .min(asset_remaining)
        } else {
            0
        };
        remaining_cents = remaining_cents.saturating_sub(granted_allocated_cents);
        let granted_reserved_cents = requested_reserved_cents.min(granted_allocated_cents);
        *granted_by_strategy
            .entry(peer.deployment.strategy_key.clone())
            .or_insert(0) += granted_allocated_cents;
        *granted_by_venue
            .entry(context.venue_key.clone())
            .or_insert(0) += granted_allocated_cents;
        *granted_by_asset
            .entry(context.exposure_asset_key.clone())
            .or_insert(0) += granted_allocated_cents;
        peer_grants.push(RuntimeAllocatorPeerGrant {
            deployment_id: peer.deployment.deployment_id.clone(),
            strategy_key: peer.deployment.strategy_key.clone(),
            mode: peer.deployment.mode.clone(),
            state: peer.deployment.state.clone(),
            priority_rank: (index + 1) as u32,
            priority_score: peer.priority_score,
            requested_allocated_usd: format_usd_cents(requested_allocated_cents),
            granted_allocated_usd: format_usd_cents(granted_allocated_cents),
            requested_reserved_usd: format_usd_cents(requested_reserved_cents),
            granted_reserved_usd: format_usd_cents(granted_reserved_cents),
            constrained: granted_allocated_cents < requested_allocated_cents
                || granted_reserved_cents < requested_reserved_cents,
        });
    }

    let target_grant = peer_grants
        .iter()
        .find(|grant| grant.deployment_id == input.deployment.deployment_id)
        .cloned()
        .ok_or_else(|| RuntimeAllocatorError::DecisionNotFound {
            run_id: input.run_id.clone(),
        })?;
    let mut total_granted_allocated_cents = 0_i64;
    let mut total_granted_reserved_cents = 0_i64;
    for grant in &peer_grants {
        total_granted_allocated_cents +=
            parse_non_negative_usd_cents("grantedAllocatedUsd", &grant.granted_allocated_usd)?;
        total_granted_reserved_cents +=
            parse_non_negative_usd_cents("grantedReservedUsd", &grant.granted_reserved_usd)?;
    }
    let target_granted_allocated_cents =
        parse_non_negative_usd_cents("grantedAllocatedUsd", &target_grant.granted_allocated_usd)?;
    let target_granted_reserved_cents =
        parse_non_negative_usd_cents("grantedReservedUsd", &target_grant.granted_reserved_usd)?;
    let pressure_summary =
        build_pressure_summary(sleeve_equity_cents, &peers, &peer_grants, &contexts)?;

    Ok((
        RuntimeAllocatorDecisionRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            decision_id: build_decision_id(&input.run_id),
            run_id: input.run_id.clone(),
            deployment_id: input.deployment.deployment_id.clone(),
            sleeve_id: input.deployment.sleeve_id.clone(),
            decided_at: now_rfc3339(),
            sleeve_equity_usd: format_usd_cents(sleeve_equity_cents),
            total_requested_allocated_usd: format_usd_cents(total_requested_allocated_cents),
            total_granted_allocated_usd: format_usd_cents(total_granted_allocated_cents),
            total_requested_reserved_usd: format_usd_cents(total_requested_reserved_cents),
            total_granted_reserved_usd: format_usd_cents(total_granted_reserved_cents),
            requested_allocated_usd: target_grant.requested_allocated_usd.clone(),
            granted_allocated_usd: target_grant.granted_allocated_usd.clone(),
            requested_reserved_usd: target_grant.requested_reserved_usd.clone(),
            granted_reserved_usd: target_grant.granted_reserved_usd.clone(),
            granted_available_usd: format_usd_cents(
                target_granted_allocated_cents.saturating_sub(target_granted_reserved_cents),
            ),
            priority_rank: target_grant.priority_rank,
            priority_score: target_grant.priority_score,
            constrained: target_grant.constrained,
            peer_grants,
        },
        pressure_summary,
    ))
}

fn apply_grant(
    deployment: &RuntimeDeploymentRecord,
    decision: &RuntimeAllocatorDecisionRecord,
) -> RuntimeDeploymentRecord {
    let mut effective = deployment.clone();
    effective.capital.allocated_usd = decision.granted_allocated_usd.clone();
    effective.capital.reserved_usd = decision.granted_reserved_usd.clone();
    effective.capital.available_usd = decision.granted_available_usd.clone();
    effective
}

fn persist_decision(
    connection: &Connection,
    decision: &RuntimeAllocatorDecisionRecord,
) -> Result<(), RuntimeAllocatorError> {
    connection.execute(
        "INSERT INTO allocator_decisions (
            decision_id,
            run_id,
            deployment_id,
            sleeve_id,
            constrained,
            decided_at,
            record_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &decision.decision_id,
            &decision.run_id,
            &decision.deployment_id,
            &decision.sleeve_id,
            if decision.constrained { 1 } else { 0 },
            &decision.decided_at,
            serialize_json(decision)?,
        ],
    )?;
    Ok(())
}

fn load_decision_by_run_id(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<RuntimeAllocatorDecisionRecord>, RuntimeAllocatorError> {
    let raw = connection
        .query_row(
            "SELECT record_json
             FROM allocator_decisions
             WHERE run_id = ?1",
            params![run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw.map(|value| deserialize_json(&value)).transpose()?)
}

#[derive(Debug, Clone)]
struct RankedDeployment {
    deployment: RuntimeDeploymentRecord,
    priority_score: i64,
}

#[derive(Debug, Clone)]
struct PressureAccumulator {
    subject_key: String,
    limit_bps: u16,
    requested_allocated_cents: i64,
    granted_allocated_cents: i64,
    requested_reserved_cents: i64,
    granted_reserved_cents: i64,
    subject_state: String,
}

fn build_ranked_deployments(deployments: &[RuntimeDeploymentRecord]) -> Vec<RankedDeployment> {
    let mut peers = deployments
        .iter()
        .map(|deployment| RankedDeployment {
            deployment: deployment.clone(),
            priority_score: allocator_priority_score(deployment),
        })
        .collect::<Vec<_>>();
    peers.sort_by(|left, right| {
        right
            .priority_score
            .cmp(&left.priority_score)
            .then_with(|| {
                left.deployment
                    .deployment_id
                    .cmp(&right.deployment.deployment_id)
            })
    });
    peers
}

fn build_context_lookup(
    deployments: &[RuntimeDeploymentRecord],
    contexts: &[RuntimeAllocatorDeploymentContext],
) -> std::collections::BTreeMap<String, RuntimeAllocatorDeploymentContext> {
    let mut lookup = contexts
        .iter()
        .map(|context| (context.deployment_id.clone(), context.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    for deployment in deployments {
        lookup
            .entry(deployment.deployment_id.clone())
            .or_insert_with(|| fallback_context(deployment));
    }
    lookup
}

fn fallback_context(deployment: &RuntimeDeploymentRecord) -> RuntimeAllocatorDeploymentContext {
    RuntimeAllocatorDeploymentContext {
        deployment_id: deployment.deployment_id.clone(),
        venue_key: deployment.venue_key.clone(),
        // Missing venue or asset context should not silently tighten grants.
        venue_onboarding_state: RuntimeOnboardingState::BroadLiveReady,
        exposure_asset_key: deployment
            .pair
            .symbol
            .split('/')
            .next()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&deployment.pair.base_mint)
            .to_string(),
        exposure_asset_listing_state: RuntimeAssetListingState::Live,
        exposure_asset_risk_class: RuntimeAssetRiskClass::Core,
    }
}

fn latest_decisions_by_deployment(
    decisions: &[RuntimeAllocatorDecisionRecord],
) -> std::collections::BTreeMap<String, &RuntimeAllocatorDecisionRecord> {
    let mut latest = std::collections::BTreeMap::new();
    for decision in decisions {
        latest
            .entry(decision.deployment_id.clone())
            .or_insert(decision);
    }
    latest
}

fn current_grant_for_deployment(
    deployment: &RuntimeDeploymentRecord,
    decision: Option<&&RuntimeAllocatorDecisionRecord>,
) -> Result<RuntimeAllocatorPeerGrant, RuntimeAllocatorError> {
    let requested_allocated_cents =
        parse_non_negative_usd_cents("capital.allocatedUsd", &deployment.capital.allocated_usd)?;
    let requested_reserved_cents = effective_reserved_cents(deployment)?;
    let granted_allocated_usd = decision
        .map(|record| record.granted_allocated_usd.clone())
        .unwrap_or_else(|| deployment.capital.allocated_usd.clone());
    let granted_reserved_usd = decision
        .map(|record| record.granted_reserved_usd.clone())
        .unwrap_or_else(|| deployment.capital.reserved_usd.clone());
    let granted_allocated_cents =
        parse_non_negative_usd_cents("grantedAllocatedUsd", &granted_allocated_usd)?;
    let granted_reserved_cents =
        parse_non_negative_usd_cents("grantedReservedUsd", &granted_reserved_usd)?;

    Ok(RuntimeAllocatorPeerGrant {
        deployment_id: deployment.deployment_id.clone(),
        strategy_key: deployment.strategy_key.clone(),
        mode: deployment.mode.clone(),
        state: deployment.state.clone(),
        priority_rank: 0,
        priority_score: allocator_priority_score(deployment),
        requested_allocated_usd: format_usd_cents(requested_allocated_cents),
        granted_allocated_usd: format_usd_cents(granted_allocated_cents),
        requested_reserved_usd: format_usd_cents(requested_reserved_cents),
        granted_reserved_usd: format_usd_cents(granted_reserved_cents),
        constrained: granted_allocated_cents < requested_allocated_cents
            || granted_reserved_cents < requested_reserved_cents,
    })
}

fn build_pressure_summary(
    sleeve_equity_cents: i64,
    peers: &[RankedDeployment],
    grants: &[RuntimeAllocatorPeerGrant],
    contexts: &std::collections::BTreeMap<String, RuntimeAllocatorDeploymentContext>,
) -> Result<RuntimeAllocatorPressureSummary, RuntimeAllocatorError> {
    let mut by_strategy = std::collections::BTreeMap::new();
    let mut by_venue = std::collections::BTreeMap::new();
    let mut by_asset = std::collections::BTreeMap::new();

    for (peer, grant) in peers.iter().zip(grants.iter()) {
        let requested_allocated_cents =
            parse_non_negative_usd_cents("requestedAllocatedUsd", &grant.requested_allocated_usd)?;
        let granted_allocated_cents =
            parse_non_negative_usd_cents("grantedAllocatedUsd", &grant.granted_allocated_usd)?;
        let requested_reserved_cents =
            parse_non_negative_usd_cents("requestedReservedUsd", &grant.requested_reserved_usd)?;
        let granted_reserved_cents =
            parse_non_negative_usd_cents("grantedReservedUsd", &grant.granted_reserved_usd)?;
        let context = contexts
            .get(&peer.deployment.deployment_id)
            .cloned()
            .unwrap_or_else(|| fallback_context(&peer.deployment));

        accumulate_pressure(
            &mut by_strategy,
            PressureAccumulator {
                subject_key: peer.deployment.strategy_key.clone(),
                limit_bps: strategy_limit_bps(&peer.deployment.strategy_key),
                requested_allocated_cents,
                granted_allocated_cents,
                requested_reserved_cents,
                granted_reserved_cents,
                subject_state: "shared-strategy-budget".to_string(),
            },
        );
        accumulate_pressure(
            &mut by_venue,
            PressureAccumulator {
                subject_key: context.venue_key.clone(),
                limit_bps: venue_limit_bps(&context.venue_onboarding_state),
                requested_allocated_cents,
                granted_allocated_cents,
                requested_reserved_cents,
                granted_reserved_cents,
                subject_state: onboarding_state_label(&context.venue_onboarding_state),
            },
        );
        accumulate_pressure(
            &mut by_asset,
            PressureAccumulator {
                subject_key: context.exposure_asset_key.clone(),
                limit_bps: asset_limit_bps(
                    &context.exposure_asset_risk_class,
                    &context.exposure_asset_listing_state,
                ),
                requested_allocated_cents,
                granted_allocated_cents,
                requested_reserved_cents,
                granted_reserved_cents,
                subject_state: asset_state_label(
                    &context.exposure_asset_listing_state,
                    &context.exposure_asset_risk_class,
                ),
            },
        );
    }

    Ok(RuntimeAllocatorPressureSummary {
        by_strategy: finalize_pressure_buckets(by_strategy, sleeve_equity_cents),
        by_venue: finalize_pressure_buckets(by_venue, sleeve_equity_cents),
        by_asset: finalize_pressure_buckets(by_asset, sleeve_equity_cents),
    })
}

fn accumulate_pressure(
    buckets: &mut std::collections::BTreeMap<String, PressureAccumulator>,
    input: PressureAccumulator,
) {
    let entry = buckets
        .entry(input.subject_key.clone())
        .or_insert_with(|| PressureAccumulator {
            subject_key: input.subject_key,
            limit_bps: input.limit_bps,
            requested_allocated_cents: 0,
            granted_allocated_cents: 0,
            requested_reserved_cents: 0,
            granted_reserved_cents: 0,
            subject_state: input.subject_state,
        });
    entry.requested_allocated_cents += input.requested_allocated_cents;
    entry.granted_allocated_cents += input.granted_allocated_cents;
    entry.requested_reserved_cents += input.requested_reserved_cents;
    entry.granted_reserved_cents += input.granted_reserved_cents;
}

fn finalize_pressure_buckets(
    buckets: std::collections::BTreeMap<String, PressureAccumulator>,
    sleeve_equity_cents: i64,
) -> Vec<RuntimeAllocatorPressureBucket> {
    let mut values = buckets
        .into_values()
        .map(|entry| {
            let max_allocated_cents = subject_limit_cents(entry.limit_bps, sleeve_equity_cents);
            RuntimeAllocatorPressureBucket {
                subject_key: entry.subject_key,
                limit_bps: entry.limit_bps,
                requested_allocated_usd: format_usd_cents(entry.requested_allocated_cents),
                granted_allocated_usd: format_usd_cents(entry.granted_allocated_cents),
                requested_reserved_usd: format_usd_cents(entry.requested_reserved_cents),
                granted_reserved_usd: format_usd_cents(entry.granted_reserved_cents),
                max_allocated_usd: format_usd_cents(max_allocated_cents),
                utilization_bps: utilization_bps(
                    entry.granted_allocated_cents,
                    max_allocated_cents,
                ),
                constrained: entry.granted_allocated_cents < entry.requested_allocated_cents
                    || entry.granted_reserved_cents < entry.requested_reserved_cents,
                subject_state: entry.subject_state,
            }
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .utilization_bps
            .cmp(&left.utilization_bps)
            .then_with(|| left.subject_key.cmp(&right.subject_key))
    });
    values
}

fn remaining_subject_capacity(limit_bps: u16, sleeve_equity_cents: i64, granted_cents: i64) -> i64 {
    subject_limit_cents(limit_bps, sleeve_equity_cents)
        .saturating_sub(granted_cents)
        .max(0)
}

fn subject_limit_cents(limit_bps: u16, sleeve_equity_cents: i64) -> i64 {
    ((sleeve_equity_cents * i64::from(limit_bps)) / 10_000).max(0)
}

fn utilization_bps(granted_cents: i64, max_allocated_cents: i64) -> u16 {
    if max_allocated_cents <= 0 {
        return if granted_cents > 0 { 10_000 } else { 0 };
    }
    (((granted_cents * 10_000) + (max_allocated_cents / 2)) / max_allocated_cents).clamp(0, 10_000)
        as u16
}

fn strategy_limit_bps(strategy_key: &str) -> u16 {
    match strategy_key {
        "restricted" => 0,
        "experimental" => 8_500,
        _ => 10_000,
    }
}

fn venue_limit_bps(state: &RuntimeOnboardingState) -> u16 {
    match state {
        RuntimeOnboardingState::BroadLiveReady => 10_000,
        RuntimeOnboardingState::LimitedLiveReady => 8_500,
        RuntimeOnboardingState::PaperReady => 6_000,
        RuntimeOnboardingState::ShadowReady => 4_500,
        RuntimeOnboardingState::Integrated => 3_500,
        RuntimeOnboardingState::Candidate => 2_500,
        RuntimeOnboardingState::Paused | RuntimeOnboardingState::Deprecated => 0,
    }
}

fn asset_limit_bps(
    risk_class: &RuntimeAssetRiskClass,
    listing_state: &RuntimeAssetListingState,
) -> u16 {
    let base: u16 = match risk_class {
        RuntimeAssetRiskClass::Core => 10_000,
        RuntimeAssetRiskClass::Standard => 8_500,
        RuntimeAssetRiskClass::Volatile => 5_000,
        RuntimeAssetRiskClass::Experimental => 3_000,
        RuntimeAssetRiskClass::Restricted => 0,
    };
    let multiplier: u32 = match listing_state {
        RuntimeAssetListingState::Live => 100,
        RuntimeAssetListingState::Paper => 75,
        RuntimeAssetListingState::Shadow => 55,
        RuntimeAssetListingState::Candidate => 35,
        RuntimeAssetListingState::Paused | RuntimeAssetListingState::Deprecated => 0,
    };
    ((u32::from(base) * multiplier) / 100) as u16
}

fn onboarding_state_label(state: &RuntimeOnboardingState) -> String {
    match state {
        RuntimeOnboardingState::Candidate => "candidate".to_string(),
        RuntimeOnboardingState::Integrated => "integrated".to_string(),
        RuntimeOnboardingState::ShadowReady => "shadow_ready".to_string(),
        RuntimeOnboardingState::PaperReady => "paper_ready".to_string(),
        RuntimeOnboardingState::LimitedLiveReady => "limited_live_ready".to_string(),
        RuntimeOnboardingState::BroadLiveReady => "broad_live_ready".to_string(),
        RuntimeOnboardingState::Paused => "paused".to_string(),
        RuntimeOnboardingState::Deprecated => "deprecated".to_string(),
    }
}

fn asset_state_label(
    listing_state: &RuntimeAssetListingState,
    risk_class: &RuntimeAssetRiskClass,
) -> String {
    format!("{:?}:{:?}", listing_state, risk_class).to_ascii_lowercase()
}

fn deployment_is_eligible_for_grant(deployment: &RuntimeDeploymentRecord) -> bool {
    matches!(
        deployment.state,
        RuntimeDeploymentState::Shadow
            | RuntimeDeploymentState::Paper
            | RuntimeDeploymentState::Live
    )
}

fn allocator_priority_score(deployment: &RuntimeDeploymentRecord) -> i64 {
    let override_score = deployment
        .tags
        .iter()
        .find_map(|tag| parse_allocator_priority_override(tag))
        .unwrap_or(0);
    override_score
        + mode_priority(&deployment.mode)
        + lane_priority(&deployment.lane)
        + strategy_priority(&deployment.strategy_key)
}

fn parse_allocator_priority_override(tag: &str) -> Option<i64> {
    let trimmed = tag.trim();
    let raw = trimmed.strip_prefix("allocator:priority=")?;
    match raw {
        "critical" => Some(1_000),
        "high" => Some(750),
        "normal" => Some(500),
        "low" => Some(250),
        _ => raw.parse::<i64>().ok(),
    }
}

fn mode_priority(mode: &RuntimeMode) -> i64 {
    match mode {
        RuntimeMode::Live => 300,
        RuntimeMode::Paper => 200,
        RuntimeMode::Shadow => 100,
    }
}

fn lane_priority(lane: &RuntimeLane) -> i64 {
    match lane {
        RuntimeLane::Safe => 30,
        RuntimeLane::Protected => 20,
        RuntimeLane::Fast => 10,
    }
}

fn strategy_priority(strategy_key: &str) -> i64 {
    match strategy_key {
        "threshold_rebalance" => 9,
        "volatility_target" => 8,
        "macro_rotation" => 7,
        "dca" => 6,
        "twap" => 5,
        "breakout" => 4,
        "trend_following" => 3,
        "mean_reversion" => 2,
        _ => 1,
    }
}

fn effective_reserved_cents(
    deployment: &RuntimeDeploymentRecord,
) -> Result<i64, RuntimeAllocatorError> {
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

fn build_decision_id(run_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(run_id.as_bytes());
    let digest = hasher.finalize();
    format!("alloc_{}", hex_encode(&digest[..12]))
}

fn normalize_database_path(database_url: &str) -> PathBuf {
    let trimmed = database_url.trim();
    if trimmed.is_empty() {
        return PathBuf::from(".tmp/runtime-rs/runtime-allocator.sqlite3");
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
        .join("runtime-allocator.sqlite3")
}

fn should_fallback_to_tmp(database_path: &Path, error: &RuntimeAllocatorError) -> bool {
    if database_path == Path::new(":memory:") || database_path == fallback_database_path() {
        return false;
    }

    match error {
        RuntimeAllocatorError::Io(inner) => inner.kind() == std::io::ErrorKind::PermissionDenied,
        RuntimeAllocatorError::Storage(inner) => {
            matches!(
                inner,
                rusqlite::Error::SqliteFailure(code, _)
                    if code.code == rusqlite::ErrorCode::CannotOpen
            )
        }
        RuntimeAllocatorError::Serialization(_)
        | RuntimeAllocatorError::InvalidUsdAmount { .. }
        | RuntimeAllocatorError::DecisionNotFound { .. } => false,
    }
}

fn parse_usd_cents(field: &'static str, value: &str) -> Result<i64, RuntimeAllocatorError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(RuntimeAllocatorError::InvalidUsdAmount {
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
        return Err(RuntimeAllocatorError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        });
    }

    let whole = whole_raw
        .parse::<i64>()
        .map_err(|_| RuntimeAllocatorError::InvalidUsdAmount {
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
        .ok_or_else(|| RuntimeAllocatorError::InvalidUsdAmount {
            field,
            value: trimmed.to_string(),
        })?;
    Ok(sign * cents)
}

fn parse_non_negative_usd_cents(
    field: &'static str,
    value: &str,
) -> Result<i64, RuntimeAllocatorError> {
    let cents = parse_usd_cents(field, value)?;
    if cents < 0 {
        return Err(RuntimeAllocatorError::InvalidUsdAmount {
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
        RuntimePolicy, RuntimeVenueMarketType,
    };

    use super::*;

    fn temp_database_url(test_name: &str) -> String {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("runtime-allocator-{test_name}-{unique}.sqlite3"))
            .display()
            .to_string()
    }

    fn allocator(test_name: &str) -> RuntimeAllocator {
        RuntimeAllocator::new(RuntimeAllocatorConfig::new(temp_database_url(test_name)))
            .expect("allocator to initialize")
    }

    fn deployment(
        deployment_id: &str,
        strategy_key: &str,
        mode: RuntimeMode,
        lane: RuntimeLane,
        allocated_usd: &str,
        reserved_usd: &str,
        tags: &[&str],
    ) -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: RUNTIME_PROTOCOL_SCHEMA_VERSION.to_string(),
            deployment_id: deployment_id.to_string(),
            strategy_key: strategy_key.to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: "jupiter".to_string(),
            pair: RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string(),
                market_type: RuntimeVenueMarketType::Spot,
            },
            mode,
            state: RuntimeDeploymentState::Shadow,
            lane,
            created_at: "2026-03-10T18:00:00Z".to_string(),
            updated_at: "2026-03-10T18:00:00Z".to_string(),
            promoted_at: None,
            paused_at: None,
            killed_at: None,
            policy: RuntimePolicy {
                max_notional_usd: reserved_usd.to_string(),
                daily_loss_limit_usd: "25.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: RuntimeCapital {
                allocated_usd: allocated_usd.to_string(),
                reserved_usd: reserved_usd.to_string(),
                available_usd: "0.00".to_string(),
            },
            tags: tags.iter().map(|tag| (*tag).to_string()).collect(),
        }
    }

    #[test]
    fn allocates_full_grants_when_capacity_is_available() {
        let allocator = allocator("full-grant");
        let alpha = deployment(
            "deployment_alpha",
            "dca",
            RuntimeMode::Paper,
            RuntimeLane::Safe,
            "60.00",
            "15.00",
            &[],
        );
        let beta = deployment(
            "deployment_beta",
            "threshold_rebalance",
            RuntimeMode::Shadow,
            RuntimeLane::Safe,
            "40.00",
            "10.00",
            &[],
        );

        let result = allocator
            .allocate_and_store(&RuntimeAllocatorInput {
                run_id: "run_alpha".to_string(),
                deployment: alpha.clone(),
                sleeve_equity_usd: "100.00".to_string(),
                sleeve_deployments: vec![alpha, beta],
                deployment_contexts: vec![],
            })
            .expect("decision to store");

        assert!(result.created);
        assert_eq!(result.decision.granted_allocated_usd, "60.00");
        assert_eq!(result.decision.granted_reserved_usd, "15.00");
        assert!(!result.decision.constrained);
    }

    #[test]
    fn clamps_lower_priority_deployments_when_requests_exceed_capacity() {
        let allocator = allocator("clamped");
        let high = deployment(
            "deployment_high",
            "threshold_rebalance",
            RuntimeMode::Live,
            RuntimeLane::Safe,
            "60.00",
            "25.00",
            &[],
        );
        let low = deployment(
            "deployment_low",
            "trend_following",
            RuntimeMode::Shadow,
            RuntimeLane::Fast,
            "50.00",
            "20.00",
            &[],
        );

        let result = allocator
            .allocate_and_store(&RuntimeAllocatorInput {
                run_id: "run_low".to_string(),
                deployment: low.clone(),
                sleeve_equity_usd: "80.00".to_string(),
                sleeve_deployments: vec![low, high],
                deployment_contexts: vec![],
            })
            .expect("decision to store");

        assert!(result.created);
        assert_eq!(result.decision.granted_allocated_usd, "20.00");
        assert_eq!(result.decision.granted_reserved_usd, "20.00");
        assert!(result.decision.constrained);
        assert_eq!(result.decision.priority_rank, 2);
        assert_eq!(
            result.decision.peer_grants[0].deployment_id,
            "deployment_high"
        );
        assert_eq!(result.effective_deployment.capital.allocated_usd, "20.00");
    }

    #[test]
    fn honors_explicit_priority_tag_overrides() {
        let allocator = allocator("priority-tag");
        let normal = deployment(
            "deployment_normal",
            "threshold_rebalance",
            RuntimeMode::Live,
            RuntimeLane::Safe,
            "55.00",
            "20.00",
            &[],
        );
        let boosted = deployment(
            "deployment_boosted",
            "mean_reversion",
            RuntimeMode::Shadow,
            RuntimeLane::Fast,
            "55.00",
            "20.00",
            &["allocator:priority=critical"],
        );

        let result = allocator
            .allocate_and_store(&RuntimeAllocatorInput {
                run_id: "run_boosted".to_string(),
                deployment: boosted.clone(),
                sleeve_equity_usd: "60.00".to_string(),
                sleeve_deployments: vec![normal, boosted],
                deployment_contexts: vec![],
            })
            .expect("decision to store");

        assert_eq!(result.decision.priority_rank, 1);
        assert_eq!(result.decision.granted_allocated_usd, "55.00");
        assert!(!result.decision.constrained);
    }

    #[test]
    fn constrains_deployments_when_venue_budget_is_degraded() {
        let allocator = allocator("venue-degraded");
        let live = deployment(
            "deployment_live_jupiter",
            "dca",
            RuntimeMode::Live,
            RuntimeLane::Safe,
            "80.00",
            "25.00",
            &[],
        );

        let result = allocator
            .allocate_and_store(&RuntimeAllocatorInput {
                run_id: "run_live_jupiter".to_string(),
                deployment: live.clone(),
                sleeve_equity_usd: "100.00".to_string(),
                sleeve_deployments: vec![live.clone()],
                deployment_contexts: vec![RuntimeAllocatorDeploymentContext {
                    deployment_id: live.deployment_id.clone(),
                    venue_key: live.venue_key.clone(),
                    venue_onboarding_state: RuntimeOnboardingState::PaperReady,
                    exposure_asset_key: "SOL".to_string(),
                    exposure_asset_listing_state: RuntimeAssetListingState::Live,
                    exposure_asset_risk_class: RuntimeAssetRiskClass::Core,
                }],
            })
            .expect("decision to store");

        assert_eq!(result.decision.granted_allocated_usd, "60.00");
        assert!(result.decision.constrained);
        assert_eq!(result.pressure_summary.by_venue[0].subject_key, "jupiter");
        assert_eq!(result.pressure_summary.by_venue[0].limit_bps, 6_000);
        assert!(result.pressure_summary.by_venue[0].constrained);
    }

    #[test]
    fn constrains_deployments_when_asset_budget_is_experimental() {
        let allocator = allocator("asset-experimental");
        let candidate = deployment(
            "deployment_asset_candidate",
            "trend_following",
            RuntimeMode::Paper,
            RuntimeLane::Safe,
            "50.00",
            "20.00",
            &[],
        );

        let result = allocator
            .allocate_and_store(&RuntimeAllocatorInput {
                run_id: "run_asset_candidate".to_string(),
                deployment: candidate.clone(),
                sleeve_equity_usd: "100.00".to_string(),
                sleeve_deployments: vec![candidate.clone()],
                deployment_contexts: vec![RuntimeAllocatorDeploymentContext {
                    deployment_id: candidate.deployment_id.clone(),
                    venue_key: candidate.venue_key.clone(),
                    venue_onboarding_state: RuntimeOnboardingState::BroadLiveReady,
                    exposure_asset_key: "BONK".to_string(),
                    exposure_asset_listing_state: RuntimeAssetListingState::Candidate,
                    exposure_asset_risk_class: RuntimeAssetRiskClass::Experimental,
                }],
            })
            .expect("decision to store");

        assert_eq!(result.decision.granted_allocated_usd, "10.50");
        assert!(result.decision.constrained);
        assert_eq!(result.pressure_summary.by_asset[0].subject_key, "BONK");
        assert_eq!(result.pressure_summary.by_asset[0].limit_bps, 1_050);
        assert!(result.pressure_summary.by_asset[0].constrained);
    }
}
