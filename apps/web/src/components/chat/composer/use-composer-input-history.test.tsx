// @vitest-environment jsdom

import React, { useRef, useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerInputHistory } from './use-composer-input-history.js';
import { useComposerInputHistoryStore } from '../../../stores/chat/composer-input-history.js';
import { logger } from '../../../utils/log/logger.js';

/**
 * 可控 reject 的水合闸门：`deferred` 未设置时 list 正常返回；设置后等用例显式
 * decide，用来制造「卸载之后才 reject」的时序（生产里 fetch 在组件卸载 / 测试结束后
 * 才失败，正是它把日志写进已关闭的 worker → EnvironmentTeardownError）。
 */
const { deferred } = vi.hoisted(() => ({
  deferred: {
    current: null as null | { promise: Promise<void>; reject: (error: unknown) => void },
  },
}));

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
      if (deferred.current) {
        await deferred.current.promise;
      }
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

/**
 * 等 reject 之后的微任务 / 宏任务链跑完。
 *
 * 断言「不再记录日志」时不能直接用 `waitFor`——条件一开始就成立会立刻通过，
 * 反而盖住「取消门缺失时迟到 catch 仍会写日志」的回归。必须给 reject 后的链路
 * 留出真实的执行窗口。
 */
async function flushRejection(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  cleanup();
  useComposerInputHistoryStore.setState((state) => ({ ...state, historyByScope: {} }));
  fakeHistory.appendCalls.length = 0;
  fakeHistory.appendShouldFail = false;
  fakeHistory.entriesBySession.clear();
  deferred.current = null;
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

  it('卸载后迟到的水合失败不再记录日志（避免 teardown 期间写 console）', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let rejectList!: (error: unknown) => void;
    deferred.current = {
      promise: new Promise<void>((_resolve, reject) => {
        rejectList = reject;
      }),
      reject: (error: unknown) => rejectList(error),
    };

    const { unmount } = renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    // 先卸载（生产里是组件消失 / 测试结束），请求此刻仍在飞行。
    unmount();
    // 请求在卸载之后才 reject。
    deferred.current.reject(new Error('网关不可达'));
    // 必须把 reject 之后的微任务链跑完再断言：否则断言会在 catch 执行前通过，
    // 用例就失去了回归价值（无论有没有取消门都是绿的）。
    await flushRejection();

    const hydrationWarns = warnSpy.mock.calls.filter(
      (call) => call[0] === '输入历史水合失败，保留本地记录',
    );
    expect(hydrationWarns).toHaveLength(0);
  });

  it('未卸载时的水合失败仍会记录日志（证明取消门没有吞掉有效日志）', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let rejectList!: (error: unknown) => void;
    deferred.current = {
      promise: new Promise<void>((_resolve, reject) => {
        rejectList = reject;
      }),
      reject: (error: unknown) => rejectList(error),
    };

    renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    // 组件仍在挂载状态，请求失败必须留下可诊断的日志。
    deferred.current.reject(new Error('网关不可达'));
    await flushRejection();

    const hydrationWarns = warnSpy.mock.calls.filter(
      (call) => call[0] === '输入历史水合失败，保留本地记录',
    );
    expect(hydrationWarns).toHaveLength(1);
  });

  it('未卸载但水合期间发生写入时，水合失败仍记录日志（revision 推进不得吞掉诊断）', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    let rejectList!: (error: unknown) => void;
    deferred.current = {
      promise: new Promise<void>((_resolve, reject) => {
        rejectList = reject;
      }),
      reject: (error: unknown) => rejectList(error),
    };

    const { result } = renderHook(() =>
      useHistoryHarness({
        historyScope: 'scope-session-1',
        sessionId: 'session-1',
        withPersistence: true,
      }),
    );

    // 仍然挂载：期间用户发送一条消息 → `recordSubmittedInputHistory` 推进 revision。
    // 失败分支并不消费水合结果，故「写入推进 revision」不该被当作「请求已被取代」。
    act(() => {
      result.current.recordSubmittedInputHistory('并发写入的输入');
    });

    deferred.current.reject(new Error('网关不可达'));
    await flushRejection();

    const hydrationWarns = warnSpy.mock.calls.filter(
      (call) => call[0] === '输入历史水合失败，保留本地记录',
    );
    expect(hydrationWarns).toHaveLength(1);
  });
});
