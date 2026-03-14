# Mango v4 Readiness

Reviewed on 2026-03-14 against official Mango sources:

- https://github.com/blockworks-foundation/mango-v4
- https://raw.githubusercontent.com/blockworks-foundation/mango-v4/dev/README.md
- https://raw.githubusercontent.com/blockworks-foundation/mango-v4/dev/ts/client/src/accounts/mangoAccount.ts
- https://raw.githubusercontent.com/blockworks-foundation/mango-v4/dev/ts/client/src/accounts/healthCache.ts
- https://raw.githubusercontent.com/blockworks-foundation/mango-v4/dev/ts/client/src/risk.ts

## What This Issue Actually Lands

- A bounded `mango` venue capability for `clob_order` and `perp_order`.
- A shared `RuntimeMarginAccountSnapshot` contract so account health, liquidation posture, positions, and oracle state are explicit harness artifacts.
- A paper or shadow-only Mango executor that fails closed unless the request includes explicit market and margin-account snapshots.

## Why The Bound Is Correct

Official Mango sources describe a cross-collateral venue with:

- cross-margin account state in `MangoAccount`,
- health computation in `HealthCache`,
- dedicated liquidation and price-impact tooling in `risk.ts`,
- separate spot-margin and perp orderbook paths,
- dedicated health service infrastructure in `bin/service-mango-health`.

Trader Ralph does not yet ship a production Mango indexer, signer flow, or live reconciliation stack. This issue therefore stops at `integrated` and prepares `shadow_ready` evidence without claiming live execution support.

## Highest Justified State

- `integrated`

Stop before:

- `shadow_ready`

## Evidence Added Here

- Runtime venue catalog entry for `mango`
- Runtime margin-account snapshot contract
- Mango shadow or paper executor tests for spot-margin and perp flows
- Submit-contract fixtures for Mango `clob_order` and `perp_order`

## Validation

```bash
bun test tests/unit/runtime_protocol_contracts.test.ts tests/unit/runtime_venue_catalog.test.ts tests/unit/runtime_research_promotion.test.ts tests/unit/worker_execution_mango.test.ts tests/unit/worker_execution_router.test.ts tests/unit/worker_exec_submit_contract_privy.test.ts tests/unit/execution_contract_v1_schemas.test.ts
bun run typecheck
bun run lint
```

## Operator Control

```bash
bun run src/bin/strategy_lab_promote.ts control \
  --request-file docs/strategy-lab/pilots/mango-v4-readiness/control.venue.request.json
```
