import { createSettingsClient, type SettingsProvidersLoadResult } from '@openAwork/web-client';
import type { ModelReasoningOption } from '@openAwork/shared-ui';
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  IMAGE_GENERATION_COUNT_RANGE,
  IMAGE_GENERATION_OUTPUT_COMPRESSION_RANGE,
  normalizeImageGenerationSize,
  type ImageGenerationBackground,
  type ImageGenerationModeration,
  type ImageGenerationOutputFormat,
  type ImageGenerationQuality,
} from '@openAwork/shared';
import type { ReasoningEffort } from '../../components/conversation-runtime/messages/support.js';
import type { ModelSelectionSource } from '../../pages/chat-page/conversation/settings/model-selection-source.js';
import { useDisplayPreferencesStore } from '../../stores/settings/display-preferences.js';

export interface ChatSettingsModel {
  id: string;
  label: string;
  enabled: boolean;
  contextWindow?: number;
  contextWindowOverride?: number;
  maxOutputTokens?: number;
  /** 模型自声明的推理档位;聊天侧据此展示可选思考等级(优先于按 modelId 推断)。 */
  reasoningOptions?: readonly ModelReasoningOption[];
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
  quality: ImageGenerationQuality;
  outputFormat: ImageGenerationOutputFormat;
  background: ImageGenerationBackground;
  moderation: ImageGenerationModeration;
  /** 压缩率百分比，仅 jpeg / webp 生效；缺省表示交由上游决定。 */
  outputCompression?: number | undefined;
  /** 单次生成张数（对应官方 `n`）。 */
  count: number;
  /**
   * 局部编辑遮罩的产物 id（官方 `/images/edits` 的 `mask`）。
   * 这是**会话内**选择，服务端 schema 不收录该字段，因此不会被持久化——
   * 与「参考图」一样每次进会话都要重新挑。
   */
  maskArtifactId?: string | null | undefined;
}

export interface ChatSettingsProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  openaiFastMode?: boolean;
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
  return value === 'none' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
    ? value
    : 'medium';
}

const IMAGE_GENERATION_QUALITY_VALUES: readonly ImageGenerationQuality[] = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

function normalizeImageGenerationQuality(value: unknown): ImageGenerationQuality {
  return IMAGE_GENERATION_QUALITY_VALUES.find((candidate) => candidate === value) ?? 'medium';
}

function normalizeImageGenerationBackground(value: unknown): ImageGenerationBackground {
  if (value === 'opaque' || value === 'transparent') {
    return value;
  }
  return 'auto';
}

function normalizeImageGenerationModeration(value: unknown): ImageGenerationModeration {
  return value === 'low' ? 'low' : 'auto';
}

function normalizeImageGenerationOutputCompression(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  return value >= IMAGE_GENERATION_OUTPUT_COMPRESSION_RANGE.min &&
    value <= IMAGE_GENERATION_OUTPUT_COMPRESSION_RANGE.max
    ? value
    : undefined;
}

function normalizeImageGenerationCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return IMAGE_GENERATION_COUNT_RANGE.min;
  }
  return Math.min(
    Math.max(value, IMAGE_GENERATION_COUNT_RANGE.min),
    IMAGE_GENERATION_COUNT_RANGE.max,
  );
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
        quality: normalizeImageGenerationQuality(data.imageGenerationDefaults?.quality),
        outputFormat:
          data.imageGenerationDefaults?.outputFormat === 'jpeg' ||
          data.imageGenerationDefaults?.outputFormat === 'webp'
            ? data.imageGenerationDefaults.outputFormat
            : 'png',
        background: normalizeImageGenerationBackground(data.imageGenerationDefaults?.background),
        moderation: normalizeImageGenerationModeration(data.imageGenerationDefaults?.moderation),
        outputCompression: normalizeImageGenerationOutputCompression(
          data.imageGenerationDefaults?.outputCompression,
        ),
        count: normalizeImageGenerationCount(data.imageGenerationDefaults?.count),
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
    dialogueMode: useDisplayPreferencesStore.getState().defaultDialogueMode,
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
