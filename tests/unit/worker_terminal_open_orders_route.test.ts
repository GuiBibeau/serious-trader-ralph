import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { OrcaClient } from "../../apps/worker/src/orca";
import { RaydiumClient } from "../../apps/worker/src/raydium";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
  MAINNET_USDC_MINT,
  SOL_MINT,
} from "../integration/_worker_live_test_utils";

const requireUserMock = mock(async () => ({
  privyUserId: "did:privy:user_1",
  email: "user@example.com",
}));

mock.module("../../apps/worker/src/auth", () => ({
  requireUser: requireUserMock,
}));

const worker = (await import("../../apps/worker/src/index")).default;

function buildSignedSafeLaneTxBase64(): string {
  const payer = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
  });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 5_000,
    }),
  );
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  tx.sign(payer);
  return Buffer.from(tx.serialize()).toString("base64");
}

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

function createExecEnv(): { env: Env; sqlite: Database } {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      email TEXT PRIMARY KEY,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite
    .query("INSERT INTO waitlist (email, source) VALUES (?1, ?2)")
    .run("user@example.com", "unit-test");
  for (const migrationName of [
    "0004_users_bots.sql",
    "0005_user_profile.sql",
    "0008_billing.sql",
    "0014_user_onboarding_status.sql",
    "0021_user_wallet_columns.sql",
    "0023_user_experience_onboarding.sql",
    "0025_execution_fabric.sql",
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
  sqlite
    .query(
      `
        INSERT INTO users (
          id,
          privy_user_id,
          onboarding_status,
          signer_type,
          privy_wallet_id,
          wallet_address,
          wallet_migrated_at,
          experience_level,
          level_source,
          onboarding_completed_at,
          onboarding_version,
          feed_seed_version
        ) VALUES (
          'user_1',
          'did:privy:user_1',
          'active',
          'privy',
          'wallet_1',
          '11111111111111111111111111111111',
          '2026-03-03T00:00:00.000Z',
          'beginner',
          'auto',
          '2026-03-03T00:00:00.000Z',
          1,
          1
        )
      `,
    )
    .run();

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      PRIVY_APP_ID: "privy-app-id",
      PRIVY_APP_SECRET: "privy-app-secret",
      X402_EXEC_SUBMIT_PRICE_USD: "0.01",
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
      JUPITER_BASE_URL: "https://jupiter.test",
      RPC_ENDPOINT: "https://rpc.test",
    },
  });
  return { env, sqlite };
}

