import type {
  FileDiffContent,
  InputImageContent,
  Message,
  RunEvent,
  ToolCallObservabilityAnnotation,
  ToolResultContent,
} from '@openAwork/shared';

export interface StoredToolResult {
  attachments?: InputImageContent[];
  clientRequestId?: string;
  fileDiffs?: FileDiffContent[];
  isError: boolean;
  observability?: ToolCallObservabilityAnnotation;
  output: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  toolCallId: string;
  toolName?: string;
}

export interface ToolResultPayloadInput {
  toolCallId: string;
  toolName: string;
  clientRequestId?: string;
  output: unknown;
  isError: boolean;
  reason?: string;
  attachments?: InputImageContent[];
  fileDiffs?: FileDiffContent[];
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  observability?: ToolCallObservabilityAnnotation;
}

const MAX_STORED_TOOL_OUTPUT_CHARS = 200_000;
const MAX_STORED_TOOL_ARGUMENT_CHARS = 50_000;
const MAX_STORED_FILE_DIFFS = 20;
const MAX_STORED_FILE_DIFF_CONTENT_CHARS = 10_000;
const STORED_TOOL_OUTPUT_TRUNCATION_NOTICE = '\n\n[工具输出已截断 — 原始输出超过持久化上限。]';
const STORED_TOOL_ARGUMENT_TRUNCATION_NOTICE =
  '\n\n[工具调用参数已截断 — 参数过大，已省略后续内容。]';
const STORED_FILE_DIFF_TRUNCATION_NOTICE = '\n...[truncated]';

export function stringifyToolResultOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(output, (_key: string, value: unknown) => {
      if (typeof value === 'bigint') return value.toString();
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    return serialized ?? String(output);
  } catch {
    return String(output);
  }
}

export function normalizeToolResultOutputForStorage(output: unknown): unknown {
  const serialized = stringifyToolResultOutput(output);
  if (serialized.length <= MAX_STORED_TOOL_OUTPUT_CHARS) {
    return output;
  }
  return serialized.slice(0, MAX_STORED_TOOL_OUTPUT_CHARS) + STORED_TOOL_OUTPUT_TRUNCATION_NOTICE;
}

export function normalizeToolArgumentsForStorage(argumentsValue: unknown): string {
  const serialized = stringifyToolResultOutput(argumentsValue);
  if (serialized.length <= MAX_STORED_TOOL_ARGUMENT_CHARS) {
    return serialized;
  }
  return (
    serialized.slice(0, MAX_STORED_TOOL_ARGUMENT_CHARS) + STORED_TOOL_ARGUMENT_TRUNCATION_NOTICE
  );
}

function normalizeFileDiffText(value: string): string {
  if (value.length <= MAX_STORED_FILE_DIFF_CONTENT_CHARS) return value;
  return value.slice(0, MAX_STORED_FILE_DIFF_CONTENT_CHARS) + STORED_FILE_DIFF_TRUNCATION_NOTICE;
}

function normalizeFileDiffsForStorage(
  diffs: FileDiffContent[] | undefined,
): FileDiffContent[] | undefined {
  if (!diffs || diffs.length === 0) return undefined;
  return diffs.slice(0, MAX_STORED_FILE_DIFFS).map((diff) => ({
    ...diff,
    before: normalizeFileDiffText(diff.before),
    after: normalizeFileDiffText(diff.after),
  }));
}

export function buildToolResultContent(input: ToolResultPayloadInput): ToolResultContent {
  const output = normalizeToolResultOutputForStorage(input.output);
  const rawOutput = stringifyToolResultOutput(output);
  const fileDiffs = normalizeFileDiffsForStorage(input.fileDiffs);
  return {
    type: 'tool_result',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    output,
    rawOutput,
    isError: input.isError,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    ...(fileDiffs ? { fileDiffs } : {}),
    ...(input.observability ? { observability: input.observability } : {}),
    ...(input.pendingPermissionRequestId
      ? { pendingPermissionRequestId: input.pendingPermissionRequestId }
      : {}),
    ...(input.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
  };
}

export function buildToolResultRunEvent(
  input: ToolResultPayloadInput & {
    eventMeta: { eventId: string; runId: string; occurredAt: number };
  },
): Extract<RunEvent, { type: 'tool_result' }> {
  const output = normalizeToolResultOutputForStorage(input.output);
  const fileDiffs = normalizeFileDiffsForStorage(input.fileDiffs);
  return {
    type: 'tool_result',
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    output,
    isError: input.isError,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    ...(fileDiffs ? { fileDiffs } : {}),
    ...(input.observability ? { observability: input.observability } : {}),
    ...(input.pendingPermissionRequestId
      ? { pendingPermissionRequestId: input.pendingPermissionRequestId }
      : {}),
    ...(input.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    ...input.eventMeta,
  };
}

export function readStoredToolResultContent(
  metadata: Record<string, unknown> | undefined,
): ToolResultContent | null {
  const candidate = metadata?.['toolResultContent'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return (candidate as { type?: unknown }).type === 'tool_result'
    ? (candidate as ToolResultContent)
    : null;
}

export function toStoredToolResult(content: ToolResultContent): StoredToolResult {
  return {
    toolCallId: content.toolCallId,
    toolName: content.toolName,
    clientRequestId: content.clientRequestId,
    output: content.output,
    isError: content.isError,
    attachments: content.attachments,
    fileDiffs: content.fileDiffs,
    pendingPermissionRequestId: content.pendingPermissionRequestId,
    resumedAfterApproval: content.resumedAfterApproval,
    observability: content.observability,
  };
}

export function extractToolResultContentsFromMessage(message: Message): ToolResultContent[] {
  return message.content.flatMap((content) => (content.type === 'tool_result' ? [content] : []));
}

export function hasToolResultContent(message: Message): boolean {
  return extractToolResultContentsFromMessage(message).length > 0;
}

export function listStoredToolResults(messages: Message[]): StoredToolResult[] {
  const deduped = new Map<string, StoredToolResult>();

  messages.forEach((message) => {
    extractToolResultContentsFromMessage(message).forEach((content) => {
      deduped.delete(content.toolCallId);
      deduped.set(content.toolCallId, toStoredToolResult(content));
    });
  });

  return Array.from(deduped.values());
}

export function findStoredToolResultByCallId(
  messages: Message[],
  toolCallId: string,
): StoredToolResult | null {
  const result = listStoredToolResults(messages).find((item) => item.toolCallId === toolCallId);
  return result ?? null;
}

export function findLatestReferencedStoredToolResult(
  messages: Message[],
  shouldReference: (output: unknown) => boolean,
): StoredToolResult | null {
  const results = listStoredToolResults(messages);
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (result && shouldReference(result.output)) {
      return result;
    }
  }
  return null;
}
