import { buildRequestOverrides, getAllBuiltinPresets } from '@openAwork/agent-core';
import type { AIModelConfig, AIProvider, RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { resolveUpstreamProtocol } from '../routes/upstream-protocol.js';
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';
import { runHookFirst, runHookAll } from './provider-plugin.js';

const BUILTIN_PRESETS = getAllBuiltinPresets();

const DEFAULT_MODEL_SENTINEL = 'default';
const DEFAULT_FALLBACK_MODEL = 'gpt-4o';

/**
 * Must stay large enough for server-assembled delegated prompts, which flow
 * through `streamRequestSchema` too (see `buildDelegatedChildRequestData`).
 * Aligned with the `message` / `displayMessage` limit in `streamRequestSchema`.
 */
export const MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS = 32768;

export const SUPPORTED_MODELS = Object.freeze(
  BUILTIN_PRESETS.flatMap((provider) =>
    provider.defaultModels.filter((model) => model.enabled !== false).map((model) => model.id),
  ),
);

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

/**
 * `ModelRequest.maxTokens` 的 schema 上限。
 *
 * 模型配置里的 `maxOutputTokens`（如 65536 / 131072）通常**大于**该上限，
 * 因此把它用作请求值时必须先收敛，否则 Zod 校验会直接失败。
 */
export const MODEL_REQUEST_MAX_TOKENS_CAP = 16384;

/** 未指定时的默认输出上限（同时是 schema 的 `.default()` 值）。 */
export const MODEL_REQUEST_DEFAULT_MAX_TOKENS = 2048;

export const modelRequestSchema = z.object({
  model: z.string().min(1).max(200).optional().default(DEFAULT_MODEL_SENTINEL),
  variant: z.string().min(1).max(80).optional(),
  systemPrompt: z.string().max(MODEL_REQUEST_SYSTEM_PROMPT_MAX_CHARS).optional(),
  maxTokens: z
    .number()
    .int()
    .min(1)
    .max(MODEL_REQUEST_MAX_TOKENS_CAP)
    .optional()
    .default(MODEL_REQUEST_DEFAULT_MAX_TOKENS),
  temperature: z.number().min(0).max(2).optional().default(1),
});

export type ModelRequest = z.infer<typeof modelRequestSchema>;

export interface ModelRouteConfig {
  model: string;
  providerId?: string;
  variant?: string;
  apiBaseUrl: string;
  apiKey: string;
  openaiFastMode?: boolean;
  contextWindow?: number;
  contextWindowOverride?: number;
  autoCompactThresholdRatio?: number;
  autoCompactTargetRatio?: number;
  /** Model's maximum output token limit (from preset). Used by the
   *  compaction overflow formula to calculate usable input space.
   *  Mirrors opencode's `model.limit.output`. */
  maxOutputTokens?: number;
  maxTokens: number;
  temperature: number;
  upstreamProtocol: UpstreamProtocol;
  requestOverrides: RequestOverrides;
  providerType?: AIProvider['type'];
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
  supportsThinking: boolean;
  systemPrompt?: string;
}

const getOpenAiBaseUrl = (): string =>
  globalThis.process?.env['AI_API_BASE_URL'] ?? 'https://api.openai.com/v1';

const getDefaultApiKey = (): string => globalThis.process?.env['AI_API_KEY'] ?? '';

const BUILTIN_MODEL_INDEX = new Map<
  string,
  {
    model: AIModelConfig;
    provider: AIProvider;
  }
>();

// 首个登记的优先(声明顺序 = catalog 顺序，而非"最后一条胜出")：跨平台存在同 id
// 模型(中转平台如 opencode-go 会转售一手平台的 gpt-5.6-luna / mimo-v2.5)，裸
// modelId 的回退解析必须稳定落在先声明的一手平台，避免被中转平台改写语义。
for (const provider of Object.values(BUILTIN_PRESETS)) {
  for (const model of provider.defaultModels) {
    if (!BUILTIN_MODEL_INDEX.has(model.id)) {
      BUILTIN_MODEL_INDEX.set(model.id, { model, provider });
    }
  }
}

const BUILTIN_PROVIDER_INDEX = new Map<AIProvider['type'], AIProvider>(
  BUILTIN_PRESETS.map((provider) => [provider.type, provider] as const),
);

const normalizeBaseUrl = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) {
    return '';
  }

  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
};

