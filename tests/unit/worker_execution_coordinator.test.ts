import { describe, expect, test } from "bun:test";
import type { ExecutionIntent } from "../../apps/worker/src/execution/contracts";
import {
  ExecutionCoordinator,
  type ExecutionCoordinatorDecisionResult,
  requestExecutionCoordinatorDecision,
} from "../../apps/worker/src/execution/coordinator";
import type { Env } from "../../apps/worker/src/types";

function createMockDoState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    state: {
      storage: {
        get: async (key: string) => store.get(key),
        put: async (key: string, value: unknown) => {
          store.set(key, value);
        },
        setAlarm: async (timestamp: number) => {
          alarm = timestamp;
        },
        deleteAlarm: async () => {
          alarm = null;
        },
      },
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    } as unknown as DurableObjectState,
    readAlarm: () => alarm,
  };
}

function intent(input: {
  intentId: string;
  receivedAt: string;
  adapter?: string;
  lane?: "fast" | "protected" | "safe";
}): ExecutionIntent {
  return {
    schemaVersion: "v1",
    intentId: input.intentId,
    receivedAt: input.receivedAt,
    userId: "user-1",
    wallet: "wallet-1",
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amountAtomic: "1000000",
    slippageBps: 50,
    source: "TERMINAL",
    reason: null,
    execution: {
      adapter: input.adapter ?? "jupiter",
      params: input.lane ? { lane: input.lane } : null,
    },
    policy: {
      simulateOnly: false,
      dryRun: false,
      commitment: "confirmed",
    },
  };
}

