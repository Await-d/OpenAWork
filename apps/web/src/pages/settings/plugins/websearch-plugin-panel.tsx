import React from 'react';
import { McpServerManager } from '@openAwork/shared-ui';
import type { MCPServerEntry, MCPServerStatus } from '@openAwork/shared-ui';
import { WebsearchSection } from '../connection/websearch-section.js';
import type { WebsearchPolicy } from '../connection/use-settings-websearch.js';

interface WebsearchPluginPanelProps {
  isSaving: boolean;
  policy: WebsearchPolicy;
  savedPolicy: WebsearchPolicy;
  setPolicy: React.Dispatch<React.SetStateAction<WebsearchPolicy>>;
  searchServers: MCPServerEntry[];
  searchStatuses: MCPServerStatus[];
  onRemoveMcp: (id: string) => void;
  onRetryMcp: (serverId: string) => void;
  onSave: () => void;
  onUpdateMcp: (id: string, entry: MCPServerEntry) => void;
  loadError: string | null;
  mcpLoadError: string | null;
  saveError: string | null;
}

/**
 * 设置 → 插件 → Web 搜索。
 *
 * 旧版顶部有 3 个 KPI 卡 + 「默认搜索路径」卡，占了半屏却只重复列表里
 * 已有的信息；现在压成一行摘要文案，正文直接进入搜索 MCP 单列表与
 * Provider 回退策略。
 */
export function WebsearchPluginPanel({
  isSaving,
  policy,
  savedPolicy,
  setPolicy,
  searchServers,
  searchStatuses,
  onRemoveMcp,
  onRetryMcp,
  onSave,
  onUpdateMcp,
  loadError,
  mcpLoadError,
  saveError,
}: WebsearchPluginPanelProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.6 }}>
        默认使用 Gateway 内置、免 Key 的 Open WebSearch；Exa 作为可选商业搜索补充。下方 Provider
        回退策略决定搜索服务不可用时的原生搜索顺序。
      </div>

      {loadError ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 11, lineHeight: 1.5 }}>
          {loadError}
        </div>
      ) : null}

      {mcpLoadError ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 11, lineHeight: 1.5 }}>
          {mcpLoadError}
        </div>
      ) : null}

      <McpServerManager
        title="搜索 MCP"
        servers={searchServers}
        statuses={searchStatuses}
        onRemove={onRemoveMcp}
        onUpdate={onUpdateMcp}
        onRetry={onRetryMcp}
        showAddForm={false}
        emptyHint="暂无搜索 MCP；Open WebSearch 由 Gateway 内置，重启或重试后会自动出现。"
      />

      <WebsearchSection
        isSaving={isSaving}
        policy={policy}
        savedPolicy={savedPolicy}
        setPolicy={setPolicy}
        onSave={onSave}
        saveError={saveError}
      />
    </div>
  );
}
