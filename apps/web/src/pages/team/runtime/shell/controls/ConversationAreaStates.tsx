import type { CSSProperties } from 'react';

const STATE_PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--team-space-4)',
  width: '100%',
  maxWidth: 520,
  margin: '0 auto',
  padding: 'var(--team-space-6) var(--team-space-5)',
  textAlign: 'center',
  borderRadius: 'var(--team-radius-xl)',
  border: '1px dashed color-mix(in srgb, var(--border-default) 72%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
};

const SPINNER_STYLE: CSSProperties = {
  width: 'var(--team-spinner-size)',
  height: 'var(--team-spinner-size)',
  borderRadius: 'var(--team-radius-pill)',
  border: 'var(--team-spinner-border) solid color-mix(in srgb, var(--accent) 20%, transparent)',
  borderTopColor: 'var(--accent)',
  animation: 'spin var(--team-spin-duration) linear infinite',
};

export function LoadingState() {
  return (
    <div style={STATE_PANEL_STYLE} role="status" aria-live="polite">
      <span style={SPINNER_STYLE} aria-hidden="true" />
      <span
        style={{ fontSize: 'var(--team-font-sm)', color: 'var(--fg-default)', fontWeight: 700 }}
      >
        正在连接团队...
      </span>
    </div>
  );
}

export function ErrorState({
  error,
  onRetryConnection,
}: {
  readonly error: string;
  readonly onRetryConnection?: () => void;
}) {
  return (
    <div
      style={{
        ...STATE_PANEL_STYLE,
        borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 7%, var(--bg-overlay))',
      }}
      role="alert"
    >
      <div style={{ display: 'grid', gap: 'var(--team-space-2)' }}>
        <strong style={{ fontSize: 'var(--team-font-md)', color: 'var(--fg-strong)' }}>
          ⚠️ 网络连接已断开
        </strong>
        <span style={{ color: 'var(--fg-default)' }}>
          当前离线 — 可查看历史记录，无法执行新任务
        </span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--team-font-xxs)' }}>{error}</span>
      </div>
      <button
        type="button"
        onClick={onRetryConnection}
        style={{
          minHeight: 'var(--team-control-height-sm)',
          padding: '0 var(--team-space-4)',
          borderRadius: 'var(--team-radius-pill)',
          border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
          background: 'color-mix(in srgb, var(--danger) 12%, var(--bg-overlay))',
          color: 'var(--fg-strong)',
          fontSize: 'var(--team-font-xs)',
          fontWeight: 800,
          cursor: onRetryConnection ? 'pointer' : 'not-allowed',
          opacity: onRetryConnection ? 1 : 0.55,
        }}
      >
        重试连接
      </button>
    </div>
  );
}
