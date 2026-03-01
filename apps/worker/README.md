# Ralph Edge Worker

Cloudflare Worker providing:
- monitoring and account-wallet APIs
- x402-gated market/macro data routes
- manual onboarding billing surfaces

## Setup

```bash
wrangler d1 create ralph_waitlist
wrangler kv:namespace create CONFIG_KV
wrangler r2 bucket create ralph-logs
wrangler d1 migrations apply WAITLIST_DB

wrangler secret put PRIVY_APP_ID
wrangler secret put PRIVY_APP_SECRET
wrangler secret put BILLING_MERCHANT_WALLET
wrangler secret put RPC_ENDPOINT
wrangler secret put BALANCE_RPC_ENDPOINT
wrangler secret put JUPITER_API_KEY
wrangler secret put BIRDEYE_API_KEY
wrangler secret put DUNE_API_KEY
wrangler secret put DUNE_QUERY_ID
wrangler secret put DUNE_API_URL
wrangler secret put FRED_API_KEY
wrangler secret put EIA_API_KEY
```

x402 route pricing/network vars are configured in `wrangler.toml` via `X402_*` values.
Set `X402_ENFORCE_ONCHAIN=1` in deployed environments so `payment-signature`
is verified as an on-chain Solana transaction against route requirements.

## Local Quick Start

```bash
cd apps/worker
npm install
npm run db:migrate:local
npm run dev:local
```

## API

### Core
- `GET /api/health`
- `GET /api/me` (auth required; returns `user` + account `wallet` + `experience` + `consumerProfile`)
- `PUT /api/onboarding/complete` (auth required; validates onboarding answers and assigns level)
- `PATCH /api/me/experience-level` (auth required; manual experience override, degen requires acknowledgement)
- `PATCH /api/me/profile` (auth required)
- `GET /api/wallet/balance` (auth required; account wallet balances for tracked trading tokens)

### Billing / Access
- `GET /api/billing/plans` (manual onboarding mode)
- `POST /api/billing/checkout` (`410`, manual onboarding only)
- `GET /api/billing/checkout/:intentId` (`410`, manual onboarding only)

### x402 Read Endpoints
All `POST` under `/api/x402/read/*`:
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

### x402 Network Policy by Environment

- `dev`: `X402_NETWORK=solana-devnet`, `X402_ASSET_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- `staging`/`production`: `X402_NETWORK=solana-mainnet`, `X402_ASSET_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

### Supported Trading Pairs (Terminal + Trade APIs)

- `SOL/USDC`
- `SOL/USDT`
- `USDC/USDT`
- `USDC/PYUSD`
- `USDC/USD1`
- `USDC/USDG`
- `SOL/JITOSOL`
- `SOL/MSOL`
- `SOL/JUPSOL`
- `RAY/USDC`
- `WIF/USDC`
- `JUP/USDC`
- `BONK/USDC`
- `JTO/USDC`
- `PYTH/USDC`

### Removed During Botless Cutover
The following now return `410`:
- `/api/bots/*`
- `/api/admin/bots/*`
- `/api/loop/*`
- `/api/config`
- `/api/trades`

## Wallet Migration Workflow

1. Run one-time wallet migration script before destructive schema cleanup:

```bash
cd apps/worker
npm run wallet:migrate:users -- --env <dev|staging|production> --dry-run
npm run wallet:migrate:users -- --env <dev|staging|production> --apply
```

2. Review generated audit report:
- `.tmp/wallet-migration-report-<env>.json`

3. Apply migrations through `0022_remove_bot_runtime.sql` after migration verification.

## Live Integration Tests

From repo root:

```bash
bun run test:integration:worker:live
```

This validates x402 endpoint payment requirements and paid-read responses.

## Manual Access Admin Helper

```bash
cd apps/worker
npm run access:grant -- --env staging --privy-user-id did:privy:abc
```
