import type { CSSProperties } from 'react';

export type WorkflowMode = 'interactive' | 'delegated';

export interface WorkflowModeToggleProps {
  mode: WorkflowMode;
  onChange: (mode: WorkflowMode) => void;
  disabled?: boolean;
  style?: CSSProperties;
}

export function WorkflowModeToggle({ mode, onChange, disabled, style }: WorkflowModeToggleProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 8,
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {(['interactive', 'delegated'] as WorkflowMode[]).map((m) => (
        <button
          key={m}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m)}
          style={{
            padding: '0.4rem 0.9rem',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: mode === m ? 'var(--color-accent, #6366f1)' : 'transparent',
            color: mode === m ? '#fff' : 'var(--color-muted, #94a3b8)',
            transition: 'background 0.15s',
          }}
        >
          {m === 'interactive' ? '交互式' : '自动'}
        </button>
      ))}
    </div>
  );
}
