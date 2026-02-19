import { callLlm } from "../agent_llm";
import type { Env } from "../types";
import { summarizeLatestValidation, type TelemetrySnapshot } from "./context";
import type { ConversationSource } from "./types";

export type ConversationAnswer = {
  answer: string;
  sources: ConversationSource[];
  model: string | null;
};

const MAX_ANSWER_CHARS = 1500;
const MAX_CONTEXT_EVENTS = 12;
const LLM_TIMEOUT_MS = 5000;

function normalizeQuestion(value: string): string {
  return value.trim().toLowerCase();
}

function toLimitedLines(lines: string[]): string {
  return lines.filter((line) => line.trim().length > 0).join("\n");
}

function maskSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => maskSecrets(item));
  }

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.toLowerCase();
    if (
      key.includes("api_key") ||
      key.includes("secret") ||
      key.includes("private") ||
      key.includes("token")
    ) {
      out[rawKey] = "[redacted]";
      continue;
    }
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      out[rawKey] = maskSecrets(rawValue);
      continue;
    }
    if (Array.isArray(rawValue)) {
      out[rawKey] = rawValue.map((entry) => maskSecrets(entry));
      continue;
    }
    out[rawKey] = rawValue;
  }
  return out;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

function addSource(
  sources: ConversationSource[],
  source: ConversationSource,
): void {
  if (sources.length >= 10) return;
  sources.push(source);
}

function deterministicTemplate(
  question: string,
  telemetry: TelemetrySnapshot,
): {
  answer: string | null;
  sources: ConversationSource[];
} {
  const q = normalizeQuestion(question);
  const sources: ConversationSource[] = [];

  const gateReason = telemetry.startGate.reason
    ? telemetry.startGate.reason
    : telemetry.startGate.ok
      ? "none"
      : "unknown";
  const maybeLatestValidation = telemetry.latestValidation
    ? summarizeLatestValidation(telemetry.latestValidation)
    : null;
  const runtimeSource: ConversationSource = {
    type: "runtime",
    id: telemetry.tenantId,
    label: "Runtime state",
    hint: telemetry.runtimeState?.lifecycleState,
  };
  addSource(sources, runtimeSource);

  if (
    q.includes("what happened recently") ||
    q.includes("what happened") ||
    q.includes("recent")
  ) {
    const recentEvents = telemetry.botEvents.slice(0, 6);
    const eventLines = recentEvents.map(
      (event, index) =>
        `${index + 1}) [${event.level}] ${event.message}${
          event.reason ? ` (${event.reason})` : ""
        } at ${event.ts}`,
    );
    const recentTrades = telemetry.trades.slice(0, 4).map((trade, index) => {
      const status = trade.status ?? "unknown";
      return `${index + 1}) ${trade.market ?? "unknown"} ${trade.side ?? "trade"} (${status})`;
    });

    for (const event of recentEvents) {
      addSource(sources, {
        type: "log",
        id: `${event.ts}:${event.message}`,
        label: "Bot event",
        hint: event.runId ?? undefined,
      });
    }
    for (const trade of telemetry.trades.slice(0, 4)) {
      addSource(sources, {
        type: "trade",
        id: String(trade.id),
        label: `Trade #${trade.id}`,
        hint: trade.status ?? undefined,
      });
    }

    if (recentEvents.length === 0 && recentTrades.length === 0) {
      return {
        answer: "No recent log events or trades were recorded yet.",
        sources,
      };
    }

    return {
      answer: toLimitedLines([
        `Latest activity snapshot:`,
        ...eventLines,
        ...recentTrades,
      ]),
      sources,
    };
  }

  if (
    q.includes("validation") &&
    (q.includes("status") || q.includes("how") || q.includes("how's"))
  ) {
    const latest = telemetry.latestValidation;
    if (latest) {
      addSource(sources, {
        type: "validation",
        id: String(latest.id),
        label: `Validation #${latest.id}`,
      });
      return {
        answer: toLimitedLines([
          `Validation status: ${latest.status}.`,
          `Profile: ${latest.profile}, window: ${latest.lookbackDays}d.`,
          maybeLatestValidation ?? "",
          latest.metrics
            ? `Net ${formatPct(latest.metrics.netReturnPct)}, DD ${formatPct(latest.metrics.maxDrawdownPct)}, PF ${latest.metrics.profitFactor.toFixed(2)}, trades ${latest.metrics.tradeCount}.`
            : "No metrics available.",
        ]),
        sources,
      };
    }
    return {
      answer:
        "No validation run has been executed yet. Run a validation before starting.",
      sources: [
        {
          type: "runtime",
          id: telemetry.tenantId,
          label: "Validation state",
          hint: "No run",
        },
      ],
    };
  }

  if (
    q.includes("blocked") ||
    q.includes("why did i get blocked") ||
    q.includes("start gate")
  ) {
    const blocked = !telemetry.startGate.ok;
    const inferenceBlocked =
      telemetry.agentRun.state === "blocked_inference" ||
      (telemetry.agentRun.blockedReason ?? "").startsWith("inference-provider");
    addSource(sources, {
      type: "runtime",
      id: telemetry.tenantId,
      label: "Start gate",
      hint: gateReason,
    });
    return {
      answer: inferenceBlocked
        ? `Execution is blocked by inference health: ${telemetry.agentRun.blockedReason ?? "inference-provider-unreachable"}. Fix provider settings and retest connection.`
        : blocked
          ? `Start is blocked by validation: ${gateReason}. Start the bot only after a passed validation for strategy hash ${telemetry.startGate.strategyHash ?? "latest config"}.`
          : "Start gate is clear. Bot is allowed to run.",
      sources,
    };
  }

  if (
    q.includes("last trade") ||
    q.includes("latest trade") ||
    q.includes("trade status")
  ) {
    const latestTrade = telemetry.trades[0];
    if (!latestTrade) {
      return {
        answer: "No trades have been recorded for this bot yet.",
        sources: [
          { type: "trade", id: "none", label: "Trade log", hint: "empty" },
        ],
      };
    }
    addSource(sources, {
      type: "trade",
      id: String(latestTrade.id),
      label: `Trade #${latestTrade.id}`,
    });
    return {
      answer: toLimitedLines([
        `Last trade:`,
        `  market=${latestTrade.market ?? "unknown"}`,
        `  side=${latestTrade.side ?? "unknown"}`,
        `  status=${latestTrade.status ?? "unknown"}`,
        `  signature=${latestTrade.signature ?? "pending"}`,
      ]),
      sources,
    };
  }

  return { answer: null, sources };
}

