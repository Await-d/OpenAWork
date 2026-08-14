import React, { memo, useState, useEffect } from 'react';
import {
  buildLocalReasoningBlockKey,
  getLocalReasoningLabel,
} from './assistant-reasoning-block.helpers.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

const reasoningOpenStateCache = new Map<string, boolean>();

export const buildReasoningBlockKey = buildLocalReasoningBlockKey;

export function resetReasoningOpenStateCacheForTests() {
  reasoningOpenStateCache.clear();
}

const REASONING_COLLAPSED_MAX_LINES = 3;

function formatReasoningEndedBadge(durationMs?: number): string {
  if (typeof durationMs !== 'number' || durationMs < 0) {
    return '思考完成';
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    const formatted = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);
    return `${formatted}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// Memoized: all props are primitives EXCEPT `renderBody` (function) which
// must be passed as a stable module-level reference from the parent — see
// `renderReasoningRichBody` in ChatPageSections.tsx. Combined, shallow
// comparison hits 100% when neither content nor surrounding flags change,
// allowing recovery commits to skip the embedded markdown re-parse here.
export const AssistantReasoningBlock = memo(function AssistantReasoningBlock({
  content,
  defaultExpanded = false,
  durationMs,
  ended = false,
  index,
  messageStreaming = false,
  renderBody,
  streaming = false,
  total,
}: {
  content: string;
  /** 控制折叠初始状态。为 true 时不折叠（用于显示设置中的"推理过程默认展开"）。 */
  defaultExpanded?: boolean;
  durationMs?: number;
  ended?: boolean;
  index: number;
  messageStreaming?: boolean;
  renderBody: (content: string, streaming: boolean) => React.ReactNode;
  stateKey?: string;
  streaming?: boolean;
  total: number;
}) {
  // 直接从 store 读取设置，确保设置变化时能响应
  const reasoningExpandedByDefaultPref = useDisplayPreferencesStore(
    (s) => s.reasoningExpandedByDefault,
  );

  // 使用用户设置作为初始值，但仍允许手动展开/折叠
  const [expanded, setExpanded] = useState(reasoningExpandedByDefaultPref);

  // 当设置变化时，重置展开状态（仅当用户没有手动操作过时）
  const [userInteracted, setUserInteracted] = useState(false);

  useEffect(() => {
    if (!userInteracted) {
      setExpanded(reasoningExpandedByDefaultPref);
    }
  }, [reasoningExpandedByDefaultPref, userInteracted]);
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
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            setUserInteracted(true);
          }}
          className="chat-markdown-code-copy"
          style={{ fontSize: 10, marginTop: 4, display: 'inline', color: 'var(--fg-muted)' }}
        >
          展开
        </button>
      )}
      {isCollapsible && expanded && (
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setUserInteracted(true);
          }}
          className="chat-markdown-code-copy"
          style={{ fontSize: 10, marginTop: 4, display: 'inline', color: 'var(--fg-muted)' }}
        >
          收起
        </button>
      )}
      {showLiveEndedBadge && (
        <span
          className="assistant-reasoning-ended-badge"
          aria-label="思考已完成"
          style={{
            fontSize: 10,
            color: 'var(--fg-muted)',
            marginTop: 4,
          }}
        >
          {formatReasoningEndedBadge(durationMs)}
        </span>
      )}
    </section>
  );
});
