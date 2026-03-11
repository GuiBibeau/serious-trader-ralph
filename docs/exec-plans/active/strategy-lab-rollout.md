# Strategy Lab Rollout Plan

**Status:** Active  
**Backlog owner:** GitHub issue epic `#304`

## Rollout principles

- Build through the current harness flow only.
- Keep the Worker as the public edge for all operator and promotion controls.
- Treat strategy, venue, and asset promotion as separate state machines.
- Do not mark downstream issues `agent-ready` until dependency gates are
  stable.
- Stop at bounded limited-live validation before any broader live expansion.

## Phase map

| Phase | Issues | Deliverables | Exit gate |
| --- | --- | --- | --- |
| 0 | `#305`, `#306`, `#307` | Workflow contract, research registry, StrategySpec and plugin ABI | Research lifecycle and strategy ABI are explicit and backward-compatible |
| 1 | `#308` to `#313` | Source intake, venue model, asset registry, data lake, cost models, feature catalog | Research inputs and evaluation substrate are reproducible |
| 2 | `#314` to `#317` | Backtesting, paper simulator, scorecards, reproducibility bundles | Candidate evaluation is leakage-resistant and auditable |
| 3 | `#318` to `#321` | Agentic retrieval, synthesis, triage, safety gates | Agent-generated candidates are bounded by explicit policy |
| 4 | `#322` to `#325` | Promotion orchestration, onboarding canaries, expanded budgets, operator controls | Candidate to limited-live promotion is explicit and reversible |
| 5 | `#326`, `#327` | First end-to-end pilot and post-live drift handling | One new strategy and one new venue or asset complete bounded live validation |

## Phase-specific notes

### Phase 0

- Docs and contract work only.
- No runtime behavior should widen in this phase.
- Strategy, venue, and asset states must be explicit before implementation
  begins.

### Phase 1

- Research intake and substrate only.
- No strategy may reach money states from this phase alone.
- Venue and asset adapters must fail closed when capability coverage is weak.

### Phase 2

- Evaluation only.
- Backtests and paper runs must be reproducible from snapshot identifiers and
  manifests.
- Do not promote based on raw return without cost and robustness evidence.

### Phase 3

- Agentic discovery may generate candidates, not money-state promotions.
- Newly synthesized strategies must clear policy and evidence gates before they
  can reach shadow or paper.

### Phase 4

- Promotion logic becomes first-class.
- Limited-live remains tiny-notional, allowlisted, and human-gated.
- Venue and asset canaries must stay independent from strategy promotion where
  possible.

### Phase 5

- Prove the system with one genuinely new strategy and one genuinely new venue
  or asset.
- Treat drift and rollback drills as part of the pilot, not a later cleanup.

## Rollback posture

- Use pause, kill, demotion, and allowlist removal before code rollback where
  possible.
- Revert the last merged PR when a code rollback is required.
- Do not widen the public Worker contract as part of rollback.

## Verification expectations

Every issue in this program must preserve:

- `bun run lint`
- the smallest relevant validation set for the changed surface
- explicit proof-bundle evidence in the PR

UI or operator-surface issues also require browser proof through
`bun run harness:proof`.

Any issue that affects real-money promotion or canary behavior must also attach
the relevant paper or live-canary evidence and risk notes.
