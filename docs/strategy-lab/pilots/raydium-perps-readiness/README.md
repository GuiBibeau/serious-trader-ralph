# Raydium Perps Readiness Pilot

This pilot records why Raydium Perps remains a separate blocked venue candidate
instead of being treated like a normal Solana program-only adapter.

## Goal

- Venue: `raydium_perps`
- Instrument class: `perp`
- Highest justified state on 2026-03-13: `candidate`
- Stop state: do not advance beyond `candidate`

## Official Sources Reviewed On 2026-03-13

- [Raydium Perps](https://docs.raydium.io/raydium/traders/raydium-perps)
  - Documents Raydium Perps as a gasless CLOB product powered by Orderly
    Network infrastructure and states it is not available to residents of the
    United States of America and other prohibited jurisdictions.
- [API Perps](https://docs.raydium.io/raydium/build/resources/apis/api-perps)
  - Documents the public Raydium Perps API as market-data and protocol-state
    surface only.
- [Trading fees](https://docs.raydium.io/raydium/for-traders/raydium-perps/trading-fees)
  - Explicitly states that Orderly infrastructure is included in the taker fee.
- [API Authentication](https://orderly.network/docs/build-on-omnichain/evm-api/api-authentication)
  - Documents `orderly-key`, `orderly-secret`, and `orderly-account-id`
    requirements for private Orderly API access.
- [Wallet Authentication](https://orderly.network/docs/build-on-omnichain/user-flows/wallet-authentication)
  - Documents Orderly key generation and the account-linking flow needed before
    trading APIs can be used.

## Verdict

`raydium_perps` is credible enough to model as a distinct venue candidate with
a fail-closed control surface. It is not justified for `integrated` yet because
the execution path depends on an external Orderly account and private API auth
model that Trader Ralph does not yet represent.

## Why This Stops At `candidate`

- Raydium's public Perps API is read-only market data, not an order-entry
  surface.
- Private trading access depends on Orderly authentication headers and account
  state that are not yet represented in Trader Ralph's execution contract.
- The venue is explicitly unavailable to U.S. residents according to Raydium's
  docs reviewed on 2026-03-13.
- No checked-in adapter validation, replay fixtures, or dependency health model
  exists for the Orderly-backed flow.

## Follow-Up Gates

- `integrated`
  - encode the Orderly account, key, and signature model into a dedicated
    adapter contract and add mapping coverage evidence.
- `shadow_ready`
  - add adapter validation, replay fixtures, and external dependency health or
    rate-limit handling.
- `paper_ready`
  - add paper lifecycle coverage, fee or funding observations, and
    reconciliation against the private user data stream.
- `limited_live_ready`
  - only after jurisdiction, operator controls, and venue-specific canary
    posture are explicitly approved.

## Harness Sequence

1. Keep the venue live-disabled:

```bash
bun run strategy-lab:readiness \
  --operation control \
  --request-file docs/strategy-lab/pilots/raydium-perps-readiness/control.venue.request.json
```

2. Validate that the current promotion request remains blocked:

```bash
bun test \
  tests/unit/runtime_research_promotion.test.ts \
  tests/unit/runtime_venue_catalog.test.ts
```
