/**
 * 共置测试：`streaming-message-merge.ts`。
 *
 * `replaceOrAppendStreamedAssistantMessage` 决定流结束时的最终消息是
 * 替换某个本地占位消息还是追加。匹配优先级：
 *
 * 1. 消息 ID 完全相同；
 * 2. 分片 ID 重叠（确定性，无启发式）；
 * 3. 本轮流见过的 toolCallId 与本地 trace 重叠；
 * 4. 正文本 / 推理块前缀匹配；
 * 5. 快照等价兜底。
 *
 * 回溯遇到用户消息立即停止，且最多检查 5 条 trace 消息。后者保证多轮
 * 工具回合中，最终消息不会错误覆盖更早一轮的完整消息。
 */
import { describe, expect, it } from 'vitest';
import { replaceOrAppendStreamedAssistantMessage } from './streaming-message-merge.js';
import { createAssistantEventCardContent } from './card-codec.js';
import type { ChatMessage, ChatToolPart } from './message-model.js';
import { createAssistantTraceContent } from './trace-codec.js';

function toolPart(toolCallId: string, status: 'running' | 'completed'): ChatToolPart {
  return {
    id: toolCallId,
    type: 'tool',
    toolCallId,
    toolName: 'Bash',
    input: {},
    status,
  };
}

