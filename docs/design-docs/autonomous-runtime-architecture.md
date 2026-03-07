# Autonomous Runtime Architecture

## Purpose

This document translates the autonomous runtime PRD into a repo-owned technical
shape that preserves the current harness workflow.

The design goal is simple:

- keep the Worker as the only public edge,
- keep Bun as the repo and harness control plane,
- add a Rust hot path without creating a second delivery model.

## System boundaries

| Component | Responsibility | Notes |
| --- | --- | --- |
| `apps/portal` | Terminal, operator UI, first-party automation surfaces | Continues to talk only to the Worker |
| `apps/worker` | Public API boundary, x402, auth-adjacent routes, runtime control routes | Public contracts stay stable |
| `src/` | Harness commands, runner, local orchestration, proof bundle tooling | Remains the repo-owned operator interface |
| `services/runtime-rs` | Long-lived automation runtime | Added in `#258` |
| Runtime relational store | Canonical automation state | Added after Fly foundation lands |
| Cloudflare D1/KV/R2/DO | Public read models, existing execution data, registry metadata | Remain in place |

## Control and data flow

### Deployment lifecycle

1. A human or future operator surface submits a deployment change to the Worker.
2. The Worker authenticates the request and stores an auditable control record.
3. The Worker calls the private runtime control endpoint using service auth.
4. Runtime-rs persists deployment state and begins or changes execution only
   after risk and readiness gates pass.

### Run lifecycle

1. Runtime-rs ingests feeds and computes features.
2. The strategy engine evaluates triggers and produces a deterministic run key.
3. The risk engine evaluates freshness, exposure, reservation, and lane rules.
4. The execution planner turns desired state into execution plans.
5. The exec client coordinates submit, status, and receipt handling through
   private Worker-facing paths that preserve the existing domain contract.
6. The reconciler updates runtime state and publishes derived read models as
   needed for terminal and admin surfaces.

## Runtime modules

### `feed_gateway`

- market data sockets,
- quote feeds,
- slot and block notifications,
- venue and provider health signals.

### `feature_cache`

- rolling market features,
- freshness timestamps per source,
- deterministic feature snapshots used by the strategy engine.

### `strategy_engine`

- template registry,
- deployment lifecycle state machine,
- deterministic trigger evaluation,
- canonical run identifiers.

### `portfolio_ledger`

- logical wallet sleeves,
- reservations,
- positions,
- cost basis and PnL attribution,
- capital availability checks.

### `risk_engine`

- pre-trade notional and concentration checks,
- stale data rejection,
- lane and mode safety mapping,
- stop-trading and kill decisions.

### `execution_planner`

- desired-state delta computation,
- slice planning,
- lane selection,
- safe/protected/fast mapping.

### `exec_client`

- private submit coordination,
- status and receipt polling,
- canonical idempotency and retry policy.

### `reconciler`

- wallet state sync,
- receipt reconciliation,
- position correction,
- incident flags when runtime and chain state diverge.

### `ops_server`

- health,
- readiness,
- metrics,
- deployment state,
- pause, resume, and kill controls.

## Deployment topology

The v1 topology is a single-writer model:

- one active Fly region per environment or shard,
- one warm standby region,
- one canonical runtime database placed near the active region,
- no active/active execution.

Cloudflare remains global for public ingress and read-serving. Runtime-rs stays
regional and stateful.

## State ownership

| State class | Canonical owner | Replica or projection |
| --- | --- | --- |
| Automation deployments, runs, sleeves, reservations, risk verdicts, reconciliation records | Runtime relational store | Worker-readable summaries as needed |
| Public execution submit, status, and receipt contract | Worker and current execution fabric | Runtime caches for coordination only |
| Discovery, registry, and public metadata | Worker and repo docs | None |
| Local feature windows and feed buffers | Runtime memory and local persistence | None |

This split keeps the public contract stable while giving the hot path a
single-writer source of truth for automation.

## Internal API surface

The first private route family is intentionally small:

- `POST /api/internal/runtime/deployments`
- `GET /api/internal/runtime/deployments/:id`
- `POST /api/internal/runtime/deployments/:id/pause`
- `POST /api/internal/runtime/deployments/:id/resume`
- `POST /api/internal/runtime/deployments/:id/kill`
- `GET /api/internal/runtime/runs/:deploymentId`
- `GET /api/internal/runtime/positions`
- `GET /api/internal/runtime/pnl`
- `GET /api/internal/runtime/health`
- `POST /api/internal/runtime/execution-plans`

Transport starts as HTTP+JSON with service auth. Shared schemas and fixtures
arrive in `#257`. In `#259`, control and inspection routes are fixture-backed
stubs until later issues replace them with real runtime integration.

## Harness compatibility requirements

- `harness:up` must remain backward compatible for portal plus Worker users.
- Runtime-rs support is optional and off by default until `#260`.
- `harness:status` will surface runtime-rs health when enabled.
- `harness:proof` remains the browser proof path for portal and operator flows.
- The GitHub issue runner remains the only repo-owned execution workflow.

## Failure domains and guardrails

- Region split-brain:
  one active region, explicit failover, no dual writers.
- Data staleness:
  freshness budgets become risk-engine inputs, not UI-only warnings.
- Contract drift:
  shared schemas, fixtures, and contract tests are required before Worker and
  runtime coordination is allowed in production.
- Capital leakage:
  logical sleeve reservations prevent one deployment from spending another
  deployment's capital in v1.

## Related ADRs

- `docs/design-docs/adrs/ADR-0001-runtime-internal-transport.md`
- `docs/design-docs/adrs/ADR-0002-runtime-storage-ownership.md`
- `docs/design-docs/adrs/ADR-0003-runtime-region-topology.md`
- `docs/design-docs/adrs/ADR-0004-runtime-wallet-sleeves.md`
