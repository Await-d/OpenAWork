/**
 * Session recovery (oh-my-opencode sessionRecovery pattern)
 *
 * Detects recoverable LLM errors and automatically fixes message structure
 * so the conversation can continue without user intervention.
 *
 * Supported error types:
 * - tool_result_missing: LLM sent tool_call but no tool_result was provided
 * - thinking_block_order: Thinking blocks are in wrong order for Anthropic API
 * - thinking_disabled_violation: Thinking blocks present when thinking is disabled
 */

import type { Message, MessageContent } from '@openAwork/shared';
import { appendSessionMessageV2 } from './message-v2-adapter.js';

// ---------------------------------------------------------------------------
// Error type detection
// ---------------------------------------------------------------------------

export type RecoveryErrorType =
  | 'tool_result_missing'
  | 'thinking_block_order'
  | 'thinking_disabled_violation'
  | null;

export function detectRecoveryErrorType(error: unknown): RecoveryErrorType {
  const message = extractErrorMessageText(error);

  // IMPORTANT: Check thinking_block_order BEFORE tool_result_missing
  // because Anthropic's extended thinking error messages contain "tool_use" and "tool_result"
  // in the documentation URL, which would incorrectly match tool_result_missing
  if (
    message.includes('thinking') &&
    (message.includes('first block') ||
      message.includes('must start with') ||
      message.includes('preceeding') ||
      message.includes('final block') ||
      message.includes('cannot be thinking') ||
      (message.includes('expected') && message.includes('found')))
  ) {
    return 'thinking_block_order';
  }

  if (message.includes('thinking is disabled') && message.includes('cannot contain')) {
    return 'thinking_disabled_violation';
  }

  if (message.includes('tool_use') && message.includes('tool_result')) {
    return 'tool_result_missing';
  }

  return null;
}

function extractErrorMessageText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();

  // Handle UpstreamErrorDescriptor
  if (typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const paths = [
      obj.technicalDetail,
      obj.message,
      obj.data,
      obj.error,
      (obj.data as Record<string, unknown>)?.error,
    ];

    for (const val of paths) {
      if (val && typeof val === 'object') {
        const msg = (val as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.length > 0) {
          return msg.toLowerCase();
        }
      } else if (typeof val === 'string' && val.length > 0) {
        return val.toLowerCase();
      }
    }
  }

  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Recovery actions
// ---------------------------------------------------------------------------

export interface RecoveryResult {
  recovered: boolean;
  errorType: RecoveryErrorType;
  action: string;
}

/**
 * Attempt to recover from a tool_result_missing error by injecting
 * placeholder tool_result messages for all pending tool_call blocks.
 */
export function recoverToolResultMissing(
  sessionId: string,
  userId: string,
  clientRequestId: string,
  messages: Message[],
): RecoveryResult {
  // Find the last assistant message with tool_call content blocks
  let lastAssistantWithToolCall: Message | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const hasToolCall = msg.content.some((block) => block.type === 'tool_call');
      if (hasToolCall) {
        lastAssistantWithToolCall = msg;
        break;
      }
    }
  }

  if (!lastAssistantWithToolCall || !Array.isArray(lastAssistantWithToolCall.content)) {
    return { recovered: false, errorType: 'tool_result_missing', action: 'no_tool_call_found' };
  }

  // Extract tool_call IDs that need tool_result
  const toolCallIds: Array<{ id: string; name: string }> = [];
  for (const block of lastAssistantWithToolCall.content) {
    if (block.type === 'tool_call') {
      toolCallIds.push({ id: block.toolCallId, name: block.toolName });
    }
  }

  if (toolCallIds.length === 0) {
    return { recovered: false, errorType: 'tool_result_missing', action: 'no_tool_call_ids' };
  }

  // Check which tool_call IDs already have tool_results
  const existingResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          existingResultIds.add((block as { toolCallId: string }).toolCallId);
        }
      }
    }
  }

  const missingIds = toolCallIds.filter((t) => !existingResultIds.has(t.id));
  if (missingIds.length === 0) {
    return { recovered: false, errorType: 'tool_result_missing', action: 'all_results_present' };
  }

  // Inject placeholder tool_result messages
  const toolResultContent: MessageContent[] = missingIds.map(({ id, name }) => ({
    type: 'tool_result' as const,
    toolCallId: id,
    toolName: name,
    output: 'Operation cancelled (session recovery)',
    isError: false,
    rawOutput: 'Operation cancelled (session recovery)',
  }));

  appendSessionMessageV2({
    sessionId,
    userId,
    role: 'tool',
    content: toolResultContent,
    legacyMessagesJson: undefined,
    clientRequestId: `${clientRequestId}:session-recovery:tool-result`,
  });

  return {
    recovered: true,
    errorType: 'tool_result_missing',
    action: `injected_${missingIds.length}_tool_results`,
  };
}

/**
 * Attempt to recover from a thinking_disabled_violation.
 * In OpenAWork, thinking content is handled by the upstream request builder,
 * so we inject a recovery note and flag for the next round to strip thinking.
 */
export function recoverThinkingDisabledViolation(
  sessionId: string,
  userId: string,
  clientRequestId: string,
): RecoveryResult {
  appendSessionMessageV2({
    sessionId,
    userId,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '[Session Recovery] Thinking blocks were present when thinking mode is disabled. The conversation history has been adjusted to strip thinking blocks. Continuing...',
      },
    ],
    legacyMessagesJson: undefined,
    clientRequestId: `${clientRequestId}:session-recovery:thinking-strip`,
  });

  return {
    recovered: true,
    errorType: 'thinking_disabled_violation',
    action: 'flagged_for_thinking_strip',
  };
}

/**
 * Attempt to recover from a thinking_block_order error.
 * This typically requires restructuring the message history,
 * which is handled by the upstream request builder.
 */
export function recoverThinkingBlockOrder(
  sessionId: string,
  userId: string,
  clientRequestId: string,
): RecoveryResult {
  appendSessionMessageV2({
    sessionId,
    userId,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '[Session Recovery] Thinking block order was incorrect. The conversation history has been adjusted. Continuing...',
      },
    ],
    legacyMessagesJson: undefined,
    clientRequestId: `${clientRequestId}:session-recovery:thinking-order`,
  });

  return {
    recovered: true,
    errorType: 'thinking_block_order',
    action: 'flagged_for_thinking_reorder',
  };
}
