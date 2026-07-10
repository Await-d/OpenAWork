import type {
  FileDiffContent,
  ModifiedFilesSummaryContent,
  ToolCallObservabilityAnnotation,
} from './message-schema.js';

export interface AssistantTraceToolCall {
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
  clientRequestId?: string;
  durationMs?: number;
  fileDiffs?: FileDiffContent[];
  isError?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: 'running' | 'paused' | 'completed' | 'failed';
}

export interface AssistantReasoningBlockTiming {
  startedAt?: number;
  endedAt?: number;
}

export interface AssistantTracePayload {
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  reasoningBlocks?: string[];
  /**
   * Optional per-block timing parallel to `reasoningBlocks`. When present the
   * length must match `reasoningBlocks.length`. Allows finalized history to
   * display "已完成思考 · X 秒" without re-running streaming on the client.
   */
  reasoningBlocksTimings?: AssistantReasoningBlockTiming[];
  text: string;
  toolCalls: AssistantTraceToolCall[];
}

export interface AssistantTraceTextPart {
  id: string;
  type: 'text';
  text: string;
}

export interface AssistantTraceReasoningPart {
  id: string;
  type: 'reasoning';
  text: string;
  startedAt?: number;
  endedAt?: number;
}

export interface AssistantTraceToolPart {
  id: string;
  type: 'tool';
  toolCallId: string;
  toolName: string;
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  input: Record<string, unknown>;
  clientRequestId?: string;
  durationMs?: number;
  fileDiffs?: FileDiffContent[];
  isError?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: 'running' | 'paused' | 'completed' | 'failed';
}

export type AssistantTracePart =
  AssistantTraceTextPart | AssistantTraceReasoningPart | AssistantTraceToolPart;

export function createAssistantTraceContent(payload: AssistantTracePayload): string {
  return JSON.stringify({
    type: 'assistant_trace',
    payload: {
      modifiedFilesSummary: payload.modifiedFilesSummary,
      ...(payload.reasoningBlocks && payload.reasoningBlocks.length > 0
        ? { reasoningBlocks: payload.reasoningBlocks }
        : {}),
      ...(payload.reasoningBlocksTimings && payload.reasoningBlocksTimings.length > 0
        ? { reasoningBlocksTimings: payload.reasoningBlocksTimings }
        : {}),
      text: payload.text,
      toolCalls: payload.toolCalls,
    },
  });
}

