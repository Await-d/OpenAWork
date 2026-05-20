/**
 * Message Grouping — Group messages by API round.
 *
 * Modeled after Claude Code's `services/compact/grouping.ts`.
 *
 * An "API round" is defined as:
 * - Group 0: All messages before the first assistant message (preamble)
 * - Group N: An assistant message + the following user message(s) that
 *   contain tool_results for that assistant's tool_calls
 *
 * Used by reactive compact to drop entire rounds from the head when
 * the context exceeds the provider's limit.
 */

import type { Message } from '@openAwork/shared';

/**
 * Group messages by API round.
 *
 * Returns an array of groups, where each group is an array of messages
 * that belong to the same logical API round.
 *
 * Group 0 = preamble (everything before the first assistant message)
 * Group N = assistant message + its tool_result responses
 */
export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  if (messages.length === 0) return [];

  const groups: Message[][] = [];
  let currentGroup: Message[] = [];

  for (const message of messages) {
    if (message.role === 'assistant' && currentGroup.length > 0) {
      // Start a new group at each assistant message (except the first group)
      groups.push(currentGroup);
      currentGroup = [message];
    } else {
      currentGroup.push(message);
    }
  }

  // Push the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Estimate token count for a group of messages.
 */
export function estimateGroupTokens(group: Message[]): number {
  let total = 0;
  for (const message of group) {
    for (const content of message.content) {
      switch (content.type) {
        case 'text':
          total += Math.ceil(content.text.length / 4);
          break;
        case 'reasoning':
          total += Math.ceil((content.text ?? '').length / 4);
          break;
        case 'tool_call':
          total += Math.ceil(
            (content.toolCallId.length +
              (content.toolName?.length ?? 0) +
              JSON.stringify(content.input ?? {}).length) /
              4,
          );
          break;
        case 'tool_result':
          total += Math.ceil(
            (content.toolCallId.length +
              (typeof content.output === 'string' ? content.output.length : 0)) /
              4,
          );
          break;
        default:
          try {
            total += Math.ceil(JSON.stringify(content).length / 4);
          } catch {
            // ignore
          }
      }
    }
  }
  return total;
}
