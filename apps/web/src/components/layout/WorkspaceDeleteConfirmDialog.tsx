import type { CSSProperties } from 'react';

export interface WorkspaceDeleteConfirmDialogProps {
  deleting?: boolean;
  isUnboundGroup?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  sessionCount: number;
  workspaceLabel: string;
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.58)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  dialog: {
    width: 440,
    maxWidth: 'calc(100vw - 32px)',
    borderRadius: 16,
    border: '1px solid color-mix(in oklch, var(--danger) 20%, var(--border-subtle))',
    background:
      'linear-gradient(180deg, color-mix(in oklch, var(--surface) 94%, transparent) 0%, color-mix(in oklch, var(--surface) 88%, var(--bg)) 100%)',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.34)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    padding: '4px 10px',
    borderRadius: 999,
    background: 'color-mix(in srgb, #ef4444 12%, transparent)',
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 800,
    color: 'var(--text)',
    lineHeight: 1.35,
  },
  description: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.7,
    color: 'var(--text-2)',
  },
  summaryCard: {
    borderRadius: 14,
    border: '1px solid var(--border-subtle)',
    background: 'color-mix(in oklch, var(--surface) 88%, transparent)',
    padding: '12px 14px',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
  },
  summaryItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  summaryLabel: {
    fontSize: 10,
    color: 'var(--text-3)',
    fontWeight: 700,
  },
  summaryValue: {
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 700,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  warning: {
    borderRadius: 12,
    border: '1px solid color-mix(in srgb, #ef4444 28%, var(--border-subtle))',
    background: 'color-mix(in srgb, #ef4444 8%, var(--surface))',
    color: 'var(--text-2)',
    padding: '10px 12px',
    fontSize: 11,
    lineHeight: 1.6,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  secondaryButton: {
    border: '1px solid var(--border-subtle)',
    background: 'transparent',
    color: 'var(--text-2)',
    borderRadius: 10,
    padding: '9px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  dangerButton: {
    border: 'none',
    background: 'var(--danger)',
    color: '#fff',
    borderRadius: 10,
    padding: '9px 14px',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 10px 24px color-mix(in srgb, #ef4444 28%, transparent)',
  },
};

export function WorkspaceDeleteConfirmDialog({
  deleting = false,
  isUnboundGroup = false,
  onCancel,
  onConfirm,
  open,
  sessionCount,
  workspaceLabel,
}: WorkspaceDeleteConfirmDialogProps) {
  if (!open) {
    return null;
  }

  const isBulkDelete = sessionCount > 0;

  return (
    <div style={styles.overlay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="确认删除工作区"
        style={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !deleting) {
            onCancel();
          }
        }}
      >
        <span style={styles.badge}>{isBulkDelete ? '批量删除' : '移除工作区'}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={styles.title}>
            {isBulkDelete
              ? isUnboundGroup
                ? '确认删除未绑定工作区中的全部会话？'
                : '确认删除该工作区及其全部会话？'
              : '确认移除这个工作区？'}
          </h3>
          <p style={styles.description}>
            {isBulkDelete
              ? isUnboundGroup
                ? '这会删除未绑定工作区下的全部会话。'
                : '这会删除该工作区下的全部会话，并把工作区从左侧列表中移除。'
              : '这只会把工作区从左侧列表中移除，不会删除任何会话内容。'}
          </p>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>工作区</span>
            <span style={styles.summaryValue}>{workspaceLabel}</span>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>受影响会话</span>
            <span style={styles.summaryValue}>{sessionCount} 个</span>
          </div>
        </div>

        <div style={styles.warning}>
          {isBulkDelete
            ? isUnboundGroup
              ? '此操作不可撤销。若部分会话删除失败，未绑定工作区分组会保留，并展示失败汇总。'
              : '此操作不可撤销。若部分会话删除失败，工作区会保留在侧栏中，并展示失败汇总。'
            : '移除后你仍可通过重新选择工作区或打开相关会话重新恢复它。'}
        </div>

        <div style={styles.footer}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              ...styles.secondaryButton,
              opacity: deleting ? 0.55 : 1,
              cursor: deleting ? 'wait' : 'pointer',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              ...styles.dangerButton,
              opacity: deleting ? 0.68 : 1,
              cursor: deleting ? 'wait' : 'pointer',
            }}
          >
            {deleting ? '删除中…' : isBulkDelete ? '确认删除全部' : '确认移除工作区'}
          </button>
        </div>
      </div>
    </div>
  );
}
