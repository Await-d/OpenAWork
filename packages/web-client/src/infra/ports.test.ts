import { afterEach, describe, expect, it, vi } from 'vitest';

import { createListeningPortsClient } from './ports.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createListeningPortsClient', () => {
  it('list 请求 /sessions/ports/listening 并透传快照', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:3000/sessions/ports/listening');
      expect((init?.headers as Record<string, string> | undefined)?.['Authorization']).toBe(
        'Bearer token-1',
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ports: [
            {
              port: 34567,
              protocol: 'tcp',
              bindAddress: '127.0.0.1',
              pid: 4321,
              processName: 'node',
              source: 'procfs',
            },
          ],
          strategy: 'procfs',
          collectedAtMs: 1_700_000_000_000,
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createListeningPortsClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result.strategy).toBe('procfs');
    expect(result.ports[0]).toMatchObject({ port: 34567, bindAddress: '127.0.0.1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('降级快照（strategy null + reason）按正常结果返回，不当作错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ports: [],
          strategy: null,
          reason: '当前平台 aix 暂无端口枚举策略。',
          collectedAtMs: 1,
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createListeningPortsClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result.strategy).toBeNull();
    expect(result.reason).toContain('aix');
  });

  it('401 时给出中文认证文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: 'unauthorized' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createListeningPortsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('认证失效或当前账号无权读取监听端口。');
  });

  it('404 时提示网关不支持该接口', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createListeningPortsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('目标网关不支持端口枚举接口');
  });

  it('网络异常时转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createListeningPortsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('网络异常，读取监听端口失败。');
  });
});
