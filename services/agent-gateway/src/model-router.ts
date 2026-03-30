import { buildRequestOverrides } from '@openAwork/agent-core';
import type { AIModelConfig, AIProvider, RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { resolveUpstreamProtocol } from './routes/upstream-protocol.js';
import type { UpstreamProtocol } from './routes/upstream-protocol.js';

export const SUPPORTED_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const modelRequestSchema = z.object({
  model: z.string().min(1).max(200).optional().default('gpt-4o'),
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
  maxTokens: number;
  temperature: number;
  upstreamProtocol: UpstreamProtocol;
  requestOverrides: RequestOverrides;
  providerType?: AIProvider['type'];
  supportsThinking: boolean;
  systemPrompt?: string;
}

const OPENAI_BASE = globalThis.process?.env['AI_API_BASE_URL'] ?? 'https://api.openai.com/v1';
const DEFAULT_API_KEY = globalThis.process?.env['AI_API_KEY'] ?? '';

const PROVIDER_DEFAULT_BASE_URL: Partial<Record<AIProvider['type'], string>> = {
  anthropic: globalThis.process?.env['ANTHROPIC_API_BASE_URL'] ?? 'https://api.anthropic.com/v1',
  openai: OPENAI_BASE,
  deepseek: 'https://api.deepseek.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
};

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

const isOverriddenProviderBaseUrl = (provider: AIProvider): boolean => {
  const providerBaseUrl = normalizeBaseUrl(provider.baseUrl);
  if (providerBaseUrl.length === 0) {
    return false;
  }

  const defaultBaseUrl = normalizeBaseUrl(PROVIDER_DEFAULT_BASE_URL[provider.type]);
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

export function resolveModelRoute(request: ModelRequest): ModelRouteConfig {
  const model =
    request.model === 'default'
      ? (globalThis.process?.env['AI_DEFAULT_MODEL'] ?? SUPPORTED_MODELS[0])
      : request.model;
  const requestOverrides = buildRequestOverrides(undefined, undefined, model);
  const upstreamProtocol = resolveUpstreamProtocol({ model });

  const isAnthropic = model.startsWith('claude');
  const apiBaseUrl = normalizeBaseUrl(
    isAnthropic
      ? (globalThis.process?.env['ANTHROPIC_API_BASE_URL'] ?? 'https://api.anthropic.com/v1')
      : OPENAI_BASE,
  );

  const apiKey = isAnthropic
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
    supportsThinking: false,
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
  const upstreamProtocol = resolveUpstreamProtocol({ model: modelId, providerType: provider.type });

  return {
    model: modelId,
    variant: request.variant,
    apiBaseUrl:
      normalizeBaseUrl(provider.baseUrl) ||
      normalizeBaseUrl(PROVIDER_DEFAULT_BASE_URL[provider.type]),
    apiKey: resolveProviderApiKey(provider),
    maxTokens: requestOverrides.maxTokens ?? request.maxTokens,
    temperature: requestOverrides.temperature ?? request.temperature,
    upstreamProtocol,
    requestOverrides,
    providerType: provider.type,
    supportsThinking: modelConfig?.supportsThinking === true,
    systemPrompt: request.systemPrompt,
  };
}

export function validateModelRequest(raw: unknown): ModelRequest {
  return modelRequestSchema.parse(raw);
}
