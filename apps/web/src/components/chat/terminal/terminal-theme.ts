/**
 * 把 E · Nebula 的 CSS 变量桥接成 xterm 的 `ITheme`。
 *
 * 为什么需要这层：xterm 的颜色解析走 canvas `fillStyle` 往返，只能吃
 * 具体颜色值，`var(--bg-base)` 这类表达式会被它当成非法值并回退到内置
 * 默认色（浅色主题下就是黑底白字）。所以这里在运行时读计算样式，
 * 把变量解析成具体颜色再交给 xterm。
 *
 * 两条原则：
 *  - **不硬编码任何色值**：变量读不到 / 解析不了时直接跳过该键，
 *    让 xterm 用它自己的默认色，而不是在代码里写一份兜底调色板；
 *  - 主题切换（`data-theme` / `data-mode` 变化）后重新取色，
 *    否则浅色主题下终端会停留在上一套配色。
 */

import type { ITheme } from '@xterm/xterm';

export type ThemeVarReader = (varName: string) => string;

/** `ITheme` 里值为纯颜色的键（排除 `extendedAnsi` 这类数组键）。 */
type TerminalThemeColorKey =
  | 'background'
  | 'foreground'
  | 'cursor'
  | 'cursorAccent'
  | 'selectionBackground'
  | 'selectionInactiveBackground'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

/**
 * ANSI 调色板映射：让 `ls --color` / git diff 的输出直接落在 E · Nebula
 * 的四色体系与图表色板上，而不是 xterm 自带的霓虹默认色。
 */
export const TERMINAL_THEME_VAR_MAP: ReadonlyArray<readonly [TerminalThemeColorKey, string]> = [
  ['background', '--bg-base'],
  ['foreground', '--fg-default'],
  ['cursor', '--accent'],
  ['cursorAccent', '--fg-on-accent'],
  ['selectionBackground', '--accent-muted'],
  ['selectionInactiveBackground', '--accent-subtle'],
  ['black', '--fg-subtle'],
  ['red', '--danger'],
  ['green', '--success'],
  ['yellow', '--warning'],
  ['blue', '--aux'],
  ['magenta', '--chart-5'],
  ['cyan', '--accent'],
  ['white', '--fg-default'],
  ['brightBlack', '--fg-muted'],
  ['brightRed', '--complement'],
  ['brightGreen', '--success'],
  ['brightYellow', '--contrast'],
  ['brightBlue', '--aux'],
  ['brightMagenta', '--chart-5'],
  ['brightCyan', '--accent'],
  ['brightWhite', '--fg-strong'],
];

/** xterm 的 `Color.parse` 确定支持的写法：hex 与逗号分隔的 rgb()/rgba()。 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;
const HSL_COLOR =
  /^hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

/** `color-mix()` / `var()` / 空值等无法被 xterm 解析的写法一律返回 false。 */
export function isParseableThemeColor(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return false;
  }
  return HEX_COLOR.test(trimmed) || RGB_COLOR.test(trimmed) || HSL_COLOR.test(trimmed);
}

/** 用注入的读取器解析整套配色；读不到的键直接省略。 */
export function readTerminalTheme(read: ThemeVarReader): ITheme {
  const theme: ITheme = {};
  for (const [key, cssVar] of TERMINAL_THEME_VAR_MAP) {
    const value = read(cssVar).trim();
    if (isParseableThemeColor(value)) {
      theme[key] = value;
    }
  }
  return theme;
}

export function createDocumentThemeVarReader(
  root: HTMLElement = document.documentElement,
): ThemeVarReader {
  return (varName) => {
    if (typeof window === 'undefined') {
      return '';
    }
    return window.getComputedStyle(root).getPropertyValue(varName).trim();
  };
}

/**
 * 监听 `<html>` 的 `data-theme` / `data-mode`（App 写入的最终生效值），
 * 变化后重新取色并回调。返回取消订阅函数。
 */
export function subscribeToTerminalTheme(onChange: (theme: ITheme) => void): () => void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }
  const reader = createDocumentThemeVarReader();
  const observer = new MutationObserver(() => {
    onChange(readTerminalTheme(reader));
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-mode'],
  });
  return () => observer.disconnect();
}
