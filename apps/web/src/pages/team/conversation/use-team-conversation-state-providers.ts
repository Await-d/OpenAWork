import { useEffect, useRef, useState } from 'react';
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

  // loadProviders 的重试回调需要再次调度自己；在自身初始化器内自引用会被编译器
  // 判为「声明前访问」而放弃优化整个 hook。用 ref 持有最新实现打断自引用。
  const loadProvidersRef = useRef<() => Promise<void>>(async () => {});

  // 去 useCallback 包装：编译器会对函数表达式自动 memoize（引用稳定性与手写等价），
  // 而保留手写 memo 恰恰会让编译器报「Existing memoization could not be preserved」
  // 放弃优化整个 hook。上面的 loadProvidersRef 仍负责打断自引用。
  const loadProviders = async (): Promise<void> => {
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
          void loadProvidersRef.current();
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
  };

  // 与 loadProvidersRef 配对：声明后立即（首个 commit 内）同步，重试回调触发时
  // 读到的必是最新实现。
  useEffect(() => {
    loadProvidersRef.current = loadProviders;
  }, [loadProviders]);

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
