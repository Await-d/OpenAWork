import { describe, expect, it, vi } from 'vitest';
import type { AgentActivity } from '../components/AgentActivityPanel';
import type { ActivityEvent } from '../hooks/useGatewayClient';
import { createChatScreenGuardedStreamHandlers } from './chat-screen-stream-handlers.js';

interface TestMessage {
  content: string;
  id: string;
  streaming?: boolean;
}

function buildTaskUpdateEvent(
  status: Extract<ActivityEvent, { kind: 'task_update' }>['status'],
): ActivityEvent {
  return {
    kind: 'task_update',
    id: 't-1',
    name: '@explore · 审计会话唤醒原语',
    status,
  };
}

function buildHarness(options: { canApplyMutation?: () => boolean } = {}) {
  const refreshSubagentNotices = vi.fn();
  const setActivities = vi.fn((_updater: (prev: AgentActivity[]) => AgentActivity[]) => undefined);

  const handlers = createChatScreenGuardedStreamHandlers<TestMessage>({
    assistantId: 'a-1',
    canApplyMutation: options.canApplyMutation ?? (() => true),
    clearActiveStreamToken: vi.fn(),
    refreshSubagentNotices,
    requestSessionId: 's-1',
    scheduleScrollToBottom: vi.fn(),
    setActivities,
    setMessages: vi.fn(),
    setSending: vi.fn(),
    setStreamError: vi.fn(),
    syncTaskActivities: vi.fn(),
  });

  return { handlers, refreshSubagentNotices };
}

describe('createChatScreenGuardedStreamHandlers 的通知刷新触发点', () => {
  it('done / error 终态各触发一次刷新，并带上请求会话 id', () => {
    const { handlers, refreshSubagentNotices } = buildHarness();

    handlers.onDone?.('end_turn');
    expect(refreshSubagentNotices).toHaveBeenCalledTimes(1);
    expect(refreshSubagentNotices).toHaveBeenCalledWith('s-1');

    handlers.onError?.('WS_ERROR', '连接异常');
    expect(refreshSubagentNotices).toHaveBeenCalledTimes(2);
  });

  it('子任务终态 task_update 立即触发刷新，running 不触发', () => {
    const { handlers, refreshSubagentNotices } = buildHarness();

    handlers.onActivity?.(buildTaskUpdateEvent('running'));
    expect(refreshSubagentNotices).not.toHaveBeenCalled();

    handlers.onActivity?.(buildTaskUpdateEvent('done'));
    handlers.onActivity?.(buildTaskUpdateEvent('error'));
    expect(refreshSubagentNotices).toHaveBeenCalledTimes(2);
  });

  it('非 task_update 活动与守卫失败时不触发刷新', () => {
    const guarded = buildHarness({ canApplyMutation: () => false });
    guarded.handlers.onActivity?.(buildTaskUpdateEvent('done'));
    guarded.handlers.onDone?.('end_turn');
    expect(guarded.refreshSubagentNotices).not.toHaveBeenCalled();

    const { handlers, refreshSubagentNotices } = buildHarness();
    handlers.onActivity?.({ kind: 'tool_start', id: 'call-1', name: 'bash' });
    handlers.onActivity?.({ kind: 'tool_result', id: 'call-1', name: 'bash', isError: false });
    expect(refreshSubagentNotices).not.toHaveBeenCalled();
  });
});
