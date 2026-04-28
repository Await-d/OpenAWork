import { useEffect } from 'react';

const CHAT_REMOTE_STREAM_PLACEHOLDER_CSS = `
@keyframes omo-chat-remote-stream-pulse {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}
@keyframes omo-chat-remote-stream-blink {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}
.omo-chat-remote-stream-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  display: inline-block;
}
.omo-chat-remote-stream-dot[data-index='0'] {
  animation: omo-chat-remote-stream-blink 1.2s ease-in-out infinite;
}
.omo-chat-remote-stream-dot[data-index='1'] {
  animation: omo-chat-remote-stream-blink 1.2s ease-in-out 0.18s infinite;
}
.omo-chat-remote-stream-dot[data-index='2'] {
  animation: omo-chat-remote-stream-blink 1.2s ease-in-out 0.36s infinite;
}
.omo-chat-remote-stream-glow {
  animation: omo-chat-remote-stream-pulse 1.6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .omo-chat-remote-stream-dot,
  .omo-chat-remote-stream-glow {
    animation: none !important;
  }
}
`;

let chatRemoteStreamPlaceholderStyleInjected = false;

export function ChatRemoteStreamPlaceholder({
  status,
}: {
  status: 'running' | 'paused';
}) {
  useEffect(() => {
    if (chatRemoteStreamPlaceholderStyleInjected) {
      return;
    }

    chatRemoteStreamPlaceholderStyleInjected = true;
    const styleElement = document.createElement('style');
    styleElement.textContent = CHAT_REMOTE_STREAM_PLACEHOLDER_CSS;
    document.head.appendChild(styleElement);
  }, []);

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
            'color-mix(in oklch, var(--accent) 28%, color-mix(in oklch, var(--surface) 80%, transparent))',
          border: '1px solid color-mix(in oklch, var(--accent) 32%, var(--border))',
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
              ? '1px solid color-mix(in srgb, #f59e0b 28%, var(--border))'
              : '1px solid color-mix(in oklch, var(--accent) 24%, var(--border))',
          background:
            status === 'paused'
              ? 'color-mix(in srgb, #f59e0b 6%, var(--surface))'
              : 'color-mix(in oklch, var(--surface) 92%, var(--accent) 8%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text)',
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
            color: 'var(--text-2)',
            lineHeight: 1.55,
          }}
        >
          {description}
        </span>
      </div>
    </div>
  );
}
