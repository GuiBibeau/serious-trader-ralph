import { describe, expect, test } from "bun:test";
import { LOOP_B_SCORES_LATEST_KEY } from "../../apps/worker/src/loop_b/minute_accumulator";
import {
  Recommender,
  requestLoopCRecommendations,
} from "../../apps/worker/src/loop_c/recommender";
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
  return {
    state: {
      storage: {
        get: async (key: string) => store.get(key),
        put: async (key: string, value: unknown) => {
          store.set(key, value);
        },
      },
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    } as unknown as DurableObjectState,
    store,
  };
}

function createEnv(): {
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
      LOGS_BUCKET: bucket as never,
      LOOP_C_RECOMMENDER_ENABLED: "1",
      LOOP_C_RECOMMENDER_DEFAULT_LIMIT: "5",
    } as Env,
    kvStore,
    r2Store,
  };
}

function setScores(store: Map<string, string>, rowFinalScore: number): void {
  store.set(
    LOOP_B_SCORES_LATEST_KEY,
    JSON.stringify({
      schemaVersion: "v1",
      generatedAt: "2026-02-21T20:00:00.000Z",
      minute: "2026-02-21T20:00:00.000Z",
      count: 2,
      rows: [
        {
          schemaVersion: "v1",
          generatedAt: "2026-02-21T20:00:00.000Z",
          minute: "2026-02-21T20:00:00.000Z",
          pairId:
            "So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          baseMint: "So11111111111111111111111111111111111111112",
          quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          finalScore: rowFinalScore,
          contributions: {
            momentum: 2.1,
            confidence: 10.1,
            stabilityPenalty: 1.3,
            activity: 1.2,
          },
          featuresRef:
            "loopB:v1:features:latest:pair:So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          revision: 1,
          explain: ["score=momentum+confidence+activity-stability"],
        },
        {
          schemaVersion: "v1",
          generatedAt: "2026-02-21T20:00:00.000Z",
          minute: "2026-02-21T20:00:00.000Z",
          pairId:
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:So11111111111111111111111111111111111111112",
          baseMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          quoteMint: "So11111111111111111111111111111111111111112",
          finalScore: 4.5,
          contributions: {
            momentum: 1.1,
            confidence: 5.5,
            stabilityPenalty: 0.9,
            activity: 0.6,
          },
          featuresRef:
            "loopB:v1:features:latest:pair:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:So11111111111111111111111111111111111111112",
          revision: 1,
          explain: ["score=momentum+confidence+activity-stability"],
        },
      ],
    }),
  );
}

describe("worker loop C recommender durable object", () => {
  test("builds recommendations and caches per minute", async () => {
    const { env, kvStore, r2Store } = createEnv();
    setScores(kvStore, 8.2);

    const mock = createMockDoState();
    const recommender = new Recommender(mock.state, env, {
      now: () => "2026-02-21T20:01:00.000Z",
    });

    const firstResponse = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          wallet: "wallet-1",
          observedAt: "2026-02-21T20:01:00.000Z",
          limit: 2,
          persona: {
            riskBudget: "low",
          },
        }),
      }),
    );

    expect(firstResponse.status).toBe(200);
    const firstPayload = (await firstResponse.json()) as {
      ok: boolean;
      cacheHit: boolean;
      view: {
        recommendations: Array<{ pairId: string }>;
      };
    };
    expect(firstPayload.ok).toBe(true);
    expect(firstPayload.cacheHit).toBe(false);
    expect(firstPayload.view.recommendations.length).toBe(2);

    setScores(kvStore, 15.6);
    const secondResponse = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          wallet: "wallet-1",
          observedAt: "2026-02-21T20:01:30.000Z",
          limit: 2,
        }),
      }),
    );
    const secondPayload = (await secondResponse.json()) as {
      ok: boolean;
      cacheHit: boolean;
      view: {
        recommendations: Array<{ pairId: string; finalScore: number }>;
      };
    };
    expect(secondPayload.ok).toBe(true);
    expect(secondPayload.cacheHit).toBe(true);
    expect(secondPayload.view.recommendations[0]?.finalScore).toBeLessThan(
      15.6,
    );

    const thirdResponse = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-1",
          wallet: "wallet-1",
          observedAt: "2026-02-21T20:02:00.000Z",
          limit: 2,
        }),
      }),
    );
    const thirdPayload = (await thirdResponse.json()) as {
      ok: boolean;
      cacheHit: boolean;
      view: {
        recommendations: Array<{ finalScore: number }>;
      };
    };
    expect(thirdPayload.ok).toBe(true);
    expect(thirdPayload.cacheHit).toBe(false);
    expect(thirdPayload.view.recommendations[0]?.finalScore).toBeGreaterThan(
      10,
    );

    expect(
      kvStore.has("loopC:v1:recs:latest:user:user-1:wallet:wallet-1"),
    ).toBe(true);
    expect(r2Store.size).toBeGreaterThan(0);
  });

  test("helper routes recommendation request via loop-c durable object namespace", async () => {
    const { env } = createEnv();
    let called = false;

    env.LOOP_C_RECOMMENDER_DO = {
      idFromName: (name: string) => {
        expect(name).toBe("user-x:wallet-y");
        return { toString: () => "loop-c-id" } as never;
      },
      get: (_id: DurableObjectId) =>
        ({
          fetch: async (url: string, init?: RequestInit) => {
            called = true;
            expect(url).toContain("/loop-c/recommend");
            expect(init?.method).toBe("POST");
            return new Response(
              JSON.stringify({
                ok: true,
                cacheHit: false,
                view: {
                  schemaVersion: "v1",
                  generatedAt: "2026-02-21T20:10:00.000Z",
                  minute: "2026-02-21T20:10:00.000Z",
                  userId: "user-x",
                  wallet: "wallet-y",
                  freshnessMs: 0,
                  recommendations: [],
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          },
        }) as never,
    } as DurableObjectNamespace;

    const view = await requestLoopCRecommendations(env, {
      userId: "user-x",
      wallet: "wallet-y",
      limit: 3,
    });
    expect(called).toBe(true);
    expect(view?.schemaVersion).toBe("v1");
    expect(view?.wallet).toBe("wallet-y");
  });
});
