/**
 * ConfirmDeleteWorkspaceModal · 删除团队工作区二次确认
 *
 * 由 WorkspaceSwitcher 通过 onRequestDelete 回调触发，TeamPageV2 持有该 modal 状态。
 *
 * 设计要点：
 * - 显著危险色（红）+ 清晰说明影响范围
 * - 必须输入工作区名称才能启用「确认删除」按钮（防止误删）
 * - 显示该工作区下的会话数量（提示历史会话仍保留）
 * - 当前激活工作区被删除时，调用方需自行处理 navigate
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { TeamWorkspaceSummary } from '@openAwork/web-client';
import type { AgentTeamsWorkspaceGroup } from '../../data/team-runtime-types.js';
import { XIcon } from '../../shared/TeamIcons.js';

export interface ConfirmDeleteWorkspaceModalProps {
  workspace: TeamWorkspaceSummary;
  /** 用于显示该工作区下的会话数（来自 reference-data.workspaceGroups）。 */
  workspaceGroups?: AgentTeamsWorkspaceGroup[];
  onCancel: () => void;
  onConfirm: () => Promise<boolean> | boolean;
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 800,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(4px)',
};

const MODAL_STYLE: CSSProperties = {
  position: 'relative',
  width: 480,
  maxWidth: '92vw',
  borderRadius: 16,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.4)',
  padding: 22,
  display: 'grid',
  gap: 16,
};

const HERO_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const ICON_BADGE_STYLE: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 12,
  display: 'grid',
  placeItems: 'center',
  background: 'color-mix(in srgb, var(--error) 14%, transparent)',
  color: 'var(--error)',
  flexShrink: 0,
};

const TITLE_STYLE: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--fg-strong)',
  marginBottom: 4,
};

const SUBTITLE_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const META_BOX_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
  fontSize: 12,
};

const META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
};

const META_LABEL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
};

const META_VALUE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontWeight: 600,
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const NOTICE_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-default)',
  lineHeight: 1.6,
  padding: 10,
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
  border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
};

const FIELD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 13,
  cursor: 'pointer',
};

const DANGER_BUTTON_STYLE: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--error)',
  color: 'var(--fg-on-accent))',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const ERROR_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--error)',
  background: 'color-mix(in srgb, var(--error) 10%, transparent)',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
};

export function ConfirmDeleteWorkspaceModal({
  workspace,
  workspaceGroups,
  onCancel,
  onConfirm,
}: ConfirmDeleteWorkspaceModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 计算会话数（按 defaultWorkingRoot 匹配）
  const sessionCount = useMemo(() => {
    if (!workspaceGroups) return null;
    const root = workspace.defaultWorkingRoot;
    if (!root) return null;
    const group = workspaceGroups.find((g) => g.workspacePath === root);
    return group?.sessions.length ?? 0;
  }, [workspace.defaultWorkingRoot, workspaceGroups]);

  const canConfirm = confirmText.trim() === workspace.name && !submitting;

  // ESC 关闭
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onConfirm();
      if (!ok) {
        setError('删除失败，请稍后重试');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={OVERLAY_STYLE}>
      <button
        type="button"
        aria-label="关闭删除确认弹窗"
        onClick={onCancel}
        style={{
          position: 'absolute',
          inset: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
      <div
        style={MODAL_STYLE}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="del-ws-title"
        aria-describedby="del-ws-desc"
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="关闭"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: 'none',
            border: 'none',
            color: 'var(--fg-muted)',
            padding: 4,
            cursor: 'pointer',
            display: 'inline-flex',
            borderRadius: 4,
          }}
        >
          <XIcon size={14} color="var(--fg-muted)" />
        </button>

        <div style={HERO_STYLE}>
          <div style={ICON_BADGE_STYLE} aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="del-ws-title" style={TITLE_STYLE}>
              删除工作区
            </div>
            <div id="del-ws-desc" style={SUBTITLE_STYLE}>
              此操作不可撤销。请确认你要永久删除此工作区。
            </div>
          </div>
        </div>

        <div style={META_BOX_STYLE}>
          <div style={META_ROW_STYLE}>
            <span style={META_LABEL_STYLE}>名称</span>
            <span style={META_VALUE_STYLE} title={workspace.name}>
              {workspace.name}
            </span>
          </div>
          {workspace.defaultWorkingRoot ? (
            <div style={META_ROW_STYLE}>
              <span style={META_LABEL_STYLE}>默认工作目录</span>
              <span
                style={{
                  ...META_VALUE_STYLE,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, monospace, Consolas, "Liberation Mono"',
                  fontSize: 11,
                }}
                title={workspace.defaultWorkingRoot}
              >
                {workspace.defaultWorkingRoot}
              </span>
            </div>
          ) : null}
          {sessionCount != null ? (
            <div style={META_ROW_STYLE}>
              <span style={META_LABEL_STYLE}>关联会话</span>
              <span style={META_VALUE_STYLE}>{sessionCount} 个</span>
            </div>
          ) : null}
        </div>

        <div style={NOTICE_STYLE}>
          <strong style={{ color: 'var(--warning))' }}>注意：</strong>
          删除工作区后，所有关联的会话历史记录将保留（不会级联删除），但无法继续在此工作区中创建新的协作运行。
        </div>

        <div style={FIELD_STYLE}>
          <label htmlFor="del-ws-confirm" style={LABEL_STYLE}>
            请输入工作区名称{' '}
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                color: 'var(--fg-strong)',
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {workspace.name}
            </span>{' '}
            以确认
          </label>
          <input
            id="del-ws-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => {
              setConfirmText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) {
                e.preventDefault();
                void handleConfirm();
              }
            }}
            placeholder={workspace.name}
            style={INPUT_STYLE}
            autoFocus
            autoComplete="off"
          />
        </div>

        {error ? (
          <div role="alert" style={ERROR_STYLE}>
            {error}
          </div>
        ) : null}

        <div style={ACTIONS_ROW_STYLE}>
          <button
            type="button"
            onClick={onCancel}
            style={SECONDARY_BUTTON_STYLE}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            style={{
              ...DANGER_BUTTON_STYLE,
              opacity: canConfirm ? 1 : 0.5,
              cursor: canConfirm ? 'pointer' : 'not-allowed',
            }}
            disabled={!canConfirm}
          >
            {submitting ? '删除中…' : '永久删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