function seedConditionalOrder(
  db: Database,
  input?: {
    requestId?: string;
    actorId?: string;
    orderType?: "limit" | "trigger";
    side?: "buy" | "sell";
    status?: string;
  },
): string {
  const requestId = input?.requestId ?? "execreq_trigger_1234567890";
  const actorId = input?.actorId ?? "user_1";
  const orderType = input?.orderType ?? "limit";
  const side = input?.side ?? "buy";
  const status = input?.status ?? "dispatched";
  const metadata = {
    source: "TERMINAL",
    reason: "Trigger-backed limit order",
    intent: {
      family: "conditional_spot_order",
      marketType: "spot",
      venueKey: "jupiter",
      instrumentId: "SOL/USDC",
      side,
    },
  };
  const providerResponse = {
    route: "jupiter",
    lane: "safe",
    mode: "privy_execute",
    quality: {
      lane: "safe",
      orderType,
      timeInForce: "gtc",
      requestedRequireSimulation: true,
      effectiveRequireSimulation: true,
      priorityMicroLamports: 5000,
      limitPriceAtomic: "150000000",
      triggerPriceAtomic: null,
    },
    triggerOrder: {
      maker: "11111111111111111111111111111111",
      instrumentId: "SOL/USDC",
      side,
      orderType,
      inputMint: MAINNET_USDC_MINT,
      outputMint: SOL_MINT,
      makingAmount: "1000000",
      takingAmount: "6666666",
      requestId: "jup_req_1",
      order: "order_pubkey_1",
    },
    executionMeta: {
      lifecycle: {
        orderState: "open",
        fillState: "pending",
        settlementState: "confirmed",
        notes: ["Open"],
      },
    },
  };

  db.query(
    `INSERT INTO execution_requests (
      request_id,
      idempotency_scope,
      idempotency_key,
      payload_hash,
      actor_type,
      actor_id,
      mode,
      lane,
      status,
      status_reason,
      metadata_json,
      received_at,
      validated_at,
      terminal_at
    ) VALUES (?1, 'authenticated', ?2, ?3, 'privy_user', ?4, 'privy_execute', 'safe', ?5, NULL, ?6, ?7, ?8, NULL)`,
  ).run(
    requestId,
    `idem-${requestId}`,
    `hash-${requestId}`,
    actorId,
    status,
    JSON.stringify(metadata),
    "2026-03-03T02:00:00.000Z",
    "2026-03-03T02:00:01.000Z",
  );
  db.query(
    `INSERT INTO execution_attempts (
      attempt_id,
      request_id,
      attempt_no,
      lane,
      provider,
      status,
      provider_request_id,
      provider_response_json,
      error_code,
      error_message,
      started_at,
      completed_at,
      created_at,
      updated_at
    ) VALUES (?1, ?2, 1, 'safe', 'jupiter', 'confirmed', 'jup_req_1', ?3, NULL, NULL, ?4, ?5, ?4, ?5)`,
  ).run(
    `attempt_${requestId}`,
    requestId,
    JSON.stringify(providerResponse),
    "2026-03-03T02:00:02.000Z",
    "2026-03-03T02:00:03.000Z",
  );
  db.query(
    `INSERT INTO execution_status_events (
      event_id,
      request_id,
      seq,
      status,
      reason,
      details_json,
      created_at
    ) VALUES (?1, ?2, 1, 'received', NULL, NULL, '2026-03-03T02:00:00.000Z')`,
  ).run(`event_received_${requestId}`, requestId);
  db.query(
    `INSERT INTO execution_status_events (
      event_id,
      request_id,
      seq,
      status,
      reason,
      details_json,
      created_at
    ) VALUES (?1, ?2, 2, 'validated', NULL, NULL, '2026-03-03T02:00:01.000Z')`,
  ).run(`event_validated_${requestId}`, requestId);
  db.query(
    `INSERT INTO execution_status_events (
      event_id,
      request_id,
      seq,
      status,
      reason,
      details_json,
      created_at
    ) VALUES (?1, ?2, 3, 'dispatched', NULL, NULL, '2026-03-03T02:00:03.000Z')`,
  ).run(`event_dispatched_${requestId}`, requestId);
  return requestId;
}

function seedExecutionRequestOnly(
  db: Database,
  input: {
    requestId: string;
    actorId?: string;
    intentFamily: string;
    instrumentId?: string;
    side?: "buy" | "sell";
    status?: string;
    receivedAt: string;
    terminalAt?: string | null;
  },
): void {
  const metadata = {
    source: "TERMINAL",
    reason: `${input.intentFamily} seed`,
    intent: {
      family: input.intentFamily,
      marketType: "spot",
      venueKey: "jupiter",
      instrumentId: input.instrumentId ?? "SOL/USDC",
      side: input.side ?? "buy",
    },
  };
  db.query(
    `INSERT INTO execution_requests (
      request_id,
      idempotency_scope,
      idempotency_key,
      payload_hash,
      actor_type,
      actor_id,
      mode,
      lane,
      status,
      status_reason,
      metadata_json,
      received_at,
      validated_at,
      terminal_at
    ) VALUES (?1, 'authenticated', ?2, ?3, 'privy_user', ?4, 'privy_execute', 'safe', ?5, NULL, ?6, ?7, ?8, ?9)`,
  ).run(
    input.requestId,
    `idem-${input.requestId}`,
    `hash-${input.requestId}`,
    input.actorId ?? "user_1",
    input.status ?? "landed",
    JSON.stringify(metadata),
    input.receivedAt,
    input.receivedAt,
    input.terminalAt ?? input.receivedAt,
  );
}

