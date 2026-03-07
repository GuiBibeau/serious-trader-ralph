# Runtime Internal API Contract (Planned)

This document records the canonical payload families that later internal routes
must use. The routes themselves are introduced in `#259`; this file exists now
so Worker and runtime-rs do not invent separate shapes.

## Planned route families

| Route family | Canonical schema |
| --- | --- |
| `POST /api/internal/runtime/deployments` | `RuntimeDeploymentRecord` |
| `GET /api/internal/runtime/deployments/:id` | `RuntimeDeploymentRecord` |
| `GET /api/internal/runtime/runs/:deploymentId` | `RuntimeRunRecord` |
| `GET /api/internal/runtime/positions` | `RuntimeLedgerSnapshot` |
| `GET /api/internal/runtime/pnl` | `RuntimeLedgerSnapshot.totals` projection |
| execution coordination payloads | `RuntimeRiskVerdict`, `RuntimeExecutionPlan`, `RuntimeReconciliationResult` |

## Artifact locations

- Schema manifest: `docs/runtime-contracts/schema-manifest.v1.json`
- JSON Schemas: `docs/runtime-contracts/schemas/*.json`
- Example fixtures: `docs/runtime-contracts/fixtures/*.json`

## Notes

- Public x402 and execution routes remain unchanged.
- Internal transport starts as HTTP+JSON.
- Rust code generation is deferred to the runtime-rs workspace work, but it
  must consume the schema manifest above instead of redefining payloads.
