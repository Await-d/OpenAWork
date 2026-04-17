import { buildRequestOverrides, getAllBuiltinPresets } from '@openAwork/agent-core';
import type { AIModelConfig, AIProvider, RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { resolveUpstreamProtocol } from './routes/upstream-protocol.js';
import type { UpstreamProtocol } from './routes/upstream-protocol.js';

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
  variant?: string;
  apiBaseUrl: string;
  apiKey: string;
  contextWindow?: number;
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

const OPENAI_BASE = globalThis.process?.env['AI_API_BASE_URL'] ?? 'https://api.openai.com/v1';
const DEFAULT_API_KEY = globalThis.process?.env['AI_API_KEY'] ?? '';

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

const resolveProviderDefaultBaseUrl = (providerType: AIProvider['type']): string => {
  if (providerType === 'openai') {
    return normalizeBaseUrl(OPENAI_BASE);
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
    return globalThis.process?.env[provider.apiKeyEnv] ?? '';
  }

  return DEFAULT_API_KEY;
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
  const apiBaseUrl = normalizeBaseUrl(
    (builtinProvider ? resolveProviderDefaultBaseUrl(builtinProvider.type) : undefined) ??
      (isAnthropic
        ? (globalThis.process?.env['ANTHROPIC_API_BASE_URL'] ?? 'https://api.anthropic.com/v1')
        : OPENAI_BASE),
  );
  const upstreamProtocol = resolveUpstreamProtocol({ model, providerType, baseUrl: apiBaseUrl });

  const apiKey = builtinProvider
    ? resolveProviderApiKey(builtinProvider)
    : isAnthropic
      ? (globalThis.process?.env['ANTHROPIC_API_KEY'] ?? DEFAULT_API_KEY)
      : DEFAULT_API_KEY;

  return {
    model,
    variant: request.variant,
    apiBaseUrl,
    apiKey,
    maxTokens: requestOverrides.maxTokens ?? request.maxTokens,
    temperature: requestOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides,
    contextWindow: builtinModel?.contextWindow,
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
  const resolvedProviderBaseUrl =
    normalizeBaseUrl(provider.baseUrl) || resolveProviderDefaultBaseUrl(provider.type);
  const upstreamProtocol = resolveUpstreamProtocol({
    model: modelId,
    providerType: provider.type,
    baseUrl: resolvedProviderBaseUrl,
  });

  return {
    model: modelId,
    variant: request.variant,
    apiBaseUrl: resolvedProviderBaseUrl,
    apiKey: resolveProviderApiKey(provider),
    maxTokens: requestOverrides.maxTokens ?? request.maxTokens,
    temperature: requestOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides,
    contextWindow: modelConfig?.contextWindow,
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
  const resolvedCompactionBaseUrl =
    normalizeBaseUrl(provider.baseUrl) || resolveProviderDefaultBaseUrl(provider.type);
  const upstreamProtocol = resolveUpstreamProtocol({
    model: modelId,
    providerType: provider.type,
    baseUrl: resolvedCompactionBaseUrl,
  });

  return {
    model: modelId,
    apiBaseUrl: resolvedCompactionBaseUrl,
    apiKey: resolveProviderApiKey(provider),
    maxTokens: requestOverrides.maxTokens ?? 4096,
    temperature: 0,
    upstreamProtocol,
    requestOverrides,
    contextWindow: modelConfig?.contextWindow,
    providerType: provider.type,
    supportsThinking: false,
  };
}

export function validateModelRequest(raw: unknown): ModelRequest {
  return modelRequestSchema.parse(raw);
}
