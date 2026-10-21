import type { AssistantTraceToolCall, RunEvent } from '@openAwork/shared';
import type { ChatMessage, ChatToolPart } from './message-model.js';
import { hasActivePendingPermissionRequest } from './message-coercion.js';
import { parseAssistantEventContent } from './card-codec.js';
import { createAssistantEventContent } from './event-card-builder.js';
import { createAssistantTraceContent, readAssistantTracePayload } from './trace-codec.js';
import { compareOrderedIds, makeOrderedMessageId } from './ordered-id.js';

/**
 * 找出「新卡片」应插入的位置。
 *
 * 这套渲染层的位置判定以**有序 id**（`msg_<12-hex-timestamp>…`，词序即创建序）为主、
 * `createdAt` 为兜底。判定必须**只用一种基准**：单轮扫描里混用会让非有序 id 的条目
 * （旧网关写的 UUID 消息）用时间戳提前截断扫描，与相邻条目的 id 基准互相矛盾，
 * 插入位置不可预测。因此这里分两轮——先只看「双方都有序 id」的条目；一轮都没命中
 * 才用时间戳，且只作用于非有序 id 的条目。与 `chat-render-merge.ts` 的规则一致。
 *
 * 下界：卡片**绝不能落在最后一条用户消息之前**。
 *
 * 事件卡片是「当前这一轮」的产物，而当前轮的助手回复还没提交（提交发生在下一轮
 * 内容到达时）。若只按 `occurredAt` 比较，网关时钟偏差、或事件时间戳早于用户消息
 * 落库时间时，卡片就会跑到提问上方——这正是「权限申请 / 提问一出现，顺序就乱」的
 * 形态。位置下界只看「最后一条用户消息的下标 + 1」，与时间戳无关，因此不受时钟影响。
 */
function findOrderedInsertIndex(
  messages: ChatMessage[],
  cardId: string,
  cardCreatedAt: number,
): number {
  const minInsertIndex = findLastUserMessageIndex(messages) + 1;
  const byOrderedId = messages.findIndex(
    (message) =>
      compareOrderedIds(cardId, message.id) !== null && compareOrderedIds(cardId, message.id)! < 0,
  );
  if (byOrderedId !== -1) {
    return Math.max(byOrderedId, minInsertIndex);
  }
  const byTimestamp = messages.findIndex((message) => {
    if (compareOrderedIds(cardId, message.id) !== null) {
      return false;
    }
    const candidateCreatedAt =
      typeof message.createdAt === 'number'
        ? message.createdAt
        : Date.parse(String(message.createdAt ?? ''));
    return Number.isFinite(candidateCreatedAt) && candidateCreatedAt > cardCreatedAt;
  });
  if (byTimestamp !== -1) {
    return Math.max(byTimestamp, minInsertIndex);
  }
  return Math.max(messages.length, minInsertIndex);
}

/** 最后一条用户消息的下标；没有用户消息时返回 -1。 */
function findLastUserMessageIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === 'user') {
      return index;
    }
  }
  return -1;
}

export function clearResolvedPendingPermissionFromMessage(
  message: ChatMessage,
  requestId: string,
): ChatMessage | null {
  if (message.role !== 'assistant') {
    return message;
  }

  const assistantTrace = readAssistantTracePayload(message);
  if (!assistantTrace) {
    return message;
  }

  const remainingToolCalls = assistantTrace.toolCalls.filter(
    (toolCall) => toolCall.pendingPermissionRequestId !== requestId,
  );
  if (remainingToolCalls.length === assistantTrace.toolCalls.length) {
    return message;
  }

  const hasReasoningBlocks = (assistantTrace.reasoningBlocks?.length ?? 0) > 0;
  const hasModifiedFilesSummary = Boolean(assistantTrace.modifiedFilesSummary);
  const hasText = assistantTrace.text.trim().length > 0;

  if (
    !hasText &&
    !hasReasoningBlocks &&
    !hasModifiedFilesSummary &&
    remainingToolCalls.length === 0
  ) {
    return null;
  }

  const nextContent =
    remainingToolCalls.length === 0 && !hasReasoningBlocks && !hasModifiedFilesSummary
      ? assistantTrace.text
      : createAssistantTraceContent({
          ...(hasModifiedFilesSummary
            ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
            : {}),
          ...(hasReasoningBlocks ? { reasoningBlocks: assistantTrace.reasoningBlocks } : {}),
          text: assistantTrace.text,
          toolCalls: remainingToolCalls,
        });

  // Also update parts: remove the tool part whose pendingPermissionRequestId matched.
  const nextParts = message.parts?.filter((part) => {
    if (part.type !== 'tool') return true;
    return part.pendingPermissionRequestId !== requestId;
  });

  return {
    ...message,
    content: nextContent,
    ...(nextParts ? { parts: nextParts } : {}),
    modifiedFilesSummary: hasModifiedFilesSummary ? assistantTrace.modifiedFilesSummary : undefined,
    toolCallCount: remainingToolCalls.length > 0 ? remainingToolCalls.length : undefined,
  };
}

