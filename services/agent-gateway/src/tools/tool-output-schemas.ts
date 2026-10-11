import { z } from 'zod';

/**
 * 选择类参数：文本看行、结构化看 jsonPath / 项、超长单行看字符偏移。
 *
 * 这些参数**不携带引用**，只描述「读哪一段」。模型在续读上一页时的自然心智
 * 模型是「沿用刚才那页」，因此只传选择参数是合法且高频的调用形态。
 */
function hasSelectionOnlyInput(value: {
  charCount?: number;
  charStart?: number;
  itemCount?: number;
  itemStart?: number;
  jsonPath?: string;
  lineCount?: number;
  lineStart?: number;
}): boolean {
  return (
    value.jsonPath !== undefined ||
    value.lineStart !== undefined ||
    value.lineCount !== undefined ||
    value.charStart !== undefined ||
    value.charCount !== undefined ||
    value.itemStart !== undefined ||
    value.itemCount !== undefined
  );
}

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
    charCount: z
      .number()
      .int()
      .min(1)
      .safe()
      .transform((count) => Math.min(count, 8000))
      .optional(),
    itemStart: z.number().int().min(0).optional(),
    itemCount: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toolCallId || value.toolCallRef || value.useLatestReferenced === true) return;
    // 只给了分页 / 选择参数：视为「续读最近一次被引用的大输出」，
    // 由 handler 回退解析到最近引用，而不是把合法的续读意图判成参数缺失。
    if (hasSelectionOnlyInput(value)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'toolCallId 和 useLatestReferenced 至少提供一个；若只想续读上一页，也可只传 lineStart / jsonPath / charStart 等选择参数。',
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
