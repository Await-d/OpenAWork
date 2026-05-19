import { color } from '../tokens.js';
import type { CSSProperties } from 'react';
import type { PermissionDecision, PermissionRiskLevel } from '@openAwork/shared';

export type { PermissionDecision } from '@openAwork/shared';

export interface PermissionDecisionRecord {
  id: string;
  toolName: string;
  scope: string;
  decision: PermissionDecision;
  timestamp: number;
  riskLevel: PermissionRiskLevel;
}

export interface PermissionHistoryProps {
  decisions: PermissionDecisionRecord[];
  onExport: () => void;
  style?: CSSProperties;
}

const DECISION_COLORS: Record<PermissionDecision, string> = {
  once: 'var(--accent))',
  session: color.accent,
  permanent: color.aux,
  reject: color.danger,
};

const DECISION_LABELS: Record<PermissionDecision, string> = {
  once: '仅一次',
  session: '本次会话',
  permanent: '始终允许',
  reject: '已拒绝',
};

const RISK_COLORS: Record<string, string> = {
  low: color.success,
  medium: color.contrast,
  high: color.danger,
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
        background: 'var(--bg-overlay))',
        border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        borderRadius: 10,
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default))' }}>
          权限历史
        </span>
        <button
          type="button"
          onClick={onExport}
          style={{
            background: 'var(--bg-base))',
            border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
            borderRadius: 6,
            padding: '0.35rem 0.75rem',
            color: 'var(--fg-muted))',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          导出
        </button>
      </div>

      {decisions.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-muted))', padding: '0.5rem 0' }}>
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
                background: 'var(--bg-base))',
                borderRadius: 6,
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                flexWrap: 'wrap' as const,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--fg-default))',
                  minWidth: 80,
                  flex: '0 0 auto',
                }}
              >
                {rec.toolName}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--fg-muted))',
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
                RISK_COLORS[rec.riskLevel] ?? 'var(--fg-muted))',
                RISK_LABELS[rec.riskLevel] ?? rec.riskLevel,
              )}
              <span
                style={{ fontSize: 10, color: 'var(--fg-muted))', flex: '0 0 auto' }}
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
