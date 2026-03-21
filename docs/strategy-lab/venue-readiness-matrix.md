# Multi-Venue Readiness Matrix

This matrix is the shared readiness reference for the multi-venue harness
program tracked by `#381`, `#386`, and `#380`.

It exists to keep venue onboarding, terminal rollout, and later real-TX smoke
proofs on one explicit path instead of scattering readiness assumptions across
issue bodies and PR notes.

The Loop A/B/C provenance substrate for this program is defined in
`docs/strategy-lab/venue-lineage-contracts.md`.
Loop A spot-family venue parity status for VP2 is recorded in
`docs/strategy-lab/loop-a-spot-venue-parity.md`.
Loop A perp and prediction venue parity status for VP3 is recorded in
`docs/strategy-lab/loop-a-perp-prediction-venue-parity.md`.

## How To Use It

- Treat venue readiness as separate from strategy readiness.
- Use the request templates in
  `docs/strategy-lab/request-templates/venue-readiness`
  for manual readiness, canary, smoke, and control operations.
- A venue is not meaningfully ready for `limited_live_ready` unless the matrix
  names both an evidence target and an isolated disable drill.
- Real-TX landing proof without a full strategy runtime is tracked separately in
  `#410` through `#421`.

## Shared Smoke Workflow

Use the shared operator-invoked smoke harness for venue landing proofs:

```bash
bun run strategy-lab:readiness \
  --operation smoke \
  --request-file docs/strategy-lab/request-templates/venue-readiness/venue.smoke.request.json
```

The smoke request is distinct from the readiness canary request because it
records venue-TX landing proof intent and can automatically tighten the single
venue path on failure.

## Execution Order

The remaining harness queue for this program is:

1. `#389` perps terminal workflows
2. `#380` shared matrix, templates, and operator visibility
3. `#392` deferred Phoenix terminal workflows
4. `#411` shared venue live-smoke harness
5. venue live-smoke proofs `#412`, `#413`, `#414`, `#415`, `#417`, `#418`, `#420`, `#421`
6. deferred venue proofs `#416` and `#419` once their blocked dependencies are cleared

## Matrix

| Subject | Family | Current | Target | Evidence target | Issues |
| --- | --- | --- | --- | --- | --- |
| Jupiter | spot | `broad_live_ready` | `broad_live_ready` | Real spot swap receipt plus Trigger fill-or-cancel reconciliation | `#366`, `#388`, `#412` |
| Raydium | spot | `paper_ready` | `limited_live_ready` | Venue-native live swap proof, not aggregator fallback | `#370`, `#388`, `#413` |
| Orca Whirlpools | spot | `paper_ready` | `limited_live_ready` | Pool-specific live swap proof with route and reconciliation | `#371`, `#388`, `#414` |
| OpenBook v2 | clob | `integrated` | `limited_live_ready` | Real order placement plus bounded lifecycle and reconciliation | `#369`, `#388`, `#415` |
| Phoenix | clob | `candidate` | `limited_live_ready` | Seat-aware live order proof after deferred terminal support resumes | `#368`, `#392`, `#416` |
| Drift | perp | `integrated` | `limited_live_ready` | Real position open plus bounded reduce-or-close with margin evidence | `#372`, `#389`, `#417` |
| Mango v4 | perp | `integrated` | `limited_live_ready` | Real account-state mutation with bounded residual exposure | `#374`, `#389`, `#418` |
| Jupiter Perps | perp | `integrated` | `paper_ready` | Position-account replay and paper reconciliation coverage | `#373`, `#389` |
| Raydium Perps / Orderly | perp | `candidate` | `integrated` | External auth and dependency behavior documented well enough to integrate safely | `#375`, `#389`, `#419` |
| DFlow | prediction | `integrated` | `limited_live_ready` | Real outcome-token purchase with resulting position and settlement posture | `#376`, `#390`, `#420` |
| Drift BET | prediction | `candidate` | `integrated` | Cross-margin prediction contract model and controls specified for implementation | `#378`, `#390` |
| Monaco | prediction | `candidate` | `integrated` | SDK contract and settlement behavior documented for bounded paper use | `#377`, `#390` |
| Flash Liquidity | flash | `integrated` | `limited_live_ready` | Atomic borrow-and-repay proof without a profit-seeking strategy | `#379`, `#421` |

## Disable Drills

- Jupiter: disable live subject control and engage kill switch without affecting Raydium or Orca.
- Raydium and Orca: disable each venue independently while Jupiter stays available.
- OpenBook and Phoenix: disable one CLOB venue without affecting the other or routed spot flows.
- Drift and Mango: disable one perp venue without affecting spot or prediction venues.
- DFlow, Drift BET, and Monaco: isolate prediction-market controls from perps.
- Flash liquidity: disable flash rails without touching spot, perp, or prediction execution controls.

## Notes

- Candidate-state venues stay blocked from live-smoke issues even when the
  smoke issue exists as a placeholder.
- `#410` and its child issues are evidence-producing issues, not automatic
  readiness promotions.
- Merging an implementation PR still does not authorize real-money promotion by
  itself.
