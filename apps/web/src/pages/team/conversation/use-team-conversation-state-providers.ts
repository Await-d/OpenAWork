import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSavedChatSessionDefaultsResult,
  type ChatSettingsProvider,
} from '../../../utils/chat/chat-session-defaults.js';
import type { ReasoningEffort } from '../../../components/conversation-runtime/messages/support.js';
import type { UseTeamConversationStateOptions } from './team-conversation-state-contract.js';
import {
  computeTeamConversationProvidersRetryDelay,
  formatTeamConversationProvidersLoadError,
} from './team-conversation-load-policy.js';
import { useRecoverableRetryController } from '../hooks/use-recoverable-retry.js';

export interface UseTeamConversationProvidersOptions {
  token: string | null;
  gatewayUrl: string;
  enableWriters: boolean;
  defaults: UseTeamConversationStateOptions['defaults'];
  providers: ChatSettingsProvider[];
  setProviders: React.Dispatch<React.SetStateAction<ChatSettingsProvider[]>>;
  setProvidersError: React.Dispatch<React.SetStateAction<string | null>>;
  activeProviderId: string;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  activeModelId: string;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  setThinkingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setReasoningEffort: React.Dispatch<React.SetStateAction<ReasoningEffort>>;
}

export interface UseTeamConversationProvidersResult {
  loadProviders: () => Promise<void>;
}

export function useTeamConversationProviders(
  options: UseTeamConversationProvidersOptions,
): UseTeamConversationProvidersResult {
  const {
    token,
    gatewayUrl,
    enableWriters,
    defaults,
    providers,
    setProviders,
    setProvidersError,
    activeProviderId,
    setActiveProviderId,
    activeModelId,
    setActiveModelId,
    setThinkingEnabled,
    setReasoningEffort,
  } = options;

  const providersRef = useRef<ChatSettingsProvider[]>([]);
  const providersLoadedRef = useRef(false);
  const {
    clearRetry: clearProvidersRetry,
    resetRetry: resetProvidersRetry,
    scheduleRetry: scheduleProvidersRetry,
  } = useRecoverableRetryController();

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  const loadProviders = useCallback(async (): Promise<void> => {
    if (!token) return;
    clearProvidersRetry();
    const hasCachedProviders = providersRef.current.length > 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setProvidersError(
        formatTeamConversationProvidersLoadError({
          hasCachedProviders,
          result: {
            errorMessage: '当前网络离线，Provider 列表暂时不可用。',
            retryable: true,
          },
        }),
      );
      return;
    }
    const result = await loadSavedChatSessionDefaultsResult(gatewayUrl, token);
    if (!result.ok || !result.data) {
      const nextRetryAtMs = scheduleProvidersRetry({
        computeDelay: computeTeamConversationProvidersRetryDelay,
        onRetry: () => {
          void loadProviders();
        },
        retryable: result.retryable,
      });
      setProvidersError(
        formatTeamConversationProvidersLoadError({
          hasCachedProviders,
          nextRetryAtMs,
          result,
        }),
      );
      return;
    }

    resetProvidersRetry();
    setProviders(result.data.providers);
    setProvidersError(null);
    // 注意：team 端只接受 provider/model 与模型思考默认值，不写 chat-only
    // 偏好（dialogueMode / yoloMode / webSearchEnabled 等）。
    if (!activeProviderId && result.data.defaults.providerId) {
      setActiveProviderId(result.data.defaults.providerId);
    }
    if (!activeModelId && result.data.defaults.modelId) {
      setActiveModelId(result.data.defaults.modelId);
    }
    if (defaults?.thinkingEnabled === undefined) {
      setThinkingEnabled(result.data.defaults.thinkingEnabled);
    }
    if (defaults?.reasoningEffort === undefined) {
      setReasoningEffort(result.data.defaults.reasoningEffort);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeModelId,
    activeProviderId,
    defaults?.reasoningEffort,
    defaults?.thinkingEnabled,
    clearProvidersRetry,
    gatewayUrl,
    resetProvidersRetry,
    scheduleProvidersRetry,
    token,
  ]);

  useEffect(() => {
    if (!enableWriters || providersLoadedRef.current) return;
    if (!token) return;
    providersLoadedRef.current = true;
    void loadProviders();
  }, [enableWriters, token, loadProviders]);

  useEffect(() => {
    return () => {
      clearProvidersRetry();
    };
  }, [clearProvidersRetry]);

  useEffect(() => {
    if (!enableWriters || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      if (providersLoadedRef.current) {
        void loadProviders();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [enableWriters, loadProviders]);

  return { loadProviders };
}
