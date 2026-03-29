import type { CSSProperties } from 'react';

export type InstallStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface InstallStep {
  label: string;
  status: InstallStepStatus;
  message?: string;
}

export interface InstallProgressUIProps {
  skillName: string;
  steps: InstallStep[];
  onCancel?: () => void;
}

const STATUS_ICON: Record<InstallStepStatus, string> = {
  pending: '○',
  running: '◌',
  done: '✓',
  error: '✕',
};

const STATUS_COLOR: Record<InstallStepStatus, string> = {
  pending: '#475569',
  running: '#6366f1',
  done: '#34d399',
  error: '#f87171',
};

const s: Record<string, CSSProperties> = {
  root: {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 12,
    padding: '1.5rem',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 480,
  },
  title: {
    margin: '0 0 0.25rem',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text, #e2e8f0)',
  },
  subtitle: { margin: '0 0 1.5rem', fontSize: 12, color: 'var(--color-muted, #94a3b8)' },
  steps: { display: 'flex', flexDirection: 'column' as const, gap: 0 },
  stepRow: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '0.6rem 0' },
  icon: {
    fontSize: 14,
    fontWeight: 700,
    minWidth: 20,
    textAlign: 'center' as const,
    lineHeight: 1.4,
  },
  label: { fontSize: 12, color: 'var(--color-text, #e2e8f0)', fontWeight: 500, lineHeight: 1.4 },
  msg: {
    fontSize: 11,
    color: 'var(--color-muted, #94a3b8)',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  footer: { marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' },
};

function progressBar(steps: InstallStep[]): number {
  const done = steps.filter((s) => s.status === 'done').length;
  return steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);
}

export function InstallProgressUI({ skillName, steps, onCancel }: InstallProgressUIProps) {
  const pct = progressBar(steps);
  const hasError = steps.some((s) => s.status === 'error');
  const allDone = steps.every((s) => s.status === 'done');

  return (
    <div style={s.root}>
      <h3 style={s.title}>正在安装 {skillName}</h3>
      <p style={s.subtitle}>{hasError ? '安装失败' : allDone ? '安装完成' : '请稍候…'}</p>

      <div style={{ marginBottom: '1rem' }}>
        <div
          style={{
            height: 4,
            background: 'var(--color-border, #334155)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: hasError ? '#f87171' : 'var(--color-accent, #6366f1)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)' }}>{pct}%</span>
        </div>
      </div>

      <div style={s.steps}>
        {steps.map((step) => {
          const color = STATUS_COLOR[step.status];
          return (
            <div
              key={step.label}
              style={{ ...s.stepRow, opacity: step.status === 'pending' ? 0.5 : 1 }}
            >
              <span style={{ ...s.icon, color }}>{STATUS_ICON[step.status]}</span>
              <div>
                <div
                  style={{
                    ...s.label,
                    color:
                      step.status === 'running'
                        ? 'var(--color-accent, #6366f1)'
                        : 'var(--color-text, #e2e8f0)',
                  }}
                >
                  {step.label}
                </div>
                {step.message && <div style={s.msg}>{step.message}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {onCancel && !allDone && (
        <div style={s.footer}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'rgba(248,113,113,0.15)',
              color: '#f87171',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 6,
              padding: '0.35rem 0.85rem',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}
