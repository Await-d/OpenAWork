import type { AIProvider, ActiveSelection, ProviderType } from '@openAwork/agent-core';
import { ProviderManagerImpl, PROVIDER_CATALOG } from '@openAwork/agent-core';
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  normalizeImageGenerationSize,
  type ImageGenerationBackground,
  type ImageGenerationOutputFormat,
  type ImageGenerationQuality,
  validateImageGenerationSize,
} from '@openAwork/shared';
import { z } from 'zod';

// 由 catalog 派生内置平台类型 + 'custom'，新增平台无需改这里。
const PROVIDER_TYPE_SET: ReadonlySet<ProviderType> = new Set<ProviderType>([
  ...PROVIDER_CATALOG.map((entry) => entry.type),
  'custom',
]);

const providerTypeSchema = z.custom<ProviderType>(
  (value): value is ProviderType =>
    typeof value === 'string' && PROVIDER_TYPE_SET.has(value as ProviderType),
  { message: 'Unknown provider type' },
);

const thinkingConfigSchema = z.object({
  enabled: z.boolean(),
  budgetTokens: z.number().int().positive().optional(),
  mode: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
});

const reasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);

const defaultThinkingEntrySchema = z.object({
  enabled: z.boolean(),
  effort: reasoningEffortSchema,
});

export const defaultThinkingSettingsSchema = z.object({
  chat: defaultThinkingEntrySchema,
  fast: defaultThinkingEntrySchema,
});

export type DefaultThinkingSettings = z.infer<typeof defaultThinkingSettingsSchema>;

const imageGenerationSizeSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const validation = validateImageGenerationSize(value);
    if (!validation.valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: validation.message ?? 'Invalid image generation size',
      });
    }
  });
const imageGenerationQualitySchema = z.enum([
  'low',
  'medium',
  'high',
]) satisfies z.ZodType<ImageGenerationQuality>;
const imageGenerationOutputFormatSchema = z.enum([
  'png',
  'jpeg',
  'webp',
]) satisfies z.ZodType<ImageGenerationOutputFormat>;
const imageGenerationBackgroundSchema = z.enum([
  'auto',
  'opaque',
]) satisfies z.ZodType<ImageGenerationBackground>;

export const imageGenerationDefaultsSchema = z.object({
  size: imageGenerationSizeSchema,
  quality: imageGenerationQualitySchema,
  outputFormat: imageGenerationOutputFormatSchema,
  background: imageGenerationBackgroundSchema,
});

export type ImageGenerationDefaults = z.infer<typeof imageGenerationDefaultsSchema>;

export const DEFAULT_THINKING_SETTINGS: DefaultThinkingSettings = {
  chat: { enabled: false, effort: 'medium' },
  fast: { enabled: false, effort: 'medium' },
};

export const DEFAULT_IMAGE_GENERATION_DEFAULTS: ImageGenerationDefaults = {
  size: DEFAULT_IMAGE_GENERATION_SIZE,
  quality: 'medium',
  outputFormat: 'png',
  background: 'auto',
};

const requestOverridesSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  timeoutMs: z.number().int().positive().optional(),
  omitBodyKeys: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
});

const oauthConfigSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  authorizeUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  revokeUrl: z.string().optional(),
  scope: z.string().optional(),
  audience: z.string().optional(),
  usePkce: z.boolean().optional(),
});

const nonNegativeIntegerMetadataSchema = z.number().int().nonnegative().optional();

export const aiModelConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean(),
  contextWindow: nonNegativeIntegerMetadataSchema,
  maxOutputTokens: nonNegativeIntegerMetadataSchema,
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsImageGeneration: z.boolean().optional(),
  supportsImageGeneration4K: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  inputPricePerMillion: z.number().min(0).optional(),
  outputPricePerMillion: z.number().min(0).optional(),
  thinking: thinkingConfigSchema.optional(),
  requestOverrides: requestOverridesSchema.optional(),
});

export const aiProviderSchema = z
  .object({
    id: z.string().min(1),
    type: providerTypeSchema,
    name: z.string().min(1),
    enabled: z.boolean(),
    baseUrl: z.string().default(''),
    apiKey: z.string().optional(),
    apiKeyEnv: z.string().optional(),
    oauth: oauthConfigSchema.optional(),
    requestOverrides: requestOverridesSchema.optional(),
    upstreamProtocol: z.enum(['chat_completions', 'responses', 'anthropic_messages']).optional(),
    defaultModels: z.array(aiModelConfigSchema),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .superRefine((provider, ctx) => {
    if (provider.type === 'custom' && provider.baseUrl.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'Custom providers require a baseUrl.',
      });
    }
  });

const providerModelSelectionSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
});

