import type { CSSProperties } from 'react';
import { tokens, color } from '../tokens.js';

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
  file: color.aux,
  symbol: color.accent,
  snippet: color.success,
  doc: color.accentHover,
  url: color.accent,
  custom: color.fgMuted,
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
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--bg-overlay)',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.6rem 0.875rem',
          borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          background: 'var(--bg-raised)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--fg-muted)',
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
                color: overLimit ? color.danger : 'var(--fg-muted)',
                background: overLimit ? color.dangerMuted : 'var(--bg-overlay)',
                border: `1px solid ${overLimit ? 'var(--danger-muted)' : 'var(--border-default, hsla(215, 18%, 50%, 0.12))'}`,
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
                color: 'var(--fg-muted)',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
            position: 'relative',
            height: 4,
            background: 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderBottom: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
          }}
        >
          {/* fill */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              height: 2,
              width: `${usagePct * 100}%`,
              background: overLimit
                ? tokens.color.danger
                : usagePct > 0.8
                  ? tokens.color.warning
                  : tokens.color.success,
              transition: 'width 0.3s ease',
            }}
          />
          {/* 95% 压缩刻度 */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 'calc(95% - 1.5px)',
              top: 0,
              width: 3,
              height: 4,
              background: tokens.color.warning,
              pointerEvents: 'none',
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
            color: 'var(--fg-muted)',
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
              borderTop:
                i > 0 ? '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))' : 'none',
              background: item.pinned ? 'var(--bg-raised)' : 'transparent',
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: 'var(--bg-raised)',
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
                  color: 'var(--fg-strong)',
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
                    color: 'var(--fg-muted)',
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
                  color: 'var(--fg-muted)',
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
                    color: item.pinned ? tokens.color.accent : 'var(--fg-muted)',
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
                    color: 'var(--fg-muted)',
                    border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
