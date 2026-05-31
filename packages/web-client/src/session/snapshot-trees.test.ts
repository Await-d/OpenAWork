import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createSnapshotTreesClient } from './snapshot-trees.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSnapshotTreesClient', () => {
  it('list 成功时返回 trees 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ trees: [{ treeHash: 'tree-1' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSnapshotTreesClient('http://localhost:3000');
    const result = await client.list('token-1', 'session-1');

    expect(result.trees[0]?.treeHash).toBe('tree-1');
  });

  it('detail 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'snapshot tree not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSnapshotTreesClient('http://localhost:3000');

    await expect(client.detail('token-1', 'session-1', 'tree-1')).rejects.toThrow(
      'snapshot tree not found',
    );
  });

  it('restoreToTree 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSnapshotTreesClient('http://localhost:3000');

    await expect(
      client.restoreToTree('token-1', 'session-1', {
        treeHash: 'tree-1',
        mode: 'preview',
      }),
    ).rejects.toThrow('网络异常，恢复到指定快照树失败。');
  });

  it('restoreFromSession 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'source snapshot tree not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSnapshotTreesClient('http://localhost:3000');

    try {
      await client.restoreFromSession('token-1', 'session-1', {
        sourceSessionId: 'session-2',
        treeHash: 'tree-2',
        mode: 'apply',
      });
      throw new Error('expected restoreFromSession to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('source snapshot tree not found');
    }
  });

  it('detail 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '查询参数无效。', kind: 'Query' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSnapshotTreesClient('http://localhost:3000');

    await expect(client.detail('token-1', 'session-1', 'tree-1')).rejects.toThrow('查询参数无效。');
  });
});
