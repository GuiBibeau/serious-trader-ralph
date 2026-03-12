# Strategy Lab Ops Runbook

## Purpose

This runbook defines how operators should control candidate strategies, venues,
and assets as they move from research to bounded real-money validation.

## Operating model

- The Worker remains the public edge and the operator control surface.
- Strategy-lab promotion states are separate from runtime deployment states.
- Human review remains mandatory before any real-money promotion.
- Pause, demotion, and kill actions should happen before code rollback where
  possible.

## Production-facing states and required controls

| State | Required controls | Minimum operator checks | Immediate rollback path |
| --- | --- | --- | --- |
| `paper` | paper-only runtime path, scorecards, reproducibility bundle | paper scorecards, cost assumptions, venue or asset readiness | pause or demote to `shadow` |
| `limited_live` | allowlist, bounded notional, kill switch, venue or asset readiness gate | paper evidence, canary plan, allocator and risk review, explicit human approval | kill deployment, remove from allowlist, demote to `paper` |
| `broad_live` | successful limited-live soak, drift monitoring, rollback drills | limited-live soak summary, cost drift review, operator approval | demote to `limited_live`, pause, or kill |

## Required evidence before real-money promotion

- reproducibility bundle tied to exact code and data revisions,
- shadow and paper scorecards for the candidate,
- venue and asset readiness state for every real-money dependency,
- risk budget and allocator review where capital contention exists,
- a bounded canary plan with kill controls,
- explicit human approval recorded in the issue, PR, or operator record.

## Routine operator actions

### Review candidate readiness

Confirm:

- the candidate state is correct,
- the required evidence bundle is attached,
- venue and asset readiness states are sufficient,
- no open incident blocks promotion.

### Approve paper promotion

Use paper when:

- replay and shadow evidence are stable,
- cost models exist,
- paper execution will still remain wallet-safe.

Expected effect:

- candidate remains non-monetary,
- paper receipts and scorecards become first-class evidence,
- later limited-live decisions can compare modeled versus observed behavior.

### Approve limited-live promotion

Use limited live only when:

- the candidate has cleared paper scorecards,
- venue and asset readiness are at least `limited_live_ready`,
- the canary plan is tiny-notional and reversible,
- a named human approves the promotion.

Expected effect:

- the strategy is allowlisted for bounded real-money validation only,
- drift and canary results become new evidence,
- operators retain immediate pause and kill paths.

### Demote or pause a candidate

Use pause or demotion when:

- evidence weakens,
- venue or asset health degrades,
- allocator pressure changes materially,
- operator confidence is lost.

Expected effect:

- no broader promotion occurs,
- prior evidence remains auditable,
- later resume requires explicit human review.

### Kill a limited-live candidate

Use kill when:

- live canary behavior is unsafe,
- venue or asset assumptions break,
- reconciliation or observed costs diverge materially,
- the strategy enters a state that policy disallows.

Expected effect:

- bounded live execution stops immediately,
- allowlists and readiness states can be tightened,
- follow-up requires human review and updated evidence.

## Rollback order of operations

1. Pause or kill the candidate deployment.
2. Remove the strategy, venue, or asset from the relevant allowlist.
3. Demote the promotion state in the operator record.
4. Trigger code rollback only if the incident is code-driven.
5. Preserve all evidence and incident notes for later review.

## Required drills

- limited-live kill drill before calling a new real-money path ready,
- demotion drill from `broad_live` to `limited_live`,
- venue or asset-specific disable drill,
- evidence reconstruction drill from stored manifests and scorecards.

## Post-live monitoring loop

Run recurring post-live checks through the Worker admin surface and the checked-in
request files:

```bash
bun run strategy-lab:post-live \
  --request-file docs/strategy-lab/pilots/trend-following-sol-usdc/post-live.request.json

bun run strategy-lab:post-live \
  --request-file docs/strategy-lab/pilots/jup-onboarding/post-live.asset.request.json

bun run strategy-lab:post-live \
  --request-file docs/strategy-lab/pilots/jup-onboarding/post-live.venue.request.json
```

Review all of the following on each run:

- strategy failure, manual-review, and drift-alert rates,
- live cost drift and latency drift against the active cost-model guard,
- feature freshness and coverage,
- venue and asset control state,
- latest readiness canary status and reconciliation result,
- any externally injected venue-health or asset-event checks.

When drift is material:

1. Re-run the post-live review with an explicit blocked check if you are
   executing a drill or an external alert has already been confirmed.
2. Apply the recommended fail-closed action.
   Strategy drift should demote to `paper` or pause the bounded live deployment.
   Venue or asset drift should disable live allowance and enable the kill switch.
3. Preserve the post-live artifact, follow-up promotion record, and any control
   changes as the canonical incident trail.
