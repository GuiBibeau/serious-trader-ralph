import { describe, expect, test } from "bun:test";
import { buildConversationContext } from "../../apps/worker/src/conversation/context";
import { createConversationTestEnv } from "./_conversation_test_utils";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyDTt1v";

function createBaseConfig() {
  return {
    enabled: true,
    policy: {
      simulateOnly: true,
      dryRun: true,
    },
    strategy: {
      type: "dca",
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      amount: "1000000",
      everyMinutes: 60,
    },
    validation: {
      enabled: true,
      lookbackDays: 45,
      profile: "balanced" as const,
      gateMode: "hard" as const,
      minTrades: 8,
    },
  };
}

describe("worker conversation context", () => {
  test("builds a context snapshot and resolves start gate from latest validation", async () => {
    const tenantId = "bot-context-1";
    const env = createConversationTestEnv({
      tenantId,
      config: createBaseConfig(),
      runtimeState: {
        tenantId,
        lifecycleState: "active",
        activeStrategyHash: "hash-ok",
        lastValidationId: 11,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: "2026-02-14T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      latestValidationForHash: {
        id: 11,
        tenantId,
        strategyHash: "hash-ok",
        strategyType: "dca",
        lookbackDays: 45,
        profile: "balanced",
        status: "passed",
        metricsJson: JSON.stringify({
          netReturnPct: 4.6,
          maxDrawdownPct: 3.2,
          profitFactor: 1.31,
          winRate: 73,
          tradeCount: 13,
        }),
        thresholdsJson: JSON.stringify({}),
        summary: "context test",
        startedAt: "2026-02-13T00:00:00.000Z",
        completedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        createdAt: "2026-02-13T00:00:00.000Z",
      },
      latestValidation: {
        id: 11,
        tenantId,
        strategyHash: "hash-ok",
        strategyType: "dca",
        lookbackDays: 45,
        profile: "balanced",
        status: "passed",
        metricsJson: JSON.stringify({
          netReturnPct: 4.6,
          maxDrawdownPct: 3.2,
          profitFactor: 1.31,
          winRate: 73,
          tradeCount: 13,
        }),
        thresholdsJson: JSON.stringify({}),
        summary: "context test",
        startedAt: "2026-02-13T00:00:00.000Z",
        completedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        createdAt: "2026-02-13T00:00:00.000Z",
      },
      validationRuns: [
        {
          id: 11,
          tenantId,
          strategyHash: "hash-ok",
          strategyType: "dca",
          lookbackDays: 45,
          profile: "balanced",
          status: "passed",
          metricsJson: JSON.stringify({
            netReturnPct: 4.6,
            maxDrawdownPct: 3.2,
            profitFactor: 1.31,
            winRate: 73,
            tradeCount: 13,
          }),
          thresholdsJson: JSON.stringify({}),
          summary: "context test",
          startedAt: "2026-02-13T00:00:00.000Z",
          completedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          createdAt: "2026-02-13T00:00:00.000Z",
        },
      ],
    });

    const context = await buildConversationContext(env, tenantId, {
      includeSources: ["runtime", "validation-runs", "bot-events"],
      limit: { botEvents: 3, strategyEvents: 3, trades: 3, validationRuns: 3 },
    });

    expect(context.telemetry.tenantId).toBe(tenantId);
    expect(context.telemetry.strategyDescriptor.headline).toBe("DCA strategy");
    expect(context.telemetry.startGate.ok).toBe(true);
    expect(context.telemetry.runtimeState?.lifecycleState).toBe("active");
    expect(context.telemetry.validationRuns).toHaveLength(1);
  });

  test("reports a not-validated gate when no recent passing validation exists", async () => {
    const tenantId = "bot-context-2";
    const env = createConversationTestEnv({
      tenantId,
      config: createBaseConfig(),
      runtimeState: {
        tenantId,
        lifecycleState: "candidate",
        activeStrategyHash: "hash-nope",
        lastValidationId: null,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: null,
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      latestValidationForHash: null,
      latestValidation: null,
      validationRuns: [],
    });

    const context = await buildConversationContext(env, tenantId, {
      includeSources: ["validation-runs"],
      limit: { botEvents: 1, strategyEvents: 1, trades: 1, validationRuns: 2 },
    });

    expect(context.telemetry.startGate.ok).toBe(false);
    expect(context.telemetry.startGate.reason).toBe("strategy-not-validated");
    expect(context.telemetry.latestValidation).toBeNull();
  });
});