describe('replaceOrAppendStreamedAssistantMessage', () => {
  it('相同消息 ID 时原位替换并保留前后消息顺序', () => {
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const placeholder: ChatMessage = {
      id: 'stream-1',
      role: 'assistant',
      content: '',
      status: 'streaming',
    };
    const eventCard: ChatMessage = {
      id: 'card-1',
      role: 'assistant',
      content: createAssistantEventCardContent({
        kind: 'tool',
        title: '工具执行',
        message: '完成',
        status: 'success',
      }),
      status: 'completed',
    };
    const completed: ChatMessage = {
      id: 'stream-1',
      role: 'assistant',
      content: '完成',
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage(
      [user, placeholder, eventCard],
      completed,
      new Set(),
    );

    expect(next.map((message) => message.id)).toEqual(['u-1', 'stream-1', 'card-1']);
    expect(next[1]).toBe(completed);
    expect(next[0]).toBe(user);
    expect(next[2]).toBe(eventCard);
  });

  it('分片 ID 重叠时只替换当前轮，不覆盖更早的独立轮次', () => {
    const firstRound: ChatMessage = {
      id: 'round-1',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '第一轮',
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'Read', input: {} }],
      }),
      parts: [toolPart('tc-1', 'completed')],
      status: 'completed',
    };
    const secondRoundPlaceholder: ChatMessage = {
      id: 'round-2-placeholder',
      role: 'assistant',
      content: '',
      parts: [toolPart('tc-2', 'running')],
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'round-2-final',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '第二轮完成',
        toolCalls: [{ toolCallId: 'tc-2', toolName: 'Bash', input: {}, output: 'ok' }],
      }),
      parts: [toolPart('tc-2', 'completed')],
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage(
      [firstRound, secondRoundPlaceholder],
      onDone,
      new Set(),
    );

    expect(next.map((message) => message.id)).toEqual(['round-1', 'round-2-final']);
    expect(next[0]).toBe(firstRound);
  });

  it('本轮 toolCallId 与本地无分片 trace 重叠时替换', () => {
    const local: ChatMessage = {
      id: 'local-earlier',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [{ toolCallId: 'tc-9', toolName: 'Bash', input: {} }],
      }),
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: '完成',
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([local], onDone, new Set(['tc-9']));

    expect(next.map((message) => message.id)).toEqual(['final']);
  });

  it('正文本前缀匹配时替换本地 trace 消息', () => {
    const local: ChatMessage = {
      id: 'local',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '这是', toolCalls: [] }),
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '这是最终回答', toolCalls: [] }),
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([local], onDone, new Set());

    expect(next.map((message) => message.id)).toEqual(['final']);
  });

  it('onDone 文本比本地短时前缀匹配失败，改为追加', () => {
    const local: ChatMessage = {
      id: 'local',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '这是最终回答', toolCalls: [] }),
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '这是', toolCalls: [] }),
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([local], onDone, new Set());

    expect(next.map((message) => message.id)).toEqual(['local', 'final']);
  });

  it('推理块前缀匹配时替换本地 trace 消息', () => {
    const local: ChatMessage = {
      id: 'local',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [],
        reasoningBlocks: ['先分析'],
      }),
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: createAssistantTraceContent({
        text: '',
        toolCalls: [],
        reasoningBlocks: ['先分析，再执行'],
      }),
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([local], onDone, new Set());

    expect(next.map((message) => message.id)).toEqual(['final']);
  });

  it('无 trace 的纯文本正文一致时替换', () => {
    const local: ChatMessage = {
      id: 'local',
      role: 'assistant',
      content: '完成',
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: '完成',
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([local], onDone, new Set());

    expect(next.map((message) => message.id)).toEqual(['final']);
  });

  it('未命中任何启发式时追加到列表末尾', () => {
    const messages: ChatMessage[] = [
      { id: 'u-1', role: 'user', content: '问题' },
      { id: 'round-1', role: 'assistant', content: '第一轮' },
    ];
    const onDone: ChatMessage = {
      id: 'round-2',
      role: 'assistant',
      content: '第二轮',
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage(messages, onDone, new Set());

    expect(next.map((message) => message.id)).toEqual(['u-1', 'round-1', 'round-2']);
    expect(next[0]).toBe(messages[0]);
    expect(next[1]).toBe(messages[1]);
  });

  it('回溯遇到用户消息时停止，不替换更早的助手消息', () => {
    const earlier: ChatMessage = {
      id: 'round-0',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '前缀', toolCalls: [] }),
      status: 'completed',
    };
    const user: ChatMessage = { id: 'u-1', role: 'user', content: '问题' };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '前缀更多', toolCalls: [] }),
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([earlier, user], onDone, new Set());

    expect(next.map((message) => message.id)).toEqual(['round-0', 'u-1', 'final']);
    expect(next[0]).toBe(earlier);
  });

  it('超过 5 条 trace 消息的检查预算后不再回溯', () => {
    const target: ChatMessage = {
      id: 'target',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '目标前缀', toolCalls: [] }),
      status: 'completed',
    };
    const fillers: ChatMessage[] = Array.from({ length: 6 }, (_, index) => ({
      id: `filler-${index}`,
      role: 'assistant',
      content: createAssistantTraceContent({ text: `填充内容 ${index}`, toolCalls: [] }),
      status: 'completed' as const,
    }));
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: createAssistantTraceContent({ text: '目标前缀已完成', toolCalls: [] }),
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage([target, ...fillers], onDone, new Set());

    expect(next.map((message) => message.id)).toEqual([
      'target',
      ...fillers.map((filler) => filler.id),
      'final',
    ]);
  });

  it('追加时按消息 ID 去重已有的重复项', () => {
    const duplicateA: ChatMessage = { id: 'dup', role: 'assistant', content: 'A' };
    const duplicateB: ChatMessage = { id: 'dup', role: 'assistant', content: 'B' };
    const onDone: ChatMessage = {
      id: 'final',
      role: 'assistant',
      content: 'C',
      status: 'completed',
    };

    const next = replaceOrAppendStreamedAssistantMessage(
      [duplicateA, duplicateB],
      onDone,
      new Set(),
    );

    expect(next.map((message) => message.id)).toEqual(['dup', 'final']);
    expect(next[0]).toBe(duplicateA);
  });

  it('同一消息重复提交时保持幂等', () => {
    const placeholder: ChatMessage = {
      id: 'stream-1',
      role: 'assistant',
      content: '',
      status: 'streaming',
    };
    const onDone: ChatMessage = {
      id: 'stream-1',
      role: 'assistant',
      content: '完成',
      status: 'completed',
    };

    const first = replaceOrAppendStreamedAssistantMessage([placeholder], onDone, new Set());
    const second = replaceOrAppendStreamedAssistantMessage(first, onDone, new Set());

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]).toBe(onDone);
  });
});