export function applyPermissionDecisionToLocalAssistantMessages(
  messages: ChatMessage[],
  requestId: string,
  decision: Extract<RunEvent, { type: 'permission_replied' }>['decision'],
  feedback?: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      return message;
    }

    let updated = false;
    const nextToolCalls = assistantTrace.toolCalls.map((toolCall) => {
      if (toolCall.pendingPermissionRequestId !== requestId) {
        return toolCall;
      }

      updated = true;
      const {
        pendingPermissionRequestId: _resolvedPendingPermissionRequestId,
        output: _waitingOutput,
        ...baseToolCall
      } = toolCall;

      return {
        ...baseToolCall,
        isError: decision === 'reject',
        ...(decision === 'reject'
          ? {
              output: feedback ? `权限已拒绝。用户反馈: ${feedback}` : '权限已拒绝，工具未执行。',
            }
          : {}),
        ...(decision !== 'reject' ? { resumedAfterApproval: true } : {}),
        status: decision === 'reject' ? ('failed' as const) : ('running' as const),
      } satisfies AssistantTraceToolCall;
    });

    if (!updated) {
      return message;
    }

    // Also update the parts array to reflect the permission decision.
    const nextParts = message.parts?.map((part) => {
      if (part.type !== 'tool' || part.pendingPermissionRequestId !== requestId) {
        return part;
      }
      const { pendingPermissionRequestId: _resolved, output: _waitingOutput, ...basePart } = part;
      return {
        ...basePart,
        isError: decision === 'reject',
        ...(decision === 'reject'
          ? {
              output: feedback ? `权限已拒绝。用户反馈: ${feedback}` : '权限已拒绝，工具未执行。',
            }
          : {}),
        ...(decision !== 'reject' ? { resumedAfterApproval: true } : {}),
        status: (decision === 'reject' ? 'failed' : 'running') as ChatToolPart['status'],
      } satisfies ChatToolPart;
    });

    return {
      ...message,
      content: createAssistantTraceContent({
        ...(assistantTrace.modifiedFilesSummary
          ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
          : {}),
        ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: assistantTrace.reasoningBlocks }
          : {}),
        text: assistantTrace.text,
        toolCalls: nextToolCalls,
      }),
      ...(nextParts ? { parts: nextParts } : {}),
      modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
      toolCallCount: nextToolCalls.length > 0 ? nextToolCalls.length : undefined,
    };
  });
}

export function dismissPermissionEventMessage(
  messages: ChatMessage[],
  requestId: string,
): ChatMessage[] {
  return messages.filter((message) => {
    if (message.role !== 'assistant') {
      return true;
    }

    const assistantEvent = parseAssistantEventContent(message.content);
    return !(assistantEvent?.kind === 'permission' && assistantEvent.requestId === requestId);
  });
}

