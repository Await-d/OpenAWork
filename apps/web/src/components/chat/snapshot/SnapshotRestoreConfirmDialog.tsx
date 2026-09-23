/**
 * SnapshotRestoreConfirmDialog
 * ────────────────────────────
 *
 * 当用户执行"编辑对话"或"重试"操作时，如果被截断的消息范围内
 * 检测到文件变更（快照 / 变更投影 / 消息 trace 任一来源），弹出此确认对话框让用户选择：
 *
 *  1. 保留当前文件状态并继续操作
 *  2. 恢复文件到编辑点的快照后再继续（存在可用快照时）
 *  3. 打开文件变更面板自行处理（调用方注入入口）
 *  4. 取消操作
 *
 * 设计约束（产品确认）：**检测到变更就必须弹窗，不允许静默放行**；
 * 无法自动恢复（无快照 / 读取失败）时仍展示影响面与原因，只是隐藏恢复按钮。
 *
 * 设计文档：docs/design/ultra-file-change-tracking.md
 */

import type { SnapshotTreeEntry } from '@openAwork/web-client';
import {
  formatAffectedChangeSummary,
  summarizeAffectedChanges,
  type AffectedChangeSummary,
  type AffectedFileEntry,
} from './affected-changes.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

export interface SnapshotRestoreConfirmDialogProps {
  open: boolean;
  affectedSnapshots: SnapshotTreeEntry[];
  /** 检测到的文件清单（trace / 变更投影 / 快照文件条目合并）。 */
  files?: readonly AffectedFileEntry[];
  /** 变更摘要；缺省时由 `files` 推导。 */
  changeSummary?: AffectedChangeSummary | null;
  /**
   * 检测不完整（任一信号读取失败）。为真且没有任何证据时，对话框展示
   * 「无法确认是否存在变更」，且不提供恢复——但**不得**因此静默放行。
   */
  detectionIncomplete?: boolean;
  action: 'edit' | 'retry';
  onContinueWithoutRestore: () => void;
  onRestoreAndContinue: () => void;
  onCancel: () => void;
  /** 打开文件变更面板；缺省时对话框不渲染该入口。 */
  onOpenFileChangesPanel?: () => void;
  restoreTargetTreeHash: string | null;
  restoreUnavailableReason?: string | null;
  restoreErrorMessage?: string | null;
  restoring?: boolean;
}

// ─── 辅助 ──────────────────────────────────────────────────────────────

const MAX_VISIBLE_FILES = 8;

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

function formatFileStatusLabel(status: AffectedFileEntry['status']): string {
  if (status === 'added') return '新增';
  if (status === 'deleted') return '删除';
  return '修改';
}

// ─── 组件 ──────────────────────────────────────────────────────────────

export function SnapshotRestoreConfirmDialog({
  open,
  affectedSnapshots,
  files = [],
  changeSummary = null,
  detectionIncomplete = false,
  action,
  onContinueWithoutRestore,
  onRestoreAndContinue,
  onCancel,
  onOpenFileChangesPanel,
  restoreTargetTreeHash,
  restoreUnavailableReason = null,
  restoreErrorMessage = null,
  restoring = false,
}: SnapshotRestoreConfirmDialogProps) {
  if (!open || (!detectionIncomplete && affectedSnapshots.length === 0 && files.length === 0)) {
    return null;
  }

  const snapshotSummary = computeAffectedSummary(affectedSnapshots);
  const fileSummary = changeSummary ?? summarizeAffectedChanges(files);
  const actionLabel = getActionLabel(action);
  const canRestore = Boolean(restoreTargetTreeHash) && !restoreUnavailableReason;
  const visibleFiles = files.slice(0, MAX_VISIBLE_FILES);
  const hiddenFileCount = files.length - visibleFiles.length;
  const hasEvidence = affectedSnapshots.length > 0 || files.length > 0;

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
          width: 'min(520px, 100%)',
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
            {affectedSnapshots.length > 0 ? (
              <>
                从该消息之后有 <strong>{snapshotSummary.snapshotCount} 个快照</strong>（修改了{' '}
                <strong>{snapshotSummary.filesChanged} 个文件</strong>，+
                {snapshotSummary.totalAdditions} / -{snapshotSummary.totalDeletions}）。
              </>
            ) : files.length > 0 ? (
              <>
                从该消息之后检测到 <strong>{fileSummary.fileCount} 个文件变更</strong>（+
                {fileSummary.totalAdditions} / -{fileSummary.totalDeletions}）。
              </>
            ) : (
              <>
                文件变更检测未完成，<strong>无法确认</strong>该消息之后是否存在变更。
              </>
            )}
            <br />
            {hasEvidence
              ? `${actionLabel}不会自动恢复这些文件变更。`
              : '继续操作不会恢复任何文件。'}
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

        {/* 影响面：优先展示精确文件清单，无文件条目时回退到快照列表 */}
        {visibleFiles.length > 0 ? (
          <div
            data-testid="snapshot-restore-file-list"
            style={{
              borderRadius: 12,
              border: '1px solid var(--border-subtle)',
              background: 'color-mix(in oklch, var(--warning) 5%, var(--bg-overlay))',
              padding: '8px 12px',
              maxHeight: 148,
              overflow: 'auto',
            }}
          >
            {visibleFiles.map((file) => (
              <div
                key={file.file}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 0',
                  fontSize: 11,
                  color: 'var(--fg-default)',
                }}
              >
                <span style={{ color: 'var(--fg-muted)', minWidth: 28, flexShrink: 0 }}>
                  {formatFileStatusLabel(file.status)}
                </span>
                <span
                  title={file.file}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: 'var(--fg-strong)',
                  }}
                >
                  {file.file}
                </span>
                <span style={{ color: 'var(--fg-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  +{file.additions} / -{file.deletions}
                </span>
              </div>
            ))}
            {hiddenFileCount > 0 ? (
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', padding: '4px 0 0' }}>
                另外还有 {hiddenFileCount} 个文件变更未展示（
                {formatAffectedChangeSummary(fileSummary)}）
              </div>
            ) : null}
          </div>
        ) : (
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
        )}

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
          {onOpenFileChangesPanel ? (
            <button
              type="button"
              onClick={onOpenFileChangesPanel}
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
              打开文件变更面板
            </button>
          ) : null}
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
