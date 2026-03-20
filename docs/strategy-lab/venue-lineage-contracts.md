# Venue Lineage Contracts

This note defines the VP1 compatibility contract for venue lineage across Loop
A, Loop B, and Loop C.

## Goals

- Keep pair-level artifacts stable for existing readers.
- Add structured venue provenance so downstream consumers stop inferring source
  venues from evidence-ref strings.
- Preserve a clear substrate for later venue-parity work without widening any
  live execution path.

## Contract Shape

- Loop A marks keep their existing pair-level identity and `venue` field.
- Loop A marks now optionally carry `lineage`, which records `protocol`,
  `venue`, `marketType`, and an optional `pool`.
- Loop B feature and score rows remain pair-level rows keyed by the same
  `pairId`, `baseMint`, and `quoteMint`.
- Loop B now carries additive provenance fields:
  - `sourceProtocols`
  - `sourceVenues`
  - `venueLineage`
- Loop C candidate and recommendation rows remain pair-level outputs.
- Loop C now carries the same additive provenance fields so fallback reads from
  Loop B stay structured.

## Coexistence Rule

Pair identity stays pair-scoped in VP1. `venueLineage` is provenance attached
to a pair row, not a new row key.

That means:

- readers that only care about pair ranking can keep reading the existing
  pair-level row identity;
- readers that need venue-aware provenance must read `sourceVenues` and
  `venueLineage` instead of reconstructing venue origin from evidence refs;
- VP2 through VP7 can add venue-native ingestion and ranking behavior without
  breaking the existing pair-level view.

## Compatibility Strategy

- No storage keys change in VP1.
- The new provenance fields are additive.
- Loop A `lineage` is optional so pre-VP1 marks remain parseable.
- Loop B and Loop C parsers default missing provenance fields to empty arrays.
- Existing KV and R2 readers that ignore unknown JSON properties remain
  compatible without migration.
- Existing readers that want venue-aware behavior must opt in to the new
  fields; they must not keep using evidence-ref substring scans once structured
  provenance is available.

## Reader Guidance

- Treat `sourceProtocols` and `sourceVenues` as convenience summaries.
- Treat `venueLineage` as the authoritative structured provenance slice for a
  pair row.
- Do not assume a pair row maps to only one venue.
- Do not create venue-specific ranking behavior in VP1 by rewriting pair keys;
  that belongs to later venue-parity phases built on this substrate.
