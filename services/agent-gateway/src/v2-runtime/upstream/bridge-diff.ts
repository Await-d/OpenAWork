/**
 * bridge-diff — structural comparison between the legacy
 * `UpstreamRequestBody.messages` (chat-completions / anthropic-messages
 * wire shape) and the AI SDK `ModelMessage[]` produced by
 * `unifiedConversationToModelMessages`.
 *
 * The goal is to validate the bridge in production traffic *without*
 * doubling the LLM cost: callers run the v1 path as usual, then on
 * the side ask this module whether the v2 bridge would have produced
 * a structurally equivalent payload. Differences are surfaced as a
 * compact summary ready for the audit log.
 *
 * Structural fields compared today:
 *   - Message count.
 *   - Role sequence (system / user / assistant / tool).
 *   - Per-message text size (truncated character count) — useful for
 *     spotting silent truncation / token-budget drift.
 *   - Tool-call count on assistant messages.
 *
 * NOT compared (intentional; would require a full schema-aware
 * normaliser and add noise without value):
 *   - Image / file part bytes.
 *   - cache_control or other providerOptions metadata.
 *   - Whitespace / formatting differences inside text.
 *   - Reasoning / thinking blocks (their wire shape varies per
 *     vendor; the v2 path collapses them differently than the v1
 *     ProviderAdapter renderer).
 */

import type { ModelMessage } from 'ai';

export interface BridgeDiffSummary {
  matched: boolean;
  v1Count: number;
  v2Count: number;
  /** Index → reason. Empty when matched === true. */
  diffs: Array<{ index: number; reason: string }>;
}

interface V1WireMessage {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
}

function v1MessageRole(message: V1WireMessage): string {
  return typeof message.role === 'string' ? message.role : 'unknown';
}

function v1MessageTextSize(message: V1WireMessage): number {
  const content = message.content;
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (part && typeof part === 'object' && 'text' in part) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') total += text.length;
    }
  }
  return total;
}

function v1ToolCallCount(message: V1WireMessage): number {
  return Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
}

function v2MessageRole(message: ModelMessage): string {
  return message.role;
}

function v2MessageTextSize(message: ModelMessage): number {
  const content = message.content;
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    if (part && typeof part === 'object' && 'type' in part && part.type === 'text') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') total += text.length;
    }
  }
  return total;
}

function v2ToolCallCount(message: ModelMessage): number {
  if (message.role !== 'assistant') return 0;
  const content = message.content;
  if (!Array.isArray(content)) return 0;
  let count = 0;
  for (const part of content) {
    if (part && typeof part === 'object' && 'type' in part && part.type === 'tool-call') {
      count++;
    }
  }
  return count;
}

/**
 * Structural diff between the v1 wire-format messages array and the
 * v2 AI SDK `ModelMessage[]`. Returns a compact summary suitable for
 * audit-log payloads.
 *
 * The diff is intentionally lossy: only structural mismatches surface
 * as `diffs[]` entries. Identical role / counts / sizes register as
 * `matched: true`.
 */
export function compareV1V2BridgeStructural(
  v1Messages: ReadonlyArray<V1WireMessage>,
  v2Messages: ReadonlyArray<ModelMessage>,
): BridgeDiffSummary {
  const diffs: BridgeDiffSummary['diffs'] = [];
  if (v1Messages.length !== v2Messages.length) {
    diffs.push({
      index: -1,
      reason: `count mismatch: v1=${v1Messages.length} v2=${v2Messages.length}`,
    });
  }

  const compareUpTo = Math.min(v1Messages.length, v2Messages.length);
  for (let i = 0; i < compareUpTo; i++) {
    const v1 = v1Messages[i]!;
    const v2 = v2Messages[i]!;

    const v1Role = v1MessageRole(v1);
    const v2Role = v2MessageRole(v2);
    if (v1Role !== v2Role) {
      diffs.push({ index: i, reason: `role mismatch: v1=${v1Role} v2=${v2Role}` });
    }

    const v1Size = v1MessageTextSize(v1);
    const v2Size = v2MessageTextSize(v2);
    // Allow ±1% drift to absorb whitespace differences from tokenizer
    // cleanups; anything bigger gets reported.
    const tolerance = Math.max(8, Math.ceil(Math.max(v1Size, v2Size) * 0.01));
    if (Math.abs(v1Size - v2Size) > tolerance) {
      diffs.push({
        index: i,
        reason: `text size drift: v1=${v1Size} v2=${v2Size}`,
      });
    }

    const v1Calls = v1ToolCallCount(v1);
    const v2Calls = v2ToolCallCount(v2);
    if (v1Calls !== v2Calls) {
      diffs.push({
        index: i,
        reason: `tool call count drift: v1=${v1Calls} v2=${v2Calls}`,
      });
    }
  }

  return {
    matched: diffs.length === 0,
    v1Count: v1Messages.length,
    v2Count: v2Messages.length,
    diffs,
  };
}
