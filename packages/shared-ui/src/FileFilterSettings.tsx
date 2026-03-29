import type { CSSProperties, ChangeEvent, KeyboardEvent } from 'react';
import { useState } from 'react';

export interface FileFilterSettingsProps {
  patterns: string[];
  onAdd: (pattern: string) => void;
  onRemove: (pattern: string) => void;
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
  fontFamily: 'monospace',
};

export function FileFilterSettings({ patterns, onAdd, onRemove, style }: FileFilterSettingsProps) {
  const [draft, setDraft] = useState('');

  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed || patterns.includes(trimmed)) return;
    onAdd(trimmed);
    setDraft('');
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd();
  }

  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 12,
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
          文件过滤规则
        </span>
        <div style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)', marginTop: 2 }}>
          .crushignore 规则 — 每行一条
        </div>
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {patterns.length === 0 ? (
          <div
            style={{
              padding: '1.5rem',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--color-muted, #94a3b8)',
            }}
          >
            暂无过滤规则。
          </div>
        ) : (
          patterns.map((p) => (
            <div
              key={p}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.45rem 1rem',
                borderBottom: '1px solid var(--color-border, #334155)',
              }}
            >
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: 'var(--color-text, #e2e8f0)',
                }}
              >
                {p}
              </span>
              <button
                type="button"
                onClick={() => onRemove(p)}
                style={{
                  background: 'transparent',
                  border: '1px solid #475569',
                  borderRadius: 5,
                  color: '#f87171',
                  padding: '0.15rem 0.5rem',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                移除
              </button>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--color-border, #334155)',
        }}
      >
        <input
          type="text"
          placeholder="e.g. node_modules/** or *.log"
          value={draft}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          style={{ ...inputBase, flex: 1 }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!draft.trim()}
          style={{
            background: draft.trim() ? 'var(--color-accent, #6366f1)' : '#334155',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.35rem 0.9rem',
            fontSize: 12,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
        >
          添加
        </button>
      </div>
    </div>
  );
}
