import type { CSSProperties } from 'react';
export type PermissionDecision = 'once' | 'session' | 'permanent' | 'reject';

interface PermissionDecisionOption {
  decision: PermissionDecision;
  label: string;
  color: string;
}

export interface PermissionPromptProps {
  requestId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
  pendingDecision?: PermissionDecision | null;
  errorMessage?: string;
  onDecide: (requestId: string, decision: PermissionDecision) => void;
  style?: CSSProperties;
}

const RISK_COLORS: Record<string, string> = {
  low: '#34d399',
  medium: '#facc15',
  high: '#f87171',
};

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export function PermissionPrompt({
  requestId,
  toolName,
  scope,
  reason,
  riskLevel,
  previewAction,
  pendingDecision = null,
  errorMessage,
  onDecide,
  style,
}: PermissionPromptProps) {
  const riskColor = RISK_COLORS[riskLevel] ?? '#94a3b8';
  const decisionOptions = getPermissionDecisionOptions(riskLevel);
  const activeDecision = pendingDecision
    ? (decisionOptions.find((option) => option.decision === pendingDecision) ?? null)
    : null;
  const isSubmitting = activeDecision !== null;

  return (
    <div
      style={{
        border: `1px solid ${riskLevel === 'high' ? 'rgba(248,113,113,0.4)' : 'var(--color-border, #334155)'}`,
        borderRadius: 10,
        padding: '1rem',
        background: 'var(--color-surface, #1e293b)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 400,
        boxShadow: '0 18px 48px rgba(15, 23, 42, 0.35)',
        ...style,
      }}
      aria-busy={isSubmitting}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>权限请求</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${riskColor}22`,
            color: riskColor,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {RISK_LABELS[riskLevel]}
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)' }}>
        <span style={{ fontWeight: 600, color: 'var(--color-accent, #6366f1)' }}>{toolName}</span>
        {' 请求访问 '}
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{scope}</span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text, #f1f5f9)', fontStyle: 'italic' }}>
        {reason}
      </div>

      {previewAction && (
        <div
          style={{
            fontSize: 11,
            padding: '0.4rem 0.6rem',
            background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 6,
            color: 'var(--color-muted, #94a3b8)',
            fontFamily: 'monospace',
          }}
        >
          {previewAction}
        </div>
      )}

      {(isSubmitting || errorMessage) && (
        <div
          role={errorMessage ? 'alert' : 'status'}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '0.55rem 0.7rem',
            borderRadius: 8,
            border: errorMessage ? '1px solid rgba(248,113,113,0.28)' : `1px solid ${riskColor}33`,
            background: errorMessage ? 'rgba(127, 29, 29, 0.22)' : `${riskColor}12`,
            color: errorMessage ? '#fecaca' : 'var(--color-text, #f1f5f9)',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1.2 }}>
            {errorMessage ? '⚠' : '⏳'}
          </span>
          <span>{errorMessage ?? `正在提交“${activeDecision?.label ?? '审批'}”，请稍候…`}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        {decisionOptions.map((option) => (
          <button
            key={option.decision}
            type="button"
            aria-busy={pendingDecision === option.decision}
            disabled={isSubmitting}
            onClick={() => onDecide(requestId, option.decision)}
            style={btnStyle(option.color, {
              active: pendingDecision === option.decision,
              disabled: isSubmitting,
            })}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function getPermissionDecisionOptions(
  _riskLevel: 'low' | 'medium' | 'high',
): PermissionDecisionOption[] {
  return [
    { decision: 'once', label: '同意本次', color: '#6366f1' },
    { decision: 'session', label: '本次会话同意', color: '#0ea5e9' },
    { decision: 'permanent', label: '永久同意', color: '#8b5cf6' },
    { decision: 'reject', label: '拒绝', color: '#64748b' },
  ];
}

function btnStyle(
  color: string,
  options?: { active?: boolean; disabled?: boolean },
): CSSProperties {
  return {
    background: options?.active ? `${color}2f` : `${color}22`,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '0.35rem 0.75rem',
    fontSize: 12,
    cursor: options?.disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    opacity: options?.disabled ? 0.72 : 1,
    transform: options?.active ? 'translateY(-1px)' : undefined,
    transition: 'opacity 120ms ease, transform 120ms ease, background 120ms ease',
  };
}
