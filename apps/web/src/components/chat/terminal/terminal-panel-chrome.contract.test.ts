/**
 * 终端抽屉头部 chrome 的 CSS 契约（VS Code 平铺改版：D1–D4）。
 *
 * 锁住的不变量：
 *  - 两行头部（面板页签行 / 终端 tab 条）引用同一个 --terminal-panel-header-height（35px）；
 *  - 终端 tab 是平铺样式：无卡片圆角，激活态 = 顶部 2px accent 规则线 + 背景阶梯；
 *  - 关闭 × 默认 opacity: 0，hover / [data-active] / :focus-within 才显形
 *    （不得用 display:none / visibility:hidden —— 会把按钮移出 Tab 序列与可访问性树）；
 *  - hint 偏移、danger 图标按钮变体存在，且本轮触碰的规则里没有字面色值。
 *
 * 为什么用 fs 读源码而不是 `?raw`：Vitest 的 CSS 管线会把样式文件的 import 换成空模块，
 * 拿不到原始文本；契约测试要的正是源码文本（与 terminal-fit-padding.contract.test.ts 同一手法）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'terminal-panel.css');
/** 选择器解析前先剥注释：注释文本会混进「选择器列表」导致精确匹配失败。 */
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 取「选择器列表中包含 selector 的规则」的声明块（组选择器里只有最后一项紧跟 `{`）。 */
function ruleBody(source: string, selector: string): string {
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2] ?? '';
  }
  throw new Error(`未找到 CSS 规则 ${selector}`);
}

/** 取 at-rule 的完整块（含嵌套规则）：按花括号配平截取。 */
function atRuleBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`未找到 at-rule ${marker}`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`at-rule ${marker} 花括号不配平`);
}

const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

describe('终端抽屉头部高度（D4）', () => {
  it('高度声明收口在 .terminal-panel 的 --terminal-panel-header-height: 35px', () => {
    expect(ruleBody(css, '.terminal-panel')).toMatch(/--terminal-panel-header-height:\s*35px\s*;/);
  });

  it('两行头部都引用该变量（height + min-height），不再写死像素', () => {
    for (const selector of ['.terminal-panel__tab-rail', '.terminal-panel__tab-strip']) {
      const body = ruleBody(css, selector);
      expect(body).toMatch(/height:\s*var\(--terminal-panel-header-height\)\s*;/);
      expect(body).toMatch(/min-height:\s*var\(--terminal-panel-header-height\)\s*;/);
      expect(body).not.toMatch(/(^|[;{\s])height:\s*\d+px\s*;/);
    }
  });

  it('hint 偏移跟随头部高度：calc(var(--terminal-panel-header-height) + var(--spacing-2))', () => {
    const body = ruleBody(css, '.terminal-panel__hint');
    expect(body).toMatch(
      /top:\s*calc\(var\(--terminal-panel-header-height\)\s*\+\s*var\(--spacing-2\)\)\s*;/,
    );
    expect(body).not.toMatch(/top:\s*\d+px\s*;/);
  });
});

describe('终端 tab 平铺激活态（D2）', () => {
  it('.terminal-tab 无卡片圆角、无 accent-subtle 填充信号', () => {
    const body = ruleBody(css, '.terminal-tab');
    expect(body).not.toMatch(/border-radius\s*:/);
    expect(body).not.toMatch(/accent-subtle/);
  });

  it("激活态保留 [data-active='true'] 选择器，信号为背景阶梯 + accent 文字", () => {
    const body = ruleBody(css, ".terminal-tab[data-active='true']");
    expect(body).toMatch(/background:\s*var\(--bg-overlay\)\s*;/);
    expect(body).toMatch(/color:\s*var\(--accent\)\s*;/);
    expect(body).not.toMatch(/accent-subtle|accent-border/);
  });

  it("激活态顶部 2px accent 规则线（[data-active='true']::before）", () => {
    const body = ruleBody(css, ".terminal-tab[data-active='true']::before");
    expect(body).toMatch(/top:\s*0\s*;/);
    expect(body).toMatch(/height:\s*2px\s*;/);
    expect(body).toMatch(/background:\s*var\(--accent\)\s*;/);
  });
});

describe('关闭 × 的显隐（D3）', () => {
  it('默认视觉隐藏走 opacity: 0（不是 display:none / visibility:hidden）', () => {
    const body = ruleBody(css, '.terminal-tab__close');
    expect(body).toMatch(/opacity:\s*0\s*;/);
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
    expect(body).toMatch(/transition:[\s\S]*opacity\s+var\(--dur-micro\)\s+var\(--ease-micro\)/);
  });

  it('hover / [data-active] / :focus-within 三条显形选择器都在', () => {
    expect(ruleBody(css, '.terminal-tab:hover .terminal-tab__close')).toMatch(/opacity:\s*1\s*;/);
    expect(ruleBody(css, ".terminal-tab[data-active='true'] .terminal-tab__close")).toMatch(
      /opacity:\s*1\s*;/,
    );
    expect(ruleBody(css, '.terminal-tab:focus-within .terminal-tab__close')).toMatch(
      /opacity:\s*1\s*;/,
    );
  });

  it('显形后焦点环仍是 2px accent + 4px accent-subtle 光晕', () => {
    const body = ruleBody(css, '.terminal-tab__close:focus-visible');
    expect(body).toMatch(/outline:\s*2px solid var\(--accent\)\s*;/);
    expect(body).toMatch(/box-shadow:\s*0 0 0 4px var\(--accent-subtle\)\s*;/);
  });

  it('prefers-reduced-motion 下关闭 × 不做过渡', () => {
    const media = atRuleBlock(css, '@media (prefers-reduced-motion: reduce)');
    expect(media).toMatch(/\.terminal-tab__close\s*\{[^}]*transition:\s*none\s*;/);
  });
});

describe('图标按钮 danger 变体与字面色值守卫', () => {
  it('danger hover / active 都走 danger token', () => {
    const hover = ruleBody(css, '.terminal-panel__icon-btn--danger:hover');
    expect(hover).toMatch(/border-color:\s*var\(--danger-border\)\s*;/);
    expect(hover).toMatch(/background:\s*var\(--danger-muted\)\s*;/);
    expect(hover).toMatch(/color:\s*var\(--danger\)\s*;/);

    const active = ruleBody(css, '.terminal-panel__icon-btn--danger:active');
    expect(active).toMatch(/background:\s*var\(--danger\)\s*;/);
    expect(active).toMatch(/color:\s*var\(--fg-on-complement\)\s*;/);
  });

  it('本轮触碰的规则内没有字面色值（#hex / rgb() / hsl()）', () => {
    const touched = [
      '.terminal-panel',
      '.terminal-panel__tab-rail',
      '.terminal-panel__tab-strip',
      '.terminal-panel__hint',
      '.terminal-panel-tab',
      '.terminal-tab',
      '.terminal-tab:hover',
      '.terminal-tab:active',
      ".terminal-tab[data-active='true']",
      ".terminal-tab[data-active='true']::before",
      '.terminal-tab__close',
      '.terminal-tab:hover .terminal-tab__close',
      '.terminal-panel__icon-btn--danger:hover',
      '.terminal-panel__icon-btn--danger:active',
    ];
    for (const selector of touched) {
      expect(ruleBody(css, selector), `${selector} 出现字面色值`).not.toMatch(LITERAL_COLOR);
    }
  });
});
