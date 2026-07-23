import { useEffect, useMemo } from 'react';
import { canConfigureThinkingForModel } from '@openAwork/shared-ui';
import type { ChatSettingsProvider } from '../../../../utils/chat/chat-session-defaults.js';
import { resolveEffectiveChatModelSelection } from './resolve-effective-chat-model-selection.js';

export interface ProviderModelInfoDeps {
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;
  defaultProviderId?: string | null;
  defaultModelId?: string | null;
  setActiveProviderId: (value: string) => void;
  setActiveModelId: (value: string) => void;
}

export interface ProviderModelInfoReturn {
  activeProvider: ChatSettingsProvider | undefined;
  providerCatalog: Map<string, { id: string; name: string; type: string }>;
  activeModelOption: ChatSettingsProvider['defaultModels'][number] | undefined;
  activeModelCanConfigureThinking: boolean;
  activeModelTooltip: string;
  effectiveModelId: string;
  effectiveProviderId: string;
  rawModelSelectionInvalid: boolean;
}

export function useProviderModelInfo(deps: ProviderModelInfoDeps): ProviderModelInfoReturn {
  const {
    activeModelId,
    activeProviderId,
    defaultModelId,
    defaultProviderId,
    providers,
    setActiveModelId,
    setActiveProviderId,
  } = deps;
  const effectiveSelection = useMemo(
    () =>
      resolveEffectiveChatModelSelection({
        defaultModelId,
        defaultProviderId,
        providers,
        selectedModelId: activeModelId,
        selectedProviderId: activeProviderId,
      }),
    [activeModelId, activeProviderId, defaultModelId, defaultProviderId, providers],
  );
  const activeProvider = effectiveSelection.provider ?? undefined;
  const activeModelOption = effectiveSelection.model ?? undefined;
  const providerCatalog = useMemo(
    () =>
      new Map(
        providers.map((provider) => [
          provider.id,
          { id: provider.id, name: provider.name, type: provider.type },
        ]),
      ),
    [providers],
  );
  const activeModelCanConfigureThinking = canConfigureThinkingForModel(
    activeProvider?.type,
    activeModelOption?.id ?? effectiveSelection.modelId,
    activeModelOption?.supportsThinking === true,
  );
  const activeModelTooltip = activeModelOption?.label
    ? `当前使用模型：${activeProvider?.name ? `${activeProvider.name} / ` : ''}${activeModelOption.label}${effectiveSelection.rawSelectionInvalid ? '（会话绑定模型不可用，已回退）' : ''}`
    : activeProvider?.name
      ? `当前使用提供商：${activeProvider.name}`
      : '当前使用模型';

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    if (!activeProviderId && effectiveSelection.providerId) {
      setActiveProviderId(effectiveSelection.providerId);
    }

    if (!activeModelId && effectiveSelection.modelId) {
      setActiveModelId(effectiveSelection.modelId);
    }
  }, [
    activeModelId,
    activeProviderId,
    effectiveSelection.modelId,
    effectiveSelection.providerId,
    providers,
    setActiveModelId,
    setActiveProviderId,
  ]);

  return {
    activeProvider,
    providerCatalog,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
    effectiveModelId: effectiveSelection.modelId,
    effectiveProviderId: effectiveSelection.providerId,
    rawModelSelectionInvalid: effectiveSelection.rawSelectionInvalid,
  };
}
