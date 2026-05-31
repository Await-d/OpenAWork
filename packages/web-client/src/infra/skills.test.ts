import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createSkillsClient } from './skills.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSkillsClient', () => {
  it('search 成功时返回结果', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ items: [{ id: 'skill-1' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSkillsClient('http://localhost:3000');
    const result = (await client.search('token-1', { q: 'git' })) as { items?: Array<{ id: string }> };

    expect(result.items?.[0]?.id).toBe('skill-1');
  });

  it('getSelection 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createSkillsClient('http://localhost:3000');

    await expect(client.getSelection('token-1')).rejects.toThrow('查询参数无效。');
  });

  it('installLocal 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSkillsClient('http://localhost:3000');

    await expect(client.installLocal('token-1', '/tmp/skill')).rejects.toThrow(
      '网络异常，安装本地技能失败。',
    );
  });

  it('applyRecommendation 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'recommendation not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSkillsClient('http://localhost:3000');

    try {
      await client.applyRecommendation('token-1', 'rec-1');
      throw new Error('expected applyRecommendation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('recommendation not found');
    }
  });
});
