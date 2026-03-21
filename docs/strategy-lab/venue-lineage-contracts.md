# Venue Lineage Contracts

This note defines the lineage compatibility contract introduced in VP1 and
extended through VP4 across Loop A, Loop B, and Loop C.

## Goals

- Keep pair-level artifacts stable for existing readers.
- Add structured venue provenance so downstream consumers stop inferring source
  venues from evidence-ref strings.
- Preserve a clear substrate for later venue-parity work without widening any
  live execution path.

## Contract Shape

- Loop A marks keep their existing pair-level identity and `venue` field.
- Loop A marks now optionally carry `lineage`, which records `protocol`,
  `venue`, `marketType`, and optional `pool`, `market`, `positionAccount`, or
  `settlementMint` identifiers.
- Loop B pair-level feature and score rows remain keyed by the same `pairId`,
  `baseMint`, and `quoteMint`.
- Loop B pair-level rows carry additive provenance fields:
  - `sourceProtocols`
  - `sourceVenues`
  - `venueLineage`
- Loop B also publishes venue-native feature and score rows keyed by
  `pairId`, `marketType`, `protocol`, and `venue`.
- Loop B also publishes a pair-and-venue parity view with explicit
  availability or unavailability reasons per venue.
- Loop C candidate and recommendation rows remain pair-level outputs.
- Loop C now carries the same additive provenance fields so fallback reads from
  Loop B stay structured.

## Coexistence Rule

Pair identity stays pair-scoped for existing readers. `venueLineage` remains
provenance attached to a pair row, while VP4 adds separate venue-native Loop B
artifacts for readers that need venue-specific scoring and availability.

That means:

- readers that only care about pair ranking can keep reading the existing
  pair-level row identity;
- readers that need venue-aware provenance must read `sourceVenues` and
  `venueLineage` instead of reconstructing venue origin from evidence refs;
- readers that need venue-native Loop B artifacts should read the VP4
  venue-level keys and parity view instead of overloading pair rows;
- VP2 through VP7 can add venue-native ingestion and ranking behavior without
  breaking the existing pair-level view.

## Compatibility Strategy

- No existing pair-level storage keys change.
- New provenance fields and venue-level artifacts are additive.
- Loop A `lineage` is optional so pre-VP1 marks remain parseable.
- Loop B and Loop C parsers default missing provenance fields to empty arrays.
- Existing KV and R2 readers that ignore unknown JSON properties remain
  compatible without migration.
- Existing readers that want venue-aware behavior must opt in to the new
  fields and new venue-level artifacts; they must not keep using evidence-ref
  substring scans once structured provenance is available.

## Reader Guidance

- Treat `sourceProtocols` and `sourceVenues` as convenience summaries.
- Treat `venueLineage` as the authoritative structured provenance slice for a
  pair row, including pool, market, position-account, and settlement lineage
  when they are available.
- Do not assume a pair row maps to only one venue.
- Treat Loop B venue-level rows as the authoritative venue-native score and
  feature surface once VP4 artifacts are available.
- Treat the Loop B parity view as the authoritative source for expected but
  absent venues in a finalized minute.
