import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import { recordLoopAHealthTick } from "../../apps/worker/src/loop_a/health";
import type { Env } from "../../apps/worker/src/types";

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
      list: async () => ({
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      }),
    },
  };
}

describe("worker x402 exec health route", () => {
  test("returns lane availability from routing config", async () => {
    const env = {
      ALLOWED_ORIGINS: "*",
    } as Env;
    const response = await worker.fetch(
      new Request("https://dev.api.trader-ralph.com/api/x402/exec/health"),
      env,
      createExecutionContextStub(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(typeof payload.now).toBe("string");
    expect(payload.lanes).toBeDefined();
    const lanes = payload.lanes as Record<string, Record<string, unknown>>;
    expect(lanes.fast?.enabled).toBe(true);
    expect(lanes.protected?.enabled).toBe(true);
    expect(lanes.safe?.enabled).toBe(true);
    expect(typeof lanes.fast?.adapter).toBe("string");
  });

  test("reflects env-disabled lanes", async () => {
    const env = {
      ALLOWED_ORIGINS: "*",
      EXEC_LANE_FAST_ENABLED: "false",
      EXEC_LANE_PROTECTED_ENABLED: "0",
      EXEC_LANE_SAFE_ENABLED: "off",
    } as Env;
    const response = await worker.fetch(
      new Request("https://dev.api.trader-ralph.com/api/x402/exec/health"),
      env,
      createExecutionContextStub(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    const lanes = payload.lanes as Record<string, Record<string, unknown>>;
    expect(lanes.fast?.enabled).toBe(false);
    expect(lanes.protected?.enabled).toBe(false);
    expect(lanes.safe?.enabled).toBe(false);
  });

  test("suppresses stale loop-a artifacts when slot source is disabled", async () => {
    const { kv } = createMockKv();
    const env = {
      ALLOWED_ORIGINS: "*",
      CONFIG_KV: kv as never,
      LOOP_A_SLOT_SOURCE_ENABLED: "0",
    } as Env;

    await recordLoopAHealthTick(env, {
      ok: false,
      trigger: "scheduled",
      startedAtMs: 1000,
      nowMs: 1400,
      observedAt: "2026-02-21T13:00:00.000Z",
      cursorStateFallback: {
        schemaVersion: "v1",
        updatedAt: "2026-02-21T13:00:00.000Z",
        headCursor: {
          processed: 100,
          confirmed: 100,
          finalized: 100,
        },
        fetchedCursor: {
          processed: 100,
          confirmed: 100,
          finalized: 100,
        },
        ingestionCursor: {
          processed: 100,
          confirmed: 100,
          finalized: 100,
        },
        stateCursor: {
          processed: 90,
          confirmed: 90,
          finalized: 90,
        },
      },
      error: new Error("loop-a-slot-source-disabled"),
    });

    const response = await worker.fetch(
      new Request("https://dev.api.trader-ralph.com/api/x402/exec/health"),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.loopA).toBeNull();
  });
});
