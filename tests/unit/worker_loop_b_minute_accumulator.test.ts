import { describe, expect, test } from "bun:test";
import {
  LOOP_B_ANOMALY_FEED_KEY,
  LOOP_B_FEATURES_LATEST_KEY,
  LOOP_B_HEALTH_KEY,
  LOOP_B_LIQUIDITY_STRESS_KEY,
  LOOP_B_MINUTE_ACCUMULATOR_NAME,
  LOOP_B_SCORES_LATEST_KEY,
  LOOP_B_TOP_MOVERS_KEY,
  MinuteAccumulator,
  publishMarksToMinuteAccumulator,
} from "../../apps/worker/src/loop_b/minute_accumulator";
import { LOOP_C_CANDIDATE_POOL_LATEST_KEY } from "../../apps/worker/src/loop_c/candidate_pool";
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
  baseMint?: string;
  quoteMint?: string;
  confidence?: number;
  inputRef?: string;
}): Mark {
  return {
    schemaVersion: "v1",
    generatedAt: "2026-02-21T18:00:00.000Z",
    slot: input.slot,
    ts: input.ts,
    baseMint: input.baseMint ?? "So11111111111111111111111111111111111111112",
    quoteMint:
      input.quoteMint ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    px: input.px,
    confidence: input.confidence ?? 0.8,
    venue: "jupiter",
    evidence: {
      sigs: [input.sig],
      inputs: [input.inputRef ?? `loopA/v1/events/slot=${input.slot}`],
    },
    version: "v1",
  };
}

