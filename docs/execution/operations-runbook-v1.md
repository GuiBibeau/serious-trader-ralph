# Execution Operations Runbook v1

This runbook covers Phase 2 execution operations for:

- provider outage handling
- lane disable/failover
- queue saturation response
- receipt reconciliation

## Scope and Preconditions

- Environments:
  - `dev` (`ralph_waitlist_dev`, worker `ralph-edge-dev`)
  - `staging` (`ralph_waitlist_staging`, worker `ralph-edge-staging`)
  - `production` (`ralph_waitlist`, worker `ralph-edge`)
- Required access:
  - GitHub Actions deploy workflows
  - Cloudflare Worker variables/secrets for target env
  - `ADMIN_TOKEN` for observability endpoint

## Operational Toggles

Lane kill switches (all default enabled):

- `EXEC_LANE_FAST_ENABLED`
- `EXEC_LANE_PROTECTED_ENABLED`
- `EXEC_LANE_SAFE_ENABLED`

Adapter override controls:

- `EXEC_LANE_FAST_ADAPTER`
- `EXEC_LANE_PROTECTED_ADAPTER`
- `EXEC_LANE_SAFE_ADAPTER`

If a lane is disabled, submit returns:

- HTTP `400`
- error code: `unsupported-lane`
- reason: `lane-disabled-by-operator`

Verification coverage:

- `tests/unit/worker_execution_lane_resolver.test.ts`
- `tests/unit/worker_x402_exec_submit_route.test.ts`

## Incident Taxonomy Alignment

The runbook uses canonical execution error codes from `apps/worker/src/execution/error_taxonomy.ts`:

- `payment-required`
- `auth-required`
- `invalid-request`
- `invalid-transaction`
- `policy-denied`
- `unsupported-lane`
- `insufficient-balance`
- `venue-timeout`
- `submission-failed`
- `expired-blockhash`
- `not-found`
- `not-ready`

Primary incident classes map to taxonomy as:

- Provider outage: `venue-timeout`, `submission-failed`, sometimes `expired-blockhash`
- Lane kill switch event: `unsupported-lane` + `lane-disabled-by-operator`
- Queue saturation / pressure: rising dispatch/finalization latency and rate-limits (`policy-denied` reasons)
- Receipt backlog: repeated `not-ready` on receipt endpoint for terminal-lagged requests

## Shared Triage Workflow

1. Confirm blast radius with observability:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/execution/observability?windowMinutes=30&maxRequests=5000"
```

2. Capture current thresholds and lane-level failures.
3. Choose mitigation: disable lane, reroute adapter, or throttle ingress.
4. Redeploy worker for target environment.
5. Verify status with smoke submit + status/receipt polling.
6. Record timeline and decision in incident log.

## Runbook A: Provider Outage

Trigger indicators:

- alert state `warning|critical` for fail rate or p95 latency
- spike in `venue-timeout` or `submission-failed`
- adapter-specific failures in provider dimension

Actions:

1. Identify impacted lane (`fast`, `protected`, `safe`).
2. Apply kill switch for impacted lane (`EXEC_LANE_<LANE>_ENABLED=0`) to stop new risk.
3. If failover path is validated, set adapter override (`EXEC_LANE_<LANE>_ADAPTER=<adapter>`).
4. Redeploy and verify:
   - disabled lane rejects with `unsupported-lane`
   - unaffected lanes continue to accept submits
5. Recover by restoring lane enable flag to `1` after health stabilizes.

## Runbook B: Lane Disable / Failover

Use when one lane degrades but overall service remains healthy.

Actions:

1. Disable only degraded lane with `EXEC_LANE_<LANE>_ENABLED=0`.
2. Keep remaining lanes enabled for partial service continuity.
3. Update client-facing status note (if needed) that lane is temporarily unavailable.
4. Re-enable lane only after:
   - fail rate below warning threshold
   - p95 dispatch/landing within SLO band
   - no sustained `submission-failed` burst

## Runbook C: Queue Saturation

Trigger indicators:

- sustained queue growth in status metadata (`queueDepth`, `queuePosition`)
- rising `queued` dwell time and p95 finalization latency
- frequent rate-limit denials from abuse guard (`policy-denied` reasons)

Actions:

1. Reduce inbound pressure:
   - tighten abuse guard windows/limits where required
   - temporarily disable non-critical lanes
2. Prioritize latency-sensitive flows by lane policy.
3. Monitor every 5 minutes until queue depth stabilizes.
4. Return controls to baseline after 30 minutes stable metrics.

## Runbook D: Receipt Reconciliation

Use when submit/status succeeded but receipts lag or look inconsistent.

Checks:

1. Find terminal requests without receipts:

```bash
npx wrangler d1 execute ralph_waitlist --remote --env production --command \
"SELECT request_id,status,terminal_at FROM execution_requests WHERE terminal_at IS NOT NULL AND request_id NOT IN (SELECT request_id FROM execution_receipts) ORDER BY terminal_at DESC LIMIT 200;"
```

2. Compare attempt vs receipt error codes:

```bash
npx wrangler d1 execute ralph_waitlist --remote --env production --command \
"SELECT a.request_id,a.error_code AS attempt_error,r.error_code AS receipt_error FROM execution_attempts a LEFT JOIN execution_receipts r USING(request_id) ORDER BY a.created_at DESC LIMIT 200;"
```

Actions:

1. If provider reports landed signature but receipt missing, backfill receipt from provider result data.
2. If request terminaled as error incorrectly, append status event with corrected reason and regenerate receipt envelope.
3. Confirm `/api/x402/exec/receipt/:requestId` returns canonical terminal state.

## Rollback and Verification Checklist

- Lane flags restored to intended baseline.
- Adapter overrides removed if temporary.
- Observability alerts return `ok` or `insufficient-data` (low traffic).
- Manual smoke:
  - submit accepted on intended lanes
  - disabled lanes reject deterministically when toggled
  - status and receipt endpoints return consistent terminal outcomes
