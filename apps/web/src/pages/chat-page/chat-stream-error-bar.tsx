import React from 'react';

export interface ChatStreamErrorBarProps {
  streamError: string | null;
  onDismiss: () => void;
}

export function ChatStreamErrorBar({ streamError, onDismiss }: ChatStreamErrorBarProps) {
  if (!streamError) {
    return null;
  }

  return (
    <div
      style={{
        padding: '0 10px 6px',
        background: 'var(--bg)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 700,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid rgba(239, 68, 68, 0.22)',
          background: 'rgba(239, 68, 68, 0.08)',
          color: 'var(--danger)',
          borderRadius: 10,
          padding: '7px 10px',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 11,
            lineHeight: 1.45,
            color: 'var(--danger)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={streamError}
        >
          {streamError}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--danger)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '0 2px',
            flexShrink: 0,
          }}
        >
          知道了
        </button>
      </div>
    </div>
  );
}
