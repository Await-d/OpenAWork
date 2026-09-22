import React, { memo, useEffect, useState } from 'react';
import { getLocalReasoningLabel } from './assistant-reasoning-block.helpers.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';

/**
 * 流式与静态折叠共用的窗口行数：保证 finalize 前后渲染高度一致，不产生跳动。
 * 折叠窗口取**末尾** N 行（见 `bodyStyle`），流式期间因此始终能看到最新思考内容。
 */
const REASONING_COLLAPSED_MAX_LINES = 3;

function computeClampedBodyMaxHeight(lines: number): string {
  return `${lines * 1.6 * 13 + 4}px`;
}

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
  const lineCount = content.split('\n').length;
  const isLive = streaming || messageStreaming;
  // 折叠阈值与是否流式无关：流式与静态使用同一限高，finalize 时高度/内容不跳动
  const isCollapsible = lineCount > 1;

  const shouldCollapse = isCollapsible && !expanded;
  const showLiveEndedBadge = isLive && ended;
  const showExpandButton = !expanded && isCollapsible;
  const showCollapseButton = expanded && isCollapsible;

  // 折叠窗口是"贴底窗口"：`column-reverse` 把内容钉在容器底部，超出部分从**顶部**
  // 裁掉，因此折叠预览始终落在最新的 N 行上 —— 流式期间新内容自动进入可见区
  // （无需 JS 跟随滚动 / 无滚动位置跳变），用户手动收起后看到的也是最新思考。
  // 流式与静态共用同一布局，finalize 时不会出现"末 N 行 → 前 N 行"的跳动。
  const bodyStyle: React.CSSProperties | undefined = shouldCollapse
    ? {
        maxHeight: computeClampedBodyMaxHeight(REASONING_COLLAPSED_MAX_LINES),
        display: 'flex',
        flexDirection: 'column-reverse',
        overflow: 'clip',
        position: 'relative',
      }
    : undefined;

  return (
    <section
      className="assistant-reasoning-block"
      data-streaming={streaming ? 'true' : 'false'}
      data-ended={ended ? 'true' : undefined}
      data-collapsed={shouldCollapse ? 'true' : undefined}
      data-collapsed-window={shouldCollapse ? 'tail' : undefined}
      data-duration-ms={typeof durationMs === 'number' ? String(durationMs) : undefined}
    >
      <span className="assistant-reasoning-label">{label}</span>
      <div className="assistant-reasoning-body" style={bodyStyle}>
        {renderBody(content, streaming)}
      </div>
      {showExpandButton && (
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
      {showCollapseButton && (
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
