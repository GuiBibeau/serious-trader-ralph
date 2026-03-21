# Loop B Venue Parity Artifacts

This note records the VP4 outcome for Loop B venue parity.

It sits on top of the VP1 lineage contract in
`docs/strategy-lab/venue-lineage-contracts.md`, the VP2 spot parity note in
`docs/strategy-lab/loop-a-spot-venue-parity.md`, and the VP3 perp and
prediction parity note in
`docs/strategy-lab/loop-a-perp-prediction-venue-parity.md`.

## Outcome

- Loop B keeps the existing pair-level feature and score rows for legacy
  readers.
- Loop B now also publishes venue-native feature rows and score rows keyed by
  `pairId`, `marketType`, `protocol`, and `venue`.
- Loop B now publishes a pair-and-venue parity view that marks each venue as
  either `available` or `unavailable` for the finalized minute.
- Unavailable venues now carry structured reasons such as
  `no_mark_for_pair_in_minute` or `blocked_in_loop_a` instead of disappearing
  silently.

## Artifact Surface

| Artifact | Key | Purpose |
| --- | --- | --- |
| Pair features | `loopB:v1:features:latest` | Existing pair-level minute features for compatibility readers. |
| Pair scores | `loopB:v1:scores:latest` | Existing pair-level minute scores for compatibility readers and Loop C fallback. |
| Venue features | `loopB:v1:features:by_venue:latest` | Venue-native minute features for each observed pair-plus-venue row. |
| Venue scores | `loopB:v1:scores:by_venue:latest` | Venue-native minute scores derived from venue feature rows. |
| Pair/venue parity view | `loopB:v1:views:pair_venue_parity:latest` | Operator-facing availability view that names present and absent venues per pair. |

Loop B also writes row-level compatibility keys for each published venue row:

- `loopB:v1:features:by_venue:latest:row:<venueRowId>`
- `loopB:v1:scores:by_venue:latest:row:<venueRowId>`

## Determinism Rules

- Venue rows sort by `pairId`, then `marketType`, then `venue`, then
  `protocol`.
- Venue score rows sort by descending `finalScore`, then `pairId`, then
  `venue`, then `protocol`.
- Parity rows sort by `pairId`.
- Within a parity row, available venues sort ahead of unavailable venues, then
  by `marketType`, `venue`, and `protocol`.

These rules keep R2 snapshots stable across replays and late minute
corrections.

## Availability Semantics

- `observed_marks` means the finalized minute produced venue-native Loop B
  features from Loop A marks.
- `no_mark_for_pair_in_minute` means the venue exists in the runtime venue
  catalog for the pair's market type, but Loop B did not receive a mark for
  that pair and venue in the finalized minute.
- `blocked_in_loop_a` means Loop A parity status says the venue remains
  fail-closed, and the parity row should expose the checked-in summary and
  optional artifact reference instead of pretending the venue is simply quiet.

## Reader Guidance

- Existing pair-level readers can stay on the pair keys without migration.
- New venue-aware readers should use the venue keys when they need
  venue-specific scoring, and the parity view when they need to distinguish
  "present" from "absent but expected".
- VP5 should consume the venue-level rows and parity view directly instead of
  collapsing back to pair-only inputs before recommendation ranking.
