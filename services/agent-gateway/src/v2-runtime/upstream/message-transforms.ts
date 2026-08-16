/**
 * message-transforms — provider-specific normalisation of
 * `Message[]` before they hit OpenCode LLM / upstream providers.
 *
 * Mirrors opencode's `normalizeMessages` (`packages/opencode/src/
 * provider/transform.ts`). The goal is **prefix stability**: any
 * difference in serialised bytes between consecutive turns invalidates
 * Anthropic prompt cache prefixes and tanks cache hit rate. We:
 *
 *   - Sanitise lone UTF-16 surrogate pairs in all text content so the
 *     same logical string always serialises to the same bytes.
 *   - Drop empty assistant/user messages (Anthropic + Bedrock reject
 *     them) and strip empty `text` / `reasoning` parts inside arrays
 *     before they reach OpenCode LLM.
 *   - Scrub `[^a-zA-Z0-9_-]` from `toolCallId` for Claude-family
 *     models, so retried/relayed tool ids do not break tool_use ↔
 *     tool_result pairing or hash differently across rounds.
 *   - Reorder assistant turns where a `tool-call` is followed by
 *     non-tool content (e.g. `[tool-call, tool-call, text]`) into
 *     `[text]` + `[tool-call, tool-call]` to satisfy Anthropic's
 *     "tool_use ids found without tool_result blocks immediately
 *     after" rule.
 *   - Apply Mistral/Devstral 9-char alphanumeric tool-id scrub.
 *   - Insert synthetic `assistant: "Done."` between Mistral `tool`
 *     and `user` messages (Mistral API rejects `tool` → `user` sequence).
 *   - Inject empty `reasoning` part on DeepSeek assistant turns.
 */

import { Message, type ContentPart } from '@openAwork/opencode-llm';

type ModelMessage = Message;

interface TargetInput {
  providerType?: string;
  model?: string;
}

function lower(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

function isDeepSeekTarget(input: TargetInput): boolean {
  return lower(input.providerType).includes('deepseek') || lower(input.model).includes('deepseek');
}

function isAnthropicTarget(input: TargetInput): boolean {
  const provider = lower(input.providerType);
  const model = lower(input.model);
  return (
    provider === 'anthropic' ||
    provider === 'claude' ||
    provider === 'google-vertex-anthropic' ||
    model.includes('claude') ||
    model.includes('anthropic')
  );
}

function isBedrockTarget(input: TargetInput): boolean {
  return lower(input.providerType).includes('bedrock');
}

function isClaudeIdTarget(input: TargetInput): boolean {
  const provider = lower(input.providerType);
  const model = lower(input.model);
  return provider === 'anthropic' || provider === 'claude' || model.includes('claude');
}

function isMistralTarget(input: TargetInput): boolean {
  const provider = lower(input.providerType);
  const model = lower(input.model);
  return provider === 'mistral' || model.includes('mistral') || model.includes('devstral');
}

// ─── Surrogate sanitisation (opencode parity) ───
//
// Replace lone/unpaired UTF-16 surrogate code-units with U+FFFD so
// that the same logical string always produces the same serialised
// bytes. Without this, JSON.stringify can emit different escape
// sequences across rounds (e.g. `\uD800` vs `\uFFFD`) which
// silently invalidates Anthropic prompt cache prefixes.
// Mirrors opencode `sanitizeSurrogates` (transform.ts:22-24).

const SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeSurrogates(content: string): string {
  return content.replace(SURROGATE_RE, '\uFFFD');
}

function sanitizeToolResultOutput(part: Extract<ContentPart, { type: 'tool-result' }>): ContentPart {
  switch (part.result.type) {
    case 'text':
    case 'error':
      return typeof part.result.value === 'string'
        ? {
            ...part,
            result: { ...part.result, value: sanitizeSurrogates(part.result.value) },
          }
        : part;
    case 'content':
      return {
        ...part,
        result: {
          ...part.result,
          value: part.result.value.map((item) =>
            item.type === 'text' ? { ...item, text: sanitizeSurrogates(item.text) } : item,
          ),
        },
      };
    case 'json':
      return part;
    default: {
      const exhaustive: never = part.result;
      return exhaustive;
    }
  }
}

function sanitizeAllTextContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    const next = message.content.map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') {
        return { ...part, text: sanitizeSurrogates(part.text) };
      }
      return part.type === 'tool-result' ? sanitizeToolResultOutput(part) : part;
    });
    return Message.make({ ...message, content: next });
  });
}

