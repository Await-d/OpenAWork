import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

const questionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

const questionItemSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  multiple: z.boolean().optional(),
  options: z.array(questionOptionSchema).min(1),
});

const questionToolInputSchema = z.object({
  questions: z.array(questionItemSchema).min(1),
});

const questionToolOutputSchema = z.string();

export type QuestionToolInput = z.infer<typeof questionToolInputSchema>;

export const questionToolDefinition: ToolDefinition<
  typeof questionToolInputSchema,
  typeof questionToolOutputSchema
> = {
  name: 'question',
  description:
    'Ask the user one or more structured questions and wait for their answer before continuing. Use this only when the missing choice truly blocks execution.',
  inputSchema: questionToolInputSchema,
  outputSchema: questionToolOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('question must execute through the gateway-managed sandbox path');
  },
};

export function buildQuestionRequestTitle(input: QuestionToolInput): string {
  const first = input.questions[0];
  return first?.header?.trim() || 'Question';
}

export function formatAnsweredQuestionOutput(input: {
  questions: QuestionToolInput['questions'];
  answers: string[][];
}): string {
  return input.questions
    .map((question, index) => {
      const answers = input.answers[index] ?? [];
      return `${question.question}="${answers.join(', ')}"`;
    })
    .join('\n');
}
