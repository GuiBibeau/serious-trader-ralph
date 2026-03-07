# ADR-0004: Runtime wallet sleeves and netting

## Status

Accepted on 2026-03-07

## Context

Trader Ralph already operates with a one-wallet-per-user model. The autonomous
runtime still needs deterministic capital attribution so one deployment cannot
silently consume another deployment's budget.

The open design choice is whether v1 should net capital across strategies or
isolate capital by deployment.

## Decision

Use logical wallet sleeves with explicit reservations per deployment. Do not
allow cross-strategy netting in v1.

One physical wallet may back several sleeves, but each sleeve has its own:

- capital ceiling,
- reservation ledger,
- risk budget,
- reconciliation record.

## Rationale

- It preserves the current wallet model while keeping automation accounting
  deterministic.
- It is easier to reason about during shadow, paper, and first live canary
  rollouts.
- It reduces the blast radius of one bad deployment or reconciliation failure.

## Consequences

- The ledger and risk engine must understand logical sleeves even when on-chain
  balances sit in one physical wallet.
- Reconciliation must map chain balances back to sleeve attribution.
- Shared-wallet netting can be considered later only after sleeve accounting
  and risk proofs are stable.
