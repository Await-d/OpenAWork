import type { CSSProperties } from 'react';
import type { RunEvent } from '@openAwork/shared';
import { getTeamRichTextPreviewText } from './team-message-content.js';

interface RunEventPreviewItem {
  detail: string;
  id: string;
  tone: 'default' | 'danger' | 'info';
  title: string;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
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
  const items = mergeTextEvents(runEvents);
  if (items.length === 0) {
    return null;
  }

  return (
    <div style={CONTAINER_STYLE}>
      <strong style={{ fontSize: 11, color: 'var(--fg-strong)' }}>过程时间线</strong>
      {items.map((item) => (
        <div key={item.id} style={ITEM_STYLE}>
          <span
            style={{
              color: item.tone === 'danger' ? 'var(--danger)' : 'var(--fg-strong)',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {item.title}
          </span>
          <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.55 }}>
            {item.detail}
          </span>
        </div>
      ))}
    </div>
  );
}
