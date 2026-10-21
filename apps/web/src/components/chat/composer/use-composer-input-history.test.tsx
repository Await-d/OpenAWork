// @vitest-environment jsdom

import React, { useRef, useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerInputHistory } from './use-composer-input-history.js';
import { useComposerInputHistoryStore } from '../../../stores/chat/composer-input-history.js';

/**
 * 假网关输入历史。语义与服务端一致：旧 → 新、相邻去重、最多 50 条。
 */
const { fakeHistory } = vi.hoisted(() => ({
  fakeHistory: {
    appendCalls: [] as Array<{ entries: readonly string[]; sessionId: string; token: string }>,
    appendShouldFail: false,
    entriesBySession: new Map<string, string[]>(),
  },
}));

vi.mock('@openAwork/web-client', () => ({
  createComposerInputHistoryClient: () => ({
    append: async (token: string, sessionId: string, entries: readonly string[]) => {
      fakeHistory.appendCalls.push({ entries: [...entries], sessionId, token });
      if (fakeHistory.appendShouldFail) {
        throw new Error('网关不可用');
      }
      let current = fakeHistory.entriesBySession.get(sessionId) ?? [];
      for (const text of entries) {
        if (current.at(-1) === text) {
          continue;
        }
        current = [...current, text].slice(-50);
      }
      fakeHistory.entriesBySession.set(sessionId, current);
      return [...current];
    },
    list: async (_token: string, sessionId: string) => {
      return [...(fakeHistory.entriesBySession.get(sessionId) ?? [])];
    },
  }),
}));

interface HistoryHarnessProps {
  readonly historyScope: string | null;
  readonly initialInput?: string;
  readonly sessionId?: string | null;
  readonly withPersistence?: boolean;
}

