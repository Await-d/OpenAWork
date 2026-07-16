// @vitest-environment jsdom

import React, { useRef, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComposerInputHistory } from './use-composer-input-history.js';
import { useComposerInputHistoryStore } from '../../../stores/chat/composer-input-history.js';

interface HistoryHarnessProps {
  readonly historyScope: string | null;
  readonly initialInput?: string;
}

function useHistoryHarness(props: HistoryHarnessProps) {
  const { historyScope, initialInput = '' } = props;
  const [input, setInput] = useState(initialInput);
  const textareaRef = useRef<HTMLTextAreaElement | null>(document.createElement('textarea'));
  const history = useComposerInputHistory({
    input,
    setInput,
    historyScope,
    textareaRef,
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
});
