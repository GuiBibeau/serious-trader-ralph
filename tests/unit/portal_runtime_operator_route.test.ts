import { afterEach, describe, expect, test } from "bun:test";
import { GET, POST } from "../../apps/portal/app/api/runtime/operator/route";

const ORIGINAL_ENV = {
  NEXT_PUBLIC_EDGE_API_BASE: process.env.NEXT_PUBLIC_EDGE_API_BASE,
  RUNTIME_OPERATOR_ADMIN_TOKEN: process.env.RUNTIME_OPERATOR_ADMIN_TOKEN,
  RUNTIME_OPERATOR_USER_ALLOWLIST: process.env.RUNTIME_OPERATOR_USER_ALLOWLIST,
  RUNTIME_OPERATOR_PRIVY_USER_ALLOWLIST:
    process.env.RUNTIME_OPERATOR_PRIVY_USER_ALLOWLIST,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
};

const originalFetch = globalThis.fetch;
const FIXTURE_TIME = "2026-03-09T14:10:00.000Z";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function runtimeDeploymentFixture() {
  return {
    schemaVersion: "v1",
    deploymentId: "runtime_canary_live_dca",
    strategyKey: "dca",
    sleeveId: "sleeve_runtime_canary",
    ownerUserId: "user_operator",
    pair: {
      symbol: "SOL/USDC",
      baseMint: SOL_MINT,
      quoteMint: USDC_MINT,
    },
    mode: "live",
    state: "live",
    lane: "safe",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    promotedAt: FIXTURE_TIME,
    policy: {
      maxNotionalUsd: "5.00",
      dailyLossLimitUsd: "25.00",
      maxSlippageBps: 50,
      maxConcurrentRuns: 1,
      rebalanceToleranceBps: 100,
    },
    capital: {
      allocatedUsd: "25.00",
      reservedUsd: "5.00",
      availableUsd: "20.00",
    },
    tags: ["runtime-canary"],
  };
}

function runtimeRunFixture() {
  return {
    schemaVersion: "v1",
    runId: "run_runtime_canary_live_dca",
    deploymentId: "runtime_canary_live_dca",
    runKey: `runtime_canary_live_dca:${FIXTURE_TIME}`,
    trigger: {
      kind: "canary",
      source: "worker-runtime-canary",
      observedAt: FIXTURE_TIME,
      reason: "post_deploy",
    },
    state: "completed",
    plannedAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    riskVerdictId: "risk_1",
    executionPlanId: "plan_1",
    submitRequestId: "submit_1",
    receiptId: "receipt_1",
  };
}

function runtimeLedgerFixture() {
  return {
    schemaVersion: "v1",
    snapshotId: "ledger_runtime_canary_live_dca",
    deploymentId: "runtime_canary_live_dca",
    sleeveId: "sleeve_runtime_canary",
    asOf: FIXTURE_TIME,
    balances: [
      {
        mint: USDC_MINT,
        symbol: "USDC",
        decimals: 6,
        freeAtomic: "20000000",
        reservedAtomic: "5000000",
        priceUsd: "1.00",
      },
    ],
    positions: [],
    totals: {
      equityUsd: "25.00",
      reservedUsd: "5.00",
      availableUsd: "20.00",
      realizedPnlUsd: "1.00",
      unrealizedPnlUsd: "0.00",
    },
  };
}

afterEach(() => {
  process.env.NEXT_PUBLIC_EDGE_API_BASE =
    ORIGINAL_ENV.NEXT_PUBLIC_EDGE_API_BASE;
  process.env.RUNTIME_OPERATOR_ADMIN_TOKEN =
    ORIGINAL_ENV.RUNTIME_OPERATOR_ADMIN_TOKEN;
  process.env.RUNTIME_OPERATOR_USER_ALLOWLIST =
    ORIGINAL_ENV.RUNTIME_OPERATOR_USER_ALLOWLIST;
  process.env.RUNTIME_OPERATOR_PRIVY_USER_ALLOWLIST =
    ORIGINAL_ENV.RUNTIME_OPERATOR_PRIVY_USER_ALLOWLIST;
  process.env.ADMIN_TOKEN = ORIGINAL_ENV.ADMIN_TOKEN;
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  globalThis.fetch = originalFetch;
});

