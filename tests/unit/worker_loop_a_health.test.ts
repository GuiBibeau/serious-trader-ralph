import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import {
  LOOP_A_HEALTH_KEY,
  LOOP_A_LATENCY_LATEST_KEY,
  loopAHealthR2Key,
  loopALatencyR2Key,
  readLoopAHealthFromKv,
  readLoopALatencyFromKv,
  recordLoopAHealthTick,
} from "../../apps/worker/src/loop_a/health";
import type { LoopAPipelineTickResult } from "../../apps/worker/src/loop_a/pipeline";
import type { LoopACursorState } from "../../apps/worker/src/loop_a/types";
import type { Env } from "../../apps/worker/src/types";

function createMockDb() {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [] }),
            first: async () => null,
          };
        },
      };
    },
  };
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

function createMockR2() {
  const store = new Map<string, string>();
  return {
    store,
    bucket: {
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
      get: async (key: string) => {
        const value = store.get(key);
        if (!value) return null;
        return {
          text: async () => value,
        };
      },
    },
  };
}

function createCursorState(input: {
  head: number;
  state: number;
  updatedAt?: string;
}): LoopACursorState {
  return {
    schemaVersion: "v1",
    updatedAt: input.updatedAt ?? "2026-02-21T12:00:00.000Z",
    headCursor: {
      processed: input.head,
      confirmed: input.head,
      finalized: input.head,
    },
    fetchedCursor: {
      processed: input.head,
      confirmed: input.head,
      finalized: input.head,
    },
    ingestionCursor: {
      processed: input.head,
      confirmed: input.head,
      finalized: input.head,
    },
    stateCursor: {
      processed: input.state,
      confirmed: input.state,
      finalized: input.state,
    },
  };
}

function createTickResult(
  cursorState: LoopACursorState,
  stateAppliedSlot: number | null,
): LoopAPipelineTickResult {
  return {
    cursorState,
    backlog:
      cursorState.headCursor.confirmed > cursorState.stateCursor.confirmed,
    stateCommitment: "confirmed",
    stateTargetSlot: cursorState.ingestionCursor.confirmed,
    stateAppliedSlot,
  };
}

function createEnv(options?: { withKv?: boolean; withR2?: boolean }): {
  env: Env;
  kvStore: Map<string, string>;
  r2Store: Map<string, string>;
} {
  const { kv, store: kvStore } = createMockKv();
  const { bucket, store: r2Store } = createMockR2();
  return {
    env: {
      WAITLIST_DB: createMockDb() as never,
      CONFIG_KV: options?.withKv === false ? undefined : (kv as never),
      LOGS_BUCKET: options?.withR2 === false ? undefined : (bucket as never),
      ALLOWED_ORIGINS: "*",
    } as Env,
    kvStore,
    r2Store,
  };
}

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

