import type { CSSProperties } from 'react';

export interface PermissionItem {
  type: string;
  scope: string;
  required: boolean;
}

export interface PermissionConfirmDialogProps {
  open: boolean;
  skillName: string;
  permissions: PermissionItem[];
  trustLevel: 'full' | 'standard' | 'restricted';
  onConfirm: () => void;
  onCancel: () => void;
}

const TRUST_COLOR: Record<string, string> = {
  full: '#34d399',
  standard: '#6366f1',
  restricted: '#f87171',
};
const TRUST_LABEL: Record<string, string> = {
  full: '完全信任',
  standard: '标准',
  restricted: '受限',
};

const RISK_COLOR: Record<string, string> = { true: '#f87171', false: '#64748b' };

const s: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 14,
    padding: '1.5rem',
    width: 440,
    maxWidth: '90vw',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
  },
  hdr: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
  },
  title: { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--color-text, #e2e8f0)' },
  subtitle: { margin: '0.25rem 0 0', fontSize: 12, color: 'var(--color-muted, #94a3b8)' },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    whiteSpace: 'nowrap' as const,
  },
  permList: {
    margin: '0 0 1.25rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  permRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0.55rem 0.85rem',
    borderBottom: '1px solid var(--color-border, #334155)',
    fontSize: 12,
  },
  permType: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: 'var(--color-accent, #6366f1)',
    minWidth: 80,
  },
  permScope: { color: 'var(--color-text, #e2e8f0)', flex: 1, fontSize: 12 },
  footer: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
};

function actionBtn(color: string, bg?: string): CSSProperties {
  const c = bg ?? color;
  return {
    background: `${c}22`,
    color,
    border: `1px solid ${c}44`,
    borderRadius: 7,
    padding: '0.45rem 1rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
  };
}

export function PermissionConfirmDialog({
  open,
  skillName,
  permissions,
  trustLevel,
  onConfirm,
  onCancel,
}: PermissionConfirmDialogProps) {
  if (!open) return null;

  const trustColor = TRUST_COLOR[trustLevel] ?? '#94a3b8';
  const requiredCount = permissions.filter((p) => p.required).length;

  return (
    <div style={s.overlay}>
      <div
        style={s.dialog}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div style={s.hdr}>
          <div>
            <h3 style={s.title}>安装 {skillName}？</h3>
            <p style={s.subtitle}>{requiredCount} 个所需权限</p>
          </div>
          <span style={{ ...s.badge, background: `${trustColor}22`, color: trustColor }}>
            {TRUST_LABEL[trustLevel]}
          </span>
        </div>

        {permissions.length > 0 && (
          <div style={s.permList}>
            {permissions.map((perm, i) => {
              const riskColor = RISK_COLOR[String(perm.required)];
              const isLast = i === permissions.length - 1;
              return (
                <div
                  key={`${perm.type}-${perm.scope}`}
                  style={{
                    ...s.permRow,
                    borderBottom: isLast ? 'none' : '1px solid var(--color-border, #334155)',
                  }}
                >
                  <span style={s.permType}>{perm.type}</span>
                  <span style={s.permScope}>{perm.scope}</span>
                  <span
                    style={{
                      ...s.badge,
                      fontSize: 9,
                      background: `${riskColor}22`,
                      color: riskColor,
                    }}
                  >
                    {perm.required ? '必需' : '可选'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {permissions.length === 0 && (
          <div
            style={{
              padding: '0.75rem',
              marginBottom: '1.25rem',
              background: 'rgba(52,211,153,0.08)',
              border: '1px solid rgba(52,211,153,0.2)',
              borderRadius: 8,
              fontSize: 12,
              color: '#34d399',
            }}
          >
            无需特殊权限。
          </div>
        )}

        <div style={s.footer}>
          <button type="button" style={actionBtn('#94a3b8')} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            style={actionBtn('#fff', 'var(--color-accent, #6366f1)')}
            onClick={onConfirm}
          >
            确认安装
          </button>
        </div>
      </div>
    </div>
  );
}
