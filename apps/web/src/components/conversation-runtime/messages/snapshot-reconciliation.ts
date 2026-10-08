import type { AssistantTracePayload, AssistantTraceToolCall, Message } from '@openAwork/shared';
import type { ChatMessage, ChatMessagePart, ChatToolPart } from './message-model.js';
import {
  getComparableCreatedAt,
  joinReasoningBlocks,
  normalizeCreatedAt,
} from './message-coercion.js';
import { parseAssistantEventContent } from './card-codec.js';
import {
  areLikelySameNearbyUserMessage,
  areLogicalMessageDuplicates,
  areMessagesSeparatedByUserTurn,
  areSameAssistantMessageContent,
  areSnapshotMessagesEquivalent,
  areStronglyIdenticalMessages,
  hasOverlappingPartIds,
  hasUserMessageBetween,
} from './message-equivalence.js';
import { buildReadableAssistantText } from './reasoning-content.js';
import {
  contentFromParts,
  createAssistantTraceContent,
  readAssistantTracePayload,
  reconcilePartsById,
} from './trace-codec.js';

export function toSharedMessageSnapshot(messages: ChatMessage[]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: normalizeCreatedAt(message.createdAt),
    content:
      message.role === 'assistant'
        ? [
            {
              type: 'text',
              text: (() => {
                const assistantTrace = readAssistantTracePayload(message);
                return assistantTrace
                  ? buildReadableAssistantText(assistantTrace.text, assistantTrace.reasoningBlocks)
                  : message.content;
              })(),
            },
          ]
        : message.rawContent && message.rawContent.length > 0
          ? message.rawContent
          : [{ type: 'text', text: message.content }],
  }));
}

