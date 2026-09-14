// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ContentContextMenuHost,
  type ContentContextMenuTrigger,
} from './ContentContextMenuHost.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

function stubSelection(anchorNode: Node | null, text: string): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: anchorNode === null,
    anchorNode,
    rangeCount: anchorNode === null ? 0 : 1,
    toString: () => text,
    getRangeAt: () => ({
      toString: () => text,
      getBoundingClientRect: () => rect({ left: 12, top: 34, height: 8 }),
    }),
  } as unknown as Selection);
}

function renderHost(onOpen: (trigger: ContentContextMenuTrigger) => void) {
  return render(
    <ContentContextMenuHost testId="host" onOpen={onOpen}>
      <div data-testid="content">{'{"answer":42}'}</div>
    </ContentContextMenuHost>,
  );
}

describe('ContentContextMenuHost — 鼠标右键', () => {
  it('把视口坐标与容器内选中的文本一起透出', () => {
    const onOpen = vi.fn();
    renderHost(onOpen);
    const content = screen.getByTestId('content');
    stubSelection(content, '  {"answer":42}  ');

    fireEvent.contextMenu(content, { clientX: 24, clientY: 48 });

    expect(onOpen).toHaveBeenCalledWith({ x: 24, y: 48, selection: '{"answer":42}' });
  });

  it('选区在宿主之外时透出空文本', () => {
    const onOpen = vi.fn();
    renderHost(onOpen);
    // 锚点落在聊天区：不能把别处高亮的文本当成宿主内容。
    stubSelection(document.body, '来自聊天区的文本');

    fireEvent.contextMenu(screen.getByTestId('content'), { clientX: 1, clientY: 2 });

    expect(onOpen).toHaveBeenCalledWith({ x: 1, y: 2, selection: '' });
  });

  it('挡掉浏览器原生菜单', () => {
    renderHost(vi.fn());

    // fireEvent 在事件被 preventDefault 时返回 false。
    expect(fireEvent.contextMenu(screen.getByTestId('content'))).toBe(false);
  });
});

describe('ContentContextMenuHost — 键盘呼出', () => {
  it('菜单键与 Shift+F10 都能呼出，并挡掉浏览器原生行为', () => {
    const onOpen = vi.fn();
    renderHost(onOpen);
    const host = screen.getByTestId('host');

    expect(fireEvent.keyDown(host, { key: 'ContextMenu' })).toBe(false);
    expect(fireEvent.keyDown(host, { key: 'F10', shiftKey: true })).toBe(false);

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('没有选区时锚在宿主容器左下角', () => {
    const onOpen = vi.fn();
    renderHost(onOpen);
    const host = screen.getByTestId('host');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(
      rect({ left: 100, top: 200, height: 30 }),
    );
    stubSelection(null, '');

    fireEvent.keyDown(host, { key: 'ContextMenu' });

    expect(onOpen).toHaveBeenCalledWith({ x: 100, y: 230, selection: '' });
  });

  it('有选区时锚在选区左下角，并带上选中文本', () => {
    const onOpen = vi.fn();
    renderHost(onOpen);
    const host = screen.getByTestId('host');
    const content = screen.getByTestId('content');
    stubSelection(content, '被选中的片段');

    fireEvent.keyDown(host, { key: 'F10', shiftKey: true });

    expect(onOpen).toHaveBeenCalledWith({
      x: 12,
      y: 42,
      selection: '被选中的片段',
    });
  });

  it('其他按键不触发菜单、也不拦截事件', () => {
    const onOpen = vi.fn();
    renderHost(onOpen);

    expect(fireEvent.keyDown(screen.getByTestId('host'), { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(screen.getByTestId('host'), { key: 'F10' })).toBe(true);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('宿主可被聚焦 —— 只读内容区默认不进 tab 序列，键盘事件就永远收不到', () => {
    renderHost(vi.fn());

    expect(screen.getByTestId('host').getAttribute('tabindex')).toBe('0');
  });
});
