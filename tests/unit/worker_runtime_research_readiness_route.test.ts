import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

function createSqliteD1Adapter(db: Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = db.query(sql);
              const result = statement.run(...(params as never[])) as {
                changes?: number;
              };
              return {
                meta: {
                  changes:
                    typeof result.changes === "number" ? result.changes : 0,
                },
              };
            },
            async first() {
              const statement = db.query(sql);
              return (statement.get(...(params as never[])) as unknown) ?? null;
            },
            async all() {
              const statement = db.query(sql);
              return {
                results: (statement.all(...(params as never[])) ??
                  []) as unknown[],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function createOpsEnv(overrides?: Partial<Env>) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  for (const migrationName of [
    "0025_execution_fabric.sql",
    "0026_execution_canary.sql",
    "0027_runtime_canary.sql",
    "0028_strategy_lab_promotions.sql",
    "0029_strategy_lab_readiness.sql",
    "0030_strategy_lab_post_live.sql",
  ]) {
    const migrationPath = resolve(
      import.meta.dir,
      "..",
      "..",
      "apps/worker/migrations",
      migrationName,
    );
    sqlite.exec(readFileSync(migrationPath, "utf8"));
  }

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      ADMIN_TOKEN: "admin-secret",
      RUNTIME_INTERNAL_STUB_MODE: "1",
      RUNTIME_INTERNAL_SERVICE_TOKEN: "runtime-secret",
      STRATEGY_LAB_READINESS_CANARY_ENABLED: "1",
      ...overrides,
    },
  });

  return { env, sqlite };
}

