import type { CSSProperties } from 'react';

export interface ProviderUpdateBadgeProps {
  updatedCount: number;
  lastUpdated: number;
  onDismiss: () => void;
  style?: CSSProperties;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ProviderUpdateBadge({
  updatedCount,
  lastUpdated,
  onDismiss,
  style,
}: ProviderUpdateBadgeProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(99,102,241,0.12)',
        border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: 20,
        padding: '0.3rem 0.75rem',
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#6366f1',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-text, #e2e8f0)',
        }}
      >
        {updatedCount} model{updatedCount !== 1 ? 's' : ''} updated
      </span>
      <span
        style={{
          fontSize: 11,
          color: 'var(--color-muted, #94a3b8)',
        }}
      >
        {formatRelativeTime(lastUpdated)}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--color-muted, #94a3b8)',
          cursor: 'pointer',
          padding: '0 2px',
          fontSize: 12,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        x
      </button>
    </div>
  );
}