const normalizeRuntimeBaseUrl = (
  providerType: AIProvider['type'] | undefined,
  baseUrl: string,
  upstreamProtocol?: UpstreamProtocol,
): string => {
  if (baseUrl.length === 0) {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    if (providerType === 'openai' && (url.pathname === '/' || url.pathname.length === 0)) {
      url.pathname = '/v1';
      return url.toString().replace(/\/+$/, '');
    }

    if (upstreamProtocol === 'anthropic_messages') {
      const normalizedPath = url.pathname.replace(/\/+$/, '');
      if (normalizedPath.length === 0) {
        url.pathname = '/v1';
        return url.toString().replace(/\/+$/, '');
      }
      if (normalizedPath === '/anthropic') {
        url.pathname = '/anthropic/v1';
        return url.toString().replace(/\/+$/, '');
      }
    }
  } catch {
    return baseUrl;
  }

  return baseUrl;
};

const resolveProviderDefaultBaseUrl = (providerType: AIProvider['type']): string => {
  if (providerType === 'openai') {
    return normalizeRuntimeBaseUrl(providerType, normalizeBaseUrl(getOpenAiBaseUrl()));
  }

  if (providerType === 'anthropic') {
    return normalizeBaseUrl(
      globalThis.process?.env['ANTHROPIC_API_BASE_URL'] ??
        BUILTIN_PROVIDER_INDEX.get('anthropic')?.baseUrl,
    );
  }

  return normalizeBaseUrl(BUILTIN_PROVIDER_INDEX.get(providerType)?.baseUrl);
};

const isOverriddenProviderBaseUrl = (provider: AIProvider): boolean => {
  const providerBaseUrl = normalizeBaseUrl(provider.baseUrl);
  if (providerBaseUrl.length === 0) {
    return false;
  }

  const defaultBaseUrl = resolveProviderDefaultBaseUrl(provider.type);
  return providerBaseUrl !== defaultBaseUrl;
};

const resolveProviderApiKey = (provider: AIProvider): string => {
  if (provider.apiKey) {
    return provider.apiKey;
  }

  if (isOverriddenProviderBaseUrl(provider)) {
    return '';
  }

  if (provider.apiKeyEnv) {
    return globalThis.process?.env[provider.apiKeyEnv] ?? getDefaultApiKey();
  }

  return getDefaultApiKey();
};

const resolveBuiltinFallbackModel = (
  modelId: string,
):
  | {
      model: AIModelConfig;
      provider: AIProvider;
    }
  | undefined => BUILTIN_MODEL_INDEX.get(modelId);

/**
 * Invariant: every outbound model request must pass through the same provider
 * hook chain. `request.headers` / `request.body` are dispatched here so that
 * all route-resolution paths (env fallback, provider selection, compaction)
 * inject identical overrides — new resolution paths must funnel through this
 * helper instead of hand-rolling provider-specific headers/body fields.
 */
const applyProviderRequestHooks = (
  providerType: AIProvider['type'] | undefined,
  provider: AIProvider | undefined,
  modelId: string,
  requestOverrides: RequestOverrides,
): RequestOverrides => {
  if (providerType === undefined || provider === undefined) {
    return requestOverrides;
  }

  // 方案 5：插件注入额外 headers（合并到 requestOverrides.headers）
  const headers: Record<string, string> = { ...(requestOverrides.headers ?? {}) };
  runHookAll('request.headers', providerType, { model: modelId, provider, headers });

  // 方案 5：插件注入额外 body 字段（合并到 requestOverrides.body，最终成为 http.body）
  const body: Record<string, unknown> = { ...(requestOverrides.body ?? {}) };
  runHookAll('request.body', providerType, { model: modelId, provider, body });

  return {
    ...requestOverrides,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(body).length > 0 ? { body } : {}),
  };
};

