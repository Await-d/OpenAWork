import { describe, expect, it } from 'vitest';
import type { SharedSessionDetailRecord } from '@openAwork/web-client';
import {
  appendSharedSessionCommentPreview,
  applySharedSessionPermissionReplyPreview,
  applySharedSessionQuestionReplyPreview,
} from './shared-session-local-detail.js';

function createDetail(): SharedSessionDetailRecord {
  return {
    comments: [
      {
        authorEmail: 'a@example.com',
        content: 'old',
        createdAt: '2026-05-26T00:00:00.000Z',
        id: 'comment-1',
        sessionId: 'shared-1',
      },
    ],
    pendingPermissions: [
      {
        createdAt: '2026-05-26T00:00:00.000Z',
        requestId: 'perm-1',
        reason: 'need shell',
        riskLevel: 'medium',
        scope: 'bash ls *',
        sessionId: 'shared-1',
        status: 'pending',
        toolName: 'bash',
      },
    ],
    pendingQuestions: [
      {
        createdAt: '2026-05-26T00:00:00.000Z',
        questions: [],
        requestId: 'question-1',
        sessionId: 'shared-1',
        status: 'pending',
        title: '需要回答',
        toolName: 'AskFollowUpQuestion',
      },
    ],
    presence: [],
    share: {
      createdAt: '2026-05-26T00:00:00.000Z',
      permission: 'operate',
      sessionId: 'shared-1',
      shareCreatedAt: '2026-05-26T00:00:00.000Z',
      shareUpdatedAt: '2026-05-26T00:00:00.000Z',
      sharedByEmail: 'owner@example.com',
      stateStatus: 'running',
      title: 'shared session',
      updatedAt: '2026-05-26T00:00:00.000Z',
      workspacePath: '/workspace',
    },
    session: {
      id: 'shared-1',
      title: 'shared session',
    },
  };
}

describe('shared-session-local-detail', () => {
  it('评论 preview 会追加到当前 detail', () => {
    const updated = appendSharedSessionCommentPreview(createDetail(), {
      sessionId: 'shared-1',
      comment: {
        authorEmail: 'b@example.com',
        content: 'new',
        createdAt: '2026-05-26T00:01:00.000Z',
        id: 'comment-2',
        sessionId: 'shared-1',
      },
    });

    expect(updated?.comments.map((comment) => comment.id)).toEqual(['comment-1', 'comment-2']);
  });

  it('权限回复 preview 会移除对应 pending request', () => {
    const updated = applySharedSessionPermissionReplyPreview(createDetail(), {
      requestId: 'perm-1',
      sessionId: 'shared-1',
    });

    expect(updated?.pendingPermissions).toEqual([]);
  });

  it('问题回复 preview 会移除对应 pending question', () => {
    const updated = applySharedSessionQuestionReplyPreview(createDetail(), {
      requestId: 'question-1',
      sessionId: 'shared-1',
    });

    expect(updated?.pendingQuestions).toEqual([]);
  });
});
