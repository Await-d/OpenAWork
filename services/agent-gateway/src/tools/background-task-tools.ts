import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const backgroundOutputInputSchema = z
  .object({
    task_id: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    block: z.boolean().optional().default(false),
    full_session: z.boolean().optional().default(false),
    include_thinking: z.boolean().optional().default(false),
    include_tool_results: z.boolean().optional().default(false),
    message_limit: z.number().int().min(1).max(100).optional().default(20),
    since_message_id: z.string().min(1).optional(),
    thinking_max_chars: z.number().int().min(1).max(20000).optional().default(2000),
    timeout: z.number().int().min(1).max(600000).optional().default(60000),
  })
  .superRefine((value, context) => {
    if (!value.task_id && !value.taskId && !value.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'task_id or taskId or runId is required',
        path: ['task_id'],
      });
    }
  })
  .transform((value) => ({
    task_id: value.runId ?? value.taskId ?? value.task_id ?? '',
    block: value.block,
    full_session: value.full_session,
    include_thinking: value.include_thinking,
    include_tool_results: value.include_tool_results,
    message_limit: value.message_limit,
    since_message_id: value.since_message_id,
    thinking_max_chars: value.thinking_max_chars,
    timeout: value.timeout,
  }));

const backgroundCancelInputSchema = z
  .object({
    task_id: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    all: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (value.all !== true && !value.taskId && !value.task_id && !value.runId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'taskId or task_id or runId is required when all=false',
        path: ['taskId'],
      });
    }
  })
  .transform((value) => ({
    taskId: value.runId ?? value.taskId ?? value.task_id,
    all: value.all,
  }));

export const backgroundOutputToolDefinition: ToolDefinition<
  typeof backgroundOutputInputSchema,
  z.ZodUnknown
> = {
  name: 'background_output',
  description:
    '获取后台任务输出。传 full_session=true 可以返回会话消息并支持过滤。后台任务完成时系统会主动通知，block=true 极少使用。Timeout 取值是**毫秒 ms**，不是秒。',
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
  description: '取消运行中的后台任务。传 all=true 可在输出最终答复前取消全部。',
  inputSchema: backgroundCancelInputSchema,
  outputSchema: z.unknown(),
  timeout: 30000,
  execute: async () => {
    throw new Error('background_cancel must execute through the gateway-managed sandbox path');
  },
};
