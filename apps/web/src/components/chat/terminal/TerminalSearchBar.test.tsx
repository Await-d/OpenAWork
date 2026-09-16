// @vitest-environment jsdom
/**
 * 搜索条行为：增量搜索、无结果提示、大小写开关、Esc 关闭。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TerminalSearchBar } from './TerminalSearchBar.js';

afterEach(() => {
  cleanup();
});

function renderBar(overrides: { next?: boolean; previous?: boolean } = {}) {
  const onFindNext = vi.fn(() => overrides.next ?? true);
  const onFindPrevious = vi.fn(() => overrides.previous ?? true);
  const onClose = vi.fn();
  render(
    <TerminalSearchBar
      open
      onClose={onClose}
      onFindNext={onFindNext}
      onFindPrevious={onFindPrevious}
    />,
  );
  return { onFindNext, onFindPrevious, onClose };
}

describe('TerminalSearchBar', () => {
  it('未打开时不渲染也不占位', () => {
    render(
      <TerminalSearchBar open={false} onClose={vi.fn()} onFindNext={vi.fn()} onFindPrevious={vi.fn()} />,
    );
    expect(screen.queryByTestId('terminal-search-bar')).toBeNull();
  });

  it('输入即增量搜索，且默认不区分大小写', () => {
    const { onFindNext } = renderBar();

    fireEvent.change(screen.getByTestId('terminal-search-input'), { target: { value: 'error' } });

    expect(onFindNext).toHaveBeenCalledWith('error', false);
    expect(screen.queryByTestId('terminal-search-status')).toBeNull();
  });

  it('搜索无结果时给出可见反馈', () => {
    renderBar({ next: false, previous: false });

    fireEvent.change(screen.getByTestId('terminal-search-input'), { target: { value: 'nope' } });

    expect(screen.getByTestId('terminal-search-status').textContent).toBe('无结果');
  });

  it('Enter 下一个、Shift+Enter 上一个', () => {
    const { onFindNext, onFindPrevious } = renderBar();
    const input = screen.getByTestId('terminal-search-input');

    fireEvent.change(input, { target: { value: 'tok' } });
    onFindNext.mockClear();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(onFindNext).toHaveBeenCalledWith('tok', false);
    expect(onFindPrevious).toHaveBeenCalledWith('tok', false);
  });

  it('大小写开关切换后用新值重新搜索', () => {
    const { onFindNext } = renderBar();
    const input = screen.getByTestId('terminal-search-input');
    fireEvent.change(input, { target: { value: 'Log' } });
    onFindNext.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '区分大小写' }));

    expect(onFindNext).toHaveBeenCalledWith('Log', true);
    expect(screen.getByRole('button', { name: '区分大小写' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('Esc 与关闭按钮都会关闭搜索条', () => {
    const { onClose } = renderBar();
    const input = screen.getByTestId('terminal-search-input');

    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('空词不发搜索请求', () => {
    const { onFindNext, onFindPrevious } = renderBar();

    fireEvent.keyDown(screen.getByTestId('terminal-search-input'), { key: 'Enter' });

    expect(onFindNext).not.toHaveBeenCalled();
    expect(onFindPrevious).not.toHaveBeenCalled();
  });
});
