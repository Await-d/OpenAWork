/**
 * SnapshotRestoreConfirmDialog
 * ────────────────────────────
 *
 * 当用户执行"编辑对话"或"重试"操作时，如果被截断的消息范围内
 * 存在文件变更快照，弹出此确认对话框让用户选择：
 *
 *  1. 保留当前文件状态并继续操作
 *  2. 恢复文件到编辑点的快照后再继续
 *  3. 取消操作
 *
 * 设计文档：docs/design/ultra-file-change-tracking.md
 */

import type { SnapshotTreeEntry } from '@openAwork/web-client';

// ─── 类型 ──────────────────────────────────────────────────────────────

export interface SnapshotRestoreConfirmDialogProps {
  open: boolean;
  affectedSnapshots: SnapshotTreeEntry[];
  action: 'edit' | 'retry';
  onContinueWithoutRestore: () => void;
  onRestoreAndContinue: () => void;
  onCancel: () => void;
  restoreTargetTreeHash: string | null;
  restoreUnavailableReason?: string | null;
  restoreErrorMessage?: string | null;
  restoring?: boolean;
}

// ─── 辅助 ──────────────────────────────────────────────────────────────

function computeAffectedSummary(snapshots: SnapshotTreeEntry[]) {
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const snap of snapshots) {
    totalAdditions += snap.additions;
    totalDeletions += snap.deletions;
  }

  return {
    snapshotCount: snapshots.length,
    filesChanged: snapshots.reduce((sum, s) => sum + s.filesChanged, 0),
    totalAdditions,
    totalDeletions,
  };
}

function getActionLabel(action: 'edit' | 'retry'): string {
  return action === 'edit' ? '编辑对话' : '重试';
}

// ─── 组件 ──────────────────────────────────────────────────────────────

export function SnapshotRestoreConfirmDialog({
  open,
  affectedSnapshots,
  action,
  onContinueWithoutRestore,
  onRestoreAndContinue,
  onCancel,
  restoreTargetTreeHash,
  restoreUnavailableReason = null,
  restoreErrorMessage = null,
  restoring = false,
}: SnapshotRestoreConfirmDialogProps) {
  if (!open || affectedSnapshots.length === 0) return null;

  const summary = computeAffectedSummary(affectedSnapshots);
  const actionLabel = getActionLabel(action);
  const canRestore = Boolean(restoreTargetTreeHash) && !restoreUnavailableReason;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="文件变更确认"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 75,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 'min(480px, 100%)',
          borderRadius: 18,
          border: '1px solid color-mix(in oklch, var(--warning) 40%, var(--border-default))',
          background: 'var(--bg-overlay)',
          boxShadow: 'var(--shadow-xl)',
          padding: '20px 20px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* 标题 */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--fg-strong)',
            }}
          >
            <span style={{ fontSize: 18 }}>⚠️</span>
            此操作将影响已产生的文件变更
          </div>
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: 'var(--fg-default)' }}>
            从该消息之后有 <strong>{summary.snapshotCount} 个快照</strong>（修改了{' '}
            <strong>{summary.filesChanged} 个文件</strong>，+{summary.totalAdditions} / -
            {summary.totalDeletions}）。
            <br />
            {actionLabel}不会自动恢复这些文件变更。
          </div>
        </div>

        {restoreUnavailableReason ? (
          <div
            role="status"
            style={{
              borderRadius: 12,
              border: '1px solid color-mix(in oklch, var(--warning) 40%, var(--border-default))',
              background: 'color-mix(in oklch, var(--warning) 8%, var(--bg-overlay))',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--fg-default)',
            }}
          >
            {restoreUnavailableReason}
          </div>
        ) : null}

        {restoreErrorMessage ? (
          <div
            role="alert"
            style={{
              borderRadius: 12,
              border: '1px solid color-mix(in oklch, var(--danger) 40%, var(--border-default))',
              background: 'color-mix(in oklch, var(--danger) 8%, var(--bg-overlay))',
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--fg-default)',
            }}
          >
            恢复文件失败：{restoreErrorMessage}
          </div>
        ) : null}

        {/* 快照摘要 */}
        <div
          style={{
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            background: 'color-mix(in oklch, var(--warning) 5%, var(--bg-overlay))',
            padding: '10px 12px',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          {affectedSnapshots.slice(0, 5).map((snap) => (
            <div
              key={snap.treeHash}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                fontSize: 11,
                color: 'var(--fg-default)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--fg-muted)', minWidth: 36 }}>
                {snap.scopeKind === 'turn' ? '轮次' : '步骤'}
              </span>
              <span style={{ flex: 1 }}>
                {snap.filesChanged} 文件 · +{snap.additions} / -{snap.deletions}
              </span>
              {snap.toolName && (
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    background: 'var(--bg-subtle)',
                    padding: '1px 4px',
                    borderRadius: 3,
                  }}
                >
                  {snap.toolName}
                </span>
              )}
            </div>
          ))}
          {affectedSnapshots.length > 5 && (
            <div style={{ fontSize: 10, color: 'var(--fg-muted)', padding: '4px 0 0' }}>
              还有 {affectedSnapshots.length - 5} 个快照未展示
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={restoring}
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
              opacity: restoring ? 0.5 : 1,
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onContinueWithoutRestore}
            disabled={restoring}
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
              opacity: restoring ? 0.5 : 1,
            }}
          >
            保留文件并继续
          </button>
          {canRestore ? (
            <button
              type="button"
              onClick={onRestoreAndContinue}
              disabled={restoring}
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--accent)',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                cursor: restoring ? 'wait' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
                opacity: restoring ? 0.7 : 1,
              }}
            >
              {restoring ? '恢复中...' : '恢复文件后继续'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
