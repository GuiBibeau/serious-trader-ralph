# PRD: Trader Ralph Autonomous Runtime

**Status:** Accepted for repo planning  
**Date:** 2026-03-07  
**Audience:** product, engineering, infra, ops, and harness execution

## Summary

Trader Ralph already has:

- a public Cloudflare Worker boundary for x402, execution, discovery, and
  admin-controlled operations,
- a production terminal and execution UX,
- a harness-native repo workflow for issue-driven delivery.

What it does not yet have is an always-on automation runtime that can keep
market connectivity open, evaluate strategies continuously, manage portfolio
state deterministically, and reconcile live execution results.

The v1 autonomous runtime keeps the current harness architecture intact:

- the Worker stays the only public API boundary,
- Bun and the current repo tooling stay the control plane,
- a new Rust service on Fly (`runtime-rs`) becomes the private hot path.

## Problem

Trader Ralph can execute trades and expose intelligence, but it cannot yet run
production automation with:

- persistent feed connectivity,
- deterministic deployment and run lifecycles,
- portfolio ledger and reservation accounting,
- portfolio-level risk checks,
- shadow, paper, and live promotion gates,
- reconciliation and operator controls,
- repo-owned docs that let the harness build the system safely.

## Goals

### Primary goals

- Support always-on automation with persistent WebSocket and RPC connectivity.
- Preserve the Worker as the public API boundary.
- Preserve the current public execution contract:
  - `POST /api/x402/exec/submit`
  - `GET /api/x402/exec/status/:requestId`
  - `GET /api/x402/exec/receipt/:requestId`
- Reuse the current harness workflow, proof bundle rules, preview path, and
  canary posture.
- Make strategy decisions, risk verdicts, and reconciliation outcomes
  explainable and reproducible.

### Non-goals for v1

- high-frequency or microsecond trading,
- arbitrary user-authored strategy code,
- cross-chain automation,
- replacing the current Worker or terminal stack,
- changing public x402 or execution contracts without an explicit versioned
  follow-up issue.

## Product principles

- Public edge stays stable: the Worker remains the public contract boundary.
- Hot path stays stateful: the live strategy loop runs in a long-lived service,
  not on the edge.
- Harness legibility is part of the product: docs, proof bundles, and rollout
  gates are first-class.
- One protocol, multiple transports: terminal, x402, and automation share the
  same domain concepts even when auth and transport differ.
- Rollback must be faster than rollout: runtime controls must stop unsafe
  behavior before code rollback is required.

## Architecture summary

### Cloudflare Worker

Owns:

- public APIs,
- x402 gating,
- discovery and registry surfaces,
- authenticated first-party APIs,
- public execution contract,
- internal runtime control endpoints,
- public read models derived from execution and automation state.

### Bun and the harness

Own:

- `harness:up`, `harness:status`, `harness:proof`,
- runner workflows and issue orchestration,
- docs, validation commands, and proof bundles,
- local orchestration for portal, Worker, and optional runtime-rs integration.

### Rust runtime on Fly

Owns:

- persistent feeds,
- feature calculation,
- strategy deployment lifecycle,
- portfolio ledger and reservations,
- risk checks,
- execution planning,
- reconciliation,
- runtime-local health and metrics.

## Resolved v1 decisions

The first four architecture decisions are fixed by ADRs in this repo:

- Internal transport starts as service-authenticated HTTP+JSON.
- Canonical automation state lives in a runtime-owned, single-writer relational
  store close to the active runtime region.
- Runtime topology is one active region plus one warm standby per
  environment/shard, with no active/active execution in v1.
- Capital is isolated by logical wallet sleeves per deployment with explicit
  reservations; cross-strategy netting is deferred.

See:

- `docs/design-docs/adrs/ADR-0001-runtime-internal-transport.md`
- `docs/design-docs/adrs/ADR-0002-runtime-storage-ownership.md`
- `docs/design-docs/adrs/ADR-0003-runtime-region-topology.md`
- `docs/design-docs/adrs/ADR-0004-runtime-wallet-sleeves.md`

## Scope

### In scope for v1

- Rust runtime service on Fly.
- Persistent market data and provider connectivity.
- Strategy templates:
  - DCA
  - threshold rebalance
  - TWAP entry and exit
  - trend following
  - mean reversion
- Portfolio ledger, reservations, and attribution.
- Pre-trade and portfolio risk engine.
- Execution planning and reconciliation.
- Shadow and paper modes before limited live rollout.
- Operator controls, dashboards, and kill switches.

### In scope for later phases

- breakout and macro rotation,
- volatility-target sizing,
- multi-strategy capital allocation,
- more advanced perps-native automation.

## Rollout shape

The rollout stays issue-driven and reversible:

| Phase | Backlog issues | Exit gate |
| --- | --- | --- |
| Phase 0 | `#256`, `#257` | Docs merged, protocol direction fixed, no public route change |
| Phase 1 | `#258` to `#261` | Rust skeleton builds, internal auth exists, harness stays compatible, Fly health path exists |
| Phase 2 | `#262` to `#264` | Feeds and shadow triggers are deterministic and stale-data rules work |
| Phase 3 | `#265` to `#267` | Ledger, reservations, risk, and paper trading are stable |
| Phase 4 | `#268` to `#271` | Reconciliation works and one limited live canary is green |
| Phase 5 | `#272` to `#274` | Operator surfaces and managed templates are stable |
| Phase 6 | `#275`, `#276` | Advanced templates and capital coordination are stable |

Detailed rollout steps live in
`docs/exec-plans/active/autonomous-runtime-rollout.md`.

## Success metrics

### Product metrics

- live deployment count,
- automation notional executed,
- weekly active automation users,
- promotion rate from shadow to live.

### Runtime metrics

- trigger-to-submit p95,
- duplicate-submit rate,
- stale-feature reject rate,
- reconciliation error rate,
- runtime canary pass rate.

### Harness metrics

- issue-to-PR cycle time,
- proof bundle completion rate,
- rollback drill success rate,
- documentation freshness for runtime surfaces.

## Risks and mitigations

- Split-brain across regions:
  Use one active region plus one warm standby and require explicit leader
  control before any failover.
- Contract drift between Worker and runtime:
  Keep one repo-owned protocol package and shared fixtures.
- Ops complexity grows too early:
  Ship one service, one active region, one limited live template, and one
  rollback path first.
- Harness drift:
  Keep the current issue labeling, preview path, and proof bundle rules as the
  only supported delivery flow.

## Deferred questions

The critical v1 decisions are no longer open. Remaining follow-ups are future
phase questions, such as:

- when perps-native automation graduates from later phases into the core plan,
- whether to surface hosted user controls before or after the first template
  pack is stable,
- how much existing Bun autopilot logic should be wrapped versus retired once
  runtime-rs owns the hot path.
