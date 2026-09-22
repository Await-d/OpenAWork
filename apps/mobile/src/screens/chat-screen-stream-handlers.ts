import { extractRuntimeTextDelta } from '../chat/chat-message-content';
import type { AgentActivity } from '../components/AgentActivityPanel';
import type { ActivityEvent, StreamHandlers } from '../hooks/useGatewayClient';
import { upsertTaskActivity } from './chat-task-activities';

export interface ChatScreenStreamMessage {
  content: string;
  id: string;
  streaming?: boolean;
}

export interface ChatScreenStreamHandlerOptions<Message extends ChatScreenStreamMessage> {
  assistantId: string;
  canApplyMutation: () => boolean;
  clearActiveStreamToken: () => void;
  requestSessionId: string;
  /**
   * 重新拉取父会话并重算「子代理完成通知」列表。
   *
   * 网关的 synthetic 通知没有独立的实时事件（只在结算时落库），但父会话的
   * 运行流会收到该子任务的终态 `task_update`，且注入严格发生在其发布之前，
   * 所以这两处触发都是「读已提交」的：流式期间的终态 task_update 用于近实时
   * 展示，`done` / `error` 作为兜底补齐漏采的通知。重算天然幂等。
   */
  refreshSubagentNotices: (requestSessionId: string) => void;
  scheduleScrollToBottom: () => void;
  setActivities: (updater: (prev: AgentActivity[]) => AgentActivity[]) => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setSending: (next: boolean) => void;
  setStreamError: (message: string | null) => void;
  syncTaskActivities: (requestSessionId: string) => Promise<void> | void;
}

function settleNonSubagentActivities(
  activities: AgentActivity[],
  status: 'done' | 'error',
): AgentActivity[] {
  return activities.map((activity) =>
    activity.kind !== 'subagent' && activity.status === 'running'
      ? { ...activity, status }
      : activity,
  );
}

function applyActivityEvent(activities: AgentActivity[], event: ActivityEvent): AgentActivity[] {
  if (event.kind === 'tool_start') {
    if (activities.some((activity) => activity.id === event.id)) {
      return activities.map((activity) =>
        activity.id === event.id ? { ...activity, name: event.name, status: 'running' } : activity,
      );
    }

    return [
      ...activities,
      {
        id: event.id,
        kind: 'tool',
        name: event.name,
        status: 'running',
      },
    ];
  }

  if (event.kind === 'task_update') {
    return upsertTaskActivity(activities, {
      id: event.id,
      name: event.name,
      status: event.status,
      output: event.output,
      assignedAgent: event.assignedAgent,
      sessionId: event.sessionId,
    });
  }

  return activities.map((activity) =>
    activity.id === event.id
      ? {
          ...activity,
          name: event.name,
          status: event.isError ? 'error' : 'done',
          output: event.output ?? activity.output,
        }
      : activity,
  );
}

export function createChatScreenGuardedStreamHandlers<Message extends ChatScreenStreamMessage>(
  options: ChatScreenStreamHandlerOptions<Message>,
): StreamHandlers {
  return {
    onConnected: () => {
      if (!options.canApplyMutation()) {
        return;
      }

      options.setStreamError(null);
      void options.syncTaskActivities(options.requestSessionId);
    },
    onDelta: (delta) => {
      if (!options.canApplyMutation()) {
        return;
      }

      const safeDelta = extractRuntimeTextDelta(delta);
      options.setMessages((prev) =>
        prev.map((message) =>
          message.id === options.assistantId
            ? { ...message, content: message.content + safeDelta }
            : message,
        ),
      );
    },
    onDone: (_stopReason) => {
      if (!options.canApplyMutation()) {
        return;
      }

      void options.syncTaskActivities(options.requestSessionId);
      options.refreshSubagentNotices(options.requestSessionId);
      options.setActivities((prev) => settleNonSubagentActivities(prev, 'done'));
      options.setMessages((prev) =>
        prev.map((message) =>
          message.id === options.assistantId ? { ...message, streaming: false } : message,
        ),
      );
      options.setStreamError(null);
      options.clearActiveStreamToken();
      options.setSending(false);
      options.scheduleScrollToBottom();
    },
    onError: (_code, message) => {
      if (!options.canApplyMutation()) {
        return;
      }

      void options.syncTaskActivities(options.requestSessionId);
      options.refreshSubagentNotices(options.requestSessionId);
      options.setActivities((prev) => settleNonSubagentActivities(prev, 'error'));
      options.setStreamError(message);
      options.setMessages((prev) =>
        prev.map((entry) =>
          entry.id === options.assistantId
            ? { ...entry, content: `错误：${message}`, streaming: false }
            : entry,
        ),
      );
      options.clearActiveStreamToken();
      options.setSending(false);
    },
    onActivity: (event) => {
      if (!options.canApplyMutation()) {
        return;
      }

      options.setActivities((prev) => applyActivityEvent(prev, event));
      // 子代理结算：网关先落库 synthetic 通知再发布终态 task_update，
      // 因此这里重算能立刻看到新通知，无需等整轮流结束。
      if (event.kind === 'task_update' && event.status !== 'running') {
        options.refreshSubagentNotices(options.requestSessionId);
      }
    },
  };
}
