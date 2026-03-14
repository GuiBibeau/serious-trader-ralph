# DFlow Prediction-Market Readiness

- Reviewed on: `2026-03-14`
- Issue: `#376`
- Venue: `dflow`
- Instrument class: `prediction`
- Verdict: `integrated`
- Highest justified state: `integrated`
- Stop before: `shadow_ready`

## Official Sources Reviewed

- [DFlow getting started](https://pond.dflow.net/introduction/getting-started)
- [DFlow discover prediction markets](https://pond.dflow.net/build/recipes/prediction-markets/discover-markets)
- [DFlow market by mint metadata](https://pond.dflow.net/build/endpoints/metadata-api/market-by-mint)
- [DFlow track user positions](https://pond.dflow.net/build/recipes/prediction-markets/track-positions)
- [DFlow trade into position](https://pond.dflow.net/build/recipes/prediction-markets/trade-into-position)
- [DFlow monitor market lifecycle](https://pond.dflow.net/build/recipes/prediction-markets/monitor-market-lifecycle)
- [DFlow fees and settlement](https://pond.dflow.net/build/recipes/prediction-markets/fees-and-settlement)
- [DFlow prediction-market Proof or KYC guidance](https://pond.dflow.net/build/prediction-markets/kyc)

## What The Official Material Supports

The official DFlow material is strong enough to justify an `integrated`
prediction-market venue capability in Trader Ralph.

- The docs expose market discovery and market-by-mint reads that map cleanly to
  Ralph's `prediction_order` instrument model.
- The recipes document user-position tracking, lifecycle monitoring, settlement,
  redemption, and outcome-token account cleanup.
- The trading flow explicitly treats outcome tokens as Solana assets that can be
  bought, increased, decreased, and redeemed through DFlow-managed APIs and
  supporting metadata.

## Repo-Owned Contract Decision

DFlow should be treated as the first integrated prediction-market venue in
Ralph, but only for bounded shadow and paper execution.

- Worker read surfaces can use DFlow market discovery and market-by-mint
  metadata as the canonical prediction-market source.
- The execution router can support bounded `prediction_order` paper and shadow
  previews with DFlow-specific lifecycle and settlement metadata.
- Position and settlement state should remain separate from spot and perps.

## Why It Stops Before Shadow-Ready

The same official docs also make the live boundary explicit.

- Prediction-market production apps still require Proof or Kalshi compliance
  checks.
- The venue lifecycle includes settlement, redemption, and post-settlement token
  cleanup that need dedicated reconciliation fixtures before rollout.
- Ralph still needs canary-specific controls for tiny-notional production orders
  and settlement or redemption proof.

## Next Implementation Slice

The next issue after this integration should do only this:

1. Add live-gated Proof-aware account controls for prediction-market users.
2. Add settlement and redemption reconciliation fixtures.
3. Add bounded canary posture for tiny-notional live prediction orders.