function createEnv(options?: {
  withR2?: boolean;
  candidatePoolLimit?: number;
}): {
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
      LOOP_C_CANDIDATE_POOL_LIMIT: String(options?.candidatePoolLimit ?? 24),
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
            createMark({
              slot: 702,
              ts: "2026-02-21T18:01:45.000Z",
              px: "160",
              sig: "sig-c",
              baseMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              quoteMint: "So11111111111111111111111111111111111111112",
              confidence: 0.7,
              inputRef: "loopA/v1/events/slot=702#sig=sig-c",
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
    expect(payload.result.marksAccepted).toBe(3);
    expect(payload.result.finalizedMinutes).toBe(1);
    expect(mock.getAlarm()).not.toBeNull();

    expect(kvStore.has(LOOP_B_TOP_MOVERS_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_LIQUIDITY_STRESS_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_ANOMALY_FEED_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_FEATURES_LATEST_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_SCORES_LATEST_KEY)).toBe(true);
    expect(kvStore.has(LOOP_B_HEALTH_KEY)).toBe(true);
    expect(kvStore.has(LOOP_C_CANDIDATE_POOL_LATEST_KEY)).toBe(true);
    expect(
      kvStore.has(
        "loopB:v1:scores:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ),
    ).toBe(true);
    expect(
      kvStore.has(
        "loopB:v1:features:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ),
    ).toBe(true);

    const featureSet = JSON.parse(
      kvStore.get(LOOP_B_FEATURES_LATEST_KEY) ?? "{}",
    ) as {
      rows: Array<{
        pairId: string;
        slotRange: { fromSlot: number; toSlot: number };
        inputRefs: string[];
      }>;
    };
    expect(featureSet.rows.length).toBe(2);
    expect(
      (featureSet.rows[0]?.pairId ?? "") < (featureSet.rows[1]?.pairId ?? ""),
    ).toBe(true);
    const solUsdc = featureSet.rows.find((row) =>
      row.pairId.startsWith("So11111111111111111111111111111111111111112:"),
    );
    expect(solUsdc?.slotRange).toEqual({
      fromSlot: 700,
      toSlot: 701,
    });
    expect(solUsdc?.inputRefs).toEqual([
      "loopA/v1/events/slot=700",
      "loopA/v1/events/slot=701",
    ]);
    const scoreSet = JSON.parse(
      kvStore.get(LOOP_B_SCORES_LATEST_KEY) ?? "{}",
    ) as {
      rows: Array<{
        pairId: string;
        finalScore: number;
        contributions: {
          momentum: number;
          confidence: number;
          stabilityPenalty: number;
          activity: number;
        };
        explain: string[];
      }>;
    };
    expect(scoreSet.rows.length).toBe(2);
    expect(scoreSet.rows[0]?.finalScore).toBeGreaterThan(0);
    expect(scoreSet.rows[0]?.contributions.confidence).toBeGreaterThan(0);
    expect(scoreSet.rows[0]?.explain[0]).toContain("score=momentum");
    const candidatePool = JSON.parse(
      kvStore.get(LOOP_C_CANDIDATE_POOL_LATEST_KEY) ?? "{}",
    ) as {
      rows: Array<{
        pairId: string;
        evidenceRefs: string[];
        featuresRef: string;
        scoreRef: string;
      }>;
    };
    expect(candidatePool.rows.length).toBe(2);
    expect(candidatePool.rows[0]?.evidenceRefs.length).toBeGreaterThan(0);
    expect(candidatePool.rows[0]?.featuresRef).toContain("loopB:v1:features");
    expect(candidatePool.rows[0]?.scoreRef).toContain("loopB:v1:scores");
    const topMoversView = JSON.parse(
      kvStore.get(LOOP_B_TOP_MOVERS_KEY) ?? "{}",
    ) as {
      freshnessMs: number;
    };
    const liquidityStressView = JSON.parse(
      kvStore.get(LOOP_B_LIQUIDITY_STRESS_KEY) ?? "{}",
    ) as {
      freshnessMs: number;
    };
    const anomalyFeedView = JSON.parse(
      kvStore.get(LOOP_B_ANOMALY_FEED_KEY) ?? "{}",
    ) as {
      freshnessMs: number;
      anomalies: Array<{
        anomalyScore: number;
        reasonTags: string[];
      }>;
    };
    expect(topMoversView.freshnessMs).toBe(60000);
    expect(liquidityStressView.freshnessMs).toBe(60000);
    expect(anomalyFeedView.freshnessMs).toBe(60000);
    expect(anomalyFeedView.anomalies[0]?.anomalyScore).toBeGreaterThan(0);
    expect(anomalyFeedView.anomalies[0]?.reasonTags.length).toBeGreaterThan(0);

    expect(r2Store.size).toBeGreaterThan(0);
    expect(
      [...r2Store.keys()].some((key) => key.includes("/views/date=")),
    ).toBe(true);
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
    const firstFeatureRow = JSON.parse(
      kvStore.get(
        "loopB:v1:features:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ) ?? "{}",
    ) as {
      returnPct: number;
      revision: number;
    };
    const firstScoreRow = JSON.parse(
      kvStore.get(
        "loopB:v1:scores:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ) ?? "{}",
    ) as {
      finalScore: number;
      revision: number;
      contributions: {
        momentum: number;
      };
    };

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
    const secondFeatureRow = JSON.parse(
      kvStore.get(
        "loopB:v1:features:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ) ?? "{}",
    ) as {
      returnPct: number;
      revision: number;
    };
    const secondScoreRow = JSON.parse(
      kvStore.get(
        "loopB:v1:scores:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ) ?? "{}",
    ) as {
      finalScore: number;
      revision: number;
      contributions: {
        momentum: number;
      };
    };

    expect(secondTopMovers.minute).toBe("2026-02-21T18:02:00.000Z");
    expect(secondChange).toBeGreaterThan(firstChange);
    expect(secondRevision).toBeGreaterThan(firstRevision);
    expect(secondFeatureRow.returnPct).toBeGreaterThan(
      firstFeatureRow.returnPct,
    );
    expect(secondFeatureRow.revision).toBeGreaterThan(firstFeatureRow.revision);
    expect(secondScoreRow.finalScore).toBeGreaterThan(firstScoreRow.finalScore);
    expect(secondScoreRow.revision).toBeGreaterThan(firstScoreRow.revision);
    expect(secondScoreRow.contributions.momentum).toBeGreaterThan(
      firstScoreRow.contributions.momentum,
    );
  });

  test("candidate pool is bounded by configured limit", async () => {
    const { env, kvStore } = createEnv({
      withR2: false,
      candidatePoolLimit: 1,
    });
    const mock = createMockDoState();
    const accumulator = new MinuteAccumulator(mock.state, env, {
      now: () => "2026-02-21T18:10:00.000Z",
    });

    await accumulator.fetch(
      new Request("https://internal/loop-b/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observedAt: "2026-02-21T18:10:00.000Z",
          marks: [
            createMark({
              slot: 910,
              ts: "2026-02-21T18:09:15.000Z",
              px: "20",
              sig: "sig-aa",
            }),
            createMark({
              slot: 911,
              ts: "2026-02-21T18:09:25.000Z",
              px: "21",
              sig: "sig-ab",
            }),
            createMark({
              slot: 912,
              ts: "2026-02-21T18:09:20.000Z",
              px: "150",
              sig: "sig-ac",
              baseMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              quoteMint: "So11111111111111111111111111111111111111112",
            }),
          ],
        }),
      }),
    );

    const candidatePool = JSON.parse(
      kvStore.get(LOOP_C_CANDIDATE_POOL_LATEST_KEY) ?? "{}",
    ) as {
      maxCandidates: number;
      count: number;
      rows: Array<{ pairId: string; evidenceRefs: string[] }>;
    };

    expect(candidatePool.maxCandidates).toBe(1);
    expect(candidatePool.count).toBe(1);
    expect(candidatePool.rows.length).toBe(1);
    expect(candidatePool.rows[0]?.evidenceRefs.length).toBeGreaterThan(0);
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
