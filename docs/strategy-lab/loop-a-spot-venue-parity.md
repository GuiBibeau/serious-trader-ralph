# Loop A Spot Venue Parity

This note records the VP2 Loop A ingestion posture for the spot and spot-CLOB
venues in the runtime catalog.

## Native Loop A Paths

| Venue | Loop A path | Provenance identifier |
| --- | --- | --- |
| Jupiter | Native balance-delta swap adapter | venue |
| Raydium | Native balance-delta swap adapter | pool |
| Orca | Native balance-delta swap adapter | pool |
| OpenBook v2 | Native balance-delta swap adapter for filled spot CLOB transactions | market |
| Phoenix | Native balance-delta swap adapter for filled spot CLOB transactions | market |

## Non-Applicable In VP2

| Venue | Status | Missing substrate |
| --- | --- | --- |
| MagicBlock | Fail closed for direct Loop A marks | Current repo path is an ephemeral rollup execution adapter. It does not emit a repo-owned L1 event feed that can be decoded into deterministic Loop A marks without a rollup event indexer or settlement mirror. |
| `flash_liquidity` | Fail closed for direct Loop A marks | The current repo path is an atomic `flash_atomic` execution substrate, not a venue-native quote or fill stream. It needs a dedicated flash planning and settlement telemetry substrate rather than a swap-mark decoder. |

## Coexistence Rules

- Loop A latest mark sets may contain multiple marks for the same pair when
  venue identity differs.
- Pair-scoped compatibility keys remain in place for existing readers.
- Venue-scoped Loop A keys preserve same-pair multi-venue marks for downstream
  harness work.
- Loop B and Loop C carry additive `market` and `markets` provenance so spot
  CLOB venues do not need to overload AMM pool fields.
