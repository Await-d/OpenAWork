import type { ToolDefinition } from '@openAwork/agent-core';
import { DEFAULT_TOOL_CONTEXT_POLICY } from '../compaction/tool-context-policy.js';
import {
  readToolOutputInputSchema,
  readToolOutputOutputSchema,
  type ReadToolOutputInput,
  type ReadToolOutputOutput,
} from './tool-output-schemas.js';
import { selectTextLines } from './tool-output-text-selection.js';

export {
  readToolOutputInputSchema,
  readToolOutputOutputSchema,
  readToolOutputSelectionSchema,
} from './tool-output-schemas.js';
export type { ReadToolOutputInput, ReadToolOutputOutput } from './tool-output-schemas.js';

export const readToolOutputToolDefinition: ToolDefinition<
  typeof readToolOutputInputSchema,
  typeof readToolOutputOutputSchema
> = {
  name: 'read_tool_output',
  description:
    '从当前会话中读取此前产生的工具调用结果。优先使用历史中的 toolCallId；超长 ID 引用使用 toolCallRef。仅当两者都拿不到时，才使用 useLatestReferenced=true 兜底。支持 charStart/charCount 分页读取超长内容。',
  inputSchema: readToolOutputInputSchema,
  outputSchema: readToolOutputOutputSchema,
  timeout: 30000,
  execute: async () => {
    throw new Error('read_tool_output must execute through the gateway-managed sandbox path');
  },
};

export function buildReadToolOutputHint(toolCallId: string): string {
  return `如需继续查看完整细节，请优先调用 read_tool_output 并传入 toolCallId="${toolCallId}"；只有在当前会话历史里出现了 [tool_output_reference] 且拿不到 toolCallId 时，才使用 useLatestReferenced=true。超长单行可配合 charStart/charCount 续读（偏移相对当前行/项选择，续读时保留选择参数）；文本结果建议配合 lineStart/lineCount，结构化结果建议配合 jsonPath 或 itemStart/itemCount。`;
}

export function buildReadToolOutputResponse(input: {
  isError: boolean;
  output: unknown;
  request: ReadToolOutputInput;
  sizeBytes: number;
  toolCallId: string;
}): ReadToolOutputOutput {
  const responseToolCallId =
    input.request.toolCallRef && input.toolCallId.length > 256
      ? input.request.toolCallRef
      : input.toolCallId;
  const responseReference = input.request.toolCallRef
    ? { toolCallRef: input.request.toolCallRef }
    : {};
  const selectionPath = input.request.jsonPath?.trim();
  const selectionTarget =
    selectionPath && selectionPath.length > 0
      ? resolveJsonPath(input.output, selectionPath)
      : { ok: true as const, value: input.output };

  if (!selectionTarget.ok) {
    return {
      toolCallId: responseToolCallId,
      ...responseReference,
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
          ? Object.keys(input.output).slice(0, 100)
          : undefined,
    };
  }

  const response = buildSelectionResponse({
    isError: input.isError,
    output: selectionTarget.value,
    selectionPath,
    sizeBytes: input.sizeBytes,
    toolCallId: responseToolCallId,
    request: input.request,
  });
  const boundedResponse: ReadToolOutputOutput = { ...response, ...responseReference };
  const explicitChars =
    input.request.charStart !== undefined || input.request.charCount !== undefined;
  const selected =
    boundedResponse.selection.mode === 'keys' ? selectionTarget.value : boundedResponse.output;
  if (!explicitChars && Buffer.byteLength(safeJson(boundedResponse), 'utf8') <= 10_000) {
    return boundedResponse;
  }
  const text = typeof selected === 'string' ? selected : safeJson(selected);
  const requestedCharStart = Math.min(input.request.charStart ?? 0, text.length);
  const charStart = isLowSurrogate(text.charCodeAt(requestedCharStart))
    ? requestedCharStart - 1
    : requestedCharStart;
  let low = 0;
  let high = Math.min(
    input.request.charCount ?? DEFAULT_TOOL_CONTEXT_POLICY.maxReadPageBytes,
    text.length - charStart,
  );
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const bytes = Buffer.byteLength(
      JSON.stringify(text.slice(charStart, charStart + middle)),
      'utf8',
    );
    if (bytes <= DEFAULT_TOOL_CONTEXT_POLICY.maxReadPageBytes) low = middle;
    else high = middle - 1;
  }
  const tentativeCharEnd = charStart + low;
  let charEnd =
    tentativeCharEnd > charStart && isLowSurrogate(text.charCodeAt(tentativeCharEnd))
      ? tentativeCharEnd - 1
      : tentativeCharEnd;
  if (charEnd === charStart && charStart < text.length) {
    charEnd = isHighSurrogate(text.charCodeAt(charStart))
      ? Math.min(text.length, charStart + 2)
      : charStart + 1;
  }
  return {
    ...boundedResponse,
    topLevelKeys: undefined,
    totalChars: text.length,
    selection: {
      ...boundedResponse.selection,
      mode: 'chars',
      charStart,
      charCount: charEnd - charStart,
      ...(charEnd < text.length ? { nextCharStart: charEnd } : {}),
    },
    output: text.slice(charStart, charEnd),
    note:
      charEnd < text.length
        ? `仅返回当前选择的字符片段；保留 jsonPath/行/项参数并使用 charStart=${charEnd} 续读。结构化片段为 JSON 文本。`
        : '当前选择的字符分页已结束；结构化片段为 JSON 文本。',
  };
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
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
    const lineStart = input.request.lineStart ?? 1;
    const lineCount = input.request.lineCount ?? 200;
    const selection = selectTextLines(input.output, lineStart, lineCount);
    return {
      toolCallId: input.toolCallId,
      fullOutputPreserved: true,
      outputType: 'string',
      isError: input.isError,
      sizeBytes: input.sizeBytes,
      totalLines: selection.totalLines,
      selection: {
        mode: lineStart === 1 && selection.sliceEnd >= selection.totalLines ? 'full' : 'lines',
        ...(input.selectionPath ? { jsonPath: input.selectionPath } : {}),
        lineStart,
        lineCount: selection.lineCount,
      },
      output: selection.output,
      note:
        selection.sliceEnd < selection.totalLines
          ? `仅返回第 ${lineStart}-${selection.sliceEnd} 行；完整输出仍已保留，可继续增加 lineStart 查看后续内容。`
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
    return JSON.stringify(value) ?? String(value);
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
