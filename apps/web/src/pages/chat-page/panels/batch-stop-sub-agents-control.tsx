import React, { useRef, useState } from 'react';
import { AppDialog, DialogActionButton } from '../../../components/common/modal/AppDialog.js';
import './batch-stop-sub-agents-control.css';

/**
 * 「停止全部子代理」控件。
 *
 * 渲染在 composer footer slot（输入框上方）中的紧凑危险操作入口，
 * 自带确认弹窗：点击触发器不会立即执行，必须在 AppDialog 中显式确认。
 *
 * 纯展示组件：不在途请求、不 import web-client，批量停止的网络调用由父级持有，
 * 通过 `onConfirm` 回调触发（`activeCount` 也由父级按 running + paused 统计后传入）。
 */
export interface BatchStopSubAgentsControlProps {
  /** Number of currently active sub-agents (running + paused). */
  activeCount: number;
  /** True while a batch stop request is in flight. */
  stopping: boolean;
  /** Called after the user confirms in the dialog. */
  onConfirm: () => void;
}

/** 停止图标：外圈 + 内部方块，不使用 emoji。 */
function StopIcon({ size = 12, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
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

export function BatchStopSubAgentsControl(
  props: BatchStopSubAgentsControlProps,
): React.ReactElement | null {
  const { activeCount, stopping, onConfirm } = props;
  const [dialogOpen, setDialogOpen] = useState(false);
  // 毁灭性确认弹窗把初始焦点给「取消」而不是主按钮：避免回车直接触发批量停止。
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  // Hooks 必须先于早退返回执行，保证渲染间调用顺序稳定。
  if (activeCount <= 0) return null;

  const closeDialog = () => setDialogOpen(false);

  const handleConfirm = () => {
    setDialogOpen(false);
    onConfirm();
  };

  return (
    <>
      <button
        type="button"
        className="batch-stop-sub-agents__trigger"
        data-testid="batch-stop-sub-agents-trigger"
        disabled={stopping}
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        onClick={() => setDialogOpen(true)}
      >
        {stopping ? (
          <span className="batch-stop-sub-agents__spinner" aria-hidden="true" />
        ) : (
          <StopIcon />
        )}
        <span className="batch-stop-sub-agents__label">
          {stopping ? '正在停止…' : `停止全部子代理（${activeCount}）`}
        </span>
      </button>

      {dialogOpen ? (
        <AppDialog
          badge={
            <span className="batch-stop-sub-agents__dialog-badge" aria-hidden="true">
              <StopIcon size={18} strokeWidth={1.9} />
            </span>
          }
          title="停止全部子代理"
          description={`将停止 ${activeCount} 个正在运行的子代理，此操作不可撤销。`}
          onDismiss={closeDialog}
          initialFocusRef={cancelButtonRef}
          footerRight={
            <>
              <DialogActionButton
                variant="secondary"
                label="取消"
                buttonRef={cancelButtonRef}
                onClick={closeDialog}
              />
              <button
                type="button"
                className="batch-stop-sub-agents__confirm"
                data-testid="batch-stop-sub-agents-confirm"
                disabled={stopping}
                onClick={handleConfirm}
              >
                {stopping ? (
                  <span className="batch-stop-sub-agents__spinner" aria-hidden="true" />
                ) : null}
                确认停止
              </button>
            </>
          }
        >
          <div className="batch-stop-sub-agents__dialog-scope">
            <span className="batch-stop-sub-agents__dialog-scope-label">活动中的子代理</span>
            <span className="batch-stop-sub-agents__dialog-scope-count">{activeCount}</span>
          </div>
        </AppDialog>
      ) : null}
    </>
  );
}
