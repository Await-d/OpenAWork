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
    try {
      const list = await createPluginsClient(gatewayUrl).list(token);
      setPlugins(list.filter((plugin) => plugin.source !== 'internal'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function install(path: string, force: boolean): Promise<boolean> {
    if (!token) return false;
    setBusy(true);
    try {
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
    } catch (err) {
      setStatusMessage(`安装失败：${errorMessage(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(installId: string): Promise<boolean> {
    if (!token) return false;
    setBusy(true);
    try {
      await createPluginsClient(gatewayUrl).remove(token, installId);
      setStatusMessage(`已卸载 ${installId}。`);
      await load();
      return true;
    } catch (err) {
      setStatusMessage(`卸载失败：${errorMessage(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reloadPlugin(installId: string): Promise<void> {
    if (!token) return;
    setBusy(true);
    try {
      const result = await createPluginsClient(gatewayUrl).reload(token, installId);
      setStatusMessage(
        result.reloaded
          ? `已重载 ${installId}。`
          : `重载 ${installId} 未激活：${result.error ?? '未知错误'}`,
      );
      await load();
    } catch (err) {
      setStatusMessage(`重载失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable(pluginId: string): Promise<void> {
    if (!token) return;
    setBusy(true);
    try {
      await createPluginsClient(gatewayUrl).disable(token, pluginId);
      setStatusMessage(`已停用 ${pluginId}，可随时启用恢复。`);
      await load();
    } catch (err) {
      setStatusMessage(`停用失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function enable(pluginId: string): Promise<void> {
    if (!token) return;
    setBusy(true);
    try {
      const result = await createPluginsClient(gatewayUrl).enable(token, pluginId);
      setStatusMessage(
        result.enabled
          ? `已启用 ${pluginId}。`
          : `启用 ${pluginId} 未激活：${result.error ?? '未知错误'}`,
      );
      await load();
    } catch (err) {
      setStatusMessage(`启用失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
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
