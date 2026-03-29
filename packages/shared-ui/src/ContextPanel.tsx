import type { CSSProperties } from 'react';
import { tokens } from './tokens.js';

export type ContextItemKind = 'file' | 'symbol' | 'snippet' | 'doc' | 'url' | 'custom';

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  label: string;
  description?: string;
  tokens?: number;
  pinned?: boolean;
}

export interface ContextPanelProps {
  items: ContextItem[];
  totalTokens?: number;
  tokenLimit?: number;
  onRemove?: (id: string) => void;
  onPin?: (id: string) => void;
  onClear?: () => void;
  style?: CSSProperties;
}

const KIND_ICON: Record<ContextItemKind, string> = {
  file: '📄',
  symbol: '⟨⟩',
  snippet: '{}',
  doc: '📖',
  url: '🔗',
  custom: '◆',
};

const KIND_COLOR: Record<ContextItemKind, string> = {
  file: tokens.color.info,
  symbol: tokens.color.accent,
  snippet: tokens.color.success,
  doc: tokens.color.accentHover,
  url: tokens.color.accent,
  custom: tokens.color.muted,
};

export function ContextPanel({
  items,
  totalTokens,
  tokenLimit,
  onRemove,
  onPin,
  onClear,
  style,
}: ContextPanelProps) {
  const usagePct =
    totalTokens !== undefined && tokenLimit ? Math.min(totalTokens / tokenLimit, 1) : null;
  const overLimit = usagePct !== null && usagePct >= 1;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--color-surface, #1e293b)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.875rem',
          borderBottom: '1px solid var(--color-border, #334155)',
          background: 'var(--color-surface-raised, #0f172a)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          上下文（{items.length}）
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalTokens !== undefined && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: overLimit ? '#f87171' : 'var(--color-muted, #94a3b8)',
                background: overLimit ? '#7f1d1d' : 'var(--color-surface, #1e293b)',
                border: `1px solid ${overLimit ? '#f8717140' : 'var(--color-border, #334155)'}`,
                borderRadius: 4,
                padding: '0.15rem 0.45rem',
              }}
            >
              {totalTokens.toLocaleString()}
              {tokenLimit ? ` / ${tokenLimit.toLocaleString()}` : ''} tok
            </span>
          )}
          {onClear && items.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              style={{
                background: 'transparent',
                color: 'var(--color-muted, #94a3b8)',
                border: '1px solid var(--color-border, #334155)',
                borderRadius: 5,
                padding: '0.2rem 0.5rem',
                fontSize: 10,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              清空全部
            </button>
          )}
        </div>
      </div>

      {usagePct !== null && (
        <div
          style={{
            height: 2,
            background: 'var(--color-border, #334155)',
            borderBottom: '1px solid var(--color-border, #334155)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${usagePct * 100}%`,
              background: overLimit
                ? tokens.color.danger
                : usagePct > 0.8
                  ? tokens.color.warning
                  : tokens.color.success,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {items.length === 0 ? (
        <div
          style={{
            padding: '1.25rem',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--color-muted, #94a3b8)',
          }}
        >
          暂无上下文
        </div>
      ) : (
        items.map((item, i) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0.5rem 0.875rem',
              borderTop: i > 0 ? '1px solid var(--color-border, #334155)' : 'none',
              background: item.pinned ? 'var(--color-surface-raised, #0f172a)' : 'transparent',
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: 'var(--color-surface-raised, #0f172a)',
                border: `1px solid ${KIND_COLOR[item.kind]}30`,
                color: KIND_COLOR[item.kind],
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {KIND_ICON[item.kind]}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-text, #f1f5f9)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
              {item.description && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted, #94a3b8)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.description}
                </div>
              )}
            </div>

            {item.tokens !== undefined && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--color-muted, #94a3b8)',
                  flexShrink: 0,
                }}
              >
                {item.tokens.toLocaleString()}t
              </span>
            )}

            {item.pinned && (
              <span style={{ fontSize: 10, color: tokens.color.accent, flexShrink: 0 }}>📌</span>
            )}

            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              {onPin && (
                <button
                  type="button"
                  title={item.pinned ? '取消固定' : '固定'}
                  onClick={() => onPin(item.id)}
                  style={{
                    background: 'transparent',
                    color: item.pinned ? tokens.color.accent : 'var(--color-muted, #94a3b8)',
                    border: '1px solid var(--color-border, #334155)',
                    borderRadius: 4,
                    padding: '0.2rem 0.4rem',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  ⊕
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  title="移除"
                  onClick={() => onRemove(item.id)}
                  style={{
                    background: 'transparent',
                    color: 'var(--color-muted, #94a3b8)',
                    border: '1px solid var(--color-border, #334155)',
                    borderRadius: 4,
                    padding: '0.2rem 0.4rem',
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
