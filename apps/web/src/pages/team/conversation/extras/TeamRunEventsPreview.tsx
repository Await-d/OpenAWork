import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { RunEvent } from '@openAwork/shared';
import { getTeamRichTextPreviewText } from './team-message-content.js';

interface RunEventPreviewItem {
  detail: string;
  id: string;
  tone: 'default' | 'danger' | 'info';
  title: string;
}

/**
 * 折叠行只显示最新一条的标题。标题里可能带长工具名 / 错误码，先按字符截断，
 * 余下宽度交给单行省略号兜底。
 */
const COLLAPSED_PREVIEW_MAX_LENGTH = 60;

/**
 * 折叠态固定 28px 单行 + flexShrink:0：它渲染在滚动区之外（beforeMessages 槽位），
 * 高度必须收敛，否则展开态的兄弟节点会把 `chat-scroll-region` 压成 0 高。
 */
const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  minWidth: 0,
  padding: '0 10px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 28,
  minWidth: 0,
};

const TITLE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const COUNT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 16,
  height: 16,
  padding: '0 5px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border-default) 42%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
  color: 'var(--fg-strong)',
  fontSize: 10,
  fontWeight: 750,
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

const LATEST_PREVIEW_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--fg-strong)',
  fontSize: 11,
  fontWeight: 650,
};

const LATEST_PREVIEW_DANGER_STYLE: CSSProperties = {
  ...LATEST_PREVIEW_STYLE,
  color: 'var(--danger)',
};

const TOGGLE_BUTTON_STYLE: CSSProperties = {
  appearance: 'none',
  border: '1px solid color-mix(in srgb, var(--border-default) 42%, transparent)',
  color: 'var(--fg-strong)',
  minHeight: 20,
  padding: '0 8px',
  fontSize: 10.5,
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
};

const BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  maxHeight: 'min(40vh, 320px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  minWidth: 0,
  padding: '2px 0 8px',
};

const ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
};

const ITEM_TITLE_STYLE: CSSProperties = {
  color: 'var(--fg-strong)',
  fontSize: 11,
  fontWeight: 700,
};

const ITEM_TITLE_DANGER_STYLE: CSSProperties = {
  ...ITEM_TITLE_STYLE,
  color: 'var(--danger)',
};

const ITEM_DETAIL_STYLE: CSSProperties = {
  color: 'var(--fg-muted)',
  fontSize: 11,
  lineHeight: 1.55,
};

function truncate(value: string, max = 180): string {
  return getTeamRichTextPreviewText(value, max);
}

function mergeTextEvents(events: RunEvent[]): RunEventPreviewItem[] {
  const items: RunEventPreviewItem[] = [];
  let textBuffer = '';
  let reasoningBuffer = '';
  let toolBuffer = new Map<string, { toolName: string; input: string }>();

  const flushText = () => {
    if (textBuffer.trim()) {
      items.push({
        detail: truncate(textBuffer.trim()),
        id: `text-${items.length}`,
        title: '文本生成',
        tone: 'default',
      });
      textBuffer = '';
    }
    if (reasoningBuffer.trim()) {
      items.push({
        detail: truncate(reasoningBuffer.trim()),
        id: `thinking-${items.length}`,
        title: '分析过程',
        tone: 'info',
      });
      reasoningBuffer = '';
    }
    if (toolBuffer.size > 0) {
      for (const [toolCallId, tool] of toolBuffer) {
        items.push({
          detail: truncate(tool.input || '工具参数仍在流式生成'),
          id: `tool-${toolCallId}`,
          title: `工具调用 · ${tool.toolName}`,
          tone: 'info',
        });
      }
      toolBuffer = new Map();
    }
  };

  for (const event of events) {
    if (event.type === 'text_delta') {
      textBuffer += event.delta;
      continue;
    }
    if (event.type === 'thinking_delta') {
      reasoningBuffer += event.delta;
      continue;
    }
    if (event.type === 'tool_call_delta') {
      const existing = toolBuffer.get(event.toolCallId);
      toolBuffer.set(event.toolCallId, {
        input: `${existing?.input ?? ''}${event.inputDelta}`,
        toolName: event.toolName,
      });
      continue;
    }

    flushText();

    if (event.type === 'tool_result') {
      items.push({
        detail: event.isError
          ? truncate(event.reason ?? '工具执行失败')
          : truncate(`已返回 ${event.toolName} 执行结果`),
        id: `tool-result-${event.toolCallId}-${items.length}`,
        title: `工具结果 · ${event.toolName}`,
        tone: event.isError ? 'danger' : 'default',
      });
      continue;
    }
    if (event.type === 'task_update') {
      items.push({
        detail: truncate(event.result ?? event.errorMessage ?? event.label),
        id: `task-${event.taskId}-${items.length}`,
        title: `任务状态 · ${event.status}`,
        tone: event.status === 'failed' ? 'danger' : 'default',
      });
      continue;
    }
    if (event.type === 'error') {
      items.push({
        detail: truncate(event.message),
        id: `error-${event.eventId ?? items.length}`,
        title: `错误 · ${event.code}`,
        tone: 'danger',
      });
    }
  }

  flushText();
  return items.slice(-8);
}

export function TeamRunEventsPreview({ runEvents }: { runEvents: RunEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const items = mergeTextEvents(runEvents);
  const latest = items[items.length - 1];
  if (!latest) {
    return null;
  }

  return (
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <strong style={TITLE_STYLE}>过程时间线</strong>
        <span style={COUNT_STYLE}>{items.length}</span>
        <span
          style={latest.tone === 'danger' ? LATEST_PREVIEW_DANGER_STYLE : LATEST_PREVIEW_STYLE}
          title={latest.title}
        >
          {truncate(latest.title, COLLAPSED_PREVIEW_MAX_LENGTH)}
        </span>
        <button
          type="button"
          className="team-v2-control team-v2-control--surface"
          style={TOGGLE_BUTTON_STYLE}
          aria-expanded={expanded}
          aria-label={expanded ? '收起过程时间线' : '展开过程时间线'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {expanded ? (
        <div style={BODY_STYLE}>
          {items.map((item) => (
            <div key={item.id} style={ITEM_STYLE}>
              <span style={item.tone === 'danger' ? ITEM_TITLE_DANGER_STYLE : ITEM_TITLE_STYLE}>
                {item.title}
              </span>
              <span style={ITEM_DETAIL_STYLE}>{item.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
