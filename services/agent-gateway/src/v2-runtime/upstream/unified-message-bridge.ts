/**
 * unified-message-bridge — translate the gateway's `UnifiedMessage[]`
 * (the post-Phase-A canonical conversation format produced by
 * `message-to-model-messages.ts`) into AI SDK `ModelMessage[]`.
 *
 * Why this bridge is separate from `normalized-message-bridge.ts`:
 *   - The legacy `NormalizedConversationMessage` format pre-dates the
 *     Phase-A migration and uses a string-based assistant content
 *     model with a parallel `toolCalls` field.
 *   - `UnifiedMessage` keeps the same role split but adds optional
 *     `images[]` on user turns and a richer `reasoning` envelope on
 *     assistant turns. We map those extras structurally so the AI SDK
 *     receives the same payload the legacy renderer would have built.
 *
 * Mapping rules:
 *   - `system`           → identical string content.
 *   - `user` (no images) → identical string content.
 *   - `user` (+ images)  → `[TextPart, ...ImagePart]`. Image source
 *                          prefers `imageUrl`; in-memory fileId
 *                          references are dropped (the legacy renderer
 *                          resolves them to URLs upstream).
 *   - `assistant`        → ordered `[ReasoningPart?, TextPart?,
 *                          ToolCallPart...]`. Empty assistant turns
 *                          (no text, no tool calls, no reasoning)
 *                          are skipped — providers reject vacuous
 *                          turns.
 *   - `tool`             → single ToolModelMessage with a textual
 *                          `tool-result` part. `toolName` is left
 *                          empty for now: the unified format does not
 *                          carry it, and Anthropic / chat-completions
 *                          providers match on `toolCallId` alone.
 */

import type {
  AssistantModelMessage,
  ImagePart,
  ModelMessage,
  TextPart,
  ToolCallPart,
  UserModelMessage,
} from 'ai';
import type {
  AssistantMessageUnified,
  SystemMessage,
  ToolResultMessage,
  UnifiedMessage,
  UserMessageUnified,
} from '../../message-to-model-messages.js';

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

function bridgeUser(message: UserMessageUnified): UserModelMessage[] {
  const images = message.images ?? [];
  if (images.length === 0) {
    return [{ role: 'user', content: message.content }];
  }

  const imageParts: ImagePart[] = [];
  for (const image of images) {
    if (typeof image.imageUrl === 'string' && image.imageUrl.length > 0) {
      imageParts.push({
        type: 'image',
        image: image.imageUrl,
        ...(image.mimeType ? { mediaType: image.mimeType } : {}),
      });
    }
  }

  // No usable image references — fall back to the bare text turn so we
  // do not synthesise a single-text-part array (which is structurally
  // identical but heavier on the wire).
  if (imageParts.length === 0) {
    return [{ role: 'user', content: message.content }];
  }

  const parts: Array<TextPart | ImagePart> = [];
  if (message.content && message.content.length > 0) {
    parts.push({ type: 'text', text: message.content });
  }
  parts.push(...imageParts);
  return [{ role: 'user', content: parts }];
}

function bridgeAssistant(message: AssistantMessageUnified): AssistantModelMessage[] {
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

  if (parts.length === 0) {
    return [];
  }
  return [{ role: 'assistant', content: parts }];
}

function bridgeTool(message: ToolResultMessage): ModelMessage[] {
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
}

function bridgeSystem(message: SystemMessage): ModelMessage[] {
  return [{ role: 'system', content: message.content }];
}

/**
 * Convert a single `UnifiedMessage` into one or more AI SDK
 * `ModelMessage`s. Returns an empty array when the message is too
 * vacuous to send upstream (e.g. an assistant turn with no text, no
 * tool calls, and no reasoning).
 */
export function unifiedMessageToModelMessages(message: UnifiedMessage): ModelMessage[] {
  switch (message.role) {
    case 'system':
      return bridgeSystem(message);
    case 'user':
      return bridgeUser(message);
    case 'assistant':
      return bridgeAssistant(message);
    case 'tool':
      return bridgeTool(message);
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      return [];
    }
  }
}

/**
 * Convert an entire unified conversation into AI SDK `ModelMessage[]`.
 * Empty assistant turns are dropped; everything else is preserved.
 */
export function unifiedConversationToModelMessages(messages: UnifiedMessage[]): ModelMessage[] {
  return messages.flatMap(unifiedMessageToModelMessages);
}