describe("portal runtime operator route", () => {
  test("requires operator auth", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";

    const response = await GET(
      new Request("https://www.trader-ralph.com/api/runtime/operator"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "auth-required",
    });
  });

  test("fails closed when the admin token is missing", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";
    process.env.ADMIN_TOKEN = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await GET(
      new Request("https://www.trader-ralph.com/api/runtime/operator", {
        headers: {
          authorization: "Bearer user-token",
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "missing RUNTIME_OPERATOR_ADMIN_TOKEN",
    });
  });

  test("requires an operator allowlist match before serving admin data", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_operator";
    process.env.RUNTIME_OPERATOR_PRIVY_USER_ALLOWLIST = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await GET(
      new Request("https://www.trader-ralph.com/api/runtime/operator", {
        headers: {
          authorization: "Bearer user-token",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "operator-access-required",
    });
  });

  test("returns runtime snapshot and selected deployment detail", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    const seenAuthHeaders: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      seenAuthHeaders.push(
        String(
          (init?.headers as Record<string, string> | undefined)
            ?.authorization ?? "",
        ),
      );
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/admin/ops/runtime")) {
        return new Response(
          JSON.stringify({
            ok: true,
            runtime: {
              ok: true,
              source: "runtime-rs",
              integration: {
                stubModeEnabled: false,
              },
              health: {
                status: "healthy",
              },
              deployments: [runtimeDeploymentFixture()],
              controls: {
                enabled: true,
                disabledReason: null,
                shadowOnly: false,
                shadowOnlyReason: null,
              },
              canary: {
                ok: true,
              },
              error: null,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/deployments/runtime_canary_live_dca",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            deploymentId: "runtime_canary_live_dca",
            deployment: runtimeDeploymentFixture(),
            runs: [runtimeRunFixture()],
            positions: runtimeLedgerFixture(),
            pnl: {
              asOf: FIXTURE_TIME,
              totals: runtimeLedgerFixture().totals,
            },
            scorecard: {
              deploymentId: "runtime_canary_live_dca",
              promotionGates: [
                {
                  targetMode: "live",
                  status: "pass",
                  summary: "bounded live canary remains healthy",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await GET(
      new Request("https://www.trader-ralph.com/api/runtime/operator", {
        headers: {
          authorization: "Bearer user-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      selectedDeploymentId: "runtime_canary_live_dca",
      runtime: {
        ok: true,
        deployments: [
          {
            deploymentId: "runtime_canary_live_dca",
            state: "live",
          },
        ],
      },
      detail: {
        deploymentId: "runtime_canary_live_dca",
        deployment: {
          deploymentId: "runtime_canary_live_dca",
        },
        runs: [
          {
            deploymentId: "runtime_canary_live_dca",
          },
        ],
        positions: {
          totals: {
            equityUsd: "25.00",
          },
        },
        pnl: {
          totals: {
            reservedUsd: "5.00",
          },
        },
      },
    });
    expect(seenAuthHeaders).toEqual([
      "Bearer user-token",
      "Bearer operator-admin",
      "Bearer operator-admin",
    ]);
  });

  test("forwards runtime deployment control actions", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let capturedMethod = "";
    let capturedAuthorization = "";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/deployments/runtime_canary_live_dca/pause",
        )
      ) {
        capturedMethod = String(init?.method ?? "");
        capturedAuthorization = String(
          (init?.headers as Record<string, string> | undefined)
            ?.authorization ?? "",
        );
        return new Response(JSON.stringify({ ok: true, action: "pause" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await POST(
      new Request("https://www.trader-ralph.com/api/runtime/operator", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentId: "runtime_canary_live_dca",
          action: "pause",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(capturedMethod).toBe("POST");
    expect(capturedAuthorization).toBe("Bearer operator-admin");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: "pause",
    });
  });
});
