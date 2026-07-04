import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMemoriesClient } from '@openAwork/web-client';
import { logger } from '../../../utils/log/logger.js';
import type {
  MemoryActionFeedback,
  MemoryCreateInput,
  MemoryEntry,
  MemoryLoadStatus,
  MemorySettings,
  MemoryStats,
  UseMemoryManagementResult,
} from './memory-types.js';

const DEFAULT_SETTINGS: MemorySettings = {
  enabled: true,
  autoExtract: true,
  maxTokenBudget: 2000,
  minConfidence: 0.3,
  autoWriteMinConfidence: 0.65,
  reviewLowConfidence: true,
};

const FEEDBACK_CLEAR_MS = 4000;

interface UseMemoryManagementInput {
  /**
   * 网关 URL —— 用 `createMemoriesClient(gatewayUrl)` 在每个回调里构造客户端，
   * 避免把整个 client 实例提升到 hook 顶层产生不必要的 re-render。
   */
  gatewayUrl: string;
  token: string | null;
  active: boolean;
}

interface MemoriesResponse {
  memories?: MemoryEntry[];
}

interface MemoryStatsResponse {
  stats?: MemoryStats;
}

interface MemorySettingsResponse {
  settings?: MemorySettings;
}

interface MemoryMutationResponse {
  memory?: MemoryEntry;
}

interface MemoryExtractResponse {
  extracted?: number;
  blocked?: number;
  created?: number;
  duplicates?: number;
  rejected?: number;
  reviewed?: number;
  updated?: number;
}

