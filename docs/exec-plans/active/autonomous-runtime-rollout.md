# Autonomous Runtime Rollout Plan

**Status:** Active  
**Backlog owner:** GitHub issue epic `#255`

## Rollout principles

- Build through the current harness flow only.
- Do not mark downstream issues `agent-ready` until dependencies are merged and
  the scope still fits one runner-owned PR.
- Keep the Worker as the public edge throughout the rollout.
- Treat shadow, paper, and limited live as distinct gates with proof at each
  phase.

## Phase map

| Phase | Issues | Deliverables | Exit gate |
| --- | --- | --- | --- |
| 0 | `#256`, `#257` | Repo-owned PRD, ADRs, verification docs, canonical protocol plan | Docs merged, no public route change, protocol tests ready to start |
| 1 | `#258`, `#259`, `#260`, `#261` | Rust workspace, private internal routes, harness compatibility, Fly deploy foundation | Runtime builds, internal auth works, harness remains backward compatible, Fly health path exists |
| 2 | `#262`, `#263`, `#264` | Feed gateway, feature cache, strategy registry, shadow trigger engine | Deterministic shadow runs, no duplicate run keys, stale-data rules proven |
| 3 | `#265`, `#266`, `#267` | Ledger, reservations, risk engine, execution planner, paper trading | Paper scorecards stable, unsafe orders rejected, proof bundle artifacts complete |
| 4 | `#268`, `#269`, `#270`, `#271` | Reconciliation loop, scorecards, ops controls, first live runtime canary | Reconciliation passes, runtime canary stable, rollback controls verified |
| 5 | `#272`, `#273`, `#274` | Operator visibility, managed template packs 1 and 2 | First live template pack is supportable and incident playbooks are proven |
| 6 | `#275`, `#276` | Advanced templates and multi-strategy capital coordination | Strategy interaction is stable and capital control remains deterministic |

## Phase-specific rollout notes

### Phase 0

- Docs only.
- No runtime code path is allowed to affect behavior yet.
- Merge order is `#256` then `#257`.

### Phase 1

- Keep runtime-rs internal-only.
- `harness:up` and `harness:down` must remain backward compatible.
- Stop if Fly deployment requires operational decisions not covered by ADRs.

### Phase 2

- Shadow only.
- No wallet mutation and no live submit path.
- Require replayable fixtures for trigger determinism.

### Phase 3

- Paper trading only.
- Risk rejects, reservations, and planner outputs must be inspectable.
- Do not promote to live while paper scorecards are unstable.

### Phase 4

- Start with one limited live canary deployment only.
- Use the safest lane defaults and the smallest practical notional.
- Keep rollback steps and kill controls visible to operators.

### Phase 5 and 6

- Expand only after the live canary is stable.
- Re-check issue scope before marking template-pack issues ready for harness
  execution.

## Rollback posture

- Use runtime pause and kill controls before code rollback.
- Revert the last merged PR when code rollback is necessary.
- Do not widen public API exposure as part of rollback.

## Verification expectations

Every issue in this program must preserve:

- `bun run lint`
- the smallest relevant validation set for the changed surface
- explicit proof bundle evidence in the PR

UI or operator-surface issues also require browser proof through
`bun run harness:proof`.
