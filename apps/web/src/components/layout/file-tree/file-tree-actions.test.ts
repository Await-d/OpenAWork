// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from './file-tree-actions.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('copyTextToClipboard', () => {
  it('execCommand=false 时返回中文错误', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });

    await expect(copyTextToClipboard('hello')).rejects.toThrow('浏览器未允许当前复制操作。');
  });
});
