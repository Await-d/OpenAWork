import { color } from '../tokens.js';
import { useState } from 'react';

export type SSHAuthType = 'password' | 'key' | 'key-password' | 'agent';

type SSHKeySource = 'paste' | 'path';

export interface SSHConnectionEntry {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SSHAuthType;
  privateKeyPath?: string;
  privateKey?: string;
  passphrase?: string;
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
  connected: color.success,
  disconnected: 'var(--fg-muted)',
  error: color.danger,
};

const EMPTY_FORM = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'password' as SSHAuthType,
  keySource: 'paste' as SSHKeySource,
  privateKeyPath: '',
  privateKey: '',
  passphrase: '',
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
    const usesPassword = form.authType === 'password' || form.authType === 'key-password';
    const usesKey = form.authType === 'key' || form.authType === 'key-password';
    const entry: Omit<SSHConnectionEntry, 'id' | 'status'> = {
      name: form.name,
      host: form.host,
      port: form.port,
      username: form.username,
      authType: form.authType,
    };
    if (usesPassword) {
      entry.password = form.password;
    }
    if (usesKey) {
      if (form.keySource === 'paste' && form.privateKey.trim()) {
        entry.privateKey = form.privateKey;
      } else if (form.keySource === 'path' && form.privateKeyPath.trim()) {
        entry.privateKeyPath = form.privateKeyPath;
      }
      if (form.passphrase) {
        entry.passphrase = form.passphrase;
      }
    }
    onAdd?.(entry);
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
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
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
            background: 'var(--bg-overlay)',
            borderRadius: 6,
            padding: 10,
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
                background: 'var(--bg-overlay)',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            >
              <option value="password">密码</option>
              <option value="key">私钥</option>
              <option value="key-password">公钥 + 密码</option>
              <option value="agent">SSH 代理</option>
            </select>
          </div>
          {(form.authType === 'password' || form.authType === 'key-password') && (
            <input
              type="password"
              placeholder="密码"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                borderRadius: 4,
                padding: '3px 6px',
                color: 'inherit',
                fontSize: 12,
              }}
            />
          )}
          {(form.authType === 'key' || form.authType === 'key-password') && (
            <>
              <select
                aria-label="私钥来源"
                value={form.keySource}
                onChange={(e) =>
                  setForm((f) => ({ ...f, keySource: e.target.value as SSHKeySource }))
                }
                style={{
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  borderRadius: 4,
                  padding: '3px 6px',
                  color: 'inherit',
                  fontSize: 12,
                }}
              >
                <option value="paste">粘贴私钥内容</option>
                <option value="path">私钥文件路径</option>
              </select>
              {form.keySource === 'paste' ? (
                <textarea
                  placeholder="粘贴私钥内容"
                  value={form.privateKey}
                  onChange={(e) => setForm((f) => ({ ...f, privateKey: e.target.value }))}
                  rows={5}
                  spellCheck={false}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    borderRadius: 4,
                    padding: '3px 6px',
                    color: 'inherit',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    resize: 'vertical',
                  }}
                />
              ) : (
                <input
                  placeholder="私钥路径"
                  value={form.privateKeyPath}
                  onChange={(e) => setForm((f) => ({ ...f, privateKeyPath: e.target.value }))}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                    borderRadius: 4,
                    padding: '3px 6px',
                    color: 'inherit',
                    fontSize: 12,
                  }}
                />
              )}
              <input
                type="password"
                placeholder="私钥口令（加密私钥需要）"
                value={form.passphrase}
                onChange={(e) => setForm((f) => ({ ...f, passphrase: e.target.value }))}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  borderRadius: 4,
                  padding: '3px 6px',
                  color: 'inherit',
                  fontSize: 12,
                }}
              />
            </>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            style={{
              background: 'var(--accent)',
              color: 'var(--fg-on-accent)',
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
            color: 'var(--fg-muted)',
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
            background: 'var(--bg-overlay)',
            borderRadius: 6,
            padding: '6px 10px',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
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
                  border: '1px solid var(--accent)',
                  color: 'var(--accent)',
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
                  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                  color: 'var(--fg-muted)',
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
                  border: '1px solid var(--success)',
                  color: 'var(--success)',
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
