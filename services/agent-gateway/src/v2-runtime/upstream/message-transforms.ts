/**
 * message-transforms — provider-specific normalisation of
 * `ModelMessage[]` before they hit AI SDK / upstream providers.
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
 *     before they reach the AI SDK.
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

import type { ModelMessage } from 'ai';

type ContentPart = Record<string, unknown>;

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

function isRecord(value: unknown): value is ContentPart {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function sanitizeToolResultOutput(part: ContentPart): ContentPart {
  if (part['type'] === 'tool-result') {
    const output = part['output'];
    if (isRecord(output)) {
      if (output['type'] === 'text' || output['type'] === 'error-text') {
        const value = output['value'];
        if (typeof value === 'string') {
          return { ...part, output: { ...output, value: sanitizeSurrogates(value) } };
        }
      }
      if (output['type'] === 'content' && Array.isArray(output['value'])) {
        return {
          ...part,
          output: {
            ...output,
            value: output['value'].map((item: unknown) => {
              if (isRecord(item) && item['type'] === 'text' && typeof item['text'] === 'string') {
                return { ...item, text: sanitizeSurrogates(item['text']) };
              }
              return item;
            }),
          },
        };
      }
    }
  }
  return part;
}

function sanitizeAllTextContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    const content = message.content as unknown;
    // String content — system / user / assistant
    if (typeof content === 'string') {
      return { ...message, content: sanitizeSurrogates(content) } as ModelMessage;
    }
    if (!Array.isArray(content)) return message;
    // Array content — assistant / tool / user with parts
    const next = content.map((part) => {
      if (!isRecord(part)) return part;
      const type = part['type'];
      // text / reasoning parts
      if (type === 'text' || type === 'reasoning') {
        const text = part['text'];
        if (typeof text === 'string') {
          return { ...part, text: sanitizeSurrogates(text) };
        }
      }
      // tool-result parts
      return sanitizeToolResultOutput(part);
    });
    return { ...message, content: next } as ModelMessage;
  });
}

// ─── Empty-content filtering (Anthropic / Bedrock) ───

function dropEmptyContent(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    const content = message.content as unknown;
    if (typeof content === 'string') {
      if (content.length === 0) continue;
      result.push(message);
      continue;
    }
    if (!Array.isArray(content)) {
      result.push(message);
      continue;
    }
    const filtered = content.filter((part) => {
      if (!isRecord(part)) return true;
      const type = part['type'];
      if (type === 'text' || type === 'reasoning') {
        const text = part['text'];
        return typeof text === 'string' && text.length > 0;
      }
      return true;
    });
    if (filtered.length === 0) continue;
    result.push({ ...message, content: filtered } as ModelMessage);
  }
  return result;
}

// ─── Tool-call id scrubbing ───

function scrubClaudeToolIds(messages: ModelMessage[]): ModelMessage[] {
  const scrub = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    if (message.role !== 'assistant' && message.role !== 'tool') return message;
    const next = message.content.map((part) => {
      if (!isRecord(part)) return part;
      const type = part['type'];
      if (type === 'tool-call' || type === 'tool-result') {
        const id = part['toolCallId'];
        if (typeof id === 'string') {
          return { ...part, toolCallId: scrub(id) };
        }
      }
      return part;
    });
    return { ...message, content: next } as ModelMessage;
  });
}

function scrubMistralToolIds(messages: ModelMessage[]): ModelMessage[] {
  const scrub = (id: string): string =>
    id
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 9)
      .padEnd(9, '0');
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    if (message.role !== 'assistant' && message.role !== 'tool') return message;
    const next = message.content.map((part) => {
      if (!isRecord(part)) return part;
      const type = part['type'];
      if (type === 'tool-call' || type === 'tool-result') {
        const id = part['toolCallId'];
        if (typeof id === 'string') {
          return { ...part, toolCallId: scrub(id) };
        }
      }
      return part;
    });
    return { ...message, content: next } as ModelMessage;
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
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return [message];
    const parts = message.content;
    const firstToolCall = parts.findIndex((part) => isRecord(part) && part['type'] === 'tool-call');
    if (firstToolCall === -1) return [message];
    const trailing = parts.slice(firstToolCall);
    const trailingHasNonToolCall = trailing.some(
      (part) => !isRecord(part) || part['type'] !== 'tool-call',
    );
    if (!trailingHasNonToolCall) return [message];
    const nonToolParts = parts.filter((part) => !isRecord(part) || part['type'] !== 'tool-call');
    const toolParts = parts.filter((part) => isRecord(part) && part['type'] === 'tool-call');
    if (nonToolParts.length === 0 || toolParts.length === 0) return [message];
    return [
      { ...message, content: nonToolParts } as ModelMessage,
      { ...message, content: toolParts } as ModelMessage,
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
      result.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Done.' }],
      } as ModelMessage);
    }
  }
  return result;
}

// ─── DeepSeek reasoning placeholder ───

function withDeepSeekReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const content = message.content;
    if (Array.isArray(content)) {
      if (content.some((part) => isRecord(part) && part['type'] === 'reasoning')) return message;
      return { ...message, content: [...content, { type: 'reasoning', text: '' }] } as ModelMessage;
    }
    if (typeof content === 'string') {
      return {
        ...message,
        content: [
          ...(content.length > 0 ? [{ type: 'text', text: content }] : []),
          { type: 'reasoning', text: '' },
        ],
      } as ModelMessage;
    }
    return { ...message, content: [{ type: 'reasoning', text: '' }] } as ModelMessage;
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