describe("worker execution coordinator durable object", () => {
  test("accepts inline first intent and returns deterministic decision", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(
      mock.state,
      { EXECUTION_AUCTION_WINDOW_MS: "250" } as Env,
      { now: () => "2026-02-21T20:50:00.000Z" },
    );

    const response = await coordinator.fetch(
      new Request("https://internal/execution/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: intent({
            intentId: "intent-1",
            receivedAt: "2026-02-21T20:49:59.000Z",
          }),
          mode: "inline",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(payload.ok).toBe(true);
    expect(payload.result.accepted).toBe(true);
    expect(payload.result.reason).toBeNull();
    expect(payload.result.decision?.route).toBe("jupiter");
    expect(mock.readAlarm()).not.toBeNull();
  });

  test("queue tick ordering is deterministic by receivedAt then intentId", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(
      mock.state,
      { EXECUTION_AUCTION_WINDOW_MS: "250" } as Env,
      { now: () => "2026-02-21T20:55:00.000Z" },
    );

    const enqueue = async (executionIntent: ExecutionIntent) =>
      await coordinator.fetch(
        new Request("https://internal/execution/intent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: executionIntent,
            mode: "enqueue",
          }),
        }),
      );

    await enqueue(
      intent({
        intentId: "intent-b",
        receivedAt: "2026-02-21T20:54:50.000Z",
      }),
    );
    await enqueue(
      intent({
        intentId: "intent-a",
        receivedAt: "2026-02-21T20:54:50.000Z",
      }),
    );

    const tickResponse = await coordinator.fetch(
      new Request("https://internal/execution/auction/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(tickResponse.status).toBe(200);
    const tickPayload = (await tickResponse.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(tickPayload.ok).toBe(true);
    expect(tickPayload.result.accepted).toBe(true);
    expect(tickPayload.result.decision?.intentId).toBe("intent-a");
    expect(mock.readAlarm()).not.toBeNull();
  });

  test("keeps accepted decision in-flight until ack is received", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(
      mock.state,
      {
        EXECUTION_COORDINATOR_LEASE_MS: "60000",
      } as Env,
      { now: () => "2026-02-21T21:00:00.000Z" },
    );

    const first = await coordinator.fetch(
      new Request("https://internal/execution/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: intent({
            intentId: "intent-inflight",
            receivedAt: "2026-02-21T20:59:59.000Z",
          }),
          mode: "inline",
        }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await coordinator.fetch(
      new Request("https://internal/execution/auction/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(second.status).toBe(200);
    const payload = (await second.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(payload.ok).toBe(true);
    expect(payload.result.accepted).toBe(false);
    expect(payload.result.reason).toBe("inflight-active");
    expect(payload.result.inflightIntentId).toBe("intent-inflight");
    expect(payload.result.leaseExpiresAt).toBeString();
  });

  test("ack clears in-flight decision and allows next queued dispatch", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(mock.state, {} as Env, {
      now: () => "2026-02-21T21:05:00.000Z",
    });
    const enqueue = async (executionIntent: ExecutionIntent) =>
      await coordinator.fetch(
        new Request("https://internal/execution/intent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            intent: executionIntent,
            mode: "enqueue",
          }),
        }),
      );

    await enqueue(
      intent({
        intentId: "intent-ack-1",
        receivedAt: "2026-02-21T21:04:58.000Z",
      }),
    );
    await enqueue(
      intent({
        intentId: "intent-ack-2",
        receivedAt: "2026-02-21T21:04:59.000Z",
      }),
    );

    const firstTick = await coordinator.fetch(
      new Request("https://internal/execution/auction/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const firstPayload = (await firstTick.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(firstPayload.result.accepted).toBe(true);
    expect(firstPayload.result.decision?.intentId).toBe("intent-ack-1");

    const ack = await coordinator.fetch(
      new Request("https://internal/execution/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decisionId: firstPayload.result.decision?.decisionId,
        }),
      }),
    );
    expect(ack.status).toBe(200);

    const secondTick = await coordinator.fetch(
      new Request("https://internal/execution/auction/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const secondPayload = (await secondTick.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(secondPayload.result.accepted).toBe(true);
    expect(secondPayload.result.decision?.intentId).toBe("intent-ack-2");
  });

  test("recovers expired in-flight decision by requeueing deterministically", async () => {
    let now = "2026-02-21T21:10:00.000Z";
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(
      mock.state,
      {
        EXECUTION_COORDINATOR_LEASE_MS: "1000",
      } as Env,
      { now: () => now },
    );

    const first = await coordinator.fetch(
      new Request("https://internal/execution/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: intent({
            intentId: "intent-expire",
            receivedAt: "2026-02-21T21:09:59.000Z",
          }),
          mode: "inline",
        }),
      }),
    );
    const firstPayload = (await first.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(firstPayload.result.accepted).toBe(true);

    now = "2026-02-21T21:10:05.000Z";
    const tick = await coordinator.fetch(
      new Request("https://internal/execution/auction/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const tickPayload = (await tick.json()) as {
      ok: boolean;
      recoveredExpiredInflight?: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(tickPayload.ok).toBe(true);
    expect(tickPayload.recoveredExpiredInflight).toBe(true);
    expect(tickPayload.result.accepted).toBe(true);
    expect(tickPayload.result.decision?.intentId).toBe("intent-expire");
  });

  test("applies lane-specific auction window defaults", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(
      mock.state,
      {
        EXECUTION_AUCTION_WINDOW_SAFE_MS: "900",
        EXECUTION_AUCTION_WINDOW_MS: "250",
      } as Env,
      { now: () => "2026-02-21T21:15:00.000Z" },
    );

    const before = Date.now();
    await coordinator.fetch(
      new Request("https://internal/execution/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: intent({
            intentId: "intent-safe-window",
            receivedAt: "2026-02-21T21:14:59.000Z",
            lane: "safe",
          }),
          mode: "enqueue",
        }),
      }),
    );
    const alarm = mock.readAlarm();
    expect(alarm).not.toBeNull();
    if (alarm === null) return;
    expect(alarm - before).toBeGreaterThanOrEqual(800);
  });

  test("rejects unsupported execution route with clear reason", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(mock.state, {} as Env, {
      now: () => "2026-02-21T21:00:00.000Z",
    });

    const response = await coordinator.fetch(
      new Request("https://internal/execution/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: intent({
            intentId: "intent-x",
            receivedAt: "2026-02-21T20:59:59.000Z",
            adapter: "unsupported_venue",
          }),
          mode: "inline",
        }),
      }),
    );

    const payload = (await response.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.result.accepted).toBe(false);
    expect(payload.result.reason).toBe("unsupported-route:unsupported_venue");
  });

  test("accepts magicblock route for execution decisions", async () => {
    const mock = createMockDoState();
    const coordinator = new ExecutionCoordinator(mock.state, {} as Env, {
      now: () => "2026-02-21T21:05:00.000Z",
    });

    const response = await coordinator.fetch(
      new Request("https://internal/execution/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: intent({
            intentId: "intent-magicblock",
            receivedAt: "2026-02-21T21:04:59.000Z",
            adapter: "magicblock_ephemeral_rollup",
          }),
          mode: "inline",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      result: ExecutionCoordinatorDecisionResult;
    };
    expect(payload.ok).toBe(true);
    expect(payload.result.accepted).toBe(true);
    expect(payload.result.decision?.route).toBe("magicblock_ephemeral_rollup");
  });

  test("helper uses namespace only when coordinator is enabled", async () => {
    const disabled = await requestExecutionCoordinatorDecision(
      { EXECUTION_COORDINATOR_ENABLED: "0" } as Env,
      {
        intent: intent({
          intentId: "intent-disabled",
          receivedAt: "2026-02-21T21:10:00.000Z",
        }),
      },
    );
    expect(disabled).toBeNull();

    const enabledEnv = {
      EXECUTION_COORDINATOR_ENABLED: "1",
      EXECUTION_COORDINATOR_DO: {
        idFromName(name: string) {
          return name as never;
        },
        get(_id: unknown) {
          return {
            fetch: async () =>
              new Response(
                JSON.stringify({
                  ok: true,
                  result: {
                    accepted: true,
                    reason: null,
                    queueDepth: 0,
                    queuePosition: 0,
                    decision: {
                      schemaVersion: "v1",
                      decisionId: "decision-1",
                      intentId: "intent-enabled",
                      decidedAt: "2026-02-21T21:10:01.000Z",
                      route: "jupiter",
                      simulateOnly: false,
                      dryRun: false,
                      commitment: "confirmed",
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
          };
        },
      } as unknown as DurableObjectNamespace,
    } as Env;

    const decision = await requestExecutionCoordinatorDecision(enabledEnv, {
      intent: intent({
        intentId: "intent-enabled",
        receivedAt: "2026-02-21T21:10:00.000Z",
      }),
    });
    expect(decision?.accepted).toBe(true);
    expect(decision?.decision?.route).toBe("jupiter");
  });
});
