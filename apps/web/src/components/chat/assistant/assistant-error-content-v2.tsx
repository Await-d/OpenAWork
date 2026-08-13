import React, { useState } from 'react';
import { getFriendlyErrorMessage } from '../../../utils/errors/friendly-error-messages.js';

export function looksLikeAssistantErrorContent(content: string): boolean {
  return /^\[错误:\s*[A-Za-z0-9_]+\]/.test(content.trim());
}

function parseAssistantErrorContent(content: string): {
  code?: string;
  detail?: string;
  headline: string;
  suggestion?: string;
  canRetry: boolean;
} {
  const normalized = content.trim();
  const bracketMatch = normalized.match(/^\[错误:\s*([A-Za-z0-9_]+)\]\s*(.*)$/s);
  const baseMessage = bracketMatch?.[2]?.trim() || normalized;
  const code = bracketMatch?.[1]?.trim() || undefined;

  // 使用友好错误消息系统
  const friendlyError = getFriendlyErrorMessage(baseMessage);

  return {
    code,
    headline: friendlyError.title,
    detail: friendlyError.message,
    suggestion: friendlyError.suggestion,
    canRetry: friendlyError.canRetry,
  };
}

function ErrorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function AssistantErrorContent({
  content,
  onRetry,
}: {
  content: string;
  /** Optional inline retry for the failed turn. */
  onRetry?: () => void;
}) {
  const parsed = parseAssistantErrorContent(content);
  const [isExpanded, setIsExpanded] = useState(true);

  // 如果详情超过150字符，支持展开/折叠
  const detailNeedsCollapse = (parsed.detail?.length || 0) > 150;
  const displayDetail =
    detailNeedsCollapse && !isExpanded ? parsed.detail?.slice(0, 150) + '...' : parsed.detail;

  // 如果错误不可重试，不显示重试按钮
  const shouldShowRetry = onRetry && parsed.canRetry;

  return (
    <div
      className="chat-message-error-banner-v2"
      data-testid="chat-message-error-banner"
      role="alert"
      aria-live="assertive"
    >
      <div className="chat-message-error-icon">
        <ErrorIcon size={18} />
      </div>

      <div className="chat-message-error-content">
        <div className="chat-message-error-head">
          {parsed.code && (
            <span className="chat-message-error-label" aria-label={`错误代码: ${parsed.code}`}>
              {parsed.code}
            </span>
          )}
          <span className="chat-message-error-title">{parsed.headline || '请求失败'}</span>
        </div>

        {parsed.detail && (
          <div className="chat-message-error-detail-wrapper">
            <div className="chat-message-error-detail">{displayDetail}</div>
            {detailNeedsCollapse && (
              <button
                type="button"
                className="chat-message-error-toggle"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? '收起' : '展开详情'}
              </button>
            )}
          </div>
        )}

        {/* 建议信息 */}
        {parsed.suggestion && (
          <div className="chat-message-error-suggestion">
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
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{parsed.suggestion}</span>
          </div>
        )}

        {shouldShowRetry && (
          <div className="chat-message-error-actions">
            <button
              type="button"
              data-testid="chat-message-error-retry"
              className="chat-message-error-retry"
              onClick={onRetry}
            >
              <svg
                width="12"
                height="12"
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
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
