// @vitest-environment jsdom
/**
 * 主题桥接：CSS 变量 → xterm ITheme。
 *
 * 关键断言是「读不到的键必须缺席」——一旦给 xterm 塞进
 * `var(--x)` / `color-mix(...)` 这类它解析不了的写法，它会回退到
 * 内置默认色（浅色主题下就是黑底），所以宁可省略也不能硬塞。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  TERMINAL_THEME_VAR_MAP,
  createDocumentThemeVarReader,
  isParseableThemeColor,
  readTerminalTheme,
  subscribeToTerminalTheme,
} from './terminal-theme.js';

describe('isParseableThemeColor', () => {
  it('接受 hex / 逗号 rgb() / 逗号 hsl()', () => {
    for (const value of [
      '#fff',
      '#8b9dff',
      '#8b9dff80',
      'rgb(139, 157, 255)',
      'rgba(139, 157, 255, 0.16)',
      'hsl(215, 20%, 50%)',
    ]) {
      expect(isParseableThemeColor(value), value).toBe(true);
    }
  });

  it('拒绝 xterm 解析不了的写法', () => {
    for (const value of [
      '',
      '   ',
      'var(--bg-base)',
      'color-mix(in srgb, var(--fg-muted) 40%, transparent)',
      'rgb(1 2 3 / 50%)',
      'oklch(0.7 0.1 250)',
    ]) {
      expect(isParseableThemeColor(value), value).toBe(false);
    }
  });
});

describe('readTerminalTheme', () => {
  it('按映射表读取并只写入可解析的颜色', () => {
    const values = new Map<string, string>([
      ['--bg-base', ' #0b1020 '],
      ['--fg-default', '#c3c9e8'],
      ['--accent', 'color-mix(in srgb, red, blue)'],
    ]);
    const theme = readTerminalTheme((name) => values.get(name) ?? '');

    expect(theme.background).toBe('#0b1020');
    expect(theme.foreground).toBe('#c3c9e8');
    expect(theme.cursor).toBeUndefined();
    expect(theme.brightYellow).toBeUndefined();
  });

  it('映射表覆盖关键键且不含重复的 xterm 主题键', () => {
    const keys = TERMINAL_THEME_VAR_MAP.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const required of ['background', 'foreground', 'cursor', 'selectionBackground'] as const) {
      expect(keys).toContain(required);
    }
  });

  it('全部变量缺失时返回空对象（交给 xterm 默认色）', () => {
    expect(readTerminalTheme(() => '')).toEqual({});
  });
});

describe('createDocumentThemeVarReader / subscribeToTerminalTheme', () => {
  it('读取器返回字符串且不抛错', () => {
    const reader = createDocumentThemeVarReader(document.documentElement);
    expect(typeof reader('--bg-base')).toBe('string');
  });

  it('主题属性变化时回调新配色，取消订阅后不再触发', async () => {
    document.documentElement.style.setProperty('--bg-base', '#010203');
    const onChange = vi.fn();

    const unsubscribe = subscribeToTerminalTheme(onChange);
    document.documentElement.setAttribute('data-mode', 'light');
    await Promise.resolve();

    unsubscribe();
    document.documentElement.setAttribute('data-mode', 'dark');
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ background: '#010203' });

    document.documentElement.removeAttribute('data-mode');
    document.documentElement.style.removeProperty('--bg-base');
  });
});
