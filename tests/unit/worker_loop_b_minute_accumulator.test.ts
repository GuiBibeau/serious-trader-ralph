import { describe, expect, test } from "bun:test";
import {
  LOOP_B_HEALTH_KEY,
  LOOP_B_LIQUIDITY_STRESS_KEY,
  LOOP_B_MINUTE_ACCUMULATOR_NAME,
  LOOP_B_TOP_MOVERS_KEY,
  MinuteAccumulator,
  publishMarksToMinuteAccumulator,
} from "../../apps/worker/src/loop_b/minute_accumulator";
import type { Env } from "../../apps/worker/src/types";
import type { Mark } from "../../src/loops/contracts/loop_a";

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

function createMockDoState() {
  const store = new Map<string, unknown>();
  let alarmAt: number | null = null;
  return {
    state: {
      storage: {
        get: async (key: string) => store.get(key),
        put: async (key: string, value: unknown) => {
          store.set(key, value);
        },
        setAlarm: async (time: number | Date) => {
          alarmAt = typeof time === "number" ? time : time.getTime();
        },
        getAlarm: async () => alarmAt,
      },
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    } as unknown as DurableObjectState,
    store,
    getAlarm: () => alarmAt,
  };
}

function createMark(input: {
  slot: number;
  ts: string;
  px: string;
  sig: string;
}): Mark {
  return {
    schemaVersion: "v1",
    generatedAt: "2026-02-21T18:00:00.000Z",
    slot: input.slot,
    ts: input.ts,
    baseMint: "So11111111111111111111111111111111111111112",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    px: input.px,
    confidence: 0.8,
    venue: "jupiter",
    evidence: {
      sigs: [input.sig],
      inputs: [`loopA/v1/events/slot=${input.slot}`],
    },
    version: "v1",
  };
}

function createEnv(options?: { withR2?: boolean }): {
  env: Env;
  kvStore: Map<string, string>;
  r2Store: Map<string, string>;
} {
  const { kv, store: kvStore } = createMockKv();
  const { bucket, store: r2Store } = createMockR2();
  return {
    env: {
      WAITLIST_DB: createMockDb() as never,
      CONFIG_KV: kv as never,
      LOGS_BUCKET: options?.withR2 === false ? undefined : (bucket as never),
      LOOP_B_MINUTE_ACCUMULATOR_ENABLED: "1",
    } as Env,
    kvStore,
    r2Store,
  };
}

describe("worker loop B minute accumulator", () => {
  test("ingests marks and publishes finalized views", async () => {
    const { env, kvStore, r2Store } = createEnv();
    const mock = createMockDoState();
    const accumulator = new MinuteAccumulator(mock.state, env, {
      now: () => "2026-02-21T18:02:00.000Z",
    });

    const response = await accumulator.fetch(
      new Request("https://internal/loop-b/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedAt: "2026-02-21T18:02:00.000Z",
          marks: [
            createMark({
              slot: 700,
              ts: "2026-02-21T18:01:20.000Z",
              px: "5.0",
              sig: "sig-a",
            }),
            createMark({
              slot: 701,
              ts: "2026-02-21T18:01:40.000Z",
              px: "5.2",
              sig: "sig-b",
            }),
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      result: {
        marksAccepted: number;
        finalizedMinutes: number;
      };
    };
    expect(payload.ok).toBe(true);
    expect(payload.result.marksAccepted).toBe(2);
    expect(payload.result.finalizedMinutes).toBe(1);
    expect(mock.getAlarm()).not.toBeNull();

    expect(kvStore.has(LOOP_B_TOP_MOVERS_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_LIQUIDITY_STRESS_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_HEALTH_KEY)).toBe(true);
    expect(
      kvStore.has(
        "loopB:v1:scores:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ),
    ).toBe(true);

    expect(r2Store.size).toBeGreaterThan(0);
  });

  test("late correction re-finalizes the minute with updated scores", async () => {
    const { env, kvStore } = createEnv({ withR2: false });
    const mock = createMockDoState();
    const accumulator = new MinuteAccumulator(mock.state, env, {
      now: () => "2026-02-21T18:03:00.000Z",
    });

    await accumulator.fetch(
      new Request("https://internal/loop-b/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedAt: "2026-02-21T18:03:00.000Z",
          marks: [
            createMark({
              slot: 800,
              ts: "2026-02-21T18:02:10.000Z",
              px: "10",
              sig: "sig-c",
            }),
            createMark({
              slot: 801,
              ts: "2026-02-21T18:02:20.000Z",
              px: "11",
              sig: "sig-d",
            }),
          ],
        }),
      }),
    );

    const firstTopMovers = JSON.parse(
      kvStore.get(LOOP_B_TOP_MOVERS_KEY) ?? "{}",
    ) as {
      minute: string;
      movers: Array<{ pctChange: number; revision: number }>;
    };
    expect(firstTopMovers.minute).toBe("2026-02-21T18:02:00.000Z");
    const firstChange = firstTopMovers.movers[0]?.pctChange ?? 0;
    const firstRevision = firstTopMovers.movers[0]?.revision ?? 0;

    await accumulator.fetch(
      new Request("https://internal/loop-b/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedAt: "2026-02-21T18:04:00.000Z",
          marks: [
            createMark({
              slot: 801,
              ts: "2026-02-21T18:02:20.000Z",
              px: "12",
              sig: "sig-d",
            }),
          ],
        }),
      }),
    );

    const secondTopMovers = JSON.parse(
      kvStore.get(LOOP_B_TOP_MOVERS_KEY) ?? "{}",
    ) as {
      minute: string;
      movers: Array<{ pctChange: number; revision: number }>;
    };
    const secondChange = secondTopMovers.movers[0]?.pctChange ?? 0;
    const secondRevision = secondTopMovers.movers[0]?.revision ?? 0;

    expect(secondTopMovers.minute).toBe("2026-02-21T18:02:00.000Z");
    expect(secondChange).toBeGreaterThan(firstChange);
    expect(secondRevision).toBeGreaterThan(firstRevision);
  });

  test("publish helper sends marks into minute accumulator durable object", async () => {
    const { env } = createEnv({ withR2: false });
    let called = false;

    env.LOOP_B_MINUTE_ACCUMULATOR_DO = {
      idFromName: (name: string) => {
        expect(name).toBe(LOOP_B_MINUTE_ACCUMULATOR_NAME);
        return { toString: () => "loop-b-do-id" } as never;
      },
      get: (_id: DurableObjectId) =>
        ({
          fetch: async (url: string, init?: RequestInit) => {
            called = true;
            expect(url).toContain("/loop-b/ingest");
            expect(init?.method).toBe("POST");
            return new Response(
              JSON.stringify({
                ok: true,
                result: {
                  marksReceived: 1,
                  marksAccepted: 1,
                  minutesTouched: 1,
                  finalizedMinutes: 0,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          },
        }) as never,
    } as DurableObjectNamespace;

    const result = await publishMarksToMinuteAccumulator(env, {
      marks: [
        createMark({
          slot: 900,
          ts: "2026-02-21T18:05:01.000Z",
          px: "15",
          sig: "sig-e",
        }),
      ],
      observedAt: "2026-02-21T18:05:10.000Z",
    });

    expect(called).toBe(true);
    expect(result?.marksAccepted).toBe(1);
  });
});
