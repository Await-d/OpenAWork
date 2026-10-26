import type { CSSProperties } from 'react';

import type { AIModelConfigItem, ProviderModelTestResult } from './ModelManager.js';
import type { UpstreamModelItem, UpstreamModelsResult } from './UpstreamModelsPanel.js';
import type { SupportedReasoningEffort } from './model-reasoning-support.js';

export interface AIModelConfigRef {
  id: string;
  label: string;
  enabled: boolean;
  autoCompactTargetRatio?: number;
  autoCompactThresholdRatio?: number;
  contextWindow?: number;
  contextWindowOverride?: number;
  inputPricePerMillion?: number;
  maxOutputTokens?: number;
  outputPricePerMillion?: number;
  supportsImageGeneration?: boolean;
  supportsImageGeneration4K?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsThinking?: boolean;
  reasoningOptions?: { type: string; values?: string[] }[];
}

export interface AIProviderRef {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  openaiFastMode?: boolean;
  /** Override the auto-detected upstream protocol.
   *  - 'responses':       Use OpenAI Responses API (/v1/responses)
   *  - 'chat_completions': Use OpenAI Chat Completions API (/v1/chat/completions)
   *  - undefined:          Auto-detect based on provider type and base URL
   */
  upstreamProtocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
  defaultModels: AIModelConfigRef[];
}

export interface ActiveSelectionRef {
  chat: { providerId: string; modelId: string };
  fast: { providerId: string; modelId: string };
  image?: { providerId: string; modelId: string };
  compaction?: { providerId: string; modelId: string };
}

export interface ImageGenerationDefaultsRef {
  size: string;
  quality: 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  background: 'auto' | 'opaque';
}

export type ReasoningEffortRef = SupportedReasoningEffort;

export interface ThinkingModeRef {
  enabled: boolean;
  effort: ReasoningEffortRef;
}

export interface ThinkingDefaultsRef {
  chat: ThinkingModeRef;
  fast: ThinkingModeRef;
}

export interface ProviderEditData {
  name: string;
  type: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  openaiFastMode?: boolean;
  upstreamProtocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
}

export interface ProviderSettingsProps {
  providers: AIProviderRef[];
  active: ActiveSelectionRef;
  defaultThinking?: ThinkingDefaultsRef;
  imageDefaults?: ImageGenerationDefaultsRef;
  hasUnsavedDefaultChanges?: boolean;
  isSavingDefaultChanges?: boolean;
  onSetActiveChat: (providerId: string, modelId: string) => void;
  onSetActiveFast?: (providerId: string, modelId: string) => void;
  onSetActiveImage?: (providerId: string, modelId: string) => void;
  onSaveDefaultChanges?: () => void;
  onSetThinkingMode?: (mode: keyof ThinkingDefaultsRef, value: ThinkingModeRef) => void;
  onSetImageDefaults?: (updates: Partial<ImageGenerationDefaultsRef>) => void;
  onToggleProvider?: (id: string) => void;
  onEditProvider: (id: string, data: ProviderEditData) => void;
  onAddProvider: (data: ProviderEditData) => void;
  /** 移除自定义提供商（内置平台仅支持禁用，后端会重新播种）。 */
  onRemoveProvider?: (id: string) => void;
  onToggleModel?: (providerId: string, modelId: string) => void;
  onAddModel?: (providerId: string, model: AIModelConfigRef) => void;
  onRemoveModel?: (providerId: string, modelId: string) => void;
  onUpdateModel?: (providerId: string, modelId: string, updates: Partial<AIModelConfigRef>) => void;
  /** 连通性自检回调：对指定 provider+模型发起最小化上游调用并返回结果。 */
  onTestModel?: (providerId: string, modelId: string) => Promise<ProviderModelTestResult>;
  /** 手动从 models.dev 同步内置模型目录（透传给每个 provider 的 ModelManager）。 */
  onSyncCatalog?: () => Promise<{
    ok: boolean;
    providerCount?: number;
    modelCount?: number;
    message?: string;
  }>;
  /** 拉取指定接口上游实际可用的模型列表(透传给每个 provider 的 ModelManager)。 */
  onFetchUpstreamModels?: (providerId: string) => Promise<UpstreamModelsResult>;
  /** 把选中的上游模型批量并入指定 provider 的模型列表(透传给 ModelManager)。 */
  onImportUpstreamModels?: (providerId: string, models: UpstreamModelItem[]) => void;
  /** 批量更新多个模型的字段(透传给 ModelManager 的「批量设置思考档位」,合并为一次保存)。 */
  onBatchUpdateModels?: (
    providerId: string,
    updates: Array<{ modelId: string; updates: Partial<AIModelConfigItem> }>,
  ) => void;
  /** 从 models.dev 发现尚未内置的平台。 */
  onDiscoverProviders?: () => Promise<{
    providers: Array<{
      id: string;
      name: string;
      api?: string;
      modelCount: number;
      sampleModels?: Array<{ id: string; name: string }>;
    }>;
  }>;
  /** 导入发现到的平台为 custom provider。 */
  onImportDiscoveredProvider?: (modelsDevProviderId: string) => Promise<void>;
  style?: CSSProperties;
}
