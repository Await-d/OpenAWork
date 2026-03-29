import type { CSSProperties } from 'react';

export type PermissionDecision = 'once' | 'session' | 'permanent' | 'reject';

export interface PermissionDecisionRecord {
  id: string;
  toolName: string;
  scope: string;
  decision: PermissionDecision;
  timestamp: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface PermissionHistoryProps {
  decisions: PermissionDecisionRecord[];
  onExport: () => void;
  style?: CSSProperties;
}

const DECISION_COLORS: Record<PermissionDecision, string> = {
  once: '#6366f1',
  session: '#0ea5e9',
  permanent: '#8b5cf6',
  reject: '#f87171',
};

const DECISION_LABELS: Record<PermissionDecision, string> = {
  once: '仅一次',
  session: '本次会话',
  permanent: '始终允许',
  reject: '已拒绝',
};

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

function badge(color: string, label: string) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 4,
        background: `${color}22`,
        color,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        whiteSpace: 'nowrap' as const,
      }}
    >
      {label}
    </span>
  );
}

export function PermissionHistory({ decisions, onExport, style }: PermissionHistoryProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
          权限历史
        </span>
        <button
          type="button"
          onClick={onExport}
          style={{
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            padding: '0.35rem 0.75rem',
            color: 'var(--color-muted, #94a3b8)',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          导出
        </button>
      </div>

      {decisions.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)', padding: '0.5rem 0' }}>
          暂无权限决策记录。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {decisions.map((rec) => (
            <div
              key={rec.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0.5rem 0.6rem',
                background: 'var(--color-bg, #0f172a)',
                borderRadius: 6,
                border: '1px solid var(--color-border, #334155)',
                flexWrap: 'wrap' as const,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-text, #e2e8f0)',
                  minWidth: 80,
                  flex: '0 0 auto',
                }}
              >
                {rec.toolName}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-muted, #94a3b8)',
                  fontFamily: 'monospace',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {rec.scope}
              </span>
              {badge(DECISION_COLORS[rec.decision], DECISION_LABELS[rec.decision])}
              {badge(
                RISK_COLORS[rec.riskLevel] ?? '#94a3b8',
                RISK_LABELS[rec.riskLevel] ?? rec.riskLevel,
              )}
              <span
                style={{ fontSize: 10, color: 'var(--color-muted, #94a3b8)', flex: '0 0 auto' }}
              >
                {new Date(rec.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
