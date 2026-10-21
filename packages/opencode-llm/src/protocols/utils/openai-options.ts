import { Schema } from 'effect';
import type {
  LLMRequest,
  ReasoningEffort,
  TextVerbosity as TextVerbosityValue,
} from '../../schema/index.js';
import { ReasoningEfforts, TextVerbosity } from '../../schema/index.js';

export const OpenAIReasoningEfforts = ReasoningEfforts;
// 供应商自定义档位：已知值只作补全，运行期接受任意字符串（对齐上游 OpenString）。
export type OpenAIReasoningEffort = (typeof OpenAIReasoningEfforts)[number] | (string & {});

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
// 对齐官方 SDK 的 `ServiceTier`：在基础档位之后追加 scale / fast / ultrafast。
// 上游（对齐参考库）的 schema 对 service tier 是「任意字符串都接受」，本地保留白名单
// 校验——未知档位不转发，避免把拼写错误原样发给上游。
export const OpenAIServiceTiers = [
  'auto',
  'default',
  'flex',
  'priority',
  'scale',
  'fast',
  'ultrafast',
] as const;
export type OpenAIServiceTier = (typeof OpenAIServiceTiers)[number];

const REASONING_EFFORTS = new Set<string>(ReasoningEfforts);
const OPENAI_REASONING_EFFORTS = new Set<string>(OpenAIReasoningEfforts);
const TEXT_VERBOSITY = new Set<string>(['low', 'medium', 'high']);
const INCLUDABLES = new Set<string>(OpenAIResponseIncludables);
const SERVICE_TIERS = new Set<string>(OpenAIServiceTiers);

// 供应商自定义档位：已知值只作补全与白名单校验（见 `isReasoningEffort`），
// 运行期接受任意字符串（对齐上游 `Schema.declare`）。
export const OpenAIReasoningEffort = Schema.declare<OpenAIReasoningEffort>(
  (value): value is OpenAIReasoningEffort => typeof value === 'string',
  { title: 'OpenAIReasoningEffort' },
);
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

// ---------------------------------------------------------------------------
// Responses hosted 工具：image_generation
// ---------------------------------------------------------------------------

export const OpenAIImageGenerationQualities = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const OpenAIImageGenerationBackgrounds = ['auto', 'opaque', 'transparent'] as const;
export const OpenAIImageGenerationFormats = ['png', 'jpeg', 'webp'] as const;
export const OpenAIImageGenerationModerations = ['auto', 'low'] as const;
export const OpenAIImageGenerationActions = ['auto', 'generate', 'edit'] as const;

/**
 * hosted `image_generation` 工具的配置（camelCase，下发时由协议层转 snake_case）。
 * `model` 是**被调用的生图模型**，与顶层主模型是两回事——必填。
 */
export interface OpenAIImageGenerationToolInput {
  readonly action?: (typeof OpenAIImageGenerationActions)[number];
  readonly background?: (typeof OpenAIImageGenerationBackgrounds)[number];
  readonly model: string;
  readonly moderation?: (typeof OpenAIImageGenerationModerations)[number];
  readonly outputCompression?: number;
  readonly outputFormat?: (typeof OpenAIImageGenerationFormats)[number];
  readonly partialImages?: number;
  readonly quality?: (typeof OpenAIImageGenerationQualities)[number];
  readonly size?: string;
}

const pickLiteral = <T extends string>(value: unknown, allowed: ReadonlyArray<T>): T | undefined =>
  typeof value === 'string' && (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : undefined;

const pickInteger = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;

/**
 * 读取并校验 hosted 生图工具配置。
 *
 * 只白名单转发已知字段：`providerOptions` 可能来自用户手写的 provider 配置，
 * 把拼错的字段原样送上 Responses 会得到一个 400，而且报错信息指不回配置本身。
 * 缺 `model` 时整体返回 `undefined`（不下发该工具）而不是降级成一个裸工具——
 * 官方对 `model` 是必填的。
 */
export const imageGenerationTool = (
  request: LLMRequest,
): OpenAIImageGenerationToolInput | undefined => {
  const value = options(request)?.imageGenerationTool;
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const model = typeof record['model'] === 'string' ? record['model'].trim() : '';
  if (!model) {
    return undefined;
  }

  const quality = pickLiteral(record['quality'], OpenAIImageGenerationQualities);
  const background = pickLiteral(record['background'], OpenAIImageGenerationBackgrounds);
  const outputFormat = pickLiteral(record['outputFormat'], OpenAIImageGenerationFormats);
  const moderation = pickLiteral(record['moderation'], OpenAIImageGenerationModerations);
  const action = pickLiteral(record['action'], OpenAIImageGenerationActions);
  const outputCompression = pickInteger(record['outputCompression'], 0, 100);
  const partialImages = pickInteger(record['partialImages'], 0, 3);
  const size = typeof record['size'] === 'string' ? record['size'].trim() : '';

  return {
    model,
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
    ...(background ? { background } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(moderation ? { moderation } : {}),
    ...(action ? { action } : {}),
    ...(outputCompression === undefined ? {} : { outputCompression }),
    ...(partialImages === undefined ? {} : { partialImages }),
  };
};

export * as OpenAIOptions from './openai-options.js';
