/**
 * FitAddon 测量口径的契约断言（D-2 回归锁）。
 *
 * 背景：`@xterm/addon-fit` 的 `proposeDimensions()` 用
 * `getComputedStyle(term.element.parentElement).height` 求可用高度，再 ÷ 单元格行高取整。
 * xterm 的挂载容器就是 `.terminal-surface` —— 它一旦带 padding，这份高度会把 padding
 * 当成可用行空间，而画布从 padding 之后才开始画 → `.xterm-screen` 底部最多越出容器 4px
 * （最后一行被切；列拆分 / 基线单 pane 均可复现，见 verify-drag-browser.md D-2）。
 *
 * 修复：视觉内缩移到 `.terminal-root`（挂载容器的父级，不参与 fit 测量）。
 * jsdom 没有布局引擎，无法断言真实几何；这里锁住「测量容器零 padding」这个前提，
 * 真实浏览器几何断言片段（`screen.bottom <= pane.bottom`）见报告
 * `.agentdocs/runtime/260916-终端面板-vscode布局对齐/t15-ports-ui-and-fixes.md`。
 *
 * 为什么用 fs 读源码而不是 `?raw`：Vitest 的 CSS 管线会把样式文件的 import 换成
 * 空模块（`?raw` 也不例外），拿不到原始文本；契约测试要的正是**源码文本**。
 * 路径用 `join(dirname(fileURLToPath(import.meta.url)), ...)` 拼出：`new URL('./x.css',
 * import.meta.url)` 会被 Vite 的静态资产分析改写成构建产物 URL，readFileSync 会失败。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const overlayCssPath = join(dirname(fileURLToPath(import.meta.url)), 'terminal-overlay.css');
const overlayCss = readFileSync(overlayCssPath, 'utf8');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match?.[1]) throw new Error(`未找到 CSS 规则 ${selector}`);
  return match[1];
}

describe('终端 fit 测量容器（.terminal-surface）padding 契约', () => {
  it('.terminal-surface 不声明 padding —— 它是 FitAddon 的测量父元素', () => {
    expect(ruleBody(overlayCss, '.terminal-surface')).not.toMatch(/(^|[;{\s])padding\s*:/);
  });

  it('.terminal-root 承担 4px 视觉内缩（不是 xterm 的父级，不影响测量）', () => {
    const body = ruleBody(overlayCss, '.terminal-root');
    expect(body).toMatch(/padding:\s*4px\s*;/);
    expect(body).toMatch(/box-sizing:\s*border-box\s*;/);
  });
});
