import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createExecutionClient,
  ExecutionClientError,
  type ExecutionSubmitPayload,
  type ExecutionTransport,
} from "../../apps/portal/app/execution-client";
import {
  normalizeInspectorError,
  parseReceiptPayload,
  parseStatusPayload,
} from "../../apps/portal/app/terminal/components/execution-inspector-drawer";
import {
  amendOpenOrder,
  cancelOpenOrder,
  executeOpenOrderSlice,
  type OpenOrderRow,
  promotePendingOrders,
  queueOpenOrder,
} from "../../apps/portal/app/terminal/components/open-orders";
import { createTradeIntent } from "../../apps/portal/app/terminal/components/trade-intent";
import type { Env } from "../../apps/worker/src/types";
import { buildRelaySignedPayload } from "../unit/_relay_signed_test_utils";
import {
  createExecutionContextStub,
  createWorkerLiveEnv,
  MAINNET_USDC_MINT,
  SOL_MINT,
} from "./_worker_live_test_utils";

const worker = (await import("../../apps/worker/src/index")).default;

type LaneScenario = {
  name: string;
  lane: "fast" | "protected" | "safe";
  submitPayload: ExecutionSubmitPayload;
  headers: Record<string, string>;
  fixture: TerminalFixture;
  expectSuccess: boolean;
};

type TerminalFixture = {
  requestStatus: "finalized" | "failed";
  statusReason: string | null;
  terminalAt: string;
  readyAt: string;
  provider: string;
  signature: string | null;
  finalizedStatus: "finalized" | "failed";
  errorCode: string | null;
  errorMessage: string | null;
  attempts: Array<{
    attemptNo: number;
    state: string;
    startedAt: string;
    completedAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
  events: Array<{
    state: "dispatched" | "finalized" | "failed";
    at: string;
    note?: string | null;
  }>;
};

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

function createTerminalExecEnv(): { env: Env; sqlite: Database } {
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
    .run("user@example.com", "terminal-e2e");
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
      EXEC_RELAY_VALIDATE_BLOCKHASH: "0",
      X402_EXEC_SUBMIT_PRICE_USD: "0.01",
      EXEC_API_KEYS: "svc_terminal:test-exec-safe-key:privy_execute",
    },
  });
  return { env, sqlite };
}

function createWorkerTransport(env: Env): ExecutionTransport {
  return async (input) => {
    const response = await worker.fetch(
      new Request(`http://localhost${input.path}`, {
        method: input.method,
        headers: input.headers,
        ...(input.body ? { body: input.body } : {}),
        signal: input.signal,
      }),
      env,
      createExecutionContextStub(),
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      status: response.status,
      payload,
    };
  };
}

