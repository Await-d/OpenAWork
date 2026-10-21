import type { ProviderOptions, ReasoningEffort, TextVerbosity } from '../schema/index.js';
import { mergeProviderOptions } from '../schema/index.js';
import type {
  OpenAIImageGenerationToolInput,
  OpenAIResponseIncludable,
  OpenAIServiceTier,
} from '../protocols/utils/openai-options.js';

export type {
  OpenAIImageGenerationToolInput,
  OpenAIResponseIncludable,
  OpenAIServiceTier,
} from '../protocols/utils/openai-options.js';

export interface OpenAIOptionsInput {
  readonly [key: string]: unknown;
  readonly store?: boolean;
  readonly promptCacheKey?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly reasoningSummary?: 'auto';
  // OpenAI Responses `include` wire field. Mirrors the official SDK's
  // `ResponseIncludable[]` union exactly so AI SDK callers and direct
  // native-SDK callers share one shape and no translation is required.
  readonly include?: ReadonlyArray<OpenAIResponseIncludable>;
  readonly textVerbosity?: TextVerbosity;
  readonly serviceTier?: OpenAIServiceTier;
  /**
   * Responses API 的 hosted `image_generation` 工具（`model` 指被调用的生图模型）。
   * 配了它，协议层就会在 `tools` 里追加对应条目；响应侧的
   * `image_generation_call` 解析与 base64 图片输出早已支持。
   */
  readonly imageGenerationTool?: OpenAIImageGenerationToolInput;
}

export type OpenAIProviderOptionsInput = ProviderOptions & {
  readonly openai?: OpenAIOptionsInput;
};

const definedEntries = (input: Record<string, unknown>) =>
  Object.entries(input).filter((entry) => entry[1] !== undefined);

const gpt5DefaultReasoningEffort = (id: string): ReasoningEffort => {
  if (/^gpt-5[.-]5-pro(?:[.-]|$)/.test(id)) return 'high';
  if (/^gpt-5[.-]\d+-pro(?:[.-]|$)/.test(id)) return 'medium';
  const match = /^gpt-5[.-](\d+)(?:[.-]|$)/.exec(id);
  if (!match) return 'medium';
  const version = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(version) && version >= 1 && version <= 4 ? 'none' : 'medium';
};

const openAIProviderOptions = (
  options: OpenAIOptionsInput | undefined,
): ProviderOptions | undefined => {
  const openai = Object.fromEntries(
    definedEntries({
      store: options?.store,
      promptCacheKey: options?.promptCacheKey,
      reasoningEffort: options?.reasoningEffort,
      reasoningSummary: options?.reasoningSummary,
      include: options?.include,
      textVerbosity: options?.textVerbosity,
      serviceTier: options?.serviceTier,
      imageGenerationTool: options?.imageGenerationTool,
    }),
  );
  if (Object.keys(openai).length === 0) return undefined;
  return { openai };
};

export const gpt5DefaultOptions = (modelID: string): ProviderOptions | undefined => {
  const id = modelID.toLowerCase();
  if (!id.includes('gpt-5') || id.includes('gpt-5-chat') || id.includes('gpt-5-pro'))
    return undefined;
  const model = id.slice(id.lastIndexOf('/') + 1);
  return openAIProviderOptions({
    reasoningEffort: gpt5DefaultReasoningEffort(model),
    reasoningSummary: 'auto',
    // GPT-5 reasoning models are configured stateless (`store: false`) by
    // `openAIDefaultOptions` below, so the only way a follow-up turn can
    // carry reasoning state is via the encrypted reasoning include. Without
    // this, callers using the default model facade get reasoning summaries
    // they cannot replay statelessly.
    include: ['reasoning.encrypted_content'],
  });
};

export const openAIDefaultOptions = (modelID: string): ProviderOptions | undefined =>
  mergeProviderOptions(openAIProviderOptions({ store: false }), gpt5DefaultOptions(modelID));

export const withOpenAIOptions = <
  Options extends { readonly providerOptions?: OpenAIProviderOptionsInput },
>(
  modelID: string,
  options: Options,
): Omit<Options, 'providerOptions'> & { readonly providerOptions?: ProviderOptions } => {
  return {
    ...options,
    providerOptions: mergeProviderOptions(openAIDefaultOptions(modelID), options.providerOptions),
  };
};

export * as OpenAIProviderOptions from './openai-options.js';
