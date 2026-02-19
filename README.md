# Trader Ralph

Trader Ralph is a Solana-first trading stack with:
- a Next.js control room UI (`apps/portal`)
- a Cloudflare Worker runtime for multi-tenant bot loops (`apps/worker`)
- a legacy local CLI/gateway path (`src/`)

## What Is Live In This Repo

- Bot control room + per-bot room in the portal
- x402-gated market read endpoints in the worker
- Agent strategy tool loop (market research + optional trade execution)
- Async backtest queue with bot-scoped run history and details
- Historical OHLCV and technical indicators backed by live providers
- Live integration test suite for x402 routes and agent market tools

Important network behavior:
- x402 payments are configured for devnet USDC in testing environments
- x402 and agentic market tools fetch mainnet market data/liquidity

## Requirements

- Bun (monorepo package manager / test runner)
- Node 18+
- Wrangler CLI (`npm i -g wrangler` or local install in `apps/worker`)

## Quick Start (Portal + Worker)

```bash
bun install
bun run dev
```

- Portal: `http://localhost:3000`
- Worker: `http://127.0.0.1:8888/api/health`

## Worker Local Quick Start

```bash
cd apps/worker
npm install
npm run db:migrate:local
npm run loop:enable:local
npm run dev:local
```

Recommended `apps/worker/.dev.vars` baseline:

```bash
# Auth / control
ADMIN_TOKEN=local-dev

# RPC (mainnet data path)
RPC_ENDPOINT=https://api.mainnet-beta.solana.com
BALANCE_RPC_ENDPOINT=https://api.mainnet-beta.solana.com

# Inference defaults (optional if you store per-bot provider in UI)
ZAI_BASE_URL=https://api.z.ai/api/paas/v4
ZAI_MODEL=glm-5
ZAI_API_KEY=...

# Required to persist encrypted per-bot inference provider API keys
# Generate with: openssl rand -base64 32
INFERENCE_ENCRYPTION_KEY_B64=...

# OHLCV providers (at least one for live historical endpoints/tools)
BIRDEYE_API_KEY=...
# Or use Dune:
# DUNE_API_KEY=...
# DUNE_QUERY_ID=...
# DUNE_API_URL=https://api.dune.com
```

## x402 Read Endpoints

All are `POST` under `/api/x402/read/*`:

- `market_snapshot`
- `market_snapshot_v2`
- `market_token_balance`
- `market_jupiter_quote`
- `market_jupiter_quote_batch`
- `market_ohlcv` (hourly bars, live sources only)
- `market_indicators` (SMA/EMA/RSI/MACD + returns from hourly bars)
- `macro_signals` (macro radar with composite BUY/CASH verdict)
- `macro_fred_indicators` (FRED macro series snapshot)
- `macro_etf_flows` (BTC/SOL ETF flow-structure proxy)
- `macro_stablecoin_health` (stablecoin peg stress monitor)
- `macro_oil_analytics` (WTI/Brent/US production/inventory)

`apps/worker/wrangler.toml` includes matching `X402_*_PRICE_USD` vars for each route.

## Agent Tooling (Strategy `type: "agent"`)

Current tool catalog includes:

- `control_finish`
- `market_snapshot`
- `market_token_balance`
- `market_jupiter_quote`
- `market_jupiter_quote_batch`
- `market_ohlcv_history`
- `market_indicators`
- `macro_signals`
- `macro_fred_indicators`
- `macro_etf_flows`
- `macro_stablecoin_health`
- `macro_oil_analytics`
- `backtest_run_create`
- `backtest_run_list`
- `backtest_run_get`
- `trades_list_recent`
- `memory_update_thesis`
- `memory_log_observation`
- `memory_add_reflection`
- `trade_jupiter_swap`

## Run Worker Live Integration Tests

From repo root:

```bash
bun run test:integration:worker:live
```

These tests:
- verify all x402 routes return proper payment requirements (devnet USDC)
- verify paid x402 calls return live mainnet data
- verify agent market tools work without x402 payment config

Notes:
- Tests auto-load env from shell or `apps/worker/.dev.vars`
- For OHLCV tests, you must set either:
  - `BIRDEYE_API_KEY`, or
  - both `DUNE_API_KEY` and `DUNE_QUERY_ID`
- Optional macro providers:
  - `FRED_API_KEY` (for `macro_fred_indicators`)
  - `EIA_API_KEY` (for `macro_oil_analytics`)

## Monorepo Layout

- `apps/portal`: Next.js UI (landing + control room + bot room)
- `apps/worker`: Cloudflare Worker runtime, x402, loop engine, agent tools
- `src/`: legacy CLI/gateway toolchain
- `tests/`: unit + integration tests

## Additional Docs

- Worker details and route examples: `apps/worker/README.md`
