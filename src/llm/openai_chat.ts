import type { LlmClient, LlmResponse, ToolSchema, LlmToolCall } from './types.js';
import type { SolmoltConfig } from '../config/config.js';

export class OpenAiChatClient implements LlmClient {
  constructor(private readonly config: SolmoltConfig['llm']) {}

  async generate(messages: Record<string, unknown>[], tools: ToolSchema[]): Promise<LlmResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload = {
      model: this.config.model,
      messages,
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: 'auto',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message;
    if (!choice) {
      throw new Error('LLM response missing message');
    }

    const toolCalls: LlmToolCall[] | undefined = choice.tool_calls
      ? choice.tool_calls.map((call: any) => ({
          id: String(call.id),
          name: String(call.function?.name ?? ''),
          arguments: String(call.function?.arguments ?? '{}'),
        }))
      : undefined;

    return {
      message: choice,
      text: choice.content ?? null,
      toolCalls,
    };
  }
}
