# Ralph Edge Worker

Cloudflare Worker providing:
- loop control (`POST /api/loop/start`, `POST /api/loop/stop`)
- cron-triggered loop ticks (Jupiter swaps signed by Privy)
- bot loops (multi-tenant) scheduled via Durable Object alarms
- manual onboarding-gated API access

## Setup

```bash
wrangler d1 create ralph_waitlist
wrangler kv:namespace create CONFIG_KV
wrangler r2 bucket create ralph-logs
wrangler d1 migrations apply ralph_waitlist
wrangler secret put ADMIN_TOKEN
wrangler secret put RPC_ENDPOINT
wrangler secret put JUPITER_BASE_URL
wrangler secret put JUPITER_API_KEY
wrangler secret put BIRDEYE_API_KEY
wrangler secret put DUNE_API_KEY
wrangler secret put DUNE_QUERY_ID
wrangler secret put DUNE_API_URL
wrangler secret put FRED_API_KEY
wrangler secret put EIA_API_KEY
wrangler secret put ZAI_API_KEY
wrangler secret put INFERENCE_ENCRYPTION_KEY_B64
wrangler secret put BILLING_MERCHANT_WALLET

# Optional (defaults to Solana USDC mint):
wrangler secret put BILLING_STABLE_MINT

# Optional (billing verification RPC; defaults to devnet in wrangler.toml):
# wrangler secret put BILLING_RPC_ENDPOINT

# Optional (bot wallet balance RPC; defaults to mainnet in wrangler.toml):
# wrangler secret put BALANCE_RPC_ENDPOINT

# x402 paid-read route config (set as vars/secrets per environment):
# X402_NETWORK=solana-devnet
# X402_PAY_TO=<merchant-wallet-pubkey>
# X402_ASSET_MINT=<payment-mint>
# X402_MAX_TIMEOUT_SECONDS=60
# X402_MARKET_SNAPSHOT_PRICE_USD=0.01
# X402_MARKET_SNAPSHOT_V2_PRICE_USD=0.01
# X402_MARKET_TOKEN_BALANCE_PRICE_USD=0.01
# X402_MARKET_JUPITER_QUOTE_PRICE_USD=0.01
# X402_MARKET_JUPITER_QUOTE_BATCH_PRICE_USD=0.01
# X402_MARKET_OHLCV_PRICE_USD=0.01
# X402_MARKET_INDICATORS_PRICE_USD=0.01
# X402_MACRO_SIGNALS_PRICE_USD=0.01
# X402_MACRO_FRED_INDICATORS_PRICE_USD=0.01
# X402_MACRO_ETF_FLOWS_PRICE_USD=0.01
# X402_MACRO_STABLECOIN_HEALTH_PRICE_USD=0.01
# X402_MACRO_OIL_ANALYTICS_PRICE_USD=0.01

# Note: x402 payment network comes from X402_NETWORK (e.g. devnet), while
# x402 public read endpoints (`market_snapshot`, `market_snapshot_v2`, `market_token_balance`,
# `market_jupiter_quote`, `market_jupiter_quote_batch`, `market_ohlcv`, `market_indicators`,
# `macro_signals`, `macro_fred_indicators`, `macro_etf_flows`, `macro_stablecoin_health`,
# `macro_oil_analytics`) always
# query mainnet market data.
#
# Agentic market tools also query mainnet market data/liquidity.

# Only required for live trading (non-dry-run):
wrangler secret put PRIVY_APP_ID
wrangler secret put PRIVY_APP_SECRET
wrangler secret put PRIVY_WALLET_ID
wrangler dev
```

Replace the `REPLACE_WITH_*` placeholders in `wrangler.toml` with the IDs
output by Wrangler (KV namespace IDs and D1 database IDs).

## Local Quickstart (Fast Loop Testing)

This uses `wrangler dev --local` with a persisted local state directory so you
can iterate on the loop quickly without touching real Cloudflare resources.

