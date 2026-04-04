import { extractRuntimeTextDelta } from '../chat-message-content.js';
import type { AgentActivity } from '../components/AgentActivityPanel.js';
import type { ActivityEvent, StreamHandlers } from '../hooks/useGatewayClient.js';
import { upsertTaskActivity } from './chat-task-activities.js';

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
  scheduleScrollToBottom: () => void;
  setActivities: (updater: (prev: AgentActivity[]) => AgentActivity[]) => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setSending: (next: boolean) => void;
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
      options.setActivities((prev) => settleNonSubagentActivities(prev, 'done'));
      options.setMessages((prev) =>
        prev.map((message) =>
          message.id === options.assistantId ? { ...message, streaming: false } : message,
        ),
      );
      options.clearActiveStreamToken();
      options.setSending(false);
      options.scheduleScrollToBottom();
    },
    onError: (_code, message) => {
      if (!options.canApplyMutation()) {
        return;
      }

      void options.syncTaskActivities(options.requestSessionId);
      options.setActivities((prev) => settleNonSubagentActivities(prev, 'error'));
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
    },
  };
}
