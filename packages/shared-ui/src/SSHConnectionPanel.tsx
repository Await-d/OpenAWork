import { useState } from 'react';

export type SSHAuthType = 'password' | 'key' | 'agent';

export interface SSHConnectionEntry {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SSHAuthType;
  privateKeyPath?: string;
  password?: string;
  status: 'connected' | 'disconnected' | 'error';
}

export interface SSHConnectionPanelProps {
  connections?: SSHConnectionEntry[];
  onAdd?: (entry: Omit<SSHConnectionEntry, 'id' | 'status'>) => void;
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onBindSession?: (connectionId: string, sessionId: string) => void;
  activeSessionId?: string;
}

const STATUS_COLOR = {
  connected: '#34d399',
  disconnected: '#64748b',
  error: '#f87171',
};

const EMPTY_FORM = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password' as SSHAuthType,
  privateKeyPath: '',
  password: '',
};

export function SSHConnectionPanel({
  connections = [],
  onAdd,
  onConnect,
  onDisconnect,
  onBindSession,
  activeSessionId,
}: SSHConnectionPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  function handleSubmit() {
    if (!form.name || !form.host || !form.username) return;
    onAdd?.(form);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>SSH 连接</span>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          style={{
            background: 'var(--color-accent, #6366f1)',
            color: 'var(--color-accent-text, #fff)',
            border: 'none',
            borderRadius: 4,
            padding: '3px 10px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {showForm ? '取消' : '+ 添加'}
        </button>
      </div>

      {showForm && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--color-surface, #1e293b)',
            borderRadius: 6,
            padding: 10,
            border: '1px solid var(--color-border, #334155)',
          }}
        >
          {(['name', 'host', 'username'] as const).map((field) => (
            <input
              key={field}
              placeholder={field === 'name' ? '名称' : field === 'host' ? '主机' : '用户名'}
              value={form[field]}
              onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            />
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              placeholder="端口"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
              style={{
                width: 70,
                background: 'transparent',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            />
            <select
              value={form.authType}
              onChange={(e) => setForm((f) => ({ ...f, authType: e.target.value as SSHAuthType }))}
              style={{
                flex: 1,
                background: 'var(--color-surface, #1e293b)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            >
              <option value="password">密码</option>
              <option value="key">私钥</option>
              <option value="agent">SSH 代理</option>
            </select>
          </div>
          {form.authType === 'password' && (
            <input
              type="password"
              placeholder="密码"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            />
          )}
          {form.authType === 'key' && (
            <input
              placeholder="私钥路径"
              value={form.privateKeyPath}
              onChange={(e) => setForm((f) => ({ ...f, privateKeyPath: e.target.value }))}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            />
          )}
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              background: 'var(--color-accent, #6366f1)',
              color: 'var(--color-accent-text, #fff)',
              border: 'none',
              borderRadius: 4,
              padding: '4px 0',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            保存
          </button>
        </div>
      )}

      {connections.length === 0 && !showForm && (
        <div
          style={{
            color: 'var(--color-muted, #64748b)',
            fontSize: 12,
            textAlign: 'center',
            padding: '12px 0',
          }}
        >
          暂无连接
        </div>
      )}

      {connections.map((conn) => (
        <div
          key={conn.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-surface, #1e293b)',
            borderRadius: 6,
            padding: '6px 10px',
            border: '1px solid var(--color-border, #334155)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: STATUS_COLOR[conn.status],
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {conn.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted, #64748b)' }}>
              {conn.username}@{conn.host}:{conn.port}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {conn.status === 'disconnected' || conn.status === 'error' ? (
              <button
                type="button"
                onClick={() => onConnect?.(conn.id)}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  border: '1px solid var(--color-accent, #6366f1)',
                  color: 'var(--color-accent, #6366f1)',
                  background: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                连接
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onDisconnect?.(conn.id)}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  border: '1px solid var(--color-border, #334155)',
                  color: 'var(--color-muted, #64748b)',
                  background: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                断开
              </button>
            )}
            {activeSessionId && conn.status === 'connected' && (
              <button
                type="button"
                onClick={() => onBindSession?.(conn.id, activeSessionId)}
                style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  border: '1px solid #34d399',
                  color: 'var(--success, #34d399)',
                  background: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                绑定
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
