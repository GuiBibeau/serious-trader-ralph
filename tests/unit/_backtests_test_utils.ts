import type { Env } from "../../apps/worker/src/types";

type RunRow = {
  id: number;
  run_id: string;
  tenant_id: string;
  status: string;
  kind: string;
  request_json: string;
  summary_json: string | null;
  result_ref: string | null;
  error_code: string | null;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type EventRow = {
  id: number;
  run_id: string;
  tenant_id: string;
  level: string;
  message: string;
  meta_json: string | null;
  created_at: string;
};

type MemoryArtifacts = Map<string, string>;

function nowIso(): string {
  return new Date().toISOString();
}

function createDoNamespace() {
  return {
    idFromName(name: string) {
      return { toString: () => `id:${name}` };
    },
    get() {
      return {
        fetch: async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          }),
      };
    },
  } as never;
}

function createKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as never;
}

function createR2(artifacts: MemoryArtifacts) {
  return {
    put: async (key: string, body: string) => {
      artifacts.set(key, body);
      return null;
    },
    get: async (key: string) => {
      const value = artifacts.get(key);
      if (value === undefined) return null;
      return {
        text: async () => value,
      };
    },
  } as never;
}

function mapRun(row: RunRow): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.run_id,
    tenantId: row.tenant_id,
    status: row.status,
    kind: row.kind,
    requestJson: row.request_json,
    summaryJson: row.summary_json,
    resultRef: row.result_ref,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapEvent(row: EventRow): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.run_id,
    tenantId: row.tenant_id,
    level: row.level,
    message: row.message,
    metaJson: row.meta_json,
    createdAt: row.created_at,
  };
}

