import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Env } from "../../apps/worker/src/types";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
} from "../integration/_worker_live_test_utils";
import { buildRelaySignedPayload } from "./_relay_signed_test_utils";

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

function createExecReceiptEnv(): {
  env: Env;
  sqlite: Database;
  receiptWrites: Array<{ key: string; value: string }>;
} {
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

  const receiptWrites: Array<{ key: string; value: string }> = [];
  const logsBucket = {
    async put(key: string, value: string) {
      receiptWrites.push({ key, value });
      return null;
    },
    async get() {
      return null;
    },
    async head() {
      return null;
    },
  } as unknown as R2Bucket;

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      LOGS_BUCKET: logsBucket,
      PRIVY_APP_ID: "privy-app-id",
      X402_EXEC_SUBMIT_PRICE_USD: "0.01",
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
    },
  });
  return { env, sqlite, receiptWrites };
}

describe("worker x402 exec receipt route", () => {
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

  test("returns deterministic errors for invalid and unknown request ids", async () => {
    const { env, sqlite } = createExecReceiptEnv();
    try {
      const invalid = await worker.fetch(
        new Request("http://localhost/api/x402/exec/receipt/not_valid"),
        env,
        createExecutionContextStub(),
      );
      expect(invalid.status).toBe(400);
      expect((await invalid.json())?.error).toBe("invalid-request-id");

      const unknown = await worker.fetch(
        new Request(
          "http://localhost/api/x402/exec/receipt/execreq_1234567890abcdef",
        ),
        env,
        createExecutionContextStub(),
      );
      expect(unknown.status).toBe(404);
      expect((await unknown.json())?.error).toBe("not-found");
    } finally {
      sqlite.close();
    }
  });

  test("returns ready=false for non-terminal requests", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecReceiptEnv();
    try {
      const submit = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-receipt-1",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submit.status).toBe(200);
      const submitBody = (await submit.json()) as { requestId: string };

      const receipt = await worker.fetch(
        new Request(
          `http://localhost/api/x402/exec/receipt/${submitBody.requestId}`,
          {
            headers: {
              "payment-signature": "ignored-on-receipt",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(receipt.status).toBe(200);
      expect(receipt.headers.get("payment-required")).toBeNull();
      expect(receipt.headers.get("payment-response")).toBeNull();
      const body = (await receipt.json()) as {
        ok?: boolean;
        ready?: boolean;
        status?: {
          state?: string;
          terminal?: boolean;
          immutability?: {
            hashAlgorithm?: string;
            receivedTxHash?: string;
          };
        };
      };
      expect(body.ok).toBe(true);
      expect(body.ready).toBe(false);
      expect(body.status?.state).toBe("validated");
      expect(body.status?.terminal).toBe(false);
      expect(body.status?.immutability?.hashAlgorithm).toBe("sha256");
      expect(body.status?.immutability?.receivedTxHash).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
    } finally {
      sqlite.close();
    }
  });

  test("returns canonical receipt when available", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite, receiptWrites } = createExecReceiptEnv();
    try {
      const submit = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-receipt-2",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submit.status).toBe(200);
      const submitBody = (await submit.json()) as { requestId: string };

      sqlite
        .query(
          `
          UPDATE execution_requests
          SET status = 'landed',
              terminal_at = ?2,
              updated_at = ?2
          WHERE request_id = ?1
          `,
        )
        .run(submitBody.requestId, "2026-03-03T03:00:02.000Z");
      sqlite
        .query(
          `
          INSERT INTO execution_attempts (
            attempt_id,
            request_id,
            attempt_no,
            lane,
            provider,
            status,
            started_at,
            completed_at,
            created_at,
            updated_at
          ) VALUES (?1, ?2, 1, 'fast', 'helius_sender', 'landed', ?3, ?4, ?3, ?4)
          `,
        )
        .run(
          "attempt_receipt_1",
          submitBody.requestId,
          "2026-03-03T03:00:00.000Z",
          "2026-03-03T03:00:02.000Z",
        );
      sqlite
        .query(
          `
          INSERT INTO execution_receipts (
            request_id,
            receipt_id,
            schema_version,
            finalized_status,
            lane,
            provider,
            signature,
            slot,
            error_code,
            error_message,
            receipt_json,
            ready_at,
            created_at,
            updated_at
          ) VALUES (?1, ?2, 'v1', 'landed', 'fast', 'helius_sender', ?3, 123, NULL, NULL, NULL, ?4, ?4, ?4)
          `,
        )
        .run(
          submitBody.requestId,
          "exec_abcdef1234567890",
          "11111111111111111111111111111111",
          "2026-03-03T03:00:03.000Z",
        );

      const receipt = await worker.fetch(
        new Request(
          `http://localhost/api/x402/exec/receipt/${submitBody.requestId}`,
        ),
        env,
        createExecutionContextStub(),
      );
      expect(receipt.status).toBe(200);
      const body = (await receipt.json()) as {
        ready?: boolean;
        receipt?: {
          schemaVersion?: string;
          receiptId?: string;
          mode?: string;
          lane?: string;
          actorType?: string;
          provider?: string;
          generatedAt?: string;
          outcome?: {
            status?: string;
            signature?: string | null;
            errorCode?: string | null;
          };
          trace?: {
            receivedAt?: string;
            validatedAt?: string | null;
            dispatchedAt?: string | null;
            landedAt?: string | null;
            terminalAt?: string | null;
          };
          immutability?: {
            hashAlgorithm?: string;
            receivedTxHash?: string;
            submittedTxHash?: string;
            verifiedTxHash?: string;
          };
        };
      };
      expect(body.ready).toBe(true);
      expect(body.receipt?.schemaVersion).toBe("v1");
      expect(body.receipt?.receiptId).toBe("exec_abcdef1234567890");
      expect(body.receipt?.mode).toBe("relay_signed");
      expect(body.receipt?.lane).toBe("fast");
      expect(body.receipt?.actorType).toBe("anonymous_x402");
      expect(body.receipt?.provider).toBe("helius_sender");
      expect(body.receipt?.generatedAt).toBe("2026-03-03T03:00:03.000Z");
      expect(body.receipt?.outcome?.status).toBe("finalized");
      expect(body.receipt?.outcome?.signature).toBe(
        "11111111111111111111111111111111",
      );
      expect(body.receipt?.outcome?.errorCode).toBeNull();
      expect(body.receipt?.trace?.receivedAt).toBeString();
      expect(body.receipt?.trace?.validatedAt).toBeString();
      expect(body.receipt?.trace?.dispatchedAt).toBe(
        "2026-03-03T03:00:00.000Z",
      );
      expect(body.receipt?.trace?.landedAt).toBe("2026-03-03T03:00:03.000Z");
      expect(body.receipt?.trace?.terminalAt).toBe("2026-03-03T03:00:02.000Z");
      expect(body.receipt?.immutability?.hashAlgorithm).toBe("sha256");
      expect(body.receipt?.immutability?.receivedTxHash).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
      expect(body.receipt?.immutability?.submittedTxHash).toBe(
        body.receipt?.immutability?.receivedTxHash,
      );
      expect(body.receipt?.immutability?.verifiedTxHash).toBe(
        body.receipt?.immutability?.receivedTxHash,
      );
      expect(receiptWrites.length).toBe(1);
      expect(receiptWrites[0]?.key).toBe(
        `exec/v1/receipts/request_id=${submitBody.requestId}.json`,
      );
      const persisted = JSON.parse(String(receiptWrites[0]?.value ?? "{}")) as {
        receiptId?: string;
        requestId?: string;
      };
      expect(persisted.receiptId).toBe("exec_abcdef1234567890");
      expect(persisted.requestId).toBe(submitBody.requestId);
    } finally {
      sqlite.close();
    }
  });
});
