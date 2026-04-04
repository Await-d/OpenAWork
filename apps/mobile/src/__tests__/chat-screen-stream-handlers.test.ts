import { describe, expect, it, vi } from 'vitest';
import type { AgentActivity } from '../components/AgentActivityPanel.js';
import {
  createChatScreenGuardedStreamHandlers,
  type ChatScreenStreamMessage,
} from '../screens/chat-screen-stream-handlers.js';

interface TestMessage extends ChatScreenStreamMessage {
  role: 'assistant' | 'user';
}

function createHarness(options: { canApplyMutation: boolean }) {
  let activities: AgentActivity[] = [
    {
      id: 'tool-1',
      kind: 'tool',
      name: '读取文件',
      status: 'running',
    },
  ];
  let messages: TestMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      streaming: true,
    },
  ];

  const sendingCalls: boolean[] = [];
  let clearedStreamTokenCount = 0;
  let scheduleScrollCount = 0;
  const syncTaskActivities = vi.fn<(requestSessionId: string) => void>();

  const handlers = createChatScreenGuardedStreamHandlers<TestMessage>({
    assistantId: 'assistant-1',
    canApplyMutation: () => options.canApplyMutation,
    clearActiveStreamToken: () => {
      clearedStreamTokenCount += 1;
    },
    requestSessionId: 'session-a',
    scheduleScrollToBottom: () => {
      scheduleScrollCount += 1;
    },
    setActivities: (updater) => {
      activities = updater(activities);
    },
    setMessages: (updater) => {
      messages = updater(messages);
    },
    setSending: (next) => {
      sendingCalls.push(next);
    },
    syncTaskActivities,
  });

  return {
    get activities() {
      return activities;
    },
    get clearedStreamTokenCount() {
      return clearedStreamTokenCount;
    },
    handlers,
    get messages() {
      return messages;
    },
    get scheduleScrollCount() {
      return scheduleScrollCount;
    },
    get sendingCalls() {
      return sendingCalls;
    },
    syncTaskActivities,
  };
}

describe('chat-screen-stream-handlers', () => {
  it('ignores stale callbacks without mutating state', () => {
    const harness = createHarness({ canApplyMutation: false });

    harness.handlers.onConnected?.();
    harness.handlers.onDelta('忽略这段增量');
    harness.handlers.onDone('stop');
    harness.handlers.onError('ERR', '失败');
    harness.handlers.onActivity?.({ id: 'tool-2', kind: 'tool_start', name: '列出目录' });

    expect(harness.syncTaskActivities).not.toHaveBeenCalled();
    expect(harness.messages).toEqual([
      { id: 'assistant-1', role: 'assistant', content: '', streaming: true },
    ]);
    expect(harness.activities).toEqual([
      { id: 'tool-1', kind: 'tool', name: '读取文件', status: 'running' },
    ]);
    expect(harness.clearedStreamTokenCount).toBe(0);
    expect(harness.sendingCalls).toEqual([]);
    expect(harness.scheduleScrollCount).toBe(0);
  });

  it('applies deltas and task activity updates for active callbacks', () => {
    const harness = createHarness({ canApplyMutation: true });

    harness.handlers.onConnected?.();
    harness.handlers.onDelta('先整理上下文');
    harness.handlers.onActivity?.({
      id: 'task-1',
      kind: 'task_update',
      name: '@explore · 查链路',
      status: 'running',
    });
    harness.handlers.onActivity?.({
      id: 'tool-1',
      kind: 'tool_result',
      name: '读取文件',
      isError: false,
    });

    expect(harness.syncTaskActivities).toHaveBeenCalledWith('session-a');
    expect(harness.messages[0]).toMatchObject({ content: '先整理上下文', streaming: true });
    expect(harness.activities).toEqual([
      { id: 'tool-1', kind: 'tool', name: '读取文件', status: 'done' },
      {
        id: 'task-1',
        kind: 'subagent',
        name: '@explore · 查链路',
        status: 'running',
        output: undefined,
        subagentDetail: {
          prompt: '@explore · 查链路',
          messages: [],
        },
      },
    ]);
  });

  it('finalizes active streams on done and clears sending state', () => {
    const harness = createHarness({ canApplyMutation: true });

    harness.handlers.onDone('completed');

    expect(harness.syncTaskActivities).toHaveBeenCalledWith('session-a');
    expect(harness.activities).toEqual([
      { id: 'tool-1', kind: 'tool', name: '读取文件', status: 'done' },
    ]);
    expect(harness.messages).toEqual([
      { id: 'assistant-1', role: 'assistant', content: '', streaming: false },
    ]);
    expect(harness.clearedStreamTokenCount).toBe(1);
    expect(harness.sendingCalls).toEqual([false]);
    expect(harness.scheduleScrollCount).toBe(1);
  });

  it('marks active streams as failed on error', () => {
    const harness = createHarness({ canApplyMutation: true });

    harness.handlers.onError('ERR', '网络异常');

    expect(harness.syncTaskActivities).toHaveBeenCalledWith('session-a');
    expect(harness.activities).toEqual([
      { id: 'tool-1', kind: 'tool', name: '读取文件', status: 'error' },
    ]);
    expect(harness.messages).toEqual([
      { id: 'assistant-1', role: 'assistant', content: '错误：网络异常', streaming: false },
    ]);
    expect(harness.clearedStreamTokenCount).toBe(1);
    expect(harness.sendingCalls).toEqual([false]);
    expect(harness.scheduleScrollCount).toBe(0);
  });

  it('keeps tool_result output when the mobile stream event includes a timeout reason', () => {
    const harness = createHarness({ canApplyMutation: true });

    harness.handlers.onActivity?.({
      id: 'tool-1',
      kind: 'tool_result',
      name: 'task',
      isError: true,
      reason: 'timeout',
      output: '原因：超时 · 子代理首条响应在 30 秒内未返回。',
    });

    expect(harness.activities).toEqual([
      {
        id: 'tool-1',
        kind: 'tool',
        name: 'task',
        status: 'error',
        output: '原因：超时 · 子代理首条响应在 30 秒内未返回。',
      },
    ]);
  });
});
