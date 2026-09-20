import { act, cleanup, renderHook } from '@testing-library/react';
import type { StopChildrenResult } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStopChildSessions } from './use-chat-stop-child-sessions.js';

const mocks = vi.hoisted(() => ({
  stopChildren: vi.fn<() => Promise<StopChildrenResult>>(),
  toast: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({ stopChildren: mocks.stopChildren }),
}));
vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

const emptyResult: StopChildrenResult = {
  stopped: [],
  skipped: [],
  failed: [],
  interactions: { permissions: 0, questions: 0 },
};

function renderStopHook() {
  return renderHook(() =>
    useChatStopChildSessions({
      currentSessionId: 'parent',
      gatewayUrl: 'http://localhost',
      token: 'token',
      requestSessionListRefresh: mocks.refresh,
    }),
  );
}

describe('子代理停止反馈', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it('单个停止返回 failed 时显示对象与原因，解除 loading 后允许重试', async () => {
    mocks.stopChildren.mockResolvedValueOnce({
      ...emptyResult,
      failed: [{ childSessionId: 'child-1', error: '终止超时' }],
    });
    const { result } = renderStopHook();
    await act(() => result.current.handleStopChildSession('child-1'));
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringMatching(/child-1.*终止超时.*重试/),
      'error',
    );
    expect(result.current.stoppingSubAgentIds.size).toBe(0);
    expect(mocks.refresh).toHaveBeenCalledOnce();

    mocks.stopChildren.mockResolvedValueOnce({ ...emptyResult, stopped: ['child-1'] });
    await act(() => result.current.handleStopChildSession('child-1'));
    expect(mocks.stopChildren).toHaveBeenCalledTimes(2);
    expect(mocks.stopChildren).toHaveBeenLastCalledWith('token', 'parent', {
      childSessionIds: ['child-1'],
    });
  });

  it('批量全部失败不得提示没有可停止的子代理，且允许再次停止', async () => {
    mocks.stopChildren.mockResolvedValue({
      ...emptyResult,
      failed: [{ childSessionId: 'child-2', error: '连接断开' }],
    });
    const { result } = renderStopHook();
    await act(() => result.current.handleStopAllChildSessions());
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringMatching(/child-2.*连接断开.*重试/),
      'error',
    );
    expect(mocks.toast).not.toHaveBeenCalledWith('没有可停止的子代理', 'info');
    expect(result.current.stoppingAllSubAgents).toBe(false);
    await act(() => result.current.handleStopAllChildSessions());
    expect(mocks.stopChildren).toHaveBeenCalledTimes(2);
  });

  it('批量部分失败同时报告成功数量和所有失败对象', async () => {
    mocks.stopChildren.mockResolvedValue({
      ...emptyResult,
      stopped: ['child-ok'],
      failed: [
        { childSessionId: 'child-2', error: '连接断开' },
        { childSessionId: 'child-3', error: '终止超时' },
      ],
    });
    const { result } = renderStopHook();
    await act(() => result.current.handleStopAllChildSessions());
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringMatching(/已停止 1 个子代理.*child-2.*连接断开.*child-3.*终止超时/),
      'error',
    );
    expect(result.current.stoppingAllSubAgents).toBe(false);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    { stopped: ['child-ok'], message: '已停止 1 个子代理' },
    { stopped: [], message: '没有可停止的子代理' },
  ])('无失败时保留反馈：$message', async ({ stopped, message }) => {
    mocks.stopChildren.mockResolvedValue({ ...emptyResult, stopped });
    const { result } = renderStopHook();
    await act(() => result.current.handleStopAllChildSessions());
    expect(mocks.toast).toHaveBeenCalledWith(message, 'info');
    expect(result.current.stoppingAllSubAgents).toBe(false);
  });

  it('请求抛错时保留失败提示并解除单个与批量 loading', async () => {
    mocks.stopChildren.mockRejectedValue(new Error('网络错误'));
    const { result } = renderStopHook();
    await act(() => result.current.handleStopChildSession('child-1'));
    await act(() => result.current.handleStopAllChildSessions());
    expect(mocks.toast).toHaveBeenCalledWith('网络错误', 'error');
    expect(result.current.stoppingSubAgentIds.size).toBe(0);
    expect(result.current.stoppingAllSubAgents).toBe(false);
  });
});
