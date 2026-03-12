import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type RuntimeResearchCurationIo,
  runRuntimeResearchCurationWorkflow,
} from "../../apps/worker/src/runtime_research_curation";
import { parseRuntimeResearchCurationRequest } from "../../src/runtime/research/curation.js";

const callOrder: string[] = [];

function loadFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "docs",
        "runtime-contracts",
        "fixtures",
        filename,
      ),
      "utf8",
    ),
  ) as T;
}

function writeResult(
  key: string,
  value: unknown,
): Promise<{
  ok: true;
  status: number;
  payload: Record<string, unknown>;
}> {
  return Promise.resolve({
    ok: true,
    status: 201,
    payload: {
      created: true,
      [key]: value,
    },
  });
}

const io: RuntimeResearchCurationIo = {
  writeRuntimeResearchSource: mock(async ({ sourceRecord }) => {
    callOrder.push("source");
    return await writeResult("sourceRecord", sourceRecord);
  }),
  writeRuntimeResearchHypothesis: mock(async ({ hypothesis }) => {
    callOrder.push("hypothesis");
    return await writeResult("hypothesis", hypothesis);
  }),
  writeRuntimeAsset: mock(async ({ asset }) => {
    callOrder.push("asset");
    return await writeResult("asset", asset);
  }),
  writeRuntimeHistoricalDatasetSnapshot: mock(async ({ datasetSnapshot }) => {
    callOrder.push("datasetSnapshot");
    return await writeResult("datasetSnapshot", datasetSnapshot);
  }),
  writeRuntimeReplayCorpus: mock(async ({ replayCorpus }) => {
    callOrder.push("replayCorpus");
    return await writeResult("replayCorpus", replayCorpus);
  }),
  writeRuntimeFeatureDefinition: mock(async ({ featureDefinition }) => {
    callOrder.push("featureDefinition");
    return await writeResult("featureDefinition", featureDefinition);
  }),
  writeRuntimeRegimeTag: mock(async ({ regimeTag }) => {
    callOrder.push("regimeTag");
    return await writeResult("regimeTag", regimeTag);
  }),
  writeRuntimeExecutionCostModel: mock(async ({ costModel }) => {
    callOrder.push("costModel");
    return await writeResult("costModel", costModel);
  }),
  writeRuntimeExecutionCostObservation: mock(async ({ costObservation }) => {
    callOrder.push("costObservation");
    return await writeResult("costObservation", costObservation);
  }),
  writeRuntimeResearchExperiment: mock(async ({ experiment }) => {
    callOrder.push("experiment");
    return await writeResult("experiment", experiment);
  }),
  runRuntimeBacktest: mock(async ({ payload }) => {
    callOrder.push("backtest");
    const fixture = loadFixture<Record<string, unknown>>(
      "runtime.backtest_report.valid.v1.json",
    );
    const config =
      typeof fixture.config === "object" && fixture.config !== null
        ? (fixture.config as Record<string, unknown>)
        : {};
    const report = {
      ...fixture,
      reportId: payload.reportId ?? "backtest_report_seed",
      experimentId: payload.experimentId,
      config: {
        ...config,
        replayCorpusId: payload.replayCorpusId,
        venueKey: payload.venueKey,
        pairSymbol: payload.pairSymbol,
        marketType: payload.marketType,
        windowMode: payload.windowMode,
        trainingWindowObservations: payload.trainingWindowObservations,
        testingWindowObservations: payload.testingWindowObservations,
        stepObservations: payload.stepObservations,
        purgeObservations: payload.purgeObservations,
        baselineStrategies: payload.baselineStrategies,
      },
    };
    return await writeResult("report", report);
  }),
  writeRuntimeResearchEvidenceBundle: mock(async ({ evidenceBundle }) => {
    callOrder.push("evidenceBundle");
    return await writeResult("evidenceBundle", evidenceBundle);
  }),
};

describe("runRuntimeResearchCurationWorkflow", () => {
  beforeEach(() => {
    callOrder.length = 0;
    for (const fn of Object.values(io)) {
      fn.mockClear();
    }
  });

  test("runs backtests before persisting evidence bundles in same-request curation", async () => {
    const request = parseRuntimeResearchCurationRequest(
      JSON.parse(
        readFileSync(
          resolve(
            import.meta.dir,
            "..",
            "..",
            "docs",
            "strategy-lab",
            "pilots",
            "trend-following-sol-usdc",
            "curation.request.json",
          ),
          "utf8",
        ),
      ),
    );

    const result = await runRuntimeResearchCurationWorkflow({
      env: {} as never,
      request,
      io,
    });

    expect(result.summary.backtests.created).toBe(1);
    expect(result.summary.evidenceBundles.created).toBe(1);
    expect(callOrder.indexOf("backtest")).toBeGreaterThan(
      callOrder.indexOf("experiment"),
    );
    expect(callOrder.indexOf("evidenceBundle")).toBeGreaterThan(
      callOrder.indexOf("backtest"),
    );
  });
});
