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

function createExecStatusEnv(): { env: Env; sqlite: Database } {
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
    },
  });
  return { env, sqlite };
}

describe("worker x402 exec status route", () => {
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

  test("returns deterministic errors for invalid or unknown request ids", async () => {
    const { env, sqlite } = createExecStatusEnv();
    try {
      const invalid = await worker.fetch(
        new Request("http://localhost/api/x402/exec/status/not_valid"),
        env,
        createExecutionContextStub(),
      );
      expect(invalid.status).toBe(400);
      const invalidBody = (await invalid.json()) as {
        error?: { code?: string; details?: { reason?: string } };
      };
      expect(invalidBody.error?.code).toBe("invalid-request");
      expect(invalidBody.error?.details?.reason).toBe("invalid-request-id");

      const unknown = await worker.fetch(
        new Request(
          "http://localhost/api/x402/exec/status/execreq_1234567890abcdef",
        ),
        env,
        createExecutionContextStub(),
      );
      expect(unknown.status).toBe(404);
      const unknownBody = (await unknown.json()) as {
        error?: { code?: string };
      };
      expect(unknownBody.error?.code).toBe("not-found");
    } finally {
      sqlite.close();
    }
  });

  test("returns ordered timeline and latest status after submit", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecStatusEnv();
    try {
      const submit = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-status-1",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(submit.status).toBe(200);
      const submitBody = (await submit.json()) as { requestId: string };

      const status = await worker.fetch(
        new Request(
          `http://localhost/api/x402/exec/status/${submitBody.requestId}`,
          {
            headers: {
              "payment-signature": "ignored-on-status",
            },
          },
        ),
        env,
        createExecutionContextStub(),
      );
      expect(status.status).toBe(200);
      expect(status.headers.get("payment-required")).toBeNull();
      expect(status.headers.get("payment-response")).toBeNull();
      const body = (await status.json()) as {
        ok?: boolean;
        status?: {
          state?: string;
          terminal?: boolean;
          mode?: string;
          lane?: string;
          actorType?: string;
          immutability?: {
            hashAlgorithm?: string;
            receivedTxHash?: string;
            submittedTxHash?: string;
            verifiedTxHash?: string;
          };
        };
        events?: Array<{ state?: string; at?: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.status?.state).toBe("validated");
      expect(body.status?.terminal).toBe(false);
      expect(body.status?.mode).toBe("relay_signed");
      expect(body.status?.lane).toBe("fast");
      expect(body.status?.actorType).toBe("anonymous_x402");
      expect(body.status?.immutability?.hashAlgorithm).toBe("sha256");
      expect(body.status?.immutability?.receivedTxHash).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
      expect(body.status?.immutability?.submittedTxHash).toBe(
        body.status?.immutability?.receivedTxHash,
      );
      expect(body.status?.immutability?.verifiedTxHash).toBe(
        body.status?.immutability?.receivedTxHash,
      );
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events?.map((event) => event.state)).toEqual([
        "received",
        "validated",
      ]);
      expect(body.events?.[0]?.at).toBeString();
    } finally {
      sqlite.close();
    }
  });

  test("includes attempt/provider metadata when attempts exist", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecStatusEnv();
    try {
      const submit = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-status-2",
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
          ) VALUES (?1, ?2, 1, 'fast', 'helius_sender', 'dispatched', ?3, ?4, ?3, ?4)
          `,
        )
        .run(
          "attempt_status_1",
          submitBody.requestId,
          "2026-03-03T02:00:00.000Z",
          "2026-03-03T02:00:01.000Z",
        );
      sqlite
        .query(
          `
          INSERT INTO execution_status_events (
            event_id,
            request_id,
            seq,
            status,
            reason,
            details_json,
            created_at
          ) VALUES (?1, ?2, 3, 'dispatched', NULL, NULL, ?3)
          `,
        )
        .run(
          "event_status_3",
          submitBody.requestId,
          "2026-03-03T02:00:01.000Z",
        );
      sqlite
        .query(
          `
          UPDATE execution_requests
          SET status = 'dispatched', updated_at = ?2
          WHERE request_id = ?1
          `,
        )
        .run(submitBody.requestId, "2026-03-03T02:00:01.000Z");

      const status = await worker.fetch(
        new Request(
          `http://localhost/api/x402/exec/status/${submitBody.requestId}`,
        ),
        env,
        createExecutionContextStub(),
      );
      expect(status.status).toBe(200);
      const body = (await status.json()) as {
        status?: { state?: string };
        events?: Array<{ state?: string; provider?: string; attempt?: number }>;
        attempts?: Array<{
          attempt?: number;
          provider?: string;
          state?: string;
        }>;
      };
      expect(body.status?.state).toBe("dispatched");
      expect(body.events?.some((event) => event.state === "dispatched")).toBe(
        true,
      );
      const dispatchedEvent = body.events?.find(
        (event) => event.state === "dispatched",
      );
      expect(dispatchedEvent?.provider).toBe("helius_sender");
      expect(dispatchedEvent?.attempt).toBe(1);
      expect(body.attempts?.[0]?.provider).toBe("helius_sender");
      expect(body.attempts?.[0]?.state).toBe("dispatched");
    } finally {
      sqlite.close();
    }
  });
});
