// @vitest-environment jsdom
/**
 * 复制到剪贴板 / 引用到输入框两条出口的覆盖。
 *
 * 这两件事都是"静默失败"的高危点：dispatch 的事件名写错、或 clipboard
 * 在非安全上下文不可用，用户看到的是"点了没反应"。因此这里把两条路径
 * 和它们的回落行为都钉住。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSER_INSERT_EVENT,
  copyTextToClipboard,
  insertTextIntoComposer,
  quoteEntryIntoComposer,
} from './browser-clipboard.js';

function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

afterEach(() => {
  stubClipboard(undefined);
  vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
  it('优先走 navigator.clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard({ writeText });

    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('clipboard 抛错时回落到 execCommand', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    stubClipboard({ writeText });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await expect(copyTextToClipboard('fallback')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('clipboard 不存在时也走回落，不抛异常', async () => {
    stubClipboard(undefined);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await expect(copyTextToClipboard('no clipboard api')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('两条路径都不可用时返回 false 而不是 throw', async () => {
    stubClipboard(undefined);
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });

    await expect(copyTextToClipboard('nope')).resolves.toBe(false);
  });

  it('空文本直接判失败，不写剪贴板', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard({ writeText });

    await expect(copyTextToClipboard('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe('insertTextIntoComposer', () => {
  it('派发约定事件，默认 append 模式', () => {
    const details: unknown[] = [];
    const handler = (event: Event): void => {
      details.push((event as CustomEvent).detail);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, handler);
    try {
      insertTextIntoComposer('hello composer');
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
    }

    expect(details).toEqual([{ text: 'hello composer', mode: 'append' }]);
  });

  it('空文本不派发事件', () => {
    const handler = vi.fn();
    window.addEventListener(COMPOSER_INSERT_EVENT, handler);
    try {
      insertTextIntoComposer('');
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
    }

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('quoteEntryIntoComposer', () => {
  it('引用错误日志时带上级别与内容', () => {
    const details: Array<{ text: string; mode: string }> = [];
    const handler = (event: Event): void => {
      details.push((event as CustomEvent).detail as { text: string; mode: string });
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, handler);
    try {
      quoteEntryIntoComposer({
        id: 'e1',
        level: 'error',
        message: 'Uncaught TypeError',
        timestamp: 0,
      });
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
    }

    expect(details.length).toBe(1);
    expect(details[0]?.text).toContain('控制台 error：Uncaught TypeError');
  });
});
