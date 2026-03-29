import type { CSSProperties } from 'react';

export interface CostBadgeProps {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  compact?: boolean;
  style?: CSSProperties;
}

export function CostBadge({ costUsd, inputTokens, outputTokens, compact, style }: CostBadgeProps) {
  const costStr = '$' + costUsd.toFixed(5);
  if (compact) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text, #f1f5f9)',
          background: 'var(--color-surface, #1e293b)',
          border: '1px solid var(--color-border, #334155)',
          borderRadius: 6,
          padding: '2px 8px',
          ...style,
        }}
      >
        {costStr}
      </span>
    );
  }
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 12,
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 8,
        padding: '4px 12px',
        ...style,
      }}
    >
      <span style={{ fontWeight: 700, color: '#34d399' }}>{costStr}</span>
      <span style={{ color: 'var(--color-muted, #94a3b8)' }}>
        {inputTokens.toLocaleString()} in
      </span>
      <span style={{ color: 'var(--color-muted, #94a3b8)' }}>
        {outputTokens.toLocaleString()} out
      </span>
    </div>
  );
}
