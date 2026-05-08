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
  /**
   * Provider-specific metadata, namespaced by SDK provider key (e.g.
   * `anthropic`, `bedrock`). Used to carry Anthropic extended-thinking
   * `signature` so the AI SDK serialises a `{type:"thinking", thinking,
   * signature}` block on the wire.
   *
   * Typed loosely as `Record<string, Record<string, string>>` because
   * the only field we currently emit is `signature: string`. The AI
   * SDK's `ProviderOptions` requires `JSONValue` recursively so a
   * fully-typed value would explode this surface; we narrow our local
   * shape to the subset we need and cast at the assignment site.
   */
  providerOptions?: Record<string, Record<string, string>>;
}

interface TextLikePart {
  type: 'text';
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

  // Per-block reasoning has priority — when present, each block is
  // emitted as its own ReasoningPart carrying provider-specific
  // metadata (notably Anthropic's extended-thinking `signature`). Only
  // when `blocks` is absent do we fall back to the aggregated `text`.
  const blocks = message.reasoning?.blocks ?? [];
  const hasBlocks = blocks.length > 0;
  if (hasBlocks) {
    const hasAnySignature = blocks.some(
      (b) => typeof b.signature === 'string' && b.signature.length > 0,
    );
    blocks.forEach((block, index) => {
      const reasoningPart: ReasoningPart = {
        type: 'reasoning',
        text: block.text,
        ...(typeof block.signature === 'string' && block.signature.length > 0
          ? { providerOptions: { anthropic: { signature: block.signature } } }
          : {}),
      };
      parts.push(reasoningPart);
      // Anthropic adaptive thinking emits structural empty-text
      // separators between consecutive signed reasoning blocks. The AI
      // SDK strips empty text, and Anthropic rejects the resulting
      // back-to-back thinking sequence with `tool_use ids found
      // without tool_result blocks`. Insert a single space text part
      // as a separator: it survives the SDK filter and does not alter
      // the surrounding signed thinking bytes. Mirrors opencode
      // message-v2.ts:866-868.
      if (
        hasAnySignature &&
        index < blocks.length - 1 &&
        typeof block.signature === 'string' &&
        block.signature.length > 0
      ) {
        parts.push({ type: 'text', text: ' ' } satisfies TextLikePart);
      }
    });
  } else {
    const reasoningText = message.reasoning?.text;
    const reasoningEncryptedContent = message.reasoning?.encryptedContent;
    const hasReasoningPayload =
      (typeof reasoningText === 'string' && reasoningText.length > 0) ||
      (typeof reasoningEncryptedContent === 'string' && reasoningEncryptedContent.length > 0);
    if (hasReasoningPayload) {
      // Attach Responses-API `encrypted_content` (and optional summary)
      // through the AI SDK's `providerOptions.openai` channel so
      // `@ai-sdk/openai` re-emits the encrypted reasoning item on the
      // next round. Without this, OpenAI rejects multi-turn reasoning
      // continuity with a "missing reasoning replay" 400.
      const openaiOpts =
        typeof reasoningEncryptedContent === 'string' && reasoningEncryptedContent.length > 0
          ? { reasoningEncryptedContent }
          : undefined;
      parts.push({
        type: 'reasoning',
        text: typeof reasoningText === 'string' ? reasoningText : '',
        ...(openaiOpts ? { providerOptions: { openai: openaiOpts } } : {}),
      });
    }
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
  // The local `ReasoningPart` widens `providerOptions` for ergonomics
  // (Record<string, Record<string, string>>); the AI SDK's
  // `AssistantContent` expects the same field typed as
  // `SharedV2ProviderOptions` (deep-JSONValue). Cast at the boundary.
  return [
    {
      role: 'assistant',
      content: parts as unknown as AssistantModelMessage['content'],
    },
  ];
}

function bridgeTool(message: ToolResultMessage): ModelMessage[] {
  return [
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: message.toolCallId,
          toolName: message.toolName ?? '',
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
