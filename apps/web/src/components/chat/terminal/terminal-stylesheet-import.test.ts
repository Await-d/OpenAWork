import { describe, expect, it } from 'vitest';
import terminalFactorySource from './terminal-xterm-options.ts?raw';

/**
 * 契约断言：终端装配模块必须保留 xterm 的库样式 import。
 *
 * 这是仓库里**唯一**能拦住该回归的关卡。`@xterm/xterm/css/xterm.css` 是纯副作用
 * import：类型系统看不见它、jsdom 没有布局引擎也不会应用它，而它一旦缺失，
 * `.xterm` / `.xterm-screen` / `.xterm-rows` 的尺寸与行高规则全部消失 —— 终端会
 * 「有数据但显示不出来」（两个入口同时白屏），而 typecheck 与全部单测仍然全绿。
 * 本轮拆分 `InteractiveTerminalView` 时正是这样丢的。
 */
describe('terminal-xterm-options 库样式契约', () => {
  it('引入 @xterm/xterm/css/xterm.css', () => {
    expect(terminalFactorySource).toMatch(/import\s+['"]@xterm\/xterm\/css\/xterm\.css['"]\s*;/);
  });
});
