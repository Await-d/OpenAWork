// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSelectionRectWithin, readSelectionTextWithin } from './selection.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 用最小的 Selection 替身：`anchorNode` 决定包含性判断，`toString()` 是文本载荷，
 * `getRangeAt()` 提供包围盒。
 */
function stubSelection(options: {
  anchorNode: Node | null;
  text?: string;
  rect?: { left: number; top: number; height: number };
}): void {
  const { anchorNode, text = '', rect = { left: 0, top: 0, height: 0 } } = options;
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: anchorNode === null,
    anchorNode,
    rangeCount: anchorNode === null ? 0 : 1,
    toString: () => text,
    getRangeAt: () => ({ toString: () => text, getBoundingClientRect: () => rect }),
  } as unknown as Selection);
}

describe('readSelectionTextWithin', () => {
  it('返回容器内选中的文本（去掉首尾空白）', () => {
    const container = document.createElement('div');
    const inner = document.createElement('span');
    container.appendChild(inner);
    document.body.appendChild(container);
    stubSelection({ anchorNode: inner, text: '  {"answer":42}  ' });

    expect(readSelectionTextWithin(container)).toBe('{"answer":42}');
  });

  it('选区落在容器之外时返回空串', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // 选区锚点在聊天区：不能把它当成预览内容透出去。
    stubSelection({ anchorNode: document.body, text: '来自聊天区的文本' });

    expect(readSelectionTextWithin(container)).toBe('');
  });

  it('没有选区时返回空串', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    stubSelection({ anchorNode: null, text: '不该被读到' });

    expect(readSelectionTextWithin(container)).toBe('');
  });
});

describe('readSelectionRectWithin', () => {
  it('返回选区在视口中的包围盒', () => {
    const container = document.createElement('div');
    const inner = document.createElement('span');
    container.appendChild(inner);
    document.body.appendChild(container);
    stubSelection({ anchorNode: inner, rect: { left: 12, top: 34, height: 8 } });

    expect(readSelectionRectWithin(container)).toEqual({ left: 12, top: 34, height: 8 });
  });

  it('选区不在容器内时返回 null', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    stubSelection({ anchorNode: document.body });

    expect(readSelectionRectWithin(container)).toBeNull();
  });
});
