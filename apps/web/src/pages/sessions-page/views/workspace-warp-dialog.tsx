/* ── Workspace warp dialog (P3-WARP stage 0) ──
 *
 * Lets the user explicitly rebind a session's `workingDirectory` to a
 * different absolute path. The gateway's `PATCH /sessions/:id/workspace`
 * endpoint enforces the legacy "first workspace wins" lock by default
 * — this dialog wraps that endpoint with the `force=true` opt-in so
 * the warp is always a deliberate user action, never a silent rebind.
 *
 * Constraints kept on purpose:
 *   - Path must be absolute (the gateway's `validateWorkspacePath`
 *     would reject relative paths anyway, but we surface a friendlier
 *     hint inline rather than waiting on a 403).
 *   - When the request hits the gateway's 409 immutable-workspace
 *     guard, we leave the dialog open so the user can retry with the
 *     "force" checkbox toggled on.
 *   - Saved workspace paths from the UI store are surfaced as quick
 *     pick chips so the user does not have to retype a long path.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { HttpError, type SessionsClient } from '@openAwork/web-client';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

interface WorkspaceWarpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  currentWorkingDirectory: string | null;
  sessionsClient: SessionsClient;
  token: string;
  onComplete: () => void;
}

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--bg-base)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const PANEL_STYLE: React.CSSProperties = {
  width: 'min(560px, 96vw)',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 10,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  boxShadow: '0 14px 40px var(--shadow-strong, rgba(0,0,0,0.25))',
  color: 'var(--fg-strong)',
};

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  background: 'var(--bg-surface)',
  color: 'var(--fg-strong)',
  fontSize: 13,
  fontFamily: 'var(--mono)',
  boxSizing: 'border-box',
};

const PILL_STYLE: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  fontFamily: 'var(--mono)',
};

const PRIMARY_BUTTON: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
};

const SECONDARY_BUTTON: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-strong)',
  cursor: 'pointer',
  fontSize: 13,
};

function isImmutableWorkspaceError(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  if (err.status !== 409) return false;
  const data = err.data as { error?: unknown } | undefined;
  // Any 409 from this endpoint is the immutable-workspace lock; the
  // gateway does not currently emit any other 409 here.
  return Boolean(data && typeof data === 'object');
}

export function WorkspaceWarpDialog({
  isOpen,
  onClose,
  sessionId,
  currentWorkingDirectory,
  sessionsClient,
  token,
  onComplete,
}: WorkspaceWarpDialogProps) {
  const savedWorkspacePaths = useUIStateStore((s) => s.savedWorkspacePaths);
  const [draft, setDraft] = useState(currentWorkingDirectory ?? '');
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each time the dialog opens reset transient state so a previously
  // surfaced error or stale draft does not bleed across sessions.
  useEffect(() => {
    if (isOpen) {
      setDraft(currentWorkingDirectory ?? '');
      setForce(false);
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen, currentWorkingDirectory]);

  const trimmedDraft = draft.trim();
  const isAbsolute = trimmedDraft.startsWith('/');
  const unchanged = trimmedDraft === (currentWorkingDirectory ?? '');
  const willClear = trimmedDraft.length === 0;
  const requiresForce = !!currentWorkingDirectory && !unchanged;

  const quickPicks = useMemo(
    () =>
      savedWorkspacePaths.filter((p) => p && p !== currentWorkingDirectory && p !== trimmedDraft),
    [savedWorkspacePaths, currentWorkingDirectory, trimmedDraft],
  );

  if (!isOpen) return null;

  async function submit(): Promise<void> {
    if (submitting) return;
    if (!willClear && !isAbsolute) {
      setError('请输入绝对路径（以 / 开头）');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await sessionsClient.warpWorkspace(token, sessionId, {
        workingDirectory: willClear ? null : trimmedDraft,
        // Always send force when the session already has a workspace
        // and the path is changing — otherwise the gateway returns
        // 409. The checkbox below is a UX speed bump for the user
        // to acknowledge it; we don't auto-fall-through to force
        // without that explicit click.
        ...(requiresForce && force ? { force: true } : {}),
      });
      onComplete();
      onClose();
    } catch (err) {
      if (isImmutableWorkspaceError(err) && requiresForce && !force) {
        // Surface the lock as a structured warning so the user can
        // tick the force checkbox and retry — we keep the dialog
        // open instead of bouncing them back to the detail panel.
        setError('该会话已绑定原工作区。要切换到新路径，请勾选下方“强制切换”后重试。');
      } else if (err instanceof HttpError && err.status === 403) {
        setError('该路径不允许（被工作区安全策略拒绝）');
      } else if (err instanceof HttpError && err.status === 404) {
        setError('会话不存在或不属于当前用户');
      } else {
        setError(`切换失败：${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={OVERLAY_STYLE}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div style={PANEL_STYLE}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>切换会话工作区</h3>
          <p style={{ margin: 0, color: 'var(--fg-default)', fontSize: 12, lineHeight: 1.6 }}>
            将本会话绑定到新的绝对路径。后续工具调用、文件审阅、新消息都会以新路径为根。
            {currentWorkingDirectory && '历史消息保留不变。'}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}>当前路径</span>
          <div
            style={{
              padding: '6px 8px',
              border: '1px dashed var(--border-subtle)',
              borderRadius: 6,
              background: 'var(--bg-surface)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--fg-default)',
              wordBreak: 'break-all',
            }}
          >
            {currentWorkingDirectory ?? '（未绑定）'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="workspace-warp-input"
            style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}
          >
            目标路径
          </label>
          <input
            id="workspace-warp-input"
            type="text"
            placeholder="/absolute/path/to/workspace（留空则解除绑定）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={INPUT_STYLE}
            spellCheck={false}
            autoFocus
            disabled={submitting}
          />
          {!willClear && !isAbsolute && draft.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--danger))' }}>路径必须以 / 开头</span>
          )}
        </div>

        {quickPicks.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontWeight: 600 }}>
              最近使用的工作区
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {quickPicks.slice(0, 6).map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => setDraft(path)}
                  style={PILL_STYLE}
                  title={path}
                  disabled={submitting}
                >
                  {path.length > 40 ? `…${path.slice(-38)}` : path}
                </button>
              ))}
            </div>
          </div>
        )}

        {requiresForce && (
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 10px',
              border: '1px solid var(--warning)',
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--fg-strong)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              disabled={submitting}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            <span>
              <strong>强制切换</strong>
              （workspace warp 阶段 0）。 历史消息中的工具调用是基于{' '}
              <code>{currentWorkingDirectory}</code> 写入的；
              切换后再请求执行旧路径下的文件，可能会失败或读取到错误位置。 切换记录会写入{' '}
              <code>workspaceWarpHistory</code>。
            </span>
          </label>
        )}

        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 10px',
              border: '1px solid var(--danger))',
              borderRadius: 6,
              background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
              color: 'var(--danger))',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={SECONDARY_BUTTON} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            style={{
              ...PRIMARY_BUTTON,
              opacity: submitting || unchanged ? 0.6 : 1,
              cursor: submitting || unchanged ? 'not-allowed' : 'pointer',
            }}
            disabled={submitting || unchanged}
          >
            {submitting ? '切换中…' : willClear ? '解除绑定' : '应用切换'}
          </button>
        </div>
      </div>
    </div>
  );
}
