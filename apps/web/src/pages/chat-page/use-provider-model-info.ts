import { useEffect, useMemo } from 'react';
import { canConfigureThinkingForModel } from '@openAwork/shared-ui';
import type { ChatSettingsProvider } from '../../utils/chat-session-defaults.js';

export interface ProviderModelInfoDeps {
  providers: ChatSettingsProvider[];
  activeProviderId: string;
  activeModelId: string;
  setActiveProviderId: (value: string) => void;
  setActiveModelId: (value: string) => void;
}

export interface ProviderModelInfoReturn {
  activeProvider: ChatSettingsProvider | undefined;
  providerCatalog: Map<string, { id: string; name: string; type: string }>;
  activeModelOption: ChatSettingsProvider['defaultModels'][number] | undefined;
  activeModelCanConfigureThinking: boolean;
  activeModelTooltip: string;
}

export function useProviderModelInfo(deps: ProviderModelInfoDeps): ProviderModelInfoReturn {
  const { providers, activeProviderId, activeModelId, setActiveProviderId, setActiveModelId } =
    deps;

  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
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
  const activeModelOption = activeProvider?.defaultModels.find(
    (model) => model.id === activeModelId,
  );
  const activeModelCanConfigureThinking = canConfigureThinkingForModel(
    activeProvider?.type,
    activeModelOption?.id ?? activeModelId,
  );
  const activeModelTooltip = activeModelOption?.label
    ? `当前使用模型：${activeProvider?.name ? `${activeProvider.name} / ` : ''}${activeModelOption.label}`
    : activeProvider?.name
      ? `当前使用提供商：${activeProvider.name}`
      : '当前使用模型';

  useEffect(() => {
    if (providers.length === 0) {
      return;
    }

    const fallbackProvider = providers.find((provider) => provider.defaultModels.length > 0);
    const nextProvider =
      providers.find(
        (provider) => provider.id === activeProviderId && provider.defaultModels.length > 0,
      ) ?? fallbackProvider;
    const nextModel = nextProvider?.defaultModels.find((model) => model.id === activeModelId);
    const fallbackModel = nextProvider?.defaultModels[0];
    const nextProviderId = nextProvider?.id ?? '';
    const nextModelId = nextModel?.id ?? fallbackModel?.id ?? '';

    if (activeProviderId !== nextProviderId) {
      setActiveProviderId(nextProviderId);
    }

    if (activeModelId !== nextModelId) {
      setActiveModelId(nextModelId);
    }
  }, [providers, activeProviderId, activeModelId, setActiveProviderId, setActiveModelId]);

  return {
    activeProvider,
    providerCatalog,
    activeModelOption,
    activeModelCanConfigureThinking,
    activeModelTooltip,
  };
}
