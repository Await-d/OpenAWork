import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { createSettingsClient } from '@openAwork/web-client';

import type { ChatSettingsProvider } from '../../../utils/chat/chat-session-defaults.js';

type UseProviderFastModeDeps = {
  readonly activeProviderType: string | undefined;
  readonly effectiveProviderId: string;
  readonly gatewayUrl: string;
  readonly setProviders: Dispatch<SetStateAction<ChatSettingsProvider[]>>;
  readonly token: string | null;
};

/**
 * 切换 OpenAI Provider 的 fast mode：写回设置服务并就地更新本地 provider 列表。
 */
export function useProviderFastMode(deps: UseProviderFastModeDeps) {
  const { activeProviderType, effectiveProviderId, gatewayUrl, setProviders, token } = deps;

  return useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!token || !effectiveProviderId || activeProviderType !== 'openai') {
        throw new Error('当前没有可配置的 OpenAI Provider。');
      }

      await createSettingsClient(gatewayUrl).putProviderFastMode(token, {
        providerId: effectiveProviderId,
        enabled,
      });
      setProviders((current) =>
        current.map((provider) =>
          provider.id === effectiveProviderId
            ? { ...provider, openaiFastMode: enabled ? true : undefined }
            : provider,
        ),
      );
    },
    [activeProviderType, effectiveProviderId, gatewayUrl, setProviders, token],
  );
}
