import { Schema } from 'effect';
import type {
  LLMRequest,
  ReasoningEffort,
  TextVerbosity as TextVerbosityValue,
} from '../../schema/index.js';
import { ReasoningEfforts, TextVerbosity } from '../../schema/index.js';

export const OpenAIReasoningEfforts = ReasoningEfforts;
export type OpenAIReasoningEffort = (typeof OpenAIReasoningEfforts)[number];

// Mirrors OpenAI's `ResponseIncludable` union from the official SDK. Keep this
// in lockstep with `openai-node/src/resources/responses/responses.ts`.
export const OpenAIResponseIncludables = [
  'file_search_call.results',
  'web_search_call.results',
  'web_search_call.action.sources',
  'message.input_image.image_url',
  'computer_call_output.output.image_url',
  'code_interpreter_call.outputs',
  'reasoning.encrypted_content',
  'message.output_text.logprobs',
] as const;
export type OpenAIResponseIncludable = (typeof OpenAIResponseIncludables)[number];
export const OpenAIServiceTiers = ['auto', 'default', 'flex', 'priority'] as const;
export type OpenAIServiceTier = (typeof OpenAIServiceTiers)[number];

const REASONING_EFFORTS = new Set<string>(ReasoningEfforts);
const OPENAI_REASONING_EFFORTS = new Set<string>(OpenAIReasoningEfforts);
const TEXT_VERBOSITY = new Set<string>(['low', 'medium', 'high']);
const INCLUDABLES = new Set<string>(OpenAIResponseIncludables);
const SERVICE_TIERS = new Set<string>(OpenAIServiceTiers);

export const OpenAIReasoningEffort = Schema.Literals(OpenAIReasoningEfforts);
export const OpenAITextVerbosity = TextVerbosity;
export const OpenAIResponseIncludable = Schema.Literals(OpenAIResponseIncludables);
export const OpenAIServiceTier = Schema.Literals(OpenAIServiceTiers);

const isAnyReasoningEffort = (effort: unknown): effort is ReasoningEffort =>
  typeof effort === 'string' && REASONING_EFFORTS.has(effort);

export const isReasoningEffort = (effort: unknown): effort is OpenAIReasoningEffort =>
  typeof effort === 'string' && OPENAI_REASONING_EFFORTS.has(effort);

const isTextVerbosity = (value: unknown): value is TextVerbosityValue =>
  typeof value === 'string' && TEXT_VERBOSITY.has(value);

const options = (request: LLMRequest) => request.providerOptions?.openai;

export const store = (request: LLMRequest): boolean | undefined => {
  const value = options(request)?.store;
  return typeof value === 'boolean' ? value : undefined;
};

export const reasoningEffort = (request: LLMRequest): ReasoningEffort | undefined => {
  const value = options(request)?.reasoningEffort;
  return isAnyReasoningEffort(value) ? value : undefined;
};

export const reasoningSummary = (request: LLMRequest): 'auto' | undefined =>
  options(request)?.reasoningSummary === 'auto' ? 'auto' : undefined;

// Resolve the OpenAI Responses `include` field. Filters out unknown
// includable values defensively so a typo in upstream config drops the
// invalid entry instead of poisoning the wire body. An empty array (either
// passed directly or produced by filtering) is treated as "no include" and
// returns undefined so the request body omits the field entirely.
export const include = (
  request: LLMRequest,
): ReadonlyArray<OpenAIResponseIncludable> | undefined => {
  const value = options(request)?.include;
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((entry): entry is OpenAIResponseIncludable =>
    INCLUDABLES.has(entry),
  );
  return filtered.length > 0 ? filtered : undefined;
};

// OpenAI limits `prompt_cache_key` to 64 chars; DeepSeek and Zai inherit the
// same limit through their OpenAI-compatible APIs. Clamp with unicode-aware
// slicing so an over-long key surfaces as a truncated cache key instead of an
// HTTP 400 that fails the whole request.
export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

export const promptCacheKey = (request: LLMRequest) => {
  // Caching explicitly disabled: never send a key (it would also enable the
  // provider-side cache the caller asked to skip).
  if (request.cache === 'none') return undefined;
  const value = options(request)?.promptCacheKey;
  if (typeof value !== 'string') return undefined;
  const chars = Array.from(value);
  if (chars.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) return value;
  return chars.slice(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH).join('');
};

export const textVerbosity = (request: LLMRequest) => {
  const value = options(request)?.textVerbosity;
  return isTextVerbosity(value) ? value : undefined;
};

export const serviceTier = (request: LLMRequest) => {
  const value = options(request)?.serviceTier;
  return typeof value === 'string' && SERVICE_TIERS.has(value)
    ? (value as OpenAIServiceTier)
    : undefined;
};

export const instructions = (request: LLMRequest) => {
  const value = options(request)?.instructions;
  return typeof value === 'string' ? value : undefined;
};

/**
 * 对齐参考库：解析 `parallel_tool_calls`——显式配置优先，其次由
 * `ToolChoice.disableParallelToolUse` 推导；两者都没有时不下发。
 */
export const parallelToolCalls = (request: LLMRequest): boolean | undefined => {
  const configured = options(request)?.['parallelToolCalls'];
  if (typeof configured === 'boolean') return configured;
  const disabled = request.toolChoice?.disableParallelToolUse;
  return disabled === undefined ? undefined : !disabled;
};

/** 对齐参考库：Responses 的 `max_tool_calls`（单次响应内工具调用上限）。 */
export const maxToolCalls = (request: LLMRequest): number | undefined => {
  const value = options(request)?.['maxToolCalls'];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
};

export * as OpenAIOptions from './openai-options.js';
