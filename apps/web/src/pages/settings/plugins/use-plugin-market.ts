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

/**
 * 统一的「busy + try/catch/finally」插件市场动作包装。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（条件 / 逻辑 / 三元），本 hook 5 处 try/catch/finally 会让它整体脱靶
 * （实测）。语义逐字照搬：`run` 的全流程仍在 try 内，catch 只做状态提示并返回
 * `failureValue`，finally 无条件清 busy。
 */
async function runMarketActionOnce<T>(ctx: {
  setBusy: (busy: boolean) => void;
  /** catch 时的返回值（void 动作传 undefined，布尔动作传 false）。 */
  failureValue: T;
  onError: (error: unknown) => void;
  run: () => Promise<T>;
}): Promise<T> {
  ctx.setBusy(true);
  try {
    return await ctx.run();
  } catch (err) {
    ctx.onError(err);
    return ctx.failureValue;
  } finally {
    ctx.setBusy(false);
  }
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
      await runMarketActionOnce<void>({
        setBusy: setLoading,
        failureValue: undefined,
        onError: (err) => {
          setError(errorMessage(err));
        },
        run: async () => {
          const [sourceList, listing] = await Promise.all([
            client.listMarketSources(token),
            client.searchMarket(token, query === undefined ? {} : { query }),
          ]);
          setSources(sourceList);
          setEntries(listing.entries);
          setFailedSources(listing.failedSources ?? []);
          setError(null);
        },
      });
    },
    [gatewayUrl, token],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openEntry(entry: PluginMarketEntry): Promise<void> {
    if (!token) return;
    await runMarketActionOnce<void>({
      setBusy: setDetailLoading,
      failureValue: undefined,
      onError: (err) => {
        setStatusMessage(`读取详情失败：${errorMessage(err)}`);
      },
      run: async () => {
        const result = await createPluginsClient(gatewayUrl).getMarketEntry(token, {
          sourceId: entry.sourceId,
          name: entry.name,
        });
        setDetail(result);
      },
    });
  }

  function closeDetail(): void {
    setDetail(null);
  }

  async function installEntry(entry: PluginMarketEntry): Promise<void> {
    if (!token) return;
    await runMarketActionOnce<void>({
      setBusy,
      failureValue: undefined,
      onError: (err) => {
        setStatusMessage(`安装失败：${errorMessage(err)}`);
      },
      run: async () => {
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
      },
    });
  }

  async function addSource(repo: string, ref?: string): Promise<boolean> {
    if (!token) return false;
    return runMarketActionOnce<boolean>({
      setBusy,
      failureValue: false,
      onError: (err) => {
        setStatusMessage(`添加源失败：${errorMessage(err)}`);
      },
      run: async () => {
        const source = await createPluginsClient(gatewayUrl).addMarketSource(token, {
          repo,
          ...(ref === undefined || ref.trim().length === 0 ? {} : { ref: ref.trim() }),
        });
        setStatusMessage(`已添加源 ${source.id}。`);
        await refresh();
        return true;
      },
    });
  }

  async function removeSource(sourceId: string): Promise<void> {
    if (!token) return;
    await runMarketActionOnce<void>({
      setBusy,
      failureValue: undefined,
      onError: (err) => {
        setStatusMessage(`移除源失败：${errorMessage(err)}`);
      },
      run: async () => {
        await createPluginsClient(gatewayUrl).removeMarketSource(token, sourceId);
        setStatusMessage(`已移除源 ${sourceId}。`);
        await refresh();
      },
    });
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
