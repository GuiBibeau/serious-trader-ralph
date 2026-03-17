import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getRuntimeStrategyDeskScenarioWorkflow,
  listRuntimeStrategyDeskScenarioRunsWorkflow,
  upsertRuntimeStrategyDeskScenarioWorkflow,
} from "../../apps/worker/src/runtime_strategy_desk";
import {
  executeRuntimeStrategyDeskScenarioWorkflow,
  readLegNetExposureUsd,
} from "../../apps/worker/src/runtime_strategy_desk_runner";
import type { Env } from "../../apps/worker/src/types";
import { createWorkerLiveEnv } from "../integration/_worker_live_test_utils";

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              const result = statement.run(...(params as never[])) as {
                changes?: number;
              };
              return {
                meta: {
                  changes:
                    typeof result.changes === "number" ? result.changes : 0,
                },
              };
            },
            async first() {
              const statement = db.query(sql);
              return (statement.get(...(params as never[])) as unknown) ?? null;
            },
            async all() {
              const statement = db.query(sql);
              return {
                results: (statement.all(...(params as never[])) ??
                  []) as unknown[],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function createOpsEnv(overrides?: Partial<Env>) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
    "0027_runtime_canary.sql",
    "0028_strategy_lab_promotions.sql",
    "0029_strategy_lab_readiness.sql",
    "0030_strategy_lab_post_live.sql",
    "0031_strategy_desk_registry.sql",
    "0032_strategy_desk_leg_intent.sql",
    "0033_strategy_desk_scorecards.sql",
  ]) {
    const migrationPath = resolve(
      import.meta.dir,
      "..",
      "..",
      "apps/worker/migrations",
      migrationName,
    );
    sqlite.exec(readFileSync(migrationPath, "utf8"));
  }

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ADMIN_TOKEN: "admin-secret",
      RPC_ENDPOINT: "https://rpc.example.test",
      JUPITER_BASE_URL: "https://jupiter.example.test",
      ...overrides,
    },
  });

  return { env, sqlite };
}

