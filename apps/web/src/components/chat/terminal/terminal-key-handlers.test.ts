// @vitest-environment jsdom
/**
 * 快捷键判定矩阵 + 剪贴板读写。
 *
 * 判定矩阵的重点是「不该接管的一律放行」——Ctrl+C（中断）、Ctrl+V（原生
 * 粘贴）、无选中时的 Ctrl+Shift+C 都必须把事件交还 xterm / 浏览器，
 * 否则会打断用户最常用的操作。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTerminalCustomKeyHandler,
  readClipboardText,
  resolveTerminalShortcut,
  writeClipboardText,
  type TerminalKeyEventLike,
} from './terminal-key-handlers.js';

function keyEvent(overrides: Partial<TerminalKeyEventLike> = {}): TerminalKeyEventLike {
  return {
    type: 'keydown',
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe('resolveTerminalShortcut', () => {
  const withSelection = { hasSelection: true };
  const withoutSelection = { hasSelection: false };

  it('Ctrl+Shift+C 命中复制，⌘+Shift+C 同样命中', () => {
    expect(
      resolveTerminalShortcut(keyEvent({ key: 'C', ctrlKey: true, shiftKey: true }), withSelection),
    ).toBe('copy');
    expect(
      resolveTerminalShortcut(keyEvent({ key: 'C', metaKey: true, shiftKey: true }), withSelection),
    ).toBe('copy');
  });

  it('无选中时不劫持复制', () => {
    expect(
      resolveTerminalShortcut(
        keyEvent({ key: 'C', ctrlKey: true, shiftKey: true }),
        withoutSelection,
      ),
    ).toBeNull();
  });

  it('Ctrl/⌘+Shift+V 命中粘贴', () => {
    expect(
      resolveTerminalShortcut(
        keyEvent({ key: 'V', ctrlKey: true, shiftKey: true }),
        withoutSelection,
      ),
    ).toBe('paste');
    expect(
      resolveTerminalShortcut(
        keyEvent({ key: 'v', metaKey: true, shiftKey: true }),
        withoutSelection,
      ),
    ).toBe('paste');
  });

  it('Ctrl/⌘+F 命中搜索，Ctrl/⌘+K 清缓冲，Ctrl/⌘+L 交 shell 清屏', () => {
    expect(resolveTerminalShortcut(keyEvent({ key: 'f', ctrlKey: true }), withoutSelection)).toBe(
      'search',
    );
    expect(resolveTerminalShortcut(keyEvent({ key: 'k', metaKey: true }), withoutSelection)).toBe(
      'clear-buffer',
    );
    expect(resolveTerminalShortcut(keyEvent({ key: 'l', ctrlKey: true }), withoutSelection)).toBe(
      'clear-shell',
    );
  });

  it('未命中的组合一律放行', () => {
    const cases: TerminalKeyEventLike[] = [
      keyEvent({ key: 'c', ctrlKey: true }),
      keyEvent({ key: 'v', ctrlKey: true }),
      keyEvent({ key: 'v', ctrlKey: true, shiftKey: true, altKey: true }),
      keyEvent({ key: 'd', ctrlKey: true }),
      keyEvent({ key: 'a' }),
      keyEvent({ key: 'Enter' }),
      keyEvent({ key: 'ArrowUp' }),
      keyEvent({ key: 'f', ctrlKey: true, type: 'keyup' }),
    ];

    for (const event of cases) {
      expect(resolveTerminalShortcut(event, withSelection)).toBeNull();
    }
  });
});

describe('createTerminalCustomKeyHandler', () => {
  function createDeps(selection = '') {
    return {
      terminal: { getSelection: () => selection },
      copySelection: vi.fn(),
      requestPaste: vi.fn(),
      openSearch: vi.fn(),
      clearBuffer: vi.fn(),
      sendShellClear: vi.fn(),
    };
  }

  it('复制命中时阻止默认行为并回传选中文本', () => {
    const deps = createDeps('echo hi');
    const handler = createTerminalCustomKeyHandler(deps);
    const event = new KeyboardEvent('keydown', {
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    expect(handler(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(deps.copySelection).toHaveBeenCalledWith('echo hi');
  });

  it('无选中时复制快捷键交还浏览器', () => {
    const deps = createDeps('');
    const handler = createTerminalCustomKeyHandler(deps);
    const event = new KeyboardEvent('keydown', {
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    expect(handler(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(deps.copySelection).not.toHaveBeenCalled();
  });

  it('粘贴 / 搜索 / 清缓冲 / shell 清屏各自触发对应副作用', () => {
    const deps = createDeps();
    const handler = createTerminalCustomKeyHandler(deps);

    handler(
      new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, cancelable: true }),
    );
    handler(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true }));
    handler(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
    handler(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true }));

    expect(deps.requestPaste).toHaveBeenCalledTimes(1);
    expect(deps.openSearch).toHaveBeenCalledTimes(1);
    expect(deps.clearBuffer).toHaveBeenCalledTimes(1);
    expect(deps.sendShellClear).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C 中断信号原样放行', () => {
    const deps = createDeps('some selection');
    const handler = createTerminalCustomKeyHandler(deps);
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true });

    expect(handler(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(deps.copySelection).not.toHaveBeenCalled();
  });
});

describe('clipboard helpers', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('读取与写入都转发给 navigator.clipboard', async () => {
    const readText = vi.fn(async () => 'pasted text');
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText, writeText },
      configurable: true,
    });

    await expect(readClipboardText()).resolves.toBe('pasted text');
    await writeClipboardText('copied text');
    expect(writeText).toHaveBeenCalledWith('copied text');
  });

  it('剪贴板不可用时给出明确错误（用于 UI 提示）', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    await expect(readClipboardText()).rejects.toThrow('当前环境不支持读取剪贴板');
    await expect(writeClipboardText('x')).rejects.toThrow('当前环境不支持写入剪贴板');
  });
});
