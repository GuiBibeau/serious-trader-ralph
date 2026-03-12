# Trend Following SOL/USDC Pilot

This pilot carries one newly researched strategy through the bounded production
path without widening the public Worker surface.

## Goal

- Strategy: `trend_following`
- Venue: `jupiter`
- Pair: `SOL/USDC`
- Target state: bounded `limited_live`

## Harness sequence

1. Curate the research and evaluation substrate:

```bash
bun run strategy-lab:curate \
  --request-file docs/strategy-lab/pilots/trend-following-sol-usdc/curation.request.json
```

2. Build or refresh the policy gate and promotion request with the current
   artifact ids, then evaluate the promotion:

```bash
bun run strategy-lab:promote \
  --request-file docs/strategy-lab/pilots/trend-following-sol-usdc/promotion.request.json
```

3. Evaluate the live deployment after operator approval:

```bash
bun run runtime:deployment:evaluate \
  --deployment-id dep_trend_following_sol_usdc_limited_live \
  --body-file docs/strategy-lab/pilots/trend-following-sol-usdc/evaluate.body.json
```

## Notes

- The checked-in promotion request is a review template. Replace placeholder
  issue or PR references and approval metadata before applying it to production.
- The live deployment must stay on `lane=safe`, single-slice, and tiny-notional.
- Pair this pilot with the JUP onboarding pilot so the repo demonstrates both a
  new strategy and a newly onboarded asset path.
