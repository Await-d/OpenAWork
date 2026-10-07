// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileTreeContextMenu, { type FileTreeContextMenuProps } from './FileTreeContextMenu.js';

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

// 菜单固定尺寸替身：jsdom 的 getBoundingClientRect 全为 0，夹取逻辑测不出边界。
const MENU_RECT: DOMRect = {
  bottom: 300,
  height: 300,
  left: 0,
  right: 232,
  top: 0,
  width: 232,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

function renderMenu(overrides: Partial<FileTreeContextMenuProps> = {}) {
  const props: FileTreeContextMenuProps = {
    x: 100,
    y: 100,
    targetLabel: 'index.ts',
    targetType: 'file',
    relativePath: 'src/index.ts',
    canOpen: true,
    canCreateSession: true,
    canOpenInSystem: true,
    onClose: vi.fn(),
    onOpen: vi.fn(),
    onCopyPath: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<FileTreeContextMenu {...props} />);
  return screen.getByRole('menu', { name: '文件树操作菜单' });
}

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () => MENU_RECT;
  Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
});

describe('FileTreeContextMenu 视口内夹取', () => {
  it('底部越界时菜单向上夹取，四边保留 8px 边距', () => {
    const menu = renderMenu({ x: 100, y: 550 });

    expect(menu.style.top).toBe('292px');
    expect(menu.style.left).toBe('100px');
  });

  it('右侧越界时菜单向左夹取', () => {
    const menu = renderMenu({ x: 700, y: 100 });

    expect(menu.style.left).toBe('560px');
    expect(menu.style.top).toBe('100px');
  });

  it('菜单高于视口时限制高度并可滚动，不裁切菜单项', () => {
    const menu = renderMenu();

    expect(menu.style.maxHeight).toBe('calc(100vh - 16px)');
    expect(menu.style.overflowY).toBe('auto');
  });
});

describe('FileTreeContextMenu 在系统中打开', () => {
  it('文件项显示「用系统默认程序打开」', () => {
    renderMenu({ targetType: 'file', onOpenInSystem: vi.fn() });

    expect(screen.getByRole('menuitem', { name: '用系统默认程序打开' })).toBeTruthy();
  });

  it('目录项显示「在系统文件管理器中打开」', () => {
    renderMenu({ targetType: 'directory', onOpenInSystem: vi.fn() });

    expect(screen.getByRole('menuitem', { name: '在系统文件管理器中打开' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '用系统默认程序打开' })).toBeNull();
  });

  it('根目录项同样提供该入口', () => {
    renderMenu({ targetType: 'root', onOpenInSystem: vi.fn() });

    expect(screen.getByRole('menuitem', { name: '在系统文件管理器中打开' })).toBeTruthy();
  });

  it('点击后调用回调并关闭菜单', () => {
    const onOpenInSystem = vi.fn();
    const onClose = vi.fn();
    renderMenu({ targetType: 'directory', onOpenInSystem, onClose });

    fireEvent.click(screen.getByRole('menuitem', { name: '在系统文件管理器中打开' }));

    expect(onOpenInSystem).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('能力不可用时仍然展示，但置灰禁用并说明原因', () => {
    renderMenu({
      targetType: 'directory',
      canOpenInSystem: false,
      unavailableReason: '当前连接的是远程网关：文件位于服务器，无法在本机打开',
    });

    const item = screen.getByRole('menuitem', { name: '在系统文件管理器中打开' });
    expect(item.hasAttribute('disabled')).toBe(true);
    expect(item.getAttribute('title')).toBe('当前连接的是远程网关：文件位于服务器，无法在本机打开');
  });

  it('能力可用时不带禁用提示', () => {
    renderMenu({
      targetType: 'directory',
      canOpenInSystem: true,
      unavailableReason: '不应出现',
      onOpenInSystem: vi.fn(),
    });

    const item = screen.getByRole('menuitem', { name: '在系统文件管理器中打开' });
    expect(item.hasAttribute('disabled')).toBe(false);
    expect(item.getAttribute('title')).toBeNull();
  });
});