```bash
cd apps/worker
npm install

# Create a `.dev.vars` with at least:
# RPC_ENDPOINT=https://api.mainnet-beta.solana.com
# ADMIN_TOKEN=local-dev
# TENANT_ID=local
#
# For dry-run loop testing (no Privy required):
# DRYRUN_WALLET_ADDRESS=11111111111111111111111111111111
#
# Optional: Jupiter API settings.
# The worker defaults to the Jupiter lite host, which is intended for free/testing.
# For heavier production use, set JUPITER_BASE_URL to the pro host and provide JUPITER_API_KEY.
# JUPITER_BASE_URL=https://lite-api.jup.ag
# JUPITER_API_KEY=...
# Optional: Dune for alternate market data feeds.
# DUNE_API_KEY=...
# DUNE_QUERY_ID=...
# DUNE_API_URL=https://api.dune.com
#
# LLM API key (OpenAI-compatible chat completions).
# ZAI_API_KEY=...
#
# Required to persist encrypted per-bot inference provider API keys.
# Generate with: openssl rand -base64 32
# INFERENCE_ENCRYPTION_KEY_B64=...
#
# Create the local D1 DB and apply migrations into the persisted state dir.
npm run db:migrate:local

# Enable the loop in local KV (cron + /__scheduled will no-op if disabled).
npm run loop:enable:local

# Start the local dev server (includes --test-scheduled).
npm run dev:local
```

In another terminal you can force a scheduled tick:

```bash
cd apps/worker
npm run loop:tick:local
```

Or open `http://127.0.0.1:8888/__scheduled` in a browser to trigger the
scheduled event handler.
By default this local dev script binds to port `8888` to avoid clashing with
the local Ralph gateway (which commonly uses `8787`).
Note: Wrangler local mode uses the preview KV namespace by default, so the
`loop:*:local` scripts write to the preview namespace to match.

## Notes
- Cron runs every minute by default for the legacy single-tenant loop (KV key `loop:config`).
- Multi-tenant bot loops store config in D1 (`loop_configs`) and are scheduled via Durable Object alarms.
- The loop runs strategies defined in config and executes spot swaps via Jupiter.
- Agent strategy runs a multi-step tool loop (LLM can call tools multiple times per tick).
- Logs are written to R2 (`ralph-logs`) as JSONL.
- Privy keychain credentials are read from secrets (see `PRIVY_*` above).

## API

- `GET /api/billing/plans` (requires auth; returns manual onboarding mode)
- `POST /api/billing/checkout` (disabled; manual onboarding only)
- `GET /api/billing/checkout/:intentId` (disabled; manual onboarding only)
- `GET /api/loop/status`
- `POST /api/loop/start` (requires `Authorization: Bearer <ADMIN_TOKEN>`)
- `POST /api/loop/stop` (requires `Authorization: Bearer <ADMIN_TOKEN>`)
- `POST /api/loop/tick` (requires admin; triggers a tick immediately)
- `GET /api/trades?limit=50` (requires admin; last executed trades)
- `POST /api/config` (requires admin; accepts `{ policy: {...}, strategy: {...} }`)
- `POST /api/bots/:botId/backtests` (enqueue async backtest run)
- `GET /api/bots/:botId/backtests?limit=20&status=running` (list compact run summaries)
- `GET /api/bots/:botId/backtests/:runId` (run metadata + request + result + recent events)
- `GET /api/bots/:botId/backtests/:runId/events?limit=200` (paged run timeline events)
- `POST /api/x402/read/market_snapshot` (x402-gated paid read; mainnet market data)
- `POST /api/x402/read/market_snapshot_v2` (x402-gated paid read; snapshot + selected token balances)
- `POST /api/x402/read/market_token_balance` (x402-gated paid read; wallet balance for one mint)
- `POST /api/x402/read/market_jupiter_quote` (x402-gated paid read; mainnet market data)
- `POST /api/x402/read/market_jupiter_quote_batch` (x402-gated paid read; batch quote summaries)
- `POST /api/x402/read/market_ohlcv` (x402-gated paid read; hourly OHLCV from live sources only)
- `POST /api/x402/read/market_indicators` (x402-gated paid read; OHLCV-derived technical indicators)
- `POST /api/x402/read/macro_signals` (x402-gated paid read; macro regime/radar summary)
- `POST /api/x402/read/macro_fred_indicators` (x402-gated paid read; FRED macro series snapshot)
- `POST /api/x402/read/macro_etf_flows` (x402-gated paid read; BTC/SOL ETF flow structure proxy)
- `POST /api/x402/read/macro_stablecoin_health` (x402-gated paid read; stablecoin peg stress)
- `POST /api/x402/read/macro_oil_analytics` (x402-gated paid read; oil/energy macro metrics)

