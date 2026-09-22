import { z } from 'zod';
/**
 * Provider types
 */
export declare const ProviderTypeSchema: z.ZodEnum<{
  anthropic: 'anthropic';
  custom: 'custom';
  openai: 'openai';
  google: 'google';
  bedrock: 'bedrock';
  azure: 'azure';
  deepseek: 'deepseek';
  openrouter: 'openrouter';
  cohere: 'cohere';
}>;
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
/**
 * Authentication configuration
 */
export declare const AuthConfigSchema: z.ZodObject<
  {
    apiKey: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodString>;
    accessToken: z.ZodOptional<z.ZodString>;
    refreshToken: z.ZodOptional<z.ZodString>;
    customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  },
  z.core.$strip
>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
/**
 * HTTP client configuration
 */
export declare const HttpConfigSchema: z.ZodObject<
  {
    baseURL: z.ZodOptional<z.ZodString>;
    timeout: z.ZodOptional<z.ZodNumber>;
    maxRetries: z.ZodOptional<z.ZodNumber>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    proxy: z.ZodOptional<z.ZodString>;
    fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
  },
  z.core.$strip
>;
export type HttpConfig = z.infer<typeof HttpConfigSchema>;
/**
 * Model limits configuration
 */
export declare const ModelLimitsSchema: z.ZodObject<
  {
    maxInputTokens: z.ZodOptional<z.ZodNumber>;
    maxOutputTokens: z.ZodOptional<z.ZodNumber>;
    maxTotalTokens: z.ZodOptional<z.ZodNumber>;
    supportsVision: z.ZodOptional<z.ZodBoolean>;
    supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
    supportsTools: z.ZodOptional<z.ZodBoolean>;
    supportsStreaming: z.ZodOptional<z.ZodBoolean>;
    supportsJSON: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type ModelLimits = z.infer<typeof ModelLimitsSchema>;
/**
 * Model configuration
 */
export declare const ModelConfigSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    provider: z.ZodEnum<{
      anthropic: 'anthropic';
      custom: 'custom';
      openai: 'openai';
      google: 'google';
      bedrock: 'bedrock';
      azure: 'azure';
      deepseek: 'deepseek';
      openrouter: 'openrouter';
      cohere: 'cohere';
    }>;
    limits: z.ZodOptional<
      z.ZodObject<
        {
          maxInputTokens: z.ZodOptional<z.ZodNumber>;
          maxOutputTokens: z.ZodOptional<z.ZodNumber>;
          maxTotalTokens: z.ZodOptional<z.ZodNumber>;
          supportsVision: z.ZodOptional<z.ZodBoolean>;
          supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
          supportsTools: z.ZodOptional<z.ZodBoolean>;
          supportsStreaming: z.ZodOptional<z.ZodBoolean>;
          supportsJSON: z.ZodOptional<z.ZodBoolean>;
        },
        z.core.$strip
      >
    >;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
/**
 * Provider configuration
 */
export declare const ProviderConfigSchema: z.ZodObject<
  {
    type: z.ZodEnum<{
      anthropic: 'anthropic';
      custom: 'custom';
      openai: 'openai';
      google: 'google';
      bedrock: 'bedrock';
      azure: 'azure';
      deepseek: 'deepseek';
      openrouter: 'openrouter';
      cohere: 'cohere';
    }>;
    name: z.ZodOptional<z.ZodString>;
    auth: z.ZodObject<
      {
        apiKey: z.ZodOptional<z.ZodString>;
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
      },
      z.core.$strip
    >;
    http: z.ZodOptional<
      z.ZodObject<
        {
          baseURL: z.ZodOptional<z.ZodString>;
          timeout: z.ZodOptional<z.ZodNumber>;
          maxRetries: z.ZodOptional<z.ZodNumber>;
          headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          proxy: z.ZodOptional<z.ZodString>;
          fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
        },
        z.core.$strip
      >
    >;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
/**
 * OpenAI-specific configuration
 */
export declare const OpenAIConfigSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<'openai'>;
    auth: z.ZodObject<
      {
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        apiKey: z.ZodString;
      },
      z.core.$strip
    >;
    http: z.ZodOptional<
      z.ZodObject<
        {
          timeout: z.ZodOptional<z.ZodNumber>;
          maxRetries: z.ZodOptional<z.ZodNumber>;
          headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          proxy: z.ZodOptional<z.ZodString>;
          fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
          baseURL: z.ZodDefault<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type OpenAIConfig = z.infer<typeof OpenAIConfigSchema>;
/**
 * Azure OpenAI-specific configuration
 */
export declare const AzureConfigSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<'azure'>;
    auth: z.ZodObject<
      {
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        apiKey: z.ZodString;
      },
      z.core.$strip
    >;
    http: z.ZodObject<
      {
        timeout: z.ZodOptional<z.ZodNumber>;
        maxRetries: z.ZodOptional<z.ZodNumber>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        proxy: z.ZodOptional<z.ZodString>;
        fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
        baseURL: z.ZodString;
      },
      z.core.$strip
    >;
    deployment: z.ZodOptional<z.ZodString>;
    apiVersion: z.ZodDefault<z.ZodString>;
  },
  z.core.$strip
>;
export type AzureConfig = z.infer<typeof AzureConfigSchema>;
/**
 * Anthropic-specific configuration
 */
export declare const AnthropicConfigSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<'anthropic'>;
    auth: z.ZodObject<
      {
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        apiKey: z.ZodString;
      },
      z.core.$strip
    >;
    http: z.ZodOptional<
      z.ZodObject<
        {
          timeout: z.ZodOptional<z.ZodNumber>;
          maxRetries: z.ZodOptional<z.ZodNumber>;
          headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          proxy: z.ZodOptional<z.ZodString>;
          fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
          baseURL: z.ZodDefault<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    anthropicVersion: z.ZodDefault<z.ZodString>;
  },
  z.core.$strip
>;
export type AnthropicConfig = z.infer<typeof AnthropicConfigSchema>;
/**
 * Google-specific configuration
 */
export declare const GoogleConfigSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<'google'>;
    auth: z.ZodObject<
      {
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        apiKey: z.ZodString;
      },
      z.core.$strip
    >;
    http: z.ZodOptional<
      z.ZodObject<
        {
          timeout: z.ZodOptional<z.ZodNumber>;
          maxRetries: z.ZodOptional<z.ZodNumber>;
          headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          proxy: z.ZodOptional<z.ZodString>;
          fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
          baseURL: z.ZodDefault<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type GoogleConfig = z.infer<typeof GoogleConfigSchema>;
/**
 * DeepSeek-specific configuration
 */
export declare const DeepSeekConfigSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<'deepseek'>;
    auth: z.ZodObject<
      {
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        apiKey: z.ZodString;
      },
      z.core.$strip
    >;
    http: z.ZodOptional<
      z.ZodObject<
        {
          timeout: z.ZodOptional<z.ZodNumber>;
          maxRetries: z.ZodOptional<z.ZodNumber>;
          headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          proxy: z.ZodOptional<z.ZodString>;
          fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
          baseURL: z.ZodDefault<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type DeepSeekConfig = z.infer<typeof DeepSeekConfigSchema>;
/**
 * Custom provider configuration
 */
export declare const CustomProviderConfigSchema: z.ZodObject<
  {
    name: z.ZodOptional<z.ZodString>;
    auth: z.ZodObject<
      {
        apiKey: z.ZodOptional<z.ZodString>;
        organizationId: z.ZodOptional<z.ZodString>;
        projectId: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
      },
      z.core.$strip
    >;
    models: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            provider: z.ZodEnum<{
              anthropic: 'anthropic';
              custom: 'custom';
              openai: 'openai';
              google: 'google';
              bedrock: 'bedrock';
              azure: 'azure';
              deepseek: 'deepseek';
              openrouter: 'openrouter';
              cohere: 'cohere';
            }>;
            limits: z.ZodOptional<
              z.ZodObject<
                {
                  maxInputTokens: z.ZodOptional<z.ZodNumber>;
                  maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                  maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                  supportsVision: z.ZodOptional<z.ZodBoolean>;
                  supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                  supportsTools: z.ZodOptional<z.ZodBoolean>;
                  supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                  supportsJSON: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
    defaultModel: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    type: z.ZodLiteral<'custom'>;
    http: z.ZodObject<
      {
        timeout: z.ZodOptional<z.ZodNumber>;
        maxRetries: z.ZodOptional<z.ZodNumber>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        proxy: z.ZodOptional<z.ZodString>;
        fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
        baseURL: z.ZodString;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
export type CustomProviderConfig = z.infer<typeof CustomProviderConfigSchema>;
/**
 * Provider registry entry
 */
export declare const ProviderRegistryEntrySchema: z.ZodObject<
  {
    id: z.ZodString;
    config: z.ZodObject<
      {
        type: z.ZodEnum<{
          anthropic: 'anthropic';
          custom: 'custom';
          openai: 'openai';
          google: 'google';
          bedrock: 'bedrock';
          azure: 'azure';
          deepseek: 'deepseek';
          openrouter: 'openrouter';
          cohere: 'cohere';
        }>;
        name: z.ZodOptional<z.ZodString>;
        auth: z.ZodObject<
          {
            apiKey: z.ZodOptional<z.ZodString>;
            organizationId: z.ZodOptional<z.ZodString>;
            projectId: z.ZodOptional<z.ZodString>;
            accessToken: z.ZodOptional<z.ZodString>;
            refreshToken: z.ZodOptional<z.ZodString>;
            customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
          },
          z.core.$strip
        >;
        http: z.ZodOptional<
          z.ZodObject<
            {
              baseURL: z.ZodOptional<z.ZodString>;
              timeout: z.ZodOptional<z.ZodNumber>;
              maxRetries: z.ZodOptional<z.ZodNumber>;
              headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
              proxy: z.ZodOptional<z.ZodString>;
              fetch: z.ZodOptional<z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>>;
            },
            z.core.$strip
          >
        >;
        models: z.ZodOptional<
          z.ZodArray<
            z.ZodObject<
              {
                id: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                provider: z.ZodEnum<{
                  anthropic: 'anthropic';
                  custom: 'custom';
                  openai: 'openai';
                  google: 'google';
                  bedrock: 'bedrock';
                  azure: 'azure';
                  deepseek: 'deepseek';
                  openrouter: 'openrouter';
                  cohere: 'cohere';
                }>;
                limits: z.ZodOptional<
                  z.ZodObject<
                    {
                      maxInputTokens: z.ZodOptional<z.ZodNumber>;
                      maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                      maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                      supportsVision: z.ZodOptional<z.ZodBoolean>;
                      supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                      supportsTools: z.ZodOptional<z.ZodBoolean>;
                      supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                      supportsJSON: z.ZodOptional<z.ZodBoolean>;
                    },
                    z.core.$strip
                  >
                >;
                metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
              },
              z.core.$strip
            >
          >
        >;
        defaultModel: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
      },
      z.core.$strip
    >;
    enabled: z.ZodDefault<z.ZodBoolean>;
    priority: z.ZodDefault<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export type ProviderRegistryEntry = z.infer<typeof ProviderRegistryEntrySchema>;
/**
 * Provider registry
 */
export declare const ProviderRegistrySchema: z.ZodObject<
  {
    providers: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          config: z.ZodObject<
            {
              type: z.ZodEnum<{
                anthropic: 'anthropic';
                custom: 'custom';
                openai: 'openai';
                google: 'google';
                bedrock: 'bedrock';
                azure: 'azure';
                deepseek: 'deepseek';
                openrouter: 'openrouter';
                cohere: 'cohere';
              }>;
              name: z.ZodOptional<z.ZodString>;
              auth: z.ZodObject<
                {
                  apiKey: z.ZodOptional<z.ZodString>;
                  organizationId: z.ZodOptional<z.ZodString>;
                  projectId: z.ZodOptional<z.ZodString>;
                  accessToken: z.ZodOptional<z.ZodString>;
                  refreshToken: z.ZodOptional<z.ZodString>;
                  customHeaders: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                },
                z.core.$strip
              >;
              http: z.ZodOptional<
                z.ZodObject<
                  {
                    baseURL: z.ZodOptional<z.ZodString>;
                    timeout: z.ZodOptional<z.ZodNumber>;
                    maxRetries: z.ZodOptional<z.ZodNumber>;
                    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                    proxy: z.ZodOptional<z.ZodString>;
                    fetch: z.ZodOptional<
                      z.ZodFunction<z.core.$ZodFunctionArgs, z.core.$ZodFunctionOut>
                    >;
                  },
                  z.core.$strip
                >
              >;
              models: z.ZodOptional<
                z.ZodArray<
                  z.ZodObject<
                    {
                      id: z.ZodString;
                      name: z.ZodOptional<z.ZodString>;
                      provider: z.ZodEnum<{
                        anthropic: 'anthropic';
                        custom: 'custom';
                        openai: 'openai';
                        google: 'google';
                        bedrock: 'bedrock';
                        azure: 'azure';
                        deepseek: 'deepseek';
                        openrouter: 'openrouter';
                        cohere: 'cohere';
                      }>;
                      limits: z.ZodOptional<
                        z.ZodObject<
                          {
                            maxInputTokens: z.ZodOptional<z.ZodNumber>;
                            maxOutputTokens: z.ZodOptional<z.ZodNumber>;
                            maxTotalTokens: z.ZodOptional<z.ZodNumber>;
                            supportsVision: z.ZodOptional<z.ZodBoolean>;
                            supportsGuiGrounding: z.ZodOptional<z.ZodBoolean>;
                            supportsTools: z.ZodOptional<z.ZodBoolean>;
                            supportsStreaming: z.ZodOptional<z.ZodBoolean>;
                            supportsJSON: z.ZodOptional<z.ZodBoolean>;
                          },
                          z.core.$strip
                        >
                      >;
                      metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
                    },
                    z.core.$strip
                  >
                >
              >;
              defaultModel: z.ZodOptional<z.ZodString>;
              metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            },
            z.core.$strip
          >;
          enabled: z.ZodDefault<z.ZodBoolean>;
          priority: z.ZodDefault<z.ZodNumber>;
          metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        },
        z.core.$strip
      >
    >;
    defaultProvider: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type ProviderRegistry = z.infer<typeof ProviderRegistrySchema>;
/**
 * Provider capabilities
 */
export declare const ProviderCapabilitiesSchema: z.ZodObject<
  {
    streaming: z.ZodBoolean;
    tools: z.ZodBoolean;
    vision: z.ZodBoolean;
    json: z.ZodBoolean;
    reasoning: z.ZodOptional<z.ZodBoolean>;
    maxConcurrency: z.ZodOptional<z.ZodNumber>;
    rateLimit: z.ZodOptional<
      z.ZodObject<
        {
          requestsPerMinute: z.ZodOptional<z.ZodNumber>;
          tokensPerMinute: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;
/**
 * Provider status
 */
export declare const ProviderStatusSchema: z.ZodObject<
  {
    id: z.ZodString;
    available: z.ZodBoolean;
    healthy: z.ZodBoolean;
    lastChecked: z.ZodNumber;
    error: z.ZodOptional<z.ZodString>;
    latency: z.ZodOptional<z.ZodNumber>;
    capabilities: z.ZodOptional<
      z.ZodObject<
        {
          streaming: z.ZodBoolean;
          tools: z.ZodBoolean;
          vision: z.ZodBoolean;
          json: z.ZodBoolean;
          reasoning: z.ZodOptional<z.ZodBoolean>;
          maxConcurrency: z.ZodOptional<z.ZodNumber>;
          rateLimit: z.ZodOptional<
            z.ZodObject<
              {
                requestsPerMinute: z.ZodOptional<z.ZodNumber>;
                tokensPerMinute: z.ZodOptional<z.ZodNumber>;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
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
export declare function createProviderConfig(
  type: ProviderType,
  options: Partial<ProviderConfig>,
): ProviderConfig;
/**
 * Helper to validate provider config
 */
export declare function validateProviderConfig(config: unknown): config is ProviderConfig;
//# sourceMappingURL=provider.d.ts.map
