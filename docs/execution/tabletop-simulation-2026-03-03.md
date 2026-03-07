# Execution Tabletop Simulation - 2026-03-03

Status: completed for `X402-029`.

## Scenario Matrix

1. Provider outage on `protected` lane (`jito_bundle`) with rising timeout rate.
2. Lane kill switch for `protected` enabled mid-incident.
3. Queue pressure scenario with elevated latency and queued responses.
4. Receipt reconciliation case with terminal request missing receipt row.

## Expected Operator Actions

1. Detect with `/api/admin/execution/observability`.
2. Disable degraded lane via `EXEC_LANE_PROTECTED_ENABLED=0`.
3. Confirm deterministic user-facing behavior:
   - submit returns `unsupported-lane`
   - reason is `lane-disabled-by-operator`
4. Keep remaining lanes (`fast`, `safe`) serving.
5. Reconcile receipt gaps using D1 queries and receipt regeneration flow.

## Validation Evidence

- Lane toggle unit coverage:
  - `tests/unit/worker_execution_lane_resolver.test.ts`
- Submit route integration coverage:
  - `tests/unit/worker_x402_exec_submit_route.test.ts`
  - assertion: disabled lane produces canonical `unsupported-lane` contract response
- Error taxonomy source:
  - `apps/worker/src/execution/error_taxonomy.ts`
- Runbook reference:
  - `docs/execution/operations-runbook-v1.md`

## Outcome

- On-call can execute lane-level failover without code edits.
- Incident response uses canonical error taxonomy, not ad-hoc strings.
- Recovery criteria and rollback checklist are documented.