export function parseAssistantTraceContent(
  content: string,
  options?: {
    hasActivePendingPermissionRequest?: (input: {
      isError?: boolean;
      pendingPermissionRequestId?: string;
      resumedAfterApproval?: boolean;
      status?: string;
    }) => boolean;
    normalizeReasoningText?: (value: string) => string;
    parseFileDiffContent?: (value: unknown) => FileDiffContent[];
    parseModifiedFilesSummaryContent?: (value: unknown) => ModifiedFilesSummaryContent | null;
    parseToolCallObservability?: (value: unknown) => ToolCallObservabilityAnnotation | undefined;
  },
): AssistantTracePayload | null {
  try {
    const parsed = JSON.parse(content) as {
      payload?: {
        modifiedFilesSummary?: unknown;
        reasoningBlocks?: unknown;
        reasoningBlocksTimings?: unknown;
        text?: unknown;
        toolCalls?: unknown;
      };
      type?: unknown;
    };

    if (parsed?.type !== 'assistant_trace') {
      return null;
    }

    const text = typeof parsed.payload?.text === 'string' ? parsed.payload.text : '';
    const rawReasoningBlocks = Array.isArray(parsed.payload?.reasoningBlocks)
      ? parsed.payload.reasoningBlocks
      : [];
    const rawReasoningTimings = Array.isArray(parsed.payload?.reasoningBlocksTimings)
      ? parsed.payload.reasoningBlocksTimings
      : [];
    type ReasoningPair = {
      readonly text: string;
      readonly timing: AssistantReasoningBlockTiming | undefined;
    };
    const reasoningPairs = rawReasoningBlocks
      .map((item, index): ReasoningPair | null => {
        if (typeof item !== 'string') return null;
        const normalized = options?.normalizeReasoningText
          ? options.normalizeReasoningText(item)
          : item;
        if (normalized.length === 0) return null;
        const rawTiming = rawReasoningTimings[index];
        const timing =
          rawTiming && typeof rawTiming === 'object'
            ? (rawTiming as Record<string, unknown>)
            : null;
        const startedAt =
          timing && typeof timing['startedAt'] === 'number' && Number.isFinite(timing['startedAt'])
            ? timing['startedAt']
            : undefined;
        const endedAt =
          timing && typeof timing['endedAt'] === 'number' && Number.isFinite(timing['endedAt'])
            ? timing['endedAt']
            : undefined;
        const blockTiming: AssistantReasoningBlockTiming | undefined =
          startedAt !== undefined || endedAt !== undefined
            ? {
                ...(startedAt !== undefined ? { startedAt } : {}),
                ...(endedAt !== undefined ? { endedAt } : {}),
              }
            : undefined;
        return {
          text: normalized,
          timing: blockTiming,
        };
      })
      .filter((item): item is ReasoningPair => item !== null);
    const reasoningBlocks = reasoningPairs.map((entry) => entry.text);
    const reasoningBlocksTimings: AssistantReasoningBlockTiming[] = reasoningPairs.map(
      (entry) => entry.timing ?? {},
    );
    const hasAnyTiming = reasoningBlocksTimings.some(
      (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
    );

    const toolCalls = Array.isArray(parsed.payload?.toolCalls)
      ? parsed.payload.toolCalls.flatMap((item) => {
          if (!item || typeof item !== 'object') {
            return [];
          }

          const record = item as Record<string, unknown>;
          if (typeof record['toolName'] !== 'string') {
            return [];
          }

          const input =
            record['input'] &&
            typeof record['input'] === 'object' &&
            !Array.isArray(record['input'])
              ? (record['input'] as Record<string, unknown>)
              : {};

          const isError = record['isError'] === true;
          const pendingPermissionRequestId =
            typeof record['pendingPermissionRequestId'] === 'string'
              ? record['pendingPermissionRequestId']
              : undefined;
          const resumedAfterApproval = record['resumedAfterApproval'] === true;
          const parsedStatus =
            record['status'] === 'running' ||
            record['status'] === 'paused' ||
            record['status'] === 'completed' ||
            record['status'] === 'failed'
              ? record['status']
              : undefined;
          const hasPendingPermission = options?.hasActivePendingPermissionRequest
            ? options.hasActivePendingPermissionRequest({
                isError,
                pendingPermissionRequestId,
                resumedAfterApproval,
                status: parsedStatus,
              })
            : false;
          const normalizedStatus = hasPendingPermission
            ? 'paused'
            : parsedStatus === 'failed' ||
                parsedStatus === 'completed' ||
                parsedStatus === 'running'
              ? parsedStatus
              : parsedStatus === 'paused' && isError
                ? 'failed'
                : parsedStatus === 'paused' && resumedAfterApproval
                  ? 'completed'
                  : parsedStatus;

          return [
            {
              ...(record['kind'] === 'agent' ||
              record['kind'] === 'mcp' ||
              record['kind'] === 'skill' ||
              record['kind'] === 'tool'
                ? { kind: record['kind'] }
                : {}),
              ...(typeof record['clientRequestId'] === 'string'
                ? { clientRequestId: record['clientRequestId'] }
                : {}),
              ...(Array.isArray(record['fileDiffs']) && options?.parseFileDiffContent
                ? {
                    fileDiffs: record['fileDiffs'].flatMap((entry) =>
                      options.parseFileDiffContent!(entry),
                    ),
                  }
                : {}),
              ...(typeof record['toolCallId'] === 'string'
                ? { toolCallId: record['toolCallId'] }
                : {}),
              toolName: record['toolName'],
              input,
              output: record['output'],
              isError,
              ...(options?.parseToolCallObservability?.(record['observability'])
                ? { observability: options.parseToolCallObservability(record['observability']) }
                : {}),
              ...(hasPendingPermission ? { pendingPermissionRequestId } : {}),
              ...(resumedAfterApproval ? { resumedAfterApproval: true } : {}),
              ...(typeof record['durationMs'] === 'number' && Number.isFinite(record['durationMs'])
                ? { durationMs: record['durationMs'] }
                : {}),
              status: normalizedStatus,
            } satisfies AssistantTraceToolCall,
          ];
        })
      : [];

    const modifiedFilesSummary = options?.parseModifiedFilesSummaryContent
      ? options.parseModifiedFilesSummaryContent(parsed.payload?.modifiedFilesSummary)
      : null;

    return {
      text,
      toolCalls,
      ...(modifiedFilesSummary ? { modifiedFilesSummary } : {}),
      ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
      ...(reasoningBlocks.length > 0 && hasAnyTiming ? { reasoningBlocksTimings } : {}),
    };
  } catch {
    return null;
  }
}

export function partsFromAssistantTrace(
  messageId: string,
  trace: AssistantTracePayload,
): AssistantTracePart[] {
  const parts: AssistantTracePart[] = [];

  if (trace.reasoningBlocks) {
    for (let index = 0; index < trace.reasoningBlocks.length; index += 1) {
      const text = trace.reasoningBlocks[index]!;
      // Skip empty reasoning blocks — see `partsFromOrderedAssistantContent`
      // for the same rationale (an empty block renders as a "Thinking:"
      // header with no body, which is what users see after a refresh
      // when the gateway recorded a `thinking_end` without any matching
      // `thinking_delta`).
      if (text.trim().length === 0) continue;
      const timing = trace.reasoningBlocksTimings?.[index];
      parts.push({
        id: `${messageId}:reasoning:${index}`,
        type: 'reasoning',
        text,
        ...(typeof timing?.startedAt === 'number' ? { startedAt: timing.startedAt } : {}),
        ...(typeof timing?.endedAt === 'number' ? { endedAt: timing.endedAt } : {}),
      });
    }
  }

  parts.push({
    id: `${messageId}:text`,
    type: 'text',
    text: trace.text,
  });

  for (const toolCall of trace.toolCalls) {
    parts.push({
      id: toolCall.toolCallId || `${messageId}:tool:${parts.length}`,
      type: 'tool',
      toolCallId: toolCall.toolCallId ?? '',
      toolName: toolCall.toolName,
      kind: toolCall.kind,
      input: toolCall.input,
      clientRequestId: toolCall.clientRequestId,
      durationMs: toolCall.durationMs,
      fileDiffs: toolCall.fileDiffs,
      isError: toolCall.isError,
      observability: toolCall.observability,
      output: toolCall.output,
      pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
      resumedAfterApproval: toolCall.resumedAfterApproval,
      status: toolCall.status,
    });
  }

  return parts;
}

export function readAssistantTracePayloadFromParts(
  parts: AssistantTracePart[],
  modifiedFilesSummary?: ModifiedFilesSummaryContent,
): AssistantTracePayload {
  const reasoningBlocks: string[] = [];
  const reasoningBlocksTimings: AssistantReasoningBlockTiming[] = [];
  // Collect every text part separately and join them at the end. The
  // ordered-content storage may produce multiple text parts when the wire
  // stream interleaves text with tool-call segments (e.g.
  // text "A" → tool → text "B"). Picking only the last one would silently
  // drop earlier slices from `trace.text` (used by copy-as-markdown,
  // height estimation, and snapshot comparison). Empty/whitespace slices
  // are skipped so a no-text run does not introduce a stray separator.
  const textSlices: string[] = [];
  const toolCalls: AssistantTraceToolCall[] = [];

  for (const part of parts) {
    switch (part.type) {
      case 'reasoning':
        reasoningBlocks.push(part.text);
        reasoningBlocksTimings.push({
          ...(typeof part.startedAt === 'number' ? { startedAt: part.startedAt } : {}),
          ...(typeof part.endedAt === 'number' ? { endedAt: part.endedAt } : {}),
        });
        break;
      case 'text':
        if (part.text.trim().length > 0) {
          textSlices.push(part.text);
        }
        break;
      case 'tool':
        toolCalls.push({
          kind: part.kind,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          clientRequestId: part.clientRequestId,
          durationMs: part.durationMs,
          fileDiffs: part.fileDiffs,
          isError: part.isError,
          observability: part.observability,
          output: part.output,
          pendingPermissionRequestId: part.pendingPermissionRequestId,
          resumedAfterApproval: part.resumedAfterApproval,
          status: part.status,
        });
        break;
    }
  }

  const hasAnyTiming = reasoningBlocksTimings.some(
    (entry) => typeof entry.startedAt === 'number' || typeof entry.endedAt === 'number',
  );

  return {
    text: textSlices.join('\n\n'),
    toolCalls,
    ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
    ...(reasoningBlocks.length > 0 && hasAnyTiming ? { reasoningBlocksTimings } : {}),
    ...(modifiedFilesSummary ? { modifiedFilesSummary } : {}),
  };
}

export function contentFromAssistantTraceParts(
  parts: AssistantTracePart[],
  modifiedFilesSummary?: ModifiedFilesSummaryContent,
): string {
  return createAssistantTraceContent(
    readAssistantTracePayloadFromParts(parts, modifiedFilesSummary),
  );
}
