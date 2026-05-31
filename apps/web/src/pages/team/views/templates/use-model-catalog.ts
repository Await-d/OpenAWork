/**
 * 加载用户真实配置的 provider / 模型目录（仅 enabled 项），供模板「模型池」勾选与
 * 智能分配使用。复用 chat 端的 `loadSavedChatSessionDefaultsResult`，保证与设置页
 * 的模型能力 / 价格元数据一致。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadSavedChatSessionDefaultsResult,
  type ChatSettingsProvider,
} from '../../../../utils/chat/chat-session-defaults.js';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import type { ModelCandidate } from './model-assignment.js';

export interface ModelCatalogState {
  providers: ChatSettingsProvider[];
  /** 扁平化的全部候选模型（带 provider 名）。 */
  allModels: ModelCandidate[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function toCandidates(providers: ChatSettingsProvider[]): ModelCandidate[] {
  const result: ModelCandidate[] = [];
  for (const provider of providers) {
    for (const model of provider.defaultModels) {
      result.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        label: model.label,
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
        ...(typeof model.supportsTools === 'boolean' ? { supportsTools: model.supportsTools } : {}),
        ...(typeof model.supportsThinking === 'boolean'
          ? { supportsThinking: model.supportsThinking }
          : {}),
        ...(typeof model.supportsVision === 'boolean'
          ? { supportsVision: model.supportsVision }
          : {}),
      });
    }
  }
  return result;
}

export function useModelCatalog(): ModelCatalogState {
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [providers, setProviders] = useState<ChatSettingsProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!accessToken) {
      setProviders([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadSavedChatSessionDefaultsResult(gatewayUrl, accessToken)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setProviders(result.data.providers);
          setError(null);
        } else {
          setError(result.errorMessage ?? '加载模型列表失败');
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '加载模型列表失败');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl, tick]);

  const allModels = useMemo(() => toCandidates(providers), [providers]);

  return { providers, allModels, loading, error, reload };
}
