# Repository Verification Index

This document is the public-safe starting point for understanding how Trader
Ralph is put together, what must stay true, which environments exist today, and
how to verify or roll back the main operating paths.

## Architecture Map

| Surface | Role | Primary paths |
| --- | --- | --- |
| Portal | Next.js marketing, login, and terminal UI | `apps/portal` |
| Worker | Cloudflare Worker API boundary for x402, execution, discovery, and auth-adjacent routes | `apps/worker` |
| Runtime control plane | Bun CLI, agent runtime, tools, policies, and journals | `src` |
| Autonomous runtime (planned) | Rust hot path for always-on automation, reconciliation, and portfolio state | `docs/product-specs/autonomous-runtime-prd.md`, `docs/design-docs/autonomous-runtime-architecture.md` |
| Tests | Unit, integration, and terminal execution suites | `tests` |
| Public contracts | Execution docs, schemas, fixtures, and runbooks | `docs/execution` |
| Agent registry | Lane metadata and operator runbook | `docs/agent-registry` |
| Pipeline architecture | Loop A/B/C design and backlog decomposition | `loop-a-loop-b-architecture.md` |

High-level request flow today:

1. The portal reads `NEXT_PUBLIC_EDGE_API_BASE` and talks to the Worker.
2. The Worker is the public API boundary and enforces x402 and execution
   contracts.
3. Execution, telemetry, registry, and loop surfaces persist through Cloudflare
   resources such as D1, KV, R2, and Durable Objects.
4. CI and deploy workflows publish branch-specific environments for portal and
   worker.

## Repo Invariants

These are the invariants that changes should preserve unless the issue
explicitly calls for a contract break:

- The Cloudflare Worker remains the public API boundary.
- Autonomous runtime work must preserve the existing harness flow and keep
  runtime-rs optional until the relevant issue explicitly enables it.
- Existing x402 read routes stay under `POST /api/x402/read/*`.
- Existing execution routes stay:
  - `POST /api/x402/exec/submit`
  - `GET /api/x402/exec/status/:requestId`
  - `GET /api/x402/exec/receipt/:requestId`
- The portal must build against explicit `NEXT_PUBLIC_EDGE_API_BASE` and
  `NEXT_PUBLIC_SITE_URL` values so environment routing stays deterministic.
- CI-impacting workflow or environment changes must ship in the same PR as the
  code they support.
- Secrets never live in tracked files.

## Environment Inventory

Current branch and domain mapping:

| Lane | Branch | Site URL | API URL | Worker name |
| --- | --- | --- | --- | --- |
| Dev | `dev` | `https://dev.trader-ralph.com` | `https://dev.api.trader-ralph.com` | `ralph-edge-dev` |
| Production | `main` | `https://trader-ralph.com` and `https://www.trader-ralph.com` | `https://api.trader-ralph.com` | `ralph-edge` |

Autonomous runtime planning surfaces:

- Product spec: `docs/product-specs/autonomous-runtime-prd.md`
- Architecture: `docs/design-docs/autonomous-runtime-architecture.md`
- ADRs: `docs/design-docs/adrs/`
- Ops runbook: `docs/reliability/autonomous-runtime-ops-runbook.md`
- Rollout plan: `docs/exec-plans/active/autonomous-runtime-rollout.md`

The runtime service is not deployed yet. Until `#258` to `#261` land, runtime
verification is documentation-only and the live stack remains portal plus
Worker.

Current workflow files:

- CI: `.github/workflows/ci.yml`
- Worker deploys:
  - `.github/workflows/deploy-dev.yml`
  - `.github/workflows/deploy-production.yml`
  - `.github/workflows/deploy-manual.yml`
- Portal deploys:
  - `.github/workflows/deploy-portal.yml`
- Ops:
  - `.github/workflows/ops-dashboard.yml`
  - `.github/workflows/rollback-production.yml`

Current required secret names:

