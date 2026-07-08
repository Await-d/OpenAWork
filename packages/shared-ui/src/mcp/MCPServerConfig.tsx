import { useState } from 'react';
import { MCPServerConfigForm } from './MCPServerConfigForm.js';
import { MCPServerConfigRow } from './MCPServerConfigRow.js';
import type { MCPServerConfigProps } from './mcp-server-config-model.js';
import {
  headerStyle,
  mcpServerConfigFocusVisibleCss,
  panelStyle,
} from './mcp-server-config-styles.js';

export type { MCPServerConfigProps, MCPServerEntry } from './mcp-server-config-model.js';

export function MCPServerConfig({
  servers,
  onAdd,
  onRemove,
  onUpdate,
  style,
}: MCPServerConfigProps) {
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <div data-openawork-mcp-server-config="true" style={{ ...panelStyle, ...style }}>
      <style>{mcpServerConfigFocusVisibleCss}</style>
      <div style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
          MCP 服务器配置
        </h2>
      </div>

      {servers.length === 0 ? (
        <div
          style={{
            color: 'var(--fg-muted)',
            fontSize: 12,
            padding: 'var(--spacing-5, 20px) var(--spacing-6, 24px)',
          }}
        >
          暂无服务器配置。添加同 id（如 websearch / grep_app）可覆盖或禁用系统内置 MCP。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {servers.map((server, index) => (
            <MCPServerConfigRow
              key={`${server.id}-${index}`}
              isLast={index === servers.length - 1}
              server={server}
              onRemove={onRemove}
              onUpdate={onUpdate}
              setFormError={setFormError}
            />
          ))}
        </div>
      )}

      <MCPServerConfigForm onAdd={onAdd} formError={formError} setFormError={setFormError} />
    </div>
  );
}
