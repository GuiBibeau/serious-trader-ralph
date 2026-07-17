# Trader Ralph

[![CI](https://github.com/GuiBibeau/serious-trader-ralph/actions/workflows/ci.yml/badge.svg)](https://github.com/GuiBibeau/serious-trader-ralph/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/V4zuVbDVFf)

Trader Ralph is an open-source Solana trading terminal: Phoenix perpetuals
and Jupiter spot from one USDC account. Log in with an email address — a
Privy embedded wallet signs everything in the browser, no seed phrase, no
extension. Honest data is a design principle: every number on screen comes
from a live feed or the chain, and anything missing renders as an explicit
unavailable or gated state, never a placeholder.

Live at [traderralph.com](https://traderralph.com).

![Trader Ralph terminal — live Phoenix perps chart with order book, trade tape, and positions](https://traderralph.com/og/terminal.png)

## Features

- Live Phoenix perpetuals: candles, L2 order book, trade tape, funding, and
  market stats over REST + WebSocket.
- Chart as a trading surface: structure levels (prev-day high/low, swing
  pivots), click-to-trade limit tickets, draggable TP/SL handles on open
  positions, horizontal rays and a measure tool.
- Jupiter spot swaps alongside perps, settled from the same USDC account.
- Embedded Solana wallet via Privy email OTP — sign in with an address,
  trade from the browser.
- Funding wizard: QR receive, arrival detection, and Phoenix margin deposit
  in one flow.
- Take-profit/stop-loss orders and risk-based sizing ("risk $X to this
  stop").
- Trade journal and price alerts.
- Daily market recap card at [`/og/recap.png`](https://traderralph.com/og/recap.png),
  generated from live movers.
- [Discord community](https://discord.gg/V4zuVbDVFf) with verified-trader
  gating via [traderralph.com/discord](https://traderralph.com/discord).

What's coming: [the roadmap](https://github.com/GuiBibeau/serious-trader-ralph/issues/528).

## Quick Start

```bash
bun install
bun run dev
```

Open `http://localhost:3000/terminal`.

The app boots without any environment variables. Privy is optional for
local UI boot and required for live wallet actions.

### Optional env

- `PUBLIC_PRIVY_APP_ID` (or `NEXT_PUBLIC_PRIVY_APP_ID` / `VITE_PRIVY_APP_ID`)
  enables email auth and the embedded wallet. If your Privy app requires a
  client ID, also set `PUBLIC_PRIVY_CLIENT_ID` (or the `NEXT_PUBLIC_` /
  `VITE_` variant).
- `PUBLIC_SOLANA_RPC_URL` (or the `NEXT_PUBLIC_` / `VITE_` variant) points
  live wallet actions at a browser-accessible Solana mainnet RPC with
  enough rate limit for simulation, submission, confirmation, and balance
  reads.
- `PUBLIC_EDGE_API_BASE` (or the `NEXT_PUBLIC_` / `VITE_` variant) points
  the UI at the Trader Ralph edge API for plain read routes under
  `/api/read/<routeKey>`.

Private API keys, wallet keys, and manually issued bearer tokens must stay
out of the browser.

## Repo Layout

- `apps/portal` — the SvelteKit app; `src/routes/terminal/+page.svelte` is
  the terminal workstation.
- `packages/ui` — `@trader-ralph/ui`, the shared design system (tokens,
  formatters, Svelte 5 components), consumed source-direct by the portal.
- `apps/portal/src/lib/phoenix-market-data.ts` — Phoenix perpetuals REST and
  WebSocket market data adapter.
- `apps/portal/src/lib/phoenix-trade.ts` — Phoenix account-state,
  collateral, order, cancel, and transaction-builder helpers.
- `apps/portal/src/lib/edge-data.ts` — edge API reader for plain read
  routes plus auth-bound panels.

## Development

```bash
bun run typecheck   # packages/ui then apps/portal, 0 errors
bun run lint        # biome, 0 findings
bun run test        # typecheck + packages/ui drift tests
cd apps/portal && bun test   # portal unit tests
bun run build
```

Conventions (Svelte 5 runes, token-only CSS, server-only boundaries, the
no-fake-data rule) live in [AGENTS.md](AGENTS.md).

## Community

- Discord: [discord.gg/V4zuVbDVFf](https://discord.gg/V4zuVbDVFf) —
  verified-trader roles via [traderralph.com/discord](https://traderralph.com/discord).
- Bugs and requests: [GitHub Issues](https://github.com/GuiBibeau/serious-trader-ralph/issues).
- Roadmap: [issue #528](https://github.com/GuiBibeau/serious-trader-ralph/issues/528).

## Disclaimers

Trader Ralph is an open beta. Nothing here is financial advice; trading
perpetual futures carries real risk of loss. When Privy is configured, the
app submits live Solana mainnet transactions that the user signs.

Licensed under [Apache-2.0](LICENSE).