- Cloudflare: `CLOUDFLARE_API_TOKEN`
- Vercel: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- Admin routes: `ADMIN_TOKEN`
- Integration and live test inputs vary by suite and may include
  `RPC_ENDPOINT`, `BALANCE_RPC_ENDPOINT`, `JUPITER_API_KEY`,
  `WALLET_PRIVATE_KEY`, and provider-specific read keys.

## Verification Playbooks

### 1. Local full-stack verification

```bash
bun install
bun run dev:local
```

Expected local health:

- Portal: `http://localhost:3000`
- Worker: `http://127.0.0.1:8888/api/health`

Verify:

```bash
curl -fsS http://127.0.0.1:8888/api/health
open http://localhost:3000/terminal
```

### 2. Worker-only verification

```bash
cd apps/worker
bun install
bun run db:migrate:local
bun run dev:local
```

Verify:

```bash
curl -fsS http://127.0.0.1:8888/api/health
```

### 3. Contract and test verification

Base checks:

```bash
bun run lint
bun run typecheck
```

Execution and runtime checks:

```bash
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:integration:worker:live
```

Use the narrowest relevant subset for focused changes, but record the exact
commands used in the PR proof bundle.

### 3a. Autonomous runtime planning verification

For docs-only runtime planning work:

```bash
bun run lint
```

Verify:

- the PRD, architecture doc, ADRs, runbook, and rollout plan all agree on the
  Worker boundary and harness compatibility,
- the chosen v1 answers for internal transport, storage ownership, region
  topology, and wallet sleeve model are explicit,
- no docs introduce secrets or private operational tokens.

### 4. x402 and discovery verification

Portal-side discovery:

```bash
curl -fsS https://dev.trader-ralph.com/api
curl -fsS https://dev.trader-ralph.com/openapi.json
curl -fsS https://dev.trader-ralph.com/endpoints.txt
```

Worker/API-side discovery:

```bash
curl -fsS https://dev.api.trader-ralph.com/api/health
curl -fsS https://dev.api.trader-ralph.com/openapi.json
curl -fsS https://dev.api.trader-ralph.com/agent-registry/metadata.json
```

x402 gating spot check:

```bash
curl -i -X POST https://dev.api.trader-ralph.com/api/x402/read/macro_signals
```

Expected behavior: without `payment-signature`, the route should return `402`
and a `payment-required` header.

### 5. Agent registry verification

Validate metadata:

```bash
bun run agent-registry:validate -- --lane dev
bun run agent-registry:validate -- --lane production
```

Dry-run sync:

```bash
bun run agent-registry:sync -- --lane dev --step all --dry-run
bun run agent-registry:sync -- --lane production --step all --dry-run
```

See also: `docs/agent-registry/runbook.md`

### 6. Deployment smoke verification

Current lane deploys are branch-driven. After a branch deploy completes, verify:

```bash
curl -fsS https://<lane-site-domain>
curl -fsS https://<lane-api-domain>/api/health
curl -fsS https://<lane-api-domain>/openapi.json
```

For portal builds, also verify that the login bundle points at the intended API
host for the lane and does not reference an unexpected `workers.dev` host.

### 6a. Ops dashboard verification

The scheduled GitHub workflow `.github/workflows/ops-dashboard.yml` is the
repo-level dashboard surface for:

- execution outcomes and latency
- preview health
- runner health
- canary status
- runtime kill-switch state

Manual trigger:

```bash
gh workflow run ops-dashboard.yml
```

Expected result:

- workflow summary renders all five sections above
- uploaded artifact name matches `ops-dashboard-<run_id>`
- preview health includes every open PR whose repo-owned proof bundle comment
  contains the `<!-- pr-preview -->` preview section marker
- runner health reports either a valid heartbeat or `not-configured`

### 6b. Runner verification

Run a single GitHub issue poll:

```bash
bun run runner:once
```

Expected result:

- the runner only selects issues carrying both `harness` and `agent-ready`
- each claimed issue receives `agent-running` while execution is active
- worktrees are created under `.tmp/runner/worktrees/issue-<number>-<slug>`
- `.harness/runner-heartbeat.json` updates with current status, concurrency, and
  active run count
