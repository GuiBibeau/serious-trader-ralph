# Trader Ralph

Trader Ralph is a Solana-first trading infrastructure stack with two tracks:
- Agentic hedge fund loops (internal automation)
- Consumable signals via terminal and x402 endpoints

Codebase components:
- Next.js terminal + landing UI (`apps/portal`)
- Cloudflare Worker API (`apps/worker`)
- legacy CLI/gateway path under rebuild (`src/`)

## What Is Live

- Landing page + email sign-in flow
- Terminal at `/terminal` (market, macro, wallet, and trade ticket)
- Account-level Privy wallet model (one wallet per user account)
- Multi-pair spot swap execution through server-side policy/sign/submit flow
- x402-gated market and macro read routes
- Historical OHLCV and indicators backed by live providers

## Direction (In Progress)

- **Loop A (per-slot truth):** event decoding + canonical state + marks
- **Loop B (minute scoring):** feature extraction + scoring + cacheable views
- External productization focus: stable, explainable Solana intelligence endpoints
- Pair coverage focuses on Solana, stables, and liquid majors in the current terminal universe

## Requirements

- Bun
- Node 18+
- Wrangler CLI

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
bun install
bun run db:migrate:local
bun run dev:local
```

## Account Wallet Migration (One-Time)

Before applying the destructive bot-runtime schema migration, run:

```bash
cd apps/worker
bun run wallet:migrate:users -- --env <dev|staging|production> --dry-run
bun run wallet:migrate:users -- --env <dev|staging|production> --apply
```

Migration report output:
- `.tmp/wallet-migration-report-<env>.json`

## x402 Read Endpoints

All are `POST` under `/x402/read/*`:
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

### x402 Environment Policy

- `dev`: expects a real devnet transaction signature paying devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`)
- `staging` and `production`: expect a real mainnet transaction signature paying mainnet USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
- `payment-signature` is validated on-chain against route requirements (`network`, `asset`, `payTo`, and `amount`)

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

## API Catalog Maintenance Rule

When a new public x402 read endpoint is production-ready, update the public
catalog in the same PR before merge:
- `/Users/guillaumebibeau-laviolette/github/serious-trader-ralph/apps/portal/app/api/_catalog.ts`
- `/Users/guillaumebibeau-laviolette/github/serious-trader-ralph/apps/portal/app/api/page.tsx` (if presentation needs adjustment)
- `/Users/guillaumebibeau-laviolette/github/serious-trader-ralph/tests/unit/portal_api_catalog_routes.test.ts`

Rule: worker route changes under `/x402/read/*` and catalog/discovery docs
must ship together so `/api`, `/endpoints.json`, `/endpoints.txt`, and
`/llms.txt` remain accurate.

## Branch Promotion Flow

- Feature branches (`codex/*` or `feature/*`) open PRs into `dev`.
- `dev` is promoted to `staging` via PR.
- `staging` is promoted to `main` via PR.
- CI runs on push and pull request events for `dev`, `staging`, and `main`.
- Dev deployment runs on pushes to `dev`; staging/production deploys remain manual via workflow dispatch.

## Tests

```bash
bun run test:unit
bun run test:integration
bun run test:integration:worker:live
```

`test:integration:worker:live` runs the x402 live integration suite.

## Monorepo Layout

- `apps/portal`: Next.js UI
- `apps/worker`: Cloudflare Worker API
- `src/`: legacy CLI/gateway toolchain
- `tests/`: unit + integration tests
