import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseRuntimeAssetRecord,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  parseRuntimeStrategySpec,
  parseRuntimeVenueCapability,
  RUNTIME_PROTOCOL_SCHEMA_REGISTRY,
} from "../../apps/worker/src/runtime_contracts.js";

function readJson(path: string): unknown {
  const absolute = resolve(import.meta.dir, "..", "..", path);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

describe("worker runtime contract bridge", () => {
  test("worker imports the shared runtime protocol registry", () => {
    expect(Object.keys(RUNTIME_PROTOCOL_SCHEMA_REGISTRY)).toEqual([
      "deployment",
      "run",
      "ledgerSnapshot",
      "riskVerdict",
      "executionPlan",
      "reconciliationResult",
      "researchHypothesis",
      "researchSource",
      "researchExperiment",
      "researchEvidenceBundle",
      "historicalDatasetSnapshot",
      "replayCorpus",
      "featureDefinition",
      "regimeTag",
      "executionCostModel",
      "venueCapability",
      "assetRecord",
      "strategySpec",
    ]);
  });

  test("worker can parse the canonical deployment fixture", () => {
    const deployment = parseRuntimeDeploymentRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.deployment.valid.v1.json",
      ),
    );

    expect(deployment.deploymentId).toBe("dep_runtime_sol_usdc_shadow");
    expect(deployment.mode).toBe("shadow");
  });

  test("worker can parse the canonical strategy spec fixture", () => {
    const strategySpec = parseRuntimeStrategySpec(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_spec.valid.v1.json",
      ),
    );

    expect(strategySpec.strategyKey).toBe("trend_following");
    expect(strategySpec.pluginKey).toBe("builtin::trend_following");
  });

  test("worker can parse the canonical venue capability fixture", () => {
    const venueCapability = parseRuntimeVenueCapability(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.venue_capability.valid.v1.json",
      ),
    );

    expect(venueCapability.venueKey).toBe("jupiter");
    expect(venueCapability.adapterKeys).toContain("jupiter");
  });

  test("worker can parse the canonical asset record fixture", () => {
    const assetRecord = parseRuntimeAssetRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.asset_record.valid.v1.json",
      ),
    );

    expect(assetRecord.assetKey).toBe("SOL");
    expect(assetRecord.venueMappings[0]?.venueKey).toBe("jupiter");
  });

  test("worker can parse the canonical historical dataset fixture", () => {
    const datasetSnapshot = parseRuntimeHistoricalDatasetSnapshotRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.historical_dataset_snapshot.valid.v1.json",
      ),
    );

    expect(datasetSnapshot.datasetId).toBe(
      "dataset_feed_replay_sol_usdc_market_events",
    );
    expect(datasetSnapshot.datasetKind).toBe("market_events");
  });

  test("worker can parse the canonical replay corpus fixture", () => {
    const replayCorpus = parseRuntimeReplayCorpusRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.replay_corpus.valid.v1.json",
      ),
    );

    expect(replayCorpus.corpusId).toBe(
      "replay_corpus_sol_usdc_feed_gateway_seed",
    );
    expect(replayCorpus.datasetSnapshots).toHaveLength(2);
  });

  test("worker can parse the canonical feature definition fixture", () => {
    const featureDefinition = parseRuntimeFeatureDefinitionRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.feature_definition.valid.v1.json",
      ),
    );

    expect(featureDefinition.featureKey).toBe("short_return_bps");
    expect(featureDefinition.marketType).toBe("spot");
  });

  test("worker can parse the canonical regime tag fixture", () => {
    const regimeTag = parseRuntimeRegimeTagRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.regime_tag.valid.v1.json",
      ),
    );

    expect(regimeTag.regimeKey).toBe("long_trend");
    expect(regimeTag.dimension).toBe("trend");
  });

  test("worker can parse the canonical execution cost model fixture", () => {
    const costModel = parseRuntimeExecutionCostModelRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.execution_cost_model.valid.v1.json",
      ),
    );

    expect(costModel.modelId).toBe("cost_model_jupiter_sol_usdc_spot");
    expect(costModel.marketType).toBe("spot");
  });
});
