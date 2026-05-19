/**
 * 260517-chat-remote-stream-placeholder · 远端流恢复占位
 *
 * 关联样式：`.omo-chat-remote-stream-*` 与 `@keyframes omo-chat-remote-stream-*`
 * 已统一收纳到 `src/styles/loaders.css`，由 `main.tsx` 一次性 import。
 */

export function ChatRemoteStreamPlaceholder({ status }: { status: 'running' | 'paused' }) {
  const label = status === 'paused' ? '会话已暂停，等待处理…' : '正在恢复输出…';
  const description =
    status === 'paused'
      ? '处理待审批/待回答事项后，输出会继续同步过来。'
      : '助手仍在为这次回答工作，正在重新接入流式输出。';

  return (
    <div
      data-testid="chat-remote-stream-placeholder"
      aria-busy="true"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '6px 0',
      }}
    >
      <div
        className="omo-chat-remote-stream-glow"
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          flexShrink: 0,
          background:
            'color-mix(in oklch, var(--accent) 28%, var(--bg-overlay))',
          border: '1px solid color-mix(in oklch, var(--accent) 32%, var(--border-default))',
        }}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flex: 1,
          minWidth: 0,
          padding: '6px 12px',
          borderRadius: 10,
          border:
            status === 'paused'
              ? '1px solid color-mix(in srgb, var(--warning) 28%, var(--border-default))'
              : '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-default))',
          background:
            status === 'paused'
              ? 'color-mix(in srgb, var(--warning) 6%, var(--bg-overlay))'
              : 'color-mix(in oklch, var(--bg-overlay) 92%, var(--accent) 8%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--fg-strong)',
              letterSpacing: '0.01em',
            }}
          >
            {label}
          </span>
          <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
            <span className="omo-chat-remote-stream-dot" data-index="0" />
            <span className="omo-chat-remote-stream-dot" data-index="1" />
            <span className="omo-chat-remote-stream-dot" data-index="2" />
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: 'var(--fg-default)',
            lineHeight: 1.55,
          }}
        >
          {description}
        </span>
      </div>
    </div>
  );
}
