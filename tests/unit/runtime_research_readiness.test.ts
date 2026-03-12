import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseRuntimeAssetRecord,
  parseRuntimeBacktestReport,
  parseRuntimeExecutionCostModelRecord,
  parseRuntimeExecutionCostObservationRecord,
  parseRuntimeFeatureDefinitionRecord,
  parseRuntimeHistoricalDatasetSnapshotRecord,
  parseRuntimeStrategyLabReadinessCanaryRun,
  parseRuntimeStrategyLabSubjectControl,
} from "../../src/runtime/contracts/autonomous_runtime.js";
import { buildRuntimeResearchReadiness } from "../../src/runtime/research/readiness.js";
import { getRuntimeVenueCapability } from "../../src/runtime/venues/catalog.js";

function readJson(path: string): unknown {
  const absolute = resolve(import.meta.dir, "..", "..", path);
  return JSON.parse(readFileSync(absolute, "utf8")) as unknown;
}

function createAssetRecord() {
  return parseRuntimeAssetRecord(
    readJson(
      "docs/runtime-contracts/fixtures/runtime.asset_record.valid.v1.json",
    ),
  );
}

function createSubjectControl(
  subjectKind: "venue" | "asset",
  subjectKey: string,
) {
  return parseRuntimeStrategyLabSubjectControl({
    ...readJson(
      "docs/runtime-contracts/fixtures/runtime.strategy_lab_subject_control.valid.v1.json",
    ),
    subjectKind,
    subjectKey,
  });
}

describe("runtime research readiness", () => {
  test("builds a passing limited-live readiness artifact when all evidence is present", () => {
    const assetRecord = createAssetRecord();
    const readiness = buildRuntimeResearchReadiness({
      request: {
        subjectKind: "asset",
        subjectKey: assetRecord.assetKey,
        targetState: "limited_live_ready",
        requestedBy: "codex",
        venueKey: "jupiter",
        assetKey: assetRecord.assetKey,
        pairSymbol: "SOL/USDC",
        adapterKey: "jupiter",
        venueCapability: getRuntimeVenueCapability("jupiter"),
        assetRecord,
        datasetSnapshots: [
          parseRuntimeHistoricalDatasetSnapshotRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.historical_dataset_snapshot.valid.v1.json",
            ),
          ),
        ],
        featureDefinitions: [
          parseRuntimeFeatureDefinitionRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.feature_definition.valid.v1.json",
            ),
          ),
        ],
        costModels: [
          parseRuntimeExecutionCostModelRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.execution_cost_model.valid.v1.json",
            ),
          ),
        ],
        costObservations: [
          parseRuntimeExecutionCostObservationRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.execution_cost_observation.valid.v1.json",
            ),
          ),
        ],
        backtests: [
          parseRuntimeBacktestReport(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.backtest_report.valid.v1.json",
            ),
          ),
        ],
        controls: {
          venue: createSubjectControl("venue", "jupiter"),
          asset: createSubjectControl("asset", assetRecord.assetKey),
        },
      },
    });

    expect(readiness.status).toBe("pass");
    expect(readiness.targetState).toBe("limited_live_ready");
    expect(readiness.evidenceRefs.map((ref) => ref.kind)).toContain(
      "bounded_canary_plan",
    );
    expect(
      readiness.checks.find((check) => check.checkId === "control-posture")
        ?.status,
    ).toBe("pass");
  });

  test("blocks broad-live readiness when the canary evidence is missing", () => {
    const assetRecord = createAssetRecord();
    const readiness = buildRuntimeResearchReadiness({
      request: {
        subjectKind: "asset",
        subjectKey: assetRecord.assetKey,
        targetState: "broad_live_ready",
        requestedBy: "codex",
        venueKey: "jupiter",
        assetKey: assetRecord.assetKey,
        pairSymbol: "SOL/USDC",
        adapterKey: "jupiter",
        venueCapability: getRuntimeVenueCapability("jupiter"),
        assetRecord,
        datasetSnapshots: [
          parseRuntimeHistoricalDatasetSnapshotRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.historical_dataset_snapshot.valid.v1.json",
            ),
          ),
        ],
        featureDefinitions: [
          parseRuntimeFeatureDefinitionRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.feature_definition.valid.v1.json",
            ),
          ),
        ],
        costModels: [
          parseRuntimeExecutionCostModelRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.execution_cost_model.valid.v1.json",
            ),
          ),
        ],
        costObservations: [
          parseRuntimeExecutionCostObservationRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.execution_cost_observation.valid.v1.json",
            ),
          ),
        ],
        backtests: [
          parseRuntimeBacktestReport(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.backtest_report.valid.v1.json",
            ),
          ),
        ],
        controls: {
          venue: parseRuntimeStrategyLabSubjectControl({
            ...createSubjectControl("venue", "jupiter"),
            liveAllowed: true,
          }),
          asset: parseRuntimeStrategyLabSubjectControl({
            ...createSubjectControl("asset", assetRecord.assetKey),
            liveAllowed: true,
          }),
        },
      },
    });

    expect(readiness.status).toBe("blocked");
    expect(
      readiness.checks.find((check) => check.checkId === "limited-live-canary")
        ?.status,
    ).toBe("blocked");
  });

  test("accepts a successful canary run as broad-live evidence", () => {
    const assetRecord = createAssetRecord();
    const readiness = buildRuntimeResearchReadiness({
      request: {
        subjectKind: "asset",
        subjectKey: assetRecord.assetKey,
        targetState: "broad_live_ready",
        requestedBy: "codex",
        venueKey: "jupiter",
        assetKey: assetRecord.assetKey,
        pairSymbol: "SOL/USDC",
        adapterKey: "jupiter",
        venueCapability: getRuntimeVenueCapability("jupiter"),
        assetRecord,
        datasetSnapshots: [
          parseRuntimeHistoricalDatasetSnapshotRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.historical_dataset_snapshot.valid.v1.json",
            ),
          ),
        ],
        featureDefinitions: [
          parseRuntimeFeatureDefinitionRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.feature_definition.valid.v1.json",
            ),
          ),
        ],
        costModels: [
          parseRuntimeExecutionCostModelRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.execution_cost_model.valid.v1.json",
            ),
          ),
        ],
        costObservations: [
          parseRuntimeExecutionCostObservationRecord(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.execution_cost_observation.valid.v1.json",
            ),
          ),
        ],
        backtests: [
          parseRuntimeBacktestReport(
            readJson(
              "docs/runtime-contracts/fixtures/runtime.backtest_report.valid.v1.json",
            ),
          ),
        ],
        controls: {
          venue: parseRuntimeStrategyLabSubjectControl({
            ...createSubjectControl("venue", "jupiter"),
            liveAllowed: true,
          }),
          asset: parseRuntimeStrategyLabSubjectControl({
            ...createSubjectControl("asset", assetRecord.assetKey),
            liveAllowed: true,
          }),
        },
        canaryRun: parseRuntimeStrategyLabReadinessCanaryRun({
          ...readJson(
            "docs/runtime-contracts/fixtures/runtime.strategy_lab_readiness_canary_run.valid.v1.json",
          ),
          subjectKey: assetRecord.assetKey,
          assetKey: assetRecord.assetKey,
          pairSymbol: "SOL/USDC",
          outputMint: "So11111111111111111111111111111111111111112",
        }),
      },
    });

    expect(readiness.status).toBe("pass");
    expect(readiness.canaryRunId).toBe("readinesscanary_asset_jup");
    expect(readiness.evidenceRefs.map((ref) => ref.kind)).toContain(
      "live_canary",
    );
  });
});
