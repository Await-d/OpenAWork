import { createSettingsClient, type SettingsProvidersLoadResult } from '@openAwork/web-client';
import { DEFAULT_IMAGE_GENERATION_SIZE, normalizeImageGenerationSize } from '@openAwork/shared';
import type { ReasoningEffort } from '../../components/conversation-runtime/messages/support.js';
import type { ModelSelectionSource } from '../../pages/chat-page/conversation/settings/model-selection-source.js';

export interface ChatSettingsModel {
  id: string;
  label: string;
  enabled: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsImageGeneration?: boolean;
  supportsImageGeneration4K?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  thinking?: { enabled: boolean; budgetTokens?: number; mode?: ReasoningEffort };
}

export interface SavedChatImageDefaults {
  providerId: string;
  modelId: string;
  size: string;
  quality: 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  background: 'auto' | 'opaque';
}

export interface ChatSettingsProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  defaultModels: ChatSettingsModel[];
}

export interface SavedChatDefaults {
  modelId: string;
  providerId: string;
  reasoningEffort: ReasoningEffort;
  thinkingEnabled: boolean;
}

interface SettingsProvidersResponse {
  activeSelection?: {
    chat?: { providerId?: string; modelId?: string };
    fast?: { providerId?: string; modelId?: string };
    image?: { providerId?: string; modelId?: string };
  };
  defaultThinking?: {
    chat?: { enabled?: boolean; effort?: ReasoningEffort };
  };
  imageGenerationDefaults?: Partial<Omit<SavedChatImageDefaults, 'providerId' | 'modelId'>>;
  providers?: ChatSettingsProvider[];
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  return value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : 'medium';
}

export async function loadSavedChatSessionDefaults(
  gatewayUrl: string,
  token: string,
): Promise<{
  defaults: SavedChatDefaults;
  imageDefaults: SavedChatImageDefaults;
  providers: ChatSettingsProvider[];
  fastSelection: { providerId: string; modelId: string } | null;
}> {
  const result = await loadSavedChatSessionDefaultsResult(gatewayUrl, token);
  if (result.ok === false) {
    throw new Error(result.errorMessage ?? '加载 Provider 列表失败');
  }
  return result.data;
}

export async function loadSavedChatSessionDefaultsResult(
  gatewayUrl: string,
  token: string,
): Promise<
  | {
      data: {
        defaults: SavedChatDefaults;
        imageDefaults: SavedChatImageDefaults;
        providers: ChatSettingsProvider[];
        fastSelection: { providerId: string; modelId: string } | null;
      };
      ok: true;
      retryable: false;
    }
  | {
      errorMessage?: string;
      ok: false;
      retryable: boolean;
      status?: number;
    }
> {
  const result = (await createSettingsClient(gatewayUrl).getProvidersResult(token, {
    enabledOnly: true,
  })) as SettingsProvidersLoadResult;
  if (!result.ok || !result.providers) {
    return {
      ok: false,
      retryable: result.retryable,
      errorMessage: result.errorMessage,
      ...(typeof result.status === 'number' ? { status: result.status } : {}),
    };
  }
  const data = result.providers as SettingsProvidersResponse;
  const providers = (data.providers ?? [])
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      ...provider,
      defaultModels: (provider.defaultModels ?? []).filter((model) => model.enabled),
    }));
  return {
    ok: true,
    retryable: false,
    data: {
      defaults: {
        providerId: data.activeSelection?.chat?.providerId?.trim() ?? '',
        modelId: data.activeSelection?.chat?.modelId?.trim() ?? '',
        thinkingEnabled: data.defaultThinking?.chat?.enabled === true,
        reasoningEffort: normalizeReasoningEffort(data.defaultThinking?.chat?.effort),
      },
      fastSelection: data.activeSelection?.fast
        ? {
            providerId: data.activeSelection.fast.providerId?.trim() ?? '',
            modelId: data.activeSelection.fast.modelId?.trim() ?? '',
          }
        : null,
      imageDefaults: {
        providerId: data.activeSelection?.image?.providerId?.trim() ?? '',
        modelId: data.activeSelection?.image?.modelId?.trim() ?? '',
        size: normalizeImageGenerationSize(
          data.imageGenerationDefaults?.size,
          DEFAULT_IMAGE_GENERATION_SIZE,
        ),
        quality:
          data.imageGenerationDefaults?.quality === 'low' ||
          data.imageGenerationDefaults?.quality === 'high'
            ? data.imageGenerationDefaults.quality
            : 'medium',
        outputFormat:
          data.imageGenerationDefaults?.outputFormat === 'jpeg' ||
          data.imageGenerationDefaults?.outputFormat === 'webp'
            ? data.imageGenerationDefaults.outputFormat
            : 'png',
        background: data.imageGenerationDefaults?.background === 'opaque' ? 'opaque' : 'auto',
      },
      providers,
    },
  };
}

export function buildSavedChatSessionMetadata(
  defaults: SavedChatDefaults,
  options?: {
    modelSelectionSource?: ModelSelectionSource | null;
    parentSessionId?: string | null;
    workingDirectory?: string | null;
  },
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    thinkingEnabled: defaults.thinkingEnabled,
    reasoningEffort: defaults.reasoningEffort,
  };

  if (defaults.providerId) {
    metadata['providerId'] = defaults.providerId;
  }

  if (defaults.modelId) {
    metadata['modelId'] = defaults.modelId;
  }
  if (defaults.providerId && defaults.modelId) {
    metadata['modelSelectionSource'] = options?.modelSelectionSource ?? 'defaults';
  }

  const workingDirectory = options?.workingDirectory?.trim();
  if (workingDirectory) {
    metadata['workingDirectory'] = workingDirectory;
  }

  const parentSessionId = options?.parentSessionId?.trim();
  if (parentSessionId) {
    metadata['parentSessionId'] = parentSessionId;
  }

  return metadata;
}
