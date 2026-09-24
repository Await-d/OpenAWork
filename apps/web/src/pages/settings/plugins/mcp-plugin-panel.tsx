import type { ReactElement } from 'react';
import { McpServerManager } from '@openAwork/shared-ui';
import type { MCPServerEntry, MCPServerStatus } from '@openAwork/shared-ui';

interface McpPluginPanelProps {
  servers: MCPServerEntry[];
  statuses: MCPServerStatus[];
  onAdd: (entry: MCPServerEntry) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, entry: MCPServerEntry) => void;
  onRetry: (serverId: string) => void;
  loadError?: string | null;
}

/**
 * 设置 → 插件 → MCP 服务器。
 *
 * 配置与运行状态合并进 `McpServerManager` 的单列表：每行同时给出
 * 名称/来源/状态/工具数与全部操作，编辑与新增按需展开，取代旧的
 * 「配置卡片 + 状态卡片」上下堆叠布局。
 */
export function McpPluginPanel({
  servers,
  statuses,
  onAdd,
  onRemove,
  onUpdate,
  onRetry,
  loadError,
}: McpPluginPanelProps): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {loadError ? (
        <div role="alert" style={{ color: 'var(--danger)', fontSize: 11, lineHeight: 1.5 }}>
          {loadError}
        </div>
      ) : null}

      <McpServerManager
        servers={servers}
        statuses={statuses}
        onAdd={onAdd}
        onRemove={onRemove}
        onUpdate={onUpdate}
        onRetry={onRetry}
      />
    </div>
  );
}
