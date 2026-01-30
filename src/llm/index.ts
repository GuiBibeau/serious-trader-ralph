import type { LlmClient } from './types.js';
import { OpenAiChatClient } from './openai_chat.js';
import type { SolmoltConfig } from '../config/config.js';

export function createLlmClient(config: SolmoltConfig['llm']): LlmClient {
  if (config.provider === 'openai_chat') {
    return new OpenAiChatClient(config);
  }
  throw new Error(`Unsupported LLM provider: ${config.provider}`);
}

export type { LlmClient, ToolSchema, LlmResponse, LlmToolCall } from './types.js';
