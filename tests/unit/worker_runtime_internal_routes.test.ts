import { describe, expect, test } from "bun:test";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

const VALID_RUNTIME_DEPLOYMENT = {
  schemaVersion: "v1",
  deploymentId: "deployment_123",
  strategyKey: "dca",
  sleeveId: "sleeve_alpha",
  ownerUserId: "user_123",
  pair: {
    symbol: "SOL/USDC",
    baseMint: "So11111111111111111111111111111111111111112",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  mode: "shadow",
  state: "shadow",
  lane: "safe",
  createdAt: "2026-03-07T00:00:00.000Z",
  updatedAt: "2026-03-07T00:00:00.000Z",
  policy: {
    maxNotionalUsd: "250.00",
    dailyLossLimitUsd: "35.00",
    maxSlippageBps: 50,
    maxConcurrentRuns: 2,
    rebalanceToleranceBps: 100,
  },
  capital: {
    allocatedUsd: "1000.00",
    reservedUsd: "125.00",
    availableUsd: "875.00",
  },
  tags: ["fixture"],
};

const VALID_RUNTIME_EXECUTION_PLAN = {
  schemaVersion: "v1",
  planId: "plan_123",
  deploymentId: "deployment_123",
  runId: "run_123",
  createdAt: "2026-03-07T00:00:00.000Z",
  mode: "shadow",
  lane: "safe",
  idempotencyKey: "deployment_123:run_123",
  simulateOnly: true,
  dryRun: true,
  slices: [
    {
      sliceId: "slice_1",
      action: "buy",
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint: "So11111111111111111111111111111111111111112",
      inputAmountAtomic: "5000000",
      minOutputAmountAtomic: "30000000",
      notionalUsd: "5.00",
      slippageBps: 50,
    },
  ],
};

describe("worker runtime internal routes", () => {
  test("requires runtime service auth", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health"),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "auth-required",
    });
  });

  test("fails closed when runtime service auth is not configured", async () => {
    const env = createWorkerLiveEnv({
      overrides: {
        RUNTIME_INTERNAL_SERVICE_TOKEN: "",
      },
    });

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "runtime-service-auth-not-configured",
    });
  });

  test("returns authenticated runtime bridge health", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/health", {
        headers: {
          authorization: "Bearer runtime-service-secret",
        },
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      schemaVersion: "v1",
      service: "worker-runtime-bridge",
      authenticatedService: "runtime-rs",
      integration: {
        stubModeEnabled: true,
      },
      routes: {
        deployments: "/api/internal/runtime/deployments",
        executionPlans: "/api/internal/runtime/execution-plans",
        health: "/api/internal/runtime/health",
      },
    });
  });

  test("accepts runtime deployment records through the private route family", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/deployments", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_DEPLOYMENT),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "accepted",
      source: "stub",
      deployment: {
        deploymentId: "deployment_123",
        strategyKey: "dca",
      },
    });
  });

  test("accepts service-authenticated runtime execution plans", async () => {
    const env = createWorkerLiveEnv();

    const response = await worker.fetch(
      new Request("http://localhost/api/internal/runtime/execution-plans", {
        method: "POST",
        headers: {
          authorization: "Bearer runtime-service-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(VALID_RUNTIME_EXECUTION_PLAN),
      }),
      env,
      createExecutionContextStub(),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      ok: true,
      accepted: true,
      source: "stub",
      coordination: {
        planId: "plan_123",
        deploymentId: "deployment_123",
        runId: "run_123",
        sliceCount: 1,
      },
    });
  });
});
