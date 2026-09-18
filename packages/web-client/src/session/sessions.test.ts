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

describe('createSessionsClient.truncateMessages 回执解析', () => {
  function stubTruncateResponse(rollback: unknown): void {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ messages: [], rollback }),
      } as unknown as Response;
    }) as typeof fetch;
  }

  it('透传 applied === false 的空操作标记', async () => {
    stubTruncateResponse({
      sessionId: 'session-1',
      cutoffMessageId: 'msg-1',
      cutoffTimeMs: 1_000,
      tombstoneAtMs: 2_000,
      removedMessageIds: [],
      invalidatedClientRequestIds: [],
      affectedSessionIds: ['session-1'],
      applied: false,
    });

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.truncateMessages('token-1', 'session-1', 'msg-1');

    expect(result.rollback?.applied).toBe(false);
  });

  it('旧网关缺少 applied 字段时保持 undefined，而不是伪造布尔值', async () => {
    stubTruncateResponse({
      sessionId: 'session-1',
      cutoffMessageId: 'msg-1',
      cutoffTimeMs: 1_000,
      tombstoneAtMs: 2_000,
      removedMessageIds: ['msg-1'],
      invalidatedClientRequestIds: [],
      affectedSessionIds: ['session-1'],
    });

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.truncateMessages('token-1', 'session-1', 'msg-1');

    expect(result.rollback).not.toBeNull();
    expect(result.rollback && 'applied' in result.rollback).toBe(false);
  });

  it('applied === true 的真实回执透传为 true', async () => {
    stubTruncateResponse({
      sessionId: 'session-1',
      cutoffMessageId: 'msg-1',
      cutoffTimeMs: 1_000,
      tombstoneAtMs: 2_000,
      removedMessageIds: ['msg-1'],
      invalidatedClientRequestIds: ['req-1'],
      affectedSessionIds: ['session-1'],
      applied: true,
    });

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.truncateMessages('token-1', 'session-1', 'msg-1');

    expect(result.rollback?.applied).toBe(true);
  });
});

describe('createSessionsClient reviewFileChange', () => {
  it('reviewFileChange 使用 POST 提交审查决定并返回结果', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          decision: {
            requestId: 'req-1',
            filePath: 'src/index.ts',
            decision: 'accepted',
            createdAt: '2026-09-17T00:00:00.000Z',
          },
          revertClientRequestId: 'revert-1',
        }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');
    const result = await client.reviewFileChange('token-1', 'session-1', {
      requestId: 'req-1',
      filePath: 'src/index.ts',
      decision: 'accepted',
      forceConflicts: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/sessions/session-1/file-changes/review');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-1',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      requestId: 'req-1',
      filePath: 'src/index.ts',
      decision: 'accepted',
      forceConflicts: true,
    });
    expect(result).toMatchObject({
      decision: {
        requestId: 'req-1',
        filePath: 'src/index.ts',
        decision: 'accepted',
        createdAt: '2026-09-17T00:00:00.000Z',
      },
      revertClientRequestId: 'revert-1',
    });
  });

  it('reviewFileChange 拒绝时抛出带状态与 payload 的 HttpError', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: '无法提交审查决定' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    try {
      await client.reviewFileChange('token-1', 'session-1', {
        requestId: 'req-1',
        filePath: 'src/index.ts',
        decision: 'rejected',
      });
      throw new Error('expected reviewFileChange to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError<{ error?: string }>).status).toBe(400);
      expect((error as HttpError<{ error?: string }>).data?.error).toBe('无法提交审查决定');
      expect((error as Error).message).toContain('无法提交审查决定');
    }
  });

  it('reviewFileChange 冲突时 409 preview payload 可通过 HttpError.data 读取', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          name: 'Conflict',
          data: {
            message: '工作区存在冲突，需要确认。',
            kind: 'WorkspaceConflict',
            preview: {
              conflicts: [{ filePath: 'src/index.ts' }],
              dirtyCount: 1,
            },
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionsClient('http://localhost:3000');

    try {
      await client.reviewFileChange('token-1', 'session-1', {
        requestId: 'req-1',
        filePath: 'src/index.ts',
        decision: 'accepted',
      });
      throw new Error('expected reviewFileChange to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError<{
        data?: { preview?: { conflicts?: { filePath?: string }[]; dirtyCount?: number } };
      }>;
      expect(httpError.status).toBe(409);
      expect(httpError.data?.data?.preview?.dirtyCount).toBe(1);
      expect(httpError.data?.data?.preview?.conflicts?.[0]?.filePath).toBe('src/index.ts');
    }
  });
});
