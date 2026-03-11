use std::fmt;

use exec_client::{ExecPlanCoordination, ExecReceiptObservation, ExecSubmitResponse};
use protocol::{
    RuntimeDeploymentRecord, RuntimeExecutionAction, RuntimeExecutionPlan, RuntimeExecutionSlice,
    RuntimeLedgerBalance, RuntimeLedgerPosition, RuntimeLedgerSnapshot, RuntimeLedgerTotals,
    RuntimePositionSide, RuntimeVenueMarketType,
};
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

const PAPER_EXECUTION_SOURCE: &str = "runtime-rs-paper";
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaperExecutionSimulation {
    pub submit: ExecSubmitResponse,
    pub expected_ledger: RuntimeLedgerSnapshot,
    pub observed_ledger: RuntimeLedgerSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaperExecutionError {
    MissingSlices,
    UnsupportedMarketType(RuntimeVenueMarketType),
    InvalidAtomic { field: &'static str, value: String },
    InvalidTimestamp { field: &'static str, value: String },
}

impl fmt::Display for PaperExecutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSlices => write!(f, "paper execution requires at least one slice"),
            Self::UnsupportedMarketType(market_type) => {
                write!(f, "unsupported paper market type: {market_type:?}")
            }
            Self::InvalidAtomic { field, value } => {
                write!(f, "invalid atomic amount for {field}: {value}")
            }
            Self::InvalidTimestamp { field, value } => {
                write!(f, "invalid timestamp for {field}: {value}")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PaperVenueProfile {
    lifecycle: &'static str,
    fill_bps: u16,
    fee_bps: u16,
    impact_bps: u16,
    submit_latency_ms: i64,
    settlement_latency_ms: i64,
    cancel_remaining: bool,
}

pub fn simulate_paper_execution(
    deployment: &RuntimeDeploymentRecord,
    plan: &RuntimeExecutionPlan,
    ledger_snapshot: &RuntimeLedgerSnapshot,
) -> Result<PaperExecutionSimulation, PaperExecutionError> {
    if plan.slices.is_empty() {
        return Err(PaperExecutionError::MissingSlices);
    }
    if deployment.pair.market_type != RuntimeVenueMarketType::Spot {
        return Err(PaperExecutionError::UnsupportedMarketType(
            deployment.pair.market_type.clone(),
        ));
    }

    let profile = profile_for(deployment, plan);
    let mut expected_ledger = ledger_snapshot.clone();
    let mut observed_ledger = ledger_snapshot.clone();
    let mut encountered_partial = false;
    let mut encountered_cancel = false;
    let mut simulation_notes = vec![
        format!("paper-profile:{}", deployment.venue_key),
        format!("paper-lifecycle:{}", profile.lifecycle),
        format!("paper-fill-bps:{}", profile.fill_bps),
        format!("paper-fee-bps:{}", profile.fee_bps),
        format!("paper-impact-bps:{}", profile.impact_bps),
        format!("paper-submit-latency-ms:{}", profile.submit_latency_ms),
        format!(
            "paper-settlement-latency-ms:{}",
            profile.settlement_latency_ms
        ),
        format!("paper-slice-count:{}", plan.slices.len()),
    ];

    for slice in &plan.slices {
        let slice_result = simulate_slice(deployment, slice, &expected_ledger, profile)?;
        encountered_partial |= slice_result.observed_fill_bps < 10_000;
        encountered_cancel |= slice_result.observed_input_atomic == 0;
        if slice_result.expected_input_atomic < slice_result.requested_input_atomic {
            simulation_notes.push(format!("paper-balance-clamped:{}", slice.slice_id));
        }
        apply_simulated_trade(
            deployment,
            &mut expected_ledger,
            slice,
            slice_result.expected_input_atomic,
            slice_result.expected_output_atomic,
        )?;
        apply_simulated_trade(
            deployment,
            &mut observed_ledger,
            slice,
            slice_result.observed_input_atomic,
            slice_result.observed_output_atomic,
        )?;
    }

    let observed_at = add_latency(
        &plan.created_at,
        profile.submit_latency_ms + profile.settlement_latency_ms,
    )?;
    expected_ledger.snapshot_id = format!("paper_expected_{}", plan.plan_id);
    expected_ledger.as_of = observed_at.clone();
    expected_ledger.totals = compute_totals(&expected_ledger);
    observed_ledger.snapshot_id = format!("paper_observed_{}", plan.plan_id);
    observed_ledger.as_of = observed_at.clone();
    observed_ledger.totals = compute_totals(&observed_ledger);

    let receipt_status = if encountered_cancel {
        "cancelled"
    } else if encountered_partial && profile.cancel_remaining {
        "partially_filled"
    } else {
        "filled"
    };
    if profile.cancel_remaining && encountered_partial {
        simulation_notes.push("paper-remaining-quantity-cancelled".to_string());
    }

    Ok(PaperExecutionSimulation {
        expected_ledger,
        observed_ledger: observed_ledger.clone(),
        submit: ExecSubmitResponse {
            ok: true,
            accepted: true,
            source: PAPER_EXECUTION_SOURCE.to_string(),
            submit_request_id: format!("paper_submit_{}", plan.plan_id),
            coordination: ExecPlanCoordination {
                plan_id: plan.plan_id.clone(),
                deployment_id: plan.deployment_id.clone(),
                run_id: plan.run_id.clone(),
                mode: plan.mode.clone(),
                lane: plan.lane.clone(),
                slice_count: plan.slices.len(),
            },
            receipt: Some(ExecReceiptObservation {
                receipt_id: format!("paper_receipt_{}", plan.plan_id),
                observed_at,
                status: receipt_status.to_string(),
                notes: simulation_notes,
                signature: None,
                provider: Some(PAPER_EXECUTION_SOURCE.to_string()),
            }),
            observed_ledger: Some(observed_ledger),
        },
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SliceSimulationResult {
    requested_input_atomic: u128,
    expected_input_atomic: u128,
    expected_output_atomic: u128,
    observed_input_atomic: u128,
    observed_output_atomic: u128,
    observed_fill_bps: u16,
}

fn simulate_slice(
    deployment: &RuntimeDeploymentRecord,
    slice: &RuntimeExecutionSlice,
    ledger_snapshot: &RuntimeLedgerSnapshot,
    profile: PaperVenueProfile,
) -> Result<SliceSimulationResult, PaperExecutionError> {
    let requested_input_atomic = parse_atomic(
        "plan.slices[].inputAmountAtomic",
        &slice.input_amount_atomic,
    )?;
    let available_input_atomic = available_atomic(ledger_snapshot, &slice.input_mint)?;
    let expected_input_atomic = requested_input_atomic.min(available_input_atomic);
    let requested_output_atomic = slice
        .min_output_amount_atomic
        .as_deref()
        .map(|value| parse_atomic("plan.slices[].minOutputAmountAtomic", value))
        .transpose()?
        .unwrap_or(requested_input_atomic);
    let expected_output_atomic = scale_atomic(
        requested_output_atomic,
        expected_input_atomic,
        requested_input_atomic,
    );
    let effective_cost_bps = u32::from(profile.fee_bps) + u32::from(profile.impact_bps);
    let observed_fill_bps = if expected_input_atomic == 0 {
        0
    } else {
        profile.fill_bps.min(10_000)
    };
    let observed_input_atomic = scale_bps(expected_input_atomic, u32::from(observed_fill_bps));
    let observed_output_before_cost =
        scale_bps(expected_output_atomic, u32::from(observed_fill_bps));
    let observed_output_atomic = scale_bps(
        observed_output_before_cost,
        10_000_u32.saturating_sub(effective_cost_bps.min(9_999)),
    );

    if deployment.venue_key == "phoenix"
        && slice.action == RuntimeExecutionAction::Sell
        && observed_input_atomic == 0
    {
        return Ok(SliceSimulationResult {
            requested_input_atomic,
            expected_input_atomic: 0,
            expected_output_atomic: 0,
            observed_input_atomic: 0,
            observed_output_atomic: 0,
            observed_fill_bps: 0,
        });
    }

    Ok(SliceSimulationResult {
        requested_input_atomic,
        expected_input_atomic,
        expected_output_atomic,
        observed_input_atomic,
        observed_output_atomic,
        observed_fill_bps,
    })
}

fn apply_simulated_trade(
    deployment: &RuntimeDeploymentRecord,
    snapshot: &mut RuntimeLedgerSnapshot,
    slice: &RuntimeExecutionSlice,
    input_atomic: u128,
    output_atomic: u128,
) -> Result<(), PaperExecutionError> {
    let (base_symbol, quote_symbol) = deployment
        .pair
        .symbol
        .split_once('/')
        .unwrap_or(("BASE", "QUOTE"));
    let base_price_usd = infer_price_usd(
        snapshot,
        &deployment.pair.base_mint,
        slice,
        deployment,
        input_atomic,
        output_atomic,
    );
    let input_price_usd = price_for_mint(
        snapshot,
        &slice.input_mint,
        deployment,
        base_symbol,
        quote_symbol,
        base_price_usd,
    );
    let output_price_usd = price_for_mint(
        snapshot,
        &slice.output_mint,
        deployment,
        base_symbol,
        quote_symbol,
        base_price_usd,
    );

    consume_balance(
        snapshot,
        &slice.input_mint,
        symbol_for_mint(&slice.input_mint, deployment, base_symbol, quote_symbol),
        decimals_for_mint(snapshot, &slice.input_mint),
        input_atomic,
        Some(input_price_usd),
    )?;
    add_to_balance(
        snapshot,
        &slice.output_mint,
        symbol_for_mint(&slice.output_mint, deployment, base_symbol, quote_symbol),
        decimals_for_mint(snapshot, &slice.output_mint),
        output_atomic,
        Some(output_price_usd),
    )?;

    let base_delta_atomic = match slice.action {
        RuntimeExecutionAction::Buy if slice.output_mint == deployment.pair.base_mint => {
            output_atomic as i128
        }
        RuntimeExecutionAction::Sell if slice.input_mint == deployment.pair.base_mint => {
            -(input_atomic as i128)
        }
        _ => 0,
    };
    if base_delta_atomic != 0 {
        apply_position_delta(
            snapshot,
            &deployment.pair.symbol,
            base_delta_atomic,
            base_price_usd,
        )?;
    }

    Ok(())
}

fn profile_for(
    deployment: &RuntimeDeploymentRecord,
    plan: &RuntimeExecutionPlan,
) -> PaperVenueProfile {
    let seed = stable_hash(&format!(
        "{}:{}:{}:{}",
        deployment.venue_key, deployment.pair.symbol, plan.run_id, plan.idempotency_key
    ));
    match deployment.venue_key.as_str() {
        "phoenix" => PaperVenueProfile {
            lifecycle: "orderbook-passive",
            fill_bps: 9_200_u16.saturating_sub((seed % 250) as u16),
            fee_bps: 4,
            impact_bps: 8,
            submit_latency_ms: 90 + (seed % 40) as i64,
            settlement_latency_ms: 800 + (seed % 200) as i64,
            cancel_remaining: true,
        },
        "magicblock" => PaperVenueProfile {
            lifecycle: "accelerated-spot-routing",
            fill_bps: 9_600_u16.saturating_sub((seed % 180) as u16),
            fee_bps: 6,
            impact_bps: 10,
            submit_latency_ms: 120 + (seed % 50) as i64,
            settlement_latency_ms: 700 + (seed % 180) as i64,
            cancel_remaining: true,
        },
        _ => PaperVenueProfile {
            lifecycle: "aggregator-immediate",
            fill_bps: 9_850_u16.saturating_sub((seed % 80) as u16),
            fee_bps: 8,
            impact_bps: 12,
            submit_latency_ms: 260 + (seed % 80) as i64,
            settlement_latency_ms: 1_000 + (seed % 300) as i64,
            cancel_remaining: false,
        },
    }
}

fn stable_hash(value: &str) -> u64 {
    value
        .bytes()
        .fold(1_469_598_103_934_665_603_u64, |hash, byte| {
            hash.wrapping_mul(1_099_511_628_211)
                .wrapping_add(u64::from(byte))
        })
}

fn add_latency(value: &str, latency_ms: i64) -> Result<String, PaperExecutionError> {
    let timestamp = OffsetDateTime::parse(value, &Rfc3339).map_err(|_| {
        PaperExecutionError::InvalidTimestamp {
            field: "plan.createdAt",
            value: value.to_string(),
        }
    })?;
    let observed = timestamp + Duration::milliseconds(latency_ms.max(0));
    observed
        .format(&Rfc3339)
        .map_err(|_| PaperExecutionError::InvalidTimestamp {
            field: "plan.createdAt",
            value: value.to_string(),
        })
}

fn parse_atomic(field: &'static str, value: &str) -> Result<u128, PaperExecutionError> {
    value
        .trim()
        .parse::<u128>()
        .map_err(|_| PaperExecutionError::InvalidAtomic {
            field,
            value: value.to_string(),
        })
}

fn available_atomic(
    snapshot: &RuntimeLedgerSnapshot,
    mint: &str,
) -> Result<u128, PaperExecutionError> {
    let Some(balance) = snapshot
        .balances
        .iter()
        .find(|balance| balance.mint == mint)
    else {
        return Ok(0);
    };
    let free = parse_atomic("ledger.balances[].freeAtomic", &balance.free_atomic)?;
    let reserved = parse_atomic("ledger.balances[].reservedAtomic", &balance.reserved_atomic)?;
    Ok(free.saturating_add(reserved))
}

fn scale_atomic(numerator: u128, amount: u128, denominator: u128) -> u128 {
    if denominator == 0 {
        0
    } else {
        numerator.saturating_mul(amount) / denominator
    }
}

fn scale_bps(amount: u128, bps: u32) -> u128 {
    amount.saturating_mul(u128::from(bps)) / 10_000
}

fn decimals_for_mint(snapshot: &RuntimeLedgerSnapshot, mint: &str) -> u8 {
    snapshot
        .balances
        .iter()
        .find(|balance| balance.mint == mint)
        .map(|balance| balance.decimals)
        .unwrap_or_else(|| if mint == USDC_MINT { 6 } else { 9 })
}

fn symbol_for_mint<'a>(
    mint: &'a str,
    deployment: &'a RuntimeDeploymentRecord,
    base_symbol: &'a str,
    quote_symbol: &'a str,
) -> &'a str {
    if mint == deployment.pair.base_mint {
        base_symbol
    } else if mint == deployment.pair.quote_mint {
        quote_symbol
    } else {
        mint
    }
}

fn price_for_mint(
    snapshot: &RuntimeLedgerSnapshot,
    mint: &str,
    deployment: &RuntimeDeploymentRecord,
    base_symbol: &str,
    quote_symbol: &str,
    base_price_usd: f64,
) -> f64 {
    if let Some(price) = snapshot
        .balances
        .iter()
        .find(|balance| balance.mint == mint)
        .and_then(|balance| balance.price_usd.as_deref())
        .and_then(parse_usd_f64)
    {
        return price;
    }
    if mint == deployment.pair.quote_mint
        || symbol_for_mint(mint, deployment, base_symbol, quote_symbol) == "USDC"
    {
        1.0
    } else {
        base_price_usd.max(0.0)
    }
}

fn infer_price_usd(
    snapshot: &RuntimeLedgerSnapshot,
    base_mint: &str,
    slice: &RuntimeExecutionSlice,
    deployment: &RuntimeDeploymentRecord,
    input_atomic: u128,
    output_atomic: u128,
) -> f64 {
    if let Some(price) = snapshot
        .balances
        .iter()
        .find(|balance| balance.mint == base_mint)
        .and_then(|balance| balance.price_usd.as_deref())
        .and_then(parse_usd_f64)
    {
        return price;
    }
    let notional_usd = parse_usd_f64(&slice.notional_usd).unwrap_or(0.0);
    if slice.output_mint == base_mint && output_atomic > 0 {
        let base_units = atomic_to_units(output_atomic, decimals_for_mint(snapshot, base_mint));
        if base_units > 0.0 {
            return notional_usd / base_units;
        }
    }
    if slice.input_mint == base_mint && input_atomic > 0 {
        let base_units = atomic_to_units(input_atomic, decimals_for_mint(snapshot, base_mint));
        if base_units > 0.0 {
            return notional_usd / base_units;
        }
    }
    let (base_symbol, quote_symbol) = deployment
        .pair
        .symbol
        .split_once('/')
        .unwrap_or(("BASE", "QUOTE"));
    let base_balance = snapshot
        .balances
        .iter()
        .find(|balance| balance.symbol == base_symbol || balance.symbol == quote_symbol);
    base_balance
        .and_then(|balance| balance.price_usd.as_deref())
        .and_then(parse_usd_f64)
        .unwrap_or(100.0)
}

fn consume_balance(
    snapshot: &mut RuntimeLedgerSnapshot,
    mint: &str,
    symbol: &str,
    decimals: u8,
    amount_atomic: u128,
    price_usd: Option<f64>,
) -> Result<(), PaperExecutionError> {
    let balance = upsert_balance(snapshot, mint, symbol, decimals, price_usd);
    let mut free = parse_atomic("ledger.balances[].freeAtomic", &balance.free_atomic)?;
    let mut reserved = parse_atomic("ledger.balances[].reservedAtomic", &balance.reserved_atomic)?;
    let consume_free = free.min(amount_atomic);
    free = free.saturating_sub(consume_free);
    reserved = reserved.saturating_sub(amount_atomic.saturating_sub(consume_free));
    balance.free_atomic = free.to_string();
    balance.reserved_atomic = reserved.to_string();
    if let Some(price) = price_usd {
        balance.price_usd = Some(format_usd(price));
    }
    Ok(())
}

fn add_to_balance(
    snapshot: &mut RuntimeLedgerSnapshot,
    mint: &str,
    symbol: &str,
    decimals: u8,
    amount_atomic: u128,
    price_usd: Option<f64>,
) -> Result<(), PaperExecutionError> {
    let balance = upsert_balance(snapshot, mint, symbol, decimals, price_usd);
    let free = parse_atomic("ledger.balances[].freeAtomic", &balance.free_atomic)?;
    balance.free_atomic = free.saturating_add(amount_atomic).to_string();
    if let Some(price) = price_usd {
        balance.price_usd = Some(format_usd(price));
    }
    Ok(())
}

fn upsert_balance<'a>(
    snapshot: &'a mut RuntimeLedgerSnapshot,
    mint: &str,
    symbol: &str,
    decimals: u8,
    price_usd: Option<f64>,
) -> &'a mut RuntimeLedgerBalance {
    if let Some(index) = snapshot
        .balances
        .iter()
        .position(|balance| balance.mint == mint)
    {
        return &mut snapshot.balances[index];
    }
    snapshot.balances.push(RuntimeLedgerBalance {
        mint: mint.to_string(),
        symbol: symbol.to_string(),
        decimals,
        free_atomic: "0".to_string(),
        reserved_atomic: "0".to_string(),
        price_usd: price_usd.map(format_usd),
    });
    snapshot
        .balances
        .last_mut()
        .expect("newly pushed balance to exist")
}

fn apply_position_delta(
    snapshot: &mut RuntimeLedgerSnapshot,
    instrument_id: &str,
    delta_atomic: i128,
    mark_price_usd: f64,
) -> Result<(), PaperExecutionError> {
    let existing_index = snapshot
        .positions
        .iter()
        .position(|position| position.instrument_id == instrument_id);
    let current = existing_index
        .map(|index| {
            parse_atomic(
                "ledger.positions[].quantityAtomic",
                &snapshot.positions[index].quantity_atomic,
            )
        })
        .transpose()?
        .unwrap_or(0);
    let next = (current as i128 + delta_atomic).max(0) as u128;
    if next == 0 {
        if let Some(index) = existing_index {
            snapshot.positions.remove(index);
        }
        return Ok(());
    }
    let position = RuntimeLedgerPosition {
        instrument_id: instrument_id.to_string(),
        side: RuntimePositionSide::Long,
        quantity_atomic: next.to_string(),
        entry_price_usd: Some(format_usd(mark_price_usd)),
        mark_price_usd: Some(format_usd(mark_price_usd)),
        unrealized_pnl_usd: Some("0.00".to_string()),
    };
    if let Some(index) = existing_index {
        snapshot.positions[index] = position;
    } else {
        snapshot.positions.push(position);
    }
    Ok(())
}

fn compute_totals(snapshot: &RuntimeLedgerSnapshot) -> RuntimeLedgerTotals {
    let mut equity_usd = 0.0;
    let mut reserved_usd = 0.0;
    for balance in &snapshot.balances {
        let price = balance
            .price_usd
            .as_deref()
            .and_then(parse_usd_f64)
            .unwrap_or(0.0);
        let decimals = balance.decimals;
        let free = parse_atomic("ledger.balances[].freeAtomic", &balance.free_atomic).unwrap_or(0);
        let reserved =
            parse_atomic("ledger.balances[].reservedAtomic", &balance.reserved_atomic).unwrap_or(0);
        equity_usd += atomic_to_units(free.saturating_add(reserved), decimals) * price;
        reserved_usd += atomic_to_units(reserved, decimals) * price;
    }
    RuntimeLedgerTotals {
        equity_usd: format_usd(equity_usd),
        reserved_usd: format_usd(reserved_usd),
        available_usd: format_usd((equity_usd - reserved_usd).max(0.0)),
        realized_pnl_usd: snapshot.totals.realized_pnl_usd.clone(),
        unrealized_pnl_usd: snapshot.totals.unrealized_pnl_usd.clone(),
    }
}

fn atomic_to_units(value: u128, decimals: u8) -> f64 {
    value as f64 / 10_f64.powi(i32::from(decimals))
}

fn parse_usd_f64(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok()
}

fn format_usd(value: f64) -> String {
    format!("{:.2}", value.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{
        RuntimeCapital, RuntimeDeploymentState, RuntimeLane, RuntimeLedgerTotals, RuntimeMode,
        RuntimePolicy,
    };

    fn deployment(venue_key: &str) -> RuntimeDeploymentRecord {
        RuntimeDeploymentRecord {
            schema_version: "v1".to_string(),
            deployment_id: format!("deployment_{venue_key}_paper"),
            strategy_key: "dca".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            owner_user_id: "user_123".to_string(),
            venue_key: venue_key.to_string(),
            pair: protocol::RuntimePair {
                symbol: "SOL/USDC".to_string(),
                base_mint: "So11111111111111111111111111111111111111112".to_string(),
                quote_mint: USDC_MINT.to_string(),
                market_type: RuntimeVenueMarketType::Spot,
            },
            mode: RuntimeMode::Paper,
            state: RuntimeDeploymentState::Paper,
            lane: RuntimeLane::Safe,
            created_at: "2026-03-11T10:00:00Z".to_string(),
            updated_at: "2026-03-11T10:00:00Z".to_string(),
            promoted_at: None,
            paused_at: None,
            killed_at: None,
            policy: RuntimePolicy {
                max_notional_usd: "25.00".to_string(),
                daily_loss_limit_usd: "10.00".to_string(),
                max_slippage_bps: 50,
                max_concurrent_runs: 1,
                rebalance_tolerance_bps: 100,
            },
            capital: RuntimeCapital {
                allocated_usd: "1000.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "995.00".to_string(),
            },
            tags: vec!["paper".to_string()],
        }
    }

    fn plan(venue_key: &str, action: RuntimeExecutionAction) -> RuntimeExecutionPlan {
        let is_buy = action == RuntimeExecutionAction::Buy;
        RuntimeExecutionPlan {
            schema_version: "v1".to_string(),
            plan_id: format!("plan_{venue_key}"),
            deployment_id: format!("deployment_{venue_key}_paper"),
            venue_key: venue_key.to_string(),
            owner_user_id: Some("user_123".to_string()),
            sleeve_id: Some("sleeve_alpha".to_string()),
            run_id: format!("run_{venue_key}"),
            created_at: "2026-03-11T10:00:00Z".to_string(),
            mode: RuntimeMode::Paper,
            lane: RuntimeLane::Safe,
            idempotency_key: format!("paper:{venue_key}"),
            simulate_only: false,
            dry_run: true,
            slices: vec![RuntimeExecutionSlice {
                slice_id: "slice_1".to_string(),
                action,
                input_mint: if is_buy {
                    USDC_MINT.to_string()
                } else {
                    "So11111111111111111111111111111111111111112".to_string()
                },
                output_mint: if is_buy {
                    "So11111111111111111111111111111111111111112".to_string()
                } else {
                    USDC_MINT.to_string()
                },
                input_amount_atomic: if is_buy {
                    "5000000".to_string()
                } else {
                    "35000000".to_string()
                },
                min_output_amount_atomic: Some(if is_buy {
                    "35000000".to_string()
                } else {
                    "5000000".to_string()
                }),
                notional_usd: "5.00".to_string(),
                slippage_bps: 50,
            }],
        }
    }

    fn ledger_snapshot() -> RuntimeLedgerSnapshot {
        RuntimeLedgerSnapshot {
            schema_version: "v1".to_string(),
            snapshot_id: "ledger_1".to_string(),
            deployment_id: "deployment_jupiter_paper".to_string(),
            sleeve_id: "sleeve_alpha".to_string(),
            as_of: "2026-03-11T10:00:00Z".to_string(),
            balances: vec![
                RuntimeLedgerBalance {
                    mint: USDC_MINT.to_string(),
                    symbol: "USDC".to_string(),
                    decimals: 6,
                    free_atomic: "995000000".to_string(),
                    reserved_atomic: "5000000".to_string(),
                    price_usd: Some("1.00".to_string()),
                },
                RuntimeLedgerBalance {
                    mint: "So11111111111111111111111111111111111111112".to_string(),
                    symbol: "SOL".to_string(),
                    decimals: 9,
                    free_atomic: "35000000".to_string(),
                    reserved_atomic: "0".to_string(),
                    price_usd: Some("142.85".to_string()),
                },
            ],
            positions: vec![RuntimeLedgerPosition {
                instrument_id: "SOL/USDC".to_string(),
                side: RuntimePositionSide::Long,
                quantity_atomic: "35000000".to_string(),
                entry_price_usd: Some("142.85".to_string()),
                mark_price_usd: Some("142.85".to_string()),
                unrealized_pnl_usd: Some("0.00".to_string()),
            }],
            totals: RuntimeLedgerTotals {
                equity_usd: "1000.00".to_string(),
                reserved_usd: "5.00".to_string(),
                available_usd: "995.00".to_string(),
                realized_pnl_usd: "0.00".to_string(),
                unrealized_pnl_usd: "0.00".to_string(),
            },
        }
    }

    #[test]
    fn simulates_jupiter_paper_buys_with_observed_ledger() {
        let deployment = deployment("jupiter");
        let mut plan = plan("jupiter", RuntimeExecutionAction::Buy);
        plan.owner_user_id = Some("user_123".to_string());

        let simulation = simulate_paper_execution(&deployment, &plan, &ledger_snapshot())
            .expect("paper simulation");

        assert_eq!(simulation.submit.source, PAPER_EXECUTION_SOURCE);
        assert_eq!(simulation.submit.coordination.mode, RuntimeMode::Paper);
        assert!(simulation.submit.observed_ledger.is_some());
        let receipt = simulation.submit.receipt.expect("receipt");
        assert!(receipt
            .notes
            .iter()
            .any(|note| note == "paper-profile:jupiter"));
        assert_eq!(receipt.status, "filled");
        assert_ne!(
            simulation.expected_ledger.snapshot_id,
            simulation.observed_ledger.snapshot_id
        );
    }

    #[test]
    fn simulates_phoenix_partial_fill_and_cancelled_remainder() {
        let deployment = deployment("phoenix");
        let plan = plan("phoenix", RuntimeExecutionAction::Sell);

        let simulation = simulate_paper_execution(&deployment, &plan, &ledger_snapshot())
            .expect("paper simulation");

        let receipt = simulation.submit.receipt.expect("receipt");
        assert_eq!(receipt.status, "partially_filled");
        assert!(receipt
            .notes
            .iter()
            .any(|note| note == "paper-remaining-quantity-cancelled"));
        let observed_position = simulation
            .observed_ledger
            .positions
            .iter()
            .find(|position| position.instrument_id == "SOL/USDC")
            .expect("observed position");
        assert_ne!(observed_position.quantity_atomic, "35000000");
    }
}
