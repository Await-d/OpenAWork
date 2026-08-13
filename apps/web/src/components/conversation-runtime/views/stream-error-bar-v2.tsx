import React, { useState } from 'react';
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

export function ChatStreamErrorBarV2({
  streamError,
  latestUpstreamSummary,
  onRetry,
  retryLabel = '重试',
  retryProgress = null,
  onDismiss,
}: ChatStreamErrorBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!streamError && !retryProgress) {
    return null;
  }

  const summaryLine = formatChatUpstreamSummaryLabel(latestUpstreamSummary);
  const isRetrying = Boolean(retryProgress) && !streamError;
  const primaryText = streamError ?? retryProgress ?? '';

  // 判断是否需要折叠（超过80字符）
  const needsExpand = primaryText.length > 80;
  const displayText = needsExpand && !isExpanded ? primaryText.slice(0, 80) + '...' : primaryText;

  const toneBorder = isRetrying ? 'var(--warning)' : 'var(--danger-border)';
  const toneBg = isRetrying
    ? 'color-mix(in srgb, var(--warning) 10%, var(--bg-overlay))'
    : 'color-mix(in srgb, var(--danger) 10%, var(--bg-overlay))';
  const toneFg = isRetrying ? 'var(--warning)' : 'var(--danger)';

  return (
    <div
      data-testid="chat-stream-error-bar"
      style={{
        padding: '0 10px 8px',
        background: 'var(--bg-base)',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          border: `1.5px solid ${toneBorder}`,
          background: toneBg,
          borderRadius: 10,
          padding: '10px 12px',
          boxShadow: `0 2px 8px color-mix(in srgb, ${toneFg} 12%, transparent)`,
        }}
      >
        {/* 主要内容行 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          {/* 图标 */}
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
            style={{
              flexShrink: 0,
              marginTop: 2,
              color: toneFg,
            }}
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

          {/* 错误文本 */}
          <div
            style={{
              minWidth: 0,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.55,
                color: toneFg,
                fontWeight: 600,
                wordBreak: 'break-word',
              }}
            >
              {displayText}
            </div>

            {/* 额外信息行 */}
            {(summaryLine || (streamError && retryProgress)) && (
              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: `color-mix(in srgb, ${toneFg} 75%, var(--fg-muted))`,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {summaryLine && <span>{summaryLine}</span>}
                {streamError && retryProgress && (
                  <>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span>{retryProgress}</span>
                  </>
                )}
              </div>
            )}

            {/* 展开/收起按钮 */}
            {needsExpand && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                  alignSelf: 'flex-start',
                  border: 'none',
                  background: 'transparent',
                  color: `color-mix(in srgb, ${toneFg} 85%, var(--fg-strong))`,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '2px 0',
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                }}
              >
                {isExpanded ? '收起' : '查看完整信息'}
              </button>
            )}
          </div>

          {/* 操作按钮组 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            {onRetry && streamError ? (
              <button
                type="button"
                data-testid="chat-stream-error-retry"
                onClick={onRetry}
                style={{
                  border: `1.5px solid ${toneFg}`,
                  background: `color-mix(in srgb, ${toneFg} 14%, transparent)`,
                  color: toneFg,
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '4px 12px',
                  borderRadius: 6,
                  flexShrink: 0,
                  transition: 'all 140ms ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `color-mix(in srgb, ${toneFg} 20%, transparent)`;
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `color-mix(in srgb, ${toneFg} 14%, transparent)`;
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
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
                  color: `color-mix(in srgb, ${toneFg} 75%, var(--fg-muted))`,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  flexShrink: 0,
                  borderRadius: 5,
                  transition: 'all 120ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `color-mix(in srgb, ${toneFg} 10%, transparent)`;
                  e.currentTarget.style.color = toneFg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = `color-mix(in srgb, ${toneFg} 75%, var(--fg-muted))`;
                }}
              >
                知道了
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
