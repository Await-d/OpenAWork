import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { createSettingsClient } from '@openAwork/web-client';

import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';

type UseModelContextOverrideDeps = {
  readonly activeModelId: string;
  readonly activeProviderId: string;
  readonly gatewayUrl: string;
  readonly setProviders: Dispatch<SetStateAction<ChatSettingsProvider[]>>;
  readonly token: string | null;
};

/**
 * 保存「上下文窗口挡位」覆盖值：写回设置服务，并就地更新本地 provider 列表。
 *
 * 从 `ChatPage` 抽出的纯装配逻辑，行为与依赖数组逐字保留。
 */
export function useModelContextOverride(deps: UseModelContextOverrideDeps) {
  const { activeModelId, activeProviderId, gatewayUrl, setProviders, token } = deps;

  return useCallback(
    async (value: number | undefined) => {
      if (!token || !activeProviderId || !activeModelId) {
        throw new Error('当前模型尚未准备好，无法保存上下文挡位。');
      }

      const result = await createSettingsClient(gatewayUrl).putModelContext(token, {
        providerId: activeProviderId,
        modelId: activeModelId,
        contextWindowOverride: value ?? null,
      });
      setProviders((previous) =>
        previous.map((provider) => {
          if (provider.id !== result.providerId) return provider;
          return {
            ...provider,
            defaultModels: provider.defaultModels.map((model) => {
              if (model.id !== result.modelId) return model;
              if (result.contextWindowOverride === null) {
                const { contextWindowOverride: _removed, ...rest } = model;
                return rest;
              }
              return { ...model, contextWindowOverride: result.contextWindowOverride };
            }),
          };
        }),
      );
    },
    [activeModelId, activeProviderId, gatewayUrl, setProviders, token],
  );
}
