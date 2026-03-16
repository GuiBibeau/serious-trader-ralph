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
              routes: {
                health: "/api/internal/runtime/health",
                deployments: "/api/internal/runtime/deployments",
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
      if (
        url.includes(
          "/api/admin/ops/runtime/research?strategyKey=dca&venueKey=jupiter&assetKey=SOL",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            registry: {
              hypotheses: [
                {
                  hypothesisId: "hyp_runtime",
                  title: "Runtime momentum hypothesis",
                },
              ],
              sources: [{ sourceId: "src_runtime", title: "Paper" }],
              experiments: [{ experimentId: "exp_runtime" }],
              evidenceBundles: [{ evidenceBundleId: "bundle_runtime" }],
              reproducibilityBundles: [
                { reproducibilityBundleId: "repro_runtime" },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/promotions?subjectKind=strategy&subjectKey=dca&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            promotions: [{ promotionId: "promo_strategy_dca" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/promotions?subjectKind=venue&subjectKey=jupiter&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            promotions: [{ promotionId: "promo_venue_jupiter" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/promotions?subjectKind=asset&subjectKey=SOL&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            promotions: [{ promotionId: "promo_asset_sol" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/readiness?subjectKind=venue&subjectKey=jupiter&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            readinessArtifacts: [{ readinessId: "ready_venue_jupiter" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/readiness?subjectKind=asset&subjectKey=SOL&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            readinessArtifacts: [{ readinessId: "ready_asset_sol" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/subject-controls?subjectKind=venue&subjectKey=jupiter&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            controls: [{ subjectKey: "jupiter", liveAllowed: true }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/subject-controls?subjectKind=asset&subjectKey=SOL&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            controls: [{ subjectKey: "SOL", liveAllowed: true }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/readiness/canary?subjectKind=venue&subjectKey=jupiter&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            runs: [{ runId: "canary_venue_jupiter", status: "success" }],
            state: { updatedAt: FIXTURE_TIME },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.includes(
          "/api/admin/ops/runtime/research/readiness/canary?subjectKind=asset&subjectKey=SOL&limit=5",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            runs: [{ runId: "canary_asset_sol", status: "success" }],
            state: { updatedAt: FIXTURE_TIME },
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
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      ok: true,
      selectedDeploymentId: "runtime_canary_live_dca",
      runtime: {
        ok: true,
        routes: {
          health: "/api/internal/runtime/health",
          deployments: "/api/internal/runtime/deployments",
        },
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
        lab: {
          research: {
            hypotheses: [{ hypothesisId: "hyp_runtime" }],
          },
          promotions: {
            strategy: [{ promotionId: "promo_strategy_dca" }],
          },
          readiness: {
            venue: {
              subjectKey: "jupiter",
            },
            asset: {
              subjectKey: "SOL",
            },
          },
        },
      },
    });
    const program = payload.program as {
      matrix?: Array<Record<string, unknown>>;
      nextIssueOrder?: number[];
    };
    expect(program.nextIssueOrder?.slice(0, 3)).toEqual([389, 380, 392]);
    expect(
      program.matrix?.some(
        (entry) =>
          entry.subjectKey === "jupiter" && entry.liveSmokeIssueNumber === 412,
      ),
    ).toBe(true);
    expect(
      program.matrix?.some(
        (entry) =>
          entry.subjectKey === "drift" && entry.terminalIssueNumber === 389,
      ),
    ).toBe(true);
    expect(seenAuthHeaders[0]).toBe("Bearer user-token");
    expect(seenAuthHeaders.slice(1)).toHaveLength(12);
    expect(
      seenAuthHeaders
        .slice(1)
        .every((value) => value === "Bearer operator-admin"),
    ).toBe(true);
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

  test("forwards subject control actions with operator identity", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let capturedBody = "";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "u_1", email: "operator@example.com" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.endsWith("/api/admin/ops/runtime/research/subject-controls")) {
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ ok: true, control: { subjectKey: "SOL" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
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
          action: "update_subject_control",
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: false,
          disabledReason: "operator-disabled",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(capturedBody)).toMatchObject({
      subjectKind: "asset",
      subjectKey: "SOL",
      liveAllowed: false,
      disabledReason: "operator-disabled",
      updatedBy: "operator@example.com",
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      control: {
        subjectKey: "SOL",
      },
    });
  });

  test("forwards readiness canary actions with operator identity", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let capturedBody = "";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "u_1", email: "operator@example.com" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.endsWith("/api/admin/ops/runtime/research/readiness/canary")) {
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ ok: true, run: { runId: "readycanary_sol" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
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
          action: "run_readiness_canary",
          subjectKind: "asset",
          subjectKey: "SOL",
          venueKey: "jupiter",
          assetKey: "SOL",
          pairSymbol: "SOL/USDC",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(parsedBody).toMatchObject({
      subjectKind: "asset",
      subjectKey: "SOL",
      venueKey: "jupiter",
      assetKey: "SOL",
      pairSymbol: "SOL/USDC",
      requestedBy: "operator@example.com",
      triggerSource: "manual",
    });
    expect(parsedBody).not.toHaveProperty("proofMode");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: {
        runId: "readycanary_sol",
      },
    });
  });

  test("forwards venue tx smoke actions with operator identity", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let capturedBody = "";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "u_1", email: "operator@example.com" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.endsWith("/api/admin/ops/runtime/research/readiness/smoke")) {
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ ok: true, run: { runId: "smoke_jupiter" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
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
          action: "run_venue_tx_smoke",
          subjectKind: "venue",
          subjectKey: "openbook",
          venueKey: "openbook",
          assetKey: "SOL",
          pairSymbol: "SOL/USDC",
          targetNotionalUsd: "5.00",
          smokeIntentFamily: "clob_order",
          smokeOrderSide: "buy",
          tightenOnFailure: true,
          failureControlMode: "disable_live",
          killDrillNotes: ["Disable OpenBook only."],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(capturedBody)).toMatchObject({
      subjectKind: "venue",
      subjectKey: "openbook",
      venueKey: "openbook",
      assetKey: "SOL",
      pairSymbol: "SOL/USDC",
      targetNotionalUsd: "5.00",
      requestedBy: "operator@example.com",
      triggerSource: "manual",
      proofMode: "venue_tx_smoke",
      smokeIntentFamily: "clob_order",
      smokeOrderSide: "buy",
      tightenOnFailure: true,
      failureControlMode: "disable_live",
      killDrillNotes: ["Disable OpenBook only."],
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: {
        runId: "smoke_jupiter",
      },
    });
  });

  test("forwards prediction venue smoke metadata", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let capturedBody = "";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "u_1", email: "operator@example.com" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.endsWith("/api/admin/ops/runtime/research/readiness/smoke")) {
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ ok: true, run: { runId: "smoke_dflow" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
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
          action: "run_venue_tx_smoke",
          subjectKind: "venue",
          subjectKey: "dflow",
          venueKey: "dflow",
          pairSymbol: "PRES-2028",
          smokeIntentFamily: "prediction_order",
          smokeOrderSide: "buy",
          metadata: {
            instrumentId: "PRES-2028",
            outcomeId: "YesMint1111111111111111111111111111111",
            outcomeSide: "yes",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(capturedBody)).toMatchObject({
      subjectKind: "venue",
      subjectKey: "dflow",
      venueKey: "dflow",
      pairSymbol: "PRES-2028",
      requestedBy: "operator@example.com",
      triggerSource: "manual",
      proofMode: "venue_tx_smoke",
      smokeIntentFamily: "prediction_order",
      smokeOrderSide: "buy",
      metadata: {
        instrumentId: "PRES-2028",
        outcomeId: "YesMint1111111111111111111111111111111",
        outcomeSide: "yes",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: {
        runId: "smoke_dflow",
      },
    });
  });

  test("forwards deployment evaluation actions", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let capturedBody = "";
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(
          JSON.stringify({
            ok: true,
            user: { id: "u_1", email: "operator@example.com" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/deployments/deployment_live_trend/evaluate",
        )
      ) {
        capturedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            ok: true,
            run: { deploymentId: "deployment_live_trend", state: "completed" },
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
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
          action: "evaluate_deployment",
          deploymentId: "deployment_live_trend",
          body: {
            trigger: {
              kind: "operator",
              source: "portal-runtime-operator",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(JSON.parse(capturedBody)).toMatchObject({
      trigger: {
        kind: "operator",
        source: "portal-runtime-operator",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: {
        deploymentId: "deployment_live_trend",
      },
    });
  });
});
