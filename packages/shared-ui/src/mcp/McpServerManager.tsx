import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { color, font, radius, spacing } from '../tokens.js';
import { MCPServerConfigForm } from './MCPServerConfigForm.js';
import { McpServerEditorFields } from './MCPServerConfigRow.js';
import type { MCPServerEntry } from './mcp-server-config-model.js';
import {
  getMcpServerTransport,
  isProtectedBuiltinMcpEndpoint,
  sanitizeProtectedMcpEndpoint,
} from './mcp-server-config-utils.js';
import { MCP_STATUS_COLOR, MCP_STATUS_LABEL } from './mcp-status-display.js';
import type { MCPServerStatus } from './MCPServerList.js';

export interface McpServerManagerProps {
  /** 合并后的服务器配置（含同 id 内置项）。 */
  servers: MCPServerEntry[];
  /** 可选的运行状态——按 id 与配置对齐；缺省时只展示配置信息。 */
  statuses?: MCPServerStatus[];
  onAdd?: (entry: MCPServerEntry) => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string, entry: MCPServerEntry) => void;
  onRetry?: (serverId: string) => void;
  title?: string;
  emptyHint?: string;
  showAddForm?: boolean;
}

const styles = `
[data-openawork-mcp-manager] .mcp-row:hover {
  background: var(--bg-raised);
}
[data-openawork-mcp-manager] .mcp-action {
  background: transparent;
  border: 1px solid transparent;
  border-radius: ${radius.sm}px;
  color: ${color.fgMuted};
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  white-space: nowrap;
  transition: background 100ms ease, color 100ms ease;
}
[data-openawork-mcp-manager] .mcp-action:hover {
  background: var(--bg-hover);
  color: var(--fg-default);
}
[data-openawork-mcp-manager] .mcp-action[data-tone='accent'] {
  color: ${color.accent};
}
[data-openawork-mcp-manager] .mcp-action[data-tone='accent']:hover {
  background: ${color.accentMuted};
}
[data-openawork-mcp-manager] .mcp-action[data-tone='danger']:hover {
  background: ${color.complementMuted};
  color: ${color.complement};
}
[data-openawork-mcp-manager] :where(button, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
[data-openawork-mcp-manager] .mcp-action[data-tone='danger']:focus-visible {
  outline-color: ${color.complement};
  box-shadow: 0 0 0 4px ${color.complementSubtle};
}
`;

const panelStyle: CSSProperties = {
  background: color.bgOverlay,
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.lg,
  fontFamily: font.sans,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  alignItems: 'center',
  borderBottom: `1px solid ${color.borderSubtle}`,
  display: 'flex',
  gap: spacing[3],
  justifyContent: 'space-between',
  padding: `${spacing[3]}px ${spacing[4]}px`,
};

