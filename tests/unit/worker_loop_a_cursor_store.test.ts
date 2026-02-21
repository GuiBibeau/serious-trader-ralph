import { describe, expect, test } from "bun:test";
import {
  emitBackfillTasksToKv,
  loopABackfillTaskKey,
  readLoopACursorFromKv,
  writeLoopACursorToKv,
} from "../../apps/worker/src/loop_a/cursor_store_kv";
import type {
  BackfillTask,
  LoopACursor,
} from "../../apps/worker/src/loop_a/types";
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
    },
  };
}

function createEnv(withKv = true): { env: Env; store: Map<string, string> } {
  const { kv, store } = createMockKv();
  const env = {
    WAITLIST_DB: createMockDb() as never,
    CONFIG_KV: withKv ? (kv as never) : undefined,
  } as Env;
  return { env, store };
}

describe("worker loop A cursor store", () => {
  test("returns null when cursor key is missing", async () => {
    const { env } = createEnv(true);
    const cursor = await readLoopACursorFromKv(env);
    expect(cursor).toBeNull();
  });

  test("writes and reads cursor payload", async () => {
    const { env } = createEnv(true);
    const cursor: LoopACursor = {
      schemaVersion: "v1",
      processed: 100,
      confirmed: 99,
      finalized: 98,
      updatedAt: "2026-02-21T03:00:00Z",
    };

    const wrote = await writeLoopACursorToKv(env, cursor);
    expect(wrote).toBe(true);

    const loaded = await readLoopACursorFromKv(env);
    expect(loaded).toEqual(cursor);
  });

  test("emits idempotent backfill task keys", async () => {
    const { env, store } = createEnv(true);
    const task: BackfillTask = {
      schemaVersion: "v1",
      commitment: "confirmed",
      fromSlot: 101,
      toSlot: 120,
      detectedAt: "2026-02-21T03:00:00Z",
      status: "pending",
    };

    const key = loopABackfillTaskKey(task);
    expect(key).toBe("loopA:v1:backfill:pending:confirmed:101-120");

    await emitBackfillTasksToKv(env, [task]);
    await emitBackfillTasksToKv(env, [task]);

    expect(store.size).toBe(1);
    expect(store.has(key)).toBe(true);
  });

  test("gracefully no-ops when CONFIG_KV is missing", async () => {
    const { env } = createEnv(false);
    const wrote = await writeLoopACursorToKv(env, {
      schemaVersion: "v1",
      processed: 1,
      confirmed: 1,
      finalized: 1,
      updatedAt: "2026-02-21T03:00:00Z",
    });

    expect(wrote).toBe(false);
    expect(await readLoopACursorFromKv(env)).toBeNull();
    expect(await emitBackfillTasksToKv(env, [])).toBe(0);
  });
});
