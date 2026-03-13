import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
const findUserByPrivyUserIdMock = mock(async () => ({
  id: "user_1",
  privyUserId: "did:privy:user_1",
  onboardingStatus: "active",
  profile: null,
  signerType: "privy",
  privyWalletId: "wallet_1",
  walletAddress: "11111111111111111111111111111111",
  walletMigratedAt: "2026-03-03T00:00:00.000Z",
  experienceLevel: "beginner",
  levelSource: "auto",
  onboardingCompletedAt: "2026-03-03T00:00:00.000Z",
  onboardingVersion: 1,
  feedSeedVersion: 1,
  degenAcknowledgedAt: null,
  createdAt: "2026-03-03T00:00:00.000Z",
}));
const upsertUserMock = mock(async () =>
  findUserByPrivyUserIdMock("did:privy:user_1"),
);
const setUserWalletMock = mock(async () => {});
const setUserProfileMock = mock(async () => {});
const setUserOnboardingStatusMock = mock(async () => {});
const setUserExperienceMock = mock(async () => {});
const createPrivySolanaWalletMock = mock(async () => ({
  walletId: "wallet_new",
  address: "11111111111111111111111111111111",
}));
const getPrivyWalletAddressByIdMock = mock(
  async () => "11111111111111111111111111111111",
);
const getPrivyWalletAddressMock = mock(
  async () => "11111111111111111111111111111111",
);
const getPrivyUserByIdMock = mock(async () => ({
  id: "did:privy:user_1",
  linked_accounts: [],
}));
const signTransactionWithPrivyByIdMock = mock(async () => "signed-trigger-tx");
const evaluateSafeLaneTransactionMock = mock(() => ({
  ok: true,
  profile: {
    txSizeBytes: 128,
    instructionCount: 2,
    accountKeyCount: 6,
    addressTableLookupCount: 0,
    signatureCount: 1,
    computeUnitLimit: 200_000,
    computeUnitPriceMicroLamports: "5000",
    estimatedFeeLamports: "6000",
  },
  limits: {
    maxTxBytes: 1232,
    maxInstructionCount: 24,
    maxAccountKeys: 96,
    maxComputeUnitLimit: 1_400_000,
    maxEstimatedFeeLamports: "2000000",
  },
}));

mock.module("../../apps/worker/src/auth", () => ({
  requireUser: requireUserMock,
}));
mock.module("../../apps/worker/src/users_db", () => ({
  findUserByPrivyUserId: findUserByPrivyUserIdMock,
  upsertUser: upsertUserMock,
  setUserWallet: setUserWalletMock,
  setUserProfile: setUserProfileMock,
  setUserOnboardingStatus: setUserOnboardingStatusMock,
  setUserExperience: setUserExperienceMock,
}));
mock.module("../../apps/worker/src/privy", () => ({
  createPrivySolanaWallet: createPrivySolanaWalletMock,
  getPrivyWalletAddressById: getPrivyWalletAddressByIdMock,
  getPrivyWalletAddress: getPrivyWalletAddressMock,
  getPrivyUserById: getPrivyUserByIdMock,
  signTransactionWithPrivyById: signTransactionWithPrivyByIdMock,
}));
mock.module("../../apps/worker/src/execution/safe_lane_policy", () => ({
  evaluateSafeLaneTransaction: evaluateSafeLaneTransactionMock,
}));

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
  const migrationPath = resolve(
    import.meta.dir,
    "..",
    "..",
    "apps/worker/migrations/0025_execution_fabric.sql",
  );
  sqlite.exec(readFileSync(migrationPath, "utf8"));

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      PRIVY_APP_ID: "privy-app-id",
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
  findUserByPrivyUserIdMock.mockClear();
  upsertUserMock.mockClear();
  setUserWalletMock.mockClear();
  setUserProfileMock.mockClear();
  setUserOnboardingStatusMock.mockClear();
  setUserExperienceMock.mockClear();
  createPrivySolanaWalletMock.mockClear();
  getPrivyWalletAddressByIdMock.mockClear();
  getPrivyWalletAddressMock.mockClear();
  getPrivyUserByIdMock.mockClear();
  signTransactionWithPrivyByIdMock.mockClear();
  evaluateSafeLaneTransactionMock.mockClear();
  fetchHandler = null;
  globalThis.fetch = fetchMock as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("worker terminal open orders and Trigger lifecycle routes", () => {
  test("status route exposes live Trigger lifecycle for conditional spot orders", async () => {
    const { env, sqlite } = createExecEnv();
    try {
      const requestId = seedConditionalOrder(sqlite);
      fetchHandler = async (input) => {
        const url = readUrl(input);
        expect(url.toString()).toContain("/trigger/v1/getTriggerOrders");
        expect(url.searchParams.get("orderStatus")).toBe("active");
        return responseJson({
          orders: [
            {
              order: "order_pubkey_1",
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
          pairId?: string;
          status?: string;
          orderType?: string;
        }>;
      };
      expect(body.orders?.[0]?.requestId).toBe("execreq_trigger_list_123456");
      expect(body.orders?.[0]?.pairId).toBe("SOL/USDC");
      expect(body.orders?.[0]?.status).toBe("working");
      expect(body.orders?.[0]?.orderType).toBe("limit");
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
      expect(response.status).toBe(200);
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