async function fetchStatusPayload(
  env: Env,
  requestId: string,
): Promise<unknown> {
  const response = await worker.fetch(
    new Request(`http://localhost/api/x402/exec/status/${requestId}`),
    env,
    createExecutionContextStub(),
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function fetchReceiptPayload(
  env: Env,
  requestId: string,
): Promise<unknown> {
  const response = await worker.fetch(
    new Request(`http://localhost/api/x402/exec/receipt/${requestId}`),
    env,
    createExecutionContextStub(),
  );
  expect(response.status).toBe(200);
  return response.json();
}

function applyTerminalFixture(
  db: Database,
  input: {
    requestId: string;
    lane: "fast" | "protected" | "safe";
    fixture: TerminalFixture;
  },
): void {
  db.query(
    `
    UPDATE execution_requests
    SET status = ?2,
        status_reason = ?3,
        terminal_at = ?4,
        updated_at = ?4
    WHERE request_id = ?1
    `,
  ).run(
    input.requestId,
    input.fixture.requestStatus,
    input.fixture.statusReason,
    input.fixture.terminalAt,
  );

  for (const attempt of input.fixture.attempts) {
    db.query(
      `
      INSERT INTO execution_attempts (
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
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11, ?12)
      `,
    ).run(
      `attempt_${input.requestId}_${attempt.attemptNo}`,
      input.requestId,
      attempt.attemptNo,
      input.lane,
      input.fixture.provider,
      attempt.state,
      `${input.fixture.provider}-req-${attempt.attemptNo}`,
      JSON.stringify({ terminalFixture: true, lane: input.lane }),
      attempt.errorCode ?? null,
      attempt.errorMessage ?? null,
      attempt.startedAt,
      attempt.completedAt,
    );
  }

  for (const [index, event] of input.fixture.events.entries()) {
    db.query(
      `
      INSERT INTO execution_status_events (
        event_id,
        request_id,
        seq,
        status,
        reason,
        details_json,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      `,
    ).run(
      `event_${input.requestId}_${index + 3}`,
      input.requestId,
      index + 3,
      event.state,
      event.note ?? null,
      JSON.stringify({ terminalFixture: true }),
      event.at,
    );
  }

  db.query(
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
    ) VALUES (?1, ?2, 'v1', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11)
    `,
  ).run(
    input.requestId,
    `exec_${input.requestId.slice(-16)}`,
    input.fixture.finalizedStatus,
    input.lane,
    input.fixture.provider,
    input.fixture.signature,
    input.fixture.finalizedStatus === "failed" ? null : 123456,
    input.fixture.errorCode,
    input.fixture.errorMessage,
    JSON.stringify({
      fixture: true,
      lane: input.lane,
      status: input.fixture.finalizedStatus,
    }),
    input.fixture.readyAt,
  );
}

const FAST_FIXTURE: TerminalFixture = {
  requestStatus: "finalized",
  statusReason: null,
  terminalAt: "2026-03-04T10:00:04.000Z",
  readyAt: "2026-03-04T10:00:05.000Z",
  provider: "helius_sender",
  signature: "11111111111111111111111111111111",
  finalizedStatus: "finalized",
  errorCode: null,
  errorMessage: null,
  attempts: [
    {
      attemptNo: 1,
      state: "finalized",
      startedAt: "2026-03-04T10:00:02.000Z",
      completedAt: "2026-03-04T10:00:04.000Z",
    },
  ],
  events: [
    { state: "dispatched", at: "2026-03-04T10:00:02.000Z" },
    { state: "finalized", at: "2026-03-04T10:00:04.000Z" },
  ],
};

const PROTECTED_DEGRADED_FIXTURE: TerminalFixture = {
  requestStatus: "finalized",
  statusReason: null,
  terminalAt: "2026-03-04T11:00:08.000Z",
  readyAt: "2026-03-04T11:00:09.000Z",
  provider: "jito_bundle",
  signature: "22222222222222222222222222222222",
  finalizedStatus: "finalized",
  errorCode: null,
  errorMessage: null,
  attempts: [
    {
      attemptNo: 1,
      state: "timeout",
      startedAt: "2026-03-04T11:00:02.000Z",
      completedAt: "2026-03-04T11:00:04.000Z",
      errorCode: "venue-timeout",
      errorMessage: "jito submit timeout",
    },
    {
      attemptNo: 2,
      state: "finalized",
      startedAt: "2026-03-04T11:00:05.000Z",
      completedAt: "2026-03-04T11:00:08.000Z",
    },
  ],
  events: [
    { state: "dispatched", at: "2026-03-04T11:00:02.000Z" },
    {
      state: "dispatched",
      at: "2026-03-04T11:00:05.000Z",
      note: "retry-after-timeout",
    },
    { state: "finalized", at: "2026-03-04T11:00:08.000Z" },
  ],
};

const SAFE_FAILURE_FIXTURE: TerminalFixture = {
  requestStatus: "failed",
  statusReason: "expired-blockhash",
  terminalAt: "2026-03-04T12:00:06.000Z",
  readyAt: "2026-03-04T12:00:07.000Z",
  provider: "jupiter",
  signature: null,
  finalizedStatus: "failed",
  errorCode: "expired-blockhash",
  errorMessage: "blockhash expired before confirmation",
  attempts: [
    {
      attemptNo: 1,
      state: "expired",
      startedAt: "2026-03-04T12:00:02.000Z",
      completedAt: "2026-03-04T12:00:06.000Z",
      errorCode: "expired-blockhash",
      errorMessage: "blockhash expired before confirmation",
    },
  ],
  events: [
    { state: "dispatched", at: "2026-03-04T12:00:02.000Z" },
    {
      state: "failed",
      at: "2026-03-04T12:00:06.000Z",
      note: "expired-blockhash",
    },
  ],
};

const LANE_SCENARIOS: LaneScenario[] = [
  {
    name: "fast relay lane",
    lane: "fast",
    submitPayload: buildRelaySignedPayload({ lane: "fast" }),
    headers: { "payment-signature": "terminal-e2e-payment-fast" },
    fixture: FAST_FIXTURE,
    expectSuccess: true,
  },
  {
    name: "protected relay lane (degraded recovery)",
    lane: "protected",
    submitPayload: buildRelaySignedPayload({ lane: "protected" }),
    headers: { "payment-signature": "terminal-e2e-payment-protected" },
    fixture: PROTECTED_DEGRADED_FIXTURE,
    expectSuccess: true,
  },
  {
    name: "safe privy lane (failure fixture)",
    lane: "safe",
    submitPayload: {
      schemaVersion: "v1",
      mode: "privy_execute",
      lane: "safe",
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
      metadata: {
        source: "terminal-e2e",
      },
    },
    headers: { "x-exec-api-key": "test-exec-safe-key" },
    fixture: SAFE_FAILURE_FIXTURE,
    expectSuccess: false,
  },
];

describe("terminal execution e2e workflows", () => {
  test("covers submit -> status -> receipt loops by lane with degraded/failure fixtures", async () => {
    const { env, sqlite } = createTerminalExecEnv();
    try {
      const executionClient = createExecutionClient({
        transport: createWorkerTransport(env),
        pollIntervalMs: 5,
        pollTimeoutMs: 300,
      });

      for (const [index, scenario] of LANE_SCENARIOS.entries()) {
        const submit = await executionClient.submit(scenario.submitPayload, {
          idempotencyKey: `terminal-e2e-${scenario.lane}-${index + 1}`,
          headers: scenario.headers,
        });
        expect(submit.requestId.startsWith("execreq_")).toBe(true);
        expect(submit.state).toBe("validated");
        expect(submit.terminal).toBe(false);

        const initialStatus = await executionClient.status(submit.requestId);
        expect(initialStatus.state).toBe("validated");
        expect(initialStatus.terminal).toBe(false);
        const initialReceipt = await executionClient.receipt(submit.requestId);
        expect(initialReceipt.ready).toBe(false);

        applyTerminalFixture(sqlite, {
          requestId: submit.requestId,
          lane: scenario.lane,
          fixture: scenario.fixture,
        });

        const statusPayload = await fetchStatusPayload(env, submit.requestId);
        const parsedStatus = parseStatusPayload(statusPayload);
        expect(parsedStatus.requestId).toBe(submit.requestId);
        expect(parsedStatus.status.lane).toBe(scenario.lane);
        expect(parsedStatus.events.length).toBeGreaterThanOrEqual(4);
        expect(parsedStatus.attempts.length).toBe(
          scenario.fixture.attempts.length,
        );

        const receiptPayload = await fetchReceiptPayload(env, submit.requestId);
        const parsedReceipt = parseReceiptPayload(receiptPayload);
        expect(parsedReceipt.ready).toBe(true);
        expect(parsedReceipt.provider).toBe(scenario.fixture.provider);
        expect(parsedReceipt.outcomeStatus).toBe(
          scenario.fixture.finalizedStatus,
        );

        if (scenario.expectSuccess) {
          const terminal = await executionClient.waitForTerminalReceipt({
            requestId: submit.requestId,
          });
          expect(terminal.status).toBe("finalized");
          expect(terminal.provider).toBe(scenario.fixture.provider);
          expect(terminal.signature).toBe(scenario.fixture.signature);
        } else {
          await expect(
            executionClient.waitForTerminalReceipt({
              requestId: submit.requestId,
            }),
          ).rejects.toBeInstanceOf(ExecutionClientError);
          const inspectorError = normalizeInspectorError({
            requestId: submit.requestId,
            status: parsedStatus.status,
            events: parsedStatus.events,
            attempts: parsedStatus.attempts,
            receipt: parsedReceipt,
          });
          expect(inspectorError).toContain("expired-blockhash");
        }
      }
    } finally {
      sqlite.close();
    }
  });

  test("covers open-order create/amend/cancel/reduce lifecycle actions", () => {
    const intent = createTradeIntent("sell", "POSITIONS_PANEL", "SOL/USDC", {
      reason: "Reduce 25% position size",
      amountUi: "4",
    });
    const now = 1_700_000_000_000;
    const orderId = "order_reduce_1";

    const queued = queueOpenOrder([], {
      id: orderId,
      createdAt: now,
      updatedAt: now,
      pairId: intent.pairId,
      direction: intent.direction,
      source: intent.source,
      reason: intent.reason,
      orderType: "limit",
      timeInForce: "gtc",
      amountUi: intent.amountUi,
      remainingAmountUi: intent.amountUi,
      slippageBps: intent.slippageBps,
      lane: "safe",
      simulationPreference: "auto",
      priorityLevel: "normal",
      limitPriceUi: "100.5",
      triggerPriceUi: null,
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("pending");

    const promoted = promotePendingOrders(queued, now + 2_000, 500);
    expect(promoted[0]?.status).toBe("working");

    const amended = amendOpenOrder({
      current: promoted,
      orderId,
      amountUi: "3",
      priceUi: "101.25",
      now: now + 3_000,
    });
    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(amended.next[0]?.remainingAmountUi).toBe("3");
    expect(amended.next[0]?.limitPriceUi).toBe("101.25");

    const reduced = executeOpenOrderSlice({
      current: amended.next,
      orderId,
      fraction: 0.5,
      now: now + 4_000,
    });
    expect(reduced.ok).toBe(true);
    if (!reduced.ok) return;
    expect(reduced.executeAmountUi).toBe("1.5");
    expect(reduced.next[0]?.status).toBe("partial");
    expect(reduced.next[0]?.remainingAmountUi).toBe("1.5");

    const cancelled = cancelOpenOrder(
      reduced.next as OpenOrderRow[],
      orderId,
      now + 5_000,
    );
    expect(cancelled[0]?.status).toBe("cancelled");
    expect(cancelled[0]?.lastError).toBeNull();
  });
});
