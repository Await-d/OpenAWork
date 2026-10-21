import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './message-model.js';
import { makeOrderedMessageId } from './ordered-id.js';
import { upsertPermissionEventMessage } from './permission-merge.js';
import { replaceOrAppendStreamedAssistantMessage } from './streaming-message-merge.js';
import { shouldShowMessageInTranscript } from './transcript-visibility.js';
import { mergeStreamingEntryIntoHistoricalEntries } from '../../../pages/chat-page/conversation/render/chat-render-merge.js';
import type { ChatRenderEntry } from '../../chat/message/chat-message-group-list.js';

/**
 * 「权限申请 / 用户提问期间消息顺序错乱」的回归。
 *
 * 关键事实：`permission_asked` 到达时，**触发它的那一轮助手消息还没提交**
 * （提交发生在下一轮内容到达时）。于是事件卡片会先进入 `messages`，助手消息随后
 * 才被 append。这一组用例把整条时序固定下来，任何"卡片插到宿主轮次后面"或
 * "流式气泡被推到卡片之后"的回归都会在这里失败。
 */

const PERMISSION_REQUEST_ID = 'req-1';

function buildUserMessage(timestampMs: number): ChatMessage {
  return {
    content: '帮我改一下配置',
    createdAt: timestampMs,
    id: makeOrderedMessageId(timestampMs),
    role: 'user',
    status: 'completed',
  };
}

function buildAssistantRound(timestampMs: number, text: string): ChatMessage {
  return {
    content: text,
    createdAt: timestampMs,
    id: makeOrderedMessageId(timestampMs),
    parts: [{ id: `${makeOrderedMessageId(timestampMs)}:text`, type: 'text', text }],
    role: 'assistant',
    status: 'completed',
  };
}

function permissionAsked(timestampMs: number): Parameters<typeof upsertPermissionEventMessage>[1] {
  return {
    occurredAt: timestampMs,
    previewAction: 'rm -rf /tmp/cache',
    reason: '需要执行命令',
    requestId: PERMISSION_REQUEST_ID,
    riskLevel: 'high',
    scope: 'session',
    toolName: 'Bash',
    type: 'permission_asked',
  };
}

function renderOrder(messages: ChatMessage[]): string[] {
  return messages.filter((message) => shouldShowMessageInTranscript(message)).map((m) => m.id);
}

describe('权限事件卡片与助手轮次的相对顺序', () => {
  it('卡片不进入聊天流，助手消息提交后仍排在用户消息之后', () => {
    const user = buildUserMessage(1_000);
    const withCard = upsertPermissionEventMessage([user], permissionAsked(2_000));
    // 卡片进数组，但不参与渲染。
    expect(withCard).toHaveLength(2);
    expect(renderOrder(withCard)).toEqual([user.id]);

    const assistant = buildAssistantRound(3_000, '已执行');
    const committed = replaceOrAppendStreamedAssistantMessage(withCard, assistant, new Set());

    // 渲染顺序必须是「提问 → 回复」。
    expect(renderOrder(committed)).toEqual([user.id, assistant.id]);
  });

  it('卡片必须排在触发它的宿主轮次之后（用有序 id 比较也不允许反序）', () => {
    const user = buildUserMessage(1_000);
    const assistant = buildAssistantRound(2_000, '第一轮');
    const committed = replaceOrAppendStreamedAssistantMessage([user], assistant, new Set());

    // 模拟：助手轮次已提交后才收到权限事件（例如 attach 回放）。
    const withCard = upsertPermissionEventMessage(committed, permissionAsked(3_000));
    const cardIndex = withCard.findIndex((m) => m.id !== user.id && m.id !== assistant.id);
    expect(cardIndex).toBeGreaterThan(withCard.indexOf(assistant));
  });

  it('卡片不得插到最后一条用户消息之前', () => {
    const user = buildUserMessage(5_000);
    const earlierAssistant = buildAssistantRound(1_000, '更早的一轮');
    // 事件时间戳早于用户消息（网关时钟偏差 / 回放历史事件）。
    const withCard = upsertPermissionEventMessage([earlierAssistant, user], permissionAsked(500));
    expect(withCard.indexOf(user)).toBeLessThan(withCard.length - 1);
  });
});

describe('流式气泡与事件卡片的插入位置', () => {
  it('气泡落在最后一条用户消息之后，不被卡片挤走', () => {
    const user = buildUserMessage(1_000);
    const assistant = buildAssistantRound(2_000, '第一轮');
    const streaming: ChatMessage = {
      content: '正在输出',
      createdAt: 9_000,
      id: makeOrderedMessageId(9_000),
      role: 'assistant',
      status: 'streaming',
    };

    const history: ChatRenderEntry[] = [user, assistant].map((message) => ({
      message,
      actions: [],
      renderContent: () => null,
    }));
    const streamingEntry: ChatRenderEntry = {
      message: streaming,
      actions: [],
      renderContent: () => null,
    };

    const merged = mergeStreamingEntryIntoHistoricalEntries(
      history,
      streamingEntry,
      streaming.id,
      null,
    );

    expect(merged.map((entry) => entry.message.id)).toEqual([user.id, assistant.id, streaming.id]);
  });
});
