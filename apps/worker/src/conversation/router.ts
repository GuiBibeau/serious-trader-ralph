import { resolveBotProviderSnapshot } from "../inference_provider";
import type { Env } from "../types";
import { answerQuestion, type ConversationAnswer } from "./answerer";
import { buildConversationContext } from "./context";
import { createConversationMessage, listConversationMessages } from "./repo";
import type { ConversationMessage, ConversationRequest } from "./types";

const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 40;

function parseIncludeSources(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        String(item ?? "")
          .toLowerCase()
          .trim(),
      )
      .filter((value) => value.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
  }
  return [];
}

function parseLimit(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function normalizeQuestion(value: unknown): string {
  const message = String(value ?? "").trim();
  if (!message) return "";
  return message.length > MAX_MESSAGE_CHARS
    ? message.slice(0, MAX_MESSAGE_CHARS)
    : message;
}

export async function handleChatRequest(
  env: Env,
  tenantId: string,
  payload: ConversationRequest,
): Promise<{
  ok: true;
  answer: string;
  sources: ConversationAnswer["sources"];
  conversationId: number;
  telemetrySnapshot: unknown;
}> {
  const message = normalizeQuestion(payload.message);
  if (!message) {
    throw new Error("invalid-message");
  }

  const includeSources = parseIncludeSources(payload.includeSources);
  const explain = Boolean(payload.explain);
  const historyLimit = parseLimit(payload.limit, DEFAULT_HISTORY_LIMIT);
  const context = await buildConversationContext(env, tenantId, {
    includeSources,
    limit: {
      botEvents: Math.max(1, Math.floor(historyLimit * 0.4)),
      strategyEvents: Math.max(1, Math.floor(historyLimit * 0.2)),
      trades: Math.max(1, Math.floor(historyLimit * 0.2)),
      validationRuns: Math.max(1, Math.floor(historyLimit * 0.2)),
    },
  });

  const providerSnapshot = await resolveBotProviderSnapshot(env, tenantId, {
    verify: true,
  }).catch(() => null);
  const answer = await answerQuestion(
    env,
    context.telemetry,
    message,
    explain,
    providerSnapshot
      ? {
          baseUrl: providerSnapshot.baseUrl,
          apiKey: providerSnapshot.apiKey,
          model: providerSnapshot.model,
        }
      : undefined,
  );
  const userMessageId = await createConversationMessage(env, {
    tenantId,
    role: "user",
    actor: "user",
    question: message,
  }).catch(() => 0);
  const assistantMessageId = await createConversationMessage(env, {
    tenantId,
    role: "assistant",
    actor: "admin",
    answer: answer.answer,
    model: answer.model,
    sources: answer.sources,
  }).catch(() => 0);

  const conversationId = Math.max(userMessageId, assistantMessageId);

  await listConversationMessages(
    env,
    tenantId,
    Math.max(1, Math.min(MAX_HISTORY_LIMIT, historyLimit + 2)),
  ).catch(() => {});

  return {
    ok: true,
    answer: answer.answer,
    sources: answer.sources,
    conversationId,
    telemetrySnapshot: context.telemetry,
  };
}

export async function handleChatHistory(
  env: Env,
  tenantId: string,
  request: Request,
): Promise<{ ok: true; messages: ConversationMessage[] }> {
  const url = new URL(request.url);
  const limit = parseLimit(
    url.searchParams.get("limit"),
    DEFAULT_HISTORY_LIMIT,
  );
  const messages = await listConversationMessages(
    env,
    tenantId,
    Math.max(1, Math.min(MAX_HISTORY_LIMIT, limit)),
  );
  return { ok: true, messages };
}

export async function handleTelemetry(
  env: Env,
  tenantId: string,
  request: Request,
): Promise<{ ok: true; telemetry: unknown }> {
  const url = new URL(request.url);
  const includeSources = parseIncludeSources(
    url.searchParams.get("includeSources"),
  );
  const includeLimit = parseLimit(url.searchParams.get("limit"), 100);
  const context = await buildConversationContext(env, tenantId, {
    includeSources,
    limit: {
      botEvents: parseLimit(includeLimit, 100),
      strategyEvents: parseLimit(includeLimit, 100),
      trades: parseLimit(includeLimit, 100),
      validationRuns: parseLimit(includeLimit, 60),
    },
  });

  return { ok: true, telemetry: context.telemetry };
}
