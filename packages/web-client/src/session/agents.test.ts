import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentsClient } from './agents.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createAgentsClient.listResult', () => {
  it('成功时返回 agents 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          agents: [
            {
              id: 'agent-1',
              label: 'Planner',
              description: '规划代理',
              aliases: [],
              origin: 'builtin',
              source: 'builtin',
              enabled: true,
              removable: false,
              resettable: true,
              hasOverrides: false,
              createdAt: '2026-05-26T00:00:00.000Z',
              updatedAt: '2026-05-26T00:00:00.000Z',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createAgentsClient('http://localhost:3000');
    const result = await client.listResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      agents: [{ id: 'agent-1', label: 'Planner' }],
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'agents unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createAgentsClient('http://localhost:3000');
    const result = await client.listResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'agents unavailable',
      status: 503,
      agents: [],
    });
  });

  it('listResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createAgentsClient('http://localhost:3000');
    const result = await client.listResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '请求体参数无效。',
      status: 400,
      agents: [],
    });
  });
});

describe('createAgentsClient mutation error handling', () => {
  it('create 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'agent label already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createAgentsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        aliases: [],
        description: '规划代理',
        label: 'Planner',
        systemPrompt: 'You are planner',
      }),
    ).rejects.toThrow('agent label already exists');
  });

  it('update 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createAgentsClient('http://localhost:3000');

    await expect(
      client.update('token-1', 'agent-1', {
        enabled: false,
      }),
    ).rejects.toThrow('网络异常，更新 Agent失败。');
  });

  it('remove 403 时会给出权限错误文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createAgentsClient('http://localhost:3000');

    await expect(client.remove('token-1', 'agent-1')).rejects.toThrow(
      '认证失效或当前账号无权删除 Agent。',
    );
  });

  it('resetAll 在 404 时会给出明确文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createAgentsClient('http://localhost:3000');

    await expect(client.resetAll('token-1')).rejects.toThrow('not found');
  });
});
