/**
 * Thinking Block Validator
 *
 * Ported from oh-my-opencode's thinking-block-validator hook.
 * Proactively validates and fixes message structure BEFORE sending to Anthropic API.
 * Prevents "Expected thinking/redacted_thinking but found tool_use" errors.
 *
 * Key difference from session-recovery:
 * - PROACTIVE (prevents error) vs REACTIVE (fixes after error)
 * - Runs BEFORE API call vs AFTER API error
 *
 * In oh-my-opencode this ran on "experimental.chat.messages.transform".
 * In OpenAWork it's called from buildPreparedUpstreamConversation.
 */

/**
 * Check if a model has extended thinking enabled.
 */
export function isExtendedThinkingModel(modelId: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();

  // Explicit thinking/high variants
  if (lower.includes('thinking') || lower.endsWith('-high')) {
    return true;
  }

  // Thinking-capable models (claude-4 family, claude-3)
  return (
    lower.includes('claude-sonnet-4') ||
    lower.includes('claude-opus-4') ||
    lower.includes('claude-3')
  );
}

interface MessagePart {
  type: string;
  thinking?: string;
  text?: string;
  [key: string]: unknown;
}

interface ConversationMessage {
  role: string;
  content?: string | MessagePart[] | unknown[];
  [key: string]: unknown;
}

/**
 * Check if a message has any content parts (tool_use, text, or other non-thinking content).
 */
function hasContentParts(parts: MessagePart[]): boolean {
  if (!parts || parts.length === 0) return false;
  return parts.some((part) => part.type === 'tool_use' || part.type === 'text');
}

/**
 * Check if a message starts with a thinking/reasoning block.
 */
function startsWithThinkingBlock(parts: MessagePart[]): boolean {
  if (!parts || parts.length === 0) return false;
  const firstPart = parts[0]!;
  return firstPart.type === 'thinking' || firstPart.type === 'reasoning';
}

/**
 * Find the most recent thinking content from previous assistant messages.
 */
function findPreviousThinkingContent(
  messages: ConversationMessage[],
  currentIndex: number,
): string {
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;

    const content = msg.content;
    if (!content) continue;

    if (typeof content === 'string') continue;

    const parts = Array.isArray(content) ? (content as MessagePart[]) : [];
    for (const part of parts) {
      if (part.type === 'thinking' || part.type === 'reasoning') {
        const thinking = part.thinking || part.text;
        if (thinking && typeof thinking === 'string' && thinking.trim().length > 0) {
          return thinking;
        }
      }
    }
  }

  return '';
}

/**
 * Prepend a thinking block to a message's content parts.
 */
function prependThinkingBlock(message: ConversationMessage, thinkingContent: string): void {
  const content = message.content;
  if (!content || typeof content === 'string') return;

  const parts = content as MessagePart[];
  const thinkingPart: MessagePart = {
    type: 'thinking',
    thinking: thinkingContent,
    synthetic: true,
  };

  parts.unshift(thinkingPart);
}

/**
 * Validate and fix assistant messages that have tool_use but no thinking block.
 * Call this BEFORE sending messages to the Anthropic API.
 *
 * @returns number of messages fixed
 */
export function validateThinkingBlocks(messages: ConversationMessage[], modelId: string): number {
  if (!isExtendedThinkingModel(modelId)) return 0;
  if (!messages || messages.length === 0) return 0;

  let fixedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;

    const content = msg.content;
    if (!content || typeof content === 'string') continue;

    const parts = Array.isArray(content) ? (content as MessagePart[]) : [];
    if (hasContentParts(parts) && !startsWithThinkingBlock(parts)) {
      const previousThinking = findPreviousThinkingContent(messages, i);
      const thinkingContent = previousThinking || '[Continuing from previous reasoning]';
      prependThinkingBlock(msg, thinkingContent);
      fixedCount++;
    }
  }

  return fixedCount;
}
