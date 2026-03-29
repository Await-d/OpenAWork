import { useEffect } from 'react';

const CHAT_SESSION_SKELETON_CSS = `
@keyframes omo-chat-session-pulse{0%,100%{opacity:1}50%{opacity:0.42}}
.omo-chat-session-skel{animation:omo-chat-session-pulse 1.45s ease-in-out infinite;background:var(--surface-2);border-radius:6px;}
`;

let chatSessionSkeletonStyleInjected = false;

export function ChatSessionSkeleton() {
  useEffect(() => {
    if (chatSessionSkeletonStyleInjected) {
      return;
    }

    chatSessionSkeletonStyleInjected = true;
    const styleElement = document.createElement('style');
    styleElement.textContent = CHAT_SESSION_SKELETON_CSS;
    document.head.appendChild(styleElement);
  }, []);

  return (
    <div
      data-testid="chat-session-skeleton"
      aria-busy="true"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        paddingTop: 8,
      }}
    >
      {[0, 1, 2, 3].map((row) => {
        const isUser = row % 2 === 0;

        return (
          <div
            key={`chat-session-skeleton-${row}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div
              className="omo-chat-session-skel"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                flexShrink: 0,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  className="omo-chat-session-skel"
                  style={{ height: 11, width: isUser ? 64 : 74 }}
                />
                <div className="omo-chat-session-skel" style={{ height: 9, width: 52 }} />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxWidth: isUser ? '72%' : '88%',
                }}
              >
                <div
                  className="omo-chat-session-skel"
                  style={{ height: 12, width: isUser ? '58%' : '82%' }}
                />
                <div
                  className="omo-chat-session-skel"
                  style={{ height: 12, width: isUser ? '42%' : '68%' }}
                />
                {!isUser && (
                  <div className="omo-chat-session-skel" style={{ height: 12, width: '54%' }} />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
