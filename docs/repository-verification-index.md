# Repository Verification Index

This index tracks the current Trader Ralph repo shape after the cleanup toward
the UI trading terminal and Worker market/execution APIs.

## Product Surfaces

| Surface | Owner | Verification |
| --- | --- | --- |
| Terminal UI | `apps/portal/app/terminal` | `bun run test:e2e`, browser smoke at `/terminal` |
| Login redirect | `apps/portal/app/login`, `apps/portal/app/page.tsx` | browser smoke at `/login` and `/` |
| Worker execution API | `apps/worker/src/execution`, `apps/worker/src/index.ts` | `bun run test:unit`, `bun run test:e2e` |
| Market-information APIs | `apps/worker/src/research.ts`, `apps/worker/src/macro_sources.ts`, `apps/worker/src/perps_sources.ts`, `apps/worker/src/agent_query.ts` | `tests/unit/worker_x402_*`, `tests/unit/worker_agent_query_route.test.ts` |
| Discovery and registry | `apps/portal/app/api`, `docs/agent-registry`, `scripts/agent_registry` | `tests/unit/portal_api_catalog_routes.test.ts`, `tests/unit/portal_openapi_routes.test.ts`, `bun run agent-registry:validate -- --lane dev` |
| Shared Worker contracts | `src/runtime`, `src/loops` | `bun run contracts:runtime:schemas`, `bun run contracts:loop-a:schemas`, contract unit tests |

## Removed Surfaces

The following older codebase surfaces are intentionally no longer part of the
repo workflow:

- root CLI and autopilot commands under `src/bin`, `src/cli`, `src/agent`,
  `src/runner`, `src/tools`, and related config/gateway/journal modules
- isolated harness runner and browser proof route
- Rust runtime sidecar, Rust crates, Fly runtime config, and runtime deploy
  workflows
- portal runtime operator, strategy-desk, and proof UI routes
- strategy-desk documentation and request templates
- strategy-lab and runtime deployment GitHub Actions workflows

## Current Local Workflow

```bash
bun install
bun run dev:local
```

Use these checks by default:

```bash
bun run lint
bun run typecheck
bun run test:unit
```

Use targeted checks for narrower work:

```bash
bun run test:e2e
bun run test:integration
bun run contracts:runtime:schemas
bun run contracts:loop-a:schemas
```

## CI Workflows

Active repo workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-dev.yml`
- `.github/workflows/deploy-manual.yml`
- `.github/workflows/deploy-portal.yml`
- `.github/workflows/deploy-pr-preview.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/rollback-production.yml`

CI now validates the TypeScript/Bun repo only. There are no Rust checks, harness
proof jobs, runtime sidecar deploy jobs, or artifact-publishing jobs tied to the
removed proof stack.

## Market-Information Tool Inventory

x402 paid read endpoints preserved by this cleanup:

- `market_snapshot`
- `market_snapshot_v2`
- `market_token_balance`
- `market_jupiter_quote`
- `market_jupiter_quote_batch`
- `market_ohlcv`
- `market_indicators`
- `solana_marks_latest`
- `solana_scores_latest`
- `solana_views_top`
- `macro_signals`
- `macro_fred_indicators`
- `macro_etf_flows`
- `macro_stablecoin_health`
- `macro_oil_analytics`
- `perps_funding_surface`
- `perps_open_interest_surface`
- `perps_venue_score`

Authoritative catalog sources:

- `apps/worker/src/agent_query.ts`
- `apps/portal/app/api/_catalog.ts`
- `/api`, `/endpoints.json`, `/endpoints.txt`, `/llms.txt`, `/openapi.json`

## Completion Criteria For Future Cleanup

The remaining shared `src/runtime` and Worker `runtime_*` modules are retained
because current Worker tests and routes still consume them. Delete them only
after the Worker execution and market APIs are migrated to smaller terminal
contracts and the corresponding unit tests prove the new path.
