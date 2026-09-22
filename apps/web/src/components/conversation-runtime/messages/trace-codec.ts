import type {
  AssistantTracePart,
  AssistantTracePayload,
  ModifiedFilesSummaryContent,
} from '@openAwork/shared';
import {
  contentFromAssistantTraceParts,
  createAssistantTraceContent as createSharedAssistantTraceContent,
  parseAssistantTraceContent as parseSharedAssistantTraceContent,
  partsFromAssistantTrace as partsFromSharedAssistantTrace,
  readAssistantTracePayloadFromParts as readAssistantTracePayloadFromSharedParts,
} from '@openAwork/shared';
import type {
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatToolPart,
} from './message-model.js';
import { hasActivePendingPermissionRequest } from './message-coercion.js';
import {
  parseFileDiffContent,
  parseInputImageAttachments,
  parseModifiedFilesSummaryContent,
  parseToolCallObservability,
} from './message-content.js';
import { normalizeReasoningText } from './reasoning-content.js';

export function createAssistantTraceContent(payload: AssistantTracePayload): string {
  return createSharedAssistantTraceContent({
    ...payload,
    ...(payload.reasoningBlocks
      ? {
          reasoningBlocks: payload.reasoningBlocks
            .map((item) => normalizeReasoningText(item))
            .filter((item) => item.length > 0),
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Parts ↔ AssistantTrace conversion helpers.
// `content` remains the serialized form for rendering compatibility;
// `parts` is the structured form used for reconciliation.
// ---------------------------------------------------------------------------

/**
 * Build a `parts` array from a parsed `AssistantTracePayload`.
 * Each part gets a deterministic ID derived from the parent message ID.
 */
export function partsFromAssistantTrace(
  messageId: string,
  trace: AssistantTracePayload,
): ChatMessagePart[] {
  return partsFromSharedAssistantTrace(messageId, trace) as ChatMessagePart[];
}

/**
 * Build a `parts` array from the raw assistant `MessageContent[]` array,
 * preserving the on-wire order in which the gateway recorded the segments.
 * Use this when the persisted message still has its structured `content`
 * array (post-2025-04 ordered persistence) — it reflects the true streaming
 * sequence of reasoning / text / tool_call segments instead of the legacy
 * reasoning → text → tool flattening produced by `partsFromAssistantTrace`.
 *
 * `tool_result` entries that appear in the same content array (the V2
 * projection in `message-v2-adapter.ts:v2ToV1Message` emits tool_call and
 * tool_result back-to-back inside the assistant message — no follow-up
 * `role: 'tool'` message is produced anymore) are merged onto the matching
 * tool part so the renderer sees `output` / `isError` / `status` directly
 * from the parts array. This is required for cards like `generate_image`
 * that read `result.artifactId` out of `part.output` to fetch and display
 * the actual artifact; without it the card shows "图片已生成" but the
 * image preview never appears even after refresh.
 */
export function partsFromOrderedAssistantContent(
  messageId: string,
  content: unknown[],
): ChatMessagePart[] {
  const parts: ChatMessagePart[] = [];
  const toolPartIndexByCallId = new Map<string, number>();
  let reasoningCounter = 0;
  let textCounter = 0;
  for (let index = 0; index < content.length; index += 1) {
    const item = content[index];
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const type = record['type'];

    if (type === 'reasoning') {
      const text = typeof record['text'] === 'string' ? record['text'] : '';
      // Skip empty reasoning segments. The gateway may persist them when a
      // `thinking_end` event arrives without any preceding `thinking_delta`
      // (or when the wire stream gets cut between the open and the first
      // content chunk). Rendering an empty reasoning part shows a stray
      // "Thinking:" header with no body — exactly the symptom users see
      // after a refresh.
      if (text.trim().length === 0) continue;
      const startedAt = typeof record['startedAt'] === 'number' ? record['startedAt'] : undefined;
      const endedAt = typeof record['endedAt'] === 'number' ? record['endedAt'] : undefined;
      parts.push({
        id: `${messageId}:reasoning:${reasoningCounter}`,
        type: 'reasoning',
        text,
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(endedAt !== undefined ? { endedAt } : {}),
      } as ChatReasoningPart);
      reasoningCounter += 1;
      continue;
    }

    if (type === 'text') {
      const text = typeof record['text'] === 'string' ? record['text'] : '';
      if (text.trim().length === 0) continue;
      parts.push({
        id: textCounter === 0 ? `${messageId}:text` : `${messageId}:text:${textCounter}`,
        type: 'text',
        text,
      });
      textCounter += 1;
      continue;
    }

    if (type === 'tool_call') {
      const toolCallId = typeof record['toolCallId'] === 'string' ? record['toolCallId'] : '';
      const toolName = typeof record['toolName'] === 'string' ? record['toolName'] : '';
      const input =
        record['input'] && typeof record['input'] === 'object' && !Array.isArray(record['input'])
          ? (record['input'] as Record<string, unknown>)
          : {};
      if (toolCallId.length > 0) {
        const existingIndex = toolPartIndexByCallId.get(toolCallId);
        const existingPart = existingIndex === undefined ? undefined : parts[existingIndex];
        if (existingPart && existingPart.type === 'tool' && existingIndex !== undefined) {
          // 该 id 已有占位段（孤儿 tool_result 先到）：就地补齐真实名称与入参，
          // 保留结果已写入的 output / status，位置仍是结果到达时的 wire 位置。
          parts[existingIndex] = {
            ...existingPart,
            ...(toolName.length > 0 ? { toolName } : {}),
            input,
          };
          continue;
        }
      }
      // Tool parts default to `running` so a result that hasn't arrived yet
      // (e.g. a snapshot taken mid-execution) does not look "completed".
      // The tool_result branch below upgrades the status when the matching
      // result is present in the same content array.
      parts.push({
        id: toolCallId.length > 0 ? toolCallId : `${messageId}:tool:${parts.length}`,
        type: 'tool',
        toolCallId,
        toolName,
        input,
        status: 'running',
      });
      if (toolCallId.length > 0) {
        toolPartIndexByCallId.set(toolCallId, parts.length - 1);
      }
      continue;
    }

    if (type === 'tool_result') {
      const toolCallId = typeof record['toolCallId'] === 'string' ? record['toolCallId'] : '';
      if (toolCallId.length === 0) continue;
      const isError = record['isError'] === true;
      const pendingPermissionRequestId =
        typeof record['pendingPermissionRequestId'] === 'string'
          ? record['pendingPermissionRequestId']
          : undefined;
      const resumedAfterApproval = record['resumedAfterApproval'] === true;
      const hasPendingPermission = hasActivePendingPermissionRequest({
        isError,
        pendingPermissionRequestId,
        resumedAfterApproval,
      });
      const nextStatus: ChatToolPart['status'] = hasPendingPermission
        ? 'paused'
        : isError
          ? 'failed'
          : 'completed';
      const observability = parseToolCallObservability(record['observability']);
      const fileDiffs = Array.isArray(record['fileDiffs'])
        ? record['fileDiffs'].flatMap((entry) => parseFileDiffContent(entry))
        : undefined;
      // 最终截图（computer_use）只存在于 tool_result 的 attachments 通道，
      // output 里没有；历史加载必须把它带回 tool part，否则刷新后卡片只剩占位。
      const attachments = parseInputImageAttachments(record['attachments']);
      const targetIndex = toolPartIndexByCallId.get(toolCallId);
      if (targetIndex !== undefined) {
        const existing = parts[targetIndex];
        if (existing && existing.type === 'tool') {
          parts[targetIndex] = {
            ...existing,
            output: record['output'],
            isError: hasPendingPermission ? false : isError,
            ...(attachments ? { attachments } : {}),
            ...(observability ? { observability } : {}),
            ...(fileDiffs && fileDiffs.length > 0 ? { fileDiffs } : {}),
            ...(hasPendingPermission && pendingPermissionRequestId
              ? { pendingPermissionRequestId }
              : { pendingPermissionRequestId: undefined }),
            ...(resumedAfterApproval ? { resumedAfterApproval: true } : {}),
            status: nextStatus,
          } satisfies ChatToolPart;
          continue;
        }
      }
      // 孤儿 tool_result：wire 上没有任何前置 tool_call（attach/重连后快照从
      // 工具中段开始）。不能丢弃，否则该工具输出在刷新后消失；在此按 wire
      // 位置补一个占位工具段，`toolName` 沿用未知工具名的回退约定，待后续
      // 同名 tool_call 就地补齐。
      const orphanToolName =
        typeof record['toolName'] === 'string' && record['toolName'].length > 0
          ? record['toolName']
          : 'tool';
      parts.push({
        id: toolCallId,
        type: 'tool',
        toolCallId,
        toolName: orphanToolName,
        input: {},
        output: record['output'],
        isError: hasPendingPermission ? false : isError,
        ...(attachments ? { attachments } : {}),
        ...(observability ? { observability } : {}),
        ...(fileDiffs && fileDiffs.length > 0 ? { fileDiffs } : {}),
        ...(hasPendingPermission && pendingPermissionRequestId
          ? { pendingPermissionRequestId }
          : { pendingPermissionRequestId: undefined }),
        ...(resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        status: nextStatus,
      } satisfies ChatToolPart);
      toolPartIndexByCallId.set(toolCallId, parts.length - 1);
      continue;
    }
  }
  return parts;
}

/**
 * Rebuild an `AssistantTracePayload` from a `parts` array,
 * then serialize it to the `content` JSON string.
 */
export function contentFromParts(
  parts: ChatMessagePart[],
  modifiedFilesSummary?: ModifiedFilesSummaryContent,
): string {
  return contentFromAssistantTraceParts(parts as AssistantTracePart[], modifiedFilesSummary);
}

export function readAssistantTracePayloadFromParts(
  parts: ChatMessagePart[],
  modifiedFilesSummary?: ModifiedFilesSummaryContent,
): AssistantTracePayload {
  return readAssistantTracePayloadFromSharedParts(
    parts.filter(
      (part): part is AssistantTracePart => part.type !== 'event',
    ) as AssistantTracePart[],
    modifiedFilesSummary,
  );
}

export function readAssistantTracePayload(
  message: Pick<ChatMessage, 'content' | 'modifiedFilesSummary' | 'parts' | 'role'>,
): AssistantTracePayload | null {
  if (message.role !== 'assistant') {
    return null;
  }

  if (message.parts && message.parts.some((part) => part.type !== 'event')) {
    return readAssistantTracePayloadFromParts(message.parts, message.modifiedFilesSummary);
  }

  return parseAssistantTraceContent(message.content);
}

/**
 * Merge a live part with its snapshot counterpart (same part ID).
 *
 * The live accumulator and a mid-stream snapshot legitimately disagree on the
 * text of a `text` / `reasoning` part: the snapshot may be taken before the
 * latest deltas landed (snapshot text is a prefix of the live text), or the
 * live part may have been seeded during attach and the snapshot already holds
 * the full segment. Rewinding to the shorter version makes the bubble visibly
 * lose content the user already saw, and — because later deltas then extend
 * whichever part sits at the end of the list — splits one segment into two.
 *
 * Text-bearing parts therefore keep the version that is a prefix-extension of
 * the other, while still inheriting the snapshot's timing metadata so finished
 * reasoning blocks stay marked as ended. Every other part prefers the
 * snapshot, which carries the persisted status / output.
 */
function mergePartWithSnapshot(
  existingPart: ChatMessagePart,
  snapshotPart: ChatMessagePart | undefined,
): ChatMessagePart {
  if (!snapshotPart || snapshotPart.type !== existingPart.type) {
    return snapshotPart ?? existingPart;
  }
  if (existingPart.type === 'text' && snapshotPart.type === 'text') {
    return existingPart.text.startsWith(snapshotPart.text) ? existingPart : snapshotPart;
  }
  if (existingPart.type === 'reasoning' && snapshotPart.type === 'reasoning') {
    const text = existingPart.text.startsWith(snapshotPart.text)
      ? existingPart.text
      : snapshotPart.text;
    return {
      ...existingPart,
      text,
      ...(snapshotPart.startedAt !== undefined ? { startedAt: snapshotPart.startedAt } : {}),
      ...(snapshotPart.endedAt !== undefined ? { endedAt: snapshotPart.endedAt } : {}),
    };
  }
  if (existingPart.type === 'tool' && snapshotPart.type === 'tool') {
    // 快照优先（它有落定后的 status / output），但图片附件不能因此丢失：
    // computer_use 的最终截图只在 attachments 通道，若快照侧缺字段则沿用实时值。
    const snapshotHasAttachments =
      snapshotPart.attachments !== undefined && snapshotPart.attachments.length > 0;
    return {
      ...snapshotPart,
      ...(!snapshotHasAttachments && existingPart.attachments
        ? { attachments: existingPart.attachments }
        : {}),
    };
  }
  return snapshotPart;
}

/**
 * Detect whether the snapshot disagrees with the live accumulator on a
 * `text` / `reasoning` part in a way that proves the *local* slice is stale
 * rather than fresher.
 *
 * `appendStreamingTextDelta` / `appendStreamingThinkingDelta` hand the first
 * `text` slot to whichever segment arrives first, so an attach that starts
 * mid-stream can park a *later* segment under the earliest ID (e.g. live
 * `[tool, "工具之后"]` where `工具之后` holds `${id}:text`, while the snapshot
 * knows `["工具之前", tool, "工具之后"]`). In that shape the snapshot's order
 * is the only correct one and the local order must be discarded.
 *
 * The test is deliberately narrow: the local view is only considered stale when
 * its own text does *not* extend the snapshot's text for the same ID. When it
 * does extend it (`local.startsWith(snapshot)`, i.e. the snapshot was captured
 * before the latest deltas landed), the local order is fresher and must win.
 */
function hasDivergedTextIdentity(
  existingParts: ChatMessagePart[],
  incomingById: Map<string, ChatMessagePart>,
): boolean {
  return existingParts.some((existingPart) => {
    if (existingPart.type !== 'text' && existingPart.type !== 'reasoning') return false;
    const incomingPart = incomingById.get(existingPart.id);
    if (!incomingPart || incomingPart.type !== existingPart.type) return false;
    if (incomingPart.text === existingPart.text) return false;
    return !existingPart.text.startsWith(incomingPart.text);
  });
}

/**
 * Find where `source[index]` belongs inside `target` by scanning outwards in
 * `source` order: right after the nearest part they have in common, otherwise
 * right before it, otherwise appended at the end.
 *
 * This is what keeps a part the two sides disagree about from being dropped or
 * hoisted to the front — it stays anchored to its neighbours.
 */
function resolveInsertionIndex(
  source: ChatMessagePart[],
  target: ChatMessagePart[],
  index: number,
): number {
  for (let probe = index - 1; probe >= 0; probe -= 1) {
    const candidate = source[probe];
    if (!candidate) continue;
    const targetIndex = target.findIndex((entry) => entry.id === candidate.id);
    if (targetIndex >= 0) return targetIndex + 1;
  }
  for (let probe = index + 1; probe < source.length; probe += 1) {
    const candidate = source[probe];
    if (!candidate) continue;
    const targetIndex = target.findIndex((entry) => entry.id === candidate.id);
    if (targetIndex >= 0) return targetIndex;
  }
  return target.length;
}

/**
 * Splice the parts that only the live accumulator knows about (a tool call that
 * just started streaming, an inline event card, …) back into a snapshot-ordered
 * list, using their nearest known local neighbours as anchors.
 *
 * Used when the snapshot proves the local ordering stale: dropping those parts
 * outright would make a freshly started tool card vanish on a soft refresh.
 */
function spliceLocalOnlyParts(
  snapshotOrder: ChatMessagePart[],
  existingParts: ChatMessagePart[],
  incomingIds: ReadonlySet<string>,
): ChatMessagePart[] {
  const merged = snapshotOrder.slice();
  for (let partIndex = 0; partIndex < existingParts.length; partIndex += 1) {
    const part = existingParts[partIndex];
    if (!part || incomingIds.has(part.id)) continue;
    merged.splice(resolveInsertionIndex(existingParts, merged, partIndex), 0, part);
  }
  return merged;
}

/**
 * Reconcile two `parts` arrays using the opencode pattern:
 * find by part ID → replace if exists, push if new.
 *
 * The live accumulator is the only source that knows where a part was actually
 * rendered, so it supplies the skeleton order whenever it is at least as
 * complete as the snapshot. Snapshot-only parts are spliced in between their
 * nearest known neighbours instead of being prepended wholesale — otherwise a
 * segment the gateway persisted late would jump ahead of the text/reasoning the
 * user is already reading.
 */
export function reconcilePartsById(
  existingParts: ChatMessagePart[],
  incomingParts: ChatMessagePart[],
): ChatMessagePart[] {
  const incomingById = new Map(incomingParts.map((part) => [part.id, part]));
  const existingIds = new Set(existingParts.map((part) => part.id));
  const incomingIds = new Set(incomingById.keys());
  const hasSnapshotOnlyPart = incomingParts.some((part) => !existingIds.has(part.id));
  if (hasSnapshotOnlyPart) {
    // A snapshot sharing *no* part ID with the live accumulator is a different
    // identity namespace (the gateway persisted the round under its own IDs and
    // the local placeholders were never adopted), so its order is the only
    // trustworthy one.
    const hasKnownIncomingPart = incomingParts.some((part) => existingIds.has(part.id));
    if (!hasKnownIncomingPart) {
      return incomingParts;
    }
    // The snapshot brings parts the live slice never saw, so it may also know
    // that the local ID assignment is provisional. Defer to its order then,
    // but keep local-only parts anchored where the live view had them.
    if (hasDivergedTextIdentity(existingParts, incomingById)) {
      return spliceLocalOnlyParts(incomingParts, existingParts, incomingIds);
    }
    const merged = existingParts.map((part) =>
      mergePartWithSnapshot(part, incomingById.get(part.id)),
    );
    for (let incomingIndex = 0; incomingIndex < incomingParts.length; incomingIndex += 1) {
      const incomingPart = incomingParts[incomingIndex];
      if (!incomingPart || existingIds.has(incomingPart.id)) continue;
      merged.splice(resolveInsertionIndex(incomingParts, merged, incomingIndex), 0, incomingPart);
    }
    return merged;
  }
  // Same ID set on both sides: keep the live relative order (snapshots may be
  // assembled from independently persisted rows and arrive with a different
  // one) and only adopt the snapshot's content per part.
  return existingParts.map((part) => mergePartWithSnapshot(part, incomingById.get(part.id)));
}

export function parseAssistantTraceContent(content: string): AssistantTracePayload | null {
  return parseSharedAssistantTraceContent(content, {
    hasActivePendingPermissionRequest,
    normalizeReasoningText,
    parseFileDiffContent: (value) => parseFileDiffContent(value),
    parseModifiedFilesSummaryContent,
    parseToolCallObservability,
  });
}
