import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createArtifactsClient } from './artifacts.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createArtifactsClient', () => {
  it('listForSession 成功时返回 contentArtifacts', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          contentArtifacts: [{ id: 'artifact-1', title: 'Spec' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');
    const result = await client.listForSession('token-1', 'session-1');

    expect(result.contentArtifacts?.[0]).toMatchObject({ id: 'artifact-1' });
  });

  it('create 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'artifact title already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        sessionId: 'session-1',
        title: 'Spec',
        content: 'content',
        type: 'markdown',
      }),
    ).rejects.toThrow('artifact title already exists');
  });

  it('listImageWorkbench 在 403 时会给出权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(client.listImageWorkbench('token-1')).rejects.toThrow(
      '认证失效或当前账号无权读取图片工作台产物列表。',
    );
  });

  it('generateImage 会优先使用嵌套 error.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: { message: 'model backend unavailable' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    try {
      await client.generateImage('token-1', 'session-1', {
        prompt: 'draw a nebula',
        size: '1024x1024',
      });
      throw new Error('expected generateImage to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as Error).message).toContain('model backend unavailable');
    }
  });

  it('update 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.update('token-1', 'artifact-1', {
        title: 'Spec',
        content: 'next',
      }),
    ).rejects.toThrow('网络异常，更新产物失败。');
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

    const client = createArtifactsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        sessionId: 'session-1',
        title: 'Spec',
        content: 'content',
        type: 'markdown',
      }),
    ).rejects.toThrow('请求体参数无效。');
  });
});