export function resolveModelRoute(request: ModelRequest): ModelRouteConfig {
  const model =
    request.model === DEFAULT_MODEL_SENTINEL
      ? (globalThis.process?.env['AI_DEFAULT_MODEL'] ?? DEFAULT_FALLBACK_MODEL)
      : request.model;
  const builtinFallback = resolveBuiltinFallbackModel(model);
  const builtinProvider = builtinFallback?.provider;
  const builtinModel = builtinFallback?.model;
  const providerType =
    builtinProvider?.type ?? (model.startsWith('claude') ? 'anthropic' : undefined);
  // 未命中内置模型索引的模型（如 `claude-*` 变体）没有 provider 实例，退回平台预设
  // 作为 hook 上下文，保证 header/body 注入与其它解析路径一致。
  const pluginProvider =
    builtinProvider ??
    (providerType === undefined ? undefined : BUILTIN_PROVIDER_INDEX.get(providerType));
  const requestOverrides = applyProviderRequestHooks(
    providerType,
    pluginProvider,
    model,
    buildRequestOverrides(undefined, undefined, model),
  );
  const isAnthropic = providerType === 'anthropic';
  const rawApiBaseUrl = normalizeBaseUrl(
    (builtinProvider ? resolveProviderDefaultBaseUrl(builtinProvider.type) : undefined) ??
      (isAnthropic
        ? (globalThis.process?.env['ANTHROPIC_API_BASE_URL'] ?? 'https://api.anthropic.com/v1')
        : getOpenAiBaseUrl()),
  );

  // 方案 5：插件优先解析协议，fallback 到原有逻辑
  const upstreamProtocol =
    (providerType && builtinProvider
      ? runHookFirst('resolve.protocol', providerType, {
          model,
          provider: builtinProvider,
          baseUrl: rawApiBaseUrl,
        })
      : undefined) ?? resolveUpstreamProtocol({ model, providerType, baseUrl: rawApiBaseUrl });
  const apiBaseUrl = normalizeRuntimeBaseUrl(providerType, rawApiBaseUrl, upstreamProtocol);

  // 方案 5：插件优先解析 API key，fallback 到原有逻辑
  const apiKey =
    (providerType && builtinProvider
      ? runHookFirst('resolve.apiKey', providerType, { provider: builtinProvider })
      : undefined) ??
    (builtinProvider
      ? resolveProviderApiKey(builtinProvider)
      : isAnthropic
        ? (globalThis.process?.env['ANTHROPIC_API_KEY'] ?? getDefaultApiKey())
        : getDefaultApiKey());

  return {
    model,
    ...(builtinProvider?.id ? { providerId: builtinProvider.id } : {}),
    variant: request.variant,
    apiBaseUrl,
    apiKey,
    ...(builtinProvider?.openaiFastMode === true ? { openaiFastMode: true } : {}),
    maxTokens: requestOverrides.maxTokens ?? request.maxTokens,
    temperature: requestOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides,
    contextWindow: builtinModel?.contextWindow,
    contextWindowOverride: builtinModel?.contextWindowOverride,
    autoCompactThresholdRatio: builtinModel?.autoCompactThresholdRatio,
    autoCompactTargetRatio: builtinModel?.autoCompactTargetRatio,
    maxOutputTokens: builtinModel?.maxOutputTokens,
    providerType,
    inputPricePerMillion: builtinModel?.inputPricePerMillion,
    outputPricePerMillion: builtinModel?.outputPricePerMillion,
    cacheReadPricePerMillion: builtinModel?.cacheReadPricePerMillion,
    cacheWritePricePerMillion: builtinModel?.cacheWritePricePerMillion,
    supportsThinking: builtinModel?.supportsThinking === true,
    systemPrompt: request.systemPrompt,
  };
}

