import { describe, expect, test } from "bun:test";
import type { Env } from "../../apps/worker/src/types";

const waitlistDbStub = {
  prepare() {
    return {
      bind() {
        return {
          async first() {
            return null;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    };
  },
} as unknown as D1Database;

const env = {
  ALLOWED_ORIGINS: "*",
  WAITLIST_DB: waitlistDbStub,
} as Env;

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

async function expectAuthDenied(response: Response): Promise<void> {
  expect([401, 403]).toContain(response.status);
  await expect(response.json()).resolves.toMatchObject({
    ok: false,
    error: expect.any(String),
  });
}

async function loadWorker() {
  const module = (await import(
    `../../apps/worker/src/index?cutover=${Date.now()}-${Math.random()}`
  )) as typeof import("../../apps/worker/src/index");
  return module.default;
}

describe("worker botless cutover routes", () => {
  test("health endpoint remains unchanged", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("http://localhost/api/health", { method: "GET" }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("removed bot/admin/runtime endpoints return 410", async () => {
    const worker = await loadWorker();
    const cases: Array<{ method: string; path: string }> = [
      { method: "GET", path: "/api/bots" },
      { method: "GET", path: "/api/bots/bot-1" },
      { method: "POST", path: "/api/bots/bot-1/start" },
      { method: "POST", path: "/api/admin/bots/bot-1/start" },
      { method: "GET", path: "/api/loop/status" },
      { method: "POST", path: "/api/loop/start" },
      { method: "POST", path: "/api/loop/stop" },
      { method: "POST", path: "/api/loop/tick" },
      { method: "POST", path: "/api/config" },
      { method: "GET", path: "/api/trades" },
    ];

    for (const item of cases) {
      const response = await worker.fetch(
        new Request(`http://localhost${item.path}`, { method: item.method }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: "bot-runtime-removed",
      });
    }
  });

  test("account wallet routes enforce auth", async () => {
    const worker = await loadWorker();
    const authEnv = {
      ...env,
      PRIVY_APP_ID: "app_test",
    } as Env;

    const meResponse = await worker.fetch(
      new Request("http://localhost/api/me", { method: "GET" }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(meResponse);

    const balanceResponse = await worker.fetch(
      new Request("http://localhost/api/wallet/balance", { method: "GET" }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(balanceResponse);

    const onboardingResponse = await worker.fetch(
      new Request("http://localhost/api/onboarding/complete", {
        method: "PUT",
      }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(onboardingResponse);

    const experienceLevelResponse = await worker.fetch(
      new Request("http://localhost/api/me/experience-level", {
        method: "PATCH",
      }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(experienceLevelResponse);

    const eventsResponse = await worker.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
      }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(eventsResponse);

    const recommendationsLatestResponse = await worker.fetch(
      new Request("http://localhost/api/recommendations/latest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: "wallet-1" }),
      }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(recommendationsLatestResponse);

    const recommendationsFeedbackResponse = await worker.fetch(
      new Request("http://localhost/api/recommendations/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recommendationId: "2026-02-21T20:00:00.000Z:SOL:USDC",
          decision: "yes",
        }),
      }),
      authEnv,
      createExecutionContextStub(),
    );
    await expectAuthDenied(recommendationsFeedbackResponse);
  });
});
