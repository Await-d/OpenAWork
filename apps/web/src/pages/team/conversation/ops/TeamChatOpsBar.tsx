import type { CSSProperties } from 'react';

/* ── style constants ─────────────────────────────────────────── */

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 12px',
  background: 'var(--bg-overlay)',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-subtle) 50%, transparent)',
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11.5,
  lineHeight: '16px',
  color: 'var(--fg-default)',
};

const PATH_STYLE: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 260,
};

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 10.5,
  fontWeight: 600,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
};

const MUTED_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontSize: 10.5,
  whiteSpace: 'nowrap',
};

const BUTTON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};

const BTN_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 6,
  fontSize: 10.5,
  fontWeight: 500,
  lineHeight: '18px',
  cursor: 'pointer',
  border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, transparent)',
  color: 'var(--fg-muted)',
  transition: 'background 160ms ease, color 120ms ease',
};

const FAIL_BADGE: CSSProperties = {
  ...CHIP_STYLE,
  background: 'color-mix(in srgb, var(--color-danger, #ef4444) 15%, transparent)',
  color: 'var(--color-danger, #ef4444)',
};

/* ── status helpers ──────────────────────────────────────────── */

const STATUS_TINT: Record<string, string> = {
  running: 'var(--color-info, #3b82f6)',
  paused: 'var(--color-warning, #eab308)',
  idle: 'var(--fg-muted)',
  failed: 'var(--color-danger, #ef4444)',
};

function chipStyle(status: string): CSSProperties {
  const tint = STATUS_TINT[status] ?? 'var(--fg-muted)';
  return {
    ...CHIP_STYLE,
    background: `color-mix(in srgb, ${tint} 15%, transparent)`,
    color: tint,
  };
}

/* ── props ───────────────────────────────────────────────────── */

export interface TeamChatOpsBarProps {
  pathLabel: string;
  status: 'running' | 'paused' | 'idle' | 'failed';
  statusLabel?: string;
  elapsedLabel?: string;
  failCount?: number;
  paused?: boolean;
  focusMode?: boolean;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onRetryFailed?: () => void;
  onFocusFail?: () => void;
  onCopySummary?: () => void;
  onToggleFocus?: () => void;
  busy?: boolean;
}

/* ── component ───────────────────────────────────────────────── */

export function TeamChatOpsBar({
  pathLabel,
  status,
  statusLabel,
  elapsedLabel,
  failCount,
  paused,
  focusMode,
  onPauseAll,
  onResumeAll,
  onRetryFailed,
  onFocusFail,
  onCopySummary,
  onToggleFocus,
  busy,
}: TeamChatOpsBarProps) {
  const displayStatus = statusLabel ?? status;
  const pauseOrResume = paused ? onResumeAll : onPauseAll;
  const hasActions = Boolean(
    pauseOrResume || onRetryFailed || onFocusFail || onCopySummary || onToggleFocus,
  );

  return (
    <div style={BAR_STYLE}>
      {/* ─ row 1: path + status + elapsed + fail count ─ */}
      <div style={ROW_STYLE}>
        <span style={PATH_STYLE} title={pathLabel}>
          {pathLabel}
        </span>
        <span style={chipStyle(status)}>{displayStatus}</span>
        {elapsedLabel != null && elapsedLabel !== '' && (
          <span style={MUTED_STYLE}>{elapsedLabel}</span>
        )}
        {failCount != null && failCount > 0 && <span style={FAIL_BADGE}>{failCount} fail</span>}
      </div>

      {/* ─ row 2: quick actions（仅渲染有回调的动作，避免与顶部状态栏重复） ─ */}
      {hasActions ? (
        <div style={BUTTON_ROW_STYLE}>
          {pauseOrResume ? (
            <button type="button" style={BTN_BASE} onClick={pauseOrResume} disabled={busy}>
              {paused ? '恢复全部' : '暂停全部'}
            </button>
          ) : null}
          {onRetryFailed ? (
            <button type="button" style={BTN_BASE} onClick={onRetryFailed} disabled={busy}>
              重试失败
            </button>
          ) : null}
          {onFocusFail ? (
            <button type="button" style={BTN_BASE} onClick={onFocusFail} disabled={busy}>
              定位失败
            </button>
          ) : null}
          {onCopySummary ? (
            <button type="button" style={BTN_BASE} onClick={onCopySummary} disabled={busy}>
              复制摘要
            </button>
          ) : null}
          {onToggleFocus ? (
            <button
              type="button"
              style={{
                ...BTN_BASE,
                ...(focusMode
                  ? {
                      background: 'color-mix(in srgb, var(--accent) 20%, transparent)',
                      color: 'var(--accent)',
                    }
                  : {}),
              }}
              onClick={onToggleFocus}
              disabled={busy}
            >
              {focusMode ? '退出专注' : '专注对话'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