function createDb(loopConfig: Record<string, unknown>) {
  let nextRunId = 1;
  let nextEventId = 1;
  const runs: RunRow[] = [];
  const events: EventRow[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const run = async () => {
            if (sql.includes("INSERT INTO backtest_runs")) {
              const row: RunRow = {
                id: nextRunId++,
                run_id: String(args[0] ?? ""),
                tenant_id: String(args[1] ?? ""),
                status: "queued",
                kind: String(args[2] ?? "validation"),
                request_json: String(args[3] ?? "{}"),
                summary_json: null,
                result_ref: null,
                error_code: null,
                error_message: null,
                queued_at: String(args[4] ?? nowIso()),
                started_at: null,
                completed_at: null,
                created_at: nowIso(),
              };
              runs.push(row);
              return { meta: { last_row_id: row.id } };
            }

            if (sql.includes("INSERT INTO backtest_run_events")) {
              const row: EventRow = {
                id: nextEventId++,
                run_id: String(args[0] ?? ""),
                tenant_id: String(args[1] ?? ""),
                level: String(args[2] ?? "info"),
                message: String(args[3] ?? ""),
                meta_json: args[4] ? String(args[4]) : null,
                created_at: nowIso(),
              };
              events.push(row);
              return { meta: { last_row_id: row.id } };
            }

            if (
              sql.includes("UPDATE backtest_runs") &&
              sql.includes("SET status = 'completed'")
            ) {
              const tenantId = String(args[0] ?? "");
              const runId = String(args[1] ?? "");
              const summaryJson = String(args[2] ?? "{}");
              const resultRef = args[3] ? String(args[3]) : null;
              const completedAt = String(args[4] ?? nowIso());
              const row = runs.find(
                (r) => r.tenant_id === tenantId && r.run_id === runId,
              );
              if (row) {
                row.status = "completed";
                row.summary_json = summaryJson;
                row.result_ref = resultRef;
                row.completed_at = completedAt;
                row.error_code = null;
                row.error_message = null;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }

            if (
              sql.includes("UPDATE backtest_runs") &&
              sql.includes("SET status = 'failed'")
            ) {
              const tenantId = String(args[0] ?? "");
              const runId = String(args[1] ?? "");
              const errorCode = String(args[2] ?? "failed");
              const errorMessage = String(args[3] ?? "failed");
              const completedAt = String(args[4] ?? nowIso());
              const row = runs.find(
                (r) => r.tenant_id === tenantId && r.run_id === runId,
              );
              if (row) {
                row.status = "failed";
                row.error_code = errorCode;
                row.error_message = errorMessage;
                row.completed_at = completedAt;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }

            if (
              sql.includes("UPDATE backtest_runs") &&
              sql.includes("SET status = 'running'")
            ) {
              const tenantId = String(args[0] ?? "");
              const startedAt = String(args[1] ?? nowIso());
              const row = runs
                .filter(
                  (r) => r.tenant_id === tenantId && r.status === "queued",
                )
                .sort((a, b) => a.id - b.id)[0];
              if (row) {
                row.status = "running";
                row.started_at = startedAt;
                row.error_code = null;
                row.error_message = null;
              }
              return { meta: { changes: row ? 1 : 0 } };
            }

            return { meta: { changes: 0, last_row_id: 0 } };
          };

          const first = async () => {
            if (
              sql.includes("SELECT config_json as configJson FROM loop_configs")
            ) {
              return { configJson: JSON.stringify(loopConfig) };
            }

            if (
              sql.includes("FROM backtest_runs") &&
              sql.includes("WHERE tenant_id = ?1 AND run_id = ?2")
            ) {
              const tenantId = String(args[0] ?? "");
              const runId = String(args[1] ?? "");
              const row = runs.find(
                (r) => r.tenant_id === tenantId && r.run_id === runId,
              );
              return row ? mapRun(row) : null;
            }

            if (
              sql.includes("UPDATE backtest_runs") &&
              sql.includes("RETURNING")
            ) {
              const tenantId = String(args[0] ?? "");
              const startedAt = String(args[1] ?? nowIso());
              const row = runs
                .filter(
                  (r) => r.tenant_id === tenantId && r.status === "queued",
                )
                .sort((a, b) => a.id - b.id)[0];
              if (!row) return null;
              row.status = "running";
              row.started_at = startedAt;
              row.error_code = null;
              row.error_message = null;
              return mapRun(row);
            }

            if (
              sql.includes("SELECT COUNT(*) as count") &&
              sql.includes("FROM backtest_runs")
            ) {
              const tenantId = String(args[0] ?? "");
              const statuses = args.slice(1).map((x) => String(x ?? ""));
              const count = runs.filter(
                (row) =>
                  row.tenant_id === tenantId && statuses.includes(row.status),
              ).length;
              return { count };
            }

            return null;
          };

          const all = async () => {
            if (
              sql.includes("FROM backtest_runs") &&
              sql.includes("ORDER BY id DESC")
            ) {
              const tenantId = String(args[0] ?? "");
              const limit = Number(args[1] ?? 20);
              const status = args.length >= 3 ? String(args[2] ?? "") : "";
              const filtered = runs
                .filter((row) => row.tenant_id === tenantId)
                .filter((row) => (status ? row.status === status : true))
                .sort((a, b) => b.id - a.id)
                .slice(0, limit)
                .map(mapRun);
              return { results: filtered };
            }

            if (sql.includes("FROM backtest_run_events")) {
              const tenantId = String(args[0] ?? "");
              const runId = String(args[1] ?? "");
              const limit = Number(args[2] ?? 100);
              const filtered = events
                .filter(
                  (row) => row.tenant_id === tenantId && row.run_id === runId,
                )
                .sort((a, b) => b.id - a.id)
                .slice(0, limit)
                .map(mapEvent);
              return { results: filtered };
            }

            if (sql.includes("FROM market_features")) {
              return { results: [] };
            }

            return { results: [] };
          };

          return { run, first, all };
        },
      };
    },
  } as never;

  return {
    db,
    runs,
    events,
  };
}

export function createBacktestTestEnv(options?: {
  loopConfig?: Record<string, unknown>;
  withArtifacts?: boolean;
}) {
  const artifacts: MemoryArtifacts = new Map();
  const loopConfig = options?.loopConfig ?? {
    enabled: false,
    policy: { slippageBps: 50 },
    strategy: {
      type: "dca",
      inputMint: "So111",
      outputMint: "USDC",
      amount: "1",
    },
    validation: {
      enabled: true,
      lookbackDays: 30,
      profile: "balanced",
      minTrades: 8,
    },
    dataSources: { priority: ["fixture"], fixturePattern: "uptrend" },
  };

  const { db, runs, events } = createDb(loopConfig);
  const env = {
    WAITLIST_DB: db,
    CONFIG_KV: createKv(),
    BOT_LOOP: createDoNamespace(),
    BACKTEST_QUEUE: createDoNamespace(),
    LOGS_BUCKET: options?.withArtifacts ? createR2(artifacts) : undefined,
    LOOP_ENABLED_DEFAULT: "false",
    ALLOWED_ORIGINS: "*",
  } as Env;

  return {
    env,
    runs,
    events,
    artifacts,
  };
}