export function reconcileSnapshotChatMessages(
  previousMessages: ChatMessage[],
  snapshotMessages: ChatMessage[],
): ChatMessage[] {
  if (previousMessages.length === 0 || snapshotMessages.length === 0) {
    return snapshotMessages.length === 0 ? previousMessages : snapshotMessages;
  }

  // Build an index of previous messages by ID for O(1) lookup.
  const previousById = new Map<string, { message: ChatMessage; index: number }>();
  for (let index = 0; index < previousMessages.length; index++) {
    const message = previousMessages[index]!;
    previousById.set(message.id, { message, index });
  }

  // Track which previous messages have been matched so we can preserve unmatched
  // assistant event cards near their original anchors without duplicating them later.
  const matchedPreviousIndices = new Set<number>();
  const preservedPreviousIndices = new Set<number>();
  const reconciledSnapshotEntries: Array<{
    matchedPreviousIndex: number | null;
    message: ChatMessage;
  }> = [];

  // Walk through snapshot messages in server order (canonical order).
  for (const [snapshotIndex, snapshotMessage] of snapshotMessages.entries()) {
    const previousEntry = previousById.get(snapshotMessage.id);

    if (previousEntry) {
      // Same ID — use parts-based merge (opencode pattern).
      matchedPreviousIndices.add(previousEntry.index);
      const previousMessage = previousEntry.message;

      if (previousMessage.status === 'streaming' && snapshotMessage.status !== 'streaming') {
        // Snapshot has a finalized version (e.g. completed/error), prefer it.
        // Still keep a locally known cancelled/error terminal if the snapshot
        // only brought a generic completed payload.
        const mergedParts =
          previousMessage.parts && snapshotMessage.parts
            ? reconcilePartsById(previousMessage.parts, snapshotMessage.parts)
            : snapshotMessage.parts;
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: buildFinalizedMessage(previousMessage, snapshotMessage, mergedParts),
        });
      } else if (previousMessage.parts && snapshotMessage.parts) {
        // Both have parts — merge by part ID (find → replace or push).
        const mergedParts = reconcilePartsById(previousMessage.parts, snapshotMessage.parts);
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: buildFinalizedMessage(previousMessage, snapshotMessage, mergedParts),
        });
      } else {
        // Fallback: prefer previous to preserve local annotations, but merge
        // if the snapshot has more complete text content.
        const merged = mergePreferringCompleteContent(previousMessage, snapshotMessage);
        reconciledSnapshotEntries.push({
          matchedPreviousIndex: previousEntry.index,
          message: {
            ...merged,
            ...preferLocalTerminalStatus(previousMessage, snapshotMessage),
          },
        });
      }
    } else {
      // No ID match — check if a previous message at a nearby position shares
      // overlapping part IDs or equivalent content (handles server assigning
      // a different message ID for the same logical message).
      // Use a wider forward window (+5) to skip over locally-appended event
      // cards (permission events, compaction cards, etc.) that the server
      // snapshot does not include.
      let foundEquivalent = false;
      for (let offset = -1; offset <= 5 && !foundEquivalent; offset++) {
        const candidateIndex = reconciledSnapshotEntries.length + offset;
        if (
          candidateIndex >= 0 &&
          candidateIndex < previousMessages.length &&
          !matchedPreviousIndices.has(candidateIndex) &&
          !hasUserMessageBetween(previousMessages, candidateIndex, snapshotIndex)
        ) {
          const candidate = previousMessages[candidateIndex]!;
          const matchedByParts = hasOverlappingPartIds(candidate.parts, snapshotMessage.parts);
          const matchedByNearbyUserMessage = areLikelySameNearbyUserMessage(
            candidate,
            snapshotMessage,
          );
          const matchedByAssistantContent = areSameAssistantMessageContent(
            candidate,
            snapshotMessage,
          );
          if (
            matchedByParts ||
            matchedByNearbyUserMessage ||
            matchedByAssistantContent ||
            areSnapshotMessagesEquivalent(candidate, snapshotMessage)
          ) {
            matchedPreviousIndices.add(candidateIndex);
            const mergedParts =
              matchedByParts && candidate.parts && snapshotMessage.parts
                ? reconcilePartsById(candidate.parts, snapshotMessage.parts)
                : undefined;
            const mergedMessage =
              mergedParts !== undefined
                ? {
                    ...snapshotMessage,
                    parts: mergedParts,
                    content: contentFromParts(
                      mergedParts,
                      snapshotMessage.modifiedFilesSummary ?? candidate.modifiedFilesSummary,
                    ),
                  }
                : candidate.parts && !snapshotMessage.parts
                  ? {
                      ...snapshotMessage,
                      parts: candidate.parts,
                      content: contentFromParts(
                        candidate.parts,
                        snapshotMessage.modifiedFilesSummary ?? candidate.modifiedFilesSummary,
                      ),
                    }
                  : snapshotMessage;
            reconciledSnapshotEntries.push({
              matchedPreviousIndex: candidateIndex,
              // Keep the server identity/terminal metadata, but retain the
              // live part order whenever both sides describe the same trace.
              message:
                mergedParts !== undefined
                  ? mergedMessage
                  : matchedByParts || matchedByNearbyUserMessage || matchedByAssistantContent
                    ? mergedMessage
                    : candidate,
            });
            foundEquivalent = true;
          }
        }
      }

      if (!foundEquivalent) {
        // Genuinely new message from the server.
        reconciledSnapshotEntries.push({ matchedPreviousIndex: null, message: snapshotMessage });
      }
    }
  }

  const reconciled: ChatMessage[] = [];
  let nextPreviousIndex = 0;

  const preserveInterleavedAssistantEventsBefore = (matchedPreviousIndex: number) => {
    while (nextPreviousIndex < matchedPreviousIndex) {
      if (!matchedPreviousIndices.has(nextPreviousIndex)) {
        const previousMessage = previousMessages[nextPreviousIndex]!;
        if (
          previousMessage.status !== 'streaming' &&
          parseAssistantEventContent(previousMessage.content)
        ) {
          preservedPreviousIndices.add(nextPreviousIndex);
          reconciled.push(previousMessage);
        }
      }
      nextPreviousIndex += 1;
    }
  };

  for (const entry of reconciledSnapshotEntries) {
    if (entry.matchedPreviousIndex !== null) {
      preserveInterleavedAssistantEventsBefore(entry.matchedPreviousIndex);
      reconciled.push(entry.message);
      nextPreviousIndex = entry.matchedPreviousIndex + 1;
      continue;
    }

    reconciled.push(entry.message);
  }

  // Append any previous messages that were not matched (local-only, e.g. event cards
  // appended during streaming that the server snapshot hasn't synced yet).
  // Before appending, check that no content-equivalent message already exists in
  // the reconciled list — this prevents duplication when the server snapshot assigns
  // a different ID to the same logical message the client created locally.
  for (let index = 0; index < previousMessages.length; index++) {
    if (!matchedPreviousIndices.has(index) && !preservedPreviousIndices.has(index)) {
      const previousMessage = previousMessages[index]!;
      // Only preserve completed local messages; skip streaming placeholders
      // that should have been replaced by the snapshot.
      if (previousMessage.status === 'streaming') {
        continue;
      }

      // Check if an equivalent message already exists in reconciled output
      // (e.g. the snapshot contains the same message under a different ID).
      const alreadyPresent = reconciled.some(
        (existing) =>
          existing.id !== previousMessage.id &&
          areSnapshotMessagesEquivalent(existing, previousMessage) &&
          !areMessagesSeparatedByUserTurn(existing, previousMessage, previousMessages),
      );
      if (alreadyPresent) {
        continue;
      }

      const previousCreatedAt = getComparableCreatedAt(previousMessage.createdAt);
      const snapshotHasDifferentRequest = snapshotMessages.some(
        (snapshotMessage) =>
          previousMessage.clientRequestId !== undefined &&
          snapshotMessage.clientRequestId !== undefined &&
          previousMessage.clientRequestId !== snapshotMessage.clientRequestId,
      );
      // A *trailing* local message is either the newest turn the snapshot has
      // not persisted yet, or — when the snapshot re-issued that turn under a
      // new id (recovery re-projection) — a stale copy of it. In both shapes the
      // snapshot's tail order stays authoritative, so append it. Only interior
      // unmatched messages (an earlier round the snapshot omitted entirely) are
      // positioned by `createdAt`, otherwise they would render after turns that
      // came later.
      const isTrailingLocalMessage = index === previousMessages.length - 1;
      if (previousCreatedAt === null || snapshotHasDifferentRequest || isTrailingLocalMessage) {
        reconciled.push(previousMessage);
        continue;
      }
      const insertionIndex = reconciled.findIndex((candidate) => {
        const candidateCreatedAt = getComparableCreatedAt(candidate.createdAt);
        return candidateCreatedAt !== null && candidateCreatedAt > previousCreatedAt;
      });
      if (insertionIndex === -1) {
        reconciled.push(previousMessage);
      } else {
        reconciled.splice(insertionIndex, 0, previousMessage);
      }
    }
  }

  // 最终去重：实时提交、快照刷新和恢复投影可能给同一回合分配不同
  // message id。仅按 id 去重会把这些逻辑副本一起交给渲染层。
  const snapshotMessageIds = new Set(snapshotMessages.map((message) => message.id));
  const deduplicated: ChatMessage[] = [];
  for (const message of reconciled) {
    const duplicateIndex = deduplicated.findIndex((existing) => {
      // 两条消息都来自权威快照时，它们是各自独立持久化的消息：只有强身份
      // 才能判为重复。模糊等价仅用于把本地乐观副本与其快照孪生配对，
      // 否则同一回合的相邻两轮（文本相同且时间接近）会被错误合并而丢失。
      if (snapshotMessageIds.has(existing.id) && snapshotMessageIds.has(message.id)) {
        return areStronglyIdenticalMessages(existing, message);
      }
      return areLogicalMessageDuplicates(existing, message);
    });
    const hasUserTurnBetween =
      duplicateIndex >= 0 &&
      areMessagesSeparatedByUserTurn(deduplicated[duplicateIndex]!, message, reconciled);
    if (duplicateIndex < 0 || hasUserTurnBetween) {
      deduplicated.push(message);
      continue;
    }

    // Keep the first entry's position, but let the later snapshot contribute
    // terminal status/output and the newer ordered parts.
    const existing = deduplicated[duplicateIndex]!;
    deduplicated[duplicateIndex] = chooseMoreCompleteMessage(existing, message);
  }

  return recycleUnchangedMessageReferences(previousMessages, deduplicated);
}

