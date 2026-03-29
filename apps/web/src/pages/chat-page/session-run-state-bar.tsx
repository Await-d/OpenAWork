import type { SessionStateStatus } from './session-runtime.js';

function getSessionRunStateMeta(status: Extract<SessionStateStatus, 'running' | 'paused'>): {
  badge: string;
  description: string;
  dotColor: string;
  panelBackground: string;
  panelBorder: string;
} {
  if (status === 'paused') {
    return {
      badge: '等待处理',
      description: '当前会话已暂停，处理权限或问题后会继续同步最新结果。',
      dotColor: '#f59e0b',
      panelBackground: 'color-mix(in srgb, #f59e0b 8%, var(--surface))',
      panelBorder: '1px solid color-mix(in srgb, #f59e0b 26%, var(--border))',
    };
  }

  return {
    badge: '持续运行中',
    description: '你切回当前会话后，页面会继续自动同步最新消息和状态。',
    dotColor: 'var(--accent)',
    panelBackground: 'color-mix(in oklch, var(--surface) 86%, var(--accent) 14%)',
    panelBorder: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border))',
  };
}

export function SessionRunStateBar({
  status,
}: {
  status: Extract<SessionStateStatus, 'running' | 'paused'>;
}) {
  const meta = getSessionRunStateMeta(status);

  return (
    <div
      data-testid="chat-session-runtime-status"
      style={{
        padding: '0 10px 6px',
        background: 'var(--bg)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 740,
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          borderRadius: 12,
          padding: '8px 10px',
          background: meta.panelBackground,
          border: meta.panelBorder,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: meta.dotColor,
              boxShadow:
                status === 'running'
                  ? '0 0 0 4px color-mix(in oklch, var(--accent) 14%, transparent)'
                  : 'none',
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              会话{meta.badge}
            </div>
            <div
              style={{
                marginTop: 2,
                fontSize: 10,
                lineHeight: 1.35,
                color: 'var(--text-3)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {meta.description}
            </div>
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 22,
            padding: '0 8px',
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            color: status === 'paused' ? '#fcd34d' : 'var(--accent)',
            border:
              status === 'paused'
                ? '1px solid color-mix(in srgb, #f59e0b 28%, var(--border))'
                : '1px solid color-mix(in oklch, var(--accent) 22%, var(--border))',
            background:
              status === 'paused'
                ? 'color-mix(in srgb, #f59e0b 12%, transparent)'
                : 'color-mix(in oklch, var(--accent) 10%, transparent)',
            flexShrink: 0,
          }}
        >
          {meta.badge}
        </span>
      </div>
    </div>
  );
}

export function SessionRunStatePlaceholder({
  status,
}: {
  status: Extract<SessionStateStatus, 'running' | 'paused'>;
}) {
  const meta = getSessionRunStateMeta(status);

  return (
    <div
      data-testid="chat-remote-session-placeholder"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
        color: 'var(--text-2)',
        animation: 'fade-in 180ms ease-out',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: meta.dotColor,
          boxShadow:
            status === 'running'
              ? '0 0 0 4px color-mix(in oklch, var(--accent) 14%, transparent)'
              : 'none',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: 'var(--text)',
        }}
      >
        会话{meta.badge}
      </span>
    </div>
  );
}
