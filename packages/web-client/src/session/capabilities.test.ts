import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapabilitiesClient } from './capabilities.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createCapabilitiesClient', () => {
  it('appends sessionId when provided', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({ capabilities: [] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCapabilitiesClient('http://localhost:3000');
    await client.list('token-123', 'session-abc');

    expect(calls).toEqual(['http://localhost:3000/capabilities?sessionId=session-abc']);
  });

  it('omits sessionId when not provided', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({ capabilities: [] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCapabilitiesClient('http://localhost:3000');
    await client.list('token-123');

    expect(calls).toEqual(['http://localhost:3000/capabilities']);
  });

  it('listResult 在 HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'capabilities unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCapabilitiesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'capabilities unavailable',
      status: 503,
      capabilities: [],
    });
  });

  it('listResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createCapabilitiesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '查询参数无效。',
      status: 400,
      capabilities: [],
    });
  });

  it('listResult 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createCapabilitiesClient('http://localhost:3000');
    const result = await client.listResult('token-123');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: '网络异常，加载能力列表失败。',
      capabilities: [],
    });
  });
});