function useHistoryHarness(props: HistoryHarnessProps) {
  const { historyScope, initialInput = '', sessionId = null, withPersistence = false } = props;
  const [input, setInput] = useState(initialInput);
  const textareaRef = useRef<HTMLTextAreaElement | null>(document.createElement('textarea'));
  const history = useComposerInputHistory({
    input,
    setInput,
    historyScope,
    textareaRef,
    persistence: withPersistence
      ? { gatewayUrl: 'http://gateway.test', sessionId, token: 'token-1' }
      : null,
  });

  return {
    input,
    setInput,
    ...history,
  };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  useComposerInputHistoryStore.setState((state) => ({ ...state, historyByScope: {} }));
  fakeHistory.appendCalls.length = 0;
  fakeHistory.appendShouldFail = false;
  fakeHistory.entriesBySession.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useComposerInputHistory', () => {
  it('无 scope 时仍可用运行期历史在上下键间切换，并回到实时草稿', () => {
    const initialProps: HistoryHarnessProps = { historyScope: null };
    const { result } = renderHook(({ historyScope }) => useHistoryHarness({ historyScope }), {
      initialProps,
    });

    act(() => {
      result.current.recordSubmittedInputHistory('第一条');
      result.current.recordSubmittedInputHistory('第二条');
      result.current.setInput('实时草稿');
    });

    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.input).toBe('第二条');
    expect(result.current.isBrowsingInputHistory).toBe(true);

    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.input).toBe('第一条');

    act(() => {
      expect(result.current.navigateInputHistory('newer')).toBe(true);
    });
    expect(result.current.input).toBe('第二条');

    act(() => {
      expect(result.current.navigateInputHistory('newer')).toBe(true);
    });
    expect(result.current.input).toBe('实时草稿');
    expect(result.current.isBrowsingInputHistory).toBe(false);
  });

  it('Esc 恢复路径会把历史中的输入还原成进入浏览前的草稿', () => {
    const { result } = renderHook(
      ({ historyScope }) => useHistoryHarness({ historyScope, initialInput: '初始草稿' }),
      { initialProps: { historyScope: 'scope-a' } },
    );

    act(() => {
      result.current.recordSubmittedInputHistory('历史输入');
      result.current.setInput('待恢复草稿');
    });

    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.input).toBe('历史输入');

    act(() => {
      expect(result.current.restoreInputFromHistory()).toBe(true);
    });
    expect(result.current.input).toBe('待恢复草稿');
    expect(result.current.isBrowsingInputHistory).toBe(false);
  });

  it('切换 history scope 时会重置浏览态，并隔离不同会话的历史', () => {
    const { result, rerender } = renderHook(
      ({ historyScope }) => useHistoryHarness({ historyScope }),
      { initialProps: { historyScope: 'scope-a' } },
    );

    act(() => {
      result.current.recordSubmittedInputHistory('A-1');
      result.current.setInput('A-draft');
    });
    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.input).toBe('A-1');
    expect(result.current.isBrowsingInputHistory).toBe(true);

    rerender({ historyScope: 'scope-b' });
    expect(result.current.isBrowsingInputHistory).toBe(false);

    act(() => {
      result.current.recordSubmittedInputHistory('B-1');
      result.current.setInput('B-draft');
    });
    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.input).toBe('B-1');

    expect(useComposerInputHistoryStore.getState().historyByScope).toEqual({
      'scope-a': ['A-1'],
      'scope-b': ['B-1'],
    });
  });

  it('浏览历史时若用户直接改写输入，会自动退出浏览态', () => {
    const { result } = renderHook(({ historyScope }) => useHistoryHarness({ historyScope }), {
      initialProps: { historyScope: 'scope-a' },
    });

    act(() => {
      result.current.recordSubmittedInputHistory('可编辑历史');
      result.current.setInput('当前草稿');
    });
    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.isBrowsingInputHistory).toBe(true);

    act(() => {
      result.current.setInput('改写后的内容');
    });

    expect(result.current.isBrowsingInputHistory).toBe(false);
    act(() => {
      expect(result.current.restoreInputFromHistory()).toBe(false);
    });
  });

  it('进入会话时从网关水合历史', async () => {
    fakeHistory.entriesBySession.set('session-1', ['服务端历史一', '服务端历史二']);

    const { result } = renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.input).toBe('');
      expect(useComposerInputHistoryStore.getState().historyByScope['scope-session-1']).toEqual([
        '服务端历史一',
        '服务端历史二',
      ]);
    });

    act(() => {
      expect(result.current.navigateInputHistory('older')).toBe(true);
    });
    expect(result.current.input).toBe('服务端历史二');
  });

  it('提交记录写入网关，并以服务端全量结果覆盖本地', async () => {
    const { result } = renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    act(() => {
      result.current.recordSubmittedInputHistory('第一条');
    });

    await waitFor(() => {
      expect(fakeHistory.appendCalls).toEqual([
        { entries: ['第一条'], sessionId: 'session-1', token: 'token-1' },
      ]);
      expect(useComposerInputHistoryStore.getState().historyByScope['scope-session-1']).toEqual([
        '第一条',
      ]);
    });
  });

  it('persistHistoryEntries 会把迁移过来的 pending 历史批量写入网关', async () => {
    const { result } = renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    act(() => {
      result.current.persistHistoryEntries(['迁移一', '迁移二']);
    });

    await waitFor(() => {
      expect(fakeHistory.entriesBySession.get('session-1')).toEqual(['迁移一', '迁移二']);
    });
  });

  it('网关写入失败时保留本地乐观记录，下一次水合再对齐', async () => {
    fakeHistory.appendShouldFail = true;

    const { result } = renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    act(() => {
      result.current.recordSubmittedInputHistory('离线记录');
    });

    await waitFor(() => {
      expect(fakeHistory.appendCalls).toHaveLength(1);
    });
    expect(useComposerInputHistoryStore.getState().historyByScope['scope-session-1']).toEqual([
      '离线记录',
    ]);
  });
});
