import { afterEach, describe, expect, it } from 'vitest';
import {
  contrastRatio,
  formatCssColor,
  mixColors,
  parseCssColor,
  pickReadableColor,
  readAppliedTheme,
  readMarkdownThemeTokens,
} from './theme-tokens.js';

afterEach(() => {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-mode');
  root.removeAttribute('style');
});

describe('parseCssColor / formatCssColor', () => {
  it('解析 hex 的短写、长写与带透明度写法', () => {
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseCssColor('#8B9DFF')).toEqual({ r: 139, g: 157, b: 255, a: 1 });

    const translucent = parseCssColor('#8b9dff80');
    expect(translucent?.r).toBe(139);
    expect(translucent?.a).toBeCloseTo(128 / 255, 6);
  });

  it('解析 rgb() / rgba() 的逗号与空格写法', () => {
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor('rgba(139, 157, 255, 0.16)')).toEqual({
      r: 139,
      g: 157,
      b: 255,
      a: 0.16,
    });
    expect(parseCssColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('拒绝无法解析的色彩空间，交由调用方兜底', () => {
    expect(parseCssColor('oklch(0.7 0.1 250)')).toBeNull();
    expect(parseCssColor('color-mix(in oklch, red, blue)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('var(--accent)')).toBeNull();
  });

  it('不透明输出 hex，带透明度输出 rgba()', () => {
    expect(formatCssColor({ r: 255, g: 0, b: 0, a: 1 })).toBe('#ff0000');
    expect(formatCssColor({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
  });
});

describe('mixColors', () => {
  it('半透明强调色叠在不透明底色上会得到不透明结果', () => {
    const base = { r: 0, g: 0, b: 0, a: 1 };
    const accent = { r: 255, g: 255, b: 255, a: 0.5 };
    const mixed = mixColors(base, accent, 1);

    // 先按 alpha 合成（50% 白叠黑 = 中灰），再按比例插值
    expect(mixed.a).toBe(1);
    expect(mixed.r).toBe(127.5);
  });

  it('比例为 0 时保持底色', () => {
    const base = { r: 10, g: 20, b: 30, a: 1 };
    const mixed = mixColors(base, { r: 255, g: 255, b: 255, a: 1 }, 0);
    expect(mixed).toEqual(base);
  });

  it('输出始终可被再次解析', () => {
    const mixed = mixColors(
      { r: 17, g: 20, b: 42, a: 1 },
      { r: 139, g: 157, b: 255, a: 0.16 },
      0.4,
    );
    expect(parseCssColor(formatCssColor(mixed))).not.toBeNull();
  });
});

describe('对比度选择', () => {
  it('浅色底上优先选深色文字', () => {
    const light = { r: 244, g: 246, b: 255, a: 1 };
    const dark = { r: 10, g: 14, b: 46, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(light, dark)).toBeGreaterThan(contrastRatio(light, white));
    expect(pickReadableColor(light, white, dark)).toEqual(dark);
  });

  it('深色底上保留浅色文字', () => {
    const dark = { r: 20, g: 24, b: 50, a: 1 };
    const light = { r: 243, g: 244, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    expect(pickReadableColor(dark, light, black)).toEqual(light);
  });
});

describe('readMarkdownThemeTokens', () => {
  it('读不到主题变量时退回兜底值而不是空字符串', () => {
    const tokens = readMarkdownThemeTokens();
    expect(tokens.accent).toBe('#7c8cff');
    expect(tokens.chart).toHaveLength(8);
    expect(parseCssColor(tokens.accent)).not.toBeNull();
  });

  it('读取内联主题变量并归一化为可解析颜色', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'sakura');
    root.setAttribute('data-mode', 'light');
    root.style.setProperty('--accent', 'rgba(224, 73, 122, 1)');
    root.style.setProperty('--chart-1', '#e0497a');

    const tokens = readMarkdownThemeTokens();

    expect(tokens.style).toBe('sakura');
    expect(tokens.mode).toBe('light');
    expect(tokens.accent).toBe('#e0497a');
    expect(tokens.chart[0]).toBe('#e0497a');
  });

  it('遇到不可解析的变量值时退回兜底值', () => {
    const root = document.documentElement;
    root.style.setProperty('--accent', 'oklch(0.7 0.1 250)');

    expect(readMarkdownThemeTokens().accent).toBe('#7c8cff');
  });
});

describe('readAppliedTheme', () => {
  it('以 data-mode 为准，避免 system 模式误判', () => {
    document.documentElement.setAttribute('data-mode', 'light');
    expect(readAppliedTheme().mode).toBe('light');

    document.documentElement.setAttribute('data-mode', 'dark');
    expect(readAppliedTheme().mode).toBe('dark');
  });
});