/**
 * 不进入 `content`、但参与渲染的 `ChatMessage` 字段。
 *
 * 快照带来的这些字段常常比本地更完整（典型：流式结束后才由服务端回填
 * `providerUsage`），所以引用回收时**必须**逐项比对，否则会复用缺字段的旧对象，
 * 让用量 / 模型标签 / 耗时展示停在旧值。
 *
 * `rawContent` 刻意不在列：它是 user 消息的原始内容数组，每次归一化都是新引用，
 * 按引用比较会永不命中；其信息已被 `content` 完整覆盖（渲染只读 `content`，
 * `rawContent` 仅用于导出）。
 */
const RECYCLED_SCALAR_FIELDS = [
  'role',
  'clientRequestId',
  'model',
  'providerId',
  'agentId',
  'createdAt',
  'durationMs',
  'firstTokenLatencyMs',
  'stopReason',
  'tokenEstimate',
  'providerUsage',
  'toolCallCount',
  'modifiedFilesSummary',
  'status',
  'reasoningBlocksEndedFlags',
  'reasoningBlocksDurationsMs',
] as const satisfies readonly (keyof ChatMessage)[];

/**
 * 单个标量字段的等价判定。
 *
 * 原始值直接 `Object.is`；对象/数组走 `JSON.stringify` —— 这些字段（usage 快照、
 * 数字数组）都是小而扁的结构，序列化成本远低于整条消息，且键序不同导致的漏命中
 * 只是少一次复用，不会漏更新。
 */
