# Runtime Contract Surface

This directory holds the canonical internal contract artifacts for the
autonomous runtime program.

## Source of truth

- TypeScript schemas and transition helpers:
  `src/runtime/contracts/autonomous_runtime.ts`
- Worker consumption path:
  `apps/worker/src/runtime_contracts.ts`

## Generated artifacts

- JSON Schemas: `docs/runtime-contracts/schemas/*.json`
- Schema manifest: `docs/runtime-contracts/schema-manifest.v1.json`
- Example fixtures: `docs/runtime-contracts/fixtures/*.json`

Generate or refresh the schemas with:

```bash
bun run contracts:runtime:schemas
```

## Intended Rust integration

Runtime-rs does not exist in the repo yet. The agreed hook for later issues is:

- `crates/protocol` or `services/runtime-rs` should consume the JSON Schemas and
  manifest from this directory,
- any Rust-side structs or serde codegen must derive from the same checked-in
  schema set,
- no private runtime route should ship before the Worker and runtime agree on
  these artifacts.
