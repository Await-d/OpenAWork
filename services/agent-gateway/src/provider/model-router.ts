import { buildRequestOverrides, getAllBuiltinPresets } from '@openAwork/agent-core';
import type { AIModelConfig, AIProvider, RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { resolveUpstreamProtocol } from '../routes/upstream-protocol.js';
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';
import { runHookFirst, runHookAll } from './provider-plugin.js';

const BUILTIN_PRESETS = getAllBuiltinPresets();

const DEFAULT_MODEL_SENTINEL = 'default';
const DEFAULT_FALLBACK_MODEL = 'gpt-4o';

export const SUPPORTED_MODELS = Object.freeze(
  BUILTIN_PRESETS.flatMap((provider) =>
    provider.defaultModels.filter((model) => model.enabled !== false).map((model) => model.id),
  ),
);

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const modelRequestSchema = z.object({
  model: z.string().min(1).max(200).optional().default(DEFAULT_MODEL_SENTINEL),
  variant: z.string().min(1).max(80).optional(),
  systemPrompt: z.string().max(4000).optional(),
  maxTokens: z.number().int().min(1).max(16384).optional().default(2048),
  temperature: z.number().min(0).max(2).optional().default(1),
});

export type ModelRequest = z.infer<typeof modelRequestSchema>;

export interface ModelRouteConfig {
  model: string;
  providerId?: string;
  variant?: string;
  apiBaseUrl: string;
  apiKey: string;
  contextWindow?: number;
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
>(
  BUILTIN_PRESETS.flatMap((provider) =>
    provider.defaultModels.map((model) => [model.id, { model, provider }] as const),
  ),
);

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

export function resolveModelRoute(request: ModelRequest): ModelRouteConfig {
  const model =
    request.model === DEFAULT_MODEL_SENTINEL
      ? (globalThis.process?.env['AI_DEFAULT_MODEL'] ?? DEFAULT_FALLBACK_MODEL)
      : request.model;
  const builtinFallback = resolveBuiltinFallbackModel(model);
  const builtinProvider = builtinFallback?.provider;
  const builtinModel = builtinFallback?.model;
  const requestOverrides = buildRequestOverrides(undefined, undefined, model);
  const providerType =
    builtinProvider?.type ?? (model.startsWith('claude') ? 'anthropic' : undefined);
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
    maxTokens: requestOverrides.maxTokens ?? request.maxTokens,
    temperature: requestOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides,
    contextWindow: builtinModel?.contextWindow,
    maxOutputTokens: builtinModel?.maxOutputTokens,
    providerType,
    inputPricePerMillion: builtinModel?.inputPricePerMillion,
    outputPricePerMillion: builtinModel?.outputPricePerMillion,
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

  // 方案 5：插件注入额外 headers（合并到 requestOverrides.headers）
  const pluginHeaders: Record<string, string> = { ...(requestOverrides.headers ?? {}) };
  runHookAll('request.headers', provider.type, {
    model: modelId,
    provider,
    headers: pluginHeaders,
  });
  const mergedOverrides = {
    ...requestOverrides,
    ...(Object.keys(pluginHeaders).length > 0 ? { headers: pluginHeaders } : {}),
  };

  return {
    model: modelId,
    providerId: provider.id,
    variant: request.variant,
    apiBaseUrl: resolvedProviderBaseUrl,
    apiKey,
    maxTokens: mergedOverrides.maxTokens ?? request.maxTokens,
    temperature: mergedOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides: mergedOverrides,
    contextWindow: modelConfig?.contextWindow,
    maxOutputTokens: modelConfig?.maxOutputTokens,
    providerType: provider.type,
    inputPricePerMillion: modelConfig?.inputPricePerMillion,
    outputPricePerMillion: modelConfig?.outputPricePerMillion,
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

  // 方案 5：插件注入 headers
  const pluginHeaders: Record<string, string> = { ...(requestOverrides.headers ?? {}) };
  runHookAll('request.headers', provider.type, {
    model: modelId,
    provider,
    headers: pluginHeaders,
  });
  const mergedOverrides = {
    ...requestOverrides,
    ...(Object.keys(pluginHeaders).length > 0 ? { headers: pluginHeaders } : {}),
  };

  return {
    model: modelId,
    providerId: provider.id,
    apiBaseUrl: resolvedCompactionBaseUrl,
    apiKey,
    maxTokens: mergedOverrides.maxTokens ?? 4096,
    temperature: 0,
    upstreamProtocol,
    requestOverrides: mergedOverrides,
    contextWindow: modelConfig?.contextWindow,
    maxOutputTokens: modelConfig?.maxOutputTokens,
    providerType: provider.type,
    supportsThinking: false,
  };
}

export function validateModelRequest(raw: unknown): ModelRequest {
  return modelRequestSchema.parse(raw);
}
