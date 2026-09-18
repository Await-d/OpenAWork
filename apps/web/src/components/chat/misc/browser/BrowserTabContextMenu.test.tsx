// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserTabContextMenu } from './BrowserTabContextMenu.js';

function createHandlers() {
  return {
    onClose: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseTabsToRight: vi.fn(),
    onCopyUrl: vi.fn(),
    onReload: vi.fn(),
  };
}

function renderMenu(props: Partial<Parameters<typeof BrowserTabContextMenu>[0]> = {}) {
  const handlers = createHandlers();

  render(
    <BrowserTabContextMenu active index={0} tabCount={3} x={40} y={60} {...handlers} {...props} />,
  );

  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('BrowserTabContextMenu', () => {
  it('激活标签提供重新加载，点击后执行并关闭菜单', () => {
    const handlers = renderMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: '重新加载' }));

    expect(handlers.onReload).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('非激活标签不提供重新加载，但仍可复制与关闭', () => {
    renderMenu({ active: false });

    expect(screen.queryByRole('menuitem', { name: '重新加载' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '复制链接' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: '关闭标签' })).not.toBeNull();
  });

  it('复制链接与三个关闭入口各自触发对应回调', () => {
    const handlers = renderMenu({ index: 1, tabCount: 3 });

    fireEvent.click(screen.getByRole('menuitem', { name: '复制链接' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭标签' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭其他标签' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭右侧标签' }));

    expect(handlers.onCopyUrl).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseTab).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseOtherTabs).toHaveBeenCalledTimes(1);
    expect(handlers.onCloseTabsToRight).toHaveBeenCalledTimes(1);
  });

  it('只有一个标签时「关闭其他 / 关闭右侧」均不可用', () => {
    renderMenu({ index: 0, tabCount: 1 });

    expect(getMenuItem('关闭其他标签').disabled).toBe(true);
    expect(getMenuItem('关闭右侧标签').disabled).toBe(true);
  });

  it('最后一个标签只禁用「关闭右侧标签」', () => {
    renderMenu({ index: 2, tabCount: 3 });

    expect(getMenuItem('关闭其他标签').disabled).toBe(false);
    expect(getMenuItem('关闭右侧标签').disabled).toBe(true);
  });

  it('按 Escape 关闭菜单', () => {
    const handlers = renderMenu();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('点击菜单外关闭，点击菜单内不关闭', () => {
    const handlers = renderMenu();

    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(handlers.onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('打开后聚焦首个可用项，方向键循环', () => {
    renderMenu();

    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('按光标坐标展开并钳制在视口内', () => {
    renderMenu({ x: 30, y: 40 });

    expect(screen.getByRole('menu').style.left).toBe('30px');
    expect(screen.getByRole('menu').style.top).toBe('40px');
  });
});

function getMenuItem(name: string): HTMLButtonElement {
  return screen.getByRole('menuitem', { name }) as HTMLButtonElement;
}
