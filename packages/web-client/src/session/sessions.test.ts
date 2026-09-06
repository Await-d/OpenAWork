import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionsClient } from './sessions.js';
import { HttpError } from './sessions.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSessionsClient.getRecoveryResult', () => {
  it('getResult 成功时返回 session 详情', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          session: {
            id: 'session-1',
            metadata_json: '{"workingDirectory":"/workspace/demo"}',
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.getResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
    });
    expect(result.session?.id).toBe('session-1');
  });

  it('getResult 失败时返回结构化错误信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'session unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.getResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'session unavailable',
      status: 503,
    });
  });

  it('getResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.getResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '请求体参数无效。',
      status: 400,
    });
  });

  it('成功时返回 recovery 快照', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          recovery: {
            activeStream: null,
            children: [],
            pendingPermissions: [],
            pendingQuestions: [],
            ratings: [],
            session: {
              id: 'session-1',
              messages: [],
            },
            tasks: [],
            todoLanes: { main: [], temp: [] },
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.getRecoveryResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
    });
    expect(result.recovery?.session.id).toBe('session-1');
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'recovery unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.getRecoveryResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'recovery unavailable',
      status: 503,
    });
  });

  it('getRecovery 保留调用方取消请求的 AbortError 语义', async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('signal is aborted without reason')),
            { once: true },
          );
        }),
    ) as typeof fetch;
    const controller = new AbortController();
    const client = createSessionsClient('http://localhost:3000');

    const recoveryPromise = client.getRecovery('token-1', 'session-1', {
      signal: controller.signal,
    });
    controller.abort();

    await expect(recoveryPromise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('createSessionsClient mutation error handling', () => {
  it('list 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'sessions unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('sessions unavailable');
  });

  it('create 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    await expect(
      client.create('token-1', {
        title: '新会话',
      }),
    ).rejects.toThrow('网络异常，创建会话失败。');
  });

  it('replySharedSessionPermissionRequest 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '权限请求已处理，无法重复提交。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    await expect(
      client.replySharedSessionPermission('token-1', 'shared-1', {
        decision: 'reject',
        requestId: 'perm-1',
      }),
    ).rejects.toThrow('权限请求已处理，无法重复提交。');
  });

  it('delete 失败时会保留 HttpError 状态码与 payload', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'session has pending interaction',
          blockReason: 'pendingInteraction',
          sessionId: 'session-1',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    try {
      await client.delete('token-1', 'session-1');
      throw new Error('expected delete to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError<{ blockReason?: string }>).status).toBe(409);
      expect((error as HttpError<{ blockReason?: string }>).data?.blockReason).toBe(
        'pendingInteraction',
      );
      expect((error as Error).message).toContain('session has pending interaction');
    }
  });

  it('warpWorkspace 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'workspace is immutable without force',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    await expect(
      client.warpWorkspace('token-1', 'session-1', {
        workingDirectory: '/workspace/demo',
      }),
    ).rejects.toThrow('workspace is immutable without force');
  });
});
