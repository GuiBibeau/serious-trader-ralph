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
    providerOverride?: {
      baseUrl: string;
      apiKey: string;
      model?: string;
    };
    timeoutMs?: number;
  },
): Promise<{
  assistantMessage: Extract<ChatMessage, { role: "assistant" }>;
  toolCalls: ChatToolCall[];
  finishReason?: string;
}> {
  const baseUrl = input.providerOverride?.baseUrl?.trim();
  const apiKey = input.providerOverride?.apiKey?.trim();
  const model = input.modelOverride || input.providerOverride?.model;
  if (!baseUrl || !apiKey || !model) {
    throw new Error("inference-provider-not-configured");
  }

  const timeoutMs = Math.max(
    1_000,
    Math.min(120_000, input.timeoutMs ?? 20_000),
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
        `inference-provider-unreachable:${response.status}:${text.slice(0, 200)}`,
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
    if (
      err instanceof Error &&
      (err.message.startsWith("llm-timeout:") ||
        err.message.startsWith("inference-provider-unreachable:") ||
        err.message === "inference-provider-not-configured")
    ) {
      throw err;
    }
    throw new Error(
      `inference-provider-unreachable:${err instanceof Error ? err.message : String(err)}`,
    );
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
