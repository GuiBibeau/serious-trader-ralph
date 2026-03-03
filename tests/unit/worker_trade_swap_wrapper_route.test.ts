import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, mock, test } from "bun:test";
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
const signTransactionWithPrivyByIdMock = mock(async () => "signed-tx");

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

function createTradeSwapEnv(): { env: Env; sqlite: Database } {
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
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
    },
  });
  return { env, sqlite };
}

describe("worker trade swap compatibility wrapper route", () => {
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
  });

  test("wraps /api/trade/swap into privy_execute submit + compatibility response", async () => {
    const { env, sqlite } = createTradeSwapEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/trade/swap", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            inputMint: SOL_MINT,
            outputMint: MAINNET_USDC_MINT,
            amount: "1000000",
            slippageBps: 50,
            source: "TERMINAL",
            reason: "manual",
          }),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok?: boolean;
        requestId?: string;
        status?: string;
        signature?: string | null;
        executionReceipt?: unknown;
        compatibility?: { replacement?: string };
        poll?: { statusUrl?: string; receiptUrl?: string };
      };
      expect(body.ok).toBe(true);
      expect(body.requestId).toMatch(/^execreq_[A-Za-z0-9]{16,}$/);
      expect(body.status).toBe("validated");
      expect(body.signature).toBeNull();
      expect(body.executionReceipt).toBeNull();
      expect(body.compatibility?.replacement).toBe("/api/x402/exec/submit");
      expect(body.poll?.statusUrl).toBe(
        `/api/x402/exec/status/${body.requestId}`,
      );
      expect(body.poll?.receiptUrl).toBe(
        `/api/x402/exec/receipt/${body.requestId}`,
      );

      const requestRow = sqlite
        .query(
          `
          SELECT mode, lane, metadata_json as metadataJson
          FROM execution_requests
          WHERE request_id = ?1
          LIMIT 1
          `,
        )
        .get(body.requestId) as
        | {
            mode?: string;
            lane?: string;
            metadataJson?: string;
          }
        | undefined;
      expect(requestRow?.mode).toBe("privy_execute");
      expect(requestRow?.lane).toBe("fast");
      const metadata = JSON.parse(String(requestRow?.metadataJson ?? "{}")) as {
        source?: string;
        reason?: string;
      };
      expect(metadata.source).toBe("TERMINAL");
      expect(metadata.reason).toBe("manual");

      const lifecycle = sqlite
        .query(
          `
          SELECT status
          FROM execution_status_events
          WHERE request_id = ?1
          ORDER BY seq ASC
          `,
        )
        .all(body.requestId) as Array<{ status?: string }>;
      expect(lifecycle.map((event) => event.status)).toEqual([
        "received",
        "validated",
      ]);
    } finally {
      sqlite.close();
    }
  });

  test("maps legacy execution.adapter to protected lane", async () => {
    const { env, sqlite } = createTradeSwapEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/trade/swap", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            inputMint: SOL_MINT,
            outputMint: MAINNET_USDC_MINT,
            amount: "1000000",
            execution: {
              adapter: "jito_bundle",
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { requestId?: string };
      const row = sqlite
        .query(
          "SELECT lane FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(body.requestId) as { lane?: string } | undefined;
      expect(row?.lane).toBe("protected");
    } finally {
      sqlite.close();
    }
  });

  test("keeps compatibility errors for invalid and unsupported trade payloads", async () => {
    const { env, sqlite } = createTradeSwapEnv();
    try {
      const invalid = await worker.fetch(
        new Request("http://localhost/api/trade/swap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            inputMint: SOL_MINT,
            outputMint: SOL_MINT,
            amount: "1000000",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(invalid.status).toBe(400);
      expect((await invalid.json())?.error).toBe("invalid-trade-request");

      const unsupported = await worker.fetch(
        new Request("http://localhost/api/trade/swap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            inputMint: SOL_MINT,
            outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            amount: "1000000",
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(unsupported.status).toBe(400);
      expect((await unsupported.json())?.error).toBe("unsupported-trade-pair");
    } finally {
      sqlite.close();
    }
  });
});
