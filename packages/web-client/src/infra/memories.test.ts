import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createMemoriesClient } from './memories.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createMemoriesClient', () => {
  it('list 成功时返回记忆列表载荷', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ items: [{ id: 'memory-1' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');
    const result = (await client.list('token-1')) as { items?: Array<{ id: string }> };

    expect(result.items?.[0]?.id).toBe('memory-1');
  });

  it('create 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'memory already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.create('token-1', { body: 'memory' })).rejects.toThrow(
      'memory already exists',
    );
  });

  it('remove 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.remove('token-1', 'memory-1')).rejects.toThrow(
      '网络异常，删除记忆失败。',
    );
  });

  it('getSettings 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'memory settings not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    try {
      await client.getSettings('token-1');
      throw new Error('expected getSettings to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('memory settings not found');
    }
  });

  it('create 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createMemoriesClient('http://localhost:3000');

    await expect(client.create('token-1', { body: 'memory' })).rejects.toThrow(
      '请求体参数无效。',
    );
  });
});
