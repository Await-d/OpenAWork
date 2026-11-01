import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import type { LoadEarlierHistory } from '../conversation/snapshot/session-history-pager.js';
import { useEnsureMessageVisible } from './use-ensure-message-visible.js';

const messages: ChatMessage[] = Array.from({ length: 40 }, (_, index) => ({
  id: String(index),
  role: 'user',
  content: String(index),
}));

function renderVisibility(loadEarlierHistory: LoadEarlierHistory) {
  const requestMessageScroll = vi.fn();
  const hook = renderHook(() => {
    const [visibleMessageCount, setVisibleMessageCount] = useState(20);
    const ensure = useEnsureMessageVisible({
      currentSessionId: 'session',
      loadEarlierHistory,
      messages,
      requestMessageScroll,
      setVisibleMessageCount,
      visibleMessageCount,
    });
    return { ensure, visibleMessageCount };
  });
  return { hook, requestMessageScroll };
}

afterEach(cleanup);

describe('useEnsureMessageVisible', () => {
  it('本地目标只扩窗，不触发网络请求', async () => {
    const load = vi.fn<LoadEarlierHistory>();
    const { hook, requestMessageScroll } = renderVisibility(load);
    await act(async () => {
      await hook.result.current.ensure('0');
    });
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.visibleMessageCount).toBe(45);
    expect(requestMessageScroll).toHaveBeenCalledWith('0');
  });

  it('远端目标按目标ID分页并精确扩窗，不使用固定9999全量窗口', async () => {
    const load = vi.fn<LoadEarlierHistory>().mockResolvedValue({
      messages: [{ id: 'old', role: 'user', content: 'old' }, ...messages],
      more: true,
    });
    const { hook, requestMessageScroll } = renderVisibility(load);
    await act(async () => {
      await hook.result.current.ensure('old');
    });
    expect(load).toHaveBeenCalledExactlyOnceWith('old');
    expect(hook.result.current.visibleMessageCount).toBe(46);
    expect(requestMessageScroll).toHaveBeenCalledWith('old');
  });

  it('失效会话或不存在的目标不会滚动或扩窗', async () => {
    const load = vi
      .fn<LoadEarlierHistory>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ messages, more: false });
    const { hook, requestMessageScroll } = renderVisibility(load);
    await act(async () => {
      await hook.result.current.ensure('old');
    });
    await act(async () => {
      await hook.result.current.ensure('missing');
    });
    expect(hook.result.current.visibleMessageCount).toBe(20);
    expect(requestMessageScroll).not.toHaveBeenCalled();
  });
});
