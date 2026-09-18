import type { ChatMessage } from './message-model.js';
import { joinReasoningBlocks } from './message-coercion.js';
import { areSnapshotMessagesEquivalent, hasOverlappingPartIds } from './message-equivalence.js';
import { readAssistantTracePayload } from './trace-codec.js';

/**
 * When a stream finishes (onDone), the finalized assistant message should replace
 * any pre-existing partial assistant message from the snapshot rather than being
 * appended as a duplicate.
 *
 * Primary: uses part IDs for matching (opencode pattern).
 * Fallback: uses tool-call overlap, text-prefix, or reasoning-prefix heuristics.
 */
export function replaceOrAppendStreamedAssistantMessage(
  previousMessages: ChatMessage[],
  onDoneMessage: ChatMessage,
  streamToolCallIds: ReadonlySet<string>,
): ChatMessage[] {
  const exactIndex = previousMessages.findIndex((message) => message.id === onDoneMessage.id);
  if (exactIndex >= 0) {
    return [
      ...previousMessages.slice(0, exactIndex),
      onDoneMessage,
      ...previousMessages.slice(exactIndex + 1),
    ];
  }

  // Scan the most recent assistant messages (not just the very last one)
  // to handle cases where interleaved event cards (permission events,
  // compaction cards, etc.) sit between the streaming placeholder and
  // the final committed message. Only count trace-bearing messages
  // toward the limit so a burst of event cards doesn't exhaust the budget.
  let traceMessagesChecked = 0;
  const maxTraceMessagesToCheck = 5;

  for (let i = previousMessages.length - 1; i >= 0; i--) {
    const msg = previousMessages[i]!;
    if (msg.role === 'user') break;
    if (msg.role !== 'assistant') continue;

    // Primary: check for overlapping part IDs (deterministic, no heuristics).
    if (hasOverlappingPartIds(msg.parts, onDoneMessage.parts)) {
      return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
    }

    // Fallback: heuristic checks for messages without parts.
    const existingTrace = readAssistantTracePayload(msg);
    if (!existingTrace) {
      if (msg.content.trim() === onDoneMessage.content.trim() && onDoneMessage.content.trim()) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }
      continue;
    }

    traceMessagesChecked++;
    if (streamToolCallIds.size > 0) {
      const existingIds = new Set(
        existingTrace.toolCalls.map((tc) => tc.toolCallId).filter(Boolean),
      );
      if ([...streamToolCallIds].some((id) => existingIds.has(id))) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }
    }

    const onDoneTrace = readAssistantTracePayload(onDoneMessage);
    if (onDoneTrace) {
      // Text prefix match.
      const existingText = existingTrace.text.trim();
      const onDoneText = onDoneTrace.text.trim();
      if (
        existingText.length > 0 &&
        onDoneText.length >= existingText.length &&
        onDoneText.startsWith(existingText)
      ) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }

      // Reasoning block prefix match.
      const existingReasoning = joinReasoningBlocks(existingTrace.reasoningBlocks);
      const onDoneReasoning = joinReasoningBlocks(onDoneTrace.reasoningBlocks);
      if (
        existingReasoning.length > 0 &&
        onDoneReasoning.length >= existingReasoning.length &&
        onDoneReasoning.startsWith(existingReasoning)
      ) {
        return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
      }
    }

    // Also check snapshot equivalence as a last-resort fallback — handles
    // the race between finalizeStreamMessage (local ID) and a subsequent
    // reload that already replaced the message with the server version.
    if (areSnapshotMessagesEquivalent(msg, onDoneMessage)) {
      return [...previousMessages.slice(0, i), onDoneMessage, ...previousMessages.slice(i + 1)];
    }

    if (traceMessagesChecked >= maxTraceMessagesToCheck) break;
  }

  // 追加新消息，但先检查是否已经存在相同 ID
  const result = [...previousMessages, onDoneMessage];

  // 去重：如果 onDoneMessage.id 已经存在，移除旧的
  const seen = new Set<string>();
  const deduplicated: ChatMessage[] = [];
  for (const message of result) {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      deduplicated.push(message);
    }
  }

  return deduplicated;
}
