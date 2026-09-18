/**
 * Media-aware estimation helpers for the char-based token estimators.
 *
 * Provider protocols normalize inlined media (images / audio / video) to a
 * flat per-part token cost regardless of the encoded payload size, but the
 * gateway's `~4 chars/token` estimators used to bill the raw base64 data URL
 * by its encoded length. A single 1.5 MiB PNG becomes a ~2.19M-char data URL
 * and was therefore estimated at ~548K tokens, which fired proactive
 * auto-compaction on the very first round.
 *
 * `stripMediaPayloadsForEstimate` replaces every inlined media payload (data:
 * URL string or `Uint8Array`) with a fixed-length placeholder before the
 * caller serializes the request, so media is billed at `MEDIA_TOKEN_ESTIMATE`
 * while every non-media byte keeps its exact previous accounting.
 */

import { DEFAULT_TOOL_CONTEXT_POLICY } from './tool-context-policy.js';

/** Provider-normalized per-part token ceiling (OpenAI detail:high ~1100, Anthropic ~1600). */
export const MEDIA_TOKEN_ESTIMATE = DEFAULT_TOOL_CONTEXT_POLICY.estimatedImageTokens;
/** Char budget a single inlined media payload contributes to the char-based estimators. */
export const MEDIA_PAYLOAD_CHARS = MEDIA_TOKEN_ESTIMATE * DEFAULT_TOOL_CONTEXT_POLICY.charsPerToken;

const MEDIA_PLACEHOLDER = 'x'.repeat(MEDIA_PAYLOAD_CHARS);

/** Data URL scheme (`data:`), matched case-insensitively per RFC 2397. */
const INLINE_DATA_URL_PATTERN = /^data:/i;

/** True for a string that is an inlined data URL (scheme is case-insensitive). */
export function isInlineMediaPayload(value: unknown): value is string {
  return typeof value === 'string' && INLINE_DATA_URL_PATTERN.test(value);
}

/**
 * Recursively replace inlined media payloads (data: URLs and Uint8Array) with a
 * fixed-length placeholder so length-based estimation bills them at
 * `MEDIA_TOKEN_ESTIMATE` instead of their encoded byte length. Non-media values
 * are preserved value-identically so `JSON.stringify` output length is
 * unchanged for media-free input.
 *
 * The walker keys off the payload shape rather than content type names so it is
 * safe across every provider message shape (native LLM `media.data`, persisted
 * `input_image.imageUrl`, tool-result attachments, ...).
 */
export function stripMediaPayloadsForEstimate(value: unknown): unknown {
  return stripMediaPayload(value, new WeakMap<object, unknown>());
}

function stripMediaPayload(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'string') {
    return isInlineMediaPayload(value) ? MEDIA_PLACEHOLDER : value;
  }
  if (value instanceof Uint8Array) {
    return MEDIA_PLACEHOLDER;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  // Values that own a JSON projection (e.g. `Date`) must be handed to
  // `JSON.stringify` untouched, otherwise the rebuilt estimate would diverge
  // from the raw serialization length for media-free input.
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return value;
  }

  const cached = seen.get(value);
  if (cached !== undefined) {
    return cached;
  }

  if (Array.isArray(value)) {
    const items: unknown[] = [];
    seen.set(value, items);
    for (const item of value) {
      items.push(stripMediaPayload(item, seen));
    }
    return items;
  }

  // Rebuild own enumerable keys in their original order so `JSON.stringify`
  // emits the same key sequence as the untouched input.
  const rebuilt: Record<string, unknown> = {};
  seen.set(value, rebuilt);
  for (const key of Object.keys(value)) {
    rebuilt[key] = stripMediaPayload((value as Record<string, unknown>)[key], seen);
  }
  return rebuilt;
}
