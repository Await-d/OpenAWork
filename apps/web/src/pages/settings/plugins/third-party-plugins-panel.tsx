/**
 * 设置 → 插件 → 已安装插件（容器）。
 *
 * 数据加载与操作接线在 `useThirdPartyPlugins`；渲染在
 * `ThirdPartyPluginsView`（harness 用 fixture 直接渲染该视图做真实浏览器验收）。
 */

import type { ReactElement } from 'react';
import { ThirdPartyPluginsView } from './third-party-plugins-view.js';
import { useThirdPartyPlugins } from './use-third-party-plugins.js';

interface ThirdPartyPluginsPanelProps {
  gatewayUrl: string;
  token: string | null;
}

export function ThirdPartyPluginsPanel({
  gatewayUrl,
  token,
}: ThirdPartyPluginsPanelProps): ReactElement {
  const {
    plugins,
    loading,
    error,
    busy,
    statusMessage,
    refresh,
    install,
    remove,
    reloadPlugin,
    disable,
    enable,
  } = useThirdPartyPlugins({ gatewayUrl, token });

  return (
    <ThirdPartyPluginsView
      plugins={plugins}
      loading={loading}
      error={error}
      busy={busy}
      statusMessage={statusMessage}
      onRefresh={() => void refresh()}
      onInstall={install}
      onRemove={(installId) => void remove(installId)}
      onReload={(installId) => void reloadPlugin(installId)}
      onDisable={(pluginId) => void disable(pluginId)}
      onEnable={(pluginId) => void enable(pluginId)}
    />
  );
}
