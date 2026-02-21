import { describe, expect, test } from "bun:test";
import { runLoopABackfillResolverTick } from "../../apps/worker/src/loop_a/backfill_resolver";
import {
  loopAEventBatchKey,
  parseLoopAEventBatch,
} from "../../apps/worker/src/loop_a/canonical_state";
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
      list: async (opts: { prefix?: string; limit?: number }) => {
        const prefix = opts.prefix ?? "";
        const limit = opts.limit ?? 1000;
        const keys = [...store.keys()]
          .filter((key) => key.startsWith(prefix))
          .slice(0, limit)
          .map((name) => ({ name }));
        return {
          keys,
          list_complete: true,
          cursor: "",
        };
      },
    },
  };
}

function createEnv(): { env: Env; store: Map<string, string> } {
  const { kv, store } = createMockKv();
  return {
    env: {
      WAITLIST_DB: createMockDb() as never,
      CONFIG_KV: kv as never,
      RPC_ENDPOINT: "https://rpc.example",
    } as Env,
    store,
  };
}

describe("worker loop A backfill resolver", () => {
  test("resolves range backfill tasks and persists empty marker batches", async () => {
    const { env, store } = createEnv();
    store.set(
      "loopA:v1:backfill:pending:confirmed:100-101",
      JSON.stringify({
        schemaVersion: "v1",
        commitment: "confirmed",
        fromSlot: 100,
        toSlot: 101,
        detectedAt: "2026-02-21T04:00:00.000Z",
        status: "pending",
      }),
    );

    const result = await runLoopABackfillResolverTick(env, {
      config: {
        maxTasksPerTick: 4,
        maxSlotsPerTask: 10,
        maxTotalSlotsPerTick: 10,
      },
      rpc: {
        getBlock: async (slot: number) => {
          if (slot === 100) return { transactions: [] };
          if (slot === 101) return null;
          return { transactions: [] };
        },
      },
    });

    expect(result.tasksScanned).toBe(1);
    expect(result.tasksResolved).toBe(1);
    expect(result.slotsResolved).toBe(2);
    expect(result.batchesWritten).toBe(2);
    expect(store.has("loopA:v1:backfill:pending:confirmed:100-101")).toBe(
      false,
    );

    const batch100 = parseLoopAEventBatch(
      JSON.parse(store.get(loopAEventBatchKey("confirmed", 100)) ?? "null"),
    );
    const batch101 = parseLoopAEventBatch(
      JSON.parse(store.get(loopAEventBatchKey("confirmed", 101)) ?? "null"),
    );

    expect(batch100?.events.length).toBe(0);
    expect(batch100?.marker).toBeUndefined();
    expect(batch101?.marker?.kind).toBe("empty_batch");
    expect(batch101?.marker?.reason).toBe("skipped");
  });

  test("converts rpc-missing task into empty marker and clears task", async () => {
    const { env, store } = createEnv();
    store.set(
      "loopA:v1:block_missing:pending:confirmed:222",
      JSON.stringify({
        schemaVersion: "v1",
        commitment: "confirmed",
        slot: 222,
        detectedAt: "2026-02-21T04:01:00.000Z",
        status: "pending",
        reason: "rpc-missing",
      }),
    );

    const result = await runLoopABackfillResolverTick(env, {
      config: {
        maxTasksPerTick: 4,
        maxSlotsPerTask: 10,
        maxTotalSlotsPerTick: 10,
      },
      rpc: {
        getBlock: async () => {
          throw new Error("should-not-be-called");
        },
      },
    });

    expect(result.tasksResolved).toBe(1);
    expect(result.batchesWritten).toBe(1);
    expect(store.has("loopA:v1:block_missing:pending:confirmed:222")).toBe(
      false,
    );

    const batch = parseLoopAEventBatch(
      JSON.parse(store.get(loopAEventBatchKey("confirmed", 222)) ?? "null"),
    );
    expect(batch?.marker?.reason).toBe("missing_in_storage");
  });

  test("retains unresolved task on hard rpc failure", async () => {
    const { env, store } = createEnv();
    const taskKey = "loopA:v1:backfill:pending:confirmed:333-333";
    store.set(
      taskKey,
      JSON.stringify({
        schemaVersion: "v1",
        commitment: "confirmed",
        fromSlot: 333,
        toSlot: 333,
        detectedAt: "2026-02-21T04:02:00.000Z",
        status: "pending",
      }),
    );

    const result = await runLoopABackfillResolverTick(env, {
      config: {
        maxTasksPerTick: 4,
        maxSlotsPerTask: 10,
        maxTotalSlotsPerTick: 10,
      },
      rpc: {
        getBlock: async () => {
          throw new Error("rpc-http-error: 503 overloaded");
        },
      },
    });

    expect(result.tasksResolved).toBe(0);
    expect(result.tasksRetained).toBe(1);
    expect(result.hardFailures).toBe(1);
    expect(store.has(taskKey)).toBe(true);
    expect(store.has(loopAEventBatchKey("confirmed", 333))).toBe(false);
  });
});
