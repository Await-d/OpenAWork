import type { CSSProperties } from 'react';

export interface OAuthButtonProps {
  providerName: string;
  isAuthorized: boolean;
  onAuthorize: () => void;
  onRevoke: () => void;
  style?: CSSProperties;
}

export function OAuthButton({
  providerName,
  isAuthorized,
  onAuthorize,
  onRevoke,
  style,
}: OAuthButtonProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'system-ui, sans-serif',
        ...style,
      }}
    >
      {isAuthorized ? (
        <>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              color: '#4ade80',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#4ade80',
                flexShrink: 0,
              }}
            />
            {providerName} 已授权
          </span>
          <button
            type="button"
            onClick={onRevoke}
            style={{
              background: 'transparent',
              border: '1px solid #475569',
              borderRadius: 6,
              color: '#f87171',
              padding: '0.3rem 0.75rem',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            撤销
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={onAuthorize}
          style={{
            background: 'var(--color-accent, #6366f1)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '0.45rem 1.1rem',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          使用 {providerName} 授权
        </button>
      )}
    </div>
  );
}
