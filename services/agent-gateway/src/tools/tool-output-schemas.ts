import { z } from 'zod';

export const readToolOutputInputSchema = z
  .object({
    toolCallId: z.string().min(1).optional(),
    toolCallRef: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    useLatestReferenced: z.boolean().optional(),
    jsonPath: z.string().min(1).optional(),
    lineStart: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(1).max(400).optional(),
    charStart: z.number().int().min(0).optional(),
    charCount: z.number().int().min(1).max(8000).optional(),
    itemStart: z.number().int().min(0).optional(),
    itemCount: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toolCallId || value.toolCallRef || value.useLatestReferenced === true) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'toolCallId 和 useLatestReferenced 至少提供一个。',
      path: ['toolCallId'],
    });
  });

export const readToolOutputSelectionSchema = z
  .object({
    mode: z.enum(['full', 'items', 'keys', 'lines', 'chars']),
    jsonPath: z.string().optional(),
    charStart: z.number().int().min(0).optional(),
    charCount: z.number().int().min(0).optional(),
    nextCharStart: z.number().int().min(0).optional(),
    lineStart: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(0).optional(),
    itemStart: z.number().int().min(0).optional(),
    itemCount: z.number().int().min(0).optional(),
  })
  .strict();

export const readToolOutputOutputSchema = z
  .object({
    toolCallId: z.string(),
    toolCallRef: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    fullOutputPreserved: z.literal(true),
    outputType: z.string(),
    isError: z.boolean(),
    sizeBytes: z.number().int().min(0),
    selection: readToolOutputSelectionSchema,
    note: z.string().optional(),
    output: z.unknown().optional(),
    totalChars: z.number().int().min(0).optional(),
    totalItems: z.number().int().min(0).optional(),
    totalLines: z.number().int().min(0).optional(),
    topLevelKeys: z.array(z.string()).optional(),
  })
  .strict();

export type ReadToolOutputInput = z.infer<typeof readToolOutputInputSchema>;
export type ReadToolOutputOutput = z.infer<typeof readToolOutputOutputSchema>;
