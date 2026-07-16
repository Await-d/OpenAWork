/**
 * ChatComposerOptimize — 提示词优化错误提示 + 结果弹窗
 */

import type { RefObject } from 'react';
import type { PromptCandidate, PromptOptimizerResult } from '@openAwork/web-client';
import type { ComposerOptimizeError } from './composer-optimize-error.js';

export interface ChatComposerOptimizeProps {
  optimizeError: ComposerOptimizeError | null;
  optimizeResult: PromptOptimizerResult | null;
  optimizePopoverRef: RefObject<HTMLDivElement | null>;
  onClearError: () => void;
  onClose: () => void;
  onSelectCandidate: (candidate: PromptCandidate) => void;
  onRetryOptimize?: () => void;
}

export function ChatComposerOptimize({
  optimizeError,
  optimizeResult,
  optimizePopoverRef,
  onClearError,
  onClose,
  onSelectCandidate,
  onRetryOptimize,
}: ChatComposerOptimizeProps) {
  return (
    <>
      {optimizeError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 6,
            background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            color: 'color-mix(in srgb, var(--danger) 80%, var(--fg-on-accent) 20%)',
            fontSize: 10,
            lineHeight: 1.5,
            flexShrink: 0,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {optimizeError.message}
          {optimizeError.retryable && onRetryOptimize && (
            <button
              type="button"
              onClick={onRetryOptimize}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1,
                marginLeft: 4,
              }}
            >
              重试
            </button>
          )}
          <button
            type="button"
            onClick={onClearError}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              padding: 0,
              fontSize: 10,
              lineHeight: 1,
              marginLeft: 2,
              opacity: 0.7,
            }}
          >
            ✕
          </button>
        </div>
      )}
      {optimizeResult && (
        <div
          ref={optimizePopoverRef}
          className="composer-optimize-popover"
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: 10,
            background: 'var(--bg-overlay)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 10px 5px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-overlay)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span
                style={{
                  width: 18,
                  height: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  background: 'color-mix(in oklch, var(--success) 14%, transparent)',
                  color: 'color-mix(in oklch, var(--success) 82%, var(--fg-on-accent) 18%)',
                  flexShrink: 0,
                  fontSize: 9,
                }}
              >
                ✦
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-strong)' }}>
                提示词优化建议
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-muted)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                lineHeight: 1,
              }}
              title="关闭"
            >
              ✕
            </button>
          </div>
          {optimizeResult.rationale && (
            <div
              style={{
                padding: '4px 10px',
                fontSize: 10,
                color: 'var(--fg-default)',
                lineHeight: 1.5,
                borderBottom: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklch, var(--success) 4%, transparent)',
              }}
            >
              {optimizeResult.rationale}
            </div>
          )}
          <div style={{ padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {optimizeResult.candidates.map((candidate: PromptCandidate) => {
              const isRecommended = candidate.id === optimizeResult.recommended;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => onSelectCandidate(candidate)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: isRecommended
                      ? '1px solid color-mix(in oklch, var(--success) 30%, var(--border-subtle))'
                      : '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: isRecommended
                      ? 'color-mix(in oklch, var(--success) 6%, transparent)'
                      : 'transparent',
                    color: 'var(--fg-strong)',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    transition: 'background 150ms ease, border-color 150ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: isRecommended ? 700 : 600,
                        color: isRecommended
                          ? 'color-mix(in oklch, var(--success) 82%, var(--fg-on-accent) 18%)'
                          : 'var(--fg-default)',
                      }}
                    >
                      {isRecommended ? '★ 推荐' : `候选 ${candidate.id}`}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: 'var(--fg-strong)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {candidate.text}
                  </span>
                  {candidate.improvements.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
                      {candidate.improvements.map((imp: string, idx: number) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: 9,
                            padding: '1px 5px',
                            borderRadius: 999,
                            background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                            color:
                              'color-mix(in oklch, var(--accent) 70%, var(--fg-on-accent) 30%)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {imp}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
