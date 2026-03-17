# Runtime Contract Surface

This directory holds the canonical internal contract artifacts for the
autonomous runtime and strategy-lab research program.

## Source of truth

- TypeScript schemas and transition helpers:
  `src/runtime/contracts/autonomous_runtime.ts`
- Worker consumption path:
  `apps/worker/src/runtime_contracts.ts`

## Generated artifacts

- JSON Schemas: `docs/runtime-contracts/schemas/*.json`
- Schema manifest: `docs/runtime-contracts/schema-manifest.v1.json`
- Example fixtures: `docs/runtime-contracts/fixtures/*.json`

The runtime contract set now also includes:

- research lifecycle records for hypotheses, sources, experiments, and
  evidence bundles,
- the versioned `RuntimeStrategySpec` artifact used to describe strategy
  parameters, feature requirements, venue support, asset constraints, and
  promotion policy,
- strategy-desk scenario manifests, scenario runs, scenario reports, and
  promotion handoffs for harness-native composite testing,
- backward-compatible fixtures proving the Worker and Rust runtime can parse
  the same strategy ABI.

Strategy-desk objects are intentionally distinct from runtime deployments:

- a strategy-desk scenario can describe multiple legs across spot, perps,
  prediction, and flash paths,
- a runtime deployment remains a bounded single-venue, single-pair execution
  object,
- promotion handoffs map desk scenarios into one or more runtime deployments or
  Worker-side execution recipes without widening public API posture.

Generate or refresh the schemas with:

```bash
bun run contracts:runtime:schemas
```

## Rust integration

- `crates/protocol` mirrors these schemas directly for the runtime hot path.
- `crates/strategy-core` consumes the shared `RuntimeStrategySpec` contract for
  the built-in strategy catalog.
- `services/runtime-rs` and `apps/worker` both consume the same checked-in
  schema set; no private runtime route should ship before those surfaces agree
  on these artifacts.
