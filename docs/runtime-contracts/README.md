# Runtime Contract Surface

This directory holds the checked-in JSON schema and fixture set for the shared
TypeScript contracts still consumed by the Worker.

## Source Of Truth

- TypeScript schemas and transition helpers:
  `src/runtime/contracts/autonomous_runtime.ts`
- Worker consumption path:
  `apps/worker/src/runtime_contracts.ts`

## Generated Artifacts

- JSON Schemas: `docs/runtime-contracts/schemas/*.json`
- Schema manifest: `docs/runtime-contracts/schema-manifest.v1.json`
- Example fixtures: `docs/runtime-contracts/fixtures/*.json`

Refresh the schemas with:

```bash
bun run contracts:runtime:schemas
```

## Cleanup Note

The standalone Rust runtime and proof UI have been removed. These contracts
remain only because the current Worker routes and unit tests still share them.
Future terminal-focused cleanup should migrate the Worker onto smaller
execution and market-data contracts, then delete this legacy shared surface.