describe("worker runtime research readiness routes", () => {
  test("requires admin auth for readiness evaluation", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "asset",
              subjectKey: "SOL",
              targetState: "limited_live_ready",
              requestedBy: "codex",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        ok: false,
        error: "auth-required",
      });
    } finally {
      sqlite.close();
    }
  });

  test("persists subject controls and evaluates readiness artifacts", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      for (const control of [
        {
          subjectKind: "venue",
          subjectKey: "jupiter",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedBy: "codex",
        },
        {
          subjectKind: "asset",
          subjectKey: "SOL",
          liveAllowed: false,
          killSwitchEnabled: false,
          updatedBy: "codex",
        },
      ]) {
        const response = await worker.fetch(
          new Request(
            "http://localhost/api/admin/ops/runtime/research/subject-controls",
            {
              method: "POST",
              headers: {
                authorization: "Bearer admin-secret",
                "content-type": "application/json",
              },
              body: JSON.stringify(control),
            },
          ),
          env,
          createExecutionContextStub(),
        );
        expect(response.status).toBe(200);
        const payload = (await response.json()) as Record<string, unknown>;
        expect(payload.ok).toBe(true);
      }

      const readinessResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "asset",
              subjectKey: "SOL",
              targetState: "limited_live_ready",
              requestedBy: "codex",
              venueKey: "jupiter",
              pairSymbol: "SOL/USDC",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(readinessResponse.status).toBe(200);
      const readinessPayload = (await readinessResponse.json()) as {
        ok: boolean;
        readiness: {
          status: string;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(readinessPayload.ok).toBe(true);
      expect(readinessPayload.readiness.status).toBe("pass");
      expect(
        readinessPayload.readiness.evidenceRefs.map((ref) => ref.kind),
      ).toContain("bounded_canary_plan");

      const listResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness?subjectKind=asset&subjectKey=SOL",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(listResponse.status).toBe(200);
      const listPayload = (await listResponse.json()) as {
        ok: boolean;
        readinessArtifacts: Array<{ subjectKey: string }>;
      };
      expect(listPayload.ok).toBe(true);
      expect(listPayload.readinessArtifacts[0]?.subjectKey).toBe("SOL");
    } finally {
      sqlite.close();
    }
  });

  test("runs a stub readiness canary and returns auditable evidence", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/canary",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "asset",
              subjectKey: "SOL",
              requestedBy: "codex",
              venueKey: "jupiter",
              pairSymbol: "SOL/USDC",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        run: {
          evidenceRefs: Array<{ kind: string }>;
          reconciliation: { status: string };
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.reconciliation.status).toBe("passed");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
    } finally {
      sqlite.close();
    }
  });

  test("runs a venue tx smoke and returns smoke-scoped evidence", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "jupiter",
              requestedBy: "codex",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              proofMode: "venue_tx_smoke",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
              killDrillNotes: ["Disable Jupiter only."],
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        markdown: string;
        run: {
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
          reconciliation: { status: string };
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.markdown).toContain("Venue TX smoke");
      expect(payload.run.reconciliation.status).toBe("passed");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
      expect(payload.run.metadata?.proofMode).toBe("venue_tx_smoke");
    } finally {
      sqlite.close();
    }
  });

  test("allows bounded Raydium venue smoke even though the venue is not generally live-enabled", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "raydium",
              requestedBy: "codex",
              venueKey: "raydium",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              proofMode: "venue_tx_smoke",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        run: {
          venueKey: string;
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.venueKey).toBe("raydium");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
      expect(payload.run.metadata?.proofMode).toBe("venue_tx_smoke");
    } finally {
      sqlite.close();
    }
  });

  test("allows bounded Orca venue smoke even though the venue is not generally live-enabled", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "orca",
              requestedBy: "codex",
              venueKey: "orca",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              proofMode: "venue_tx_smoke",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        run: {
          venueKey: string;
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.venueKey).toBe("orca");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
      expect(payload.run.metadata?.proofMode).toBe("venue_tx_smoke");
    } finally {
      sqlite.close();
    }
  });

  test("allows bounded OpenBook venue smoke even though the venue is not generally live-enabled", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "openbook",
              requestedBy: "codex",
              venueKey: "openbook",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              proofMode: "venue_tx_smoke",
              smokeIntentFamily: "clob_order",
              smokeOrderSide: "buy",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        run: {
          venueKey: string;
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.venueKey).toBe("openbook");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
      expect(payload.run.metadata?.proofMode).toBe("venue_tx_smoke");
      expect(payload.run.metadata?.smokeIntentFamily).toBe("clob_order");
      expect(payload.run.metadata?.smokeOrderSide).toBe("buy");
    } finally {
      sqlite.close();
    }
  });

  test("allows bounded Drift venue smoke even though the venue is not generally live-enabled", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "drift",
              requestedBy: "codex",
              venueKey: "drift",
              assetKey: "SOL",
              pairSymbol: "SOL-PERP",
              proofMode: "venue_tx_smoke",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        run: {
          venueKey: string;
          pairSymbol: string;
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.venueKey).toBe("drift");
      expect(payload.run.pairSymbol).toBe("SOL-PERP");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
      expect(payload.run.metadata?.proofMode).toBe("venue_tx_smoke");
    } finally {
      sqlite.close();
    }
  });

  test("accepts bounded DFlow venue smoke requests with prediction metadata", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "dflow",
              requestedBy: "codex",
              venueKey: "dflow",
              pairSymbol: "PRES-2028",
              proofMode: "venue_tx_smoke",
              smokeIntentFamily: "prediction_order",
              smokeOrderSide: "buy",
              metadata: {
                instrumentId: "PRES-2028",
                outcomeId: "YesMint1111111111111111111111111111111",
                outcomeSide: "yes",
              },
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        run: {
          venueKey: string;
          pairSymbol: string;
          inputMint: string;
          outputMint: string;
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.venueKey).toBe("dflow");
      expect(payload.run.pairSymbol).toBe("PRES-2028");
      expect(payload.run.inputMint).toBe(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      );
      expect(payload.run.outputMint).toBe(
        "YesMint1111111111111111111111111111111",
      );
      expect(payload.run.metadata?.proofMode).toBe("venue_tx_smoke");
      expect(payload.run.metadata?.smokeIntentFamily).toBe("prediction_order");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
    } finally {
      sqlite.close();
    }
  });

  test("uses the quote mint for OpenBook buy smoke on USDC/USDT", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "openbook",
              requestedBy: "codex",
              venueKey: "openbook",
              assetKey: "USDT",
              pairSymbol: "USDC/USDT",
              proofMode: "venue_tx_smoke",
              smokeIntentFamily: "clob_order",
              smokeOrderSide: "buy",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        run: {
          inputMint: string;
          outputMint: string;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.run.inputMint).toBe(
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      );
      expect(payload.run.outputMint).toBe(
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      );
    } finally {
      sqlite.close();
    }
  });

  test("runs a Jupiter trigger venue tx smoke and records the smoke intent", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "jupiter",
              requestedBy: "codex",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              smokeIntentFamily: "conditional_spot_order",
              smokeOrderSide: "sell",
              killDrillNotes: ["Create and cancel a bounded trigger order."],
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        markdown: string;
        run: {
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.markdown).toContain(
        "Smoke intent: conditional_spot_order",
      );
      expect(payload.markdown).toContain("Smoke order side: sell");
      expect(payload.run.metadata?.smokeIntentFamily).toBe(
        "conditional_spot_order",
      );
      expect(payload.run.metadata?.smokeOrderSide).toBe("sell");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
    } finally {
      sqlite.close();
    }
  });

  test("runs a flash-liquidity venue tx smoke and records the flash intent", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "flash_liquidity",
              requestedBy: "codex",
              venueKey: "flash_liquidity",
              assetKey: "USDC",
              pairSymbol: "USDC/USDC",
              smokeIntentFamily: "flash_atomic",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        markdown: string;
        run: {
          assetKey: string;
          metadata?: Record<string, unknown>;
          evidenceRefs: Array<{ kind: string }>;
        };
      };
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("success");
      expect(payload.run.assetKey).toBe("USDC");
      expect(payload.markdown).toContain("Smoke intent: flash_atomic");
      expect(payload.run.metadata?.smokeIntentFamily).toBe("flash_atomic");
      expect(payload.run.evidenceRefs[0]?.kind).toBe("live_canary");
    } finally {
      sqlite.close();
    }
  });

  test("blocks conditional venue smoke on a live adapter that does not support trigger intents", async () => {
    const { env, sqlite } = createOpsEnv();
    try {
      const response = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "jupiter",
              requestedBy: "codex",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              adapterKey: "jito_bundle",
              smokeIntentFamily: "conditional_spot_order",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        ok: boolean;
        status: string;
        error?: string;
      };
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe("blocked");
      expect(payload.error).toContain(
        "strategy-lab-readiness-canary-adapter-unavailable",
      );
    } finally {
      sqlite.close();
    }
  });

  test("tightens the venue on tx smoke failure", async () => {
    const { env, sqlite } = createOpsEnv({
      STRATEGY_LAB_READINESS_CANARY_DAILY_CAP_USD: "1",
    });
    try {
      const warmupResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "jupiter",
              requestedBy: "codex",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              proofMode: "venue_tx_smoke",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(warmupResponse.status).toBe(200);

      const smokeResponse = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/readiness/smoke",
          {
            method: "POST",
            headers: {
              authorization: "Bearer admin-secret",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              subjectKind: "venue",
              subjectKey: "jupiter",
              requestedBy: "codex",
              venueKey: "jupiter",
              assetKey: "SOL",
              pairSymbol: "SOL/USDC",
              proofMode: "venue_tx_smoke",
              tightenOnFailure: true,
              failureControlMode: "disable_live",
            }),
          },
        ),
        env,
        createExecutionContextStub(),
      );

      expect(smokeResponse.status).toBe(200);
      const payload = (await smokeResponse.json()) as {
        ok: boolean;
        status: string;
        run: {
          evidenceRefs: Array<{ kind: string }>;
          metadata?: {
            smokeFailureControl?: {
              applied?: boolean;
              liveAllowed?: boolean;
              killSwitchEnabled?: boolean;
            };
          };
        };
      };
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe("skipped");
      expect(
        payload.run.evidenceRefs.some(
          (ref) => ref.kind === "subject_control_patch",
        ),
      ).toBe(true);
      expect(payload.run.metadata?.smokeFailureControl).toMatchObject({
        applied: true,
        liveAllowed: false,
        killSwitchEnabled: false,
      });

      const subjectControls = await worker.fetch(
        new Request(
          "http://localhost/api/admin/ops/runtime/research/subject-controls?subjectKind=venue&subjectKey=jupiter",
          {
            headers: {
              authorization: "Bearer admin-secret",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(subjectControls.status).toBe(200);
      const controlPayload = (await subjectControls.json()) as {
        ok: boolean;
        controls: Array<{
          subjectKey: string;
          liveAllowed: boolean;
          killSwitchEnabled: boolean;
        }>;
      };
      expect(controlPayload.ok).toBe(true);
      expect(controlPayload.controls[0]).toMatchObject({
        subjectKey: "jupiter",
        liveAllowed: false,
        killSwitchEnabled: false,
      });
    } finally {
      sqlite.close();
    }
  });
});
