# Jupiter Perps Readiness Pilot

This pilot records the current Jupiter Perps readiness verdict without
pretending the venue is ready for live use.

## Goal

- Venue: `jupiter_perps`
- Instrument class: `perp`
- Highest justified state on 2026-03-13: `integrated`
- Stop state: do not advance beyond `integrated`

## Official Sources Reviewed On 2026-03-13

- [About Perps API](https://dev.jup.ag/docs/perps/about-perps-api)
  - The official docs still describe the Perps API as a work in progress.
- [Position Account](https://dev.jup.ag/docs/perps/position-account)
  - Documents wallet and custody derived position accounts plus long and short
    position slots.
- [Pool Account](https://dev.jup.ag/docs/perps/pool-account)
  - Documents pool state, AUM, custody relationships, and fee accounting.
- [Custody Account](https://dev.jup.ag/docs/perps/custody-account)
  - Documents collateral and target custody accounts, pricing fields, and
    funding or borrow style accounting inputs.

## Verdict

`jupiter_perps` is strong enough to model as a separate venue capability with a
separate subject-control surface from Jupiter spot. It is not strong enough to
claim `shadow_ready`, `paper_ready`, or any live-readiness state.

The current repo changes justify `integrated` only because:

- the official docs expose a concrete position-account settlement model,
- the venue can be represented as a first-class `perp_order` venue in the
  runtime catalog,
- the venue now has a dedicated control key so its live posture can stay
  blocked independently of Jupiter spot.

## Why This Stops At `integrated`

- The official docs still frame the API as work in progress.
- Trader Ralph does not yet have a Jupiter Perps execution adapter.
- The repo does not yet contain replay fixtures or adapter validation for
  Jupiter Perps lifecycle events.
- The repo does not yet contain paper lifecycle coverage, venue-specific cost
  models, or oracle reconciliation for Jupiter Perps positions.
- No bounded canary plan or allowlist change is justified while the surface is
  still WIP and unintegrated at the adapter layer.

## Follow-Up Gates

- `shadow_ready`
  - add adapter validation and deterministic replay fixtures for account,
    order, and position reconciliation.
- `paper_ready`
  - add paper lifecycle coverage, venue-specific cost models, and oracle sanity
    checks.
- `limited_live_ready`
  - add a bounded canary plan, explicit allowlist change, and human approval
    after paper evidence is stable.

## Harness Sequence

1. Keep the venue live-disabled:

```bash
bun run strategy-lab:readiness \
  --operation control \
  --request-file docs/strategy-lab/pilots/jupiter-perps-readiness/control.venue.request.json
```

2. Validate the promotion verdict and venue metadata:

```bash
bun test \
  tests/unit/runtime_research_promotion.test.ts \
  tests/unit/runtime_venue_catalog.test.ts
```
