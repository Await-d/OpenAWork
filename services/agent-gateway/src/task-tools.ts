import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const taskInputSchema = z
  .object({
    description: z.string().min(1),
    prompt: z.string().min(1),
    subagent_type: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    load_skills: z.array(z.string().min(1)).optional().default([]),
    run_in_background: z.boolean().optional().default(true),
    session_id: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.subagent_type && value.category) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either category or subagent_type, not both',
        path: ['category'],
      });
    }

    if (!value.subagent_type && !value.category) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either category or subagent_type is required',
        path: ['subagent_type'],
      });
    }
  });

const taskOutputSchema = z.object({
  taskId: z.string(),
  sessionId: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
  assignedAgent: z.string(),
  category: z.string().optional(),
});

export const taskToolDefinition: ToolDefinition<typeof taskInputSchema, typeof taskOutputSchema> = {
  name: 'task',
  description:
    'Create a child task and child session for delegated work. Use this when work should continue in a separate sub-session instead of the current conversation.',
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('task must execute through the gateway-managed sandbox path');
  },
};
