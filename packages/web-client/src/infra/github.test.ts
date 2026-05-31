import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createGitHubClient } from './github.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createGitHubClient', () => {
  it('listTriggers 成功时返回 triggers 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          triggers: [{ repo: 'owner/repo', events: ['push'] }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createGitHubClient('http://localhost:3000');
    const result = await client.listTriggers('token-1');

    expect(result[0]?.repo).toBe('owner/repo');
  });

  it('createTrigger 会优先保留后端 message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ message: 'trigger already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createGitHubClient('http://localhost:3000');

    await expect(
      client.createTrigger('token-1', {
        repoFullNameOwnerSlashRepo: 'owner/repo',
        events: ['push'],
      }),
    ).rejects.toThrow('trigger already exists');
  });

  it('listTriggers 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createGitHubClient('http://localhost:3000');

    await expect(client.listTriggers('token-1')).rejects.toThrow(
      '网络异常，读取 GitHub 触发器失败。',
    );
  });

  it('createTrigger 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'repository not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createGitHubClient('http://localhost:3000');

    try {
      await client.createTrigger('token-1', {
        repoFullNameOwnerSlashRepo: 'owner/repo',
        events: ['push'],
      });
      throw new Error('expected createTrigger to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('repository not found');
    }
  });

  it('createTrigger 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createGitHubClient('http://localhost:3000');

    await expect(
      client.createTrigger('token-1', {
        repoFullNameOwnerSlashRepo: 'owner/repo',
        events: ['push'],
      }),
    ).rejects.toThrow('请求体参数无效。');
  });
});
