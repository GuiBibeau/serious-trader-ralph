export type ToolSchema = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LlmResponse = {
  message: Record<string, unknown>;
  text?: string | null;
  toolCalls?: LlmToolCall[];
};

export type LlmClient = {
  generate: (messages: Record<string, unknown>[], tools: ToolSchema[]) => Promise<LlmResponse>;
};
