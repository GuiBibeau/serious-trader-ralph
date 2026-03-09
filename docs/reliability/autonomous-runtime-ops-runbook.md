# Autonomous Runtime Ops Runbook

## Purpose

This runbook defines how the autonomous runtime should be operated once runtime
code lands. During the docs-only phase, it serves as the preflight agreement
for later implementation issues.

## Operating model

- The Worker remains the public edge and the operator control surface.
- Runtime-rs is the private hot path running on Fly.
- Human review remains mandatory before merge and before live promotion.
- Runtime rollout follows shadow, paper, limited live canary, then broader live
  template rollout.

## Required controls before any live rollout

- private service-auth between Worker and runtime-rs,
- runtime health and readiness endpoints,
- runtime kill switch reachable through the Worker control plane,
- deployment pause, resume, and kill actions,
- database backup and restore procedure,
- region failover checklist,
- reconciliation mismatch alarm,
- proof bundle attached to every runtime PR.

## Routine operator actions

### Inspect health

Verify:

- runtime process health,
- active region and standby region status,
- provider connectivity,
- feed freshness,
- feature freshness and ingest lag,
- strategy registry health and deployment/run counts,
- reconciliation backlog,
- runtime canary status.

Fly foundation commands:

```bash
bun run runtime:fly:deploy
bun run runtime:fly:smoke
gh workflow run rollback-runtime-rs.yml --raw-field reason="manual rollback"
```

Expected topology for v1:

- active app: `ralph-runtime-rs`
- active region: `ord`
- warm standby region: `iad`
- public health endpoint: `https://ralph-runtime-rs.fly.dev/health`
- feed metrics endpoint: `https://ralph-runtime-rs.fly.dev/metrics`

Internal inspection examples:

```bash
curl -fsS https://ralph-runtime-rs.fly.dev/api/internal/runtime/health \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}"

curl -fsS https://ralph-runtime-rs.fly.dev/api/internal/runtime/runs/<deployment-id> \
  -H "authorization: Bearer ${RUNTIME_INTERNAL_SERVICE_TOKEN}"
```

Worker control-plane inspection:

```bash
curl -fsS https://api.trader-ralph.com/api/admin/ops/runtime \
  -H "authorization: Bearer ${ADMIN_TOKEN}"

curl -fsS "https://api.trader-ralph.com/api/admin/ops/dashboard?windowMinutes=360&maxRequests=10000" \
  -H "authorization: Bearer ${ADMIN_TOKEN}"
```

### Pause a deployment

Use pause when:

- a strategy is misbehaving but infrastructure is otherwise healthy,
- a feed is stale for one strategy's market set,
- capital needs to be reallocated without a full kill.

Expected effect:

- new shadow evaluations stop,
- reconciliation continues,
- existing state remains inspectable.

Control-plane command:

```bash
curl -fsS https://api.trader-ralph.com/api/admin/ops/runtime/deployments/<deployment-id>/pause \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}"
```

### Kill a deployment

Use kill when:

- risk controls fail open,
- reconciliation mismatch persists,
- duplicate submit risk is present,
- operator confidence in current state is lost.

Expected effect:

- planning and submit stop immediately,
- deployment state is marked killed,
- follow-up requires explicit human action.

Control-plane command:

```bash
curl -fsS https://api.trader-ralph.com/api/admin/ops/runtime/deployments/<deployment-id>/kill \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}"
```

### Force shadow-only mode

Use shadow-only when:

- live rollout is still gated,
- paper or live resumes must be blocked without disabling runtime inspection,
- an incident requires investigation before wider runtime promotion.

Expected effect:

- runtime resumes through the Worker control plane are allowed only for shadow
  deployments,
- paper and live deployment resumes return `runtime-shadow-only`,
- the ops dashboard reflects the current shadow-only reason.

Control-plane command:

```bash
curl -fsS https://api.trader-ralph.com/api/admin/ops/controls \
  -X POST \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data '{
    "updatedBy": "runtime-ops-runbook",
    "runtime": {
      "shadowOnly": true,
      "shadowOnlyReason": "incident-review"
    }
  }'
```

## Incident classes

### Stale data incident

Symptoms:

- freshness budget breach,
- feature cache marked degraded or stale,
- risk rejects spike,
- strategy engine stops promoting runs.

Response:

1. Pause affected deployments.
2. Confirm provider and socket health.
3. Pull `GET /api/admin/ops/runtime` and confirm the runtime lag lines
   (`maxMarketAgeMs`, `maxFeatureAgeMs`, `maxSlotAgeMs`) identify the stale
   source.
4. Confirm `feature-stream-stale` or `feature-stream-missing` appears on the
   affected shadow evaluations.
5. Keep the runtime canary disabled until freshness is restored.

### Reconciliation incident

Symptoms:

- receipt mismatch,
- runtime ledger diverges from chain state,
- sleeve balances no longer explain physical wallet state.

Response:

1. Kill affected deployments.
2. Freeze further live promotion.
3. Export reconciliation evidence and compare with chain and Worker receipts.
4. Keep `runtime.shadowOnly=true` until reconciliation explains the drift.

### Region failover incident

Symptoms:

- active region unhealthy,
- database unreachable,
- provider locality degraded beyond budget.

Response:

1. Confirm the active region should be abandoned.
2. Disable execution in the failing region.
3. Promote the warm standby only after leader state and database authority are
   explicit.

## Rollback policy

- Prefer pause or kill controls before code rollback.
- Prefer `runtime.shadowOnly=true` before widening any rollout again after an
  incident.
- If code rollback is required, revert the offending PR and redeploy through the
  same harness flow.
- Runtime-rs code rollback uses `.github/workflows/rollback-runtime-rs.yml`.
- Do not shift public traffic directly to runtime-rs in any rollout covered by
  this runbook; the Worker stays the contract boundary.

## Proof requirements for runtime changes

Every runtime-facing PR should include:

- exact validation commands,
- local or preview URLs,
- runtime health or replay evidence when relevant,
- browser proof for operator-facing UI changes,
- risk notes and deferred follow-ups.

## References

- `docs/product-specs/autonomous-runtime-prd.md`
- `docs/design-docs/autonomous-runtime-architecture.md`
- `docs/exec-plans/active/autonomous-runtime-rollout.md`
- `docs/repository-verification-index.md`
