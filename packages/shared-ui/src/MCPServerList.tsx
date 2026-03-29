import type { CSSProperties } from 'react';

export type MCPServerStatus = {
  id: string;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  toolCount: number;
  authType?: string;
};

export interface MCPServerListProps {
  servers: MCPServerStatus[];
  style?: CSSProperties;
}

const STATUS_COLOR: Record<MCPServerStatus['status'], string> = {
  connected: '#34d399',
  connecting: '#facc15',
  disconnected: '#94a3b8',
  error: '#f87171',
};

const STATUS_LABEL: Record<MCPServerStatus['status'], string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '已断开',
  error: '错误',
};

export function MCPServerList({ servers, style }: MCPServerListProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <div
        style={{
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}
        >
          MCP 服务器
        </h2>
      </div>

      {servers.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--color-muted, #94a3b8)',
            fontSize: 12,
          }}
        >
          No MCP servers connected.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {servers.map((server, idx) => {
            const color = STATUS_COLOR[server.status];
            const isLast = idx === servers.length - 1;
            return (
              <div
                key={server.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0.75rem 1.5rem',
                  borderBottom: isLast ? 'none' : '1px solid var(--color-border, #334155)',
                }}
              >
                <span
                  title={STATUS_LABEL[server.status]}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: color,
                    boxShadow: server.status === 'connected' ? `0 0 6px ${color}` : 'none',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-text, #e2e8f0)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {server.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color,
                      marginTop: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {STATUS_LABEL[server.status]}
                    {server.authType && (
                      <span style={{ color: 'var(--color-muted, #94a3b8)' }}>
                        · {server.authType}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: 'rgba(99,102,241,0.15)',
                    color: 'var(--color-accent, #6366f1)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
