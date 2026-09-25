/**
 * 设置 → 插件 → 插件市场（容器）。
 *
 * 数据接线在 `usePluginMarket`；渲染在 `PluginMarketView`（harness 同一入口）。
 */

import type { ReactElement } from 'react';
import { PluginMarketView } from './plugin-market-view.js';
import { usePluginMarket } from './use-plugin-market.js';

interface PluginMarketPanelProps {
  gatewayUrl: string;
  token: string | null;
}

export function PluginMarketPanel({ gatewayUrl, token }: PluginMarketPanelProps): ReactElement {
  const market = usePluginMarket({ gatewayUrl, token });

  return (
    <PluginMarketView
      sources={market.sources}
      entries={market.entries}
      failedSources={market.failedSources}
      loading={market.loading}
      error={market.error}
      busy={market.busy}
      statusMessage={market.statusMessage}
      detail={market.detail}
      detailLoading={market.detailLoading}
      onRefresh={(query) => void market.refresh(query)}
      onOpenEntry={(entry) => void market.openEntry(entry)}
      onCloseDetail={market.closeDetail}
      onInstall={(entry) => void market.installEntry(entry)}
      onAddSource={market.addSource}
      onRemoveSource={(sourceId) => void market.removeSource(sourceId)}
    />
  );
}
