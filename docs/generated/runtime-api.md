# Runtime Internal API Contract

This document records the canonical payload families used by the private
runtime-to-Worker HTTP+JSON surface. The Worker remains the only public edge;
these routes are for repo-owned internal orchestration, research, and
evaluation flows.

## Route families

| Route family | Canonical schema |
| --- | --- |
| `GET /api/internal/runtime/health` | runtime health projection |
| `POST /api/internal/runtime/deployments` | `RuntimeDeploymentRecord` |
| `GET /api/internal/runtime/deployments` | `RuntimeDeploymentRecord[]` |
| `GET /api/internal/runtime/deployments/:id` | `RuntimeDeploymentRecord` |
| `POST /api/internal/runtime/deployments/:id/pause` | `RuntimeDeploymentRecord` state transition |
| `POST /api/internal/runtime/deployments/:id/resume` | `RuntimeDeploymentRecord` state transition |
| `POST /api/internal/runtime/deployments/:id/kill` | `RuntimeDeploymentRecord` state transition |
| `POST /api/internal/runtime/deployments/:id/evaluate` | `RuntimeRunRecord` |
| `GET /api/internal/runtime/runs/:deploymentId` | `RuntimeRunRecord[]` |
| `GET /api/internal/runtime/execution-plans` | `RuntimeExecutionPlan[]` |
| `GET /api/internal/runtime/reconciliations` | `RuntimeReconciliationResult[]` |
| `GET /api/internal/runtime/positions` | `RuntimeLedgerSnapshot` |
| `GET /api/internal/runtime/pnl` | `RuntimeLedgerSnapshot.totals` projection |
| `GET /api/internal/runtime/scorecards` | `RuntimePromotionReadinessReport` |
| `GET /api/internal/runtime/leaderboards` | `RuntimeStrategyLeaderboard` |
| `GET /api/internal/runtime/allocator` | `RuntimeAllocatorDecisionRecord`, `RuntimeAllocatorScorecard` |
| `GET /api/internal/runtime/research` | research registry projection |
| `POST /api/internal/runtime/research/hypotheses` | `RuntimeResearchHypothesisRecord` |
| `POST /api/internal/runtime/research/sources` | `RuntimeResearchSourceRecord` |
| `POST /api/internal/runtime/research/experiments` | `RuntimeResearchExperimentRecord` |
| `POST /api/internal/runtime/research/evidence-bundles` | `RuntimeResearchEvidenceBundleRecord` |
| `POST /api/internal/runtime/research/reproducibility-bundles` | `RuntimeResearchReproducibilityBundleRecord` |
| `POST /api/internal/runtime/research/reproducibility-bundles/rerun` | `RuntimeResearchReproducibilityBundleRecord` with updated verification |
| `GET /api/internal/runtime/assets` | `RuntimeAssetRecord[]` |
| `POST /api/internal/runtime/assets` | `RuntimeAssetRecord` |
| `POST /api/internal/runtime/assets/:assetKey/transition` | `RuntimeAssetRecord` state transition |
| `GET /api/internal/runtime/datasets` | dataset registry projection |
| `POST /api/internal/runtime/datasets/snapshots` | `RuntimeHistoricalDatasetSnapshotRecord` |
| `POST /api/internal/runtime/datasets/replay-corpora` | `RuntimeReplayCorpusRecord` |
| `GET /api/internal/runtime/backtests` | `RuntimeBacktestReport[]` |
| `POST /api/internal/runtime/backtests` | `RuntimeBacktestReport` plus linked reproducibility bundle |
| `GET /api/internal/runtime/features` | feature catalog projection |
| `POST /api/internal/runtime/features/definitions` | `RuntimeFeatureDefinitionRecord` |
| `POST /api/internal/runtime/features/regime-tags` | `RuntimeRegimeTagRecord` |
| `GET /api/internal/runtime/cost-models` | `RuntimeExecutionCostModelRecord[]` |
| `POST /api/internal/runtime/cost-models` | `RuntimeExecutionCostModelRecord` |
| `POST /api/internal/runtime/cost-model-observations` | cost observation registry projection |

## Artifact locations

- Schema manifest: `docs/runtime-contracts/schema-manifest.v1.json`
- JSON Schemas: `docs/runtime-contracts/schemas/*.json`
- Example fixtures: `docs/runtime-contracts/fixtures/*.json`

## Notes

- Public x402 and execution routes remain unchanged.
- Internal transport starts as HTTP+JSON.
- Backtest runs auto-persist a reproducibility bundle tied to the exact code
  revision, dataset snapshots, and expected result used to build the report.
- Paper and live promotion evidence must include both a `backtest-report`
  artifact and a matching `reproducibility-bundle` artifact.
