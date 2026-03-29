import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const backgroundOutputInputSchema = z.object({
  task_id: z.string().min(1),
  block: z.boolean().optional().default(false),
  full_session: z.boolean().optional().default(false),
  include_thinking: z.boolean().optional().default(false),
  include_tool_results: z.boolean().optional().default(false),
  message_limit: z.number().int().min(1).max(100).optional().default(20),
  since_message_id: z.string().min(1).optional(),
  thinking_max_chars: z.number().int().min(1).max(20000).optional().default(2000),
  timeout: z.number().int().min(1).max(600000).optional().default(60000),
});

const backgroundCancelInputSchema = z
  .object({
    taskId: z.string().min(1).optional(),
    all: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (value.all !== true && !value.taskId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'taskId is required when all=false',
        path: ['taskId'],
      });
    }
  });

export const backgroundOutputToolDefinition: ToolDefinition<
  typeof backgroundOutputInputSchema,
  z.ZodUnknown
> = {
  name: 'background_output',
  description:
    'Get output from background task. Use full_session=true to fetch session messages with filters. System notifies on completion, so block=true rarely needed. Timeout values are in milliseconds (ms), NOT seconds.',
  inputSchema: backgroundOutputInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('background_output must execute through the gateway-managed sandbox path');
  },
};

export const backgroundCancelToolDefinition: ToolDefinition<
  typeof backgroundCancelInputSchema,
  z.ZodUnknown
> = {
  name: 'background_cancel',
  description: 'Cancel running background task(s). Use all=true to cancel ALL before final answer.',
  inputSchema: backgroundCancelInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('background_cancel must execute through the gateway-managed sandbox path');
  },
};
