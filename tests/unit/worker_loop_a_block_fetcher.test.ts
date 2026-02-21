import { describe, expect, test } from "bun:test";
import {
  buildBlockFetchTargets,
  parseBlockFetchCommitments,
  resolveBlockFetcherConfig,
  runLoopABlockFetcherTick,
} from "../../apps/worker/src/loop_a/block_fetcher";
import type {
  LoopACursor,
  SlotCommitment,
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
    RPC_ENDPOINT: "https://rpc.example",
  } as Env;
  return { env, store };
}

function cursor(
  processed: number,
  confirmed: number,
  finalized: number,
): LoopACursor {
  return {
    schemaVersion: "v1",
    processed,
    confirmed,
    finalized,
    updatedAt: "2026-02-21T03:50:00Z",
  };
}

describe("worker loop A block fetcher", () => {
  test("parses commitment config and resolves defaults", () => {
    expect(parseBlockFetchCommitments(undefined)).toEqual([
      "confirmed",
      "finalized",
    ]);
    expect(parseBlockFetchCommitments("processed,invalid,confirmed")).toEqual([
      "processed",
      "confirmed",
    ]);

    const { env } = createEnv(true);
    const config = resolveBlockFetcherConfig(env);
    expect(config.commitments).toEqual(["confirmed", "finalized"]);
    expect(config.maxConcurrency).toBe(4);
    expect(config.maxRetries).toBe(3);
  });

  test("builds slot targets from cursor delta and max slot cap", () => {
    const targets = buildBlockFetchTargets(
      cursor(10, 20, 30),
      cursor(15, 21, 35),
      ["processed", "finalized"],
      4,
    );

    expect(targets).toEqual([
      { slot: 11, commitment: "processed" },
      { slot: 12, commitment: "processed" },
      { slot: 13, commitment: "processed" },
      { slot: 14, commitment: "processed" },
    ]);
  });

  test("returns no work on cold start cursor", async () => {
    const { env } = createEnv(true);

    const result = await runLoopABlockFetcherTick(
      env,
      {
        cursorBefore: null,
        cursorAfter: cursor(100, 100, 100),
      },
      {
        rpc: {
          getBlock: async () => ({ ok: true }),
        },
      },
    );

    expect(result.targetsTotal).toBe(0);
    expect(result.fetched).toBe(0);
    expect(result.missingTasksEmitted).toBe(0);
  });

  test("fetches with bounded concurrency, retries, and missing task emission", async () => {
    const { env, store } = createEnv(true);

    const attempts = new Map<string, number>();
    let active = 0;
    let maxActive = 0;

    const rpc = {
      getBlock: async (
        slot: number,
        opts?: { commitment?: SlotCommitment },
      ) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const key = `${opts?.commitment ?? "confirmed"}:${slot}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);

        await Promise.resolve();

        try {
          if (slot === 2 && attempt === 1) {
            throw new Error("rpc-http-error: 503 upstream");
          }
          if (slot === 4) {
            return null;
          }
          return { slot, commitment: opts?.commitment ?? "confirmed" };
        } finally {
          active -= 1;
        }
      },
    };

    const result = await runLoopABlockFetcherTick(
      env,
      {
        cursorBefore: cursor(0, 0, 0),
        cursorAfter: cursor(5, 0, 0),
      },
      {
        config: {
          commitments: ["processed"],
          maxConcurrency: 2,
          maxRetries: 2,
          baseBackoffMs: 0,
          maxSlotsPerTick: 100,
        },
        rpc,
      },
    );

    expect(result.targetsTotal).toBe(5);
    expect(result.fetched).toBe(4);
    expect(result.missing).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.missingTasksEmitted).toBe(1);
    expect(result.maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(attempts.get("processed:2")).toBe(2);
    expect(store.has("loopA:v1:block_missing:pending:processed:4")).toBe(true);
  });

  test("emits fetch-failed missing task when retries are exhausted", async () => {
    const { env, store } = createEnv(true);

    const rpc = {
      getBlock: async () => {
        throw new Error("rpc-http-error: 503 overloaded");
      },
    };

    const result = await runLoopABlockFetcherTick(
      env,
      {
        cursorBefore: cursor(0, 0, 0),
        cursorAfter: cursor(1, 0, 0),
      },
      {
        config: {
          commitments: ["processed"],
          maxConcurrency: 1,
          maxRetries: 1,
          baseBackoffMs: 0,
          maxSlotsPerTick: 100,
        },
        rpc,
      },
    );

    expect(result.targetsTotal).toBe(1);
    expect(result.fetched).toBe(0);
    expect(result.missing).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.missingTasksEmitted).toBe(1);

    const raw = store.get("loopA:v1:block_missing:pending:processed:1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.reason).toBe("fetch-failed");
  });
});
