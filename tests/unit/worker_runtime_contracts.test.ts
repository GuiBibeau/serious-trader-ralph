import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeDeploymentRecord,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeRegimeTagRecord,
  parseRuntimeReplayCorpusRecord,
  parseRuntimeResearchReproducibilityBundleRecord,
  parseRuntimeStrategyDeskPromotionHandoff,
  parseRuntimeStrategyDeskScenarioManifest,
  parseRuntimeStrategyDeskScenarioReport,
  parseRuntimeStrategyDeskScenarioRun,
  parseRuntimeStrategyLabPostLiveArtifact,
  parseRuntimeStrategyLabPromotionEvent,
  parseRuntimeStrategyLabPromotionRecord,
  parseRuntimeStrategyLabReadinessArtifact,
  parseRuntimeStrategyLabReadinessCanaryRun,
  parseRuntimeStrategyLabSubjectControl,
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
      "researchReproducibilityBundle",
      "backtestReport",
      "historicalDatasetSnapshot",
      "replayCorpus",
      "featureDefinition",
      "regimeTag",
      "executionCostModel",
      "executionCostObservation",
      "venueCapability",
      "marginAccountSnapshot",
      "assetRecord",
      "strategySpec",
      "strategyLabPromotion",
      "strategyLabPromotionEvent",
      "strategyLabSubjectControl",
      "strategyLabReadinessArtifact",
      "strategyLabReadinessCanaryRun",
      "strategyLabPostLiveArtifact",
      "strategyDeskScenario",
      "strategyDeskRun",
      "strategyDeskReport",
      "strategyDeskPromotionHandoff",
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

  test("worker can parse the canonical backtest fixture", () => {
    const report = parseRuntimeBacktestReport(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.backtest_report.valid.v1.json",
      ),
    );

    expect(report.reportId).toBe("backtest_alloc_dca_report");
    expect(report.promotionEligible).toBe(true);
  });

  test("worker accepts runtime backtest reports with null comparedTo revisions", () => {
    const fixture = readJson(
      "docs/runtime-contracts/fixtures/runtime.backtest_report.valid.v1.json",
    ) as Record<string, unknown>;
    const codeRevision =
      typeof fixture.codeRevision === "object" && fixture.codeRevision !== null
        ? (fixture.codeRevision as Record<string, unknown>)
        : {};

    const report = parseRuntimeBacktestReport({
      ...fixture,
      codeRevision: {
        ...codeRevision,
        comparedTo: null,
      },
    });

    expect(report.codeRevision.comparedTo).toBeUndefined();
  });

  test("worker can parse the canonical reproducibility bundle fixture", () => {
    const bundle = parseRuntimeResearchReproducibilityBundleRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.research_reproducibility_bundle.valid.v1.json",
      ),
    );

    expect(bundle.reproducibilityBundleId).toBe("repro_alloc_dca_backtest");
    expect(bundle.expectedResult.reportId).toBe("backtest_alloc_dca_report");
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

  test("worker can parse the canonical strategy-lab promotion fixtures", () => {
    const promotion = parseRuntimeStrategyLabPromotionRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_lab_promotion.valid.v1.json",
      ),
    );
    const event = parseRuntimeStrategyLabPromotionEvent(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_lab_promotion_event.valid.v1.json",
      ),
    );

    expect(promotion.targetState).toBe("shadow");
    expect(promotion.actions[1]?.actionType).toBe("upsert_runtime_deployment");
    expect(event.eventType).toBe("applied");
  });

  test("worker can parse the canonical strategy-lab readiness fixtures", () => {
    const control = parseRuntimeStrategyLabSubjectControl(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_lab_subject_control.valid.v1.json",
      ),
    );
    const artifact = parseRuntimeStrategyLabReadinessArtifact(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_lab_readiness_artifact.valid.v1.json",
      ),
    );
    const canaryRun = parseRuntimeStrategyLabReadinessCanaryRun(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_lab_readiness_canary_run.valid.v1.json",
      ),
    );

    expect(control.subjectKind).toBe("venue");
    expect(artifact.targetState).toBe("limited_live_ready");
    expect(canaryRun.status).toBe("success");
  });

  test("worker can parse the canonical strategy-lab post-live fixture", () => {
    const artifact = parseRuntimeStrategyLabPostLiveArtifact(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_lab_post_live_artifact.valid.v1.json",
      ),
    );

    expect(artifact.recommendedAction).toBe("demote");
    expect(artifact.appliedTargetState).toBe("paper");
  });

  test("worker can parse the canonical strategy-desk fixtures", () => {
    const scenario = parseRuntimeStrategyDeskScenarioManifest(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_desk_scenario.valid.v1.json",
      ),
    );
    const run = parseRuntimeStrategyDeskScenarioRun(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_desk_run.valid.v1.json",
      ),
    );
    const report = parseRuntimeStrategyDeskScenarioReport(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_desk_report.valid.v1.json",
      ),
    );
    const handoff = parseRuntimeStrategyDeskPromotionHandoff(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.strategy_desk_promotion_handoff.valid.v1.json",
      ),
    );

    expect(scenario.state).toBe("paper_ready");
    expect(scenario.legs).toHaveLength(4);
    expect(run.runKind).toBe("paper");
    expect(report.status).toBe("requires_human_approval");
    expect(handoff.targetMode).toBe("limited_live");
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
    expect(costModel.calibration.calibrationId).toBe(
      "calibration_jupiter_sol_usdc_spot_seed",
    );
  });

  test("worker can parse the canonical execution cost observation fixture", () => {
    const costObservation = parseRuntimeExecutionCostObservationRecord(
      readJson(
        "docs/runtime-contracts/fixtures/runtime.execution_cost_observation.valid.v1.json",
      ),
    );

    expect(costObservation.modelId).toBe("cost_model_jupiter_sol_usdc_spot");
    expect(costObservation.costDriftBps).toBe(80);
  });
});
