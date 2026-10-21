import type {
  ModifiedFilesSummaryContent,
  RunEvent,
  UpstreamRouteDescriptor,
  UpstreamStreamSummary,
} from '@openAwork/shared';
import type { SessionStateStatus } from '../session/session-runtime.js';
import {
  hasActivePendingPermissionRequest,
  parseToolCallInputText,
  readAssistantTracePayload,
  type AssistantTraceToolCall,
  type ChatMessage,
  type ChatMessagePart,
} from '../messages/support.js';
import { mergeChatBackendUsageSnapshot, type ChatBackendUsageSnapshot } from './stream-usage.js';
import {
  appendStreamingThinkingChunk,
  markStreamingThinkingChunkEnded,
  type StreamingThinkingBlock,
} from './streaming-thinking.js';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolResultToStreamingSegment,
  markStreamingReasoningSegmentEnded,
  upsertStreamingToolSegment,
} from './streaming-segments.js';

export interface RecoveredActiveAssistantStream {
  messageId: string | null;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  parts: ChatMessagePart[];
  startedAt: number | null;
  text: string;
  thinkingBlocks: StreamingThinkingBlock[];
  toolCalls: AssistantTraceToolCall[];
  upstreamRoute?: UpstreamRouteDescriptor;
  usage: ChatBackendUsageSnapshot | null;
  upstreamSummary?: UpstreamStreamSummary;
}

interface RecoverActiveAssistantStreamInput {
  activeStreamStartedAt?: number | null;
  hasActiveStream?: boolean;
  messages: ChatMessage[];
  runEvents: RunEvent[];
  sessionStateStatus: SessionStateStatus | null;
}

function isRecoverableSessionStatus(
  status: SessionStateStatus | null,
): status is Extract<SessionStateStatus, 'paused' | 'running'> {
  return status === 'running' || status === 'paused';
}

function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === 'done' || event.type === 'error';
}

/**
 * 快照里是否有**可见的进行中内容**。
 *
 * `recoverActiveAssistantStream` 在「最后一轮已落库、下一轮还没开始」时会返回一个
 * 只带 `usage` / `upstreamSummary` 的空快照（见该函数内 `pendingRoundBoundary`）。
 * 这种快照不能撑起「流式中」：
 *
 * - 渲染层会据此构造一条 `status: 'streaming'` 的实时气泡；
 * - `mergeStreamingEntryIntoHistoricalEntries` 又会按 `clientRequestId` 精确匹配到
 *   历史上刚结束的那一轮，用这条**空 entry** 把它替换掉 —— 用户看到的是内容消失。
 *
 * 因此「是否在流式中」必须以内容为准，而不是「快照是否存在」。
 */
export function recoveredStreamHasVisibleContent(
  snapshot: RecoveredActiveAssistantStream,
): boolean {
  return (
    snapshot.text.length > 0 ||
    snapshot.thinkingBlocks.length > 0 ||
    snapshot.parts.length > 0 ||
    snapshot.toolCalls.length > 0
  );
}

function hasTextOverlap(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
}

function findRecoveredAssistantAnchor(input: {
  activeToolCallIds: ReadonlySet<string>;
  messages: ChatMessage[];
  text: string;
  thinkingBlocks: StreamingThinkingBlock[];
}): {
  messageId: string;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  toolCalls: AssistantTraceToolCall[];
} | null {
  const activeReasoningText = input.thinkingBlocks
    .map((block) => block.text)
    .join('\n')
    .trim();

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      continue;
    }

    const traceToolCallIds = new Set(
      assistantTrace.toolCalls.map((toolCall) => toolCall.toolCallId).filter(Boolean),
    );
    const hasToolOverlap =
      input.activeToolCallIds.size > 0 &&
      [...input.activeToolCallIds].some((toolCallId) => traceToolCallIds.has(toolCallId));
    const hasReasoningOverlap = hasTextOverlap(
      activeReasoningText,
      (assistantTrace.reasoningBlocks ?? []).join('\n'),
    );
    const matchesAnchor =
      hasToolOverlap || hasTextOverlap(input.text, assistantTrace.text) || hasReasoningOverlap;

    if (!matchesAnchor) {
      continue;
    }

    return {
      messageId: message.id,
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      toolCalls: assistantTrace.toolCalls,
    };
  }

  return null;
}

