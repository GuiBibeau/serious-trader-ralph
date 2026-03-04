# Trader Ralph

Trader Ralph is agentic trading infrastructure for Solana.

It provides one execution fabric for:
- external agents
- first-party terminal users
- server-driven automation

## What This Repo Contains

- `apps/portal`: Next.js site + terminal UI
- `apps/worker`: Cloudflare Worker API (execution, x402, discovery)
- `tests/`: unit + integration tests
- `docs/`: execution contracts, registry runbooks, and metadata

## What Is Live

- Terminal UI at `/terminal`
- Terminal modes (`Regular`, `Degen`, `Custom`) with profile persistence
- Exchange-grade shell regions (chart, depth, order entry, positions/fills, account/risk)
- Realtime terminal transport with stream reconnect + polling fallback + staleness badges
- Live orderbook ladder with grouped levels, spread view, and click-to-prefill order context
- Dedicated trades tape panel with side/size filters, pause-resume, and compact/expanded modes
- Synchronized depth chart overlays with cumulative curves, spread, and imbalance annotations
- Terminal-grade market chart controls (timeframes, line/candles, mark/index/reference overlays, keyboard cursor nav)
- Account-level Privy wallet model (one wallet per user)
- x402 paid APIs (`/api/x402/read/*`, `/api/x402/exec/submit`)
- Execution API scaffold:
  - `POST /api/x402/exec/submit`
  - `GET /api/x402/exec/status/:requestId`
  - `GET /api/x402/exec/receipt/:requestId`
- Agent Registry + discovery artifacts:
  - `GET /api/agent/query`
  - `GET /openapi.json`
  - `GET /agent-registry/metadata.json`

## Quick Start

### Full local stack (recommended)

```bash
bun install
bun run dev:local
```

- Portal: `http://localhost:3000`
- Worker health: `http://127.0.0.1:8888/api/health`

Optional portal env:

- `NEXT_PUBLIC_TERMINAL_DEFAULT_MODE=regular|degen|custom`

### Worker only

```bash
cd apps/worker
bun install
bun run db:migrate:local
bun run dev:local
```

## API Overview

### Execution API (v1 draft contract)

- Contract doc: `docs/execution/exec-api-v1.md`
- Schemas: `docs/execution/schemas/*`
- Fixtures: `docs/execution/fixtures/*`
- Operations runbook: `docs/execution/operations-runbook-v1.md`
- Rollout plan: `docs/execution/rollout-plan-v1.md`
- Tabletop simulation record: `docs/execution/tabletop-simulation-2026-03-03.md`

### x402 API

x402 paid read routes (`POST`, under `/api/x402/read/*`):

- Market: `market_snapshot`, `market_snapshot_v2`, `market_token_balance`, `market_jupiter_quote`, `market_jupiter_quote_batch`, `market_ohlcv`, `market_indicators`
- Solana loop views: `solana_marks_latest`, `solana_scores_latest`, `solana_views_top`
- Macro: `macro_signals`, `macro_fred_indicators`, `macro_etf_flows`, `macro_stablecoin_health`, `macro_oil_analytics`
- Perps: `perps_funding_surface`, `perps_open_interest_surface`, `perps_venue_score`

x402 execution routes:
- Paid submit: `POST /api/x402/exec/submit`
- Public polling: `GET /api/x402/exec/status/:requestId`, `GET /api/x402/exec/receipt/:requestId`

Use discovery/openapi for machine-readable catalog:
- `/api`
- `/endpoints.json`
- `/endpoints.txt`
- `/llms.txt`
- `/openapi.json`

## Agent Registry

- Metadata source-of-truth:
  - `docs/agent-registry/metadata.dev.json`
  - `docs/agent-registry/metadata.staging.json`
  - `docs/agent-registry/metadata.production.json`
- Runbook: `docs/agent-registry/runbook.md`

Manual tooling:

```bash
bun run agent-registry:validate -- --lane dev
bun run agent-registry:sync -- --lane dev --step all --dry-run
bun run agent-registry:sync -- --lane production --step all
```

## Branch and Deploy Model

- Promotion flow: `codex/*` or `feature/*` -> `dev` -> `staging` -> `main`
- Branch environments:
  - `dev` -> `dev.trader-ralph.com` and `dev.api.trader-ralph.com`
  - `staging` -> `staging.trader-ralph.com` and `staging.api.trader-ralph.com`
  - `main` -> `trader-ralph.com`, `www.trader-ralph.com`, `api.trader-ralph.com`
- Cloudflare Worker and Vercel deploys are branch-driven in CI.

## Tests

```bash
bun run test:unit
bun run test:integration
bun run test:integration:worker:live
```
