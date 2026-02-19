import { describe, expect, test } from "bun:test";
import {
  handleChatHistory,
  handleChatRequest,
  handleTelemetry,
} from "../../apps/worker/src/conversation/router";
import { createConversationTestEnv } from "./_conversation_test_utils";

describe("worker chat endpoints", () => {
  test("handles deterministic chat request and persists history", async () => {
    const tenantId = "bot-chat-1";
    const env = createConversationTestEnv({
      tenantId,
      config: {
        enabled: true,
        policy: {
          simulateOnly: true,
          dryRun: false,
        },
        strategy: {
          type: "dca",
          inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyDTt1v",
          outputMint: "So11111111111111111111111111111111111111112",
          amount: "5000000",
          everyMinutes: 60,
        },
        validation: {
          enabled: true,
          lookbackDays: 45,
          profile: "balanced",
          gateMode: "hard",
          minTrades: 8,
        },
      },
      runtimeState: {
        tenantId,
        lifecycleState: "active",
        activeStrategyHash: "chat-hash",
        lastValidationId: null,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: null,
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      latestValidation: null,
      latestValidationForHash: null,
      validationRuns: [],
    });

    const payload = {
      message: "What happened recently?",
      includeSources: ["runtime"],
      explain: false,
      limit: 8,
    };
    const response = await handleChatRequest(env, tenantId, payload);

    expect(response.ok).toBe(true);
    expect(typeof response.conversationId).toBe("number");
    expect(response.sources[0]?.type).toBe("runtime");

    const history = await handleChatHistory(
      env,
      tenantId,
      new Request("http://localhost/api/bots/bot-chat-1/chat?limit=10"),
    );
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]?.role).toBe("assistant");
    expect(history.messages[1]?.role).toBe("user");
    expect(history.messages[1]?.question).toBe("What happened recently?");
  });

  test("supports telemetry readout endpoint with limited sources", async () => {
    const tenantId = "bot-chat-2";
    const env = createConversationTestEnv({
      tenantId,
      config: {
        enabled: true,
        strategy: {
          type: "rebalance",
          baseMint: "So11111111111111111111111111111111111111112",
          quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyDTt1v",
          targetBasePct: 0.5,
          thresholdPct: 0.015,
        },
        validation: {
          enabled: false,
          lookbackDays: 45,
          profile: "balanced",
          gateMode: "hard",
          minTrades: 8,
        },
      },
      runtimeState: {
        tenantId,
        lifecycleState: "validated",
        activeStrategyHash: "hash-rb",
        lastValidationId: null,
        consecutiveFailures: 1,
        lastTunedAt: null,
        nextRevalidateAt: "2026-02-14T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      validationRuns: [],
    });

    const telemetry = await handleTelemetry(
      env,
      tenantId,
      new Request(
        "http://localhost/api/bots/bot-chat-2/telemetry?includeSources=runtime&limit=5",
      ),
    );

    expect(telemetry.ok).toBe(true);
    expect(
      Array.isArray(
        (telemetry.telemetry as { strategyDescriptor: unknown })
          .strategyDescriptor,
      ),
    ).toBe(false);
    expect((telemetry.telemetry as { tenantId: string }).tenantId).toBe(
      tenantId,
    );
  });

  test("truncates long messages to enforce open question limit", async () => {
    const tenantId = "bot-chat-3";
    const env = createConversationTestEnv({
      tenantId,
      config: {
        enabled: true,
        strategy: {
          type: "noop",
        },
        validation: {
          enabled: false,
          gateMode: "soft",
        },
      },
      runtimeState: {
        tenantId,
        lifecycleState: "candidate",
        activeStrategyHash: null,
        lastValidationId: null,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: null,
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      validationRuns: [],
    });

    const response = await handleChatRequest(env, tenantId, {
      message: "x".repeat(700),
    });
    const history = await handleChatHistory(
      env,
      tenantId,
      new Request(`http://localhost/api/bots/${tenantId}/chat`),
    );

    expect(response.ok).toBe(true);
    const userMessage = history.messages.find((row) => row.role === "user");
    expect(userMessage).toBeTruthy();
    expect((userMessage?.question ?? "").length).toBe(500);
  });

  test("rejects empty messages", async () => {
    const tenantId = "bot-chat-4";
    const env = createConversationTestEnv({
      tenantId,
      config: {
        enabled: false,
        strategy: { type: "noop" },
      },
      runtimeState: {
        tenantId,
        lifecycleState: "candidate",
        activeStrategyHash: null,
        lastValidationId: null,
        consecutiveFailures: 0,
        lastTunedAt: null,
        nextRevalidateAt: null,
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      validationRuns: [],
    });

    await expect(
      handleChatRequest(env, tenantId, { message: "   " } as never),
    ).rejects.toThrow(/invalid-message/);
  });
});
