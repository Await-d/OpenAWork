import { color } from '../tokens.js';
import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface RegistrySource {
  id: string;
  name: string;
  url: string;
  type: 'official' | 'community' | 'enterprise' | 'local';
  enabled: boolean;
  trust: 'full' | 'verified' | 'untrusted';
  readonly?: boolean;
}

export interface RegistrySourceManagerProps {
  sources: RegistrySource[];
  onAdd: (url: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

const TYPE_COLOR: Record<string, string> = {
  official: color.success,
  community: 'var(--accent))',
  enterprise: color.contrast,
  local: 'var(--accent))',
};
const TRUST_COLOR: Record<string, string> = {
  full: color.success,
  verified: 'var(--accent))',
  untrusted: color.danger,
};

const s: Record<string, CSSProperties> = {
  root: {
    background: 'var(--bg-overlay))',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 12,
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  },
  hdr: {
    padding: '1rem 1.5rem',
    borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--fg-default))' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  },
  name: { fontSize: 12, fontWeight: 600, color: 'var(--fg-default))', flex: 1 },
  url: { fontSize: 11, color: 'var(--fg-muted))', fontFamily: 'monospace', flex: 2 },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  addRow: { padding: '0.75rem 1.5rem', display: 'flex', gap: 8 },
  input: {
    flex: 1,
    background: 'var(--bg-base))',
    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
    borderRadius: 6,
    padding: '0.4rem 0.75rem',
    fontSize: 12,
    color: 'var(--fg-default))',
    outline: 'none',
  },
};

function btn(color: string): CSSProperties {
  return {
    background: `${color}22`,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '0.25rem 0.65rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
  };
}

export function RegistrySourceManager({
  sources,
  onAdd,
  onRemove,
  onToggle,
}: RegistrySourceManagerProps) {
  const [url, setUrl] = useState('');

  function handleAdd() {
    const trimmed = url.trim();
    if (trimmed) {
      onAdd(trimmed);
      setUrl('');
    }
  }

  return (
    <div style={s.root}>
      <div style={s.hdr}>
        <h2 style={s.title}>注册源管理</h2>
        <span style={{ fontSize: 12, color: 'var(--fg-muted))' }}>
          {sources.length} 个来源
        </span>
      </div>

      {sources.length === 0 && (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--fg-muted))',
            fontSize: 12,
          }}
        >
          暂无配置的来源。
        </div>
      )}

      {sources.map((src) => {
        const typeColor = TYPE_COLOR[src.type] ?? 'var(--fg-muted))';
        const trustColor = TRUST_COLOR[src.trust] ?? 'var(--fg-muted))';
        return (
          <div key={src.id} style={{ ...s.row, opacity: src.enabled ? 1 : 0.55 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
              <span style={s.name}>{src.name}</span>
              <span style={s.url}>{src.url}</span>
            </div>
            <span style={{ ...s.badge, background: `${typeColor}22`, color: typeColor }}>
              {src.type}
            </span>
            <span style={{ ...s.badge, background: `${trustColor}22`, color: trustColor }}>
              {src.trust}
            </span>
            <button
              type="button"
              style={btn(src.enabled ? color.success : 'var(--fg-muted))')}
              disabled={src.readonly}
              onClick={() => onToggle(src.id, !src.enabled)}
            >
              {src.readonly ? '只读' : src.enabled ? '已启用' : '已禁用'}
            </button>
            <button
              type="button"
              style={btn(color.danger)}
              disabled={src.readonly}
              onClick={() => onRemove(src.id)}
            >
              移除
            </button>
          </div>
        );
      })}

      <div style={s.addRow}>
        <input
          style={s.input}
          type="text"
          placeholder="https://registry.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <button type="button" style={btn('var(--accent))')} onClick={handleAdd}>
          添加来源
        </button>
      </div>
    </div>
  );
}
