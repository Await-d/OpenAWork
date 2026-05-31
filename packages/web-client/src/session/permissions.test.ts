import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from './sessions.js';
import { createPermissionsClient } from './permissions.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createPermissionsClient', () => {
  it('listPending 成功时返回 requests 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          requests: [
            {
              requestId: 'perm-1',
              sessionId: 'session-1',
              toolName: 'bash',
              scope: 'ls -la',
              reason: 'inspect repo',
              riskLevel: 'low',
              status: 'pending',
              createdAt: '2026-05-26T00:00:00.000Z',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPermissionsClient('http://localhost:3000');
    const result = await client.listPending('token-1', 'session-1');

    expect(result[0]?.requestId).toBe('perm-1');
  });

  it('createRequest 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'permission request already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPermissionsClient('http://localhost:3000');

    await expect(
      client.createRequest('token-1', 'session-1', {
        toolName: 'bash',
        scope: 'ls -la',
        reason: 'inspect repo',
        riskLevel: 'low',
      }),
    ).rejects.toThrow('permission request already exists');
  });

  it('reply 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createPermissionsClient('http://localhost:3000');

    await expect(
      client.reply('token-1', 'session-1', {
        requestId: 'perm-1',
        decision: 'reject',
      }),
    ).rejects.toThrow('网络异常，回复权限请求失败。');
  });

  it('listPending 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'permission request not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPermissionsClient('http://localhost:3000');

    try {
      await client.listPending('token-1', 'session-1');
      throw new Error('expected listPending to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('permission request not found');
    }
  });

  it('reply 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '权限请求已处理，无法重复提交。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createPermissionsClient('http://localhost:3000');

    await expect(
      client.reply('token-1', 'session-1', {
        requestId: 'perm-1',
        decision: 'reject',
      }),
    ).rejects.toThrow('权限请求已处理，无法重复提交。');
  });
});
