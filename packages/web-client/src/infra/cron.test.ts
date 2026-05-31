import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCronClient } from './cron.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createCronClient', () => {
  it('list 成功时返回 jobs 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ jobs: [{ id: 'job-1', name: '每日同步', expression: '* * * * *', status: 'enabled' }] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCronClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result[0]?.id).toBe('job-1');
  });

  it('setEnabled 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'job cannot be disabled' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCronClient('http://localhost:3000');

    await expect(client.setEnabled('token-1', 'job-1', false)).rejects.toThrow(
      'job cannot be disabled',
    );
  });

  it('remove 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createCronClient('http://localhost:3000');

    await expect(client.remove('token-1', 'job-1')).rejects.toThrow(
      '网络异常，删除定时任务失败。',
    );
  });

  it('setEnabled 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createCronClient('http://localhost:3000');

    await expect(client.setEnabled('token-1', 'job-1', false)).rejects.toThrow(
      '请求体参数无效。',
    );
  });
});
