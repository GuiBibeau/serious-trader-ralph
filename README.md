# Trader Ralph

Trader Ralph is a frontend-only SvelteKit trading terminal UI. The app opens
directly to `/terminal`. Market chart, order book, trade tape, and market-list
panels use public Phoenix perpetuals data. When Privy is configured, the
terminal can provision a browser-side Solana wallet, activate the Ralph Phoenix
referral, fund with USDC/SOL, deposit to Phoenix margin, and submit Phoenix
perp transactions signed by the user.

No Cloudflare Worker, database, x402 service, Solana execution backend, React,
Next.js, Tailwind, icon library, dashboard-grid library, or motion library is
required to run the local UI. Privy is optional for local UI boot and required
for live wallet actions.

## What This Repo Contains

- `apps/portal`: SvelteKit dashboard UI.
- `packages/ui`: `@trader-ralph/ui` — shared design system (tokens, formatters,
  Svelte 5 components) consumed source-direct by the portal.
- `apps/portal/src/lib/phoenix-market-data.ts`: Phoenix perpetuals REST and
  WebSocket market data adapter.
- `apps/portal/src/lib/phoenix-trade.ts`: Phoenix referral activation,
  account-state, collateral, order, cancel, and transaction-builder helpers.
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
- Real Phoenix perpetuals data: market list, live candles, L2
  orderbook, market stats, funding, all-mids, and recent fills.
- Live Phoenix trading path: Privy embedded Solana wallet, current
  `/v1/referral/activate-tx` onboarding, USDC collateral deposit/withdraw,
  perp order placement, cancel/close, preflight simulation, user confirmation,
  wallet signature, RPC confirmation, and account-state refresh.
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

Live wallet actions use Solana mainnet. Set `NEXT_PUBLIC_SOLANA_RPC_URL`,
`PUBLIC_SOLANA_RPC_URL`, or `VITE_SOLANA_RPC_URL` to a browser-accessible
mainnet RPC with enough rate limit for simulation, submission, confirmation,
and balance reads.

## Important

This repo can submit live Solana transactions when Privy is configured and the
user signs. It does not include a geo gate yet. Do not expose live trading
publicly until the operator adds the required jurisdiction controls for the
target launch.