export function useMemoryManagement({
  gatewayUrl,
  token,
  active,
}: UseMemoryManagementInput): UseMemoryManagementResult {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<MemoryLoadStatus>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<MemoryLoadStatus>('idle');
  const [settings, setSettings] = useState<MemorySettings>(DEFAULT_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState<MemoryLoadStatus>('idle');
  const [actionFeedback, setActionFeedback] = useState<MemoryActionFeedback>({
    status: 'idle',
    message: null,
  });
  const [searchQuery, setSearchQuery] = useState('');

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);

  const showFeedback = useCallback((status: MemoryActionFeedback['status'], message: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setActionFeedback({ status, message });
    if (status === 'success' || status === 'error') {
      feedbackTimerRef.current = setTimeout(() => {
        setActionFeedback({ status: 'idle', message: null });
        feedbackTimerRef.current = null;
      }, FEEDBACK_CLEAR_MS);
    }
  }, []);

  const clearActionFeedback = useCallback(() => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setActionFeedback({ status: 'idle', message: null });
  }, []);

  const refreshMemories = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoadStatus('loading');
    setLoadError(null);
    try {
      const payload = (await createMemoriesClient(gatewayUrl).list(token)) as MemoriesResponse;
      setMemories(payload.memories ?? []);
      setLoadStatus('loaded');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '加载记忆列表失败';
      setLoadError(message);
      setLoadStatus('error');
      logger.error('failed to load memories', error);
    }
  }, [gatewayUrl, token]);

  const refreshStats = useCallback(async () => {
    if (!token) {
      return;
    }
    setStatsStatus('loading');
    try {
      const payload = (await createMemoriesClient(gatewayUrl).getStats(
        token,
      )) as MemoryStatsResponse;
      setStats(payload.stats ?? null);
      setStatsStatus('loaded');
    } catch (error: unknown) {
      setStatsStatus('error');
      logger.error('failed to load memory stats', error);
    }
  }, [gatewayUrl, token]);

  const loadSettings = useCallback(async () => {
    if (!token) {
      return;
    }
    setSettingsStatus('loading');
    try {
      const payload = (await createMemoriesClient(gatewayUrl).getSettings(
        token,
      )) as MemorySettingsResponse;
      setSettings(payload.settings ?? DEFAULT_SETTINGS);
      setSettingsStatus('loaded');
    } catch (error: unknown) {
      setSettingsStatus('error');
      logger.error('failed to load memory settings', error);
    }
  }, [gatewayUrl, token]);

  useEffect(() => {
    if (!active || !token || hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
    void Promise.all([refreshMemories(), refreshStats(), loadSettings()]);
  }, [active, token, refreshMemories, refreshStats, loadSettings]);

  const createMemory = useCallback(
    async (input: MemoryCreateInput) => {
      if (!token) {
        return;
      }
      showFeedback('pending', '正在创建记忆…');
      try {
        const payload = (await createMemoriesClient(gatewayUrl).create(token, {
          type: input.type,
          key: input.key,
          value: input.value,
          workspaceRoot: input.workspaceRoot.trim().length > 0 ? input.workspaceRoot.trim() : null,
          source: 'manual',
        })) as MemoryMutationResponse;
        if (payload.memory) {
          setMemories((previous) => [payload.memory!, ...previous]);
        }
        showFeedback('success', '记忆已创建');
        void refreshStats();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '创建记忆失败';
        showFeedback('error', message);
        logger.error('failed to create memory', error);
      }
    },
    [gatewayUrl, refreshStats, showFeedback, token],
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      if (!token) {
        return;
      }
      showFeedback('pending', '正在删除…');
      try {
        await createMemoriesClient(gatewayUrl).remove(token, id);
        setMemories((previous) => previous.filter((memory) => memory.id !== id));
        showFeedback('success', '已删除');
        void refreshStats();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '删除记忆失败';
        showFeedback('error', message);
        logger.error('failed to delete memory', error);
      }
    },
    [gatewayUrl, refreshStats, showFeedback, token],
  );

  const updateMemory = useCallback(
    async (id: string, value: string) => {
      if (!token) {
        return;
      }
      showFeedback('pending', '正在保存…');
      try {
        const payload = (await createMemoriesClient(gatewayUrl).update(token, id, {
          value,
        })) as MemoryMutationResponse;
        if (payload.memory) {
          setMemories((previous) =>
            previous.map((memory) => (memory.id === id ? payload.memory! : memory)),
          );
        }
        showFeedback('success', '已保存');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '更新记忆失败';
        showFeedback('error', message);
        logger.error('failed to update memory', error);
      }
    },
    [gatewayUrl, showFeedback, token],
  );

  const extractMemories = useCallback(async () => {
    if (!token) {
      return;
    }
    showFeedback('pending', '正在提取记忆…');
    try {
      const payload = (await createMemoriesClient(gatewayUrl).extract(
        token,
        {},
      )) as MemoryExtractResponse;
      const written = payload.extracted ?? payload.created ?? 0;
      const reviewed = payload.reviewed ?? 0;
      const skipped = (payload.duplicates ?? 0) + (payload.rejected ?? 0) + (payload.blocked ?? 0);
      showFeedback(
        'success',
        `已写入 ${String(written)} 条，待确认 ${String(reviewed)} 条，已跳过 ${String(skipped)} 条`,
      );
      await Promise.all([refreshMemories(), refreshStats()]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '提取记忆失败';
      showFeedback('error', message);
      logger.error('failed to extract memories', error);
    }
  }, [gatewayUrl, refreshMemories, refreshStats, showFeedback, token]);

  const updateSettings = useCallback(
    async (patch: Partial<MemorySettings>) => {
      if (!token) {
        return;
      }
      const previous = settings;
      const nextSettings = { ...settings, ...patch };
      setSettings(nextSettings);
      try {
        const payload = (await createMemoriesClient(gatewayUrl).putSettings(
          token,
          nextSettings,
        )) as MemorySettingsResponse;
        setSettings(payload.settings ?? nextSettings);
        showFeedback('success', '设置已保存');
      } catch (error: unknown) {
        setSettings(previous);
        const message = error instanceof Error ? error.message : '保存记忆设置失败';
        showFeedback('error', message);
        logger.error('failed to save memory settings', error);
      }
    },
    [gatewayUrl, settings, showFeedback, token],
  );

  const filteredMemories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return memories;
    }
    return memories.filter((memory) =>
      [memory.key, memory.value, memory.type, memory.source, memory.workspaceRoot ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [memories, searchQuery]);

  return {
    memories,
    loadStatus,
    loadError,
    stats,
    statsStatus,
    settings,
    settingsStatus,
    actionFeedback,
    clearActionFeedback,
    refreshMemories,
    refreshStats,
    createMemory,
    deleteMemory,
    updateMemory,
    extractMemories,
    updateSettings,
    searchQuery,
    setSearchQuery,
    filteredMemories,
  };
}
