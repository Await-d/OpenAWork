import type { CSSProperties } from 'react';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepRowProps {
  id: string;
  index: number;
  title: string;
  description?: string;
  status: StepStatus;
  style?: CSSProperties;
}

const STATUS_ICON: Record<StepStatus, string> = {
  pending: '○',
  running: '◐',
  completed: '●',
  failed: '✗',
  skipped: '—',
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'var(--color-muted, #94a3b8)',
  running: '#fbbf24',
  completed: '#34d399',
  failed: '#f87171',
  skipped: 'var(--color-muted, #94a3b8)',
};

export function StepRow({ index, title, description, status, style }: StepRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '0.4rem 0',
        ...style,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--color-border, #334155)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--color-muted, #94a3b8)',
          marginTop: 1,
        }}
      >
        {index}
      </span>
      <span
        style={{ color: STATUS_COLOR[status], fontSize: 12, lineHeight: '20px', flexShrink: 0 }}
      >
        {STATUS_ICON[status]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color:
              status === 'completed' || status === 'skipped'
                ? 'var(--color-muted, #94a3b8)'
                : 'var(--color-text, #f1f5f9)',
            textDecoration: status === 'completed' ? 'line-through' : 'none',
          }}
        >
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)', marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
}
