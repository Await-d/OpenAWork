import { afterEach, describe, expect, it, vi } from 'vitest';

import { createComposerQueueClient } from './composer-queue.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createComposerQueueClient 的附件跨端字段', () => {
  it('list 解析附件里的 artifactId（跨端副本引用）', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              attachmentItems: [
                {
                  artifactId: 'artifact-remote-1',
                  id: 'att-1',
                  name: '截图.png',
                  sizeBytes: 3,
                  type: 'image',
                },
                { id: 'att-2', name: '无副本.txt', sizeBytes: 1, type: 'file' },
              ],
              enqueuedAt: 1,
              id: 'item-1',
              requiresAttachmentRebind: false,
              text: '带附件',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerQueueClient('http://localhost:3000');
    const items = await client.list('token-1', 'session-1');

    expect(items[0]?.attachmentItems).toEqual([
      {
        artifactId: 'artifact-remote-1',
        id: 'att-1',
        name: '截图.png',
        sizeBytes: 3,
        type: 'image',
      },
      // 没有副本的附件不凭空长出字段。
      { id: 'att-2', name: '无副本.txt', sizeBytes: 1, type: 'file' },
    ]);
  });

  it('updateAttachments 走 PATCH 并返回回填后的条目', async () => {
    let calledUrl = '';
    let calledMethod = '';
    let calledBody = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledMethod = init?.method ?? 'GET';
      calledBody = typeof init?.body === 'string' ? init.body : '';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          updated: true,
          item: {
            attachmentItems: [
              {
                artifactId: 'artifact-1',
                id: 'att-1',
                name: '截图.png',
                sizeBytes: 3,
                type: 'image',
              },
            ],
            enqueuedAt: 1,
            id: 'item-1',
            requiresAttachmentRebind: false,
            text: '带附件',
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerQueueClient('http://localhost:3000');
    const item = await client.updateAttachments('token-1', 'session-1', 'item-1', {
      attachmentItems: [
        { artifactId: 'artifact-1', id: 'att-1', name: '截图.png', sizeBytes: 3, type: 'image' },
      ],
      requiresAttachmentRebind: false,
    });

    expect(calledUrl).toBe(
      'http://localhost:3000/sessions/session-1/composer-queue/item-1/attachments',
    );
    expect(calledMethod).toBe('PATCH');
    expect(JSON.parse(calledBody)).toMatchObject({
      attachmentItems: [{ artifactId: 'artifact-1', id: 'att-1' }],
      requiresAttachmentRebind: false,
    });
    expect(item?.attachmentItems[0]?.artifactId).toBe('artifact-1');
  });

  it('updateAttachments 在 404 时返回 null 而非抛错（条目已被消费 / 移出）', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: '目标待发条目不存在。' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerQueueClient('http://localhost:3000');
    const item = await client.updateAttachments('token-1', 'session-1', 'gone', {
      attachmentItems: [],
    });

    expect(item).toBeNull();
  });

  it('updateAttachments 的其它错误照常抛出（保留状态码文案）', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerQueueClient('http://localhost:3000');

    // 只 404 走「条目已消失」的 null 分支；500 必须抛出，否则调用方会把
    // 服务端故障误判成「条目已删除」并回收副本。
    await expect(
      client.updateAttachments('token-1', 'session-1', 'item-1', { attachmentItems: [] }),
    ).rejects.toThrow('回填待发队列附件引用失败');
  });
});
