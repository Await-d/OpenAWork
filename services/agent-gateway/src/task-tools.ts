import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

/**
 * Schema for the `task` (a.k.a. `delegate_task`) tool.
 *
 * Field notes — kept aligned with opencode / oh-my-opencode:
 *
 * - `session_id` (formerly `resume`): continue an existing child
 *   session. Consumed by `tool-sandbox.ts` task handler to look up
 *   `findTaskBySessionId` and replay onto the same child checkpoint.
 *
 * - `task_id`: alternative re-entry point — when the parent already
 *   owns a task graph entry, reuse its session id without having to
 *   carry the latter through every tool round-trip.
 *
 * - `command`: **reserved for future use**. opencode/oh-my-opencode
 *   use this to invoke a slash-command template that renders an
 *   alternate prompt before dispatching. OpenAWork's slash commands
 *   are discrete server-side actions (compact_session / init_deep /
 *   start_ralph_loop / …), not prompt templates, so there is no
 *   meaningful runtime mapping yet. The field is accepted (and
 *   currently ignored) so that LLM calls compatible with the upstream
 *   schema don't trip a validation error; once OpenAWork grows a
 *   prompt-template subsystem this can be wired through. Schema
 *   `.describe` text is intentionally explicit about the no-op so the
 *   model doesn't expect side effects.
 */
const taskInputSchema = z
  .object({
    description: z.string().min(1),
    prompt: z.string().min(1),
    subagent_type: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    load_skills: z.array(z.string().min(1)),
    run_in_background: z.boolean(),
    session_id: z
      .string()
      .min(1)
      .optional()
      .describe('要继续的已有子会话 ID（取代旧的 `resume` 字段）。'),
    task_id: z.string().min(1).optional(),
    command: z
      .string()
      .min(1)
      .optional()
      .describe(
        '保留字段，仅用于上游 schema 兼容的 slash command 标识。OpenAWork 目前忽略该字段——slash command 是服务端动作而非 prompt 模板，请直接在 `prompt` 中表达工作。',
      ),
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
    '启动一个 agent 任务，可按 category 选取或直接指定 agent。category 与 subagent_type 仅传其一。load_skills 与 run_in_background 必填。同步执行使用 run_in_background=false，仅并行后台工作时才传 true。子任务自动超时由助手首活超时 / 重试则控制。',
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('task must execute through the gateway-managed sandbox path');
  },
};
