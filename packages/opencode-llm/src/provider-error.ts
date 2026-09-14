import { Schema } from 'effect';
import { LLMError, ProviderErrorEvent } from './schema/index.js';

const patterns = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
];

const exclusions = [
  /^(throttling error|service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
];

export const isContextOverflow = (message: string) =>
  !exclusions.some((pattern) => pattern.test(message)) &&
  (patterns.some((pattern) => pattern.test(message)) ||
    /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message));

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === 'InvalidRequest' &&
      failure.reason.classification === 'context-overflow'
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === 'context-overflow';

// Provider error bodies arrive as JSON text. Some gateways escape non-ASCII
// characters (`{"error":{"message":"\u5168\u5C40..."}}`), so embedding the raw
// body into a user-facing message leaks literal `\uXXXX` sequences into the UI.
const ERROR_CONTAINER_KEYS = ['error', 'errors', 'detail', 'data'] as const;
const ERROR_MESSAGE_KEYS = [
  'message',
  'error_description',
  'description',
  'detail',
  'msg',
  'reason',
] as const;
const UNICODE_ESCAPE = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g;
const MAX_MESSAGE_DEPTH = 4;
const MAX_CODE_POINT = 0x10ffff;

export const decodeUnicodeEscapes = (text: string): string =>
  text.replace(UNICODE_ESCAPE, (match, braced: string | undefined, fixed: string | undefined) => {
    const hex = braced ?? fixed;
    if (hex === undefined) return match;
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : match;
  });

const extractMessage = (value: unknown, depth: number): string | undefined => {
  if (depth > MAX_MESSAGE_DEPTH) return undefined;

  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractMessage(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;

  for (const key of ERROR_CONTAINER_KEYS) {
    if (!(key in record)) continue;
    const found = extractMessage(record[key], depth + 1);
    if (found !== undefined) return found;
  }

  for (const key of ERROR_MESSAGE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }

  return undefined;
};

const tryParseJson = (
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
};

// Extract `message` from `{error:{message}}` / `{error:"..."}` / `{message:"..."}`
// / `{errors:[{message}]}`; JSON parsing also decodes the `\uXXXX` escapes.
export const providerErrorText = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';

  const parsed = tryParseJson(trimmed);
  if (parsed.ok) {
    const message = extractMessage(parsed.value, 0);
    if (message !== undefined) return message;
  }

  return decodeUnicodeEscapes(trimmed);
};
