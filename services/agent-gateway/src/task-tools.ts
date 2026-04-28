import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const taskInputSchema = z
  .object({
    description: z.string().min(1),
    prompt: z.string().min(1),
    subagent_type: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    load_skills: z.array(z.string().min(1)),
    run_in_background: z.boolean(),
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
  requestedSkills: z.array(z.string()).optional(),
  result: z.string().optional(),
  errorMessage: z.string().optional(),
  message: z.string().optional(),
  reason: z.string().optional(),
  timeoutSource: z.enum(['first_response']).optional(),
});

export const taskToolDefinition: ToolDefinition<typeof taskInputSchema, typeof taskOutputSchema> = {
  name: 'task',
  description:
    'Spawn agent task with category-based or direct agent selection. Provide exactly one of category or subagent_type. load_skills and run_in_background are required. Use run_in_background=false for sync task execution and true only for parallel background work. Child auto-timeout is driven by assistant first-activity timeout/retry behavior.',
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('task must execute through the gateway-managed sandbox path');
  },
};
