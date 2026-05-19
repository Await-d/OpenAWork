import type { CSSProperties } from 'react';
import { color } from '../tokens.js';

export type StepStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';

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
  paused: '◷',
  completed: '●',
  failed: '✗',
  skipped: '—',
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: color.fgMuted,
  running: color.contrast,
  paused: color.warning,
  completed: color.success,
  failed: color.danger,
  skipped: color.fgMuted,
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
          background: color.borderDefault,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: color.fgMuted,
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
                ? color.fgMuted
                : color.fgStrong,
            textDecoration: status === 'completed' ? 'line-through' : 'none',
          }}
        >
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 11, color: 'var(--fg-muted))', marginTop: 2 }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
}
