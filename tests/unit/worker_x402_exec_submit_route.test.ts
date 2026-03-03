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

function createExecSubmitEnv(overrides?: Partial<Env>): {
  env: Env;
  sqlite: Database;
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

  const env = createWorkerLiveEnv({
    overrides: {
      WAITLIST_DB: createSqliteD1Adapter(sqlite),
      PRIVY_APP_ID: "privy-app-id",
      X402_EXEC_SUBMIT_PRICE_USD: "0.01",
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
      ...(overrides ?? {}),
    },
  });
  return { env, sqlite };
}

const PRIVY_PAYLOAD = {
  schemaVersion: "v1",
  mode: "privy_execute",
  lane: "protected",
  privyExecute: {
    intentType: "swap",
    wallet: "11111111111111111111111111111111",
    swap: {
      inputMint: SOL_MINT,
      outputMint: MAINNET_USDC_MINT,
      amountAtomic: "1000000",
      slippageBps: 50,
    },
  },
};

describe("worker x402 exec submit scaffold route", () => {
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

  test("requires payment for anonymous relay_signed submits", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-1",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(402);
      const payload = (await response.json()) as { error?: string };
      expect(payload.error).toBe("payment-required");
      expect(response.headers.get("payment-required")).toBeString();
      expect(response.headers.get("payment-response")).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  test("rejects unsupported safe lane for relay_signed submits", async () => {
    const relayPayload = buildRelaySignedPayload({ lane: "safe" });
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-safe-lane",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error?: string;
        reason?: string;
      };
      expect(body.error).toBe("unsupported-lane");
      expect(body.reason).toBe("lane-not-available-for-relay-signed");
    } finally {
      sqlite.close();
    }
  });

  test("accepts relay_signed submit with payment and returns deterministic replay", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const first = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-2",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        ok?: boolean;
        requestId?: string;
        status?: { state?: string; terminal?: boolean };
      };
      expect(firstBody.ok).toBe(true);
      expect(firstBody.requestId).toMatch(/^execreq_[A-Za-z0-9]{16,}$/);
      expect(firstBody.status?.state).toBe("validated");
      expect(firstBody.status?.terminal).toBe(false);
      expect(first.headers.get("payment-response")).toBeString();
      const row = sqlite
        .query(
          "SELECT lane, metadata_json as metadataJson FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(firstBody.requestId) as
        | { lane?: string; metadataJson?: string }
        | undefined;
      expect(row?.lane).toBe("fast");
      const metadata = JSON.parse(String(row?.metadataJson ?? "{}")) as {
        laneResolution?: { lane?: string; adapter?: string };
        x402Billing?: {
          routeKey?: string;
          settlementHeader?: string;
          payment?: {
            required?: boolean;
            signatureProvided?: boolean;
            signatureHash?: string;
          };
          polling?: {
            requiresPayment?: boolean;
          };
        };
      };
      expect(metadata.laneResolution?.lane).toBe("fast");
      expect(metadata.laneResolution?.adapter).toBe("helius_sender");
      expect(metadata.x402Billing?.routeKey).toBe("exec_submit");
      expect(metadata.x402Billing?.settlementHeader).toBe("payment-response");
      expect(metadata.x402Billing?.payment?.required).toBe(true);
      expect(metadata.x402Billing?.payment?.signatureProvided).toBe(true);
      expect(metadata.x402Billing?.payment?.signatureHash).toMatch(
        /^sha256:[a-f0-9]{64}$/,
      );
      expect(metadata.x402Billing?.polling?.requiresPayment).toBe(false);

      const second = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-2",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as {
        requestId?: string;
      };
      expect(secondBody.requestId).toBe(firstBody.requestId);
    } finally {
      sqlite.close();
    }
  });

  test("accepts relay_signed submit on protected lane", async () => {
    const relayPayload = buildRelaySignedPayload({ lane: "protected" });
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-protected-1",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { requestId?: string };
      const row = sqlite
        .query(
          "SELECT lane, metadata_json as metadataJson FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(body.requestId) as
        | { lane?: string; metadataJson?: string }
        | undefined;
      expect(row?.lane).toBe("protected");
      const metadata = JSON.parse(String(row?.metadataJson ?? "{}")) as {
        laneResolution?: { lane?: string; adapter?: string };
      };
      expect(metadata.laneResolution?.lane).toBe("protected");
      expect(metadata.laneResolution?.adapter).toBe("jito_bundle");
    } finally {
      sqlite.close();
    }
  });

  test("rejects same idempotency key with different payload", async () => {
    const relayPayload = buildRelaySignedPayload();
    const differentRelayPayload = buildRelaySignedPayload({ lamports: 2 });
    const { env, sqlite } = createExecSubmitEnv();
    try {
      await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-3",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );

      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-3",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(differentRelayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(409);
      const body = (await response.json()) as {
        error?: string;
        reason?: string;
      };
      expect(body.error).toBe("invalid-request");
      expect(body.reason).toBe("idempotency-key-conflict");
    } finally {
      sqlite.close();
    }
  });

  test("rejects relay replay when stored immutability hash diverges", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const first = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-4",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { requestId?: string };
      const requestId = String(firstBody.requestId ?? "");
      expect(requestId).toBeString();

      const metadataRow = sqlite
        .query(
          "SELECT metadata_json as metadataJson FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(requestId) as { metadataJson?: string } | undefined;
      const metadata = JSON.parse(
        String(metadataRow?.metadataJson ?? "{}"),
      ) as {
        relayImmutability?: { receivedTxHash?: string };
      };
      metadata.relayImmutability = {
        ...(metadata.relayImmutability ?? {}),
        receivedTxHash: `sha256:${"f".repeat(64)}`,
      };
      sqlite
        .query(
          "UPDATE execution_requests SET metadata_json = ?2 WHERE request_id = ?1",
        )
        .run(requestId, JSON.stringify(metadata));

      const replay = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-4",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(replay.status).toBe(403);
      const replayBody = (await replay.json()) as {
        error?: string;
        reason?: string;
      };
      expect(replayBody.error).toBe("policy-denied");
      expect(replayBody.reason).toBe("relay-immutability-mismatch");
    } finally {
      sqlite.close();
    }
  });

  test("accepts relay_signed submit for configured api_key actor", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecSubmitEnv({
      EXEC_API_KEYS: "svc_relay:key-relay:relay_signed",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-exec-api-key": "key-relay",
            "idempotency-key": "idem-api-key-relay-1",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { requestId?: string };
      expect(body.requestId).toBeString();
      const row = sqlite
        .query(
          "SELECT actor_type as actorType, actor_id as actorId, mode FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(String(body.requestId)) as
        | { actorType?: string; actorId?: string; mode?: string }
        | undefined;
      expect(row?.actorType).toBe("api_key_actor");
      expect(row?.actorId).toBe("svc_relay");
      expect(row?.mode).toBe("relay_signed");
      expect(requireUserMock).not.toHaveBeenCalled();
    } finally {
      sqlite.close();
    }
  });

  test("rejects api_key actor mode when not allowed by key config", async () => {
    const { env, sqlite } = createExecSubmitEnv({
      EXEC_API_KEYS: "svc_relay:key-relay:relay_signed",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-exec-api-key": "key-relay",
            "idempotency-key": "idem-api-key-privy-1",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        error?: string;
        reason?: string;
      };
      expect(body.error).toBe("actor-mode-not-allowed");
      expect(body.reason).toBe("api-key-mode-not-enabled:privy_execute");
    } finally {
      sqlite.close();
    }
  });

  test("accepts privy_execute contract path for api_key actor when enabled", async () => {
    const { env, sqlite } = createExecSubmitEnv({
      EXEC_API_KEYS: "svc_exec:key-both:all",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-exec-api-key": "key-both",
            "idempotency-key": "idem-api-key-privy-2",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        requestId?: string;
        status?: { state?: string };
      };
      expect(body.requestId).toBeString();
      expect(body.status?.state).toBe("validated");
      const row = sqlite
        .query(
          "SELECT actor_type as actorType, actor_id as actorId, mode FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(String(body.requestId)) as
        | { actorType?: string; actorId?: string; mode?: string }
        | undefined;
      expect(row?.actorType).toBe("api_key_actor");
      expect(row?.actorId).toBe("svc_exec");
      expect(row?.mode).toBe("privy_execute");
      expect(requireUserMock).not.toHaveBeenCalled();
    } finally {
      sqlite.close();
    }
  });

  test("maps relay_signed submit with privy auth to privy_user actor", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-privy-relay-1",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { requestId?: string };
      expect(body.requestId).toBeString();
      const row = sqlite
        .query(
          "SELECT actor_type as actorType, actor_id as actorId, mode FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(String(body.requestId)) as
        | { actorType?: string; actorId?: string; mode?: string }
        | undefined;
      expect(row?.actorType).toBe("privy_user");
      expect(row?.actorId).toBe("user_1");
      expect(row?.mode).toBe("relay_signed");
      expect(requireUserMock).toHaveBeenCalled();
    } finally {
      sqlite.close();
    }
  });

  test("accepts privy_execute submit for authenticated user", async () => {
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-privy-1",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok?: boolean;
        status?: { state?: string };
      };
      expect(body.ok).toBe(true);
      expect(body.status?.state).toBe("validated");
      expect(requireUserMock).toHaveBeenCalled();
      expect(response.headers.get("payment-response")).toBeNull();
    } finally {
      sqlite.close();
    }
  });

  test("denies privy_execute submit when mode-aware policy rejects wallet", async () => {
    const { env, sqlite } = createExecSubmitEnv({
      EXEC_POLICY_PRIVY_WALLET_ALLOWLIST:
        "So11111111111111111111111111111111111111112",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-privy-policy-wallet-1",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        error?: string;
        reason?: string;
        policy?: { outcome?: string };
      };
      expect(body.error).toBe("policy-denied");
      expect(body.reason).toBe("privy-wallet-not-allowlisted");
      expect(body.policy?.outcome).toBe("deny");
    } finally {
      sqlite.close();
    }
  });

  test("stores mode-aware policy metadata for accepted privy_execute submits", async () => {
    const { env, sqlite } = createExecSubmitEnv({
      EXEC_POLICY_PRIVY_REQUIRE_SIMULATION_PROTECTED: "1",
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-privy-policy-meta-1",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { requestId?: string };
      const row = sqlite
        .query(
          "SELECT metadata_json as metadataJson FROM execution_requests WHERE request_id = ?1 LIMIT 1",
        )
        .get(String(body.requestId)) as { metadataJson?: string } | undefined;
      const metadata = JSON.parse(String(row?.metadataJson ?? "{}")) as {
        policy?: {
          outcome?: string;
          defaults?: { requireSimulation?: boolean };
        };
      };
      expect(metadata.policy?.outcome).toBe("allow");
      expect(metadata.policy?.defaults?.requireSimulation).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  test("throttles burst submits by ip with deterministic 429 response", async () => {
    const { env, sqlite } = createExecSubmitEnv({
      EXEC_SUBMIT_RATE_LIMIT_IP_MAX: "1",
      EXEC_SUBMIT_RATE_LIMIT_ACTOR_MAX: "10",
      EXEC_SUBMIT_RATE_LIMIT_WINDOW_SECONDS: "60",
      EXEC_SUBMIT_DUPLICATE_BURST_MAX: "10",
    });
    try {
      const first = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-abuse-rate-1",
            "cf-connecting-ip": "203.0.113.11",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(first.status).toBe(200);

      const second = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-abuse-rate-2",
            "cf-connecting-ip": "203.0.113.11",
          },
          body: JSON.stringify(PRIVY_PAYLOAD),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBe("60");
      const body = (await second.json()) as { error?: string; reason?: string };
      expect(body.error).toBe("policy-denied");
      expect(body.reason).toBe("submit-ip-rate-limit-exceeded");
    } finally {
      sqlite.close();
    }
  });

  test("rejects privy_execute submit when wallet mismatches authenticated user", async () => {
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-privy-2",
          },
          body: JSON.stringify({
            ...PRIVY_PAYLOAD,
            privyExecute: {
              ...PRIVY_PAYLOAD.privyExecute,
              wallet: "So11111111111111111111111111111111111111112",
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe("invalid-request");
    } finally {
      sqlite.close();
    }
  });

  test("rejects malformed privy_execute intent payloads deterministically", async () => {
    const { env, sqlite } = createExecSubmitEnv();
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer mock-token",
            "idempotency-key": "idem-privy-3",
          },
          body: JSON.stringify({
            ...PRIVY_PAYLOAD,
            privyExecute: {
              ...PRIVY_PAYLOAD.privyExecute,
              swap: {
                ...PRIVY_PAYLOAD.privyExecute.swap,
                amountAtomic: "0",
              },
            },
          }),
        }),
        env,
        createExecutionContextStub(),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe("invalid-request");
    } finally {
      sqlite.close();
    }
  });

  test("maps x402 submit config errors to deterministic 503 responses", async () => {
    const relayPayload = buildRelaySignedPayload();
    const { env, sqlite } = createExecSubmitEnv({
      X402_EXEC_SUBMIT_PRICE_USD: undefined,
    });
    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/x402/exec/submit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "idem-anon-config-err",
            "payment-signature": "unit-signed-payment",
          },
          body: JSON.stringify(relayPayload),
        }),
        env,
        createExecutionContextStub(),
      );

      expect(response.status).toBe(503);
      const payload = (await response.json()) as { error?: string };
      expect(payload.error).toBe("x402-route-config-missing");
    } finally {
      sqlite.close();
    }
  });
});
