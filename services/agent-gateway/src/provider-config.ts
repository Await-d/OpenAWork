import type { AIProvider, ActiveSelection, ProviderType } from '@openAwork/agent-core';
import { ProviderManagerImpl } from '@openAwork/agent-core';
import { z } from 'zod';

const PROVIDER_TYPE_VALUES = [
  'anthropic',
  'openai',
  'deepseek',
  'gemini',
  'ollama',
  'openrouter',
  'qwen',
  'moonshot',
  'custom',
] as const satisfies readonly ProviderType[];

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

export const DEFAULT_THINKING_SETTINGS: DefaultThinkingSettings = {
  chat: { enabled: false, effort: 'medium' },
  fast: { enabled: false, effort: 'medium' },
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
  supportsThinking: z.boolean().optional(),
  inputPricePerMillion: z.number().min(0).optional(),
  outputPricePerMillion: z.number().min(0).optional(),
  thinking: thinkingConfigSchema.optional(),
  requestOverrides: requestOverridesSchema.optional(),
});

export const aiProviderSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(PROVIDER_TYPE_VALUES),
    name: z.string().min(1),
    enabled: z.boolean(),
    baseUrl: z.string().default(''),
    apiKey: z.string().optional(),
    apiKeyEnv: z.string().optional(),
    oauth: oauthConfigSchema.optional(),
    requestOverrides: requestOverridesSchema.optional(),
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
  compaction: providerModelSelectionSchema.optional(),
});

export const providerSettingsBodySchema = z.object({
  providers: z.array(aiProviderSchema),
  activeSelection: activeSelectionSchema.optional(),
  defaultThinking: defaultThinkingSettingsSchema.optional(),
});

export const providerSettingsQuerySchema = z.object({
  enabledOnly: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((value) => value === true || value === 'true'),
});

type ProviderInput = z.infer<typeof aiProviderSchema>;

const ALLOWED_API_KEY_ENV_BY_TYPE: Partial<Record<ProviderType, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  qwen: 'QWEN_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
};

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
): Promise<{ provider: AIProvider; modelId: string } | null> =>
  createProviderManager(rawProviders, rawActiveSelection)
    .then((manager) => {
      if (!selectionOverride?.providerId || !selectionOverride.modelId) {
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
