# Harness

[![CI](https://github.com/GuiBibeau/harness-trade/actions/workflows/ci.yml/badge.svg)](https://github.com/GuiBibeau/harness-trade/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/V4zuVbDVFf)

Harness is an open-source trading terminal for Solana — perps and spot from
one account, with AI you hold the reins on.

Live at [harness.trade](https://harness.trade).

![Harness terminal](https://harness.trade/og/terminal.png)

## Features

- Live Phoenix perps: candles, order book, tape, funding
- Trade from the chart: structure levels, click-to-trade, draggable TP/SL,
  rays + measure
- Jupiter spot swaps from the same account
- TP/SL orders, risk-based sizing, journal, alerts
- Funding wizard, daily [recap card](https://harness.trade/og/recap.png),
  [verified-trader Discord](https://harness.trade/discord)

What's coming: [the roadmap](https://github.com/GuiBibeau/harness-trade/issues/528).

## Quick Start

```bash
bun install
bun run dev
```

Open `http://localhost:3000/terminal`. Boots with zero env vars; set
`PUBLIC_PRIVY_APP_ID` and `PUBLIC_SOLANA_RPC_URL` to enable the wallet and
live trading. Keys never belong in the browser.

## Development

```bash
bun run typecheck && bun run lint && bun run test
cd apps/portal && bun test
bun run build
```

`apps/portal` is the SvelteKit app (`src/routes/terminal/` is the terminal);
`packages/ui` is the shared design system. Conventions live in
[AGENTS.md](AGENTS.md).

## Community

[Discord](https://discord.gg/V4zuVbDVFf) ·
[Issues](https://github.com/GuiBibeau/harness-trade/issues) ·
[Roadmap](https://github.com/GuiBibeau/harness-trade/issues/528)

Open beta. Not financial advice — perps carry real risk of loss.
Licensed under [Apache-2.0](LICENSE).
