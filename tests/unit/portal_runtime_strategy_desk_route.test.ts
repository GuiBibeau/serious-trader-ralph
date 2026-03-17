import { afterEach, describe, expect, test } from "bun:test";
import {
  GET,
  POST,
} from "../../apps/portal/app/api/runtime/strategy-desk/route";

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
const FIXTURE_TIME = "2026-03-17T03:08:10Z";

function scenarioFixture() {
  return {
    schemaVersion: "v1",
    scenarioId: "desk_sol_composite_1",
    title: "SOL composite desk scenario",
    summary: "Composite desk scenario",
    ownerUserId: "user_1",
    strategyKey: "strategy_desk::sol_composite",
    thesis: "Composite thesis",
    state: "paper_ready",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    activeHandoffId: "desk_handoff_sol_composite_live_1",
    legs: [
      {
        legId: "leg_spot_alpha",
        label: "Spot alpha",
        role: "primary_alpha",
        venueKey: "jupiter",
        intentFamily: "spot_swap",
        marketType: "spot",
        assetKeys: ["SOL", "USDC"],
        enabledModes: ["shadow", "paper"],
        sizing: {
          targetNotionalUsd: "1000",
        },
      },
    ],
    evidence: [],
    implementationReferences: [],
    tags: ["strategy-desk"],
    metadata: {
      operatorWalletAddress: "11111111111111111111111111111111",
    },
  };
}

function runFixture() {
  return {
    schemaVersion: "v1",
    scenarioRunId: "desk_run_sol_composite_paper_1",
    scenarioId: "desk_sol_composite_1",
    scenarioState: "paper_ready",
    runKind: "paper",
    state: "completed",
    requestedBy: "operator_1",
    trigger: {
      kind: "operator",
      source: "portal.strategy-desk",
      observedAt: FIXTURE_TIME,
    },
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    legRuns: [],
  };
}

function reportFixture() {
  return {
    schemaVersion: "v1",
    reportId: "desk_report_sol_composite_paper_1",
    scenarioId: "desk_sol_composite_1",
    scenarioRunId: "desk_run_sol_composite_paper_1",
    stage: "paper",
    status: "pass",
    summary: "Paper report",
    generatedAt: FIXTURE_TIME,
    legOutcomes: [
      {
        legId: "leg_spot_alpha",
        status: "pass",
      },
    ],
    portfolioSummary: {
      netPnlUsd: "49.30",
      grossExposureUsd: "1650.00",
      maxDrawdownBps: 180,
    },
    riskOverlays: [],
    evidence: [],
    checks: [],
    approvals: [],
  };
}

function handoffFixture() {
  return {
    schemaVersion: "v1",
    handoffId: "desk_handoff_sol_composite_live_1",
    scenarioId: "desk_sol_composite_1",
    currentState: "operator_review",
    targetMode: "limited_live",
    status: "approved",
    summary:
      "Bound the spot leg to limited live while keeping overlays paper-bound.",
    requestedBy: "operator_1",
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    evidenceRefs: [
      {
        kind: "strategy_desk_report",
        ref: "desk_report_sol_composite_paper_1",
      },
    ],
    checks: [
      {
        checkId: "limited-live-human-approval",
        status: "requires_human_approval",
        message: "Human approval remains required.",
      },
    ],
    approvals: [
      {
        targetMode: "limited_live",
        approvedBy: "operator_1",
        approvedAt: FIXTURE_TIME,
      },
    ],
    bindings: [
      {
        bindingId: "binding_leg_spot_alpha_runtime",
        bindingKind: "runtime_deployment",
        legIds: ["leg_spot_alpha"],
        venueKey: "jupiter",
        targetMode: "limited_live",
        deploymentId: "dep_desk_sol_live",
        lane: "safe",
      },
    ],
    actions: [
      {
        actionId: "record-desk-state",
        actionType: "record_state_transition",
        summary: "Move into operator review.",
        required: true,
      },
    ],
  };
}

function handoffEventFixture() {
  return {
    eventId: "desk_handoff_evt_1",
    handoffId: "desk_handoff_sol_composite_live_1",
    eventType: "approved",
    actor: "operator_1",
    summary: "Approved bounded execution handoff.",
    createdAt: FIXTURE_TIME,
  };
}

