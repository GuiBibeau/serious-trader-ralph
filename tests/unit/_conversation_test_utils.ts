import type { Env, LoopConfig, StrategyRuntimeStateRow } from "../../apps/worker/src/types";

type ConversationRow = {
  id: number;
  tenantId: string;
  role: "user" | "assistant";
  actor: "user" | "admin";
  question: string | null;
  answer: string | null;
  model: string | null;
  sourcesJson: string | null;
  createdAt: string;
  error: string | null;
};

type ValidationRow = {
  id?: number;
  tenantId?: string;
  strategyHash?: string;
  strategyType?: string;
  lookbackDays?: number;
  profile?: string;
  status?: "passed" | "failed" | "running";
  metricsJson?: string | null;
  thresholdsJson?: string | null;
  summary?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
};

type CreateEnvOptions = {
  tenantId: string;
  config: LoopConfig;
  runtimeState: StrategyRuntimeStateRow;
  latestValidation?: ValidationRow | null;
  latestValidationForHash?: ValidationRow | null;
  validationRuns?: ValidationRow[];
  strategyEvents?: unknown[];
  trades?: unknown[];
};

function cloneValidationRow(row: ValidationRow | null | undefined): ValidationRow | null {
  if (!row) return null;
  return {
    ...row,
  };
}

export function createConversationTestEnv({
  tenantId,
  config,
  runtimeState,
  latestValidation = null,
  latestValidationForHash = null,
  validationRuns = [],
  strategyEvents = [],
  trades = [],
}: CreateEnvOptions): Env {
  const conversationRows: ConversationRow[] = [];
  let nextConversationId = 1;
  const configJson = JSON.stringify(config);
  const now = new Date().toISOString();

  const latestValidationRow = cloneValidationRow(latestValidation);
  const latestValidationForHashRow = cloneValidationRow(latestValidationForHash);
  const validationRunsRows = validationRuns.map((row) => cloneValidationRow(row)).filter(Boolean) as ValidationRow[];
  const strategyEventsRows = strategyEvents.slice();
  const tradeRows = trades.slice();

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const first = async () => {
            const tenant = String(args[0] ?? "");
            if (sql.includes("SELECT config_json as configJson")) {
              if (tenant !== tenantId) return null;
              return { configJson };
            }

            if (sql.includes("FROM strategy_runtime_state")) {
              return runtimeState;
            }

            if (sql.includes("FROM strategy_validations") && sql.includes("strategy_hash")) {
              return latestValidationForHashRow;
            }
            if (sql.includes("FROM strategy_validations")) {
              if (sql.includes("LIMIT ?2")) {
                const limit = Number(args[1] ?? 0);
                return (validationRunsRows.slice(0, limit > 0 ? limit : validationRunsRows.length) as unknown);
              }
              return latestValidationRow;
            }
            if (sql.includes("FROM strategy_events")) {
              return null;
            }
            if (sql.includes("FROM trade_index")) {
              return null;
            }
            if (sql.includes("FROM bot_conversations")) {
              return {
                id: 0,
                tenant_id: tenantId,
                role: "user",
                actor: "user",
                question: null,
                answer: null,
                model: null,
                sourcesJson: null,
                created_at: now,
                error: null,
              };
            }
            return null;
          };

          const all = async () => {
            if (sql.includes("FROM strategy_validations") && sql.includes("LIMIT ?2")) {
              const limit = Math.max(1, Math.min(200, Number(args[1] ?? 0)));
              return {
                results: validationRunsRows.slice(0, limit) as Record<string, unknown>[],
              };
            }
            if (sql.includes("FROM strategy_events")) {
              const limit = Math.max(1, Math.min(200, Number(args[1] ?? 200)));
              return {
                results: strategyEventsRows.slice(0, limit) as Record<string, unknown>[],
              };
            }
            if (sql.includes("FROM trade_index")) {
              const limit = Math.max(1, Math.min(200, Number(args[1] ?? 200)));
              return {
                results: tradeRows.slice(0, limit) as Record<string, unknown>[],
              };
            }
            if (sql.includes("FROM bot_conversations")) {
              const limit = Math.max(1, Math.min(100, Number(args[1] ?? 100)));
              const filtered = conversationRows
                .filter((row) => row.tenantId === String(args[0] ?? ""))
                .sort((a, b) => b.id - a.id)
                .slice(0, limit)
                .map((row) => ({
                  id: row.id,
                  tenantId: row.tenantId,
                  tenant_id: row.tenantId,
                  role: row.role,
                  actor: row.actor,
                  question: row.question,
                  answer: row.answer,
                  model: row.model,
                  sourcesJson: row.sourcesJson,
                  createdAt: row.createdAt,
                  error: row.error,
                }));
              return { results: filtered };
            }
            return { results: [] };
          };

          const run = async () => {
            if (sql.includes("INSERT INTO bot_conversations")) {
              const tenant = String(args[0] ?? "");
              const row: ConversationRow = {
                id: nextConversationId++,
                tenantId: tenant,
                role: String(args[1] ?? "user") as ConversationRow["role"],
                actor: String(args[2] ?? "user") as ConversationRow["actor"],
                question:
                  typeof args[3] === "string" ? args[3] : null,
                answer: typeof args[4] === "string" ? args[4] : null,
                model: typeof args[5] === "string" ? args[5] : null,
                sourcesJson: typeof args[6] === "string" ? args[6] : null,
                createdAt: now,
                error: typeof args[8] === "string" ? args[8] : null,
              };
              conversationRows.push(row);
              return { meta: { last_row_id: row.id } };
            }
            if (sql.includes("INSERT INTO loop_configs") || sql.includes("INSERT INTO strategy_runtime_state")) {
              return {};
            }
            if (sql.includes("INSERT INTO strategy_events")) {
              return {};
            }
            if (sql.includes("INSERT INTO trade_index")) {
              return {};
            }
            return {};
          };

          return { first, all, run };
        },
        all: async () => {
          const fallback = [String(sql), "without bind call"];
          return {
            results:
              fallback[0].includes("FROM strategy_validations")
                ? validationRunsRows.slice(0, 200)
                : [],
          };
        },
        first: async () => {
          return null;
        },
        run: async () => ({ meta: { last_row_id: 0 } }),
      };
    },
    first: async () => null,
  } as never;

  return {
    WAITLIST_DB: db,
    CONFIG_KV: {
      get: async () => null,
      put: async () => {},
    } as never,
    BOT_LOOP: {} as never,
    ...(latestValidationRow ? {} : {}),
  } as Env;
}