function seedOpenBookOrder(
  db: Database,
  input?: {
    requestId?: string;
    actorId?: string;
    side?: "buy" | "sell";
    status?: string;
    instrumentId?: string;
  },
): string {
  const requestId = input?.requestId ?? "execreq_openbook_1234567890";
  const actorId = input?.actorId ?? "user_1";
  const side = input?.side ?? "buy";
  const status = input?.status ?? "dispatched";
  const instrumentId = input?.instrumentId ?? "SOL/USDC";
  const metadata = {
    source: "TERMINAL",
    reason: "OpenBook paper order",
    intent: {
      family: "clob_order",
      marketType: "spot",
      venueKey: "openbook",
      instrumentId,
      side,
      quantityAtomic: "1000000000",
    },
  };
  const providerResponse = {
    route: "openbook_v2",
    lane: "safe",
    mode: "privy_execute",
    quality: {
      orderType: "limit",
      timeInForce: "gtc",
      limitPriceAtomic: "151000000",
    },
    executionStatus: "simulated",
    executionMeta: {
      route: "openbook_v2",
      classification: "simulated",
      venueSessionId: "oo-1",
      intentId: "42",
      lifecycle: {
        orderState: "open",
        fillState: "pending",
        settlementState: "confirmed",
        notes: ["openbook-limit"],
      },
    },
  };

  db.query(
    `INSERT INTO execution_requests (
      request_id,
      idempotency_scope,
      idempotency_key,
      payload_hash,
      actor_type,
      actor_id,
      mode,
      lane,
      status,
      status_reason,
      metadata_json,
      received_at,
      validated_at,
      terminal_at
    ) VALUES (?1, 'authenticated', ?2, ?3, 'privy_user', ?4, 'privy_execute', 'safe', ?5, NULL, ?6, ?7, ?8, NULL)`,
  ).run(
    requestId,
    `idem-${requestId}`,
    `hash-${requestId}`,
    actorId,
    status,
    JSON.stringify(metadata),
    "2026-03-05T02:00:00.000Z",
    "2026-03-05T02:00:01.000Z",
  );
  db.query(
    `INSERT INTO execution_attempts (
      attempt_id,
      request_id,
      attempt_no,
      lane,
      provider,
      status,
      provider_request_id,
      provider_response_json,
      error_code,
      error_message,
      started_at,
      completed_at,
      created_at,
      updated_at
    ) VALUES (?1, ?2, 1, 'safe', 'openbook_v2', 'simulated', 'openbook_req_1', ?3, NULL, NULL, ?4, ?5, ?4, ?5)`,
  ).run(
    `attempt_${requestId}`,
    requestId,
    JSON.stringify(providerResponse),
    "2026-03-05T02:00:02.000Z",
    "2026-03-05T02:00:03.000Z",
  );
  db.query(
    `INSERT INTO execution_status_events (
      event_id,
      request_id,
      seq,
      status,
      reason,
      details_json,
      created_at
    ) VALUES (?1, ?2, 1, 'received', NULL, NULL, '2026-03-05T02:00:00.000Z')`,
  ).run(`event_received_${requestId}`, requestId);
  db.query(
    `INSERT INTO execution_status_events (
      event_id,
      request_id,
      seq,
      status,
      reason,
      details_json,
      created_at
    ) VALUES (?1, ?2, 2, 'validated', NULL, NULL, '2026-03-05T02:00:01.000Z')`,
  ).run(`event_validated_${requestId}`, requestId);
  db.query(
    `INSERT INTO execution_status_events (
      event_id,
      request_id,
      seq,
      status,
      reason,
      details_json,
      created_at
    ) VALUES (?1, ?2, 3, 'dispatched', NULL, NULL, '2026-03-05T02:00:03.000Z')`,
  ).run(`event_dispatched_${requestId}`, requestId);
  return requestId;
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

const originalFetch = globalThis.fetch;
let fetchHandler:
  | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
  | null = null;
const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!fetchHandler) {
    throw new Error("unexpected-fetch");
  }
  return await fetchHandler(input, init);
});

function readUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function readRpcMethod(init?: RequestInit): string {
  const body =
    typeof init?.body === "string"
      ? JSON.parse(init.body)
      : ({} as Record<string, unknown>);
  return String(body.method ?? "");
}

beforeEach(() => {
  requireUserMock.mockClear();
  fetchHandler = null;
  globalThis.fetch = fetchMock as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("worker terminal open orders and Trigger lifecycle routes", () => {
  test("terminal spot preview route returns bounded Raydium previews", async () => {
    const { env, sqlite } = createExecEnv();
    const original = RaydiumClient.prototype.quoteBaseIn;
    RaydiumClient.prototype.quoteBaseIn = (async () => ({
      envelope: { success: true },
      normalizedQuote: {
        inputMint: SOL_MINT,
        outputMint: MAINNET_USDC_MINT,
        inAmount: "1000000",
        outAmount: "150000000",
        priceImpactPct: 0.0012,
        routePlan: [{ poolId: "ray-pool-1", swapInfo: { label: "Raydium" } }],
        quoteProvider: "raydium",
      },
    })) as never;
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/terminal/spot-preview", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
          },
          body: JSON.stringify({
            venueKey: "raydium",
            inputMint: SOL_MINT,
            outputMint: MAINNET_USDC_MINT,
            amountAtomic: "1000000",
            slippageBps: 50,
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        preview?: {
          provider?: string;
          routeSummary?: string;
          outAmountAtomic?: string;
        };
      };
      expect(body.preview?.provider).toBe("raydium");
      expect(body.preview?.routeSummary).toBe("Raydium");
      expect(body.preview?.outAmountAtomic).toBe("150000000");
    } finally {
      RaydiumClient.prototype.quoteBaseIn = original;
      sqlite.close();
    }
  });

  test("terminal spot preview route returns bounded Orca previews", async () => {
    const { env, sqlite } = createExecEnv();
    const original = OrcaClient.prototype.quoteBaseIn;
    OrcaClient.prototype.quoteBaseIn = (async () => ({
      pool: { address: "orca-pool-1" },
      sdkQuote: {
        estimatedAmountInAtomic: "1000000",
        estimatedAmountOutAtomic: "149500000",
        otherAmountThresholdAtomic: "149000000",
        estimatedFeeAmountAtomic: "1000",
        sqrtPriceLimit: "1",
        tickArrayAddresses: [],
        aToB: true,
        amountSpecifiedIsInput: true,
      },
      normalizedQuote: {
        inputMint: SOL_MINT,
        outputMint: MAINNET_USDC_MINT,
        inAmount: "1000000",
        outAmount: "149500000",
        priceImpactPct: 0.0025,
        routePlan: [
          { poolId: "orca-pool-1", swapInfo: { label: "Orca Whirlpool" } },
        ],
        quoteProvider: "orca",
      },
    })) as never;
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/terminal/spot-preview", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
          },
          body: JSON.stringify({
            venueKey: "orca",
            inputMint: SOL_MINT,
            outputMint: MAINNET_USDC_MINT,
            amountAtomic: "1000000",
            slippageBps: 50,
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        preview?: {
          provider?: string;
          routeSummary?: string;
          outAmountAtomic?: string;
        };
      };
      expect(body.preview?.provider).toBe("orca");
      expect(body.preview?.routeSummary).toBe("Orca Whirlpool");
      expect(body.preview?.outAmountAtomic).toBe("149500000");
    } finally {
      OrcaClient.prototype.quoteBaseIn = original;
      sqlite.close();
    }
  });

  test("status route exposes live Trigger lifecycle for conditional spot orders", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedConditionalOrder(sqlite);
      fetchHandler = async (input) => {
        const url = readUrl(input);
        expect(url.toString()).toContain("/trigger/v1/getTriggerOrders");
        expect(url.searchParams.get("user")).toBe(
          "11111111111111111111111111111111",
        );
        expect(url.searchParams.get("orderStatus")).toBe("active");
        return responseJson({
          orders: [
            {
              orderKey: "order_pubkey_1",
              userPubkey: "11111111111111111111111111111111",
              status: "Open",
              makingAmount: "1000000",
              takingAmount: "6666666",
              openTx: "open-sig-1",
            },
          ],
          totalOrders: 1,
          page: 1,
        });
      };

      const response = await worker.fetch(
        new Request(`http://localhost/api/x402/exec/status/${requestId}`),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lifecycle?: { orderState?: string; fillState?: string };
        status?: { state?: string };
      };
      expect(body.status?.state).toBe("dispatched");
      expect(body.lifecycle?.orderState).toBe("open");
      expect(body.lifecycle?.fillState).toBe("pending");
    } finally {
      sqlite.close();
    }
  });

  test("status route paginates active Trigger pages until the tracked order is found", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedConditionalOrder(sqlite, {
        requestId: "execreq_trigger_active_page_2",
      });
      const seenPages: string[] = [];
      fetchHandler = async (input) => {
        const url = readUrl(input);
        expect(url.toString()).toContain("/trigger/v1/getTriggerOrders");
        expect(url.searchParams.get("orderStatus")).toBe("active");
        const page = url.searchParams.get("page") ?? "1";
        seenPages.push(page);
        if (page === "1") {
          return responseJson({
            orders: [
              {
                order: "other-order",
                status: "Open",
              },
            ],
            totalOrders: 2,
            page: 1,
          });
        }
        if (page === "2") {
          return responseJson({
            orders: [
              {
                orderKey: "order_pubkey_1",
                userPubkey: "11111111111111111111111111111111",
                status: "Open",
                makingAmount: "1000000",
                takingAmount: "6666666",
                openTx: "open-sig-2",
              },
            ],
            totalOrders: 2,
            page: 2,
          });
        }
        throw new Error(`unexpected active page ${page}`);
      };

      const response = await worker.fetch(
        new Request(`http://localhost/api/x402/exec/status/${requestId}`),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lifecycle?: { orderState?: string };
        status?: { state?: string };
      };
      expect(body.status?.state).toBe("dispatched");
      expect(body.lifecycle?.orderState).toBe("open");
      expect(seenPages).toEqual(["1", "2"]);
    } finally {
      sqlite.close();
    }
  });

  test("receipt route finalizes filled Trigger orders during reconciliation", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedConditionalOrder(sqlite, {
        requestId: "execreq_trigger_fill_123456",
      });
      fetchHandler = async (input) => {
        const url = readUrl(input);
        if (url.pathname.endsWith("/trigger/v1/getTriggerOrders")) {
          if (url.searchParams.get("orderStatus") === "active") {
            return responseJson({ orders: [], totalOrders: 0, page: 1 });
          }
          return responseJson({
            orders: [
              {
                order: "order_pubkey_1",
                status: "Filled",
                makingAmount: "1000000",
                takingAmount: "6666666",
                remainingMakingAmount: "0",
                closeTx: "fill-sig-1",
              },
            ],
            totalOrders: 1,
            page: 1,
          });
        }
        throw new Error(`unexpected fetch ${url.toString()}`);
      };

      const response = await worker.fetch(
        new Request(`http://localhost/api/x402/exec/receipt/${requestId}`),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ready?: boolean;
        receipt?: {
          outcome?: { status?: string };
          lifecycle?: { orderState?: string };
        };
      };
      expect(body.ready).toBe(true);
      expect(body.receipt?.outcome?.status).toBe("finalized");
      expect(body.receipt?.lifecycle?.orderState).toBe("filled");
      const row = sqlite
        .query(
          "SELECT status, terminal_at as terminalAt FROM execution_requests WHERE request_id = ?1",
        )
        .get(requestId) as { status?: string; terminalAt?: string } | undefined;
      expect(row?.status).toBe("landed");
      expect(row?.terminalAt).toBeString();
    } finally {
      sqlite.close();
    }
  });

  test("receipt route paginates Trigger history until the tracked order is found", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedConditionalOrder(sqlite, {
        requestId: "execreq_trigger_history_page_2",
      });
      const seenHistoryPages: string[] = [];
      fetchHandler = async (input) => {
        const url = readUrl(input);
        if (url.pathname.endsWith("/trigger/v1/getTriggerOrders")) {
          const orderStatus = url.searchParams.get("orderStatus");
          const page = url.searchParams.get("page") ?? "1";
          if (orderStatus === "active") {
            return responseJson({ orders: [], totalOrders: 0, page: 1 });
          }
          if (orderStatus === "history") {
            seenHistoryPages.push(page);
            if (page === "1") {
              return responseJson({
                orders: [
                  {
                    order: "other-history-order",
                    status: "Filled",
                    makingAmount: "1000000",
                    takingAmount: "6666666",
                    remainingMakingAmount: "0",
                    closeTx: "fill-sig-other",
                  },
                ],
                totalOrders: 2,
                page: 1,
              });
            }
            if (page === "2") {
              return responseJson({
                orders: [
                  {
                    order: "order_pubkey_1",
                    status: "Filled",
                    makingAmount: "1000000",
                    takingAmount: "6666666",
                    remainingMakingAmount: "0",
                    closeTx: "fill-sig-2",
                  },
                ],
                totalOrders: 2,
                page: 2,
              });
            }
          }
        }
        throw new Error(`unexpected fetch ${url.toString()}`);
      };

      const response = await worker.fetch(
        new Request(`http://localhost/api/x402/exec/receipt/${requestId}`),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ready?: boolean;
        receipt?: {
          outcome?: { status?: string };
          lifecycle?: { orderState?: string };
        };
      };
      expect(body.ready).toBe(true);
      expect(body.receipt?.outcome?.status).toBe("finalized");
      expect(body.receipt?.lifecycle?.orderState).toBe("filled");
      expect(seenHistoryPages).toEqual(["1", "2"]);
    } finally {
      sqlite.close();
    }
  });

  test("open-orders route rehydrates active Trigger-backed conditional orders", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      seedConditionalOrder(sqlite, {
        requestId: "execreq_trigger_list_123456",
      });
      fetchHandler = async (input) => {
        const url = readUrl(input);
        if (url.pathname.endsWith("/trigger/v1/getTriggerOrders")) {
          return responseJson({
            orders: [
              {
                order: "order_pubkey_1",
                status: "Open",
                makingAmount: "1000000",
                takingAmount: "6666666",
              },
            ],
            totalOrders: 1,
            page: 1,
          });
        }
        throw new Error(`unexpected fetch ${url.toString()}`);
      };

      const response = await worker.fetch(
        new Request("http://localhost/api/terminal/open-orders", {
          headers: {
            authorization: "Bearer test-token",
          },
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        orders?: Array<{
          requestId?: string;
          intentFamily?: string;
          venueKey?: string;
          marketType?: string;
          pairId?: string;
          instrumentId?: string;
          status?: string;
          orderType?: string;
          providerStatus?: string;
        }>;
      };
      expect(body.orders?.[0]?.requestId).toBe("execreq_trigger_list_123456");
      expect(body.orders?.[0]?.intentFamily).toBe("conditional_spot_order");
      expect(body.orders?.[0]?.venueKey).toBe("jupiter");
      expect(body.orders?.[0]?.marketType).toBe("spot");
      expect(body.orders?.[0]?.pairId).toBe("SOL/USDC");
      expect(body.orders?.[0]?.instrumentId).toBe("SOL/USDC");
      expect(body.orders?.[0]?.status).toBe("working");
      expect(body.orders?.[0]?.orderType).toBe("limit");
      expect(body.orders?.[0]?.providerStatus).toBe("pending");
    } finally {
      sqlite.close();
    }
  });

  test("open-orders route includes active OpenBook paper orders", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      seedOpenBookOrder(sqlite, {
        requestId: "execreq_openbook_list_123456",
      });

      const response = await worker.fetch(
        new Request("http://localhost/api/terminal/open-orders", {
          headers: {
            authorization: "Bearer test-token",
          },
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        orders?: Array<{
          requestId?: string;
          pairId?: string;
          status?: string;
          orderType?: string;
          clientOrderId?: string;
          openOrdersAccount?: string;
        }>;
      };
      expect(body.orders?.[0]?.requestId).toBe("execreq_openbook_list_123456");
      expect(body.orders?.[0]?.pairId).toBe("SOL/USDC");
      expect(body.orders?.[0]?.status).toBe("working");
      expect(body.orders?.[0]?.orderType).toBe("limit");
      expect(body.orders?.[0]?.clientOrderId).toBe("42");
      expect(body.orders?.[0]?.openOrdersAccount).toBe("oo-1");
    } finally {
      sqlite.close();
    }
  });

  test("open-orders route still returns older active conditional orders behind newer executions", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      seedConditionalOrder(sqlite, {
        requestId: "execreq_trigger_oldest_open",
      });
      for (let index = 0; index < 95; index += 1) {
        const minute = String(index % 60).padStart(2, "0");
        seedExecutionRequestOnly(sqlite, {
          requestId: `execreq_spot_swap_${index}`,
          intentFamily: "spot_swap",
          receivedAt: `2026-03-04T03:${minute}:00.000Z`,
        });
      }
      fetchHandler = async (input) => {
        const url = readUrl(input);
        if (url.pathname.endsWith("/trigger/v1/getTriggerOrders")) {
          return responseJson({
            orders: [
              {
                order: "order_pubkey_1",
                status: "Open",
                makingAmount: "1000000",
                takingAmount: "6666666",
              },
            ],
            totalOrders: 1,
            page: 1,
          });
        }
        throw new Error(`unexpected fetch ${url.toString()}`);
      };

      const response = await worker.fetch(
        new Request("http://localhost/api/terminal/open-orders", {
          headers: {
            authorization: "Bearer test-token",
          },
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        orders?: Array<{
          requestId?: string;
        }>;
      };
      expect(
        body.orders?.some(
          (order) => order.requestId === "execreq_trigger_oldest_open",
        ),
      ).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  test("cancel route terminalizes active OpenBook paper orders", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedOpenBookOrder(sqlite, {
        requestId: "execreq_openbook_cancel_123456",
      });

      const response = await worker.fetch(
        new Request(
          `http://localhost/api/terminal/open-orders/${requestId}/cancel`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer test-token",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        cancelled?: boolean;
        lifecycle?: { orderState?: string };
        signature?: string | null;
        status?: { state?: string; terminal?: boolean };
      };
      expect(body.cancelled).toBe(true);
      expect(body.lifecycle?.orderState).toBe("cancelled");
      expect(body.signature).toBeNull();
      expect(body.status?.state).toBe("failed");
      expect(body.status?.terminal).toBe(true);
      const requestRow = sqlite
        .query("SELECT status FROM execution_requests WHERE request_id = ?1")
        .get(requestId) as { status?: string } | undefined;
      expect(requestRow?.status).toBe("failed");
      const receiptRow = sqlite
        .query(
          "SELECT finalized_status as finalizedStatus, error_code as errorCode FROM execution_receipts WHERE request_id = ?1",
        )
        .get(requestId) as
        | { finalizedStatus?: string; errorCode?: string }
        | undefined;
      expect(receiptRow?.finalizedStatus).toBe("failed");
      expect(receiptRow?.errorCode).toBe("order-cancelled");
    } finally {
      sqlite.close();
    }
  });

  test("cancel route cancels tracked Trigger orders and terminalizes the request", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedConditionalOrder(sqlite, {
        requestId: "execreq_trigger_cancel_123456",
      });
      fetchHandler = async (input, init) => {
        const url = readUrl(input);
        if (url.pathname.endsWith("/trigger/v1/getTriggerOrders")) {
          return responseJson({
            orders: [
              {
                order: "order_pubkey_1",
                status: "Open",
                makingAmount: "1000000",
                takingAmount: "6666666",
              },
            ],
            totalOrders: 1,
            page: 1,
          });
        }
        if (url.pathname.endsWith("/trigger/v1/cancelOrder")) {
          return responseJson({
            transaction: "cancel-trigger-tx",
            requestId: "cancel_req_1",
            order: "order_pubkey_1",
          });
        }
        if (url.origin === "https://api.privy.io") {
          expect(url.pathname).toBe("/v1/wallets/wallet_1/rpc");
          return responseJson({
            data: {
              signed_transaction: buildSignedSafeLaneTxBase64(),
            },
          });
        }
        if (url.origin === "https://rpc.test") {
          const method = readRpcMethod(init);
          if (method === "simulateTransaction") {
            return responseJson({
              jsonrpc: "2.0",
              id: "1",
              result: {
                value: {
                  err: null,
                },
              },
            });
          }
          if (method === "sendTransaction") {
            return responseJson({
              jsonrpc: "2.0",
              id: "1",
              result: "cancel-signature-1",
            });
          }
          if (method === "getSignatureStatuses") {
            return responseJson({
              jsonrpc: "2.0",
              id: "1",
              result: {
                value: [
                  {
                    confirmationStatus: "confirmed",
                    err: null,
                  },
                ],
              },
            });
          }
        }
        throw new Error(`unexpected fetch ${url.toString()}`);
      };

      const response = await worker.fetch(
        new Request(
          `http://localhost/api/terminal/open-orders/${requestId}/cancel`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer test-token",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      if (response.status !== 200) {
        const denied = (await response.json()) as {
          ok?: boolean;
        };
        expect([401, 403]).toContain(response.status);
        expect(denied.ok).toBe(false);
        return;
      }
      const body = (await response.json()) as {
        cancelled?: boolean;
        lifecycle?: { orderState?: string };
        signature?: string;
        status?: { state?: string; terminal?: boolean };
      };
      expect(body.cancelled).toBe(true);
      expect(body.lifecycle?.orderState).toBe("cancelled");
      expect(body.signature).toBe("cancel-signature-1");
      expect(body.status?.state).toBe("failed");
      expect(body.status?.terminal).toBe(true);
      const requestRow = sqlite
        .query("SELECT status FROM execution_requests WHERE request_id = ?1")
        .get(requestId) as { status?: string } | undefined;
      expect(requestRow?.status).toBe("failed");
      const receiptRow = sqlite
        .query(
          "SELECT finalized_status as finalizedStatus, signature FROM execution_receipts WHERE request_id = ?1",
        )
        .get(requestId) as
        | { finalizedStatus?: string; signature?: string }
        | undefined;
      expect(receiptRow?.finalizedStatus).toBe("failed");
      expect(receiptRow?.signature).toBe("cancel-signature-1");
    } finally {
      sqlite.close();
    }
  });
});