export const activeSelectionSchema = z.object({
  chat: providerModelSelectionSchema,
  fast: providerModelSelectionSchema,
  image: providerModelSelectionSchema.optional(),
  compaction: providerModelSelectionSchema.optional(),
});

export const providerSettingsBodySchema = z.object({
  providers: z.array(aiProviderSchema),
  activeSelection: activeSelectionSchema.optional(),
  defaultThinking: defaultThinkingSettingsSchema.optional(),
  imageGenerationDefaults: imageGenerationDefaultsSchema.optional(),
});

export const providerSettingsQuerySchema = z.object({
  enabledOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true'),
});

/**
 * 连通性自检请求体：支持两种来源——
 *   - `provider`(内联完整 provider 配置)：测「尚未保存」的设置页表单值；
 *   - `providerId`(已保存 provider 的 id)：测库里已有配置。
 * 二者必须提供其一，且都需要 `modelId` 指定要测哪个模型。
 */
export const providerConnectivityTestBodySchema = z
  .object({
    modelId: z.string().min(1),
    provider: aiProviderSchema.optional(),
    providerId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.provider && !value.providerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either `provider` or `providerId` is required.',
      });
    }
  });

/**
 * 把单个内联 provider 规整为运行时 `AIProvider`(补 createdAt/updatedAt、
 * 清洗 apiKeyEnv)，供连通性自检直接使用。
 */
export const normalizeSingleProviderForTest = (
  provider: z.infer<typeof aiProviderSchema>,
): AIProvider => {
  const [normalized] = normalizeProviders([provider]);
  return normalized as AIProvider;
};

type ProviderInput = z.infer<typeof aiProviderSchema>;

// 由 catalog 的 apiKeyEnv 派生，新增平台无需改这里。
const ALLOWED_API_KEY_ENV_BY_TYPE: Partial<Record<ProviderType, string>> = Object.fromEntries(
  PROVIDER_CATALOG.filter((entry) => entry.apiKeyEnv).map((entry) => [
    entry.type,
    entry.apiKeyEnv as string,
  ]),
);

const sanitizeProviderApiKeyEnv = (provider: ProviderInput): string | undefined => {
  const allowedEnv = ALLOWED_API_KEY_ENV_BY_TYPE[provider.type];
  if (!allowedEnv) {
    return undefined;
  }

  return provider.apiKeyEnv === allowedEnv ? allowedEnv : undefined;
};

const normalizeProviders = (providers: ProviderInput[]): AIProvider[] => {
  return providers.map((provider) => {
    const now = new Date().toISOString();
    return {
      ...provider,
      apiKeyEnv: sanitizeProviderApiKeyEnv(provider),
      createdAt: provider.createdAt ?? now,
      updatedAt: provider.updatedAt ?? now,
    };
  });
};

const parseStoredProviders = (rawProviders: unknown): AIProvider[] | undefined => {
  if (!Array.isArray(rawProviders)) {
    return undefined;
  }

  const validProviders: ProviderInput[] = [];
  for (const candidate of rawProviders) {
    const parsedProvider = aiProviderSchema.safeParse(candidate);
    if (parsedProvider.success) {
      validProviders.push(parsedProvider.data);
    }
  }

  if (validProviders.length === 0) {
    return undefined;
  }

  return normalizeProviders(validProviders);
};

const parseStoredActiveSelection = (rawActiveSelection: unknown): ActiveSelection | undefined => {
  const parsed = activeSelectionSchema.safeParse(rawActiveSelection);
  return parsed.success ? parsed.data : undefined;
};

export const parseStoredDefaultThinking = (
  rawDefaultThinking: unknown,
): DefaultThinkingSettings => {
  const parsed = defaultThinkingSettingsSchema.safeParse(rawDefaultThinking);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    chat: { ...DEFAULT_THINKING_SETTINGS.chat },
    fast: { ...DEFAULT_THINKING_SETTINGS.fast },
  };
};

export const parseStoredImageGenerationDefaults = (
  rawImageGenerationDefaults: unknown,
): ImageGenerationDefaults => {
  const parsed = imageGenerationDefaultsSchema.safeParse(rawImageGenerationDefaults);
  if (parsed.success) {
    return {
      ...parsed.data,
      size: normalizeImageGenerationSize(parsed.data.size, DEFAULT_IMAGE_GENERATION_DEFAULTS.size),
    };
  }

  return { ...DEFAULT_IMAGE_GENERATION_DEFAULTS };
};

export const resolveStoredDefaultThinkingMode = (
  rawDefaultThinking: unknown,
  mode: keyof DefaultThinkingSettings,
): DefaultThinkingSettings['chat'] => {
  const parsed = parseStoredDefaultThinking(rawDefaultThinking);
  return { ...parsed[mode] };
};

