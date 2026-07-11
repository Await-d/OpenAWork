// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reply: vi.fn(async () => undefined),
}));

vi.mock('@openAwork/web-client', () => ({
  createPermissionsClient: () => ({
    reply: mocks.reply,
  }),
}));

import { replyPermissionRequest } from './permission-reply.js';
import { subscribeSessionStreamResumeAttach } from '../session/session-stream-resume-events.js';

describe('replyPermissionRequest', () => {
  beforeEach(() => {
    mocks.reply.mockClear();
  });

  it('允许权限后会请求当前会话重新 attach 后台续跑流', async () => {
    const observed: string[] = [];
    const unsubscribe = subscribeSessionStreamResumeAttach((sessionId) => {
      observed.push(sessionId);
    });

    try {
      await replyPermissionRequest({
        decision: 'once',
        gatewayUrl: 'https://gateway.test',
        requestId: 'perm-1',
        sessionId: 'session-1',
        token: 'token-1',
      });
    } finally {
      unsubscribe();
    }

    expect(mocks.reply).toHaveBeenCalledWith('token-1', 'session-1', {
      requestId: 'perm-1',
      decision: 'once',
    });
    expect(observed).toEqual(['session-1']);
  });

  it('拒绝权限后不会触发后台续跑 attach', async () => {
    const observed: string[] = [];
    const unsubscribe = subscribeSessionStreamResumeAttach((sessionId) => {
      observed.push(sessionId);
    });

    try {
      await replyPermissionRequest({
        decision: 'reject',
        feedback: '不要执行',
        gatewayUrl: 'https://gateway.test',
        requestId: 'perm-2',
        sessionId: 'session-2',
        token: 'token-1',
      });
    } finally {
      unsubscribe();
    }

    expect(mocks.reply).toHaveBeenCalledWith('token-1', 'session-2', {
      requestId: 'perm-2',
      decision: 'reject',
      feedback: '不要执行',
    });
    expect(observed).toEqual([]);
  });
});
