import {
  type ChatMessage,
  type ChatTool,
  type ChatToolCall,
  callLlm,
} from "./agent_llm";
import { inferMandateProfile } from "./agent_mandate";
import { buildAgentSystemPrompt } from "./agent_prompt";
import {
  type AgentToolHandler,
  type AgentToolRuntime,
  buildAgentToolset,
} from "./agent_tools";
import {
  runResearchSpecialist,
  runRiskSpecialist,
  type SpecialistRuntime,
} from "./agents/specialists";
import {
  type ProviderSnapshot,
  resolveBotProviderSnapshot,
} from "./inference_provider";
import type { JupiterClient } from "./jupiter";
import {
  getAgentMemory,
  resetDailyTradeCount,
  saveAgentMemory,
} from "./memory";
import type { NormalizedPolicy } from "./policy";
import type { SolanaRpc } from "./solana_rpc";
import { updateLoopState } from "./state";
import type {
  AgentCompactionSummary,
  AgentStrategy,
  Env,
  ExecutionConfig,
} from "./types";

type LogFn = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) => void;

const MAX_TOOL_MESSAGE_CHARS = 6_000;
const TIMEOUT_NUDGE_MESSAGE =
  "Previous response timed out. Continue fast: at most 2 tool calls or call control_finish.";
const TIMEOUT_RECOVERY_TOOL_NAMES = new Set([
  "control_finish",
  "market_snapshot",
  "market_token_balance",
  "market_jupiter_quote",
  "market_jupiter_quote_batch",
  "market_ohlcv_history",
  "market_indicators",
  "macro_signals",
  "macro_fred_indicators",
  "macro_etf_flows",
  "macro_stablecoin_health",
  "macro_oil_analytics",
  "trades_list_recent",
  "trade_jupiter_swap",
]);
const CONTEXT_SUMMARY_PREFIX = "CONTEXT_COMPACTION_SUMMARY_V1";
const MAX_COMPACTION_ITEMS = 8;

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: "tool-result-not-serializable" });
  }
}

function toToolMessageContent(value: unknown): string {
  const raw = safeJsonString(value);
  if (raw.length <= MAX_TOOL_MESSAGE_CHARS) return raw;
  return JSON.stringify({
    ok: true,
    truncated: true,
    originalChars: raw.length,
    preview: raw.slice(0, MAX_TOOL_MESSAGE_CHARS),
  });
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

function shouldRunSequentially(name: string): boolean {
  return (
    name === "control_finish" ||
    name === "trade_jupiter_swap" ||
    name === "backtest_run_create" ||
    name.startsWith("memory_")
  );
}

function estimateMessageTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const message of messages) {
    if (message.role === "assistant") {
      chars += String(message.content ?? "").length;
      chars += (message.tool_calls ?? []).reduce((sum, call) => {
        return (
          sum +
          String(call.function.name ?? "").length +
          String(call.function.arguments ?? "").length
        );
      }, 0);
      continue;
    }
    if (message.role === "tool") {
      chars += String(message.content ?? "").length;
      continue;
    }
    chars += String(message.content ?? "").length;
  }
  return Math.max(1, Math.ceil(chars / 4));
}

function toMessageText(message: ChatMessage): string {
  if (message.role === "assistant") {
    const toolLabels = (message.tool_calls ?? [])
      .map((call) => call.function.name)
      .filter((name) => Boolean(String(name ?? "").trim()));
    return `${String(message.content ?? "").trim()} ${toolLabels.length > 0 ? `[tools:${toolLabels.join(",")}]` : ""}`.trim();
  }
  if (message.role === "tool") {
    return String(message.content ?? "").trim();
  }
  return String(message.content ?? "").trim();
}

