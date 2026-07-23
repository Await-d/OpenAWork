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

import {
  isPermissionReplyAlreadyHandled,
  replyPermissionRequest,
  resolvePermissionReplyError,
} from './permission-reply.js';
import { subscribeSessionStreamResumeAttach } from '../session/session-stream-resume-events.js';

describe('resolvePermissionReplyError', () => {
  it('中文 409「权限请求已处理」应关闭弹层', () => {
    const error = Object.assign(new Error('权限请求已处理，无法重复提交。'), {
      status: 409,
      data: { error: '权限请求已处理，无法重复提交。' },
    });

    expect(isPermissionReplyAlreadyHandled(error)).toBe(true);
    expect(resolvePermissionReplyError(error)).toEqual({
      dismissPrompt: true,
      inlineMessage: '该权限请求已被处理，正在重新同步。',
      toastMessage: '权限请求已被处理，已重新同步状态。',
    });
  });

  it('404 应关闭弹层', () => {
    const error = Object.assign(new Error('目标权限请求不存在。'), {
      status: 404,
      data: { error: '目标权限请求不存在。' },
    });

    expect(resolvePermissionReplyError(error).dismissPrompt).toBe(true);
  });

  it('其它错误保留弹层并展示文案', () => {
    const error = Object.assign(new Error('网络异常，回复权限请求失败。'), {
      status: 500,
    });

    expect(resolvePermissionReplyError(error)).toEqual({
      dismissPrompt: false,
      inlineMessage: '网络异常，回复权限请求失败。',
    });
  });
});

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
