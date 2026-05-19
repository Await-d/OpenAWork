import { color } from '../tokens.js';
import type { CSSProperties, ChangeEvent, KeyboardEvent } from 'react';
import { useState } from 'react';

export interface FileFilterSettingsProps {
  patterns: string[];
  onAdd: (pattern: string) => void;
  onRemove: (pattern: string) => void;
  style?: CSSProperties;
}

const inputBase: CSSProperties = {
  background: 'var(--bg-base))',
  border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
  borderRadius: 6,
  color: 'var(--fg-default))',
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
        background: 'var(--bg-overlay))',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 12,
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default))' }}>
          文件过滤规则
        </span>
        <div style={{ fontSize: 12, color: 'var(--fg-muted))', marginTop: 2 }}>
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
              color: 'var(--fg-muted))',
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
                borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
              }}
            >
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: 'var(--fg-default))',
                }}
              >
                {p}
              </span>
              <button
                type="button"
                onClick={() => onRemove(p)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--fg-subtle))',
                  borderRadius: 5,
                  color: color.danger,
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
          borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
            background: draft.trim()
              ? 'var(--accent))'
              : 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
            color: color.fgOnAccent,
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