function clampAnswer(value: string): string {
  if (value.length <= MAX_ANSWER_CHARS) return value;
  return `${value.slice(0, MAX_ANSWER_CHARS - 3)}...`;
}

function buildSnapshotContext(telemetry: TelemetrySnapshot): string {
  const runtime = telemetry.runtimeState;
  const cfg = telemetry.config;
  const strategyDescriptor = telemetry.strategyDescriptor;
  const lastValidation = telemetry.latestValidation;
  const sanitized = maskSecrets({
    enabled: cfg.enabled,
    strategy: strategyDescriptor,
    execution: cfg.execution,
    validationConfig: cfg.validation ?? null,
    autotune: cfg.autotune ?? null,
    policy: cfg.policy ?? null,
    runtime: {
      lifecycle: runtime?.lifecycleState,
      lastTunedAt: runtime?.lastTunedAt,
      consecutiveFailures: runtime?.consecutiveFailures,
      nextRevalidateAt: runtime?.nextRevalidateAt,
    },
    latestValidation: lastValidation
      ? {
          id: lastValidation.id,
          status: lastValidation.status,
          profile: lastValidation.profile,
          lookbackDays: lastValidation.lookbackDays,
          summary: lastValidation.summary,
        }
      : null,
    startGate: telemetry.startGate,
  });

  return JSON.stringify({
    tenant: telemetry.tenantId,
    snapshot: sanitized,
    recentLogs: telemetry.botEvents.slice(0, MAX_CONTEXT_EVENTS),
    recentTrades: telemetry.trades.slice(0, MAX_CONTEXT_EVENTS),
    recentStrategyEvents: telemetry.strategyEvents.slice(0, MAX_CONTEXT_EVENTS),
  });
}

export async function answerQuestion(
  env: Env,
  telemetry: TelemetrySnapshot,
  question: string,
  explain: boolean,
  providerOverride?: {
    baseUrl: string;
    apiKey: string;
    model?: string;
  },
): Promise<ConversationAnswer> {
  const normalized = question.trim();
  if (!normalized) {
    return {
      answer:
        "No question was provided. Ask about validation, events, or trades.",
      sources: [],
      model: null,
    };
  }

  const direct = deterministicTemplate(normalized, telemetry);
  if (direct.answer) {
    const answer = clampAnswer(direct.answer);
    const sources = direct.sources.length ? direct.sources : [];
    if (!explain) {
      return { answer, sources, model: null };
    }
    return {
      answer: `${answer}\n\n[deterministic-template]`,
      sources,
      model: null,
    };
  }

  const modelAvailable = Boolean(
    providerOverride?.baseUrl && providerOverride?.apiKey && providerOverride?.model,
  );
  if (!modelAvailable) {
    const fallback = clampAnswer(
      `I can summarize what I know: ${telemetry.strategyDescriptor.headline}; ${
        telemetry.startGate.ok ? "start gate allows run" : "start gate blocked"
      }. Latest validation: ${telemetry.latestValidation ? telemetry.latestValidation.status : "none"}; lifecycle: ${telemetry.runtimeState?.lifecycleState ?? "unknown"}.`,
    );
    return {
      answer: fallback,
      sources: [
        { type: "runtime", id: telemetry.tenantId, label: "Runtime snapshot" },
      ],
      model: null,
    };
  }

  const context = buildSnapshotContext(telemetry);
  const system = `You are the bot operations analyst. Answer concisely from only the telemetry JSON below. No side effects and no tool calls. If unsure, say unknown.
Use this strict format with bullet points where possible:
- summary
- key facts
- citations using source ids provided in the user context`;

  try {
    const llm = await callLlm(env, {
      modelOverride: undefined,
      providerOverride,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `${context}\n\nQuestion: ${normalized}\n`,
        },
      ],
      tools: [],
      timeoutMs: LLM_TIMEOUT_MS,
    });
    const raw = llm.assistantMessage.content ?? "";
    const answer = clampAnswer(
      raw.trim() || "I could not produce a confident response.",
    );
    return {
      answer,
      sources: [],
      model: "llm",
    };
  } catch (err) {
    const errText =
      err instanceof Error ? err.message : `chat-llm-${String(err)}`;
    const fallback = clampAnswer(
      `LLM temporarily unavailable (${errText.slice(0, 120)}). ` +
        `Latest validation: ${telemetry.latestValidation?.status ?? "none"}, strategy state: ${telemetry.runtimeState?.lifecycleState ?? "unknown"}.`,
    );
    return {
      answer: fallback,
      sources: [
        { type: "error", id: "llm", label: "LLM fallback due to error" },
      ],
      model: null,
    };
  }
}
