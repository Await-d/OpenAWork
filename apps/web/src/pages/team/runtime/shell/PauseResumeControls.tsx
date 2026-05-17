/**
 * 260515-team-phase-b · T-14
 *
 * 暂停/恢复/取消 UI：PauseConfirmDialog + ResumeStaleDialog + 按钮。
 */

import { useState, type CSSProperties } from 'react';

const DIALOG_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 92%, var(--bg))',
  boxShadow: 'var(--shadow-md)',
};

const BUTTON_PRIMARY: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 32,
  padding: '0 14px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
};

const BUTTON_DANGER: CSSProperties = {
  ...BUTTON_PRIMARY,
  border: '1px solid color-mix(in srgb, var(--danger, #d4574e) 40%, transparent)',
  background: 'color-mix(in srgb, var(--danger, #d4574e) 12%, var(--surface))',
  color: 'var(--danger, #d4574e)',
};

const BUTTON_SECONDARY: CSSProperties = {
  ...BUTTON_PRIMARY,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
  color: 'var(--text-2)',
};

// ─── PauseConfirmDialog ─────────────────────────────────────────────────────

export interface PauseConfirmDialogProps {
  open: boolean;
  activeCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PauseConfirmDialog({
  open,
  activeCount,
  onConfirm,
  onCancel,
}: PauseConfirmDialogProps) {
  if (!open) return null;
  return (
    <div role="dialog" aria-label="确认暂停" style={DIALOG_STYLE}>
      <strong style={{ fontSize: 14 }}>确认暂停全部？</strong>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
        当前有 {activeCount} 个活跃任务。暂停后所有正在运行的 LLM 调用会在当前轮次完成后停止，
        不会丢失已产出的内容。恢复后从断点继续。
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={BUTTON_DANGER} onClick={onConfirm}>
          确认暂停
        </button>
        <button type="button" style={BUTTON_SECONDARY} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

// ─── ResumeStaleDialog ──────────────────────────────────────────────────────

export interface ResumeStaleDialogProps {
  open: boolean;
  staleCount: number;
  onResumeAll: () => void;
  onDismiss: () => void;
}

export function ResumeStaleDialog({
  open,
  staleCount,
  onResumeAll,
  onDismiss,
}: ResumeStaleDialogProps) {
  if (!open) return null;
  return (
    <div role="dialog" aria-label="恢复过期任务" style={DIALOG_STYLE}>
      <strong style={{ fontSize: 14 }}>检测到 {staleCount} 个过期任务</strong>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
        这些任务可能因为 gateway 重启或网络中断而停滞。是否恢复执行？
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={BUTTON_PRIMARY} onClick={onResumeAll}>
          恢复全部
        </button>
        <button type="button" style={BUTTON_SECONDARY} onClick={onDismiss}>
          稍后处理
        </button>
      </div>
    </div>
  );
}

// ─── CancelHandoffButton ────────────────────────────────────────────────────

export interface CancelHandoffButtonProps {
  handoffId: string;
  onCancel: (handoffId: string) => Promise<void>;
  disabled?: boolean;
}

export function CancelHandoffButton({ handoffId, onCancel, disabled }: CancelHandoffButtonProps) {
  const [busy, setBusy] = useState(false);
  const handleClick = async () => {
    setBusy(true);
    try {
      await onCancel(handoffId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      style={{ ...BUTTON_DANGER, opacity: disabled || busy ? 0.6 : 1 }}
      disabled={disabled || busy}
      onClick={() => void handleClick()}
    >
      {busy ? '取消中…' : '取消'}
    </button>
  );
}
