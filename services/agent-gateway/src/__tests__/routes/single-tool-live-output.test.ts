/**
 * 单条工具的实时输出通道（`buildSingleToolPartialOutputWriter`）。
 *
 * 契约：把滚动 stdout 写成 `tool_progress` 事件的「单元素 subTools」形态，
 * 前端 `applyStreamToolProgress` → `_batchProgress` → `BlockToolCall` 据此渲染
 * 实时终端（与 batch 子行同源）。这里锁定事件形状，防止后续改成别的通道时
 * 两端悄悄脱钩。
 */

import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import { buildSingleToolPartialOutputWriter } from '../../routes/single-tool-live-output.js';

function collect() {
  const events: RunEvent[] = [];
  return { events, writeChunk: (chunk: RunEvent) => events.push(chunk) };
}

describe('buildSingleToolPartialOutputWriter', () => {
  it('把滚动输出写成单元素 subTools 的 tool_progress 事件', () => {
    const { events, writeChunk } = collect();
    const emit = buildSingleToolPartialOutputWriter({
      clientRequestId: 'req-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      writeChunk,
    });

    emit('line 1\n');
    emit('line 1\nline 2\n');

    expect(events).toHaveLength(2);
    const event = events[1];
    expect(event?.type).toBe('tool_progress');
    if (event?.type !== 'tool_progress') throw new Error('unexpected event type');
    expect(event.toolCallId).toBe('tool-1');
    expect(event.toolName).toBe('bash');
    expect(event.clientRequestId).toBe('req-1');
    expect(event.completedCount).toBe(0);
    expect(event.totalCount).toBe(1);
    expect(event.subTools).toEqual([
      { index: 0, tool: 'bash', status: 'running', partialOutput: 'line 1\nline 2\n' },
    ]);
  });

  it('没有 clientRequestId 时不写该字段（保持事件形状最小）', () => {
    const { events, writeChunk } = collect();
    const emit = buildSingleToolPartialOutputWriter({
      toolCallId: 'tool-2',
      toolName: 'bash',
      writeChunk,
    });

    emit('done');

    const event = events[0];
    if (event?.type !== 'tool_progress') throw new Error('unexpected event type');
    expect('clientRequestId' in event).toBe(false);
    expect(event.subTools[0]?.partialOutput).toBe('done');
  });
});