function readFixture(fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "docs/runtime-contracts/fixtures",
        fileName,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

const quoteSpotSwapMock = mock(
  async (input: {
    venueKey?: string;
    inputMint: string;
    outputMint: string;
    amountAtomic: string;
  }) => ({
    venueKey: input.venueKey ?? "jupiter",
    quoteProvider: "mock-quote",
    quoteResponse: {
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inAmount: input.amountAtomic,
      outAmount: "7000000000",
      priceImpactPct: 0.001,
      routePlan: [{ poolId: "pool_1", swapInfo: { label: "MockRoute" } }],
    },
    routeQuality: {
      venueKey: input.venueKey ?? "jupiter",
      quoteProvider: "mock-quote",
      routeHopCount: 1,
      routeLabels: ["MockRoute"],
      poolIds: ["pool_1"],
      quotedOutAmountAtomic: "7000000000",
      minExpectedOutAmountAtomic: "6900000000",
      priceImpactPct: 0.001,
    },
  }),
);

const executeIntentViaRouterMock = mock(
  async (input: {
    intent: { family: string; venueKey?: string };
    execution?: { adapter?: string };
  }) => ({
    status: "simulated" as const,
    signature: null,
    usedQuote: {
      inputMint: "mint_in",
      outputMint: "mint_out",
      inAmount: "100",
      outAmount: "101",
      priceImpactPct: 0,
      routePlan: [],
    },
    refreshed: false,
    lastValidBlockHeight: null,
    executionMeta: {
      route: input.execution?.adapter ?? input.intent.venueKey ?? "mock",
      classification: "simulated" as const,
      lifecycle: {
        fillState: "pending" as const,
        settlementState: "pending" as const,
        notes: [`family:${input.intent.family}`],
      },
    },
  }),
);

describe("runtime strategy desk runner", () => {
  beforeEach(() => {
    quoteSpotSwapMock.mockClear();
    executeIntentViaRouterMock.mockClear();
  });

  test("executes a mixed paper scenario in dependency order and persists a passing report", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: scenario as never,
      });

      const seenFamilies: string[] = [];
      executeIntentViaRouterMock.mockImplementationOnce(async (input) => {
        seenFamilies.push(input.intent.family);
        return {
          status: "simulated" as const,
          signature: null,
          usedQuote: {
            inputMint: "mint_in",
            outputMint: "mint_out",
            inAmount: "100",
            outAmount: "101",
            priceImpactPct: 0,
            routePlan: [],
          },
          refreshed: false,
          lastValidBlockHeight: null,
          executionMeta: {
            route: input.execution?.adapter ?? "mock",
            classification: "simulated" as const,
            lifecycle: {
              fillState: "pending" as const,
              settlementState: "pending" as const,
              notes: [`family:${input.intent.family}`],
            },
          },
        };
      });
      executeIntentViaRouterMock.mockImplementation(async (input) => {
        seenFamilies.push(input.intent.family);
        return {
          status: "simulated" as const,
          signature: null,
          usedQuote: {
            inputMint: "mint_in",
            outputMint: "mint_out",
            inAmount: "100",
            outAmount: "101",
            priceImpactPct: 0,
            routePlan: [],
          },
          refreshed: false,
          lastValidBlockHeight: null,
          executionMeta: {
            route: input.execution?.adapter ?? "mock",
            classification: "simulated" as const,
          },
        };
      });

      const result = await executeRuntimeStrategyDeskScenarioWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "paper",
          requestedBy: "operator_1",
          walletAddress: "11111111111111111111111111111111",
        },
        {
          createId(prefix) {
            return `${prefix}_det`;
          },
          createRpc: () => ({}) as never,
          createJupiterClient: () => ({}) as never,
          createDFlowClient: () => ({}) as never,
          createDriftClient: () => ({}) as never,
          createRaydiumClient: () => ({}) as never,
          createOrcaClient: () => ({}) as never,
          createMangoClient: () => ({}) as never,
          createOpenBookClient: () => ({}) as never,
          quoteSpotSwap: quoteSpotSwapMock as never,
          executeIntentViaRouter: executeIntentViaRouterMock as never,
        },
      );

      expect(seenFamilies).toEqual([
        "spot_swap",
        "perp_order",
        "prediction_order",
        "flash_atomic",
      ]);
      expect(result.run.state).toBe("completed");
      expect(result.report.status).toBe("pass");
      expect(
        result.run.legRuns.every((legRun) => legRun.state === "completed"),
      ).toBe(true);
      expect(
        result.report.legOutcomes.every((outcome) => outcome.status === "pass"),
      ).toBe(true);

      const storedScenario = await getRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenarioId: "desk_sol_composite_1",
      });
      expect(storedScenario.scenario.latestReportId).toBe(
        "desk_report_desk_sol_composite_1_paper_det",
      );
      expect(
        (
          result.run.metadata as
            | { artifacts?: Record<string, unknown> }
            | undefined
        )?.artifacts,
      ).toBeDefined();
      expect(quoteSpotSwapMock).toHaveBeenCalledTimes(1);
    } finally {
      sqlite.close();
    }
  });

  test("retries a failing leg and fails closed with later legs skipped", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: scenario as never,
      });

      const attempts = new Map<string, number>();
      executeIntentViaRouterMock.mockImplementation(async (input) => {
        const family = input.intent.family;
        const count = (attempts.get(family) ?? 0) + 1;
        attempts.set(family, count);
        if (family === "prediction_order") {
          return {
            status: "simulate_error" as const,
            signature: null,
            usedQuote: {
              inputMint: "mint_in",
              outputMint: "mint_out",
              inAmount: "100",
              outAmount: "101",
              priceImpactPct: 0,
              routePlan: [],
            },
            refreshed: false,
            lastValidBlockHeight: null,
            err: {
              code: "prediction-preview-failed",
              reason: "market blocked",
            },
            executionMeta: {
              route: input.execution?.adapter ?? "mock",
              classification: "error" as const,
            },
          };
        }
        return {
          status: "simulated" as const,
          signature: null,
          usedQuote: {
            inputMint: "mint_in",
            outputMint: "mint_out",
            inAmount: "100",
            outAmount: "101",
            priceImpactPct: 0,
            routePlan: [],
          },
          refreshed: false,
          lastValidBlockHeight: null,
          executionMeta: {
            route: input.execution?.adapter ?? "mock",
            classification: "simulated" as const,
          },
        };
      });

      const result = await executeRuntimeStrategyDeskScenarioWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "paper",
          requestedBy: "operator_1",
          walletAddress: "11111111111111111111111111111111",
          maxRetriesPerLeg: 1,
        },
        {
          createId(prefix) {
            return `${prefix}_retry`;
          },
          createRpc: () => ({}) as never,
          createJupiterClient: () => ({}) as never,
          createDFlowClient: () => ({}) as never,
          createDriftClient: () => ({}) as never,
          createRaydiumClient: () => ({}) as never,
          createOrcaClient: () => ({}) as never,
          createMangoClient: () => ({}) as never,
          createOpenBookClient: () => ({}) as never,
          quoteSpotSwap: quoteSpotSwapMock as never,
          executeIntentViaRouter: executeIntentViaRouterMock as never,
        },
      );

      expect(result.run.state).toBe("failed");
      expect(result.report.status).toBe("blocked");
      expect(attempts.get("prediction_order")).toBe(2);
      const flashLeg = result.run.legRuns.find(
        (legRun) => legRun.legId === "leg_flash_rebalance",
      );
      expect(flashLeg?.state).toBe("skipped");
      const artifacts = (
        result.run.metadata as {
          artifacts?: Record<string, { attemptCount: number; status: string }>;
        }
      ).artifacts;
      expect(artifacts?.leg_prediction_overlay?.attemptCount).toBe(2);
      expect(artifacts?.leg_flash_rebalance?.status).toBe("skipped");
    } finally {
      sqlite.close();
    }
  });

  test("rejects unsupported legs without bypassing scenario-level fail-closed behavior", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const mutatedScenario = {
        ...scenario,
        legs: (scenario.legs as Array<Record<string, unknown>>).map((leg) =>
          leg.legId === "leg_perp_hedge"
            ? {
                ...leg,
                enabledModes: ["shadow"],
              }
            : leg,
        ),
      };
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: mutatedScenario as never,
      });

      const result = await executeRuntimeStrategyDeskScenarioWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "paper",
          requestedBy: "operator_1",
          walletAddress: "11111111111111111111111111111111",
        },
        {
          createId(prefix) {
            return `${prefix}_blocked`;
          },
          createRpc: () => ({}) as never,
          createJupiterClient: () => ({}) as never,
          createDFlowClient: () => ({}) as never,
          createDriftClient: () => ({}) as never,
          createRaydiumClient: () => ({}) as never,
          createOrcaClient: () => ({}) as never,
          createMangoClient: () => ({}) as never,
          createOpenBookClient: () => ({}) as never,
          quoteSpotSwap: quoteSpotSwapMock as never,
          executeIntentViaRouter: executeIntentViaRouterMock as never,
        },
      );

      expect(result.run.state).toBe("rejected");
      expect(result.report.status).toBe("blocked");
      expect(
        result.run.legRuns.find((legRun) => legRun.legId === "leg_spot_alpha")
          ?.state,
      ).toBe("completed");
      expect(
        result.run.legRuns.find((legRun) => legRun.legId === "leg_perp_hedge")
          ?.state,
      ).toBe("failed");
      expect(
        result.run.legRuns.find(
          (legRun) => legRun.legId === "leg_prediction_overlay",
        )?.state,
      ).toBe("skipped");
    } finally {
      sqlite.close();
    }
  });

  test("uses the venue default adapter for paper spot legs when the manifest omits one", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const mutatedScenario = {
        ...scenario,
        legs: (scenario.legs as Array<Record<string, unknown>>).map((leg) =>
          leg.legId === "leg_spot_alpha"
            ? {
                ...leg,
                venueKey: "magicblock",
                enabledModes: ["shadow", "paper"],
              }
            : leg,
        ),
      };
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: mutatedScenario as never,
      });

      await executeRuntimeStrategyDeskScenarioWorkflow(
        {
          env,
          scenarioId: "desk_sol_composite_1",
          runKind: "paper",
          requestedBy: "operator_1",
          walletAddress: "11111111111111111111111111111111",
        },
        {
          createId(prefix) {
            return `${prefix}_magicblock`;
          },
          createRpc: () => ({}) as never,
          createJupiterClient: () => ({}) as never,
          createDFlowClient: () => ({}) as never,
          createDriftClient: () => ({}) as never,
          createRaydiumClient: () => ({}) as never,
          createOrcaClient: () => ({}) as never,
          createMangoClient: () => ({}) as never,
          createOpenBookClient: () => ({}) as never,
          quoteSpotSwap: quoteSpotSwapMock as never,
          executeIntentViaRouter: executeIntentViaRouterMock as never,
        },
      );

      const spotCall = executeIntentViaRouterMock.mock.calls.find(
        ([input]) => input.intent.family === "spot_swap",
      );
      expect(spotCall?.[0].execution?.adapter).toBe(
        "magicblock_ephemeral_rollup",
      );
    } finally {
      sqlite.close();
    }
  });

  test("validates the dependency graph before persisting a pending run", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const scenario = readFixture(
        "runtime.strategy_desk_scenario.valid.v1.json",
      );
      const mutatedScenario = {
        ...scenario,
        legs: (scenario.legs as Array<Record<string, unknown>>).map((leg) =>
          leg.legId === "leg_perp_hedge"
            ? {
                ...leg,
                dependencies: ["missing_leg"],
              }
            : leg,
        ),
      };
      await upsertRuntimeStrategyDeskScenarioWorkflow({
        env,
        scenario: mutatedScenario as never,
      });

      await expect(
        executeRuntimeStrategyDeskScenarioWorkflow(
          {
            env,
            scenarioId: "desk_sol_composite_1",
            runKind: "paper",
            requestedBy: "operator_1",
            walletAddress: "11111111111111111111111111111111",
          },
          {
            createId(prefix) {
              return `${prefix}_invalid_graph`;
            },
            createRpc: () => ({}) as never,
            createJupiterClient: () => ({}) as never,
            createDFlowClient: () => ({}) as never,
            createDriftClient: () => ({}) as never,
            createRaydiumClient: () => ({}) as never,
            createOrcaClient: () => ({}) as never,
            createMangoClient: () => ({}) as never,
            createOpenBookClient: () => ({}) as never,
            quoteSpotSwap: quoteSpotSwapMock as never,
            executeIntentViaRouter: executeIntentViaRouterMock as never,
          },
        ),
      ).rejects.toThrow(
        "runtime-strategy-desk-leg-dependency-unknown:desk_sol_composite_1:leg_perp_hedge:missing_leg",
      );

      const storedRuns = await listRuntimeStrategyDeskScenarioRunsWorkflow({
        env,
        scenarioId: "desk_sol_composite_1",
      });
      expect(storedRuns.runs).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });

  test("counts conditional spot legs toward net exposure overlays", () => {
    const scenario = readFixture(
      "runtime.strategy_desk_scenario.valid.v1.json",
    ) as {
      legs: Array<Record<string, unknown>>;
    };
    const spotLeg = scenario.legs.find((leg) => leg.legId === "leg_spot_alpha");
    expect(spotLeg).toBeDefined();

    const buyExposure = readLegNetExposureUsd({
      ...(spotLeg as Record<string, unknown>),
      intentFamily: "conditional_spot_order",
      intent: {
        side: "buy",
        quantityAtomic: "1000000000",
        limitPriceAtomic: "142000000",
      },
    } as never);
    const sellExposure = readLegNetExposureUsd({
      ...(spotLeg as Record<string, unknown>),
      intentFamily: "conditional_spot_order",
      intent: {
        side: "sell",
        quantityAtomic: "1000000000",
        limitPriceAtomic: "142000000",
      },
    } as never);

    expect(buyExposure).toBe(1000);
    expect(sellExposure).toBe(-1000);
  });
});
