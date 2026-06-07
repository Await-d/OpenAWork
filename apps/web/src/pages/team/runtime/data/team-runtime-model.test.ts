import { describe, expect, it } from 'vitest';
import type { SharedSessionDetailRecord } from '@openAwork/web-client';
import { findLatestAssistantMessage } from './team-runtime-model.js';

function createSharedDetail(
  messages: SharedSessionDetailRecord['session']['messages'],
): SharedSessionDetailRecord {
  return {
    comments: [],
    pendingPermissions: [],
    pendingQuestions: [],
    presence: [],
    share: {
      createdAt: '2026-06-05T08:00:00.000Z',
      permission: 'operate',
      sessionId: 'shared-1',
      shareCreatedAt: '2026-06-05T08:00:00.000Z',
      shareUpdatedAt: '2026-06-05T08:12:00.000Z',
      sharedByEmail: 'owner@example.com',
      stateStatus: 'running',
      title: '共享会话 A',
      updatedAt: '2026-06-05T08:12:00.000Z',
      workspacePath: '/workspace/shared',
    },
    session: {
      createdAt: Date.parse('2026-06-05T08:00:00.000Z'),
      id: 'shared-1',
      messages,
    },
  };
}

describe('findLatestAssistantMessage', () => {
  it('会从最新 assistant 消息的 text parts 中提取文本', () => {
    const result = findLatestAssistantMessage(
      createSharedDetail([
        {
          content: [{ text: '用户输入', type: 'text' }],
          createdAt: Date.parse('2026-06-05T08:00:00.000Z'),
          id: 'message-user',
          role: 'user',
        },
        {
          content: [
            { text: '第一段输出', type: 'text' },
            { text: '第二段输出', type: 'text' },
          ],
          createdAt: Date.parse('2026-06-05T08:01:00.000Z'),
          id: 'message-assistant',
          role: 'assistant',
        },
      ]),
    );

    expect(result).toBe('第一段输出\n第二段输出');
  });

  it('没有 assistant 文本输出时返回 null', () => {
    const result = findLatestAssistantMessage(
      createSharedDetail([
        {
          content: [{ text: '用户输入', type: 'text' }],
          createdAt: Date.parse('2026-06-05T08:00:00.000Z'),
          id: 'message-user',
          role: 'user',
        },
      ]),
    );

    expect(result).toBeNull();
  });
});
