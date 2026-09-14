import { describe, expect, it } from 'vitest';
import { contextMenuAnchorFromRect, isContextMenuKey } from './context-menu-keyboard.js';

describe('isContextMenuKey', () => {
  it('识别 Windows 菜单键', () => {
    expect(isContextMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true);
    // 个别旧环境（WebView / 老版 Edge）报 'Apps'。
    expect(isContextMenuKey({ key: 'Apps', shiftKey: false })).toBe(true);
  });

  it('识别 Shift+F10', () => {
    expect(isContextMenuKey({ key: 'F10', shiftKey: true })).toBe(true);
  });

  it('单独的 F10 不是菜单键（那是浏览器的菜单栏快捷键）', () => {
    expect(isContextMenuKey({ key: 'F10', shiftKey: false })).toBe(false);
  });

  it('其他按键一律不认', () => {
    expect(isContextMenuKey({ key: 'F2', shiftKey: true })).toBe(false);
    expect(isContextMenuKey({ key: 'Enter', shiftKey: false })).toBe(false);
  });
});

describe('contextMenuAnchorFromRect', () => {
  it('锚点贴在矩形左下角', () => {
    expect(contextMenuAnchorFromRect({ left: 100, top: 200, height: 30 })).toEqual({
      x: 100,
      y: 230,
    });
  });

  it('小数坐标取整，避免亚像素抖动', () => {
    expect(contextMenuAnchorFromRect({ left: 10.6, top: 20.2, height: 5.9 })).toEqual({
      x: 11,
      y: 26,
    });
  });
});
