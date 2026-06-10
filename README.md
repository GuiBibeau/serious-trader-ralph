# Trader Ralph

Trader Ralph is a frontend-only SvelteKit trading terminal UI. The app opens
directly to `/terminal`. Market chart, order book, trade tape, and market-list
panels use read-only public Phoenix perpetuals data. The dashboard also calls
the configured Trader Ralph edge API for macro, orders, private position, and
prediction-market panels. When Privy is configured, authenticated account-gated
edge routes receive the user's bearer token; if the edge route is unavailable
or still requires auth, the UI shows that real response instead of generating
placeholder rows.

No Cloudflare Worker, database, x402 service, Solana execution backend, React,
Next.js, Tailwind, icon library, dashboard-grid library, or motion library is
required to run the local UI. Privy is optional for local UI boot and only needed
for authenticated account-gated edge reads. Live execution workflows still
require the external edge/auth/payment stack.

## What This Repo Contains

- `apps/portal`: SvelteKit dashboard UI.
- `apps/portal/src/lib/phoenix-market-data.ts`: read-only Phoenix perpetuals
  REST and WebSocket market data adapter.
- `apps/portal/src/lib/edge-data.ts`: Trader Ralph edge API reader for plain
  read routes plus auth-bound order, perp, and prediction panels.
- `apps/portal/src/routes/terminal/+page.svelte`: the terminal workstation.

The old worker, runtime contracts, backend tests, backend docs, deployment
workflows, schema-generation scripts, and React/Next portal have been removed.

## Quick Start

```bash
bun install
bun run dev
```

Open `http://localhost:3000/terminal`.

Useful commands:

```bash
bun run typecheck
bun run build
bun run lint
bun run test
```

## UI Surface

- Dashboard modules: chart, depth, order entry, open orders, positions, account
  risk, status bar, macro widgets, Phoenix markets, event hooks, perps, and
  prediction markets.
- Real read-only Phoenix perpetuals data: market list, live candles, L2
  orderbook, market stats, funding, all-mids, and recent fills.
- Real edge API status for plain read routes and gated account, order, perp,
  and prediction endpoints.
- Optional Privy email authentication for passing bearer tokens to account-gated
  edge API routes.
- No simulated wallet balances, execution receipts, open orders, perps, or
  prediction positions.

## Optional Env

The app runs without private keys. `NEXT_PUBLIC_EDGE_API_BASE`,
`PUBLIC_EDGE_API_BASE`, or `VITE_EDGE_API_BASE` can point the UI at the Trader
Ralph edge API. Public read data is expected under `/api/read/<routeKey>` with
no x402 payment wrapper.

Privy email auth can be enabled with `NEXT_PUBLIC_PRIVY_APP_ID`,
`PUBLIC_PRIVY_APP_ID`, or `VITE_PRIVY_APP_ID`. If your Privy app requires a
client ID, set `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `PUBLIC_PRIVY_CLIENT_ID`, or
`VITE_PRIVY_CLIENT_ID` as well. Private API keys, wallet keys, and manually
issued bearer tokens must stay out of the browser.

## Important

This repo does not submit live trades. Browser-visible data is either fetched
from public read-only market APIs, fetched from the configured edge API, or
shown as unavailable/auth-required. It should not invent live account or
execution state.
