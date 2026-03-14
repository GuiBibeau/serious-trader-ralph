# Flash Liquidity Readiness

Reviewed on 2026-03-14 for issue `#379`.

## What This Issue Actually Lands

- A bounded `flash_liquidity` venue capability for `flash_atomic` intents.
- A provider abstraction for `marginfi` and `kamino` with global and per-provider disable controls.
- A synthetic composed-plan path that models flash borrow, reference action, and repay legs without widening live execution.
- Paper and shadow-only execution coverage, plus receipt summaries for flash borrow and repay semantics.

## Why The Bound Is Correct

This issue adds repo-owned harness substrate, not real-money flash execution.

- The provider model is explicit and fail-closed.
- Flash plans stay in `shadow` and `paper`.
- Live remains blocked until dedicated canaries, low-latency landing, and venue-specific reconciliation land in later issues.

## Highest Justified State

- `integrated`

Stop before:

- `shadow_ready`

## Evidence Added Here

- Runtime venue catalog entry for `flash_liquidity`
- Flash-liquidity provider controls for `marginfi` and `kamino`
- Synthetic flash-atomic plan builder
- Paper and shadow executor tests
- Receipt and submit-contract coverage for flash borrow and repay summaries

## Validation

```bash
bun test tests/unit/worker_flash_liquidity.test.ts tests/unit/worker_execution_flash_atomic.test.ts tests/unit/worker_execution_router.test.ts tests/unit/runtime_venue_catalog.test.ts tests/unit/worker_exec_submit_contract_privy.test.ts tests/unit/worker_execution_receipt_assembler.test.ts
bun run typecheck
bun run lint
```
