import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import type { Env } from "../../apps/worker/src/types";

const env = {
  ALLOWED_ORIGINS: "*",
} as Env;

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

describe("worker botless cutover routes", () => {
  test("health endpoint remains unchanged", async () => {
    const response = await worker.fetch(
      new Request("http://localhost/api/health", { method: "GET" }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("removed bot/admin/runtime endpoints return 410", async () => {
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
    const authEnv = {
      ...env,
      PRIVY_APP_ID: "app_test",
    } as Env;

    const meResponse = await worker.fetch(
      new Request("http://localhost/api/me", { method: "GET" }),
      authEnv,
      createExecutionContextStub(),
    );
    expect(meResponse.status).toBe(401);
    await expect(meResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });

    const balanceResponse = await worker.fetch(
      new Request("http://localhost/api/wallet/balance", { method: "GET" }),
      authEnv,
      createExecutionContextStub(),
    );
    expect(balanceResponse.status).toBe(401);
    await expect(balanceResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });

    const onboardingResponse = await worker.fetch(
      new Request("http://localhost/api/onboarding/complete", {
        method: "PUT",
      }),
      authEnv,
      createExecutionContextStub(),
    );
    expect(onboardingResponse.status).toBe(401);
    await expect(onboardingResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });

    const experienceLevelResponse = await worker.fetch(
      new Request("http://localhost/api/me/experience-level", {
        method: "PATCH",
      }),
      authEnv,
      createExecutionContextStub(),
    );
    expect(experienceLevelResponse.status).toBe(401);
    await expect(experienceLevelResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });

    const eventsResponse = await worker.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
      }),
      authEnv,
      createExecutionContextStub(),
    );
    expect(eventsResponse.status).toBe(401);
    await expect(eventsResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });
  });
});
