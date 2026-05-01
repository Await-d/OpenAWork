/**
 * Bridge — translate OpenAWork's `NormalizedConversationMessage[]`
 * (the gateway's internal canonical conversation format) into the AI
 * SDK's `ModelMessage[]` shape.
 *
 * The mapping is intentionally lossless for the canonical roles:
 *   - `system` / `user` → identical strings in both formats.
 *   - `assistant` text + tool calls → `AssistantContent` array with
 *     `TextPart` + `ToolCallPart` entries; `reasoning.text` is folded
 *     into a leading `ReasoningPart` when present so providers that
 *     gate on prior thinking content (Anthropic, GPT-5) keep working.
 *   - `tool` results → `ToolModelMessage` with a single
 *     `ToolResultPart` and `output: { type: 'text', value }`.
 *
 * Limitations carried over from the source format:
 *   - The normalized shape does not preserve the upstream tool name
 *     for tool results; we fall back to an empty string. Providers
 *     that require it (anthropic_messages) will need richer metadata
 *     in the canonical format before that gap closes.
 *   - Assistant `reasoning.encryptedContent` / `summary` /
 *     `responseId` are dropped — they are vendor-specific transcripts
 *     used by the legacy SSE writer for replay, not by AI SDK.
 */

import type { AssistantModelMessage, ModelMessage, TextPart, ToolCallPart } from 'ai';
import type { NormalizedConversationMessage } from '../../normalized-conversation.js';

/**
 * Minimal structural alias for AI SDK's `ReasoningPart`. The `ai`
 * package does not re-export the full `ReasoningPart` (it lives in
 * `@ai-sdk/provider-utils`); we only need the discriminator and
 * `text` fields when bridging the legacy normalized format, so this
 * structural shape is enough for AssistantContent compatibility.
 */
interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

function safeJsonParse(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Translate a single normalized message into one or more AI SDK
 * `ModelMessage`s.
 *
 * The function returns an array because a normalized assistant
 * message that carries both text and tool calls maps cleanly to one
 * AI SDK assistant message; but the API leaves the door open for
 * future cases (e.g. splitting reasoning into a separate message)
 * without changing the call site.
 */
export function normalizedMessageToModelMessages(
  message: NormalizedConversationMessage,
): ModelMessage[] {
  switch (message.role) {
    case 'system':
    case 'user':
      return [{ role: message.role, content: message.content }];
    case 'tool':
      return [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: message.toolCallId,
              toolName: '',
              output: { type: 'text', value: message.content },
            },
          ],
        },
      ];
    case 'assistant': {
      const parts: Array<TextPart | ReasoningPart | ToolCallPart> = [];

      const reasoningText = message.reasoning?.text;
      if (typeof reasoningText === 'string' && reasoningText.length > 0) {
        parts.push({ type: 'reasoning', text: reasoningText });
      }

      if (typeof message.content === 'string' && message.content.length > 0) {
        parts.push({ type: 'text', text: message.content });
      }

      for (const call of message.toolCalls ?? []) {
        parts.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: safeJsonParse(call.arguments),
        });
      }

      // AssistantContent must be a non-empty string OR an array. Empty
      // assistants (no text, no tool calls, no reasoning) are skipped
      // to avoid sending vacuous turns to upstream providers that
      // reject them.
      if (parts.length === 0) {
        return [];
      }

      const assistant: AssistantModelMessage = {
        role: 'assistant',
        content: parts,
      };
      return [assistant];
    }
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * Convert an entire normalized conversation to AI SDK ModelMessages.
 * Empty assistant turns are skipped (see `normalizedMessageToModelMessages`).
 */
export function normalizedConversationToModelMessages(
  messages: NormalizedConversationMessage[],
): ModelMessage[] {
  return messages.flatMap(normalizedMessageToModelMessages);
}
