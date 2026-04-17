import React from 'react';

export interface ChatScrollBottomButtonProps {
  streaming: boolean;
  hasPendingFollowContent: boolean;
  onScrollToBottom: () => void;
}

export function ChatScrollBottomButton({
  streaming,
  hasPendingFollowContent,
  onScrollToBottom,
}: ChatScrollBottomButtonProps) {
  return (
    <button
      type="button"
      data-testid="chat-scroll-bottom"
      onClick={onScrollToBottom}
      aria-label={
        streaming
          ? hasPendingFollowContent
            ? '有新内容，恢复最新对话聚焦'
            : '恢复最新对话聚焦'
          : '定位最新对话'
      }
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
        transform: 'translateX(-50%)',
        zIndex: 18,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        padding: '0 14px',
        maxWidth: 'calc(100% - 28px)',
        borderRadius: 999,
        border: hasPendingFollowContent
          ? '1px solid color-mix(in oklch, var(--accent) 55%, var(--border))'
          : '1px solid var(--border)',
        background: hasPendingFollowContent
          ? 'color-mix(in oklch, var(--surface) 82%, var(--accent) 18%)'
          : 'color-mix(in oklch, var(--surface) 90%, transparent)',
        color: hasPendingFollowContent ? 'var(--text)' : 'var(--text-2)',
        boxShadow: 'var(--shadow-md)',
        backdropFilter: 'blur(10px)',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        touchAction: 'manipulation',
      }}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
      {streaming
        ? hasPendingFollowContent
          ? '有新内容 · 恢复聚焦'
          : '恢复最新对话'
        : '定位最新对话'}
    </button>
  );
}
