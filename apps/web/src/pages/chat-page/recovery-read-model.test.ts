import { describe, expect, it } from 'vitest';

import {
  getRecoveryPendingInteractions,
  getRecoveryTranscriptMessages,
} from './recovery-read-model.js';

describe('recovery-read-model', () => {
  it('normalizes transcript messages from the recovery session payload', () => {
    const messages = getRecoveryTranscriptMessages({
      session: {
        messages: [
          {
            id: 'user-1',
            role: 'user',
            createdAt: 1,
            content: [{ type: 'text', text: '第一条用户消息' }],
          },
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: 2,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  source: 'openawork_internal',
                  type: 'assistant_event',
                  payload: {
                    kind: 'task',
                    title: '等待回答 · Question',
                    message: '补一条 runtime 事件',
                    status: 'paused',
                  },
                }),
              },
            ],
          },
        ],
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: '第一条用户消息' });
    expect(messages[1]).toMatchObject({ role: 'assistant' });
    expect(messages[1]?.content).toContain('assistant_event');
  });

  it('prefers top-level pending interactions when present', () => {
    const interactions = getRecoveryPendingInteractions({
      pendingPermissions: [
        {
          requestId: 'perm-top-level',
          sessionId: 'session-1',
          toolName: 'file_write',
          scope: '/tmp/demo.txt',
          reason: '需要写入测试文件',
          riskLevel: 'medium',
          previewAction: 'write demo',
          status: 'pending',
          createdAt: '2026-04-12T08:00:00.000Z',
        },
      ],
      pendingQuestions: [
        {
          requestId: 'question-top-level',
          sessionId: 'session-1',
          toolName: 'question',
          title: '目录',
          questions: [],
          status: 'pending',
          createdAt: '2026-04-12T08:00:00.000Z',
        },
      ],
      session: {
        pendingPermissions: [
          {
            requestId: 'perm-fallback',
            sessionId: 'session-1',
            toolName: 'file_write',
            scope: '/tmp/fallback.txt',
            reason: 'fallback',
            riskLevel: 'low',
            previewAction: 'fallback',
            status: 'pending',
            createdAt: '2026-04-12T07:00:00.000Z',
          },
        ],
        pendingQuestions: [],
      },
    });

    expect(interactions.pendingPermission?.requestId).toBe('perm-top-level');
    expect(interactions.pendingQuestion?.requestId).toBe('question-top-level');
  });

  it('falls back to session-scoped pending interactions when top-level arrays are missing', () => {
    const interactions = getRecoveryPendingInteractions({
      session: {
        pendingPermissions: [
          {
            requestId: 'perm-session',
            sessionId: 'session-1',
            toolName: 'file_write',
            scope: '/tmp/demo.txt',
            reason: '需要写入测试文件',
            riskLevel: 'medium',
            previewAction: 'write demo',
            status: 'pending',
            createdAt: '2026-04-12T08:00:00.000Z',
          },
        ],
        pendingQuestions: [
          {
            requestId: 'question-session',
            sessionId: 'session-1',
            toolName: 'question',
            title: '目录',
            questions: [
              {
                header: '目录',
                question: '请选择要查看的目录',
                options: [{ label: 'workspace', description: '查看工作目录' }],
              },
            ],
            status: 'pending',
            createdAt: '2026-04-12T08:00:00.000Z',
          },
        ],
      },
    });

    expect(interactions.pendingPermissions).toHaveLength(1);
    expect(interactions.pendingQuestions).toHaveLength(1);
    expect(interactions.pendingPermission?.requestId).toBe('perm-session');
    expect(interactions.pendingQuestion?.requestId).toBe('question-session');
  });
});
