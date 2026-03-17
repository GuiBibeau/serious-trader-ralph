# ADR-0005: Strategy desk composite scenarios stay distinct from runtime deployments

## Status

Accepted on 2026-03-17

## Context

The current runtime contracts are intentionally narrow:

- `RuntimeDeploymentRecord` is single-venue and single-pair.
- `RuntimeExecutionPlan` carries one `venueKey` and generic slices.
- The shared execution planner still reasons about one venue capability at a
  time.

That is enough for bounded managed runtime execution, but it is not the right
abstraction for a strategy desk that needs to test composite scenarios across
spot, perps, prediction, and flash paths before deciding whether any subset of
those legs should move toward bounded execution.

Without a repo-owned contract for the desk layer, composite testing would drift
into ad hoc harness manifests and one-off portal payloads.

## Decision

Introduce a strategy-desk contract family inside the existing runtime contract
surface with four first-class objects:

- `RuntimeStrategyDeskScenarioManifest`
- `RuntimeStrategyDeskScenarioRun`
- `RuntimeStrategyDeskScenarioReport`
- `RuntimeStrategyDeskPromotionHandoff`

These objects are harness-native and desk-side. They do not replace or widen
the existing runtime deployment schema.

## Rationale

- A desk scenario needs to describe multiple legs with independent venue,
  market-type, and intent-family properties.
- A desk run needs to collect evidence across those legs without pretending the
  current runtime can execute them as one composite plan.
- A desk report needs to attach replay, backtest, shadow, paper, and bounded
  execution evidence to one scenario object so operator review is coherent.
- A promotion handoff must map a tested scenario into one or more bounded
  execution objects, which may be:
  - runtime deployments where the existing runtime model fits, or
  - Worker-side execution recipes or controls where the current runtime
    deployment model does not fit yet.

## Lifecycle

Desk scenarios use their own lifecycle:

- `draft`
- `replay_ready`
- `shadow_ready`
- `paper_ready`
- `operator_review`
- `execution_ready`
- `execution_bound`
- `paused`
- `archived`

This lifecycle is intentionally separate from runtime deployment state and from
strategy-lab promotion state.

Desk runs also use their own lifecycle so harness orchestration is explicit:

- `pending`
- `legs_requested`
- `legs_running`
- `collecting_evidence`
- `needs_review`
- `completed`
- `rejected`
- `failed`
- `cancelled`

Promotion handoffs use a short review lifecycle:

- `draft`
- `awaiting_review`
- `approved`
- `applied`
- `rejected`
- `archived`

## Boundaries

- Desk scenarios may collect replay, backtest, shadow, paper, and bounded
  execution evidence.
- Desk scenarios do not self-authorize paper activation or limited-live
  promotion.
- `paper` remains operator-approved even though it is wallet-safe.
- `limited_live` remains explicitly human-approved and bounded by allowlists,
  lanes, kill controls, and canary notes.
- The public execution API boundary stays on the Worker. This ADR does not add
  a new public composite execution surface.

## Consequences

- The harness can become the orchestration substrate for composite testing
  without forcing composite state into runtime-rs prematurely.
- The portal can build a real strategy desk on top of repo-owned contracts
  rather than bespoke payloads.
- Future runtime work can selectively absorb proven desk concepts, but only
  after the execution model and storage model are ready for them.
