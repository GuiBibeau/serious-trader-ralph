# Execution Rollout Plan v1

This plan defines the Phase 2 staged rollout for execution submit by actor segment.

## Feature Flags

Actor segment flags:

- `EXEC_ROLLOUT_INTERNAL_ENABLED` -> `api_key_actor`
- `EXEC_ROLLOUT_TRUSTED_ENABLED` -> `privy_user`
- `EXEC_ROLLOUT_EXTERNAL_ENABLED` -> `anonymous_x402`

Lane kill switches:

- `EXEC_LANE_FAST_ENABLED`
- `EXEC_LANE_PROTECTED_ENABLED`
- `EXEC_LANE_SAFE_ENABLED`

## Staged Rollout Sequence

1. Internal only:
   - `internal=1`, `trusted=0`, `external=0`
   - Validate operator/API-key automation and observability.
2. Trusted first-party:
   - `internal=1`, `trusted=1`, `external=0`
   - Validate Privy-backed execution path and receipts.
3. External x402:
   - `internal=1`, `trusted=1`, `external=1`
   - Enable anonymous paid relay.

## Environment Verification Matrix

Current baseline in `apps/worker/wrangler.toml`:

- `dev`: internal `1`, trusted `1`, external `1`
- `staging`: internal `1`, trusted `1`, external `1`
- `production`: internal `1`, trusted `1`, external `1`

Verification checks per environment:

1. Internal probe (`x-exec-api-key`) accepted when `internal=1`.
2. Trusted probe (`Authorization` + `privy_execute`) accepted when `trusted=1`.
3. External probe (anonymous `relay_signed`) accepted when `external=1`.
4. If a segment is disabled, response is:
   - code: `policy-denied`
   - reason: `rollout-segment-disabled:<segment>`

## Release Checkpoints (Observability-Gated)

Promotion to next stage requires a full window with:

- `failRate` below warning threshold
- `expiryRate` below warning threshold
- `p95 dispatch`, `p95 landing`, and `p95 finalization` below warning thresholds
- no sustained increase in `submission-failed`/`venue-timeout`

Use:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/execution/observability?windowMinutes=60&maxRequests=10000"
```

Threshold sources are environment-configurable via:

- `EXEC_OBS_ALERT_*`

## Revert Criteria and Rollback

Immediate rollback if any condition persists for two consecutive windows:

- critical alert on fail rate, expiry rate, or p95 latency
- receipt backlog growth (`not-ready` accumulation)
- provider-specific sustained timeouts

Rollback order:

1. Disable external segment (`EXEC_ROLLOUT_EXTERNAL_ENABLED=0`).
2. Disable trusted segment if needed (`EXEC_ROLLOUT_TRUSTED_ENABLED=0`).
3. Keep internal enabled for operational recovery where possible.
4. If lane-specific degradation continues, disable affected lane with
   `EXEC_LANE_<LANE>_ENABLED=0`.

## API Contract Drift Guard

Rollout flags only gate eligibility and do not change endpoint paths or envelope schema.

Contract guardrails:

- keep public routes unchanged:
  - `POST /api/x402/exec/submit`
  - `GET /api/x402/exec/status/:requestId`
  - `GET /api/x402/exec/receipt/:requestId`
- preserve canonical error envelope with documented codes
- validate with unit contract tests before each promotion
