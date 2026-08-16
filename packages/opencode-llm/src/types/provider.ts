import { z } from 'zod';
import { validateProviderBaseUrl } from '../provider/types.js';

const providerBaseURLSchema = z.string().url().superRefine((value, context) => {
  try {
    validateProviderBaseUrl(value);
  } catch (error) {
    if (error instanceof Error) {
      context.addIssue({ code: 'custom', message: error.message });
      return;
    }
    throw error;
  }
});

/**
 * Provider types
 */
export const ProviderTypeSchema = z.enum([
  'openai',
  'azure',
  'anthropic',
  'google',
  'cohere',
  'bedrock',
  'deepseek',
  'openrouter',
  'custom',
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

/**
 * Authentication configuration
 */
export const AuthConfigSchema = z.object({
  apiKey: z.string().optional(),
  organizationId: z.string().optional(),
  projectId: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

/**
 * HTTP client configuration
 */
export const HttpConfigSchema = z.object({
  baseURL: providerBaseURLSchema.optional(),
  timeout: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  proxy: z.string().optional(),
  fetch: z.function().optional(),
});
export type HttpConfig = z.infer<typeof HttpConfigSchema>;

/**
 * Model limits configuration
 */
export const ModelLimitsSchema = z.object({
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxTotalTokens: z.number().int().positive().optional(),
  supportsVision: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsJSON: z.boolean().optional(),
});
export type ModelLimits = z.infer<typeof ModelLimitsSchema>;

/**
 * Model configuration
 */
export const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  provider: ProviderTypeSchema,
  limits: ModelLimitsSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * Provider configuration
 */
export const ProviderConfigSchema = z.object({
  type: ProviderTypeSchema,
  name: z.string().optional(),
  auth: AuthConfigSchema,
  http: HttpConfigSchema.optional(),
  models: z.array(ModelConfigSchema).optional(),
  defaultModel: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * OpenAI-specific configuration
 */
export const OpenAIConfigSchema = ProviderConfigSchema.extend({
  type: z.literal('openai'),
  auth: AuthConfigSchema.extend({
    apiKey: z.string(),
  }),
  http: HttpConfigSchema.extend({
    baseURL: providerBaseURLSchema.default('https://api.openai.com/v1'),
  }).optional(),
});
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;

/**
 * Azure OpenAI-specific configuration
 */
export const AzureConfigSchema = ProviderConfigSchema.extend({
  type: z.literal('azure'),
  auth: AuthConfigSchema.extend({
    apiKey: z.string(),
  }),
  http: HttpConfigSchema.extend({
    baseURL: providerBaseURLSchema,
  }),
  deployment: z.string().optional(),
  apiVersion: z.string().default('2024-02-15-preview'),
});
export type AzureConfig = z.infer<typeof AzureConfigSchema>;

/**
 * Anthropic-specific configuration
 */
export const AnthropicConfigSchema = ProviderConfigSchema.extend({
  type: z.literal('anthropic'),
  auth: AuthConfigSchema.extend({
    apiKey: z.string(),
  }),
  http: HttpConfigSchema.extend({
    baseURL: providerBaseURLSchema.default('https://api.anthropic.com'),
  }).optional(),
  anthropicVersion: z.string().default('2023-06-01'),
});
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>;

/**
 * Google-specific configuration
 */
export const GoogleConfigSchema = ProviderConfigSchema.extend({
  type: z.literal('google'),
  auth: AuthConfigSchema.extend({
    apiKey: z.string(),
  }),
  http: HttpConfigSchema.extend({
    baseURL: providerBaseURLSchema.default('https://generativelanguage.googleapis.com/v1beta'),
  }).optional(),
});
export type GoogleConfig = z.infer<typeof GoogleConfigSchema>;

/**
 * DeepSeek-specific configuration
 */
export const DeepSeekConfigSchema = ProviderConfigSchema.extend({
  type: z.literal('deepseek'),
  auth: AuthConfigSchema.extend({
    apiKey: z.string(),
  }),
  http: HttpConfigSchema.extend({
    baseURL: providerBaseURLSchema.default('https://api.deepseek.com/v1'),
  }).optional(),
});
export type DeepSeekConfig = z.infer<typeof DeepSeekConfigSchema>;

/**
 * Custom provider configuration
 */
export const CustomProviderConfigSchema = ProviderConfigSchema.extend({
  type: z.literal('custom'),
  http: HttpConfigSchema.extend({
    baseURL: providerBaseURLSchema,
  }),
});
export type CustomProviderConfig = z.infer<typeof CustomProviderConfigSchema>;

/**
 * Provider registry entry
 */
export const ProviderRegistryEntrySchema = z.object({
  id: z.string(),
  config: ProviderConfigSchema,
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ProviderRegistryEntry = z.infer<typeof ProviderRegistryEntrySchema>;

/**
 * Provider registry
 */
export const ProviderRegistrySchema = z.object({
  providers: z.array(ProviderRegistryEntrySchema),
  defaultProvider: z.string().optional(),
});
export type ProviderRegistry = z.infer<typeof ProviderRegistrySchema>;

/**
 * Provider capabilities
 */
export const ProviderCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  tools: z.boolean(),
  vision: z.boolean(),
  json: z.boolean(),
  reasoning: z.boolean().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  rateLimit: z
    .object({
      requestsPerMinute: z.number().int().positive().optional(),
      tokensPerMinute: z.number().int().positive().optional(),
    })
    .optional(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

/**
 * Provider status
 */
export const ProviderStatusSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  healthy: z.boolean(),
  lastChecked: z.number(),
  error: z.string().optional(),
  latency: z.number().optional(),
  capabilities: ProviderCapabilitiesSchema.optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/**
 * Provider initialization options
 */
export interface ProviderInitOptions {
  config: ProviderConfig;
  validateOnInit?: boolean;
  healthCheckInterval?: number;
  retryConfig?: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  };
}

/**
 * Provider interface (abstract)
 */
export interface IProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  initialize(): Promise<void>;
  getStatus(): Promise<ProviderStatus>;
  validateConfig(): Promise<boolean>;
  listModels(): Promise<ModelConfig[]>;
}

/**
 * Helper to create provider config
 */
export function createProviderConfig(
  type: ProviderType,
  options: Partial<ProviderConfig>,
): ProviderConfig {
  const baseConfig: ProviderConfig = {
    type,
    auth: options.auth ?? {},
    http: options.http,
    models: options.models,
    defaultModel: options.defaultModel,
    metadata: options.metadata,
    name: options.name,
  };

  return ProviderConfigSchema.parse(baseConfig);
}

/**
 * Helper to validate provider config
 */
export function validateProviderConfig(config: unknown): config is ProviderConfig {
  return ProviderConfigSchema.safeParse(config).success;
}
