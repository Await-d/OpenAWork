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
  official: '#34d399',
  community: '#6366f1',
  enterprise: '#facc15',
  local: '#38bdf8',
};
const TRUST_COLOR: Record<string, string> = {
  full: '#34d399',
  verified: '#6366f1',
  untrusted: '#f87171',
};

const s: Record<string, CSSProperties> = {
  root: {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 12,
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  },
  hdr: {
    padding: '1rem 1.5rem',
    borderBottom: '1px solid var(--color-border, #334155)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid var(--color-border, #334155)',
  },
  name: { fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)', flex: 1 },
  url: { fontSize: 11, color: 'var(--color-muted, #94a3b8)', fontFamily: 'monospace', flex: 2 },
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
    background: 'var(--color-bg, #0f172a)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 6,
    padding: '0.4rem 0.75rem',
    fontSize: 12,
    color: 'var(--color-text, #e2e8f0)',
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
        <span style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)' }}>
          {sources.length} 个来源
        </span>
      </div>

      {sources.length === 0 && (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--color-muted, #94a3b8)',
            fontSize: 12,
          }}
        >
          暂无配置的来源。
        </div>
      )}

      {sources.map((src) => {
        const typeColor = TYPE_COLOR[src.type] ?? '#94a3b8';
        const trustColor = TRUST_COLOR[src.trust] ?? '#94a3b8';
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
              style={btn(src.enabled ? '#34d399' : '#64748b')}
              disabled={src.readonly}
              onClick={() => onToggle(src.id, !src.enabled)}
            >
              {src.readonly ? '只读' : src.enabled ? '已启用' : '已禁用'}
            </button>
            <button
              type="button"
              style={btn('#f87171')}
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
        <button type="button" style={btn('var(--color-accent, #6366f1)')} onClick={handleAdd}>
          添加来源
        </button>
      </div>
    </div>
  );
}