function isSameScalarField(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || left === undefined || right === undefined) {
    return false;
  }
  if (typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * parts 序列等价判定。
 *
 * text / reasoning / tool 分片的内容已由 `content` 覆盖（`contentFromParts` 会把
 * `status` / `isError` / `output` / `pendingPermissionRequestId` 一并序列化），这里
 * 只校验分片 id 序列，防止顺序错乱。`event` 分片是唯一不进 `content` 的变体
 * （`readAssistantTracePayloadFromParts` 忽略它），故单独比对其 payload。
 */
function haveEquivalentParts(
  previousParts: ChatMessagePart[] | undefined,
  nextParts: ChatMessagePart[] | undefined,
): boolean {
  if (previousParts === undefined || nextParts === undefined) {
    return previousParts === nextParts;
  }
  if (previousParts.length !== nextParts.length) {
    return false;
  }
  for (let index = 0; index < previousParts.length; index += 1) {
    const previousPart = previousParts[index];
    const nextPart = nextParts[index];
    if (previousPart === undefined || nextPart === undefined) {
      return false;
    }
    if (previousPart.id !== nextPart.id || previousPart.type !== nextPart.type) {
      return false;
    }
    if (previousPart.type === 'event' && nextPart.type === 'event') {
      if (!isSameScalarField(previousPart.payload, nextPart.payload)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 同 id 且内容未变 —— 即「同一条持久化消息、这一帧没有任何新信息」。
 *
 * 不做整条消息的 `JSON.stringify`：`content` 是 parts 的序列化结果，而 tool output
 * 可能是整份文件内容（几十 KB～数 MB），长历史每帧全量序列化一遍的成本高于它
 * 省下的重渲染。改为「`content` 值比较 + 非 content 字段逐项 + parts id 序列」。
 *
 * 判定只允许**更保守**（漏判 = 少一次复用 = 多渲染）；一旦过宽就会复用陈旧对象，
 * 那比不优化更糟。
 */
function isSameMessageRevision(previous: ChatMessage, next: ChatMessage): boolean {
  if (previous.id !== next.id) {
    return false;
  }
  for (const field of RECYCLED_SCALAR_FIELDS) {
    if (!isSameScalarField(previous[field], next[field])) {
      return false;
    }
  }
  if (previous.content !== next.content) {
    return false;
  }
  return haveEquivalentParts(previous.parts, next.parts);
}

/**
 * 引用回收：把「与 previous 同 id 且内容一致」的消息换回 previous 的对象引用。
 *
 * 归一化每次都会造新消息对象，因此即便切回一个刚离开的会话、快照内容与视图缓存
 * 完全一致，合流结果也会整表换新引用，击穿消息列表里所有 `ChatGroupBlock` 的
 * `React.memo`（长历史下是几百 ms 级的重渲染）。全部命中时直接返回 `previousMessages`，
 * 让 `setMessages` 短路，彻底消除这次重渲染。
 */
function recycleUnchangedMessageReferences(
  previousMessages: readonly ChatMessage[],
  reconciled: ChatMessage[],
): ChatMessage[] {
  const previousById = new Map<string, ChatMessage>();
  for (const message of previousMessages) {
    if (!previousById.has(message.id)) {
      previousById.set(message.id, message);
    }
  }

  const recycled = reconciled.map((message) => {
    const candidate = previousById.get(message.id);
    return candidate !== undefined && isSameMessageRevision(candidate, message)
      ? candidate
      : message;
  });

  // 长度不同说明快照增删了消息：此时仍可逐项复用引用，但不能沿用 previous 数组本身。
  if (recycled.length !== previousMessages.length) {
    return recycled;
  }

  for (let index = 0; index < recycled.length; index += 1) {
    if (!Object.is(recycled[index], previousMessages[index])) {
      return recycled;
    }
  }
  return previousMessages as ChatMessage[];
}

/**
 * 终态消息的统一基底：**服务端优先 + 本地独有字段兜底**。
 *
 * 同 id 合流有两条「本地已终态 / 快照也终态」的分支（流式收尾与后台快照刷新），
 * 二者处理的是同一类语义，却曾采用相反的服务端优先级 —— 一条用 `{ ...snapshotMessage }`、
 * 一条用 `{ ...previousMessage }`，导致服务端回填的 `providerUsage` / `model` /
 * `agentId` / `durationMs` 在后者被丢弃。抽取到这里让两条分支真正共用一套基底。
 *
 * `parts` / `content` 一律由 `mergedParts` 派生（保证两者永远序列化自同一份分片），
 * `modifiedFilesSummary` 走「服务端优先、本地兜底」。
 *
 * `reasoningBlocksEndedFlags` / `reasoningBlocksDurationsMs` 是唯一需要额外裁决的
 * 字段：recovery 归一化产物并不携带它们（`normalize-chat-messages.ts` 无此字段），
 * 因此**快照有值时以快照为准**（既有契约要求按快照的 reasoning parts 同步结束标记
 * 与时长——本地可能只记录了前 N 个块），快照缺失时才沿用本地值兜底。
 */
function buildFinalizedMessage(
  previousMessage: ChatMessage,
  snapshotMessage: ChatMessage,
  mergedParts: ChatMessagePart[] | undefined,
): ChatMessage {
  const modifiedFilesSummary =
    snapshotMessage.modifiedFilesSummary ?? previousMessage.modifiedFilesSummary;
  const reasoningBlocksEndedFlags =
    snapshotMessage.reasoningBlocksEndedFlags ?? previousMessage.reasoningBlocksEndedFlags;
  const reasoningBlocksDurationsMs =
    snapshotMessage.reasoningBlocksDurationsMs ?? previousMessage.reasoningBlocksDurationsMs;
  return {
    ...snapshotMessage,
    ...(mergedParts
      ? { parts: mergedParts, content: contentFromParts(mergedParts, modifiedFilesSummary) }
      : {}),
    modifiedFilesSummary,
    ...(reasoningBlocksEndedFlags ? { reasoningBlocksEndedFlags } : {}),
    ...(reasoningBlocksDurationsMs ? { reasoningBlocksDurationsMs } : {}),
    ...preferLocalTerminalStatus(previousMessage, snapshotMessage),
  };
}

function chooseMoreCompleteMessage(left: ChatMessage, right: ChatMessage): ChatMessage {
  const leftParts = left.parts?.length ?? 0;
  const rightParts = right.parts?.length ?? 0;
  if (rightParts > leftParts) return right;
  if (right.status !== 'streaming' && left.status === 'streaming') return right;
  return left;
}

function preferLocalTerminalStatus(
  previous: ChatMessage,
  snapshot: ChatMessage,
): Pick<ChatMessage, 'status' | 'stopReason'> {
  const previousIsTerminal =
    previous.status === 'error' ||
    previous.status === 'cancelled' ||
    previous.stopReason === 'error' ||
    previous.stopReason === 'cancelled';
  const snapshotIsGenericCompleted =
    snapshot.status === undefined ||
    snapshot.status === 'completed' ||
    snapshot.status === 'streaming';

  if (previousIsTerminal && snapshotIsGenericCompleted) {
    return {
      ...(previous.status ? { status: previous.status } : {}),
      ...(previous.stopReason ? { stopReason: previous.stopReason } : {}),
    };
  }

  return {
    ...(snapshot.status
      ? { status: snapshot.status }
      : previous.status
        ? { status: previous.status }
        : {}),
    ...(snapshot.stopReason
      ? { stopReason: snapshot.stopReason }
      : previous.stopReason
        ? { stopReason: previous.stopReason }
        : {}),
  };
}

/**
 * When the previous message and snapshot share the same ID, prefer the previous
 * message's local annotations (tool call states, pending permissions) but adopt
 * the snapshot's text if it is strictly longer (more complete).
 *
 * A parts-less side only offers a flattened `text` plus a `toolCalls` list — it
 * cannot say where tools / reasoning split the text. So whenever a message
 * carries `parts`, those parts are the single source of ordering: the more
 * complete text is written back into them and `content` is derived from the
 * result. The branches are:
 *
 * 1. previous has parts → keep its part order, absorb the snapshot text into the
 *    matching text part, then derive `content` from the merged parts.
 * 2. only the snapshot has parts → adopt the snapshot's part order and carry the
 *    previous side's local tool annotations (pending permission /
 *    resumedAfterApproval / non-running status) back onto the matching tools.
 * 3. neither side has parts → `content` is the only representation, so the
 *    flattened trace merge below is safe.
 *
 * Every returned message with parts therefore has a `content` that is exactly
 * the serialization of those parts — no consumer can observe a different order.
 */
function mergePreferringCompleteContent(previous: ChatMessage, snapshot: ChatMessage): ChatMessage {
  if (previous.role !== 'assistant') return previous;

  const prevTrace = readAssistantTracePayload(previous);
  const snapTrace = readAssistantTracePayload(snapshot);
  if (!prevTrace || !snapTrace) return previous;

  // Only merge if snapshot has strictly more content (text or reasoning).
  const prevText = prevTrace.text.trim();
  const snapText = snapTrace.text.trim();
  const prevReasoningLen = joinReasoningBlocks(prevTrace.reasoningBlocks).length;
  const snapReasoningLen = joinReasoningBlocks(snapTrace.reasoningBlocks).length;
  if (snapText.length <= prevText.length && snapReasoningLen <= prevReasoningLen) return previous;

  const modifiedFilesSummary = snapTrace.modifiedFilesSummary ?? previous.modifiedFilesSummary;
  const hasPreviousTraceParts = previous.parts?.some((part) => part.type !== 'event') ?? false;
  const hasSnapshotTraceParts = snapshot.parts?.some((part) => part.type !== 'event') ?? false;

  if (hasPreviousTraceParts && previous.parts) {
    const mergedParts = adoptSnapshotTextIntoParts(
      previous.parts,
      previous.id,
      prevTrace.text,
      snapTrace.text,
    );
    return {
      ...previous,
      parts: mergedParts,
      content: contentFromParts(mergedParts, modifiedFilesSummary),
      modifiedFilesSummary,
      ...preferLocalTerminalStatus(previous, snapshot),
    };
  }

  if (hasSnapshotTraceParts && snapshot.parts) {
    const mergedParts = preserveLocalToolAnnotations(snapshot.parts, prevTrace);
    return {
      ...previous,
      parts: mergedParts,
      content: contentFromParts(mergedParts, modifiedFilesSummary),
      modifiedFilesSummary,
      ...preferLocalTerminalStatus(previous, snapshot),
    };
  }

  // Neither side has parts: keep the legacy flattened-trace merge. There is no
  // parts array to disagree with, so rebuilding `content` here is safe.
  const mergedToolCalls: AssistantTraceToolCall[] = snapTrace.toolCalls.map((snapshotCall) =>
    mergeToolCallMetadata(snapshotCall, findToolCallById(prevTrace, snapshotCall.toolCallId)),
  );

  return {
    ...previous,
    content: createAssistantTraceContent({
      text: snapText,
      toolCalls: mergedToolCalls,
      ...(snapTrace.reasoningBlocks && snapTrace.reasoningBlocks.length > 0
        ? { reasoningBlocks: snapTrace.reasoningBlocks }
        : prevTrace.reasoningBlocks && prevTrace.reasoningBlocks.length > 0
          ? { reasoningBlocks: prevTrace.reasoningBlocks }
          : {}),
      ...(snapTrace.modifiedFilesSummary
        ? { modifiedFilesSummary: snapTrace.modifiedFilesSummary }
        : {}),
    }),
    modifiedFilesSummary,
    ...preferLocalTerminalStatus(previous, snapshot),
  };
}

/**
 * 把快照更完整的扁平文本写回 parts，同时不改变任何 part 的相对位置。
 *
 * 只有当快照文本是 parts 扁平文本的前缀扩展、或 parts 只有一个 text part 时
 * 才能安全映射；多个 text part 且文本发生重排时无法在不臆造分段位置的前提下
 * 写回，此时保留原 parts 并让 content 从 parts 派生，宁可少吸收快照文本，也
 * 不让两种表示出现不同顺序。
 */
function adoptSnapshotTextIntoParts(
  parts: ChatMessagePart[],
  messageId: string,
  previousText: string,
  snapshotText: string,
): ChatMessagePart[] {
  if (snapshotText === previousText) return parts;

  const textIndexes: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]?.type === 'text') textIndexes.push(index);
  }

  if (snapshotText.startsWith(previousText)) {
    const suffix = snapshotText.slice(previousText.length);
    if (suffix.length === 0) return parts;
    const lastTextIndex = textIndexes[textIndexes.length - 1];
    if (lastTextIndex === undefined) {
      return [...parts, { id: `${messageId}:text`, type: 'text', text: snapshotText }];
    }
    return parts.map((part, index) =>
      index === lastTextIndex && part.type === 'text'
        ? { ...part, text: part.text + suffix }
        : part,
    );
  }

  if (textIndexes.length === 1) {
    const onlyTextIndex = textIndexes[0]!;
    return parts.map((part, index) =>
      index === onlyTextIndex && part.type === 'text' ? { ...part, text: snapshotText } : part,
    );
  }

  return parts;
}

/**
 * 以快照 parts 的顺序为基准，把 previous 的本地工具注解搬回对应工具分片：
 * 待审批 id、审批后恢复标记，以及本地已进入的非 running 终态优先于快照状态。
 * 其它字段（输出 / 错误 / 工期等）仍以快照为准。
 */
function preserveLocalToolAnnotations(
  parts: ChatMessagePart[],
  previousTrace: AssistantTracePayload,
): ChatMessagePart[] {
  const previousCallsById = new Map<string, AssistantTraceToolCall>();
  for (const call of previousTrace.toolCalls) {
    if (call.toolCallId) previousCallsById.set(call.toolCallId, call);
  }
  if (previousCallsById.size === 0) return parts;

  return parts.map((part) => {
    if (part.type !== 'tool') return part;
    const previousCall = previousCallsById.get(part.toolCallId);
    if (!previousCall) return part;
    return {
      ...part,
      ...(previousCall.pendingPermissionRequestId
        ? { pendingPermissionRequestId: previousCall.pendingPermissionRequestId }
        : {}),
      ...(previousCall.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
      ...(previousCall.status && previousCall.status !== 'running'
        ? { status: previousCall.status }
        : {}),
    } satisfies ChatToolPart;
  });
}

function mergeToolCallMetadata(
  snapshotCall: AssistantTraceToolCall,
  previousCall: AssistantTraceToolCall | undefined,
): AssistantTraceToolCall {
  if (!previousCall) return snapshotCall;
  return {
    ...snapshotCall,
    ...(previousCall.pendingPermissionRequestId
      ? { pendingPermissionRequestId: previousCall.pendingPermissionRequestId }
      : {}),
    ...(previousCall.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
    ...(previousCall.status && previousCall.status !== 'running'
      ? { status: previousCall.status }
      : {}),
  } satisfies AssistantTraceToolCall;
}

function findToolCallById(
  trace: AssistantTracePayload,
  toolCallId: string | undefined,
): AssistantTraceToolCall | undefined {
  if (!toolCallId) return undefined;
  return trace.toolCalls.find((call) => call.toolCallId === toolCallId);
}
