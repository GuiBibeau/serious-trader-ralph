import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import {
  BURST_WINDOW_MS,
  buildMessages,
  burstAllowed,
  CHAT_TOOLS,
  type ChatMessage,
  type ChatRole,
  capHistory,
  dailyAllowed,
  groundedOrNull,
  toolToEdgePath,
} from "$lib/chat-core";
import { verifyPrivyAccessToken } from "$lib/server/privy";
import type { RequestHandler } from "./$types";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const TOOL_RESULT_CAP = 4_000;
const MAX_TOOL_ROUNDS = 3;
const TOOL_TIMEOUT_MS = 5_000;

// V1 rate caps are intentionally in-memory and approximate across instances.
// Fluid reuses instances enough for this side-panel chat guardrail.
const burstByUser = new Map<string, number[]>();
const dailyByUser = new Map<string, { dayKey: string; count: number }>();

type ChatRequestBody = {
  history: ChatMessage[];
  context: unknown;
  edgeToken?: string;
};

type DeepSeekMessage =
  | { role: string; content: string }
  | { role: "assistant"; content: string; tool_calls: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type DeepSeekResponse = {
  choices?: {
    message?: {
      content?: unknown;
      tool_calls?: unknown;
    };
  }[];
};

type ToolResult = { message: DeepSeekMessage; facts: string };

export const POST: RequestHandler = async ({ request, fetch, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const userId = token ? await verifyPrivyAccessToken(token) : null;
  if (!userId) return json({ error: "auth-required" }, { status: 401 });

  const body = await readChatBody(request);
  if (!body) return json({ error: "bad-request" }, { status: 400 });

  const history = capHistory(body.history);
  const contextJson = JSON.stringify(body.context);
  if (typeof contextJson !== "string") {
    return json({ error: "bad-request" }, { status: 400 });
  }

  const nowMs = Date.now();
  const recent = (burstByUser.get(userId) ?? []).filter(
    (timestamp) => nowMs - timestamp < BURST_WINDOW_MS,
  );
  if (!burstAllowed(recent, nowMs)) {
    burstByUser.set(userId, recent);
    return json({ error: "limit-reached", scope: "burst" }, { status: 429 });
  }

  const daily = dailyAllowed(dailyByUser.get(userId) ?? null, nowMs);
  dailyByUser.set(userId, daily.nextRecord);
  if (!daily.allowed) {
    burstByUser.set(userId, recent);
    return json({ error: "limit-reached", scope: "daily" }, { status: 429 });
  }
  burstByUser.set(userId, [...recent, nowMs]);

  const generated = await generateReply({
    context: body.context,
    edgeFetch: fetch,
    edgeToken: body.edgeToken,
    history,
    nowMs,
  });
  if (!generated) return json({ reply: null, reason: "unavailable" });

  // Grounding facts include the conversation itself: a number the user
  // typed is a given fact — echoing it back is not invention.
  const reply = groundedOrNull(
    generated.reply,
    [
      contextJson,
      ...history.map((message) => message.content),
      ...generated.toolFacts,
    ].join("\n"),
  );
  if (reply === null) return json({ reply: null, reason: "ungrounded" });

  return json({ reply, asOf: Date.now() });
};

async function readChatBody(request: Request): Promise<ChatRequestBody | null> {
  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  if (!("context" in body)) return null;
  if (!Array.isArray(body.history)) return null;
  const history = parseHistory(body.history);
  if (!history) return null;
  if ("edgeToken" in body && typeof body.edgeToken !== "string") return null;
  return {
    history,
    context: body.context,
    edgeToken: typeof body.edgeToken === "string" ? body.edgeToken : undefined,
  };
}

function parseHistory(history: unknown[]): ChatMessage[] | null {
  const parsed: ChatMessage[] = [];
  for (const item of history) {
    if (!isRecord(item)) return null;
    if (!isChatRole(item.role) || typeof item.content !== "string") return null;
    parsed.push({ role: item.role, content: item.content });
  }
  return parsed;
}

function isChatRole(value: unknown): value is ChatRole {
  return value === "user" || value === "assistant" || value === "tool";
}

async function generateReply(input: {
  context: unknown;
  edgeFetch: typeof fetch;
  edgeToken?: string;
  history: ChatMessage[];
  nowMs: number;
}): Promise<{ reply: string; toolFacts: string[] } | null> {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const messages: DeepSeekMessage[] = buildMessages(
    input.context,
    input.history,
    input.nowMs,
  );
  const toolFacts: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await callDeepSeek(apiKey, messages);
    if (!response) return null;

    const toolCalls = parseToolCalls(response.tool_calls);
    if (toolCalls.length === 0) {
      return response.content.trim()
        ? { reply: response.content.trim(), toolFacts }
        : null;
    }

    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: toolCalls,
    });
    const results = await Promise.all(
      toolCalls.map((toolCall) =>
        resolveToolCall(toolCall, input.edgeFetch, input.edgeToken),
      ),
    );
    for (const result of results) {
      messages.push(result.message);
      toolFacts.push(result.facts);
    }
  }

  return null;
}

async function callDeepSeek(
  apiKey: string,
  messages: DeepSeekMessage[],
): Promise<{ content: string; tool_calls: unknown } | null> {
  const response = await globalThis.fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      max_tokens: 400,
      messages,
      tools: CHAT_TOOLS.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    }),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as DeepSeekResponse;
  const message = data.choices?.[0]?.message;
  if (!message) return null;
  return {
    content: typeof message.content === "string" ? message.content : "",
    tool_calls: message.tool_calls,
  };
}

function parseToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue;
    const id = item.id;
    const name = item.function.name;
    const args = item.function.arguments;
    if (typeof id !== "string" || typeof name !== "string") continue;
    calls.push({
      id,
      type: "function",
      function: { name, arguments: typeof args === "string" ? args : "{}" },
    });
  }
  return calls;
}

async function resolveToolCall(
  toolCall: ToolCall,
  edgeFetch: typeof fetch,
  edgeToken: string | undefined,
): Promise<ToolResult> {
  const unavailable = (): ToolResult => ({
    message: {
      role: "tool",
      tool_call_id: toolCall.id,
      content: '{"status":"unavailable"}',
    },
    facts: '{"status":"unavailable"}',
  });

  const path = toolToEdgePath(toolCall.function.name);
  if (!path) return unavailable();

  try {
    const headers: HeadersInit = edgeToken
      ? { authorization: `Bearer ${edgeToken}` }
      : {};
    const response = await edgeFetch(`${env.EDGE_API_BASE ?? ""}${path}`, {
      headers,
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    if (!response.ok) return unavailable();
    const content = (await response.text()).slice(0, TOOL_RESULT_CAP);
    return {
      message: { role: "tool", tool_call_id: toolCall.id, content },
      facts: content,
    };
  } catch {
    return unavailable();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
