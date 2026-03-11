# Historical Data Lake

## Purpose

The strategy-lab pipeline needs stable, replayable historical datasets that can
be referenced from research experiments, backtests, paper simulations, and
promotion proof bundles. This document defines the runtime-owned historical data
lake substrate introduced in phase 1.

## Record Model

- `RuntimeHistoricalDatasetSnapshotRecord`
  - stable identity: `datasetId + snapshotId`
  - immutable coverage window, normalization mode, storage format, retention
    class, provenance, venue coverage, and asset coverage
- `RuntimeReplayCorpusRecord`
  - stable identity: `corpusId`
  - references one or more dataset snapshots
  - captures the deterministic replay adapter kind and seed used for evaluation

The Cloudflare Worker remains the only public API boundary. Dataset and replay
registry routes are internal-only and are consumed through the existing runtime
bridge.

## Seed Corpus

The initial seed records reference the checked-in deterministic replay fixture:

- `services/runtime-rs/fixtures/runtime-feed-replay.sol_usdc.v1.json`
- dataset snapshots:
  - `dataset_feed_replay_sol_usdc_market_events`
  - `dataset_feed_replay_sol_usdc_slot_events`
- replay corpus:
  - `replay_corpus_sol_usdc_feed_gateway_seed`

This gives later issues a stable dataset anchor immediately, rather than relying
on ad hoc local file paths.

## Retention Rules

- `seed`
  - checked-in deterministic fixtures and bootstrapping corpora
  - never compact away without replacing them with a compatible canonical seed
- `research`
  - experiment and backtest datasets that support active candidate evaluation
  - may be compacted after reproducibility bundles preserve the exact snapshot
    identifiers and content digests
- `production`
  - datasets referenced by promotion evidence, paper validation, or limited-live
    rollout decisions
  - retain through the full promotion lifecycle plus rollback window

## Compaction Rules

- Preserve the original `datasetId + snapshotId` record even when underlying
  files are compacted or migrated.
- Compaction may change the storage object and compression method, but it must
  not change:
  - coverage window
  - normalization mode
  - content digest recorded for the version under evaluation
- If a compacted artifact is materially different, emit a new `snapshotId`
  instead of mutating the old one.

## Sampling Rules

- Research sampling must be explicit in `samplingNotes`.
- Replay-ready corpora must declare whether they are complete or sampled.
- Walk-forward and paper-validation phases must reference exact snapshot IDs in
  scorecards and proof bundles.
- Cross-venue comparisons must not mix datasets with incompatible normalization
  without recording that in provenance or notes.

## Future Compatibility

The data lake is intentionally instrument-agnostic:

- dataset kinds already reserve room for:
  - trades
  - bars
  - order book L2
  - funding rates
  - borrow rates
  - reference metadata
- this keeps the substrate compatible with future extensions such as perps,
  borrow-aware strategies, and venue expansion without widening the public
  Worker contract
