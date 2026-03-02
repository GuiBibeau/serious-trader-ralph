import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import type { Env } from "../../apps/worker/src/types";

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

type StatementResult = {
  first?: () => Promise<unknown>;
  run?: () => Promise<unknown>;
};

function createMockDb(): D1Database {
  return {
    prepare(_query: string) {
      return {
        bind(..._params: unknown[]) {
          const result: StatementResult = {
            first: async () => null,
            run: async () => ({ success: true }),
          };
          return result as unknown as D1PreparedStatement;
        },
      } as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function createEnv(overrides?: Partial<Env>): Env {
  return {
    ALLOWED_ORIGINS: "*",
    WAITLIST_DB: createMockDb(),
    ...overrides,
  } as Env;
}

describe("worker waitlist auth", () => {
  test("returns 503 when WAITLIST_WRITE_TOKEN is not configured", async () => {
    const env = createEnv();
    const response = await worker.fetch(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          source: "test",
        }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "waitlist-auth-not-configured",
    });
  });

  test("returns 401 when bearer token is missing or invalid", async () => {
    const env = createEnv({ WAITLIST_WRITE_TOKEN: "secret-token" });
    const response = await worker.fetch(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          source: "test",
        }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "auth-required",
    });
  });

  test("accepts authenticated waitlist writes", async () => {
    const env = createEnv({ WAITLIST_WRITE_TOKEN: "secret-token" });
    const response = await worker.fetch(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret-token",
        },
        body: JSON.stringify({
          email: "user@example.com",
          source: "test",
        }),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      email: "user@example.com",
    });
  });
});