export function applyToolResultToLocalAssistantMessages(
  messages: ChatMessage[],
  event: Extract<RunEvent, { type: 'tool_result' }>,
): ChatMessage[] {
  const hasPendingPermission = hasActivePendingPermissionRequest(event);

  /**
   * 先按 `toolCallId` 预筛候选消息，再只对候选解析 trace。
   *
   * 原实现对**全部历史消息**做 trace 解析（带 parts 的重建 trace、无 parts 的解析
   * content）并重建 content。每次工具完成（`tool_result`）都会走这里，长会话 / 连续
   * bash 命令下等于「每执行一条命令就把整段历史解析一遍」——正是执行 bash 时的卡顿来源。
   *
   * 有 parts 的消息：trace 由 parts 重建，parts 里没有该 toolCallId 就不可能命中，
   * 直接跳过；无 parts 的旧格式消息：先做廉价的子串预筛，避免无谓的整段解析。
   */
  const candidateIndexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== 'assistant') {
      continue;
    }
    const parts = message.parts;
    if (parts && parts.length > 0) {
      if (parts.some((part) => part.type === 'tool' && part.toolCallId === event.toolCallId)) {
        candidateIndexes.push(index);
      }
      continue;
    }
    if (message.content.includes(event.toolCallId)) {
      candidateIndexes.push(index);
    }
  }

  if (candidateIndexes.length === 0) {
    return messages;
  }

  let nextMessages: ChatMessage[] | null = null;

  for (const index of candidateIndexes) {
    const message = messages[index]!;
    const assistantTrace = readAssistantTracePayload(message);
    if (!assistantTrace) {
      continue;
    }

    let updatedInMessage = false;
    const nextToolCalls = assistantTrace.toolCalls.map((toolCall) => {
      if (toolCall.toolCallId !== event.toolCallId) {
        return toolCall;
      }

      updatedInMessage = true;

      const {
        pendingPermissionRequestId: _stalePendingPermissionRequestId,
        resumedAfterApproval: _staleResumedAfterApproval,
        ...baseToolCall
      } = toolCall;

      return {
        ...baseToolCall,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        ...(hasPendingPermission
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : {}),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: hasPendingPermission ? 'paused' : event.isError ? 'failed' : 'completed',
      } satisfies AssistantTraceToolCall;
    });

    if (!updatedInMessage) {
      continue;
    }

    const nextContent = createAssistantTraceContent({
      ...(assistantTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: assistantTrace.modifiedFilesSummary }
        : {}),
      ...(assistantTrace.reasoningBlocks && assistantTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: assistantTrace.reasoningBlocks }
        : {}),
      text: assistantTrace.text,
      toolCalls: nextToolCalls,
    });

    // Also update the parts array by replacing the matching tool part by ID.
    const nextParts = message.parts?.map((part) => {
      if (part.type !== 'tool' || part.toolCallId !== event.toolCallId) return part;
      return {
        ...part,
        output: event.output,
        isError: hasPendingPermission ? false : event.isError,
        ...(hasPendingPermission
          ? { pendingPermissionRequestId: event.pendingPermissionRequestId }
          : { pendingPermissionRequestId: undefined }),
        ...(event.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: (hasPendingPermission
          ? 'paused'
          : event.isError
            ? 'failed'
            : 'completed') as ChatToolPart['status'],
      } satisfies ChatToolPart;
    });

    if (nextMessages === null) {
      nextMessages = messages.slice();
    }
    nextMessages[index] = {
      ...message,
      content: nextContent,
      ...(nextParts ? { parts: nextParts } : {}),
      modifiedFilesSummary: assistantTrace.modifiedFilesSummary ?? undefined,
      toolCallCount: nextToolCalls.length > 0 ? nextToolCalls.length : undefined,
    };
  }

  return nextMessages ?? messages;
}

export function upsertPermissionEventMessage(
  messages: ChatMessage[],
  event: Extract<RunEvent, { type: 'permission_asked' | 'permission_replied' }>,
): ChatMessage[] {
  const content = createAssistantEventContent(event);
  if (!content) {
    return messages;
  }

  const nextMessages: ChatMessage[] = [];
  let matched = false;
  let changed = false;

  for (const message of messages) {
    if (message.role !== 'assistant') {
      nextMessages.push(message);
      continue;
    }

    const assistantEvent = parseAssistantEventContent(message.content);
    if (assistantEvent?.kind !== 'permission' || assistantEvent.requestId !== event.requestId) {
      nextMessages.push(message);
      continue;
    }

    if (!matched) {
      // 内容已经完全一致时不要换新对象：这个函数在 `permission_asked` /
      // `permission_replied` 上都会被调用，重复事件（attach 重放、快照合并）
      // 若每次都产出新数组 + 新消息对象，会让下游 `sanitizedHistoricalMessages`
      // 与整个消息列表 memo 链全部失效，权限弹窗期间就是一轮轮全量重渲染。
      const isIdentical = message.content === content && message.status === 'completed';
      nextMessages.push(
        isIdentical
          ? message
          : {
              ...message,
              content,
              createdAt: message.createdAt ?? event.occurredAt ?? Date.now(),
              status: 'completed',
            },
      );
      changed = changed || !isIdentical;
      matched = true;
    }
  }

  if (matched) {
    return changed ? nextMessages : messages;
  }

  // 新卡片：必须用**有序 id**，并按创建时间插到它真正属于的位置。
  //
  // 原实现用 `crypto.randomUUID()` + 无条件 append，两个问题叠加：
  // 1. 随机 UUID 不匹配 `ORDERED_MESSAGE_ID_PATTERN`，所有基于有序 id 的位置判定
  //    （流式气泡合并、快照合并）遇到它都会退化成时间戳基准，与相邻条目的 id 基准
  //    互相矛盾，插入位置变得不可预测——表现为消息顺序错乱；
  // 2. `permission_asked` 到达时，**触发它的那一轮助手消息还没落库**，无条件 append
  //    会让卡片排在它的宿主轮次之前；随后宿主轮次再被 append 到卡片之后。
  // 处理权限时 `dismissPermissionEventMessage` 会把这张卡删掉，顺序随之「恢复」，
  // 这正是观察到的现象。
  const createdAt = event.occurredAt ?? Date.now();
  const cardId = makeOrderedMessageId(createdAt);
  const insertIndex = findOrderedInsertIndex(nextMessages, cardId, createdAt);
  nextMessages.splice(insertIndex, 0, {
    content,
    createdAt,
    id: cardId,
    role: 'assistant',
    status: 'completed',
  });

  return nextMessages;
}
