// @vitest-environment jsdom
/**
 * 右键菜单：键盘可达（↑/↓ + Enter）、Esc / 点击外部关闭、
 * disabled 项不可触发、视口内夹取。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TerminalContextMenu, type TerminalContextMenuItem } from './TerminalContextMenu.js';

afterEach(() => {
  cleanup();
});

function makeItems(overrides: Partial<TerminalContextMenuItem> = {}) {
  const onCopy = vi.fn();
  const onPaste = vi.fn();
  const onSelectAll = vi.fn();
  const items: TerminalContextMenuItem[] = [
    { id: 'copy', label: '复制', hint: 'Ctrl+Shift+C', onSelect: onCopy, ...overrides },
    { id: 'paste', label: '粘贴', onSelect: onPaste },
    { id: 'select-all', label: '全选', disabled: true, onSelect: onSelectAll },
  ];
  return { items, onCopy, onPaste, onSelectAll };
}

describe('TerminalContextMenu', () => {
  it('渲染全部菜单项并按 role 暴露', () => {
    const { items } = makeItems();
    render(<TerminalContextMenu x={10} y={10} items={items} onClose={vi.fn()} />);

    expect(screen.getAllByRole('menuitem').length).toBe(3);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /全选/ }).hasAttribute('disabled')).toBe(true);
  });

  it('点击菜单项触发动作并关闭', () => {
    const onClose = vi.fn();
    const { items, onPaste } = makeItems();
    render(<TerminalContextMenu x={10} y={10} items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /粘贴/ }));

    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('方向键移动高亮并跳过 disabled 项，Enter 触发当前项', () => {
    const onClose = vi.fn();
    const { items, onPaste } = makeItems();
    render(<TerminalContextMenu x={10} y={10} items={items} onClose={onClose} />);
    const menu = screen.getByRole('menu');

    // 初始高亮第一项；↓ 到粘贴；再 ↓ 应跳过 disabled 的全选回到复制。
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onPaste).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(menu.getAttribute('aria-activedescendant')).toContain('copy');
  });

  it('Esc 与点击外部都会关闭', () => {
    const onClose = vi.fn();
    const { items } = makeItems();
    render(<TerminalContextMenu x={10} y={10} items={items} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('打开瞬间的 scroll（xterm 右键聚焦引起）不关闭菜单，之后的用户滚动才关闭', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const onClose = vi.fn();
    const { items } = makeItems();
    try {
      render(<TerminalContextMenu x={10} y={10} items={items} onClose={onClose} />);

      // 打开瞬间：右击会让 xterm 移动并聚焦 helper textarea，浏览器随之触发一次 scroll
      fireEvent.scroll(window);
      expect(onClose).not.toHaveBeenCalled();

      // 静默窗口过后，真实滚动仍应关闭
      nowSpy.mockReturnValue(1000);
      fireEvent.scroll(window);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('坐标越界时夹取到视口内（375px 窄屏不溢出右侧）', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });

    try {
      const { items } = makeItems();
      render(<TerminalContextMenu x={1000} y={1000} items={items} onClose={vi.fn()} />);
      const menu = screen.getByRole('menu');

      expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(375 - 8);
      expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(400 - 8);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
    }
  });

  it('复选项按 menuitemcheckbox 渲染并暴露选中态', () => {
    const items: TerminalContextMenuItem[] = [
      { id: 'copy-on-select', label: '选中即复制', checked: true, onSelect: vi.fn() },
    ];
    render(<TerminalContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);

    const checkboxItem = screen.getByRole('menuitemcheckbox', { name: /选中即复制/ });
    expect(checkboxItem.getAttribute('aria-checked')).toBe('true');
  });
});