export function resolveModelRouteFromProvider(
  provider: AIProvider,
  modelIdOrModel: string | AIModelConfig,
  request: Omit<ModelRequest, 'model'>,
): ModelRouteConfig {
  const modelId = typeof modelIdOrModel === 'string' ? modelIdOrModel : modelIdOrModel.id;
  const modelConfig =
    typeof modelIdOrModel === 'string'
      ? provider.defaultModels.find((model) => model.id === modelIdOrModel)
      : modelIdOrModel;
  const requestOverrides = buildRequestOverrides(
    provider.requestOverrides,
    modelConfig?.requestOverrides,
    modelId,
  );
  const rawProviderBaseUrl =
    normalizeBaseUrl(provider.baseUrl) || resolveProviderDefaultBaseUrl(provider.type);

  // 方案 5：插件优先解析协议（显式 override 仍然最优先）
  const upstreamProtocol =
    provider.upstreamProtocol ??
    runHookFirst('resolve.protocol', provider.type, {
      model: modelId,
      provider,
      baseUrl: rawProviderBaseUrl,
    }) ??
    resolveUpstreamProtocol({
      model: modelId,
      providerType: provider.type,
      baseUrl: rawProviderBaseUrl,
      explicitOverride: provider.upstreamProtocol,
    });
  const resolvedProviderBaseUrl = normalizeRuntimeBaseUrl(
    provider.type,
    rawProviderBaseUrl,
    upstreamProtocol,
  );

  // 方案 5：插件优先解析 API key
  const apiKey =
    runHookFirst('resolve.apiKey', provider.type, { provider }) ?? resolveProviderApiKey(provider);

  // 方案 5：插件注入额外 headers / body（见 applyProviderRequestHooks）
  const mergedOverrides = applyProviderRequestHooks(
    provider.type,
    provider,
    modelId,
    requestOverrides,
  );

  return {
    model: modelId,
    providerId: provider.id,
    variant: request.variant,
    apiBaseUrl: resolvedProviderBaseUrl,
    apiKey,
    ...(provider.openaiFastMode === true ? { openaiFastMode: true } : {}),
    maxTokens: mergedOverrides.maxTokens ?? request.maxTokens,
    temperature: mergedOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides: mergedOverrides,
    contextWindow: modelConfig?.contextWindow,
    contextWindowOverride: modelConfig?.contextWindowOverride,
    autoCompactThresholdRatio: modelConfig?.autoCompactThresholdRatio,
    autoCompactTargetRatio: modelConfig?.autoCompactTargetRatio,
    maxOutputTokens: modelConfig?.maxOutputTokens,
    providerType: provider.type,
    inputPricePerMillion: modelConfig?.inputPricePerMillion,
    outputPricePerMillion: modelConfig?.outputPricePerMillion,
    cacheReadPricePerMillion: modelConfig?.cacheReadPricePerMillion,
    cacheWritePricePerMillion: modelConfig?.cacheWritePricePerMillion,
    supportsThinking: modelConfig?.supportsThinking === true,
    systemPrompt: request.systemPrompt,
  };
}

export function resolveCompactionRoute(
  provider: AIProvider,
  modelIdOrModel: string | AIModelConfig,
): ModelRouteConfig {
  const modelId = typeof modelIdOrModel === 'string' ? modelIdOrModel : modelIdOrModel.id;
  const modelConfig =
    typeof modelIdOrModel === 'string'
      ? provider.defaultModels.find((model) => model.id === modelIdOrModel)
      : modelIdOrModel;
  const requestOverrides = buildRequestOverrides(
    provider.requestOverrides,
    modelConfig?.requestOverrides,
    modelId,
  );
  const rawCompactionBaseUrl =
    normalizeBaseUrl(provider.baseUrl) || resolveProviderDefaultBaseUrl(provider.type);

  // 方案 5：插件优先解析协议
  const upstreamProtocol =
    provider.upstreamProtocol ??
    runHookFirst('resolve.protocol', provider.type, {
      model: modelId,
      provider,
      baseUrl: rawCompactionBaseUrl,
    }) ??
    resolveUpstreamProtocol({
      model: modelId,
      providerType: provider.type,
      baseUrl: rawCompactionBaseUrl,
      explicitOverride: provider.upstreamProtocol,
    });
  const resolvedCompactionBaseUrl = normalizeRuntimeBaseUrl(
    provider.type,
    rawCompactionBaseUrl,
    upstreamProtocol,
  );

  // 方案 5：插件优先解析 API key
  const apiKey =
    runHookFirst('resolve.apiKey', provider.type, { provider }) ?? resolveProviderApiKey(provider);

  // 方案 5：插件注入额外 headers / body（见 applyProviderRequestHooks）
  const mergedOverrides = applyProviderRequestHooks(
    provider.type,
    provider,
    modelId,
    requestOverrides,
  );

  return {
    model: modelId,
    providerId: provider.id,
    apiBaseUrl: resolvedCompactionBaseUrl,
    apiKey,
    ...(provider.openaiFastMode === true ? { openaiFastMode: true } : {}),
    maxTokens: mergedOverrides.maxTokens ?? 4096,
    temperature: 0,
    upstreamProtocol,
    requestOverrides: mergedOverrides,
    contextWindow: modelConfig?.contextWindow,
    contextWindowOverride: modelConfig?.contextWindowOverride,
    autoCompactThresholdRatio: modelConfig?.autoCompactThresholdRatio,
    autoCompactTargetRatio: modelConfig?.autoCompactTargetRatio,
    maxOutputTokens: modelConfig?.maxOutputTokens,
    providerType: provider.type,
    supportsThinking: false,
  };
}

export function validateModelRequest(raw: unknown): ModelRequest {
  return modelRequestSchema.parse(raw);
}
