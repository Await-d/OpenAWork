import React from 'react';
import type { UpstreamStreamSummary } from '@openAwork/shared';
import { formatChatUpstreamSummaryLabel } from './upstream-summary-label.js';

export interface ChatStreamErrorBarProps {
  streamError: string | null;
  latestUpstreamSummary?: UpstreamStreamSummary | null;
  /**
   * Optional retry affordance. When provided, the bar shows a primary
   * "重试" button next to "知道了". Used by chat to re-send the last
   * user turn after a stream failure.
   */
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * Optional progress line shown while the gateway / client is performing
   * automatic exponential-backoff retries (e.g. "自动重试中 · 第 2/3 次，约 2s 后…").
   * When present, the bar switches to a warning tone instead of pure danger.
   */
  retryProgress?: string | null;
  onDismiss: () => void;
}

export function ChatStreamErrorBar({
  streamError,
  latestUpstreamSummary,
  onRetry,
  retryLabel = '重试',
  retryProgress = null,
  onDismiss,
}: ChatStreamErrorBarProps) {
  if (!streamError && !retryProgress) {
    return null;
  }

  const summaryLine = formatChatUpstreamSummaryLabel(latestUpstreamSummary);
  const isRetrying = Boolean(retryProgress) && !streamError;
  const primaryText = streamError ?? retryProgress ?? '';
  const toneBorder = isRetrying ? 'var(--warning)' : 'var(--danger-border)';
  const toneBg = isRetrying
    ? 'color-mix(in srgb, var(--warning) 10%, var(--bg-overlay))'
    : 'var(--danger-muted)';
  const toneFg = isRetrying ? 'var(--warning)' : 'var(--danger)';

  return (
    <div
      data-testid="chat-stream-error-bar"
      style={{
        padding: '0 10px 6px',
        background: 'var(--bg-base)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: `1px solid ${toneBorder}`,
          background: toneBg,
          color: toneFg,
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
          {isRetrying ? (
            <>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </>
          )}
        </svg>
        <div
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 11,
            lineHeight: 1.45,
            color: toneFg,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={[primaryText, summaryLine].filter(Boolean).join(' · ')}
        >
          {primaryText}
          {streamError && summaryLine ? ` · ${summaryLine}` : ''}
          {streamError && retryProgress ? ` · ${retryProgress}` : ''}
        </div>
        {onRetry && streamError ? (
          <button
            type="button"
            data-testid="chat-stream-error-retry"
            onClick={onRetry}
            style={{
              border: `1px solid ${toneFg}`,
              background: 'color-mix(in srgb, currentColor 12%, transparent)',
              color: toneFg,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 999,
              flexShrink: 0,
            }}
          >
            {retryLabel}
          </button>
        ) : null}
        {streamError ? (
          <button
            type="button"
            data-testid="chat-stream-error-dismiss"
            onClick={onDismiss}
            style={{
              border: 'none',
              background: 'transparent',
              color: toneFg,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '0 2px',
              flexShrink: 0,
            }}
          >
            知道了
          </button>
        ) : null}
      </div>
    </div>
  );
}
