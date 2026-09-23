/**
 * TeamChangesPanelModal —— team 端「变更快照」面板弹窗
 *
 * 回退 / 重试对话框的「打开文件变更面板」落点：team 不能跨引
 * `pages/chat-page/**` 的审查面板，因此复用 `components/chat` 的
 * `SnapshotTimelinePanel`——可查看每个步骤 / 回合的快照，并预览 / 恢复到任意 tree。
 *
 * 依赖约束：仅引 `components/chat/**`（允许），不引 `pages/chat-page/**`（禁止）。
 */

import { SnapshotTimelinePanel } from '../../../../components/chat/snapshot/SnapshotTimelinePanel.js';

export interface TeamChangesPanelModalProps {
  readonly gatewayUrl: string;
  readonly onClose: () => void;
  readonly sessionId: string;
}

export function TeamChangesPanelModal({
  gatewayUrl,
  onClose,
  sessionId,
}: TeamChangesPanelModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="变更快照"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--bg-base) 60%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 76,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          height: 'min(70vh, 640px)',
          borderRadius: 18,
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          boxShadow: 'var(--shadow-xl)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg-strong)' }}>变更快照</div>
            <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: 'var(--fg-muted)' }}>
              可预览并恢复到任意步骤 / 回合；恢复会改动工作区文件，请确认后再执行。
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              height: 30,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-default)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            关闭
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <SnapshotTimelinePanel gatewayUrl={gatewayUrl} sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}
