# Loop A Perp And Prediction Venue Parity

This note records the VP3 Loop A parity state for perp and prediction venues.

It sits on top of the VP1 lineage contract in
`docs/strategy-lab/venue-lineage-contracts.md` and the VP2 spot parity note in
`docs/strategy-lab/loop-a-spot-venue-parity.md`.

## Outcome

- Drift now has a venue-native Loop A bridge path from public market and
  funding snapshots into Loop A marks.
- DFlow now has a venue-native Loop A bridge path from prediction-market
  metadata into Loop A marks.
- Mango now has a checked snapshot bridge path for perp marks when a verified
  margin-account snapshot and market snapshot are available.
- Jupiter Perps, Raydium Perps / Orderly, Drift BET, and Monaco remain fail
  closed with checked-in blocked reasons instead of being silently absent from
  Loop A/B/C.

## Contract Additions

- Loop A mark lineage now accepts generic market identifiers, not only pubkeys.
- Loop A mark lineage now optionally carries:
  - `positionAccount`
  - `settlementMint`
- Loop A mark evidence now optionally carries:
  - `positionAccounts`
  - `settlementMints`
- Loop B and Loop C preserve those same fields through `venueLineage`.

These additions keep pair-level artifacts intact while letting non-swap venues
carry the lineage needed for later operator and recommender work.

## Venue State

| Venue | Market type | VP3 state | Substrate |
| --- | --- | --- | --- |
| Drift | `perp` | `bridge_live_api` | `apps/worker/src/loop_a/venue_bridge.ts` uses public contracts and funding-rate snapshots to mint Loop A marks with market and settlement lineage. |
| Mango | `perp` | `bridge_snapshot` | `apps/worker/src/loop_a/venue_bridge.ts` can mint Loop A perp marks from checked margin-account and market snapshots. |
| Jupiter Perps | `perp` | `blocked` | Official surface still says WIP; keep fail closed until replay and paper lifecycle fixtures exist. |
| Raydium Perps / Orderly | `perp` | `blocked` | Private Orderly auth, external account dependency, and U.S. restrictions remain unresolved for harness integration. |
| DFlow | `prediction` | `bridge_live_api` | `apps/worker/src/loop_a/venue_bridge.ts` maps market metadata into yes/no Loop A marks with account and settlement lineage. |
| Drift BET | `prediction` | `blocked` | Prediction-specific discovery and settlement fixtures are still missing. |
| Monaco | `prediction` | `blocked` | Maintained client path and operator-managed lifecycle boundary are still not locked. |

## Validation Scope

VP3 does not widen any live execution path. It only makes venue-native
recommendation inputs possible for bounded shadow and paper flows, or records a
checked fail-closed reason when the substrate is still missing.
