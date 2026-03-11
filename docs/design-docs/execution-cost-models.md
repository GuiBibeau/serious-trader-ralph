# Execution Cost Models

## Purpose

Execution cost models are versioned runtime records that let strategy evaluation use auditable,
venue-aware assumptions instead of optimistic zero-cost execution.

They are stored in the runtime-owned `cost-model-registry` crate and exposed through the Worker
bridge at:

- `GET /api/internal/runtime/cost-models`
- `POST /api/internal/runtime/cost-models`

## Record shape

Each `RuntimeExecutionCostModelRecord` captures:

- `venueKey`
- `marketType`
- `pairSymbol`
- optional `instrumentId`
- `assetKeys`
- `modeCoverage`
- cost assumptions:
  - `feeBps`
  - `slippageBps`
  - `marketImpactBps`
  - `partialFillRateBps`
  - `partialFillPenaltyBps`
  - optional `financingCostBpsPerDay`
- expected latency profile:
  - `expectedQuoteMs`
  - `expectedSubmitMs`
  - `expectedSettlementMs`
- `datasetSnapshots` for calibration provenance

## Scorecard integration

Promotion scorecards consume the active cost model selected for the deployment venue and pair.

The current scorecard computes:

- evaluated notional
- modeled total cost
- observed total cost proxy
- cost drift in USD and bps
- expected end-to-end latency
- observed end-to-end latency
- latency drift
- reconciliation drift count

Modeled cost uses:

`fee + slippage + market impact + expected partial-fill penalty`

Where expected partial-fill penalty is:

`partialFillRateBps * partialFillPenaltyBps / 10_000`

Observed cost is currently approximated as:

`modeled cost + absolute reconciliation position drift`

This is intentionally conservative until richer receipt-level fee and fill telemetry exists.

## Promotion gates

Shadow and paper promotion now require:

- an active cost model
- full modeled-cost coverage for planned runs
- bounded cost drift
- bounded latency drift

If the model is missing, draft-only, or too far from observed runtime behavior, promotion fails
closed.

## Future market types

The contract is intentionally not spot-only.

`marketType` already supports:

- `spot`
- `perp`
- `options`

That means future extensions such as perps execution can reuse the same registry and scorecard
surface. The expected next step for perps is to populate `instrumentId` with venue-native contract
identifiers and start using `financingCostBpsPerDay` in paper/live evaluation once carrying costs
matter.
