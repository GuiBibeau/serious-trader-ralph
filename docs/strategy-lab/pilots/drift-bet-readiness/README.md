# Drift BET Readiness

- Reviewed on: `2026-03-14`
- Issue: `#378`
- Venue: `drift_bet`
- Instrument class: `prediction`
- Verdict: `candidate`
- Highest justified state: `candidate`
- Stop before: `integrated`

## Official Sources Reviewed

- [Drift update: raising the stakes with BET](https://www.drift.trade/updates)
- [Drift v2 teacher prediction-market docs](https://github.com/drift-labs/v2-teacher/blob/master/source/includes/_prediction_markets.md)
- [Drift common prediction-market constants](https://github.com/drift-labs/drift-common/blob/master/common-ts/src/constants/predictionMarket.ts)
- [Drift protocol v2 repo](https://github.com/drift-labs/protocol-v2)

## What The Official Material Supports

The official Drift materials are strong enough to conclude that BET is a
prediction-market extension of the Drift venue family, not a brand-new custody
or margin venue.

- Drift's own prediction-market docs state that prediction markets are perp
  markets with `contract_type` set as `Prediction`.
- The same docs say the instrument follows the perp account model with extra
  rules: prices stay between `0` and `1`, funding is paused, margin ratios are
  pinned to `1`, short valuation uses `1 - oracle price`, and the oracle is a
  prelaunch-style mark TWAP.
- The official `drift-common` repo exports prediction-market constants derived
  from `@drift-labs/sdk`, which shows the SDK surface already models the
  instrument type at the code level.

## Repo-Owned Contract Decision

Drift BET should be modeled as:

- a separate `prediction_order` venue capability in Ralph
- a follow-on of the Drift adapter family rather than a new venue stack
- shared custody, account, and margin semantics with Drift perps
- prediction-specific risk and validation rules layered on top of the Drift
  account model

That means BET should not be forced into `perp_order`, even though it shares
the same account substrate.

## Why It Stops At Candidate

The official developer surface is still too fragmented to justify an
implementation PR right now.

- The explicit prediction-market docs are discoverable through the older
  `v2-teacher` repo, not through the main `docs.drift.trade` developer flow.
- The repo does not yet have maintained examples for BET market discovery,
  order placement, cancellation, settlement, or replay fixtures.
- Ralph still needs a venue-specific mapping for prediction-market settlement
  and outcome resolution within the Worker-owned reconciliation layer.

## Next Implementation Slice

The follow-on implementation issue should stay to one PR and do only this:

1. Add Drift prediction-market discovery and instrument metadata reads.
2. Reuse the Drift account client path while routing BET through
   `prediction_order` intent handling.
3. Add bounded shadow fixtures for order lifecycle, position lifecycle, and
   prediction settlement.
4. Add oracle and price-band guards for `0..1` pricing plus fully collateralized
   margin checks.
