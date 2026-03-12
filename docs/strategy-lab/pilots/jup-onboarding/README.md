# JUP Onboarding Pilot

This pilot proves a newly onboarded asset can move through readiness and
bounded-live validation without widening the public Worker contract.

## Goal

- Asset: `JUP`
- Venue: `jupiter`
- Pair: `JUP/USDC`
- Target state: `limited_live_ready`

## Harness sequence

1. Curate the JUP substrate:

```bash
bun run strategy-lab:curate \
  --request-file docs/strategy-lab/pilots/jup-onboarding/curation.request.json
```

2. Apply the subject controls:

```bash
bun run strategy-lab:readiness \
  --operation control \
  --request-file docs/strategy-lab/pilots/jup-onboarding/control.venue.request.json

bun run strategy-lab:readiness \
  --operation control \
  --request-file docs/strategy-lab/pilots/jup-onboarding/control.request.json
```

3. Evaluate readiness:

```bash
bun run strategy-lab:readiness \
  --operation readiness \
  --request-file docs/strategy-lab/pilots/jup-onboarding/readiness.request.json
```

4. Run the bounded onboarding canary:

```bash
bun run strategy-lab:readiness \
  --operation canary \
  --request-file docs/strategy-lab/pilots/jup-onboarding/canary.request.json
```

5. Run the post-live monitors for the onboarded asset and the bounded venue
   surface:

```bash
bun run strategy-lab:post-live \
  --request-file docs/strategy-lab/pilots/jup-onboarding/post-live.asset.request.json

bun run strategy-lab:post-live \
  --request-file docs/strategy-lab/pilots/jup-onboarding/post-live.venue.request.json
```

## Notes

- The curation request seeds deterministic JUP/USDC replay metadata backed by
  checked-in fixture files.
- Keep the canary on the default `$5` notional until the first live soak is
  complete.
- Use the post-live monitors to drive recurring asset and venue revalidation
  without widening the public Worker contract.
- Pair this pilot with the trend-following SOL/USDC strategy pilot so the repo
  demonstrates both new-strategy and new-asset promotion paths.
