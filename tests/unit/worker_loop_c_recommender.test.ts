import { describe, expect, test } from "bun:test";
import { LOOP_B_SCORES_LATEST_KEY } from "../../apps/worker/src/loop_b/minute_accumulator";
import { LOOP_C_CANDIDATE_POOL_LATEST_KEY } from "../../apps/worker/src/loop_c/candidate_pool";
import {
  Recommender,
  requestLoopCRecommendations,
  submitLoopCRecommendationFeedback,
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

function setCandidatePool(store: Map<string, string>, pairId: string): void {
  const [baseMint, quoteMint] = pairId.split(":");
  store.set(
    LOOP_C_CANDIDATE_POOL_LATEST_KEY,
    JSON.stringify({
      schemaVersion: "v1",
      generatedAt: "2026-02-21T20:00:00.000Z",
      minute: "2026-02-21T20:00:00.000Z",
      source: "loopB",
      maxCandidates: 10,
      count: 1,
      rows: [
        {
          schemaVersion: "v1",
          generatedAt: "2026-02-21T20:00:00.000Z",
          minute: "2026-02-21T20:00:00.000Z",
          candidateId: `2026-02-21T20:00:00.000Z:${pairId}`,
          pairId,
          baseMint,
          quoteMint,
          finalScore: 7.7,
          baseSignal: 7.7,
          curiosity: 1.2,
          riskPenalty: 0.4,
          stabilityBonus: 5,
          acceptProbPrior: 0.63,
          featuresRef: `loopB:v1:features:latest:pair:${pairId}`,
          scoreRef: `loopB:v1:scores:latest:pair:${pairId}`,
          evidenceRefs: ["loopA/v1/events/slot=123"],
          revision: 2,
          explain: ["source=loopB", "evidence_refs=1"],
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
        recommendations: Array<{ pairId: string; acceptProb: number }>;
      };
    };
    expect(firstPayload.ok).toBe(true);
    expect(firstPayload.cacheHit).toBe(false);
    expect(firstPayload.view.recommendations.length).toBe(2);
    expect(firstPayload.view.recommendations[0]?.acceptProb).toBeGreaterThan(0);

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
          persona: {
            riskBudget: "low",
          },
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
          observedAt: "2026-02-21T20:01:45.000Z",
          limit: 2,
          persona: {
            riskBudget: "high",
          },
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

    const fourthResponse = await recommender.fetch(
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
    const fourthPayload = (await fourthResponse.json()) as {
      ok: boolean;
      cacheHit: boolean;
      view: {
        recommendations: Array<{ finalScore: number }>;
      };
    };
    expect(fourthPayload.ok).toBe(true);
    expect(fourthPayload.cacheHit).toBe(false);
    expect(fourthPayload.view.recommendations[0]?.finalScore).toBeGreaterThan(
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

  test("helper routes feedback request via loop-c durable object namespace", async () => {
    const { env } = createEnv();
    let called = false;

    env.LOOP_C_RECOMMENDER_DO = {
      idFromName: (name: string) => {
        expect(name).toBe("user-f:wallet-f");
        return { toString: () => "loop-c-id" } as never;
      },
      get: (_id: DurableObjectId) =>
        ({
          fetch: async (url: string, init?: RequestInit) => {
            called = true;
            expect(url).toContain("/loop-c/feedback");
            expect(init?.method).toBe("POST");
            return new Response(
              JSON.stringify({
                ok: true,
                update: {
                  pairId:
                    "So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                  decision: "yes",
                  pair: { yes: 1, no: 0 },
                  global: { yes: 1, no: 0 },
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

    const update = await submitLoopCRecommendationFeedback(env, {
      userId: "user-f",
      wallet: "wallet-f",
      pairId:
        "So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decision: "yes",
    });
    expect(called).toBe(true);
    expect(update?.decision).toBe("yes");
    expect(update?.pair.yes).toBe(1);
  });

  test("uses loop C candidate pool when available", async () => {
    const { env, kvStore } = createEnv();
    setScores(kvStore, 99);
    setCandidatePool(
      kvStore,
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN:So11111111111111111111111111111111111111112",
    );

    const mock = createMockDoState();
    const recommender = new Recommender(mock.state, env, {
      now: () => "2026-02-21T20:11:00.000Z",
    });
    const response = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-candidate",
          wallet: "wallet-candidate",
          observedAt: "2026-02-21T20:11:00.000Z",
          limit: 5,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      cacheHit: boolean;
      view: {
        recommendations: Array<{ pairId: string; finalScore: number }>;
      };
    };

    expect(payload.ok).toBe(true);
    expect(payload.cacheHit).toBe(false);
    expect(payload.view.recommendations.length).toBe(1);
    expect(payload.view.recommendations[0]?.pairId).toBe(
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN:So11111111111111111111111111111111111111112",
    );
    expect(payload.view.recommendations[0]?.finalScore).toBeGreaterThan(7.5);
  });

  test("feedback yes/no updates acceptance probability predictably", async () => {
    const { env, kvStore } = createEnv();
    setScores(kvStore, 7.5);

    const mock = createMockDoState();
    const recommender = new Recommender(mock.state, env, {
      now: () => "2026-02-21T20:20:00.000Z",
    });

    const baselineResponse = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-feedback",
          wallet: "wallet-feedback",
          observedAt: "2026-02-21T20:20:00.000Z",
          limit: 1,
        }),
      }),
    );
    const baselinePayload = (await baselineResponse.json()) as {
      ok: boolean;
      view: {
        recommendations: Array<{ pairId: string; acceptProb: number }>;
      };
    };
    expect(baselinePayload.ok).toBe(true);
    const pairId = baselinePayload.view.recommendations[0]?.pairId ?? "";
    const baselineProb =
      baselinePayload.view.recommendations[0]?.acceptProb ?? 0;
    expect(pairId.length).toBeGreaterThan(0);

    const yesFeedback = await recommender.fetch(
      new Request("https://internal/loop-c/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pairId,
          decision: "yes",
          decidedAt: "2026-02-21T20:20:30.000Z",
        }),
      }),
    );
    expect(yesFeedback.status).toBe(200);

    const yesResponse = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-feedback",
          wallet: "wallet-feedback",
          observedAt: "2026-02-21T20:21:00.000Z",
          limit: 1,
        }),
      }),
    );
    const yesPayload = (await yesResponse.json()) as {
      ok: boolean;
      view: {
        recommendations: Array<{ acceptProb: number }>;
      };
    };
    const yesProb = yesPayload.view.recommendations[0]?.acceptProb ?? 0;
    expect(yesPayload.ok).toBe(true);
    expect(yesProb).toBeGreaterThan(baselineProb);

    const noFeedback = await recommender.fetch(
      new Request("https://internal/loop-c/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pairId,
          decision: "no",
          decidedAt: "2026-02-21T20:21:20.000Z",
        }),
      }),
    );
    expect(noFeedback.status).toBe(200);

    const noResponse = await recommender.fetch(
      new Request("https://internal/loop-c/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-feedback",
          wallet: "wallet-feedback",
          observedAt: "2026-02-21T20:22:00.000Z",
          limit: 1,
        }),
      }),
    );
    const noPayload = (await noResponse.json()) as {
      ok: boolean;
      view: {
        recommendations: Array<{ acceptProb: number }>;
      };
    };
    const noProb = noPayload.view.recommendations[0]?.acceptProb ?? 0;
    expect(noPayload.ok).toBe(true);
    expect(noProb).toBeLessThan(yesProb);
  });
});
