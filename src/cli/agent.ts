import type { SolmoltConfig } from '../config/config.js';
import { runCliCommand } from './client.js';

export async function sendAgentMessage(config: SolmoltConfig, content: string, triggerTick?: boolean): Promise<void> {
  await runCliCommand(config, {
    method: 'tool.invoke',
    params: {
      name: 'agent.message',
      input: { content, triggerTick },
    },
  });
}
