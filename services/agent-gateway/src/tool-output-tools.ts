import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

export const readToolOutputInputSchema = z
  .object({
    toolCallId: z.string().min(1).optional(),
    useLatestReferenced: z.boolean().optional(),
    jsonPath: z.string().min(1).optional(),
    lineStart: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(1).max(400).optional(),
    itemStart: z.number().int().min(0).optional(),
    itemCount: z.number().int().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.toolCallId || value.useLatestReferenced === true) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'toolCallId 和 useLatestReferenced 至少提供一个。',
      path: ['toolCallId'],
    });
  });

export const readToolOutputSelectionSchema = z
  .object({
    mode: z.enum(['full', 'items', 'keys', 'lines']),
    jsonPath: z.string().optional(),
    lineStart: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(0).optional(),
    itemStart: z.number().int().min(0).optional(),
    itemCount: z.number().int().min(0).optional(),
  })
  .strict();

export const readToolOutputOutputSchema = z
  .object({
    toolCallId: z.string(),
    fullOutputPreserved: z.literal(true),
    outputType: z.string(),
    isError: z.boolean(),
    sizeBytes: z.number().int().min(0),
    selection: readToolOutputSelectionSchema,
    note: z.string().optional(),
    output: z.unknown().optional(),
    totalItems: z.number().int().min(0).optional(),
    totalLines: z.number().int().min(0).optional(),
    topLevelKeys: z.array(z.string()).optional(),
  })
  .strict();

export type ReadToolOutputInput = z.infer<typeof readToolOutputInputSchema>;
export type ReadToolOutputOutput = z.infer<typeof readToolOutputOutputSchema>;

export const readToolOutputToolDefinition: ToolDefinition<
  typeof readToolOutputInputSchema,
  typeof readToolOutputOutputSchema
> = {
  name: 'read_tool_output',
  description:
    'Read a previously produced tool result from the current session. Prefer toolCallId when known; if the context only says [tool_output_reference] and you need the most recent referenced large output, set useLatestReferenced=true. Supports line-based text reading and jsonPath/item pagination for structured data so you can recover only the detail needed for the next reasoning step.',
  inputSchema: readToolOutputInputSchema,
  outputSchema: readToolOutputOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('read_tool_output must execute through the gateway-managed sandbox path');
  },
};

export function buildReadToolOutputHint(toolCallId: string): string {
  return `如需继续查看完整细节，请调用 read_tool_output，优先传入 toolCallId="${toolCallId}"；如果你只想快速读取最近一次被引用的大输出，也可传 useLatestReferenced=true。文本结果建议配合 lineStart/lineCount，结构化结果建议配合 jsonPath 或 itemStart/itemCount。`;
}

export function buildReadToolOutputResponse(input: {
  isError: boolean;
  output: unknown;
  request: ReadToolOutputInput;
  sizeBytes: number;
  toolCallId: string;
}): ReadToolOutputOutput {
  const selectionPath = input.request.jsonPath?.trim();
  const selectionTarget =
    selectionPath && selectionPath.length > 0
      ? resolveJsonPath(input.output, selectionPath)
      : { ok: true as const, value: input.output };

  if (!selectionTarget.ok) {
    return {
      toolCallId: input.toolCallId,
      fullOutputPreserved: true,
      outputType: describeOutputType(input.output),
      isError: input.isError,
      sizeBytes: input.sizeBytes,
      selection: {
        mode: 'keys',
        ...(selectionPath ? { jsonPath: selectionPath } : {}),
      },
      note: selectionTarget.message,
      topLevelKeys:
        input.output && typeof input.output === 'object' && !Array.isArray(input.output)
          ? Object.keys(input.output as Record<string, unknown>).slice(0, 100)
          : undefined,
    };
  }

  return buildSelectionResponse({
    isError: input.isError,
    output: selectionTarget.value,
    selectionPath,
    sizeBytes: input.sizeBytes,
    toolCallId: input.toolCallId,
    request: input.request,
  });
}

