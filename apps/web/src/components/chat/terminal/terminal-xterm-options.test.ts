// @vitest-environment jsdom
/**
 * `terminal-xterm-options` 装配契约：
 *  - `convertEol` 由调用方驱动：交互式 PTY → `false`（raw-mode TUI 的 `\n`
 *    不能被改写成 `\r\n`，否则绝对定位的光标与渲染错位）；缺省 → `true`，
 *    保留 pipe 后端的历史行为；
 *  - `refreshTerminal` 只在网格有效（`rows > 0`）时重绘 —— `fit()` 之后
 *    WebGL 画布不会自己感知新尺寸，不刷新就会停在旧网格上。
 *
 * xterm 本体在 jsdom 里跑不起来，这里用可观测替身验证**装配语义**。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  rows: 24,
  refreshCalls: [] as Array<[number, number]>,
  terminalOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    options: Record<string, unknown> = {};
    unicode = { activeVersion: '' };

    get rows(): number {
      return hoisted.rows;
    }

    constructor(options: Record<string, unknown> = {}) {
      hoisted.terminalOptions.push(options);
    }

    loadAddon(): void {}
    open(): void {}

    refresh(start: number, end: number): void {
      hoisted.refreshCalls.push([start, end]);
    }
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss(): { dispose: () => void } {
      return { dispose: (): void => undefined };
    }
    dispose(): void {}
  },
}));

const { Terminal } = await import('@xterm/xterm');
const { createInteractiveTerminal, createTerminalOptions, refreshTerminal } =
  await import('./terminal-xterm-options.js');

beforeEach(() => {
  hoisted.rows = 24;
  hoisted.refreshCalls.length = 0;
  hoisted.terminalOptions.length = 0;
});

describe('createTerminalOptions', () => {
  it('缺省 convertEol=true —— 旧后端 / 能力未知时保持升级前行为', () => {
    expect(createTerminalOptions().convertEol).toBe(true);
    expect(createTerminalOptions({}).convertEol).toBe(true);
  });

  it('convertEol 原样透传（交互式 PTY 传 false 时不改写 EOL）', () => {
    expect(createTerminalOptions({ convertEol: false }).convertEol).toBe(false);
    expect(createTerminalOptions({ convertEol: true }).convertEol).toBe(true);
  });
});

describe('createInteractiveTerminal', () => {
  it('把 convertEol 透传给 Terminal 构造参数', () => {
    const interactive = createInteractiveTerminal(document.createElement('div'), {
      convertEol: false,
    });
    expect(hoisted.terminalOptions.at(-1)?.convertEol).toBe(false);
    interactive.disposeExtras();

    const legacy = createInteractiveTerminal(document.createElement('div'));
    expect(hoisted.terminalOptions.at(-1)?.convertEol).toBe(true);
    legacy.disposeExtras();
  });
});

describe('refreshTerminal', () => {
  it('刷新整个网格 [0, rows-1]', () => {
    hoisted.rows = 24;

    refreshTerminal(new Terminal());

    expect(hoisted.refreshCalls).toEqual([[0, 23]]);
  });

  it('rows <= 0（隐藏 / 零尺寸容器）时不刷新', () => {
    hoisted.rows = 0;

    refreshTerminal(new Terminal());

    expect(hoisted.refreshCalls).toEqual([]);
  });
});
