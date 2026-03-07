# ADR-0002: Runtime storage ownership

## Status

Accepted on 2026-03-07

## Context

The Worker already owns public contracts and several Cloudflare-backed data
surfaces. The autonomous runtime needs its own low-latency, deterministic state
for deployments, runs, reservations, risk verdicts, and reconciliation.

The choice is whether to extend current Worker persistence for everything or
give runtime-rs its own canonical store.

## Decision

Use a runtime-owned, single-writer relational store as the canonical home for
automation state. Keep the Worker as the canonical owner of public execution
contracts and public read-serving surfaces.

## Rationale

- Strategy execution, reservations, and reconciliation need transactional,
  regional, low-latency state close to the runtime.
- The Worker must stay free to serve the public contract boundary without
  becoming the hot-path source of truth for automation internals.
- This split lets runtime-rs evolve deterministic automation state without
  breaking public route guarantees.

## Consequences

- Runtime-rs will need database bootstrap, migrations, backups, and failover
  planning as part of the Fly foundation work.
- Public terminal and admin read models may need projections or summaries from
  runtime state into current Worker-owned surfaces.
- Contract tests must prove that runtime and Worker views remain coherent.
