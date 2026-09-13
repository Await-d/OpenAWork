// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerUndoToast } from './use-composer-undo-toast.js';
import type { ComposerUndoToastState } from './use-composer-undo-toast.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderHarness() {
  const ref: { current: ComposerUndoToastState | null } = { current: null };

  function Harness() {
    ref.current = useComposerUndoToast();
    return null;
  }

  render(<Harness />);

  function state(): ComposerUndoToastState {
    if (!ref.current) throw new Error('composer undo toast state 未初始化');
    return ref.current;
  }

  return { state };
}

describe('useComposerUndoToast', () => {
  it('初始不展示任何提示', () => {
    const { state } = renderHarness();

    expect(state().undoText).toBeNull();
    expect(state().escapeHint).toBe(false);
  });

  it('showUndo 会展示撤销条并清掉 Esc 提示（两者互斥）', () => {
    const { state } = renderHarness();

    act(() => state().showEscapeHint());
    expect(state().escapeHint).toBe(true);

    act(() => state().showUndo('被清空的内容'));
    expect(state().undoText).toBe('被清空的内容');
    expect(state().escapeHint).toBe(false);
  });

  it('撤销条到期后自动消失', () => {
    vi.useFakeTimers();
    const { state } = renderHarness();

    act(() => state().showUndo('被清空的内容'));
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(state().undoText).toBeNull();
  });

  it('Esc 提示到期后自动消失，且不影响撤销条', () => {
    vi.useFakeTimers();
    const { state } = renderHarness();

    act(() => state().showEscapeHint());
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(state().escapeHint).toBe(false);
  });

  it('dismiss 会同时清掉撤销条与提示', () => {
    const { state } = renderHarness();

    act(() => state().showUndo('被清空的内容'));
    act(() => state().dismiss());

    expect(state().undoText).toBeNull();
    expect(state().escapeHint).toBe(false);
  });

  it('hideEscapeHint 只收起提示，不动撤销条', () => {
    const { state } = renderHarness();

    act(() => state().showEscapeHint());
    act(() => state().hideEscapeHint());

    expect(state().escapeHint).toBe(false);
  });
});
