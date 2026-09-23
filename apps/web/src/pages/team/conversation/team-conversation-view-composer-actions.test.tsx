// @vitest-environment jsdom
/**
 * team 端重试 / 编辑重发的回退反馈测试
 *
 * 覆盖：
 * 1. 截断成功后 toast「已回退到所选消息」并带「查看变更快照」入口（点击触发回调）
 * 2. 截断失败时中止重发：错误送达 streamError，不产生回退 toast
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { ToastContainer } from '../../../components/common/feedback/ToastNotification.js';
import { useTeamConversationViewRetryActions } from './team-conversation-view-composer-actions.js';
import type { TeamConversationState } from './use-team-conversation-state.js';

const SESSION_ID = 'session-team-1';

function makeState() {
  return {
    messages: [],
    streaming: false,
    setMessages: vi.fn(),
    setRunEvents: vi.fn(),
    setStreamError: vi.fn(),
    reload: vi.fn(async () => undefined),
  } as unknown as TeamConversationState;
}

function stubTruncateFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useTeamConversationViewRetryActions — 回退反馈', () => {
  it('截断成功后 toast 带「查看变更快照」入口，点击触发回调', async () => {
    stubTruncateFetch(200, { messages: [], rollback: null });
    const onOpenChangesPanel = vi.fn();
    const dispatchTeamText = vi.fn(async () => true);
    const state = makeState();

    render(<ToastContainer />);
    const { result } = renderHook(() =>
      useTeamConversationViewRetryActions({
        composerEnabled: true,
        dispatchTeamText,
        gatewayUrl: 'https://gw.test',
        onOpenChangesPanel,
        sessionId: SESSION_ID,
        state,
        token: 'tok-1',
      }),
    );

    act(() => {
      result.current.setRetryPrompt({ messageId: 'm-user', text: '重试文本' });
    });

    await act(async () => {
      result.current.handleRetryCurrent();
      await Promise.resolve();
    });

    expect(dispatchTeamText).toHaveBeenCalledWith('重试文本', undefined);
    expect(screen.getByText('已回退到所选消息，后续内容已清除')).toBeTruthy();
    const actionButton = screen.getByRole('button', { name: '查看变更快照' });
    act(() => {
      actionButton.click();
    });
    expect(onOpenChangesPanel).toHaveBeenCalledTimes(1);
  });

  it('截断失败时中止重发：错误进 streamError 且不产生回退 toast', async () => {
    stubTruncateFetch(500, { error: '截断失败' });
    const dispatchTeamText = vi.fn(async () => true);
    const state = makeState();

    render(<ToastContainer />);
    const { result } = renderHook(() =>
      useTeamConversationViewRetryActions({
        composerEnabled: true,
        dispatchTeamText,
        gatewayUrl: 'https://gw.test',
        sessionId: SESSION_ID,
        state,
        token: 'tok-1',
      }),
    );

    act(() => {
      result.current.setRetryPrompt({ messageId: 'm-user', text: '重试文本' });
    });

    await act(async () => {
      result.current.handleRetryCurrent();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispatchTeamText).not.toHaveBeenCalled();
    expect(state.setStreamError).toHaveBeenCalledWith(expect.stringContaining('回退失败'));
    expect(screen.queryByText('已回退到所选消息，后续内容已清除')).toBeNull();
  });
});
