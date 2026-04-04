import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '../../utils/logger.js';
import { readErrorMessage } from './settings-page-helpers.js';
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
};

const FEEDBACK_CLEAR_MS = 4000;

interface UseMemoryManagementInput {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
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
}

export function useMemoryManagement({
  apiFetch,
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
      const response = await apiFetch('/memories');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载记忆列表失败'));
      }
      const payload = (await response.json()) as MemoriesResponse;
      setMemories(payload.memories ?? []);
      setLoadStatus('loaded');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '加载记忆列表失败';
      setLoadError(message);
      setLoadStatus('error');
      logger.error('failed to load memories', error);
    }
  }, [apiFetch, token]);

  const refreshStats = useCallback(async () => {
    if (!token) {
      return;
    }
    setStatsStatus('loading');
    try {
      const response = await apiFetch('/memories/stats');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载记忆统计失败'));
      }
      const payload = (await response.json()) as MemoryStatsResponse;
      setStats(payload.stats ?? null);
      setStatsStatus('loaded');
    } catch (error: unknown) {
      setStatsStatus('error');
      logger.error('failed to load memory stats', error);
    }
  }, [apiFetch, token]);

  const loadSettings = useCallback(async () => {
    if (!token) {
      return;
    }
    setSettingsStatus('loading');
    try {
      const response = await apiFetch('/memories/settings');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载记忆设置失败'));
      }
      const payload = (await response.json()) as MemorySettingsResponse;
      setSettings(payload.settings ?? DEFAULT_SETTINGS);
      setSettingsStatus('loaded');
    } catch (error: unknown) {
      setSettingsStatus('error');
      logger.error('failed to load memory settings', error);
    }
  }, [apiFetch, token]);

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
        const response = await apiFetch('/memories', {
          method: 'POST',
          body: JSON.stringify({
            type: input.type,
            key: input.key,
            value: input.value,
            workspaceRoot:
              input.workspaceRoot.trim().length > 0 ? input.workspaceRoot.trim() : null,
            source: 'manual',
          }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '创建记忆失败'));
        }
        const payload = (await response.json()) as MemoryMutationResponse;
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
    [apiFetch, refreshStats, showFeedback, token],
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      if (!token) {
        return;
      }
      showFeedback('pending', '正在删除…');
      try {
        const response = await apiFetch(`/memories/${id}`, { method: 'DELETE' });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '删除记忆失败'));
        }
        setMemories((previous) => previous.filter((memory) => memory.id !== id));
        showFeedback('success', '已删除');
        void refreshStats();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '删除记忆失败';
        showFeedback('error', message);
        logger.error('failed to delete memory', error);
      }
    },
    [apiFetch, refreshStats, showFeedback, token],
  );

  const updateMemory = useCallback(
    async (id: string, value: string) => {
      if (!token) {
        return;
      }
      showFeedback('pending', '正在保存…');
      try {
        const response = await apiFetch(`/memories/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '更新记忆失败'));
        }
        const payload = (await response.json()) as MemoryMutationResponse;
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
    [apiFetch, showFeedback, token],
  );

  const extractMemories = useCallback(async () => {
    if (!token) {
      return;
    }
    showFeedback('pending', '正在提取记忆…');
    try {
      const response = await apiFetch('/memories/extract', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '提取记忆失败'));
      }
      const payload = (await response.json()) as MemoryExtractResponse;
      showFeedback('success', `已提取 ${String(payload.extracted ?? 0)} 条记忆`);
      await Promise.all([refreshMemories(), refreshStats()]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '提取记忆失败';
      showFeedback('error', message);
      logger.error('failed to extract memories', error);
    }
  }, [apiFetch, refreshMemories, refreshStats, showFeedback, token]);

  const updateSettings = useCallback(
    async (patch: Partial<MemorySettings>) => {
      if (!token) {
        return;
      }
      const previous = settings;
      const nextSettings = { ...settings, ...patch };
      setSettings(nextSettings);
      try {
        const response = await apiFetch('/memories/settings', {
          method: 'PUT',
          body: JSON.stringify(nextSettings),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, '保存记忆设置失败'));
        }
        const payload = (await response.json()) as MemorySettingsResponse;
        setSettings(payload.settings ?? nextSettings);
        showFeedback('success', '设置已保存');
      } catch (error: unknown) {
        setSettings(previous);
        const message = error instanceof Error ? error.message : '保存记忆设置失败';
        showFeedback('error', message);
        logger.error('failed to save memory settings', error);
      }
    },
    [apiFetch, settings, showFeedback, token],
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
