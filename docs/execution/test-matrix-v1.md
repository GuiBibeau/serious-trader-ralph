# Execution Test Matrix v1

Phase 2 coverage for execution fabric reliability, failure classes, and load behavior.

## Coverage Map

- Relay immutability:
  - `tests/unit/worker_execution_load_benchmark.test.ts`
  - `tests/unit/worker_x402_exec_submit_route.test.ts`
- Privy flow:
  - `tests/unit/worker_execution_load_benchmark.test.ts`
  - `tests/unit/worker_trade_swap_wrapper_route.test.ts`
- Idempotency and replay behavior:
  - `tests/unit/worker_execution_load_benchmark.test.ts`
  - `tests/unit/worker_execution_idempotency.test.ts`
- Adapter retries and provider-path fallback behavior:
  - `tests/unit/worker_execution_helius_sender.test.ts`
  - `tests/unit/worker_execution_jito_bundle.test.ts`
  - `tests/unit/worker_execution_router.test.ts`
- Lane kill-switch behavior:
  - `tests/unit/worker_execution_lane_resolver.test.ts`
  - `tests/unit/worker_x402_exec_submit_route.test.ts`
- Actor-segment rollout flag behavior:
  - `tests/unit/worker_execution_rollout_gate.test.ts`
  - `tests/unit/worker_x402_exec_submit_route.test.ts`
- Blockhash expiry handling:
  - `tests/unit/worker_execution_helius_sender.test.ts`
  - `tests/unit/worker_execution_error_taxonomy.test.ts`
- Load + status/receipt consistency:
  - `tests/unit/worker_execution_load_benchmark.test.ts`

## Benchmarks Tracked in CI

`tests/unit/worker_execution_load_benchmark.test.ts` tracks:

- submit success rate
- submit p95 latency (ms)
- status/receipt consistency across concurrent requests

The suite writes a benchmark artifact to:

- `.tmp/execution-benchmarks/phase2-load-benchmark.json`

CI uploads this file as an artifact for release go/no-go review.

## Operations Artifacts

- `docs/execution/operations-runbook-v1.md`
- `docs/execution/rollout-plan-v1.md`
- `docs/execution/tabletop-simulation-2026-03-03.md`