// ─── Empty-content filtering (Anthropic / Bedrock) ───

function dropEmptyContent(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    const filtered = message.content.filter((part) => {
      return part.type !== 'text' && part.type !== 'reasoning'
        ? true
        : part.text.length > 0;
    });
    if (filtered.length === 0) continue;
    result.push(Message.make({ ...message, content: filtered }));
  }
  return result;
}

// ─── Tool-call id scrubbing ───

function scrubClaudeToolIds(messages: ModelMessage[]): ModelMessage[] {
  const scrub = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return messages.map((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') return message;
    const next = message.content.map((part) => {
      return part.type === 'tool-call' || part.type === 'tool-result'
        ? { ...part, id: scrub(part.id) }
        : part;
    });
    return Message.make({ ...message, content: next });
  });
}

function scrubMistralToolIds(messages: ModelMessage[]): ModelMessage[] {
  const scrub = (id: string): string =>
    id
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 9)
      .padEnd(9, '0');
  return messages.map((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') return message;
    const next = message.content.map((part) => {
      return part.type === 'tool-call' || part.type === 'tool-result'
        ? { ...part, id: scrub(part.id) }
        : part;
    });
    return Message.make({ ...message, content: next });
  });
}

// ─── Anthropic assistant tool_use / text ordering ───
//
// Anthropic rejects assistant turns where `tool_use` blocks are
// followed by non-tool content (`tool_use ids found without
// tool_result blocks immediately after`). Split such turns into a
// text-only message and a tool-call-only message so the SDK serialises
// them in the expected order.
function splitAnthropicAssistantToolCallText(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') return [message];
    const parts = message.content;
    const firstToolCall = parts.findIndex((part) => part.type === 'tool-call');
    if (firstToolCall === -1) return [message];
    const trailing = parts.slice(firstToolCall);
    const trailingHasNonToolCall = trailing.some((part) => part.type !== 'tool-call');
    if (!trailingHasNonToolCall) return [message];
    const nonToolParts = parts.filter((part) => part.type !== 'tool-call');
    const toolParts = parts.filter((part) => part.type === 'tool-call');
    if (nonToolParts.length === 0 || toolParts.length === 0) return [message];
    return [
      Message.make({ ...message, content: nonToolParts }),
      Message.make({ ...message, content: toolParts }),
    ];
  });
}

// ─── Mistral tool→user interleave ───
//
// Mistral API rejects a `tool` message followed directly by a `user`
// message. Insert a synthetic `assistant: "Done."` between them.
// Mirrors opencode transform.ts:257-268.
function interleaveMistralToolUser(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    result.push(msg);
    const nextMsg = messages[i + 1];
    if (msg.role === 'tool' && nextMsg?.role === 'user') {
      result.push(Message.assistant('Done.'));
    }
  }
  return result;
}

// ─── DeepSeek reasoning placeholder ───

function withDeepSeekReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    if (message.content.some((part) => part.type === 'reasoning')) return message;
    return Message.make({
      ...message,
      content: [...message.content, { type: 'reasoning', text: '' }],
    });
  });
}

// ─── Public entry point ───

export function applyProviderMessageTransforms(
  messages: ModelMessage[],
  input: TargetInput,
): ModelMessage[] {
  // Surrogate sanitisation runs first on ALL messages (opencode parity).
  // This ensures byte-identical serialisation regardless of how the
  // upstream stream encoded lone surrogates.
  let next = sanitizeAllTextContent(messages);

  if (isAnthropicTarget(input) || isBedrockTarget(input)) {
    next = dropEmptyContent(next);
  }

  if (isClaudeIdTarget(input)) {
    next = scrubClaudeToolIds(next);
  }

  if (isAnthropicTarget(input)) {
    next = splitAnthropicAssistantToolCallText(next);
  }

  if (isMistralTarget(input)) {
    next = scrubMistralToolIds(next);
    next = interleaveMistralToolUser(next);
  }

  if (isDeepSeekTarget(input)) {
    next = withDeepSeekReasoning(next);
  }

  return next;
}
