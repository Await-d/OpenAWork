// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteQueuedComposerFiles,
  persistQueuedComposerFiles,
  restoreQueuedComposerFiles,
} from './queued-composer-file-store.js';

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: undefined,
  });
});

describe('queued-composer-file-store', () => {
  it('当前环境不支持 indexedDB 时 persist 返回 false', async () => {
    const file = new File(['hello'], 'demo.txt', { type: 'text/plain' });

    await expect(
      persistQueuedComposerFiles({
        attachmentItems: [{ id: 'att-1', name: 'demo.txt', type: 'file' } as never],
        files: [file],
        queueId: 'queue-1',
        scope: 'session-1',
      }),
    ).resolves.toBe(false);
  });

  it('当前环境不支持 indexedDB 时 restore 返回 restored=false', async () => {
    await expect(
      restoreQueuedComposerFiles({
        attachmentItems: [{ id: 'att-1', name: 'demo.txt', type: 'file' } as never],
        queueId: 'queue-1',
        scope: 'session-1',
      }),
    ).resolves.toEqual({
      files: [],
      restored: false,
    });
  });

  it('当前环境不支持 indexedDB 时 delete 不抛错', async () => {
    await expect(
      deleteQueuedComposerFiles({
        queueId: 'queue-1',
        scope: 'session-1',
      }),
    ).resolves.toBeUndefined();
  });
});
