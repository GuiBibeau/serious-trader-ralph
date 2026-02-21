import { afterEach, describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import { readLoopACursorFromKv } from "../../apps/worker/src/loop_a/cursor_store_kv";
import {
  parseBackfillCommitments,
  runLoopASlotSourceTick,
} from "../../apps/worker/src/loop_a/slot_source";
import type { SlotCommitment } from "../../apps/worker/src/loop_a/types";
import type { Env } from "../../apps/worker/src/types";

const originalFetch = globalThis.fetch;

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
    },
  };
}

function createEnv(withKv = true): {
  env: Env;
  store: Map<string, string>;
} {
  const { kv, store } = createMockKv();
  const env = {
    WAITLIST_DB: createMockDb() as never,
    CONFIG_KV: withKv ? (kv as never) : undefined,
    RPC_ENDPOINT: "https://rpc.example",
    LOOP_A_SLOT_SOURCE_ENABLED: "1",
  } as Env;

  return { env, store };
}

function createRpc(heads: Record<SlotCommitment, number>) {
  return {
    getSlot: async (commitment?: SlotCommitment) => {
      if (!commitment) return heads.confirmed;
      return heads[commitment];
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("worker loop A slot source", () => {
  test("parses backfill commitment config with defaults", () => {
    expect(parseBackfillCommitments(undefined)).toEqual([
      "confirmed",
      "finalized",
    ]);
    expect(parseBackfillCommitments("processed,confirmed,invalid")).toEqual([
      "processed",
      "confirmed",
    ]);
  });

  test("bootstraps cursor on first run without gap blast", async () => {
    const { env, store } = createEnv(true);

    const result = await runLoopASlotSourceTick(env, {
      observedAt: "2026-02-21T03:05:00Z",
      rpc: createRpc({ processed: 220, confirmed: 218, finalized: 216 }),
    });

    expect(result.cursorBefore).toBeNull();
    expect(result.cursorAfter.processed).toBe(220);
    expect(result.cursorAfter.confirmed).toBe(218);
    expect(result.cursorAfter.finalized).toBe(216);
    expect(result.tasksEmitted).toBe(0);

    const keys = [...store.keys()];
    expect(keys).toContain("loopA:v1:cursor");
    expect(keys.some((key) => key.includes(":backfill:pending:"))).toBe(false);
  });

  test("advances cursor and emits gap tasks for configured commitments", async () => {
    const { env, store } = createEnv(true);

    await runLoopASlotSourceTick(env, {
      observedAt: "2026-02-21T03:10:00Z",
      rpc: createRpc({ processed: 100, confirmed: 90, finalized: 80 }),
    });

    const result = await runLoopASlotSourceTick(env, {
      observedAt: "2026-02-21T03:11:00Z",
      rpc: createRpc({ processed: 110, confirmed: 95, finalized: 83 }),
    });

    expect(result.cursorAfter.processed).toBe(110);
    expect(result.cursorAfter.confirmed).toBe(95);
    expect(result.cursorAfter.finalized).toBe(83);
    expect(result.tasksEmitted).toBe(2);

    expect(store.has("loopA:v1:backfill:pending:confirmed:91-94")).toBe(true);
    expect(store.has("loopA:v1:backfill:pending:finalized:81-82")).toBe(true);
    expect(store.has("loopA:v1:backfill:pending:processed:101-109")).toBe(
      false,
    );
  });

  test("never regresses cursor when rpc heads move backward", async () => {
    const { env } = createEnv(true);

    await runLoopASlotSourceTick(env, {
      observedAt: "2026-02-21T03:20:00Z",
      rpc: createRpc({ processed: 500, confirmed: 498, finalized: 496 }),
    });

    const result = await runLoopASlotSourceTick(env, {
      observedAt: "2026-02-21T03:21:00Z",
      rpc: createRpc({ processed: 490, confirmed: 489, finalized: 488 }),
    });

    expect(result.cursorAfter.processed).toBe(500);
    expect(result.cursorAfter.confirmed).toBe(498);
    expect(result.cursorAfter.finalized).toBe(496);
    expect(result.tasksEmitted).toBe(0);
  });

  test("scheduled no-ops when LOOP_A_SLOT_SOURCE_ENABLED is not 1", async () => {
    const { env } = createEnv(true);
    env.LOOP_A_SLOT_SOURCE_ENABLED = "0";

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("should-not-be-called");
    }) as typeof fetch;

    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    expect(fetchCalls).toBe(0);
  });

  test("scheduled handles missing CONFIG_KV without throwing", async () => {
    const { env } = createEnv(false);
    env.LOOP_A_SLOT_SOURCE_ENABLED = "1";

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("should-not-be-called");
    }) as typeof fetch;

    await worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    expect(fetchCalls).toBe(0);
    const cursor = await readLoopACursorFromKv(env);
    expect(cursor).toBeNull();
  });
});
