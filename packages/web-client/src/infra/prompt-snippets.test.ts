import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createPromptSnippetsClient } from './prompt-snippets.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createPromptSnippetsClient', () => {
  it('listGroups 成功时返回 groups 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ groups: [{ id: 'group-1', name: '常用', userId: 'u', order: 0, createdAt: '', updatedAt: '' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPromptSnippetsClient('http://localhost:3000');
    const result = await client.listGroups('token-1');

    expect(result[0]?.id).toBe('group-1');
  });

  it('createSnippet 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'snippet title already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPromptSnippetsClient('http://localhost:3000');

    await expect(
      client.createSnippet('token-1', {
        groupId: 'group-1',
        title: '总结',
        content: '请总结',
      }),
    ).rejects.toThrow('snippet title already exists');
  });

  it('deleteGroup 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createPromptSnippetsClient('http://localhost:3000');

    await expect(client.deleteGroup('token-1', 'group-1')).rejects.toThrow(
      '网络异常，删除提示词分组失败。',
    );
  });

  it('deleteSnippet 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'snippet not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPromptSnippetsClient('http://localhost:3000');

    try {
      await client.deleteSnippet('token-1', 'snippet-1');
      throw new Error('expected deleteSnippet to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('snippet not found');
    }
  });

  it('createGroup 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createPromptSnippetsClient('http://localhost:3000');

    await expect(client.createGroup('token-1', { name: '分组' })).rejects.toThrow(
      '请求体参数无效。',
    );
  });
});
