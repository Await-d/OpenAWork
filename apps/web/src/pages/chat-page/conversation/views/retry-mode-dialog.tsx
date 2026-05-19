import React from 'react';

interface RetryModeDialogProps {
  messagePreview: string;
  onClose: () => void;
  onRetryCurrent: () => void;
  onRetryBranch: () => void;
  open: boolean;
}

export default function RetryModeDialog({
  messagePreview,
  onClose,
  onRetryCurrent,
  onRetryBranch,
  open,
}: RetryModeDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="重试方式"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.58)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 70,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          borderRadius: 18,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          boxShadow: 'var(--shadow-xl)',
          padding: '20px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg-strong)' }}>
            选择重试方式
          </div>
          <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-default)' }}>
            你可以清空这轮回答后在当前会话重新生成，也可以从这里新建会话，避免影响现有历史。
          </div>
        </div>

        <div
          style={{
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--fg-default)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {messagePreview}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-default)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onRetryCurrent}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-strong)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            清空本轮回答并重试
          </button>
          <button
            type="button"
            onClick={onRetryBranch}
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 10,
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'var(--fg-on-accent)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            新建会话重试
          </button>
        </div>
      </div>
    </div>
  );
}
