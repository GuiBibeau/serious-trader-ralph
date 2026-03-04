# Execution Observability v1

This document defines the Phase 2 observability surface for execution requests.

## Endpoint

- `GET /api/admin/execution/observability`
- Auth: `Authorization: Bearer <ADMIN_TOKEN>`
- Query params:
  - `windowMinutes` (default `60`, min `5`, max `10080`)
  - `maxRequests` (default `5000`, min `100`, max `20000`)

Example:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://dev.api.trader-ralph.com/api/admin/execution/observability?windowMinutes=120&maxRequests=10000"
```

## Emitted Metrics

The route computes metrics from `execution_requests`, `execution_status_events`, and `execution_attempts`.

- Totals:
  - `accepted`, `terminal`, `succeeded`, `failed`, `expired`
  - `failRate`, `expiryRate`, `duplicateRate`
- Latencies:
  - `dispatch` (`received -> dispatched`)
  - `landing` (`dispatched -> landed/finalized`)
  - `finalization` (`received -> terminal`)
- Dimensions:
  - `lane`
  - `mode`
  - `actor`
  - `provider` (attempt + request outcome summaries)

## Alerts

The endpoint returns evaluated alert state (`ok|warning|critical|insufficient-data`) for:

- `fail-rate`
- `expiry-rate`
- `dispatch-latency-p95`
- `landing-latency-p95`
- `finalization-latency-p95`

Threshold env vars:

- `EXEC_OBS_ALERT_MIN_SAMPLE_SIZE`
- `EXEC_OBS_ALERT_FAIL_RATE_WARN`
- `EXEC_OBS_ALERT_FAIL_RATE_CRITICAL`
- `EXEC_OBS_ALERT_EXPIRY_RATE_WARN`
- `EXEC_OBS_ALERT_EXPIRY_RATE_CRITICAL`
- `EXEC_OBS_ALERT_P95_DISPATCH_MS_WARN`
- `EXEC_OBS_ALERT_P95_DISPATCH_MS_CRITICAL`
- `EXEC_OBS_ALERT_P95_LANDING_MS_WARN`
- `EXEC_OBS_ALERT_P95_LANDING_MS_CRITICAL`
- `EXEC_OBS_ALERT_P95_FINALIZATION_MS_WARN`
- `EXEC_OBS_ALERT_P95_FINALIZATION_MS_CRITICAL`

Window tuning env vars:

- `EXEC_OBS_DEFAULT_WINDOW_MINUTES`
- `EXEC_OBS_MAX_REQUESTS`

## Dashboard Suggestions

Use the endpoint payload to build 4 panels per environment:

1. Outcome rates (`failRate`, `expiryRate`, `duplicateRate`)
2. Latency health (`dispatch/landing/finalization` p95)
3. Lane and mode comparison (`dimensions.lane`, `dimensions.mode`)
4. Provider quality (`dimensions.provider`)

## Operational Notes

- This endpoint is admin-only and should not be exposed in public discovery docs.
- `duplicateRate` is defined as requests with more than one execution attempt over sampled requests.
- If sample size is below `EXEC_OBS_ALERT_MIN_SAMPLE_SIZE`, alerts return `insufficient-data`.
- Incident response procedures are documented in
  `docs/execution/operations-runbook-v1.md`.
