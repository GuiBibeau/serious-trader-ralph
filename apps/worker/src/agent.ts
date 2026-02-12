import { type ChatMessage, type ChatToolCall, callLlm } from "./agent_llm";
import { buildAgentSystemPrompt } from "./agent_prompt";
import { type AgentToolRuntime, buildAgentToolset } from "./agent_tools";
import type { JupiterClient } from "./jupiter";
import {
  getAgentMemory,
  resetDailyTradeCount,
  saveAgentMemory,
} from "./memory";
import type { NormalizedPolicy } from "./policy";
import { gatherMarketSnapshot } from "./research";
import type { SolanaRpc } from "./solana_rpc";
import { updateLoopState } from "./state";
import { listTrades } from "./trade_index";
import type { AgentStrategy, Env } from "./types";

type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) => void;

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: "tool-result-not-serializable" });
  }
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseToolArgs(call: ChatToolCall): Record<string, unknown> {
  const raw = call.function.arguments ?? "";
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function runAgentTick(input: {
  env: Env;
  ctx: ExecutionContext;
  tenantId: string;
  configTenantId?: string;
  runId: string;
  logKey: string;
  log: LogFn;
  rpc: SolanaRpc;
  jupiter: JupiterClient;
  wallet: string;
  policy: NormalizedPolicy;
  strategy: AgentStrategy;
  privyWalletId?: string;
}): Promise<void> {
  const {
    env,
    tenantId,
    configTenantId,
    runId,
    logKey,
    log,
    rpc,
    jupiter,
    wallet,
    policy,
    strategy,
    privyWalletId,
  } = input;

  // 1) Load memory
  let memory = await getAgentMemory(env, tenantId);
  memory = resetDailyTradeCount(memory);

  // 2) Gather initial context (also available via tools)
  const snapshot = await gatherMarketSnapshot(rpc, jupiter, wallet, policy, {
    quoteMint: strategy.quoteMint,
    quoteDecimals: strategy.quoteDecimals,
  });
  const recentTrades = await listTrades(env, tenantId, 10);

  log("info", "agent tick start", {
    quoteMint: snapshot.quoteMint,
    portfolioValueQuote: snapshot.portfolioValueQuote,
    baseAllocationPct: snapshot.baseAllocationPct,
  });

  const system = buildAgentSystemPrompt({
    memory,
    snapshot,
    recentTrades,
    strategy,
    policy,
  });

  const { tools, handlers } = buildAgentToolset(strategy);

  const rt: AgentToolRuntime = {
    env,
    tenantId,
    configTenantId,
    runId,
    logKey,
    log,
    rpc,
    jupiter,
    wallet,
    policy,
    strategy,
    privyWalletId,
    memory,
    snapshot,
    recentTrades,
    stopRequested: false,
    tradeExecuted: false,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content:
        "New tick. Use tools to gather data and act. When done, call control_finish.",
    },
  ];

  const startedAt = Date.now();
  const maxSteps = clampInt(strategy.maxStepsPerTick, 4, 1, 12);
  const maxToolCallsPerStep = clampInt(strategy.maxToolCallsPerStep, 4, 1, 10);
  // Agent ticks can be tool-heavy (RPC + Jupiter + LLM). Give enough runway so the
  // LLM can still return a final `control_finish` without timing out.
  const deadlineMs = startedAt + 90_000;

  let failure: unknown;
  let stepCount = 0;
  try {
    for (let step = 0; step < maxSteps; step += 1) {
      stepCount = step + 1;
      if (Date.now() > deadlineMs) {
        log("warn", "agent tick deadline exceeded", { maxSteps });
        break;
      }

      const remainingMs = deadlineMs - Date.now();
      // Bound each LLM call by remaining time; allow up to 30s since some models
      // can be slower (and the HTTP layer already hard-caps to 30s in callLlm()).
      const llmTimeoutMs = Math.max(1_000, Math.min(30_000, remainingMs - 500));

      const response = await callLlm(env, {
        messages,
        tools,
        modelOverride: strategy.model,
        timeoutMs: llmTimeoutMs,
      });

      messages.push(response.assistantMessage);

      const toolCalls = response.toolCalls;
      log("debug", "agent llm step", {
        step: step + 1,
        finishReason: response.finishReason,
        toolCalls: toolCalls.map((c) => c.function.name),
      });

      if (toolCalls.length === 0) {
        break;
      }

      const bounded =
        toolCalls.length > maxToolCallsPerStep
          ? toolCalls.slice(0, maxToolCallsPerStep)
          : toolCalls;
      if (bounded.length !== toolCalls.length) {
        log("warn", "too many tool calls in one step; truncating", {
          count: toolCalls.length,
          maxToolCallsPerStep,
        });
      }

      for (const call of bounded) {
        const name = call.function.name;
        const handler = handlers[name];
        if (!handler) {
          log("warn", "unknown tool call", { name });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: safeJsonString({
              ok: false,
              error: `unknown-tool:${name}`,
            }),
          });
          continue;
        }

        const args = parseToolArgs(call);
        log("info", "agent tool call", { name, args });

        let result: unknown;
        try {
          result = await handler(args, rt, call);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log("error", "agent tool failed", { name, err: msg });
          result = { ok: false, error: msg };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: safeJsonString(result),
        });

        if (rt.stopRequested) break;
      }

      if (rt.stopRequested) break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "agent tick failed", { err: msg });
    failure = err;
  } finally {
    // Persist whatever memory updates happened before failure.
    await saveAgentMemory(env, tenantId, rt.memory).catch((err) => {
      log("warn", "failed to save agent memory", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    await updateLoopState(env, tenantId, (current) => ({
      ...current,
      agent: { ...(current.agent ?? {}), lastTickAt: new Date().toISOString() },
    })).catch((err) => {
      log("warn", "failed to update loop state", {
        err: err instanceof Error ? err.message : String(err),
      });
    });

    log("info", "agent tick end", {
      steps: stepCount,
      stopRequested: rt.stopRequested,
      tradeExecuted: rt.tradeExecuted,
    });
  }

  if (failure) throw failure;
}
