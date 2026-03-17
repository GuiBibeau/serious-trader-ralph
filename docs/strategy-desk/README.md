# Strategy Desk

This folder contains the operator-facing documentation for the harness-native
strategy desk.

Use it when you need to:

- author or update a composite scenario
- capture replay, backtest, shadow, and paper evidence
- prepare or arm a bounded execution handoff
- run canary or rollback drills against the desk surface
- assemble a proof bundle for review or future issue runners

Primary docs:

- ops runbook:
  `docs/reliability/strategy-desk-ops-runbook.md`
- proof bundle spec:
  `docs/strategy-desk/proof-bundles.md`
- canary drill:
  `docs/strategy-desk/drills/desk-sol-composite.canary-drill.md`
- rollback drill:
  `docs/strategy-desk/drills/desk-sol-composite.rollback-drill.md`
- request templates:
  `docs/strategy-desk/request-templates/desk-sol-composite/`

The strategy desk extends the current strategy-lab and autonomous-runtime
surfaces. It does not replace their policy boundaries.
