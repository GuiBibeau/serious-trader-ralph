# Skills

Drop tool modules in this folder and they will be auto‑loaded at gateway startup.

Each file should export either:
- `export default tool` (ToolDefinition)
- `export default () => tool`
- `export const tool = ...`

Example:

```ts
import type { ToolDefinition } from '../src/tools/registry.js';

const tool: ToolDefinition = {
  name: 'example.echo',
  description: 'Echo back input',
  schema: {
    name: 'example.echo',
    description: 'Echo back input',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  execute: async (_ctx, input: { text: string }) => ({ text: input.text }),
};

export default tool;
```
