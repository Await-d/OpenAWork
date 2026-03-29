import type { CSSProperties, ChangeEvent } from 'react';
import { useState } from 'react';

export interface MCPServerEntry {
  id: string;
  name: string;
  transport?: 'sse' | 'stdio';
  type?: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export interface MCPServerConfigProps {
  servers: MCPServerEntry[];
  onAdd: (entry: MCPServerEntry) => void;
  onRemove: (id: string) => void;
  style?: CSSProperties;
}

const inputBase: CSSProperties = {
  background: 'var(--color-bg, #0f172a)',
  border: '1px solid var(--color-border, #334155)',
  borderRadius: 6,
  color: 'var(--color-text, #e2e8f0)',
  fontSize: 12,
  padding: '0.35rem 0.6rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-muted, #94a3b8)',
  marginBottom: 4,
  display: 'block',
};

function genId(): string {
  return `mcp-${Date.now().toString(36)}`;
}

export function MCPServerConfig({ servers, onAdd, onRemove, style }: MCPServerConfigProps) {
  const [transport, setTransport] = useState<'sse' | 'stdio'>('sse');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');

  function handleAdd() {
    const trimName = name.trim();
    if (!trimName) return;
    if (transport === 'sse' && !url.trim()) return;
    if (transport === 'stdio' && !command.trim()) return;

    const entry: MCPServerEntry = {
      id: genId(),
      name: trimName,
      transport,
      ...(transport === 'sse'
        ? { url: url.trim() }
        : {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
          }),
    };
    onAdd(entry);
    setName('');
    setUrl('');
    setCommand('');
    setArgs('');
  }

  const canAdd = name.trim() && (transport === 'sse' ? url.trim() : command.trim());

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
        style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--color-border, #334155)' }}
      >
        <h2
          style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}
        >
          MCP 服务器配置
        </h2>
      </div>

      {servers.length === 0 ? (
        <div
          style={{ padding: '1.25rem 1.5rem', color: 'var(--color-muted, #94a3b8)', fontSize: 12 }}
        >
          暂无服务器配置。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {servers.map((s, idx) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem 1.5rem',
                borderBottom:
                  idx < servers.length - 1 ? '1px solid var(--color-border, #334155)' : 'none',
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
                  {s.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted, #94a3b8)',
                    marginTop: 2,
                    fontFamily: 'monospace',
                  }}
                >
                  [{(s.transport ?? s.type ?? '').toUpperCase()}]{' '}
                  {(s.transport ?? s.type) === 'sse'
                    ? s.url
                    : `${s.command ?? ''} ${(s.args ?? []).join(' ')}`.trim()}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(99,102,241,0.15)',
                  color: 'var(--color-accent, #6366f1)',
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}
              >
                {s.transport ?? s.type}
              </span>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                style={{
                  background: 'transparent',
                  border: '1px solid #475569',
                  borderRadius: 6,
                  color: '#f87171',
                  padding: '0.2rem 0.5rem',
                  fontSize: 12,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--color-border, #334155)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {(['sse', 'stdio'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTransport(t)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '0.3rem 0.75rem',
                borderRadius: 6,
                cursor: 'pointer',
                border: '1px solid var(--color-border, #334155)',
                background: transport === t ? 'var(--color-accent, #6366f1)' : 'transparent',
                color: transport === t ? '#fff' : 'var(--color-muted, #94a3b8)',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="mcp-name" style={labelStyle}>
            服务器名称
          </label>
          <input
            id="mcp-name"
            type="text"
            placeholder="我的 MCP 服务器"
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            style={inputBase}
          />
        </div>

        {transport === 'sse' ? (
          <div>
            <label htmlFor="mcp-url" style={labelStyle}>
              服务器 URL
            </label>
            <input
              id="mcp-url"
              type="text"
              placeholder="https://mcp.example.com/sse"
              value={url}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              style={inputBase}
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="mcp-command" style={labelStyle}>
                命令
              </label>
              <input
                id="mcp-command"
                type="text"
                placeholder="npx mcp-server"
                value={command}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCommand(e.target.value)}
                style={inputBase}
              />
            </div>
            <div>
              <label htmlFor="mcp-args" style={labelStyle}>
                参数（空格分隔）
              </label>
              <input
                id="mcp-args"
                type="text"
                placeholder="--port 3000 --verbose"
                value={args}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setArgs(e.target.value)}
                style={inputBase}
              />
            </div>
          </>
        )}

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          style={{
            background: canAdd ? 'var(--color-accent, #6366f1)' : '#334155',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.4rem 1rem',
            fontSize: 12,
            cursor: canAdd ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            alignSelf: 'flex-start',
          }}
        >
          + 添加服务器
        </button>
      </div>
    </div>
  );
}
