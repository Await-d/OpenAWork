import React, { memo, useState } from 'react';
import {
  buildLocalReasoningBlockKey,
  getLocalReasoningLabel,
} from './assistant-reasoning-block.helpers.js';

const reasoningOpenStateCache = new Map<string, boolean>();

export const buildReasoningBlockKey = buildLocalReasoningBlockKey;

export function resetReasoningOpenStateCacheForTests() {
  reasoningOpenStateCache.clear();
}

const REASONING_COLLAPSED_MAX_LINES = 3;

function formatReasoningEndedBadge(durationMs?: number): string {
  if (typeof durationMs !== 'number' || durationMs < 0) {
    return '已完成思考';
  }
  if (durationMs < 1000) {
    return `已完成思考 · ${durationMs} 毫秒`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    const formatted = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);
    return `已完成思考 · ${formatted} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds - minutes * 60);
  return `已完成思考 · ${minutes} 分 ${remainingSeconds} 秒`;
}

// Memoized: all props are primitives EXCEPT `renderBody` (function) which
// must be passed as a stable module-level reference from the parent — see
// `renderReasoningRichBody` in ChatPageSections.tsx. Combined, shallow
// comparison hits 100% when neither content nor surrounding flags change,
// allowing recovery commits to skip the embedded markdown re-parse here.
export const AssistantReasoningBlock = memo(function AssistantReasoningBlock({
  content,
  durationMs,
  ended = false,
  index,
  messageStreaming = false,
  renderBody,
  streaming = false,
  total,
}: {
  content: string;
  /**
   * Total wall-clock millis the upstream spent on this reasoning block.
   * Surfaced as a friendly suffix (e.g. "已完成思考 · 12.3 秒"). Undefined when
   * the backend did not report `startedAt`/`endedAt`.
   */
  durationMs?: number;
  /**
   * Whether the upstream `thinking_end` signal has already arrived for this
   * specific reasoning block. Drives the explicit "已完成思考" UI cue so users
   * no longer have to infer the boundary from text/tool transitions.
   */
  ended?: boolean;
  index: number;
  messageStreaming?: boolean;
  renderBody: (content: string, streaming: boolean) => React.ReactNode;
  stateKey?: string;
  streaming?: boolean;
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = getLocalReasoningLabel({ index, streaming, total });
  const labeledContent = `*${label}* ${content}`;
  const lineCount = content.split('\n').length;
  const isLive = streaming || messageStreaming;
  const isCollapsible = !isLive && lineCount > 1;
  const shouldCollapse = isCollapsible && !expanded;
  const showLiveEndedBadge = isLive && ended;

  return (
    <section
      className="assistant-reasoning-block"
      data-streaming={streaming ? 'true' : 'false'}
      data-ended={ended ? 'true' : undefined}
      data-collapsed={shouldCollapse ? 'true' : undefined}
      data-duration-ms={typeof durationMs === 'number' ? String(durationMs) : undefined}
    >
      <div
        className="assistant-reasoning-body"
        style={
          shouldCollapse
            ? {
                maxHeight: `${REASONING_COLLAPSED_MAX_LINES * 1.6 * 13 + 4}px`,
                overflow: 'clip',
                position: 'relative',
              }
            : undefined
        }
      >
        {renderBody(labeledContent, streaming)}
      </div>
      {shouldCollapse && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setExpanded(true);
          }}
          style={{
            position: 'relative',
            marginTop: -22,
            height: 22,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(to bottom, transparent 0%, color-mix(in oklch, var(--bg-base) 50%, transparent) 50%, var(--bg-base) 100%)',
              pointerEvents: 'none',
            }}
          />
          <span
            style={{
              position: 'relative',
              fontSize: 10,
              color: 'var(--fg-muted)',
              lineHeight: 1,
            }}
          >
            展开思考
          </span>
        </div>
      )}
      {isCollapsible && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="chat-markdown-code-copy"
          style={{ fontSize: 10, marginTop: 2, display: 'inline', color: 'var(--fg-muted)' }}
        >
          收起思考
        </button>
      )}
      {showLiveEndedBadge && (
        <span
          className="assistant-reasoning-ended-badge"
          aria-label="思考已完成"
          style={{
            fontSize: 10,
            color: 'var(--fg-muted)',
            marginTop: 2,
          }}
        >
          ✓ {formatReasoningEndedBadge(durationMs)}
        </span>
      )}
    </section>
  );
});