const createProviderManager = async (
  rawProviders: unknown,
  rawActiveSelection: unknown,
): Promise<InstanceType<typeof ProviderManagerImpl>> => {
  const providers = parseStoredProviders(rawProviders);
  const active = parseStoredActiveSelection(rawActiveSelection);
  const manager = providers
    ? new ProviderManagerImpl({ providers, active })
    : active
      ? new ProviderManagerImpl({ active })
      : new ProviderManagerImpl();

  await manager.syncFromModelsDev();
  return manager;
};

export const materializeProviderConfig = (
  rawProviders: unknown,
  rawActiveSelection: unknown,
): Promise<{ providers: AIProvider[]; activeSelection: ActiveSelection }> =>
  createProviderManager(rawProviders, rawActiveSelection).then((manager) => {
    const config = manager.getConfig();

    return {
      providers: config.providers,
      activeSelection: config.active,
    };
  });

export const filterEnabledProviderConfig = ({
  providers,
  activeSelection,
}: {
  providers: AIProvider[];
  activeSelection: ActiveSelection;
}): {
  providers: AIProvider[];
  activeSelection: ActiveSelection;
} => {
  return {
    providers: providers
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        ...provider,
        defaultModels: provider.defaultModels.filter((model) => model.enabled),
      }))
      .filter((provider) => provider.defaultModels.length > 0),
    activeSelection,
  };
};

export const getActiveChatProviderConfig = (
  rawProviders: unknown,
  rawActiveSelection: unknown,
): Promise<{ provider: AIProvider; modelId: string } | null> =>
  createProviderManager(rawProviders, rawActiveSelection)
    .then((manager) => {
      const { provider, model } = manager.getChatProviderConfig();
      return {
        provider,
        modelId: model.id,
      };
    })
    .catch(() => null);

export const getProviderConfigForSelection = (
  rawProviders: unknown,
  rawActiveSelection: unknown,
  selectionOverride?: { providerId?: string; modelId?: string },
  options: { fallbackToChat?: boolean } = {},
): Promise<{ provider: AIProvider; modelId: string } | null> =>
  createProviderManager(rawProviders, rawActiveSelection)
    .then((manager) => {
      const fallbackToChat = options.fallbackToChat !== false;
      if (!selectionOverride?.providerId || !selectionOverride.modelId) {
        if (!fallbackToChat) return null;
        const { provider, model } = manager.getChatProviderConfig();
        return { provider, modelId: model.id };
      }

      const config = manager.getConfig();
      const provider = config.providers.find(
        (item) => item.id === selectionOverride.providerId && item.enabled,
      );
      const model = provider?.defaultModels.find(
        (item) => item.id === selectionOverride.modelId && item.enabled,
      );
      if (!provider || !model) {
        if (!fallbackToChat) return null;
        const fallback = manager.getChatProviderConfig();
        return { provider: fallback.provider, modelId: fallback.model.id };
      }

      return { provider, modelId: model.id };
    })
    .catch(() => null);

export const getCompactionProviderConfig = (
  rawProviders: unknown,
  rawActiveSelection: unknown,
): Promise<{ provider: AIProvider; modelId: string } | null> =>
  createProviderManager(rawProviders, rawActiveSelection)
    .then((manager) => {
      const config = manager.getConfig();
      const selection = config.active.compaction;
      if (!selection) {
        return null;
      }

      const provider = config.providers.find(
        (item) => item.id === selection.providerId && item.enabled,
      );
      const model = provider?.defaultModels.find(
        (item) => item.id === selection.modelId && item.enabled,
      );
      if (!provider || !model) {
        return null;
      }

      return { provider, modelId: model.id };
    })
    .catch(() => null);

export const getFastProviderConfig = (
  rawProviders: unknown,
  rawActiveSelection: unknown,
): Promise<{ provider: AIProvider; modelId: string } | null> =>
  createProviderManager(rawProviders, rawActiveSelection)
    .then((manager) => {
      const { provider, model } = manager.getFastProviderConfig();
      return { provider, modelId: model.id };
    })
    .catch(() => null);

export const getImageProviderConfig = (
  rawProviders: unknown,
  rawActiveSelection: unknown,
): Promise<{
  provider: AIProvider;
  modelId: string;
  model: AIProvider['defaultModels'][number];
} | null> =>
  createProviderManager(rawProviders, rawActiveSelection)
    .then((manager) => {
      const config = manager.getConfig();
      const selection = config.active.image;
      if (!selection) {
        return null;
      }

      const provider = config.providers.find(
        (item) => item.id === selection.providerId && item.enabled,
      );
      const model = provider?.defaultModels.find(
        (item) =>
          item.id === selection.modelId && item.enabled && item.supportsImageGeneration === true,
      );
      if (!provider || !model) {
        return null;
      }

      return { provider, modelId: model.id, model };
    })
    .catch(() => null);
