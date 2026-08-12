import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const allowedPromptSchema = z.object({
  tool: z.enum(['Bash']),
  prompt: z.string().min(1),
});

const enterPlanModeInputSchema = z.object({}).strict();
const exitPlanModeInputSchema = z
  .object({
    allowedPrompts: z.array(allowedPromptSchema).optional(),
    plan: z.string().min(1).optional(),
  })
  .strict();

const planModeOutputSchema = z.string();

export type ExitPlanModeInput = z.infer<typeof exitPlanModeInputSchema>;

export const enterPlanModeToolDefinition: ToolDefinition<
  typeof enterPlanModeInputSchema,
  typeof planModeOutputSchema
> = {
  name: 'EnterPlanMode',
  description: '针对复杂任务进入 plan 模式。会将会话切换为实现前的"先读后规划"状态。',
  inputSchema: enterPlanModeInputSchema,
  outputSchema: planModeOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('EnterPlanMode must execute through the gateway-managed sandbox path');
  },
};

export const exitPlanModeToolDefinition: ToolDefinition<
  typeof exitPlanModeInputSchema,
  typeof planModeOutputSchema
> = {
  name: 'ExitPlanMode',
  description: '将当前计划提交审批；用户确认可以开始实现后退出 plan 模式。',
  inputSchema: exitPlanModeInputSchema,
  outputSchema: planModeOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('ExitPlanMode must execute through the gateway-managed sandbox path');
  },
};

export const EXIT_PLAN_MODE_APPROVE_LABEL = 'Start implementation';
export const EXIT_PLAN_MODE_CONTINUE_LABEL = 'Continue planning';

export function buildExitPlanModeQuestionInput(input: ExitPlanModeInput): {
  questions: Array<{
    question: string;
    header: string;
    multiSelect?: boolean;
    options: Array<{ label: string; description: string }>;
  }>;
} {
  const summary = input.plan?.trim();
  return {
    questions: [
      {
        question: summary
          ? `是否批准当前计划并立即开始实现？\n\n${summary}`
          : '是否批准当前计划并立即开始实现？',
        header: '计划审批',
        multiSelect: false,
        options: [
          {
            label: EXIT_PLAN_MODE_APPROVE_LABEL,
            description: '批准计划并让会话退出 plan 模式。',
          },
          {
            label: EXIT_PLAN_MODE_CONTINUE_LABEL,
            description: '保持 plan 模式激活并继续调优计划。',
          },
        ],
      },
    ],
  };
}

export function shouldExitPlanModeFromAnswers(answers: string[][]): boolean {
  return answers.some((entry) => entry.includes(EXIT_PLAN_MODE_APPROVE_LABEL));
}
