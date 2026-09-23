/**
 * 「后台任务」破坏性操作的**唯一确认弹窗**（双消费者共用）。
 *
 * 消费者：`background-task-panel.tsx`（完整面板）与 `background-task-quick-chip.tsx`
 * （常驻胶囊的展开列表）。抽取的原因：停止子代理 / 终止命令的确认语义（文案、初始焦点、
 * danger 样式、testid）必须只有一份实现——否则两个入口会各自漂移（见方案 R-04）。
 *
 * 约定：
 * - 初始焦点给「取消」（与 `BatchStopSubAgentsControl` 一致），避免回车误触发；
 * - `confirmTestId` 保持既有值（`background-task-confirm-*`），面板既有测试不改。
 */
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AppDialog, DialogActionButton } from '../../../components/common/modal/AppDialog.js';

export type BackgroundTaskPendingConfirm =
  | { kind: 'stop-subagent'; sessionId: string; title: string }
  | { kind: 'kill-shell'; terminalId: string; command: string }
  | { kind: 'stop-all'; count: number };

export interface BackgroundTaskConfirmDialogProps {
  pending: BackgroundTaskPendingConfirm | null;
  /** 已确认（弹窗会先关闭，回调由消费方执行）。 */
  onConfirm: () => void;
  onDismiss: () => void;
}

interface ConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTestId: string;
  scopeLabel: string;
  scopeValue: string;
}

export function resolveBackgroundTaskConfirmCopy(
  pending: BackgroundTaskPendingConfirm,
): ConfirmCopy {
  if (pending.kind === 'stop-subagent') {
    return {
      title: '停止子代理',
      description: `将停止「${pending.title}」，此操作不可撤销。`,
      confirmLabel: '确认停止',
      confirmTestId: 'background-task-confirm-stop',
      scopeLabel: '目标子代理',
      scopeValue: pending.title,
    };
  }
  if (pending.kind === 'kill-shell') {
    return {
      title: '终止后台命令',
      description: `将终止终端 ${pending.terminalId} 上运行的后台命令，此操作不可撤销。`,
      confirmLabel: '确认终止',
      confirmTestId: 'background-task-confirm-kill',
      scopeLabel: '目标终端',
      scopeValue: `${pending.terminalId} · ${pending.command}`,
    };
  }
  return {
    title: '停止全部子代理',
    description: `将停止 ${pending.count} 个正在运行的子代理，此操作不可撤销。`,
    confirmLabel: '确认停止',
    confirmTestId: 'background-task-confirm-stop-all',
    scopeLabel: '活动中的子代理',
    scopeValue: String(pending.count),
  };
}

const DIALOG_BADGE_STYLE: CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 12,
  border: '1px solid var(--danger-border)',
  background: 'var(--danger-muted)',
  color: 'var(--danger)',
};

const DIALOG_SCOPE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderRadius: 9,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  minWidth: 0,
};

const DIALOG_SCOPE_LABEL_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 10.5,
  color: 'var(--fg-muted)',
};

const DIALOG_SCOPE_VALUE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 650,
  color: 'var(--fg-strong)',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** 破坏性确认按钮：danger 填充，hover 时反色；focus ring 与全局一致。 */
function DangerConfirmButton({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 30,
        padding: '0 14px',
        borderRadius: 8,
        border: '1px solid var(--danger-border)',
        background: hovered ? 'var(--bg-surface)' : 'var(--danger)',
        color: hovered ? 'var(--danger)' : 'var(--fg-on-accent)',
        fontSize: 12,
        fontWeight: 650,
        cursor: 'pointer',
        transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease',
        ...(focused
          ? {
              outline: '2px solid var(--accent)',
              outlineOffset: 2,
              boxShadow: '0 0 0 4px var(--accent-subtle)',
            }
          : {}),
      }}
    >
      {label}
    </button>
  );
}

function DangerGlyph({ size = 12, strokeWidth = 2.1 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

export function BackgroundTaskConfirmDialog({
  pending,
  onConfirm,
  onDismiss,
}: BackgroundTaskConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  if (pending === null) {
    return null;
  }
  const copy = resolveBackgroundTaskConfirmCopy(pending);

  return (
    <AppDialog
      badge={
        <span style={DIALOG_BADGE_STYLE} aria-hidden="true">
          <DangerGlyph size={18} strokeWidth={1.9} />
        </span>
      }
      title={copy.title}
      description={copy.description}
      onDismiss={onDismiss}
      initialFocusRef={cancelButtonRef}
      footerRight={
        <>
          <DialogActionButton
            variant="secondary"
            label="取消"
            buttonRef={cancelButtonRef}
            onClick={onDismiss}
          />
          <DangerConfirmButton
            label={copy.confirmLabel}
            testId={copy.confirmTestId}
            onClick={onConfirm}
          />
        </>
      }
    >
      <div data-testid="background-task-confirm-scope" style={DIALOG_SCOPE_STYLE}>
        <span style={DIALOG_SCOPE_LABEL_STYLE}>{copy.scopeLabel}</span>
        <span style={DIALOG_SCOPE_VALUE_STYLE} title={copy.scopeValue}>
          {copy.scopeValue}
        </span>
      </div>
    </AppDialog>
  );
}
