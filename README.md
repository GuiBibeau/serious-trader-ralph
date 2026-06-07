# Trader Ralph

Trader Ralph is a Solana trading terminal with a Cloudflare Worker execution and
market-intelligence API.

## What This Repo Contains

- `apps/portal`: Next.js terminal UI.
- `apps/worker`: Cloudflare Worker API for execution, x402 paid reads,
  discovery, market data, macro data, perps intelligence, and local D1 state.
- `src/runtime/contracts`, `src/runtime/research`, `src/runtime/venues`, and
  `src/loops/contracts`: shared TypeScript contracts still consumed by the
  Worker and tests.
- `docs/execution`: public execution API contracts, schemas, fixtures, and
  operations notes.
- `docs/agent-registry`: agent registry metadata and sync runbook.
- `tests`: unit, integration, terminal E2E, and Worker live-test suites.

The old root CLI, isolated harness runner, Rust runtime sidecar, proof routes,
and strategy-desk UI have been removed. Repo workflows now center on the
terminal and Worker APIs.

## What Is Live

- Terminal UI at `/terminal`.
- Terminal modes (`Regular`, `Degen`, `Custom`) with profile persistence.
- Exchange-grade shell regions: chart, depth, order entry, open orders,
  positions, fills, account risk, status, diagnostics, and command palette.
- Advanced tickets for spot swaps, perps intents, and prediction-market intents.
- Realtime terminal transport with stream reconnect, polling fallback, and
  staleness badges.
- Macro and market modules for FRED, ETF flows, stablecoin health, oil,
  Solana loop marks, scores, and top views.
- x402 paid APIs for market, macro, Solana loop, perps intelligence, and
  execution submit/status/receipt.
- Agent Registry + discovery artifacts:
  - `GET /api/agent/query`
  - `GET /openapi.json`
  - `GET /agent-registry/metadata.json`

## Quick Start

```bash
bun install
bun run dev:local
```

- Portal: `http://localhost:3000`
- Worker health: `http://127.0.0.1:8888/api/health`

Useful local commands:

```bash
bun run build
bun run lint
bun run typecheck
bun run test:unit
bun run test:integration
bun run test:e2e
bun run edge:db:migrate:local
bun run edge:dev
```

Optional portal env:

- `NEXT_PUBLIC_TERMINAL_DEFAULT_MODE=regular|degen|custom`
- `NEXT_PUBLIC_TERMINAL_ALLOWED_MODES` (CSV from `regular,degen,custom`;
  default all)
- `NEXT_PUBLIC_TERMINAL_DEGEN_COHORT=all|onboarded|experienced|degen_acknowledged`
- `NEXT_PUBLIC_TERMINAL_CUSTOM_COHORT=all|onboarded|experienced|degen_acknowledged`
- `NEXT_PUBLIC_TERMINAL_RISK_INITIAL_MARGIN_RATIO` (default `0.1`)
- `NEXT_PUBLIC_TERMINAL_RISK_MAINT_MARGIN_RATIO` (default `0.05`)
- `NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_WARNING` (default `0.55`)
- `NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_CRITICAL` (default `0.75`)
- `NEXT_PUBLIC_TERMINAL_RISK_LIQ_WARNING_BUFFER_PCT` (default `15`)
- `NEXT_PUBLIC_TERMINAL_RISK_LIQ_CRITICAL_BUFFER_PCT` (default `5`)
- `NEXT_PUBLIC_TERMINAL_RISK_MIN_EQUITY_QUOTE` (default `25`)

## Market-Information Tools

x402 paid read routes (`POST`, under `/api/x402/read/*`):

- Market: `market_snapshot`, `market_snapshot_v2`, `market_token_balance`,
  `market_jupiter_quote`, `market_jupiter_quote_batch`, `market_ohlcv`,
  `market_indicators`
- Solana loop views: `solana_marks_latest`, `solana_scores_latest`,
  `solana_views_top`
- Macro: `macro_signals`, `macro_fred_indicators`, `macro_etf_flows`,
  `macro_stablecoin_health`, `macro_oil_analytics`
- Perps: `perps_funding_surface`, `perps_open_interest_surface`,
  `perps_venue_score`

Use discovery/openapi for the machine-readable catalog:

- `/api`
- `/endpoints.json`
- `/endpoints.txt`
- `/llms.txt`
- `/openapi.json`

## Execution API

- Contract doc: `docs/execution/exec-api-v1.md`
- Schemas: `docs/execution/schemas/*`
- Fixtures: `docs/execution/fixtures/*`
- Operations runbook: `docs/execution/operations-runbook-v1.md`
- Rollout plan: `docs/execution/rollout-plan-v1.md`
- Terminal cutover plan: `docs/execution/terminal-cutover-plan-v1.md`
- Fills ledger CSV format: `docs/execution/terminal-fills-ledger-export-v1.md`

x402 execution routes:

- Paid submit: `POST /api/x402/exec/submit`
- Public polling: `GET /api/x402/exec/status/:requestId`
- Public receipt: `GET /api/x402/exec/receipt/:requestId`

## Agent Registry

- Metadata source-of-truth:
  - `docs/agent-registry/metadata.dev.json`
  - `docs/agent-registry/metadata.production.json`
- Runbook: `docs/agent-registry/runbook.md`

Manual tooling:

```bash
bun run agent-registry:validate -- --lane dev
bun run agent-registry:sync -- --lane dev --step all --dry-run
bun run agent-registry:sync -- --lane production --step all
```

## Branch and Deploy Model

- Promotion flow: `codex/*` or `feature/*` -> PR preview -> `main`.
- Branch environments:
  - `dev` -> `dev.trader-ralph.com` and `dev.api.trader-ralph.com`
  - `main` -> `trader-ralph.com`, `www.trader-ralph.com`,
    `api.trader-ralph.com`
- Internal pull requests provision a Vercel portal preview and an ephemeral
  Cloudflare Worker named `ralph-edge-pr-<pr-number>`.
- Cloudflare Worker and Vercel deploys are branch-driven in CI.

## Tests

```bash
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:integration:worker:live
```