function executionRecipeFixture() {
  return {
    recipeId: "desk_recipe_perp_1",
    scenarioId: "desk_sol_composite_1",
    handoffId: "desk_handoff_sol_composite_live_1",
    bindingId: "binding_leg_perp_hedge_recipe",
    status: "paper",
    venueKey: "drift",
    instrumentId: "SOL-PERP",
    targetMode: "paper",
    legIds: ["leg_perp_hedge"],
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
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

describe("portal runtime strategy desk route", () => {
  test("requires operator auth", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";

    const response = await GET(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk"),
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
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
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

  test("returns a structured upstream error when worker auth fetch throws", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        throw new Error("socket hang up");
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await GET(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
        headers: {
          authorization: "Bearer user-token",
        },
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "worker-fetch-failed",
    });
  });

  test("returns strategy desk snapshot with selected scenario detail", async () => {
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
      if (url.includes("/api/admin/ops/runtime/strategy-desk/scenarios?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            scenarios: [scenarioFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/runs?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            runs: [runFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/reports?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            reports: [reportFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/handoffs?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            handoffs: [handoffFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/strategy-desk/handoffs/desk_handoff_sol_composite_live_1",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            handoff: handoffFixture(),
            events: [handoffEventFixture()],
            executionRecipes: [executionRecipeFixture()],
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
      new Request(
        "https://www.trader-ralph.com/api/runtime/strategy-desk?scenarioId=desk_sol_composite_1",
        {
          headers: {
            authorization: "Bearer user-token",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      snapshot: {
        selectedScenarioId: "desk_sol_composite_1",
        selectedScenario: {
          scenarioId: "desk_sol_composite_1",
          title: "SOL composite desk scenario",
        },
        runs: [
          {
            scenarioRunId: "desk_run_sol_composite_paper_1",
          },
        ],
        reports: [
          {
            reportId: "desk_report_sol_composite_paper_1",
          },
        ],
        handoffs: [
          {
            handoffId: "desk_handoff_sol_composite_live_1",
          },
        ],
        activeHandoff: {
          handoffId: "desk_handoff_sol_composite_live_1",
        },
        latestHandoff: {
          handoffId: "desk_handoff_sol_composite_live_1",
        },
        handoffEvents: [
          {
            eventId: "desk_handoff_evt_1",
          },
        ],
        executionRecipes: [
          {
            recipeId: "desk_recipe_perp_1",
          },
        ],
      },
    });
    expect(seenAuthHeaders).toContain("Bearer user-token");
    expect(seenAuthHeaders).toContain("Bearer operator-admin");
  });

  test("loads detail from the active handoff even when a newer draft exists", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    const latestDraft = {
      ...handoffFixture(),
      handoffId: "desk_handoff_sol_composite_draft_2",
      status: "draft",
      updatedAt: "2026-03-17T03:09:10Z",
    };
    let detailPath = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/scenarios?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            scenarios: [scenarioFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            scenario: scenarioFixture(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/runs?")) {
        return new Response(
          JSON.stringify({ ok: true, runs: [runFixture()] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/reports?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            reports: [reportFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/handoffs?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            handoffs: [handoffFixture(), latestDraft],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/strategy-desk/handoffs/desk_handoff_sol_composite_live_1",
        )
      ) {
        detailPath = new URL(url).pathname;
        return new Response(
          JSON.stringify({
            ok: true,
            handoff: handoffFixture(),
            events: [handoffEventFixture()],
            executionRecipes: [executionRecipeFixture()],
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
      new Request(
        "https://www.trader-ralph.com/api/runtime/strategy-desk?scenarioId=desk_sol_composite_1",
        {
          headers: {
            authorization: "Bearer user-token",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      snapshot: {
        activeHandoff: {
          handoffId: "desk_handoff_sol_composite_live_1",
        },
        latestHandoff: {
          handoffId: "desk_handoff_sol_composite_draft_2",
        },
        handoffEvents: [
          {
            handoffId: "desk_handoff_sol_composite_live_1",
          },
        ],
        executionRecipes: [
          {
            handoffId: "desk_handoff_sol_composite_live_1",
          },
        ],
      },
    });
    expect(detailPath).toBe(
      "/api/admin/ops/runtime/strategy-desk/handoffs/desk_handoff_sol_composite_live_1",
    );
  });

  test("fails closed when the requested scenario cannot be loaded", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/scenarios?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            scenarios: [
              {
                ...scenarioFixture(),
                scenarioId: "desk_other",
                title: "Other scenario",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (
        url.endsWith(
          "/api/admin/ops/runtime/strategy-desk/scenarios/desk_missing",
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "strategy-desk-scenario-not-found",
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await GET(
      new Request(
        "https://www.trader-ralph.com/api/runtime/strategy-desk?scenarioId=desk_missing",
        {
          headers: {
            authorization: "Bearer user-token",
          },
        },
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "strategy-desk-scenario-not-found",
    });
  });

  test("fails closed when reports cannot be loaded for the selected scenario", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) {
        return new Response(JSON.stringify({ ok: true, user: { id: "u_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/scenarios?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            scenarios: [scenarioFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/runs?")) {
        return new Response(
          JSON.stringify({
            ok: true,
            runs: [runFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/api/admin/ops/runtime/strategy-desk/reports?")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "strategy-desk-reports-load-failed",
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await GET(
      new Request(
        "https://www.trader-ralph.com/api/runtime/strategy-desk?scenarioId=desk_sol_composite_1",
        {
          headers: {
            authorization: "Bearer user-token",
          },
        },
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "strategy-desk-reports-load-failed",
    });
  });

  test("forwards scenario upserts through the worker admin surface", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let receivedBody: Record<string, unknown> | null = null;
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
      if (url.endsWith("/api/admin/ops/runtime/strategy-desk/scenarios")) {
        receivedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ok: true,
            scenario: {
              ...scenarioFixture(),
              title: receivedBody.title,
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

    const response = await POST(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "upsert_scenario",
          scenario: {
            ...scenarioFixture(),
            title: "Updated scenario title",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scenario: {
        title: "Updated scenario title",
      },
    });
    expect(receivedBody?.title).toBe("Updated scenario title");
  });

  test("forwards execute actions through the worker admin surface", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let receivedBody: Record<string, unknown> | null = null;
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
          "/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/execute",
        )
      ) {
        receivedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ok: true,
            scenario: scenarioFixture(),
            run: runFixture(),
            report: reportFixture(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await POST(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "execute_scenario",
          scenarioId: "desk_sol_composite_1",
          runKind: "paper",
          requestedBy: "operator_1",
          walletAddress: "11111111111111111111111111111111",
          trigger: {
            reason: "portal-test",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: {
        scenarioRunId: "desk_run_sol_composite_paper_1",
      },
      report: {
        reportId: "desk_report_sol_composite_paper_1",
      },
    });
    expect(receivedBody).toMatchObject({
      runKind: "paper",
      requestedBy: "operator_1",
      walletAddress: "11111111111111111111111111111111",
    });
  });

  test("forwards study actions through the worker admin surface", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let receivedBody: Record<string, unknown> | null = null;
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
          "/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/study",
        )
      ) {
        receivedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ok: true,
            scenario: scenarioFixture(),
            run: {
              ...runFixture(),
              scenarioRunId: "desk_run_sol_composite_backtest_1",
              runKind: "backtest",
            },
            report: {
              ...reportFixture(),
              reportId: "desk_report_sol_composite_backtest_1",
              scenarioRunId: "desk_run_sol_composite_backtest_1",
              stage: "backtest",
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

    const response = await POST(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "study_scenario",
          scenarioId: "desk_sol_composite_1",
          runKind: "backtest",
          requestedBy: "operator_1",
          selectionMetric: "excess_vs_flat_cash_bps",
          variantIds: ["fast"],
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      run: {
        runKind: "backtest",
      },
      report: {
        stage: "backtest",
      },
    });
    expect(receivedBody).toMatchObject({
      runKind: "backtest",
      requestedBy: "operator_1",
      selectionMetric: "excess_vs_flat_cash_bps",
      variantIds: ["fast"],
    });
  });

  test("forwards handoff preparation through the worker admin surface", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let receivedPath = "";
    let receivedBody: Record<string, unknown> | null = null;
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
          "/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
        )
      ) {
        receivedPath = new URL(url).pathname;
        receivedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ok: true,
            scenario: scenarioFixture(),
            handoff: handoffFixture(),
            events: [handoffEventFixture()],
            executionRecipes: [executionRecipeFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await POST(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "prepare_handoff",
          scenarioId: "desk_sol_composite_1",
          requestedBy: "operator_1",
          targetMode: "limited_live",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      handoff: {
        handoffId: "desk_handoff_sol_composite_live_1",
      },
      executionRecipes: [
        {
          recipeId: "desk_recipe_perp_1",
        },
      ],
    });
    expect(receivedPath).toBe(
      "/api/admin/ops/runtime/strategy-desk/scenarios/desk_sol_composite_1/handoffs/prepare",
    );
    expect(receivedBody).toEqual({
      requestedBy: "operator_1",
      targetMode: "limited_live",
    });
  });

  test("forwards handoff transitions through the worker admin surface", async () => {
    process.env.NEXT_PUBLIC_EDGE_API_BASE = "https://api.trader-ralph.com";
    process.env.RUNTIME_OPERATOR_ADMIN_TOKEN = "operator-admin";
    process.env.RUNTIME_OPERATOR_USER_ALLOWLIST = "u_1";

    let receivedPath = "";
    let receivedBody: Record<string, unknown> | null = null;
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
          "/api/admin/ops/runtime/strategy-desk/handoffs/desk_handoff_sol_composite_live_1/transition",
        )
      ) {
        receivedPath = new URL(url).pathname;
        receivedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ok: true,
            scenario: {
              ...scenarioFixture(),
              state: "execution_bound",
            },
            handoff: {
              ...handoffFixture(),
              status: "applied",
            },
            events: [handoffEventFixture()],
            executionRecipes: [executionRecipeFixture()],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const response = await POST(
      new Request("https://www.trader-ralph.com/api/runtime/strategy-desk", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "transition_handoff",
          handoffId: "desk_handoff_sol_composite_live_1",
          handoffAction: "apply",
          actor: "operator_1",
          notes: "arm bounded execution",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scenario: {
        state: "execution_bound",
      },
      handoff: {
        status: "applied",
      },
    });
    expect(receivedPath).toBe(
      "/api/admin/ops/runtime/strategy-desk/handoffs/desk_handoff_sol_composite_live_1/transition",
    );
    expect(receivedBody).toEqual({
      action: "apply",
      actor: "operator_1",
      notes: "arm bounded execution",
    });
  });
});