function clipLine(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function pushUniqueLimited(target: string[], value: string): void {
  const next = clipLine(value);
  if (!next) return;
  if (target.includes(next)) return;
  if (target.length >= MAX_COMPACTION_ITEMS) return;
  target.push(next);
}

function buildDeterministicCompactionSummary(
  messages: ChatMessage[],
): AgentCompactionSummary {
  const facts: string[] = [];
  const decisions: string[] = [];
  const openThreads: string[] = [];
  const riskFlags: string[] = [];
  const pendingSteering: string[] = [];

  for (const message of messages) {
    const text = toMessageText(message);
    if (!text) continue;
    const lowered = text.toLowerCase();
    const snippet = clipLine(text);
    if (!snippet) continue;

    if (
      lowered.includes("operator steering") ||
      lowered.includes("steering update") ||
      lowered.includes("steer")
    ) {
      pushUniqueLimited(pendingSteering, snippet);
    }

    if (
      lowered.includes("risk") ||
      lowered.includes("drawdown") ||
      lowered.includes("slippage") ||
      lowered.includes("blocked") ||
      lowered.includes("timeout") ||
      lowered.includes("error") ||
      lowered.includes("unreachable") ||
      lowered.includes("kill switch") ||
      lowered.includes("insufficient")
    ) {
      pushUniqueLimited(riskFlags, snippet);
    }

    if (
      lowered.includes("trade") ||
      lowered.includes("swap") ||
      lowered.includes("rebalance") ||
      lowered.includes("dca") ||
      lowered.includes("thesis") ||
      lowered.includes("decision") ||
      lowered.includes("control_finish")
    ) {
      pushUniqueLimited(decisions, snippet);
    }

    if (
      lowered.includes("pending") ||
      lowered.includes("next") ||
      lowered.includes("follow up") ||
      lowered.includes("follow-up") ||
      lowered.includes("todo") ||
      lowered.includes("monitor") ||
      lowered.includes("watch")
    ) {
      pushUniqueLimited(openThreads, snippet);
    }

    pushUniqueLimited(facts, snippet);
  }

  if (facts.length === 0) {
    facts.push("No prior facts were available in compacted context.");
  }
  if (decisions.length === 0) {
    decisions.push("No explicit decision captured before compaction.");
  }
  if (openThreads.length === 0) {
    openThreads.push("No open thread recorded.");
  }
  if (riskFlags.length === 0) {
    riskFlags.push("No explicit risk flag recorded.");
  }
  if (pendingSteering.length === 0) {
    pendingSteering.push("No pending steering captured in compacted messages.");
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "deterministic",
    compactedMessages: messages.length,
    facts,
    decisions,
    openThreads,
    riskFlags,
    pendingSteering,
  };
}

function summaryToSystemMessage(
  summary: AgentCompactionSummary,
): Extract<ChatMessage, { role: "system" }> {
  const section = (label: string, values: string[]): string => {
    return `${label}:\n${values.map((value) => `- ${value}`).join("\n")}`;
  };
  const content = [
    CONTEXT_SUMMARY_PREFIX,
    `generated_at: ${summary.generatedAt}`,
    `source: ${summary.source}`,
    `compacted_messages: ${summary.compactedMessages}`,
    section("facts", summary.facts),
    section("decisions", summary.decisions),
    section("open_threads", summary.openThreads),
    section("risk_flags", summary.riskFlags),
    section("pending_steering", summary.pendingSteering),
  ].join("\n\n");
  return {
    role: "system",
    content,
  };
}

function compactMessagesForStep(
  messages: ChatMessage[],
  maxMessages: number,
  maxTokens: number,
): {
  messages: ChatMessage[];
  summary: AgentCompactionSummary;
} | null {
  const [system] = messages;
  if (!system || system.role !== "system") {
    if (
      messages.length <= maxMessages &&
      estimateMessageTokens(messages) <= maxTokens
    ) {
      return null;
    }
    const summary = buildDeterministicCompactionSummary(messages);
    return {
      summary,
      messages: [
        summaryToSystemMessage(summary),
        ...messages.slice(-(maxMessages - 1)),
      ],
    };
  }
  const shouldCompact =
    messages.length > maxMessages ||
    estimateMessageTokens(messages) > maxTokens;
  if (!shouldCompact) return null;

  const rest = messages.slice(1);
  const filteredRest = rest.filter((message) => {
    return !(
      message.role === "system" &&
      String(message.content ?? "").startsWith(CONTEXT_SUMMARY_PREFIX)
    );
  });
  const recentWindowSize = Math.max(6, maxMessages - 2);
  const historyCount = Math.max(0, filteredRest.length - recentWindowSize);
  const historyChunk =
    historyCount > 0
      ? filteredRest.slice(0, historyCount)
      : filteredRest.slice(0, 1);
  const summary = buildDeterministicCompactionSummary(historyChunk);
  const summaryMessage = summaryToSystemMessage(summary);
  const recent = filteredRest.slice(-recentWindowSize);
  while (recent[0]?.role === "tool") {
    recent.shift();
  }
  return {
    summary,
    messages: [system, summaryMessage, ...recent],
  };
}

function pickToolsForStep(
  tools: ChatTool[],
  consecutiveLlmTimeouts: number,
): ChatTool[] {
  if (consecutiveLlmTimeouts <= 0) return tools;
  const reduced = tools.filter((tool) =>
    TIMEOUT_RECOVERY_TOOL_NAMES.has(tool.function.name),
  );
  return reduced.length > 0 ? reduced : tools;
}

type ToolCallOutcome = {
  toolMessage: Extract<ChatMessage, { role: "tool" }>;
};

type SteeringCheckpointMessage = {
  id: number;
  message: string;
};

async function runToolCall(input: {
  call: ChatToolCall;
  handlers: Record<string, AgentToolHandler>;
  rt: AgentToolRuntime;
  log: LogFn;
}): Promise<ToolCallOutcome> {
  const { call, handlers, rt, log } = input;
  const name = call.function.name;
  const handler = handlers[name];
  if (!handler) {
    log("warn", "unknown tool call", { name });
    return {
      toolMessage: {
        role: "tool",
        tool_call_id: call.id,
        content: safeJsonString({
          ok: false,
          error: `unknown-tool:${name}`,
        }),
      },
    };
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

  return {
    toolMessage: {
      role: "tool",
      tool_call_id: call.id,
      content: toToolMessageContent(result),
    },
  };
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
  execution?: ExecutionConfig;
  strategy: AgentStrategy;
  privyWalletId?: string;
  providerSnapshot?: ProviderSnapshot;
  steering?: {
    pullCheckpointMessages?: () => Promise<SteeringCheckpointMessage[]>;
    markApplied?: (ids: number[], runId: string) => Promise<void>;
  };
  onContextCompaction?: (input: {
    compactedAt: string | null;
    compactedCount: number;
    messageWindowCount: number;
  }) => Promise<void> | void;
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
    execution,
    strategy,
    privyWalletId,
    steering,
    onContextCompaction,
  } = input;

  // 1) Load memory
  let memory = await getAgentMemory(env, tenantId);
  memory = resetDailyTradeCount(memory);
  const providerBotId = configTenantId ?? tenantId;
  let providerResolveError: string | null = null;
  const providerSnapshot =
    input.providerSnapshot ??
    (await resolveBotProviderSnapshot(env, providerBotId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      providerResolveError = message;
      log("warn", "agent blocked: inference provider unavailable", {
        botId: providerBotId,
        err: message,
      });
      return null;
    }));
  if (!providerSnapshot) {
    await updateLoopState(env, tenantId, (current) => ({
      ...current,
      agent: {
        ...(current.agent ?? {}),
        lastTickAt: new Date().toISOString(),
        inferenceBlockedAt: new Date().toISOString(),
        inferenceBlockedReason:
          providerResolveError ?? "inference-provider-not-configured",
      },
    })).catch(() => {});
    return;
  }

  const specialistRuntime: SpecialistRuntime = {
    env,
    tenantId,
    wallet,
    policy,
    strategy,
    rpc,
    jupiter,
    provider: providerSnapshot,
  };
  const [research, risk] = await Promise.all([
    runResearchSpecialist(specialistRuntime),
    runRiskSpecialist({
      runtime: specialistRuntime,
      memory,
    }),
  ]);
  if (risk.blocked) {
    log("warn", "agent blocked by risk specialist", {
      reasons: risk.reasons,
      providerModel: providerSnapshot.model,
      providerBaseUrlHash: providerSnapshot.baseUrlHash,
      riskProviderBaseUrlHash: risk.providerBaseUrlHash,
    });
    await updateLoopState(env, tenantId, (current) => ({
      ...current,
      agent: {
        ...(current.agent ?? {}),
        lastTickAt: new Date().toISOString(),
        inferenceBlockedAt: new Date().toISOString(),
        inferenceBlockedReason: risk.reasons.join(","),
      },
    })).catch(() => {});
    return;
  }
  const { snapshot, recentTrades } = research;

  log("info", "agent tick start", {
    quoteMint: snapshot.quoteMint,
    portfolioValueQuote: snapshot.portfolioValueQuote,
    baseAllocationPct: snapshot.baseAllocationPct,
    providerModel: providerSnapshot.model,
    providerBaseUrlHash: providerSnapshot.baseUrlHash,
    providerPingAgeMs: providerSnapshot.pingAgeMs,
    providerResolutionSource: providerSnapshot.resolutionSource,
    researchProviderBaseUrlHash: research.providerBaseUrlHash,
    riskProviderBaseUrlHash: risk.providerBaseUrlHash,
  });

  const system = buildAgentSystemPrompt({
    memory,
    snapshot,
    recentTrades,
    strategy,
    policy,
  });
  const mandateProfile = inferMandateProfile(strategy.mandate);

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
    execution,
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
        "New tick. Follow the mandate first, search broadly across policy-allowed mints, and act decisively when edge is present. When done, call control_finish.",
    },
  ];

  const startedAt = Date.now();
  const configuredMaxSteps = clampInt(
    strategy.maxStepsPerTick,
    mandateProfile.defaultMaxStepsPerTick,
    1,
    12,
  );
  const maxSteps = mandateProfile.aggressive
    ? Math.max(configuredMaxSteps, mandateProfile.defaultMaxStepsPerTick)
    : configuredMaxSteps;
  const configuredMaxToolCallsPerStep = clampInt(
    strategy.maxToolCallsPerStep,
    mandateProfile.defaultMaxToolCallsPerStep,
    1,
    10,
  );
  const maxToolCallsPerStep = mandateProfile.aggressive
    ? Math.max(
        configuredMaxToolCallsPerStep,
        mandateProfile.defaultMaxToolCallsPerStep,
      )
    : configuredMaxToolCallsPerStep;
  // Agent ticks can be tool-heavy (RPC + Jupiter + LLM). Give enough runway so the
  // LLM can still return a final `control_finish` without timing out.
  const deadlineMs = startedAt + 180_000;
  const baseLlmCallMs = 30_000;
  const maxLlmCallMs = 55_000;
  const llmTimeoutBackoffMs = 15_000;
  const maxConsecutiveLlmTimeouts = 2;
  const maxContextMessages = 18;
  const maxContextTokens = 6_000;

  let failure: unknown;
  let stepCount = 0;
  let finalReason = "completed";
  let consecutiveLlmTimeouts = 0;
  let compactedCount = 0;
  let compactedAt: string | null = null;
  const compactionSummaries: AgentCompactionSummary[] = [];
  try {
    for (let step = 0; step < maxSteps; ) {
      stepCount = step + 1;
      if (Date.now() > deadlineMs) {
        log("warn", "agent tick deadline exceeded", { maxSteps });
        finalReason = "deadline-exceeded";
        break;
      }

      if (steering?.pullCheckpointMessages) {
        const checkpointMessages = await steering
          .pullCheckpointMessages()
          .catch(() => []);
        if (checkpointMessages.length > 0) {
          const accepted = checkpointMessages
            .map((entry) => ({
              id: Math.trunc(Number(entry.id)),
              message: String(entry.message ?? "").trim(),
            }))
            .filter(
              (entry) =>
                Number.isFinite(entry.id) && entry.id > 0 && entry.message,
            );
          if (accepted.length > 0) {
            messages.push({
              role: "user",
              content: `Operator steering updates:\n${accepted
                .map((entry) => `- [#${entry.id}] ${entry.message}`)
                .join(
                  "\n",
                )}\nApply these updates at this checkpoint before continuing.`,
            });
            if (steering.markApplied) {
              await steering
                .markApplied(
                  accepted.map((entry) => entry.id),
                  runId,
                )
                .catch(() => {});
            }
            log("info", "agent steering checkpoint applied", {
              count: accepted.length,
              ids: accepted.map((entry) => entry.id),
            });
          }
        }
      }

      const remainingMs = deadlineMs - Date.now();
      try {
        const compacted = compactMessagesForStep(
          messages,
          maxContextMessages,
          maxContextTokens,
        );
        if (compacted) {
          messages.splice(0, messages.length, ...compacted.messages);
          compactedCount += 1;
          compactedAt = compacted.summary.generatedAt;
          compactionSummaries.push(compacted.summary);
          log("debug", "agent context compacted", {
            messageCount: messages.length,
            compactedCount,
            compactedMessages: compacted.summary.compactedMessages,
          });
        }
      } catch (error) {
        // Compaction is opportunistic; never block a trading tick on it.
        log("warn", "context compaction failed", {
          err: error instanceof Error ? error.message : String(error),
        });
      }
      // Keep individual LLM calls short and iterative so the agent behaves
      // continuously like Codex instead of waiting on one long response.
      const llmTimeoutMs = Math.max(
        1_000,
        Math.min(
          maxLlmCallMs,
          baseLlmCallMs + consecutiveLlmTimeouts * llmTimeoutBackoffMs,
          remainingMs - 500,
        ),
      );
      const llmTools = pickToolsForStep(tools, consecutiveLlmTimeouts);

      let response: Awaited<ReturnType<typeof callLlm>> | null = null;
      try {
        response = await callLlm(env, {
          messages,
          tools: llmTools,
          modelOverride: strategy.model,
          providerOverride: {
            baseUrl: providerSnapshot.baseUrl,
            apiKey: providerSnapshot.apiKey,
            model: providerSnapshot.model,
          },
          timeoutMs: llmTimeoutMs,
        });
        consecutiveLlmTimeouts = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("llm-timeout:")) {
          consecutiveLlmTimeouts += 1;
          log("warn", "agent llm step timeout", {
            step: step + 1,
            llmTimeoutMs,
            toolCount: llmTools.length,
            messageCount: messages.length,
            consecutiveLlmTimeouts,
          });
          const last = messages[messages.length - 1];
          if (
            !(
              last &&
              last.role === "user" &&
              last.content === TIMEOUT_NUDGE_MESSAGE
            )
          ) {
            messages.push({
              role: "user",
              content: TIMEOUT_NUDGE_MESSAGE,
            });
          }
          if (consecutiveLlmTimeouts >= maxConsecutiveLlmTimeouts) {
            finalReason = "llm-timeout-budget-exceeded";
            break;
          }
          continue;
        }
        if (msg.startsWith("inference-provider-unreachable")) {
          log("warn", "agent inference provider unreachable", {
            step: step + 1,
            err: msg,
          });
          finalReason = "inference-provider-unreachable";
          break;
        }
        throw err;
      }
      if (!response) continue;

      messages.push(response.assistantMessage);

      const toolCalls = response.toolCalls;
      log("debug", "agent llm step", {
        step: step + 1,
        finishReason: response.finishReason,
        toolCalls: toolCalls.map((c) => c.function.name),
      });

      if (toolCalls.length === 0) {
        finalReason = "no-tool-calls";
        break;
      }

      const toolCallCap =
        consecutiveLlmTimeouts > 0
          ? Math.min(maxToolCallsPerStep, 3)
          : maxToolCallsPerStep;
      const bounded =
        toolCalls.length > toolCallCap
          ? toolCalls.slice(0, toolCallCap)
          : toolCalls;
      if (bounded.length !== toolCalls.length) {
        log("warn", "too many tool calls in one step; truncating", {
          count: toolCalls.length,
          maxToolCallsPerStep: toolCallCap,
        });
      }

      const parallelBatch: ChatToolCall[] = [];
      const flushParallelBatch = async () => {
        if (parallelBatch.length === 0) return;
        const batch = [...parallelBatch];
        parallelBatch.length = 0;
        const batchStartedAt = Date.now();
        log("debug", "agent tool batch start", {
          mode: "parallel",
          count: batch.length,
          toolCalls: batch.map((call) => call.function.name),
        });
        const outcomes = await Promise.all(
          batch.map((call) =>
            runToolCall({
              call,
              handlers,
              rt,
              log,
            }),
          ),
        );
        for (const outcome of outcomes) {
          messages.push(outcome.toolMessage);
        }
        log("debug", "agent tool batch end", {
          mode: "parallel",
          count: batch.length,
          latencyMs: Date.now() - batchStartedAt,
        });
      };

      for (const call of bounded) {
        const name = call.function.name;
        if (!shouldRunSequentially(name)) {
          parallelBatch.push(call);
          continue;
        }

        await flushParallelBatch();
        const outcome = await runToolCall({
          call,
          handlers,
          rt,
          log,
        });
        messages.push(outcome.toolMessage);
        if (rt.stopRequested) break;
      }

      if (!rt.stopRequested) {
        await flushParallelBatch();
      }
      if (rt.stopRequested) {
        finalReason = "control-finish";
        break;
      }
      step += 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("llm-timeout:")) {
      // Timeouts are common with slower models/providers. End tick gracefully
      // so the bot keeps running and retries on the next loop.
      log("warn", "agent llm timeout; ending tick gracefully", { err: msg });
      failure = null;
    } else {
      log("error", "agent tick failed", { err: msg });
      failure = err;
    }
  } finally {
    if (!rt.stopRequested) {
      // Ensure every tick has a deterministic closure, even when the model
      // times out or exits early without calling control_finish.
      rt.stopRequested = true;
      log("info", "agent auto-finish", {
        reason: finalReason,
      });
    }

    const previousCompaction = rt.memory.compaction;
    const nextCompactionUpdatedAt = new Date().toISOString();
    const nextCompactedCount = Math.max(
      0,
      (previousCompaction?.compactedCount ?? 0) + compactedCount,
    );
    const priorSummaries = previousCompaction?.summaries ?? [];
    const nextSummaries = [...priorSummaries, ...compactionSummaries].slice(
      -12,
    );
    rt.memory = {
      ...rt.memory,
      compaction: {
        updatedAt: nextCompactionUpdatedAt,
        compactedCount: nextCompactedCount,
        messageWindowCount: messages.length,
        summaries: nextSummaries,
      },
    };

    // Persist whatever memory updates happened before failure.
    await saveAgentMemory(env, tenantId, rt.memory).catch((err) => {
      log("warn", "failed to save agent memory", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    await updateLoopState(env, tenantId, (current) => ({
      ...current,
      agent: {
        ...(current.agent ?? {}),
        lastTickAt: new Date().toISOString(),
        inferenceBlockedAt: undefined,
        inferenceBlockedReason: undefined,
        providerModel: providerSnapshot.model,
        providerBaseUrlHash: providerSnapshot.baseUrlHash,
        providerPingAgeMs: providerSnapshot.pingAgeMs ?? undefined,
        providerResolutionSource: providerSnapshot.resolutionSource,
        compactedAt: compactedAt ?? undefined,
        compactedCount,
        messageWindowCount: messages.length,
      },
    })).catch((err) => {
      log("warn", "failed to update loop state", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
    if (onContextCompaction) {
      await onContextCompaction({
        compactedAt,
        compactedCount,
        messageWindowCount: messages.length,
      }).catch(() => {});
    }

    log("info", "agent tick end", {
      steps: stepCount,
      reason: finalReason,
      stopRequested: rt.stopRequested,
      tradeExecuted: rt.tradeExecuted,
      providerModel: providerSnapshot.model,
      providerBaseUrlHash: providerSnapshot.baseUrlHash,
    });
  }

  if (!failure && finalReason === "inference-provider-unreachable") {
    failure = new Error("inference-provider-unreachable");
  }
  if (failure) throw failure;
}
