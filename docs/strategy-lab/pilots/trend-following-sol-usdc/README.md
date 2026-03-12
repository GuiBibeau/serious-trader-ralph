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
   artifact ids, then evaluate the review template:

```bash
bun run strategy-lab:promote \
  --request-file docs/strategy-lab/pilots/trend-following-sol-usdc/promotion.request.json
```

3. Apply the bounded limited-live promotion after explicit human approval:

```bash
bun run strategy-lab:promote \
  --request-file docs/strategy-lab/pilots/trend-following-sol-usdc/promotion.apply.request.json
```

4. Evaluate the live deployment after operator approval:

```bash
bun run runtime:deployment:evaluate \
  --deployment-id dep_trend_following_sol_usdc_limited_live \
  --body-file docs/strategy-lab/pilots/trend-following-sol-usdc/evaluate.body.json
```

5. Run the post-live monitor after the bounded live pilot is active:

```bash
bun run strategy-lab:post-live \
  --request-file docs/strategy-lab/pilots/trend-following-sol-usdc/post-live.request.json
```

## Notes

- `promotion.request.json` stays as the review template.
- `promotion.apply.request.json` is the checked-in bounded live promotion record
  tied to the merged implementation PR and owner approval for the pilot.
- The live deployment must stay on `lane=safe`, single-slice, and tiny-notional.
- The post-live review is the recurring drift, revalidation, and rollback input
  for the bounded live pilot.
- Pair this pilot with the JUP onboarding pilot so the repo demonstrates both a
  new strategy and a newly onboarded asset path.
