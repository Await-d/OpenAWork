/**
 * 插件市场 Hook——GitHub 源管理 + 清单/搜索 + 条目详情 + 一键安装。
 *
 * 数据面：`createPluginsClient` 的 market 方法组。
 * 展示层在 `PluginMarketView`（纯 props + 本地 UI 状态，供 harness 渲染）。
 */

import { useCallback, useEffect, useState } from 'react';
import { createPluginsClient } from '@openAwork/web-client';
import type {
  PluginMarketDetail,
  PluginMarketEntry,
  PluginMarketSource,
} from '@openAwork/web-client';

interface UsePluginMarketArgs {
  gatewayUrl: string;
  token: string | null;
}

export interface MarketSourceFailure {
  readonly sourceId: string;
  readonly error: string;
}

export interface UsePluginMarketResult {
  sources: PluginMarketSource[];
  entries: PluginMarketEntry[];
  failedSources: MarketSourceFailure[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  statusMessage: string | null;
  detail: PluginMarketDetail | null;
  detailLoading: boolean;
  refresh: (query?: string) => Promise<void>;
  openEntry: (entry: PluginMarketEntry) => Promise<void>;
  closeDetail: () => void;
  installEntry: (entry: PluginMarketEntry) => Promise<void>;
  addSource: (repo: string, ref?: string) => Promise<boolean>;
  removeSource: (sourceId: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePluginMarket({ gatewayUrl, token }: UsePluginMarketArgs): UsePluginMarketResult {
  const [sources, setSources] = useState<PluginMarketSource[]>([]);
  const [entries, setEntries] = useState<PluginMarketEntry[]>([]);
  const [failedSources, setFailedSources] = useState<MarketSourceFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<PluginMarketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(
    async (query?: string) => {
      if (!token) {
        setLoading(false);
        return;
      }
      const client = createPluginsClient(gatewayUrl);
      try {
        const [sourceList, listing] = await Promise.all([
          client.listMarketSources(token),
          client.searchMarket(token, query === undefined ? {} : { query }),
        ]);
        setSources(sourceList);
        setEntries(listing.entries);
        setFailedSources(listing.failedSources ?? []);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [gatewayUrl, token],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openEntry(entry: PluginMarketEntry): Promise<void> {
    if (!token) return;
    setDetailLoading(true);
    try {
      const result = await createPluginsClient(gatewayUrl).getMarketEntry(token, {
        sourceId: entry.sourceId,
        name: entry.name,
      });
      setDetail(result);
    } catch (err) {
      setStatusMessage(`读取详情失败：${errorMessage(err)}`);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail(): void {
    setDetail(null);
  }

  async function installEntry(entry: PluginMarketEntry): Promise<void> {
    if (!token) return;
    setBusy(true);
    try {
      const result = await createPluginsClient(gatewayUrl).installFromGithub(token, {
        repo: entry.repo,
        ...(entry.ref === undefined ? {} : { ref: entry.ref }),
        ...(entry.path.length > 0 ? { path: entry.path } : {}),
        name: entry.name,
      });
      const state = result.plugin?.state;
      setStatusMessage(
        state === undefined || state === null
          ? `已安装 ${entry.name}。`
          : state.status === 'active'
            ? `已安装并激活 ${entry.name}；可在「已安装插件」中管理。`
            : `已安装 ${entry.name}，但激活失败：${state.error ?? '未知错误'}`,
      );
      closeDetail();
    } catch (err) {
      setStatusMessage(`安装失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addSource(repo: string, ref?: string): Promise<boolean> {
    if (!token) return false;
    setBusy(true);
    try {
      const source = await createPluginsClient(gatewayUrl).addMarketSource(token, {
        repo,
        ...(ref === undefined || ref.trim().length === 0 ? {} : { ref: ref.trim() }),
      });
      setStatusMessage(`已添加源 ${source.id}。`);
      await refresh();
      return true;
    } catch (err) {
      setStatusMessage(`添加源失败：${errorMessage(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeSource(sourceId: string): Promise<void> {
    if (!token) return;
    setBusy(true);
    try {
      await createPluginsClient(gatewayUrl).removeMarketSource(token, sourceId);
      setStatusMessage(`已移除源 ${sourceId}。`);
      await refresh();
    } catch (err) {
      setStatusMessage(`移除源失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return {
    sources,
    entries,
    failedSources,
    loading,
    error,
    busy,
    statusMessage,
    detail,
    detailLoading,
    refresh,
    openEntry,
    closeDetail,
    installEntry,
    addSource,
    removeSource,
  };
}
