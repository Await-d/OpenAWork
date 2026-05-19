import { color } from '../tokens.js';
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
          color: 'var(--fg-strong))',
          background: 'var(--bg-overlay))',
          border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
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
        background: 'var(--bg-overlay))',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 8,
        padding: '4px 12px',
        ...style,
      }}
    >
      <span style={{ fontWeight: 700, color: color.success }}>{costStr}</span>
      <span style={{ color: 'var(--fg-muted))' }}>
        {inputTokens.toLocaleString()} in
      </span>
      <span style={{ color: 'var(--fg-muted))' }}>
        {outputTokens.toLocaleString()} out
      </span>
    </div>
  );
}