describe("worker loop A health + latency telemetry", () => {
  test("records success health and latency artifacts to KV and R2", async () => {
    const { env, kvStore, r2Store } = createEnv();
    const cursorState = createCursorState({ head: 125, state: 124 });
    const observedAt = "2026-02-21T12:01:00.000Z";
    const startedAtMs = Date.parse("2026-02-21T12:00:59.250Z");
    const nowMs = Date.parse("2026-02-21T12:01:00.000Z");

    const result = await recordLoopAHealthTick(env, {
      ok: true,
      trigger: "scheduled",
      startedAtMs,
      nowMs,
      observedAt,
      tickResult: createTickResult(cursorState, 124),
    });

    expect(result).not.toBeNull();
    expect(kvStore.has(LOOP_A_HEALTH_KEY)).toBe(true);
    expect(kvStore.has(LOOP_A_LATENCY_LATEST_KEY)).toBe(true);

    const parsedHealth = await readLoopAHealthFromKv(env);
    expect(parsedHealth?.component).toBe("loopA");
    expect(parsedHealth?.status).toBe("ok");
    expect(parsedHealth?.lastSuccessfulSlot).toBe(124);
    expect(parsedHealth?.errorCount).toBe(0);

    const parsedLatency = await readLoopALatencyFromKv(env);
    expect(parsedLatency?.ok).toBe(true);
    expect(parsedLatency?.tickDurationMs).toBe(750);
    expect(parsedLatency?.trigger).toBe("scheduled");

    expect(r2Store.has(loopAHealthR2Key(observedAt))).toBe(true);
    expect(r2Store.has(loopALatencyR2Key(observedAt))).toBe(true);
  });

  test("records failures without losing the last successful checkpoint", async () => {
    const { env } = createEnv({ withR2: false });
    const successObservedAt = "2026-02-21T12:10:00.000Z";
    const cursorState = createCursorState({ head: 420, state: 418 });

    await recordLoopAHealthTick(env, {
      ok: true,
      trigger: "coordinator_fetch",
      startedAtMs: 1000,
      nowMs: 2000,
      observedAt: successObservedAt,
      tickResult: createTickResult(cursorState, 418),
    });

    await recordLoopAHealthTick(env, {
      ok: false,
      trigger: "coordinator_alarm",
      startedAtMs: 3000,
      nowMs: 4500,
      observedAt: "2026-02-21T12:11:00.000Z",
      cursorStateFallback: createCursorState({ head: 421, state: 418 }),
      error: new Error("rpc-timeout"),
    });

    const health = await readLoopAHealthFromKv(env);
    expect(health?.status).toBe("error");
    expect(health?.errorCount).toBe(1);
    expect(health?.lastSuccessfulSlot).toBe(418);
    expect(health?.lastSuccessfulAt).toBe(successObservedAt);
    expect(health?.lastError).toBe("rpc-timeout");

    const latency = await readLoopALatencyFromKv(env);
    expect(latency?.ok).toBe(false);
    expect(latency?.trigger).toBe("coordinator_alarm");
    expect(latency?.error).toBe("rpc-timeout");
  });

  test("returns null for invalid health/latency KV payloads", async () => {
    const { env, kvStore } = createEnv({ withR2: false });
    kvStore.set(LOOP_A_HEALTH_KEY, JSON.stringify({ ok: true }));
    kvStore.set(LOOP_A_LATENCY_LATEST_KEY, JSON.stringify({ ok: true }));

    const health = await readLoopAHealthFromKv(env);
    const latency = await readLoopALatencyFromKv(env);

    expect(health).toBeNull();
    expect(latency).toBeNull();
  });

  test("api health returns loop-a artifact when available", async () => {
    const { env } = createEnv({ withR2: false });
    env.LOOP_A_SLOT_SOURCE_ENABLED = "1";
    const cursorState = createCursorState({ head: 640, state: 640 });
    await recordLoopAHealthTick(env, {
      ok: true,
      trigger: "scheduled",
      startedAtMs: 1000,
      nowMs: 1100,
      observedAt: "2026-02-21T12:20:00.000Z",
      tickResult: createTickResult(cursorState, 640),
    });

    const response = await worker.fetch(
      new Request("http://localhost/api/health", { method: "GET" }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      loopA: {
        component: "loopA",
        status: "ok",
        lastSuccessfulSlot: 640,
      },
    });
  });

  test("api health ignores stale loop-a errors when slot source is disabled", async () => {
    const { env } = createEnv({ withR2: false });
    await recordLoopAHealthTick(env, {
      ok: false,
      trigger: "scheduled",
      startedAtMs: 1000,
      nowMs: 1300,
      observedAt: "2026-02-21T12:30:00.000Z",
      cursorStateFallback: createCursorState({ head: 900, state: 640 }),
      error: new Error("loop-a-slot-source-disabled"),
    });

    env.LOOP_A_SLOT_SOURCE_ENABLED = "0";

    const response = await worker.fetch(
      new Request("http://localhost/api/health", { method: "GET" }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
