# ADR-0003: Runtime region topology

## Status

Accepted on 2026-03-07

## Context

The autonomous runtime is stateful and long-lived. It needs durable regional
placement for feeds, state, and execution coordination, but active/active
execution would create split-brain risk before leader election and distributed
locking are mature.

## Decision

Run runtime-rs in a single active Fly region with one warm standby region per
environment or shard. Do not permit active/active strategy execution in v1.

The initial default topology is:

- active region: `ord`
- warm standby region: `iad`

These defaults can change per environment if latency measurements or provider
placement justify it, but the single-writer topology does not change in v1.

## Rationale

- One writer keeps reservations, ledger state, and reconciliation sane.
- A warm standby gives a clear failover target without normalizing dual writes.
- The chosen defaults keep the first rollout simple and auditable.

## Consequences

- Failover must be explicit and operator-controlled at first.
- Runtime health, leader state, and database placement must all be visible in
  dashboards and rollback notes.
- Any future active/active work requires a separate ADR and explicit
  split-brain controls.
