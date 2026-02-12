import type { Env } from "./types";

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatToolCall = {
  id: string;
  type?: string;
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      // Legacy function calling format.
      function_call?: {
        name?: string;
        arguments?: string;
      };
    };
    finish_reason?: string;
  }>;
};

export async function callLlm(
  env: Env,
  input: {
    messages: ChatMessage[];
    tools: ChatTool[];
    modelOverride?: string;
    timeoutMs?: number;
  },
): Promise<{
  assistantMessage: Extract<ChatMessage, { role: "assistant" }>;
  toolCalls: ChatToolCall[];
  finishReason?: string;
}> {
  const baseUrl = env.ZAI_BASE_URL;
  if (!baseUrl) throw new Error("zai-base-url-missing");
  const apiKey = env.ZAI_API_KEY;
  if (!apiKey) throw new Error("zai-api-key-missing");
  const model = input.modelOverride || env.ZAI_MODEL;
  if (!model) throw new Error("zai-model-not-configured");

  const timeoutMs = Math.max(
    1_000,
    Math.min(30_000, input.timeoutMs ?? 20_000),
  );
  // Trim trailing slashes so callers can pass either "https://host" or "https://host/".
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: input.messages,
        tools: input.tools,
        tool_choice: "auto",
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `llm-api-error: ${response.status} ${text.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const choice = payload.choices?.[0];
    const msg = choice?.message;

    const toolCalls = parseToolCalls(msg);
    const assistantMessage: Extract<ChatMessage, { role: "assistant" }> = {
      role: "assistant",
      content: msg?.content ?? null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };

    return {
      assistantMessage,
      toolCalls,
      finishReason: choice?.finish_reason,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`llm-timeout: ${timeoutMs}ms exceeded`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseToolCalls(
  message: ChatCompletionResponse["choices"][number]["message"] | undefined,
): ChatToolCall[] {
  const calls = message?.tool_calls;
  if (calls && calls.length > 0) {
    const out: ChatToolCall[] = [];
    for (const c of calls) {
      const id = String(c.id ?? "").trim();
      const name = String(c.function?.name ?? "").trim();
      const args = String(c.function?.arguments ?? "");
      if (!id || !name) continue;
      out.push({
        id,
        type: c.type,
        function: { name, arguments: args },
      });
    }
    return out;
  }

  // Legacy single function_call format; translate to a tool call.
  const legacy = message?.function_call;
  if (legacy?.name) {
    return [
      {
        id: "legacy_function_call",
        type: "function",
        function: {
          name: String(legacy.name),
          arguments: String(legacy.arguments ?? ""),
        },
      },
    ];
  }

  return [];
}
