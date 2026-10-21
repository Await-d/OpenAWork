import { Schema } from 'effect';
import {
  LLMError,
  ProviderErrorEvent,
  type ProviderFailureClassification,
} from './schema/index.js';

const patterns = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  // Cloudflare Workers AI 以 HTTP 413 上报该措辞。
  /exceeded this model context window limit/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  // Amazon Nova on Bedrock 以流中 validationException 上报。
  /number of input tokens exceeds maximum length/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  // DeepInfra
  /requested input length \d+ exceeds maximum input length/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  // Novita 省略 token 计数。
  /input(?: \(\d+ tokens\))? is longer than the model'?s context length/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  // Hugging Face Text Generation Inference，例如 Together。
  /`inputs` tokens \+ `max_new_tokens` must be <= \d+/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  // Z.ai code 1261 以 `Prompt too long` 或 `Prompt 超长` 到达。
  /prompt (?:too long|超长)/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /range of input length should be/i,
  /too many tokens/i,
  /token limit exceeded/i,
];

const exclusions = [
  /^(throttling error|service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
  // Cohere 把「输出上限高于模型上限」也报成 `too many tokens`；压缩上下文无法修复。
  /max[_ ]tokens must be less than/i,
];

// 「请求体过大」与「上下文超限」都会让上游返回 400/413，但**修复手段不同**：前者压缩
// 上下文无用（要缩短单条输入或换路由），后者压缩有效。因此不能混为一类。
// 注意 `request_too_large`（下划线）留在上面的 `patterns` 里——OpenAI 用它表示输入超长。
const payloadPatterns = [/request entity too large/i, /payload too large/i, /request too large/i];

export const isContextOverflow = (message: string) =>
  !exclusions.some((pattern) => pattern.test(message)) &&
  (patterns.some((pattern) => pattern.test(message)) ||
    /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message));

export const isPayloadTooLarge = (message: string) =>
  payloadPatterns.some((pattern) => pattern.test(message));

/**
 * 归一化失败分类，供各协议在构造 `InvalidRequestReason` 时统一调用。
 *
 * 先判上下文超限、再判请求体过大（与上游同序）：413 也可能携带明确的长上下文线索，
 * 而这类失败压缩上下文即可修复，不应因为状态码是 413 就走「请求体过大」的处置路径。
 */
export const providerFailureClassification = (
  message: string,
  status?: number,
): ProviderFailureClassification | undefined => {
  if (isContextOverflow(message)) return 'context-overflow';
  if (status === 413 || isPayloadTooLarge(message)) return 'payload-too-large';
  return undefined;
};

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === 'InvalidRequest' &&
      failure.reason.classification === 'context-overflow'
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === 'context-overflow';

// Provider error bodies arrive as JSON text. Some gateways escape non-ASCII
// characters (`{"error":{"message":"\u5168\u5C40..."}}`), so embedding the raw
// body into a user-facing message leaks literal `\uXXXX` sequences into the UI.
// `Message`（首字母大写）是 AWS 系服务的错误体布局（对齐 opencode 参考库的
// `messageAt({ Message })` 分支）。
const ERROR_CONTAINER_KEYS = ['error', 'errors', 'detail', 'data', 'Message'] as const;
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

/**
 * Extract the structured error message from a response body, or `undefined`
 * when the body carries nothing recognisable.
 *
 * Differs from `providerErrorText`: that one falls back to the raw body so
 * callers always have something to show, while this one keeps "structured" and
 * "unstructured" apart so callers can decide whether echoing the raw body is
 * worth it (HTML error pages, for instance, are not).
 */
export const providerErrorMessage = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  const parsed = tryParseJson(trimmed);
  if (!parsed.ok) return undefined;

  return extractMessage(parsed.value, 0);
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
