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
  description:
    'Enter plan mode for complex tasks. This should switch the session into a read-first planning state before implementation.',
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
  description:
    'Present the current plan for approval and exit plan mode when the user confirms implementation should start.',
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
    multiple?: boolean;
    options: Array<{ label: string; description: string }>;
  }>;
} {
  const summary = input.plan?.trim();
  return {
    questions: [
      {
        question: summary
          ? `Do you approve this plan and want implementation to start now?\n\n${summary}`
          : 'Do you approve the current plan and want implementation to start now?',
        header: 'Plan approval',
        multiple: false,
        options: [
          {
            label: EXIT_PLAN_MODE_APPROVE_LABEL,
            description: 'Approve the plan and let the session leave plan mode.',
          },
          {
            label: EXIT_PLAN_MODE_CONTINUE_LABEL,
            description: 'Keep plan mode active and continue refining the plan.',
          },
        ],
      },
    ],
  };
}

export function shouldExitPlanModeFromAnswers(answers: string[][]): boolean {
  return answers.some((entry) => entry.includes(EXIT_PLAN_MODE_APPROVE_LABEL));
}
