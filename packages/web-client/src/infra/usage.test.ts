import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createUsageClient } from './usage.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createUsageClient', () => {
  it('getRecords 成功时返回 records', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          records: [{ month: '2026-05', totalCostUsd: 1 }],
          budgetUsd: 20,
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createUsageClient('http://localhost:3000');
    const result = await client.getRecords('token-1');

    expect(result.records[0]?.month).toBe('2026-05');
  });

  it('getBreakdown 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createUsageClient('http://localhost:3000');

    await expect(client.getBreakdown('token-1')).rejects.toThrow('查询参数无效。');
  });

  it('getRecords 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createUsageClient('http://localhost:3000');

    await expect(client.getRecords('token-1')).rejects.toThrow('网络异常，读取用量记录失败。');
  });

  it('getBreakdown 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'usage breakdown not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createUsageClient('http://localhost:3000');

    try {
      await client.getBreakdown('token-1');
      throw new Error('expected getBreakdown to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('usage breakdown not found');
    }
  });
});