function Badge({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title?: string;
  tone: 'accent' | 'aux' | 'contrast';
}) {
  const map = {
    accent: { bg: color.accentMuted, border: color.accentBorder, fg: color.accent },
    aux: { bg: color.auxMuted, border: color.auxBorder, fg: color.aux },
    contrast: { bg: color.contrastMuted, border: color.contrastBorder, fg: color.contrast },
  } as const;
  const t = map[tone];
  return (
    <span
      title={title}
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: radius.xs,
        color: t.fg,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.5,
        padding: '0 6px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function EnabledSwitch({
  server,
  onUpdate,
}: {
  server: MCPServerEntry;
  onUpdate?: (id: string, entry: MCPServerEntry) => void;
}) {
  const enabled = server.enabled !== false;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? '禁用' : '启用'} ${server.name}`}
      title={enabled ? '点击禁用' : '点击启用'}
      disabled={!onUpdate}
      onClick={() =>
        onUpdate?.(server.id, sanitizeProtectedMcpEndpoint({ ...server, enabled: !enabled }))
      }
      style={{
        background: 'transparent',
        border: 'none',
        cursor: onUpdate ? 'pointer' : 'not-allowed',
        flexShrink: 0,
        opacity: onUpdate ? 1 : 0.5,
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          background: enabled ? color.accent : 'var(--switch-track-off)',
          borderRadius: radius.pill,
          display: 'block',
          height: 20,
          position: 'relative',
          transition: 'background 160ms ease',
          width: 36,
        }}
      >
        <span
          style={{
            background: color.bgOverlay,
            borderRadius: '50%',
            boxShadow: 'var(--shadow-sm)',
            height: 16,
            left: enabled ? 18 : 2,
            position: 'absolute',
            top: 2,
            transition: 'left 160ms ease',
            width: 16,
          }}
        />
      </span>
    </button>
  );
}

function removeLabel(server: MCPServerEntry): string {
  if (server.builtin) {
    return server.source === 'builtin' ? '禁用' : '恢复默认';
  }
  return '移除';
}

function transportLabel(server: MCPServerEntry): string {
  if (isProtectedBuiltinMcpEndpoint(server)) {
    return '内置桥接';
  }
  const transport = getMcpServerTransport(server);
  return transport === 'sse' ? 'SSE' : 'stdio';
}

export function McpServerManager({
  servers,
  statuses,
  onAdd,
  onRemove,
  onUpdate,
  onRetry,
  title = 'MCP 服务器',
  emptyHint = '暂无服务器配置。添加同 id 可覆盖或禁用系统内置 MCP，也可以接入新的自定义服务器。',
  showAddForm = true,
}: McpServerManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const statusById = new Map((statuses ?? []).map((status) => [status.id, status]));
  const connectedCount = (statuses ?? []).filter((s) => s.status === 'connected').length;

  return (
    <div data-openawork-mcp-manager="true" style={panelStyle}>
      <style>{styles}</style>

      <div style={headerStyle}>
        <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ color: color.fgDefault, fontSize: 12, fontWeight: 600, margin: 0 }}>
            {title}
          </h2>
          <span style={{ color: color.fgMuted, fontSize: 11 }}>
            {servers.length} 个
            {statuses && statuses.length > 0 ? ` · ${connectedCount} 已连接` : ''}
          </span>
        </div>
        {onAdd && showAddForm ? (
          <button
            type="button"
            className="mcp-action"
            data-tone="accent"
            data-mcp-add-toggle="true"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
              setFormError(null);
            }}
          >
            {adding ? '收起' : '+ 添加服务器'}
          </button>
        ) : null}
      </div>

      {servers.length === 0 ? (
        <div
          style={{
            color: color.fgMuted,
            fontSize: 12,
            lineHeight: 1.6,
            padding: `${spacing[5]}px ${spacing[4]}px`,
            textAlign: 'center',
          }}
        >
          {emptyHint}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {servers.map((server) => {
            const status = statusById.get(server.id);
            const statusText = status
              ? MCP_STATUS_LABEL[status.status]
              : server.enabled === false
                ? '已禁用'
                : '未连接';
            const statusColor = status
              ? MCP_STATUS_COLOR[status.status]
              : server.enabled === false
                ? color.fgSubtle
                : color.fgMuted;
            const isEditing = editingId === server.id;
            const label = removeLabel(server);
            const isConfirming = confirmingRemoveId === server.id;

            return (
              <li
                className="mcp-row"
                key={server.id}
                data-mcp-manager-row={server.id}
                style={{
                  borderTop: `1px solid ${color.borderSubtle}`,
                  opacity: server.enabled === false ? 0.65 : 1,
                  padding: `${spacing[2] + 2}px ${spacing[4]}px`,
                  transition: 'background 100ms ease',
                }}
              >
                <div
                  style={{
                    alignItems: 'center',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: `${spacing[2]}px ${spacing[3]}px`,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      background: statusColor,
                      borderRadius: '50%',
                      boxShadow:
                        status?.status === 'connected'
                          ? `0 0 6px ${MCP_STATUS_COLOR.connected}`
                          : 'none',
                      flexShrink: 0,
                      height: 8,
                      width: 8,
                    }}
                  />
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div
                      style={{
                        alignItems: 'center',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          color: color.fgStrong,
                          fontSize: 12,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={server.name}
                      >
                        {server.name}
                      </span>
                      {server.builtin ? (
                        <Badge tone="accent" title="系统内置 MCP，可通过同 id 用户配置覆盖">
                          系统内置
                        </Badge>
                      ) : null}
                      {isProtectedBuiltinMcpEndpoint(server) ? (
                        <Badge tone="aux" title="运行时内置桥接，无需配置 command 或 url">
                          内置桥接
                        </Badge>
                      ) : null}
                      {server.required ? (
                        <Badge tone="contrast" title="required=true，启动时应优先保持可用">
                          required
                        </Badge>
                      ) : null}
                    </div>
                    <div
                      style={{
                        color: color.fgMuted,
                        display: 'flex',
                        flexWrap: 'wrap',
                        fontSize: 11,
                        gap: 8,
                        marginTop: 2,
                      }}
                    >
                      <span style={{ fontFamily: font.mono }}>{server.id}</span>
                      <span>· {transportLabel(server)}</span>
                      <span style={{ color: statusColor }}>· {statusText}</span>
                      {status ? <span>· {status.toolCount} tools</span> : null}
                      {(server.disabledTools?.length ?? 0) > 0 ? (
                        <span>· 已禁用 {server.disabledTools?.length} 个工具</span>
                      ) : null}
                    </div>
                    {status?.error ? (
                      <div
                        style={{ color: color.danger, fontSize: 11, marginTop: 2 }}
                        title={status.error}
                      >
                        {status.error}
                      </div>
                    ) : null}
                    {status?.retryFeedback?.kind === 'ok' ? (
                      <div style={{ color: color.success, fontSize: 10, marginTop: 2 }}>
                        ✓ 已连接 · {status.retryFeedback.toolCount} tools ·{' '}
                        {status.retryFeedback.durationMs}ms
                      </div>
                    ) : null}
                    {status?.retryFeedback?.kind === 'fail' ? (
                      <div
                        style={{ color: color.danger, fontSize: 10, marginTop: 2 }}
                        title={status.retryFeedback.error}
                      >
                        {status.retryFeedback.error}
                      </div>
                    ) : null}
                  </div>

                  {status ? (
                    <span
                      style={{
                        background: color.bgSurface,
                        border: `1px solid ${color.borderDefault}`,
                        borderRadius: radius.xs,
                        color: color.fgMuted,
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {status.toolCount} tools
                    </span>
                  ) : null}

                  <div
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: spacing[2],
                      marginLeft: 'auto',
                    }}
                  >
                    <EnabledSwitch server={server} onUpdate={onUpdate} />
                    {onRetry && status ? (
                      <button
                        type="button"
                        className="mcp-action"
                        disabled={status.retryFeedback?.kind === 'pending'}
                        onClick={() => onRetry(server.id)}
                        title="断开当前连接并重新尝试连接 / 安装"
                      >
                        {status.retryFeedback?.kind === 'pending' ? '处理中…' : '重试'}
                      </button>
                    ) : null}
                    {onUpdate ? (
                      <button
                        type="button"
                        className="mcp-action"
                        aria-expanded={isEditing}
                        onClick={() => {
                          setEditingId(isEditing ? null : server.id);
                          setFormError(null);
                        }}
                      >
                        {isEditing ? '收起' : '编辑'}
                      </button>
                    ) : null}
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="mcp-action"
                          onClick={() => setConfirmingRemoveId(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="mcp-action"
                          data-tone="danger"
                          onClick={() => {
                            setConfirmingRemoveId(null);
                            onRemove?.(server.id);
                          }}
                        >
                          确认{label}
                        </button>
                      </>
                    ) : onRemove ? (
                      <button
                        type="button"
                        className="mcp-action"
                        data-tone="danger"
                        onClick={() => setConfirmingRemoveId(server.id)}
                      >
                        {label}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isEditing ? (
                  <div
                    style={{
                      border: `1px solid ${color.borderSubtle}`,
                      borderRadius: radius.md,
                      display: 'grid',
                      gap: spacing[3],
                      marginTop: spacing[3],
                      padding: spacing[3],
                    }}
                  >
                    <McpServerEditorFields
                      server={server}
                      onUpdate={onUpdate}
                      setFormError={setFormError}
                      showIdentity
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="mcp-action"
                        data-tone="accent"
                        onClick={() => {
                          setEditingId(null);
                          setFormError(null);
                        }}
                      >
                        完成
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {adding && onAdd ? (
        <MCPServerConfigForm
          onAdd={(entry) => {
            onAdd(entry);
            setAdding(false);
          }}
          formError={formError}
          setFormError={setFormError}
        />
      ) : null}
    </div>
  );
}
