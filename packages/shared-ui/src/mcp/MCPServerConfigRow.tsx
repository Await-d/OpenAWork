import type { CSSProperties } from 'react';
import { ServerAdvancedFields, TransportEditor } from './MCPServerConfigAdvancedFields.js';
import type { MCPServerEntry } from './mcp-server-config-model.js';
import {
  getMcpServerTransport,
  isProtectedBuiltinMcpEndpoint,
  sanitizeProtectedMcpEndpoint,
  splitMcpList,
} from './mcp-server-config-utils.js';
import {
  badgeStyle,
  dangerButtonStyle,
  gridStyle,
  inputBase,
  labelStyle,
  lockedInputStyle,
} from './mcp-server-config-styles.js';

interface MCPServerConfigRowProps {
  isLast: boolean;
  server: MCPServerEntry;
  onRemove: (id: string) => void;
  onUpdate?: (id: string, entry: MCPServerEntry) => void;
  setFormError: (message: string | null) => void;
}

export function MCPServerConfigRow({
  isLast,
  server,
  onRemove,
  onUpdate,
  setFormError,
}: MCPServerConfigRowProps) {
  const currentTransport = getMcpServerTransport(server);
  const isEndpointLocked = isProtectedBuiltinMcpEndpoint(server);
  const update = (patch: Partial<MCPServerEntry>) => {
    onUpdate?.(server.id, sanitizeProtectedMcpEndpoint({ ...server, ...patch }));
  };
  const rowStyle: CSSProperties = {
    borderBottom: isLast ? 'none' : '1px solid var(--border-default)',
    display: 'grid',
    gap: 'var(--spacing-3, 12px)',
    padding: 'var(--spacing-3, 12px) var(--spacing-6, 24px)',
  };

  return (
    <div data-mcp-row={server.id} style={rowStyle}>
      <div style={gridStyle}>
        <input
          aria-label="MCP ID"
          readOnly={isEndpointLocked}
          value={server.id}
          onChange={(event) => update({ id: event.target.value.trim() })}
          style={isEndpointLocked ? lockedInputStyle : inputBase}
        />
        <input
          aria-label="MCP 名称"
          readOnly={isEndpointLocked}
          value={server.name}
          onChange={(event) => update({ name: event.target.value })}
          style={isEndpointLocked ? lockedInputStyle : inputBase}
        />
        <label style={{ ...labelStyle, alignSelf: 'center', marginBottom: 0 }}>
          <input
            checked={server.enabled !== false}
            onChange={(event) => update({ enabled: event.target.checked })}
            type="checkbox"
          />{' '}
          启用
        </label>
        <button
          type="button"
          data-mcp-danger-action="true"
          onClick={() => onRemove(server.id)}
          style={dangerButtonStyle}
        >
          {server.builtin ? (server.source === 'builtin' ? '禁用' : '恢复默认') : '移除'}
        </button>
      </div>

      {server.builtin || server.required || isEndpointLocked ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2, 8px)' }}>
          {server.builtin ? (
            <span style={badgeStyle} title="系统内置 MCP，可通过同 id 用户配置覆盖">
              系统内置
            </span>
          ) : null}
          {isEndpointLocked ? (
            <span style={badgeStyle} title="运行时内置桥接，无需配置 command 或 url">
              内置桥接
            </span>
          ) : null}
          {server.required ? (
            <span style={badgeStyle} title="required=true，启动时应优先保持可用">
              required
            </span>
          ) : null}
        </div>
      ) : null}

      <div style={gridStyle}>
        {isEndpointLocked ? (
          <input
            aria-label="MCP 内置桥接"
            readOnly
            value="运行时内置桥接，无需 command / url"
            style={lockedInputStyle}
          />
        ) : (
          <TransportEditor server={server} transport={currentTransport} onUpdate={update} />
        )}
        <input
          aria-label="禁用工具"
          placeholder="disabledTools，逗号分隔"
          value={(server.disabledTools ?? []).join(', ')}
          onChange={(event) => update({ disabledTools: splitMcpList(event.target.value) })}
          style={inputBase}
        />
      </div>

      {isEndpointLocked ? null : (
        <ServerAdvancedFields
          server={server}
          transport={currentTransport}
          onUpdate={update}
          setFormError={setFormError}
        />
      )}
    </div>
  );
}
