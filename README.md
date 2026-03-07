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
- `docs/product-specs`, `docs/design-docs`, `docs/reliability`,
  `docs/exec-plans`: repo-owned product, architecture, runbook, and rollout
  docs for the autonomous runtime program

## Repository Contract

- `WORKFLOW.md`: repo-owned execution contract for future issue runners and
  manual issue branches
- `docs/repository-verification-index.md`: architecture map, invariants,
  environment inventory, rollback steps, and verification playbooks
- `docs/product-specs/autonomous-runtime-prd.md`: repo-owned product spec for
  the Rust hot path rollout
- `docs/design-docs/autonomous-runtime-architecture.md`: system boundary,
  topology, and state ownership decisions for runtime-rs

## What Is Live

- Terminal UI at `/terminal`
- Terminal modes (`Regular`, `Degen`, `Custom`) with profile persistence
- Exchange-grade shell regions (chart, depth, order entry, positions/fills, account/risk)
- Realtime terminal transport with stream reconnect + polling fallback + staleness badges
- Live orderbook ladder with grouped levels, spread view, and click-to-prefill order context
- Dedicated trades tape panel with side/size filters, pause-resume, and compact/expanded modes
- Synchronized depth chart overlays with cumulative curves, spread, and imbalance annotations
- Terminal-grade market chart controls (timeframes, line/candles, mark/index/reference overlays, keyboard cursor nav)
- Advanced trade ticket with market/limit/trigger modes, TIF/flags, quantity modes, and TP/SL bracket validation
- Execution quality controls in ticket (lane, simulation preference, slippage, priority fee hints) with terminal activity surfacing
- Live positions panel with session PnL/risk badges and quick reduce/close actions wired to execution intents
- Open orders panel with pending/working/partial state, amend/cancel flows, and execute-now actions
- Fills ledger with request/receipt linkage, side/pair/status/query filters, pagination, and CSV export
- Account risk panel with equity/margin/concentration/liquidation warnings and pre-submit exposure guardrails
- Execution inspector drawer with timeline, attempts, and terminal receipt payload visibility
- Global terminal status bar for stream/API/lane health, data staleness badges, and diagnostics links
- Keyboard-first controls with configurable hotkey profiles, panel focus shortcuts, and command palette
- Custom-mode workspace presets with module visibility toggles and per-workspace layout persistence
- Degen mode module pack (watchlist + event hooks) with mandatory risk acknowledgement before submit
- Virtualized orderbook/tape/fills rendering plus terminal frame/render performance budget instrumentation
- Accessibility hardening: skip-link navigation, stronger contrast, and keyshortcut metadata on critical actions
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
- `NEXT_PUBLIC_TERMINAL_ALLOWED_MODES` (CSV from `regular,degen,custom`; default all)
- `NEXT_PUBLIC_TERMINAL_DEGEN_COHORT=all|onboarded|experienced|degen_acknowledged`
- `NEXT_PUBLIC_TERMINAL_CUSTOM_COHORT=all|onboarded|experienced|degen_acknowledged`
- `NEXT_PUBLIC_TERMINAL_RISK_INITIAL_MARGIN_RATIO` (default `0.1`)
- `NEXT_PUBLIC_TERMINAL_RISK_MAINT_MARGIN_RATIO` (default `0.05`)
- `NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_WARNING` (default `0.55`)
- `NEXT_PUBLIC_TERMINAL_RISK_CONCENTRATION_CRITICAL` (default `0.75`)
- `NEXT_PUBLIC_TERMINAL_RISK_LIQ_WARNING_BUFFER_PCT` (default `15`)
- `NEXT_PUBLIC_TERMINAL_RISK_LIQ_CRITICAL_BUFFER_PCT` (default `5`)
- `NEXT_PUBLIC_TERMINAL_RISK_MIN_EQUITY_QUOTE` (default `25`)

### Isolated per-worktree harness

```bash
bun run harness:up
bun run harness:status
bun run harness:down
bun run harness:proof
bun run runner:once
```

- `harness:up` starts a portal and worker pair with worktree-local ports and
  worker state under `.tmp/harness/<worktree-id>/`
- fresh worktrees bootstrap workspace dependencies automatically before the
  local stack starts
- `harness:status` prints the current local URLs, health, log directory, and
  state file for the active worktree
- `harness:down` tears down only the active worktree harness state
- `harness:proof` runs the Playwright browser proof suite against the active
  local harness, or a supplied preview URL via `--base-url`
- `runner:once` polls GitHub for `harness` + `agent-ready` issues, claims up to
  two at a time by default, executes Codex in isolated worktrees under
  `.tmp/runner/worktrees/`, and writes runner heartbeat state to
  `.harness/runner-heartbeat.json`

### Autonomous runtime skeleton

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo run -p runtime-rs
```

- Default health endpoint: `http://127.0.0.1:8081/health`
- Default env vars:
  - `RUNTIME_RS_BIND_ADDR=127.0.0.1:8081`
  - `RUNTIME_RS_ENV=local|preview|production`
  - `RUNTIME_RS_LOG=info`

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
- Terminal cutover plan: `docs/execution/terminal-cutover-plan-v1.md`
- Tabletop simulation record: `docs/execution/tabletop-simulation-2026-03-03.md`
- Fills ledger CSV format: `docs/execution/terminal-fills-ledger-export-v1.md`

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
  - `docs/agent-registry/metadata.production.json`
- Runbook: `docs/agent-registry/runbook.md`

Manual tooling:

```bash
bun run agent-registry:validate -- --lane dev
bun run agent-registry:sync -- --lane dev --step all --dry-run
bun run agent-registry:sync -- --lane production --step all
```

## Branch and Deploy Model

- Promotion flow: `codex/*` or `feature/*` -> PR preview -> `main`
- Branch environments:
  - `dev` -> `dev.trader-ralph.com` and `dev.api.trader-ralph.com`
  - `main` -> `trader-ralph.com`, `www.trader-ralph.com`, `api.trader-ralph.com`
- Internal pull requests also provision a Vercel portal preview and an
  ephemeral Cloudflare worker named `ralph-edge-pr-<pr-number>`.
- Cloudflare Worker and Vercel deploys are branch-driven in CI.

## Tests

```bash
bun run test:unit
bun run test:integration
bun run test:e2e
bun run test:integration:worker:live
```