- successful runs open or update a PR, seed a single `<!-- harness-proof-bundle -->`
  handoff comment, and switch the issue to `human-review`

### 7. Canary verification

Production execution canary behavior:

- Pair is fixed to `SOL/USDC`.
- Default target notional is `$5`.
- Daily spend cap is `$25`.
- Max slippage budget is `50 bps`.
- Schedule is every 6 hours via cron `0 */6 * * *`.
- A post-deploy canary trigger also runs after `main` worker deploys.
- The lane auto-disables itself on reconciliation failure or slippage breach.

Bootstrap and inspect:

```bash
export API_BASE="https://api.trader-ralph.com"
export ADMIN_TOKEN="<redacted>"

curl -fsS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/execution/canary"

curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/execution/canary/bootstrap"
```

Run and review:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "$API_BASE/api/admin/execution/canary/run" \
  --data '{"trigger":"manual"}'
```

Verify all of the following after bootstrap or any production deploy:

1. The canary snapshot reports a dedicated wallet id and address.
2. The canary wallet has enough SOL for fees and enough USDC for the next buy
   leg before enabling or relying on the schedule.
3. The latest run records quote, request, receipt, and reconciliation payloads.
4. `reconciliationStatus` is `passed` and the lane is not marked disabled.
5. If the lane disables itself, reset it only after funding or routing issues
   are resolved:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API_BASE/api/admin/execution/canary/reset"
```

## Rollback Steps

### Code rollback

1. Identify the offending merge or commit.
2. Open a revert PR against the active lane branch.
3. Let branch-driven CI and deploy workflows republish the reverted state.

### Execution rollback

Use lane and rollout flags before attempting a broader revert:

- `EXEC_ROLLOUT_INTERNAL_ENABLED`
- `EXEC_ROLLOUT_TRUSTED_ENABLED`
- `EXEC_ROLLOUT_EXTERNAL_ENABLED`
- `EXEC_LANE_FAST_ENABLED`
- `EXEC_LANE_PROTECTED_ENABLED`
- `EXEC_LANE_SAFE_ENABLED`

Reference: `docs/execution/rollout-plan-v1.md`

### Production rollback automation

When code rollback is required, prefer the automated workflow:

```bash
gh workflow run rollback-production.yml \
  --raw-field reason="manual rollback" \
  --raw-field pr_number="<optional-pr-number>"
```

This redeploys the previous `main` commit unless an explicit `target_sha` is
provided. The workflow posts a summary to the run and can also comment on a PR
when `pr_number` is supplied.

### Production triage and verification

- Check `docs/execution/operations-runbook-v1.md` for request, attempt, and
  receipt triage.
- Use `docs/execution/terminal-cutover-plan-v1.md` for execution-specific
  rollback context.
- Use `docs/exec-plans/active/autonomous-runtime-rollout.md` for runtime phase
  gates and rollback posture when runtime-rs work lands.
- Re-run the lane verification checks after any revert.

## Source Docs by Topic

- Execution API contract: `docs/execution/exec-api-v1.md`
- Execution observability: `docs/execution/observability-v1.md`
- Execution operations: `docs/execution/operations-runbook-v1.md`
- Execution rollout and rollback: `docs/execution/rollout-plan-v1.md`
- Terminal cutover: `docs/execution/terminal-cutover-plan-v1.md`
- Agent registry: `docs/agent-registry/runbook.md`
- Autonomous runtime PRD: `docs/product-specs/autonomous-runtime-prd.md`
- Autonomous runtime architecture: `docs/design-docs/autonomous-runtime-architecture.md`
- Autonomous runtime runbook: `docs/reliability/autonomous-runtime-ops-runbook.md`
- Autonomous runtime rollout plan: `docs/exec-plans/active/autonomous-runtime-rollout.md`
- Long-form pipeline architecture: `loop-a-loop-b-architecture.md`
