import { describe, expect, test } from "bun:test";
import {
  countPendingSteeringMessages,
  enqueueSteeringMessage,
  getBotRunState,
  listPendingSteeringMessages,
  listSteeringMessages,
  markSteeringMessagesApplied,
  upsertBotRunState,
} from "../../apps/worker/src/agents_runtime/runtime_repo";
import type { Env } from "../../apps/worker/src/types";

type SteeringRow = {
  id: number;
  botId: string;
  message: string;
  status: "pending" | "applied" | "canceled";
  queuedAt: string;
  appliedAt: string | null;
  appliedRunId: string | null;
};

function createRuntimeRepoEnv(): Env {
  const steering: SteeringRow[] = [];
  let nextId = 1;
  const runState = new Map<string, Record<string, unknown>>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (sql.includes("FROM bot_run_state")) {
                const botId = String(args[0] ?? "");
                return runState.get(botId) ?? null;
              }
              if (
                sql.includes("FROM bot_steering_messages") &&
                sql.includes("COUNT(*)")
              ) {
                const botId = String(args[0] ?? "");
                const pendingCount = steering.filter(
                  (row) => row.botId === botId && row.status === "pending",
                ).length;
                return { pendingCount };
              }
              return null;
            },
            all: async () => {
              if (sql.includes("FROM bot_steering_messages")) {
                const botId = String(args[0] ?? "");
                const limit = Number(args[1] ?? 50);
                const filtered = steering
                  .filter((row) =>
                    sql.includes("status = 'pending'")
                      ? row.botId === botId && row.status === "pending"
                      : row.botId === botId,
                  )
                  .sort((a, b) =>
                    sql.includes("ORDER BY id ASC") ? a.id - b.id : b.id - a.id,
                  )
                  .slice(0, Math.max(1, Math.min(200, Math.trunc(limit))));
                return {
                  results: filtered.map((row) => ({
                    id: row.id,
                    botId: row.botId,
                    message: row.message,
                    status: row.status,
                    queuedAt: row.queuedAt,
                    appliedAt: row.appliedAt,
                    appliedRunId: row.appliedRunId,
                  })),
                };
              }
              return { results: [] };
            },
            run: async () => {
              if (sql.includes("INSERT INTO bot_steering_messages")) {
                const row: SteeringRow = {
                  id: nextId++,
                  botId: String(args[0] ?? ""),
                  message: String(args[1] ?? ""),
                  status: "pending",
                  queuedAt: new Date().toISOString(),
                  appliedAt: null,
                  appliedRunId: null,
                };
                steering.push(row);
                return { meta: { last_row_id: row.id } };
              }
              if (sql.includes("UPDATE bot_steering_messages")) {
                const appliedAt = String(args[0] ?? "");
                const runId = String(args[1] ?? "");
                const botId = String(args[2] ?? "");
                const ids = args.slice(3).map((value) => Number(value));
                for (const row of steering) {
                  if (
                    row.botId === botId &&
                    row.status === "pending" &&
                    ids.includes(row.id)
                  ) {
                    row.status = "applied";
                    row.appliedAt = appliedAt;
                    row.appliedRunId = runId;
                  }
                }
                return { meta: { changes: 1 } };
              }
              if (sql.includes("INSERT INTO bot_run_state")) {
                const botId = String(args[0] ?? "");
                runState.set(botId, {
                  botId,
                  state: String(args[1] ?? "idle"),
                  blockedReason: args[2] ?? null,
                  currentRunId: args[3] ?? null,
                  lastTickAt: args[4] ?? null,
                  nextTickAt: args[5] ?? null,
                  providerBaseUrlHash: args[6] ?? null,
                  providerModel: args[7] ?? null,
                  providerPingAgeMs: args[8] ?? null,
                  resolutionSource: args[9] ?? null,
                  steeringLastAppliedId: args[10] ?? null,
                  compactedAt: args[11] ?? null,
                  compactedCount: args[12] ?? 0,
                  messageWindowCount: args[13] ?? 0,
                  updatedAt: new Date().toISOString(),
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return {
    WAITLIST_DB: db,
    CONFIG_KV: {} as never,
    BOT_LOOP: {} as never,
    BACKTEST_QUEUE: {} as never,
  } as Env;
}

describe("worker agent runtime repo", () => {
  test("queues steering messages and reports pending count", async () => {
    const env = createRuntimeRepoEnv();
    const first = await enqueueSteeringMessage(env, {
      botId: "bot-1",
      message: "reduce risk",
    });
    expect(first.queuePosition).toBe(1);

    await enqueueSteeringMessage(env, {
      botId: "bot-1",
      message: "rotate to sol/usdc",
    });

    const pending = await countPendingSteeringMessages(env, "bot-1");
    expect(pending).toBe(2);

    const queued = await listPendingSteeringMessages(env, "bot-1", 10);
    expect(queued).toHaveLength(2);
    expect(queued[0]?.message).toBe("reduce risk");
  });

  test("marks queued steering as applied for a run id", async () => {
    const env = createRuntimeRepoEnv();
    await enqueueSteeringMessage(env, {
      botId: "bot-2",
      message: "prefer low slippage routes",
    });
    await enqueueSteeringMessage(env, {
      botId: "bot-2",
      message: "favor momentum",
    });
    const pending = await listPendingSteeringMessages(env, "bot-2", 10);
    const lastApplied = await markSteeringMessagesApplied(env, {
      botId: "bot-2",
      ids: pending.map((row) => row.id),
      runId: "run-123",
    });
    expect(lastApplied).toBeGreaterThan(0);

    const allRows = await listSteeringMessages(env, "bot-2", 10);
    expect(allRows.every((row) => row.status === "applied")).toBe(true);
    expect(allRows[0]?.appliedRunId).toBe("run-123");
  });

  test("upserts run state with provider metadata", async () => {
    const env = createRuntimeRepoEnv();
    await upsertBotRunState(env, {
      botId: "bot-3",
      state: "running",
      currentRunId: "run-999",
      providerBaseUrlHash: "abcd1234",
      providerModel: "glm-5",
      providerPingAgeMs: 4000,
      resolutionSource: "bot_config",
      compactedCount: 2,
      messageWindowCount: 18,
    });
    const state = await getBotRunState(env, "bot-3");
    expect(state?.state).toBe("running");
    expect(state?.currentRunId).toBe("run-999");
    expect(state?.providerModel).toBe("glm-5");
    expect(state?.providerPingAgeMs).toBe(4000);
    expect(state?.resolutionSource).toBe("bot_config");
  });
});
