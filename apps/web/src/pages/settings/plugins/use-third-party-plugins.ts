/**
 * 第三方插件管理 Hook——从网关加载 v2 插件平台清单，并执行安装/卸载/重载。
 *
 * 数据面：`createPluginsClient`（`GET /plugins`、`POST /plugins/install`、
 * `DELETE /plugins/:installId`、`POST /plugins/:installId/reload`）。
 */

import { useCallback, useEffect, useState } from 'react';
import { createPluginsClient } from '@openAwork/web-client';
import type { GatewayPluginInfo } from '@openAwork/web-client';

interface UseThirdPartyPluginsArgs {
  gatewayUrl: string;
  token: string | null;
}

export interface UseThirdPartyPluginsResult {
  /** 第三方插件（过滤掉 `source: 'internal'` 的内置组）。 */
  plugins: GatewayPluginInfo[];
  loading: boolean;
  /** 清单加载失败信息（`role="alert"`）。 */
  error: string | null;
  /** 安装/卸载/重载/启停进行中。 */
  busy: boolean;
  /** 最近一次操作结果（成功或失败文案）。 */
  statusMessage: string | null;
  /** 重新拉取清单（加载失败后的重试）。 */
  refresh: () => Promise<void>;
  install: (path: string, force: boolean) => Promise<boolean>;
  remove: (installId: string) => Promise<boolean>;
  reloadPlugin: (installId: string) => Promise<void>;
  disable: (pluginId: string) => Promise<void>;
  enable: (pluginId: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 统一的「busy + try/catch/finally」插件动作包装。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（条件 / 逻辑 / 三元），本 hook 6 处 try/catch/finally 会让它整体脱靶
 * （实测）。语义逐字照搬：`run` 的全流程仍在 try 内，catch 只做状态提示并返回
 * `failureValue`，finally 无条件清 busy。
 */
async function runPluginActionOnce<T>(ctx: {
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

export function useThirdPartyPlugins({
  gatewayUrl,
  token,
}: UseThirdPartyPluginsArgs): UseThirdPartyPluginsResult {
  const [plugins, setPlugins] = useState<GatewayPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    await runPluginActionOnce<void>({
      setBusy: setLoading,
      failureValue: undefined,
      onError: (err) => {
        setError(errorMessage(err));
      },
      run: async () => {
        const list = await createPluginsClient(gatewayUrl).list(token);
        setPlugins(list.filter((plugin) => plugin.source !== 'internal'));
        setError(null);
      },
    });
  }, [gatewayUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function install(path: string, force: boolean): Promise<boolean> {
    if (!token) return false;
    return runPluginActionOnce<boolean>({
      setBusy,
      failureValue: false,
      onError: (err) => {
        setStatusMessage(`安装失败：${errorMessage(err)}`);
      },
      run: async () => {
        const result = await createPluginsClient(gatewayUrl).install(token, { path, force });
        const state = result.plugin?.state;
        setStatusMessage(
          state === undefined || state === null
            ? `已安装 ${result.install.installId}。`
            : state.status === 'active'
              ? `已安装并激活 ${result.install.installId}。`
              : `已安装 ${result.install.installId}，但激活失败：${state.error ?? '未知错误'}`,
        );
        await load();
        return true;
      },
    });
  }

  async function remove(installId: string): Promise<boolean> {
    if (!token) return false;
    return runPluginActionOnce<boolean>({
      setBusy,
      failureValue: false,
      onError: (err) => {
        setStatusMessage(`卸载失败：${errorMessage(err)}`);
      },
      run: async () => {
        await createPluginsClient(gatewayUrl).remove(token, installId);
        setStatusMessage(`已卸载 ${installId}。`);
        await load();
        return true;
      },
    });
  }

  async function reloadPlugin(installId: string): Promise<void> {
    if (!token) return;
    await runPluginActionOnce<void>({
      setBusy,
      failureValue: undefined,
      onError: (err) => {
        setStatusMessage(`重载失败：${errorMessage(err)}`);
      },
      run: async () => {
        const result = await createPluginsClient(gatewayUrl).reload(token, installId);
        setStatusMessage(
          result.reloaded
            ? `已重载 ${installId}。`
            : `重载 ${installId} 未激活：${result.error ?? '未知错误'}`,
        );
        await load();
      },
    });
  }

  async function disable(pluginId: string): Promise<void> {
    if (!token) return;
    await runPluginActionOnce<void>({
      setBusy,
      failureValue: undefined,
      onError: (err) => {
        setStatusMessage(`停用失败：${errorMessage(err)}`);
      },
      run: async () => {
        await createPluginsClient(gatewayUrl).disable(token, pluginId);
        setStatusMessage(`已停用 ${pluginId}，可随时启用恢复。`);
        await load();
      },
    });
  }

  async function enable(pluginId: string): Promise<void> {
    if (!token) return;
    await runPluginActionOnce<void>({
      setBusy,
      failureValue: undefined,
      onError: (err) => {
        setStatusMessage(`启用失败：${errorMessage(err)}`);
      },
      run: async () => {
        const result = await createPluginsClient(gatewayUrl).enable(token, pluginId);
        setStatusMessage(
          result.enabled
            ? `已启用 ${pluginId}。`
            : `启用 ${pluginId} 未激活：${result.error ?? '未知错误'}`,
        );
        await load();
      },
    });
  }

  return {
    plugins,
    loading,
    error,
    busy,
    statusMessage,
    refresh: load,
    install,
    remove,
    reloadPlugin,
    disable,
    enable,
  };
}
