import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const batchToolInputSchema = z.object({
  tool_calls: z
    .array(
      z.object({
        tool: z.string().min(1),
        parameters: z.record(z.unknown()),
      }),
    )
    .min(1),
});

const batchToolOutputSchema = z.object({
  results: z.array(
    z.object({
      tool: z.string(),
      isError: z.boolean(),
      output: z.unknown(),
    }),
  ),
  total: z.number().int().min(0),
});

export const batchToolDefinition: ToolDefinition<
  typeof batchToolInputSchema,
  typeof batchToolOutputSchema
> = {
  name: 'batch',
  description:
    'Execute multiple runtime tool calls in parallel. Use only for independent calls that do not rely on each other or require strict ordering.',
  inputSchema: batchToolInputSchema,
  outputSchema: batchToolOutputSchema,
  timeout: 120000,
  execute: async () => {
    throw new Error('batch must execute through the gateway-managed sandbox path');
  },
};

export const BATCH_TOOL_MAX_CALLS = 25;
export const BATCH_TOOL_DISALLOWED = new Set(['batch', 'mcp_call', 'mcp_list_tools']);