function buildSelectionResponse(input: {
  isError: boolean;
  output: unknown;
  request: ReadToolOutputInput;
  selectionPath?: string;
  sizeBytes: number;
  toolCallId: string;
}): ReadToolOutputOutput {
  if (typeof input.output === 'string') {
    const lines = input.output.split(/\r?\n/);
    const lineStart = input.request.lineStart ?? 1;
    const lineCount = input.request.lineCount ?? 200;
    const sliceStart = Math.max(0, lineStart - 1);
    const sliceEnd = Math.min(lines.length, sliceStart + lineCount);
    return {
      toolCallId: input.toolCallId,
      fullOutputPreserved: true,
      outputType: 'string',
      isError: input.isError,
      sizeBytes: input.sizeBytes,
      totalLines: lines.length,
      selection: {
        mode: lineStart === 1 && sliceEnd >= lines.length ? 'full' : 'lines',
        ...(input.selectionPath ? { jsonPath: input.selectionPath } : {}),
        lineStart,
        lineCount: sliceEnd - sliceStart,
      },
      output: lines.slice(sliceStart, sliceEnd).join('\n'),
      note:
        sliceEnd < lines.length
          ? `仅返回第 ${lineStart}-${sliceEnd} 行；完整输出仍已保留，可继续增加 lineStart 查看后续内容。`
          : undefined,
    };
  }

  if (Array.isArray(input.output)) {
    const itemStart = input.request.itemStart ?? 0;
    const itemCount = input.request.itemCount ?? 50;
    const selectedItems = input.output.slice(itemStart, itemStart + itemCount);
    return {
      toolCallId: input.toolCallId,
      fullOutputPreserved: true,
      outputType: 'array',
      isError: input.isError,
      sizeBytes: input.sizeBytes,
      totalItems: input.output.length,
      selection: {
        mode: itemStart === 0 && selectedItems.length >= input.output.length ? 'full' : 'items',
        ...(input.selectionPath ? { jsonPath: input.selectionPath } : {}),
        itemStart,
        itemCount: selectedItems.length,
      },
      output: selectedItems,
      note:
        itemStart + selectedItems.length < input.output.length
          ? `仅返回第 ${itemStart}-${itemStart + selectedItems.length - 1} 项；完整输出仍已保留，可继续增加 itemStart 查看后续内容。`
          : undefined,
    };
  }

  if (input.output && typeof input.output === 'object') {
    const record = input.output as Record<string, unknown>;
    const serialized = safeJson(record);
    if (Buffer.byteLength(serialized, 'utf8') <= 8 * 1024) {
      return {
        toolCallId: input.toolCallId,
        fullOutputPreserved: true,
        outputType: 'object',
        isError: input.isError,
        sizeBytes: input.sizeBytes,
        selection: {
          mode: 'full',
          ...(input.selectionPath ? { jsonPath: input.selectionPath } : {}),
        },
        output: record,
      };
    }

    return {
      toolCallId: input.toolCallId,
      fullOutputPreserved: true,
      outputType: 'object',
      isError: input.isError,
      sizeBytes: input.sizeBytes,
      selection: {
        mode: 'keys',
        ...(input.selectionPath ? { jsonPath: input.selectionPath } : {}),
      },
      topLevelKeys: Object.keys(record).slice(0, 100),
      note: '对象结果较大，已返回顶层键名。请使用 jsonPath 继续读取具体字段，例如 data.items 或 result.summary。',
    };
  }

  return {
    toolCallId: input.toolCallId,
    fullOutputPreserved: true,
    outputType: describeOutputType(input.output),
    isError: input.isError,
    sizeBytes: input.sizeBytes,
    selection: {
      mode: 'full',
      ...(input.selectionPath ? { jsonPath: input.selectionPath } : {}),
    },
    output: input.output,
  };
}

function describeOutputType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveJsonPath(
  value: unknown,
  jsonPath: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const segments = tokenizeJsonPath(jsonPath);
  if (segments.length === 0) {
    return { ok: false, message: 'jsonPath 不能为空。' };
  }

  let current: unknown = value;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        return { ok: false, message: `jsonPath ${jsonPath} 期望数组，但当前不是数组。` };
      }
      current = current[segment];
      continue;
    }

    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return { ok: false, message: `jsonPath ${jsonPath} 无法命中字段 ${segment}。` };
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return { ok: true, value: current };
}

function tokenizeJsonPath(path: string): Array<string | number> {
  const normalized = path.trim().replace(/^\$\.?/, '');
  if (!normalized) {
    return [];
  }

  const segments: Array<string | number> = [];
  normalized.split('.').forEach((part) => {
    const token = part.trim();
    if (!token) {
      return;
    }

    const base = token.match(/^[^[]+/)?.[0];
    if (base) {
      segments.push(base);
    }

    const indexes = token.match(/\[(\d+)\]/g) ?? [];
    indexes.forEach((indexToken) => {
      const numeric = Number.parseInt(indexToken.slice(1, -1), 10);
      if (!Number.isNaN(numeric)) {
        segments.push(numeric);
      }
    });
  });

  return segments;
}
