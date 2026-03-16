# Drift Funding Carry Pilot

This pilot turns the lowest-lift perp research fit into a repo-owned strategy-lab
draft without pretending the runtime can already execute it end to end.

## Goal

- Strategy: `funding_carry`
- Venue: `drift`
- Instrument: `SOL-PERP`
- Target state after this slice: `draft`

## Source basis

- Paper: *AutoQuant: An Auditable Expert-System Framework for Execution-Constrained Auto-Tuning in Cryptocurrency Perpetual Futures*
- Source URL: [arXiv 2512.22476v1](https://arxiv.org/abs/2512.22476v1)
- Author: Kaihong Deng
- Published: 2025-12-27

## Why this is the best current fit

- Ralph already exposes perp funding and open-interest surfaces at the Worker
  boundary.
- Drift is the only perp venue in Ralph that has real bounded venue-proof
  evidence, even though the runtime venue catalog still keeps it bounded to
  `shadow` and `paper`.
- The paper itself is better interpreted as a validation and governance overlay
  than as a standalone alpha claim, which matches Ralph's current stage.

## Harness sequence

1. Build the research brief from the cited paper:

```bash
bun run strategy-lab:research \
  --request-file docs/strategy-lab/pilots/drift-funding-carry/research.request.json \
  --output-dir .tmp/strategy-lab/drift-funding-carry/research
```

2. Synthesize the brief into the built-in `funding_carry` template:

```bash
bun run strategy-lab:synthesis \
  --brief-file .tmp/strategy-lab/drift-funding-carry/research/brief.json \
  --strategy-key funding_carry \
  --preferred-venue drift \
  --market-type perp \
  --title "Drift funding carry overlay"
```

3. Curate the checked-in source and hypothesis records:

```bash
bun run strategy-lab:curate \
  --request-file docs/strategy-lab/pilots/drift-funding-carry/curation.request.json
```

## What this slice proves

- the candidate has exact source provenance and publication date
- the candidate has a checked-in draft `StrategySpec`
- the feature-catalog path no longer assumes every strategy deployment is spot
- perp pair symbols like `SOL-PERP` can now resolve catalog asset matching
- the feature cache emits `funding_rate_bps`, `basis_bps`, and
  `open_interest_delta_bps` from a mixed spot plus perp replay
- the backtesting engine can evaluate `funding_carry` on a mixed Drift plus
  spot replay without polluting the observation stream with spot events

## What is still blocked before shadow or paper testing

- the runtime execution-plan contract is still swap-shaped, so a perp strategy
  cannot yet progress through the same runtime execution path as spot
- `execution-planner` still enforces spot-only venue capability checks for the
  production runtime plan builder
- `services/runtime-rs` paper execution is still spot-swap shaped, so there is
  no honest repo-owned paper lifecycle for Drift perps yet
- the replay fixture and cost model used here are synthetic test fixtures, not
  a checked-in Drift research corpus with operator-reviewed assumptions

## Honest promotion verdict

- Highest justified state after this slice: `draft`
- Stronger than before: reproducible feature and backtest evidence now exists
- Not justified yet: `shadow`, `paper`, or any money-state promotion
