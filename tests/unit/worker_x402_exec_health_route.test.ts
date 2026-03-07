import { describe, expect, test } from "bun:test";
import worker from "../../apps/worker/src/index";
import type { Env } from "../../apps/worker/src/types";

function createExecutionContextStub(): ExecutionContext {
  return {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  } as ExecutionContext;
}

describe("worker x402 exec health route", () => {
  test("returns lane availability from routing config", async () => {
    const env = {
      ALLOWED_ORIGINS: "*",
    } as Env;
    const response = await worker.fetch(
      new Request("https://dev.api.trader-ralph.com/api/x402/exec/health"),
      env,
      createExecutionContextStub(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(typeof payload.now).toBe("string");
    expect(payload.lanes).toBeDefined();
    const lanes = payload.lanes as Record<string, Record<string, unknown>>;
    expect(lanes.fast?.enabled).toBe(true);
    expect(lanes.protected?.enabled).toBe(true);
    expect(lanes.safe?.enabled).toBe(true);
    expect(typeof lanes.fast?.adapter).toBe("string");
  });

  test("reflects env-disabled lanes", async () => {
    const env = {
      ALLOWED_ORIGINS: "*",
      EXEC_LANE_FAST_ENABLED: "false",
      EXEC_LANE_PROTECTED_ENABLED: "0",
      EXEC_LANE_SAFE_ENABLED: "off",
    } as Env;
    const response = await worker.fetch(
      new Request("https://dev.api.trader-ralph.com/api/x402/exec/health"),
      env,
      createExecutionContextStub(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    const lanes = payload.lanes as Record<string, Record<string, unknown>>;
    expect(lanes.fast?.enabled).toBe(false);
    expect(lanes.protected?.enabled).toBe(false);
    expect(lanes.safe?.enabled).toBe(false);
  });
});