export function recoverActiveAssistantStream(
  input: RecoverActiveAssistantStreamInput,
): RecoveredActiveAssistantStream | null {
  const hasActiveStream = input.hasActiveStream === true;
  if (input.runEvents.length === 0) {
    return null;
  }

  if (!hasActiveStream && !isRecoverableSessionStatus(input.sessionStateStatus)) {
    return null;
  }

  if (input.sessionStateStatus === 'paused' && !hasActiveStream) {
    return null;
  }

  const activeStreamStartedAt = hasActiveStream ? (input.activeStreamStartedAt ?? null) : null;

  const activeRunId = [...input.runEvents].reverse().find((event) => {
    if (typeof event.runId !== 'string' || event.runId.length === 0) {
      return false;
    }

    return (
      typeof event.occurredAt !== 'number' ||
      activeStreamStartedAt === null ||
      event.occurredAt >= activeStreamStartedAt
    );
  })?.runId;
  if (!activeRunId) {
    return null;
  }

  const activeRunEvents = input.runEvents.filter((event) => {
    if (event.runId !== activeRunId) {
      return false;
    }

    return (
      typeof event.occurredAt !== 'number' ||
      activeStreamStartedAt === null ||
      event.occurredAt >= activeStreamStartedAt
    );
  });
  const latestActiveRunEvent = activeRunEvents.at(-1);
  if (!latestActiveRunEvent || isTerminalRunEvent(latestActiveRunEvent)) {
    return null;
  }

  let text = '';
  let thinkingBlocks: StreamingThinkingBlock[] = [];
  let usage: ChatBackendUsageSnapshot | null = null;
  let upstreamRoute: UpstreamRouteDescriptor | undefined;
  let upstreamSummary: UpstreamStreamSummary | undefined;
  let startedAt: number | null = null;
  let hasRenderableContent = false;
  const activeToolCallIds = new Set<string>();
  const toolInputTextByCallId = new Map<string, string>();
  const reasoningSegmentMeta = new Map<string, { blockKey: string }>();
  let parts: ChatMessagePart[] = [];
  const recoveryMessageId = '__recovery__';

  /**
   * 网关**每轮**落一条 assistant 消息、每轮发一次 `usage`，而 `runEvents` 是整个
   * run 的完整事件流（多轮全混在一起）。恢复快照只能代表**最后一个 `usage` 之后
   * 的进行中轮**：
   *
   * - 不切分时，恢复快照会把同一 run 里已落库的若干轮正文拼进一条虚拟消息。
   *   attach 随后把它当作「本轮已有片段」提交，于是同样的内容在历史上出现两次
   *   （一条来自落库消息、一条来自本地提交），`deduplicateOverlappingMessages`
   *   按 `clientRequestId` / `partId` 判重时会把后到者顶进旧槽位 —— 表现为同一批
   *   消息 id 的相对顺序发生变化。
   * - `usage` 只登记轮次、**不立刻切分**：本轮的工具结果在 `usage` 之后才到达，
   *   强行在 `usage` 处清空会把工具输出丢掉。
   * - 真正切分发生在**新一轮内容**到达时（文本 / 思考 / 工具调用），与实时链路
   *   `shouldStartNewRound` 的语义一致。
   */
  let pendingRoundBoundary = false;
  let highestCompletedRound: number | null = null;

  const startNewRoundIfAdvanced = (occurredAt: number | undefined): void => {
    if (!pendingRoundBoundary) {
      return;
    }
    pendingRoundBoundary = false;
    text = '';
    thinkingBlocks = [];
    parts = [];
    activeToolCallIds.clear();
    toolInputTextByCallId.clear();
    reasoningSegmentMeta.clear();
    hasRenderableContent = false;
    startedAt = typeof occurredAt === 'number' ? occurredAt : null;
  };

  for (const event of activeRunEvents) {
    if (startedAt === null && typeof event.occurredAt === 'number') {
      startedAt = event.occurredAt;
    }

    if (event.type === 'text_delta') {
      startNewRoundIfAdvanced(event.occurredAt);
      text += event.delta;
      parts = appendStreamingTextDelta(parts, event.delta, recoveryMessageId);
      hasRenderableContent = true;
      continue;
    }

    if (event.type === 'thinking_delta') {
      startNewRoundIfAdvanced(event.occurredAt);
      thinkingBlocks = appendStreamingThinkingChunk(thinkingBlocks, event, {
        forceNewBlock: parts[parts.length - 1]?.type !== 'reasoning',
      });
      parts = appendStreamingThinkingDelta(parts, reasoningSegmentMeta, event, recoveryMessageId);
      hasRenderableContent = true;
      continue;
    }

    if (event.type === 'thinking_end') {
      thinkingBlocks = markStreamingThinkingChunkEnded(thinkingBlocks, event);
      parts = markStreamingReasoningSegmentEnded(parts, reasoningSegmentMeta, event);
      continue;
    }

    if (event.type === 'usage') {
      usage = mergeChatBackendUsageSnapshot(usage, event);
      // 迟到的重复 usage 不能把已经切过去的轮次再切一次。
      if (highestCompletedRound === null || event.round > highestCompletedRound) {
        highestCompletedRound = event.round;
        pendingRoundBoundary = true;
      }
      continue;
    }

    if (event.type === 'upstream_route') {
      upstreamRoute = {
        modelId: event.modelId,
        ...(event.providerId ? { providerId: event.providerId } : {}),
      };
      continue;
    }

    if ((event.type === 'done' || event.type === 'error') && event.upstreamSummary) {
      upstreamSummary = event.upstreamSummary;
      continue;
    }

    if (event.type === 'tool_call_delta') {
      startNewRoundIfAdvanced(event.occurredAt);
      activeToolCallIds.add(event.toolCallId);
      const inputText = `${toolInputTextByCallId.get(event.toolCallId) ?? ''}${event.inputDelta}`;
      toolInputTextByCallId.set(event.toolCallId, inputText);
      parts = upsertStreamingToolSegment(parts, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: parseToolCallInputText(inputText),
        status: 'running',
      });
      hasRenderableContent = true;
      continue;
    }

    if (event.type === 'tool_result') {
      activeToolCallIds.add(event.toolCallId);
      const hasPendingPermission = hasActivePendingPermissionRequest(event);
      parts = applyToolResultToStreamingSegment(parts, {
        toolCallId: event.toolCallId,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
        ...(event.attachments && event.attachments.length > 0
          ? { attachments: event.attachments }
          : {}),
        ...(hasPendingPermission && event.pendingPermissionRequestId
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : {}),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      });
      hasRenderableContent = true;
    }
  }

  if (pendingRoundBoundary) {
    // 最后一条 `usage` 之后没有任何新一轮内容：**当前没有进行中的轮**。
    //
    // 此刻留在缓冲区里的 `text` / `parts` 属于刚刚结束、并且已经由
    // `finalizeAssistant` 落库的那一轮（`usage` 是轮结束信号，先落库后发出）。
    // 把它当成「本轮已有片段」返回，attach 就会用 `usage.round + 1` 的键把同一批
    // 内容再提交一条，本地副本随即在判重里顶掉历史槽位 —— 正是要修的错位。
    //
    // 返回**空内容快照**而不是 null：null 会被上层当成「这一拍问不出结果」并继续
    // 沿用它自己的旧快照，旧内容照样会被播种。
    return {
      messageId: null,
      parts: [],
      startedAt: null,
      text: '',
      thinkingBlocks: [],
      toolCalls: [],
      ...(upstreamRoute ? { upstreamRoute } : {}),
      usage,
      ...(upstreamSummary ? { upstreamSummary } : {}),
    };
  }

  if (!hasRenderableContent) {
    return null;
  }

  const recoveredAssistantAnchor = findRecoveredAssistantAnchor({
    activeToolCallIds,
    messages: input.messages,
    text,
    thinkingBlocks,
  });
  const anchoredToolCallsById = new Map(
    (recoveredAssistantAnchor?.toolCalls ?? []).flatMap((toolCall) =>
      toolCall.toolCallId ? [[toolCall.toolCallId, toolCall] as const] : [],
    ),
  );
  const recoveredToolCalls = parts.flatMap((part): AssistantTraceToolCall[] => {
    if (part.type !== 'tool') {
      return [];
    }
    const anchored = anchoredToolCallsById.get(part.toolCallId);
    return [
      {
        ...anchored,
        toolCallId: part.toolCallId,
        toolName: part.toolName || anchored?.toolName || 'tool',
        input: part.input,
        ...(part.output !== undefined ? { output: part.output } : {}),
        ...(part.isError !== undefined ? { isError: part.isError } : {}),
        ...(part.pendingPermissionRequestId
          ? { pendingPermissionRequestId: part.pendingPermissionRequestId }
          : {}),
        ...(part.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        ...(part.status ? { status: part.status } : {}),
      },
    ];
  });

  return {
    messageId: recoveredAssistantAnchor?.messageId ?? null,
    ...(recoveredAssistantAnchor?.modifiedFilesSummary
      ? { modifiedFilesSummary: recoveredAssistantAnchor.modifiedFilesSummary }
      : {}),
    startedAt,
    parts,
    text,
    thinkingBlocks,
    toolCalls:
      recoveredToolCalls.length > 0
        ? recoveredToolCalls
        : (recoveredAssistantAnchor?.toolCalls ?? []),
    ...(upstreamRoute ? { upstreamRoute } : {}),
    usage,
    ...(upstreamSummary ? { upstreamSummary } : {}),
  };
}