### x402 Historical OHLCV (Hourly)

`POST /api/x402/read/market_ohlcv` body:

```json
{
  "baseMint": "So11111111111111111111111111111111111111112",
  "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "lookbackHours": 168,
  "limit": 168,
  "resolutionMinutes": 60
}
```

Notes:
- `resolutionMinutes` is fixed to `60` (hourly bars only in v1).
- Runtime paths are live-source-only (`birdeye`, `dune`) and do not fall back to fixture data.

### x402 Indicators (Hourly-derived)

`POST /api/x402/read/market_indicators` body:

```json
{
  "baseMint": "So11111111111111111111111111111111111111112",
  "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "lookbackHours": 168,
  "limit": 168,
  "resolutionMinutes": 60
}
```

Response includes:
- `ohlcv` bars (hourly)
- `indicators` summary (returns, SMA/EMA, RSI, MACD)

## Agent Tool Catalog (`strategy.type = "agent"`)

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
- `trades_list_recent`
- `memory_update_thesis`
- `memory_log_observation`
- `memory_add_reflection`
- `trade_jupiter_swap`
- `backtest_run_create`
- `backtest_run_list`
- `backtest_run_get`

## Live Integration Tests

From the repo root:

```bash
bun run test:integration:worker:live
```

What this validates:
- x402 endpoints return `402 payment-required` with devnet USDC payment requirements
- x402 endpoints return live mainnet data when `payment-signature` is present
- agent market tools return live mainnet data without x402 payment config

Test env requirements (shell or `apps/worker/.dev.vars`):
- `BALANCE_RPC_ENDPOINT` or `RPC_ENDPOINT`
- one OHLCV provider path:
  - `BIRDEYE_API_KEY`, or
  - both `DUNE_API_KEY` and `DUNE_QUERY_ID`

Optional:
- `JUPITER_API_KEY`
- `X402_*` overrides (defaults exist in test utils/wrangler vars)

## Manual Access Admin Helper

Grant manual access in a specific environment:

```bash
cd apps/worker

# By Privy user id (recommended; creates user row if missing)
npm run access:grant -- --env staging --privy-user-id did:privy:abc

# Or by internal user id
npm run access:grant -- --env production --user-id <users.id>

# Optional best-effort by email (matches users.profile.email)
npm run access:grant -- --env dev --email user@example.com
```

Options:
- `--env dev|staging|production` (required)
- `--plan <id>` (default: `manual_access`)
- `--years <n>` (default: `1`)
- `--source <text>` (default: `manual_onboarding`)

### Example Strategy Config (DCA)

`POST /api/config` body:

```json
{
  "policy": {
    "dryRun": true,
    "slippageBps": 50,
    "maxPriceImpactPct": 0.05,
    "maxTradeAmountAtomic": "0",
    "minSolReserveLamports": "50000000"
  },
  "strategy": {
    "type": "dca",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": "10000000",
    "everyMinutes": 60
  }
}
```

### Example Strategy Config (Agent Tool Loop)

`POST /api/config` body:

```json
{
  "policy": {
    "dryRun": false,
    "simulateOnly": true,
    "slippageBps": 50,
    "maxPriceImpactPct": 0.05,
    "maxTradeAmountAtomic": "0",
    "minSolReserveLamports": "50000000"
  },
  "strategy": {
    "type": "agent",
    "mandate": "Trade SOL vs USDC cautiously. Prefer no trade over a bad trade. Keep a clear thesis and log observations.",
    "minConfidence": "medium",
    "maxStepsPerTick": 4,
    "maxToolCallsPerStep": 4,
    "quoteMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "quoteDecimals": 6
  }
}
```

### Mainnet Tool Testing Mode (Simulate Only)

If you want to validate the full pipeline (Jupiter quote + Jupiter swap tx build + Privy signing + Solana RPC),
but do not want to broadcast trades yet, set:

```json
{
  "policy": {
    "dryRun": false,
    "simulateOnly": true
  }
}
```

This will call `simulateTransaction` on the signed swap transaction and store a `simulated` (or `simulate_error`)
row in the trade index.
