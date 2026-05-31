import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTeamClient } from './team.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createTeamClient workspace result readers', () => {
  it('listWorkspacesResult 成功时返回工作区列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => [{ id: 'tw-1', name: 'Workspace A' }],
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.listWorkspacesResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      workspaces: [{ id: 'tw-1', name: 'Workspace A' }],
    });
  });

  it('getWorkspaceResult 失败时返回结构化错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'workspace unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getWorkspaceResult('token-1', 'tw-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'workspace unavailable',
      status: 503,
    });
  });

  it('getWorkspaceResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getWorkspaceResult('token-1', 'tw-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '请求体参数无效。',
      status: 400,
    });
  });

  it('getWorkspaceSnapshotResult 网络异常时标记为可重试', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket reset');
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getWorkspaceSnapshotResult('token-1', 'tw-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'socket reset',
    });
  });

  it('getWorkspaceSnapshotResult 在请求挂起时经墙钟超时落入可重试错误（不永久 pending）', async () => {
    vi.useFakeTimers();
    try {
      // 模拟半开连接：fetch 永不响应，但遵守 abort signal（fetchWithTimeout 注入）。
      globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      const client = createTeamClient('http://localhost:3000');
      const pending = client.getWorkspaceSnapshotResult('token-1', 'tw-1');
      // 推进过默认 20s 墙钟 → 触发 abort → catch 映射为可重试错误。
      await vi.advanceTimersByTimeAsync(20_001);
      const result = await pending;
      expect(result).toMatchObject({ ok: false, retryable: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('getRuntimeResult 遇到 Failed to fetch 时返回中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getRuntimeResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: '网络异常，加载团队运行时快照失败。',
    });
  });
});

describe('createTeamClient.getRuntimeResult', () => {
  it('成功时返回运行时快照', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          auditLogs: [],
          clarifications: [],
          handoffs: [],
          members: [],
          messages: [],
          notifications: [],
          runtimeTaskGroups: [],
          sessionShares: [],
          sessions: [],
          sharedSessions: [],
          tasks: [],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getRuntimeResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
    });
    expect(result.runtime?.sessions).toEqual([]);
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'runtime temporarily unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getRuntimeResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'runtime temporarily unavailable',
      status: 503,
    });
  });

  it('网络异常时标记为可重试', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket reset');
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getRuntimeResult('token-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'socket reset',
    });
  });
});

describe('createTeamClient runtime alert control actions', () => {
  it('acknowledge 会返回 control 和 runtime 摘要，并透传 workspace 查询参数', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({
          control: {
            alertCode: 'latency-violation',
            note: '已知问题',
            state: 'acknowledged',
            suppressedUntilMs: null,
            updatedAt: '2026-05-26T00:00:00.000Z',
          },
          runtime: {
            sessionCount: 2,
            teamWorkspaceId: 'tw-1',
            diagnostics: {
              activeAlerts: [],
              health: { reasons: [], status: 'healthy' },
            },
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.acknowledgeRuntimeAlert('token-1', 'latency-violation', {
      note: '已知问题',
      teamWorkspaceId: 'tw-1',
    });

    expect(calls).toEqual([
      'http://localhost:3000/team/runtime/alerts/latency-violation/acknowledge?teamWorkspaceId=tw-1',
    ]);
    expect(result.control?.state).toBe('acknowledged');
    expect(result.runtime?.teamWorkspaceId).toBe('tw-1');
  });
});

describe('createTeamClient mutation error handling', () => {
  it('createWorkspace 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'workspace already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');

    await expect(
      client.createWorkspace('token-1', {
        name: 'Workspace A',
      }),
    ).rejects.toThrow('workspace already exists');
  });

  it('createMember 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');

    await expect(
      client.createMember('token-1', {
        email: 'owner@example.com',
        name: 'Owner',
      }),
    ).rejects.toThrow('网络异常，创建团队成员失败。');
  });

  it('updateSessionState 在无 payload 的 403 下会给出权限文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');

    await expect(
      client.updateSessionState('token-1', 'session-1', {
        stateStatus: 'paused',
      }),
    ).rejects.toThrow('认证失效或当前账号无权更新会话状态。');
  });

  it('replySharedSessionPermission 会透传后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'permission reply unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');

    await expect(
      client.replySharedSessionPermission('token-1', 'shared-1', {
        decision: 'reject',
        requestId: 'perm-1',
      }),
    ).rejects.toThrow('permission reply unavailable');
  });
});

describe('createTeamClient shared session actions', () => {
  it('共享会话详情读取失败时返回结构化结果', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'shared detail unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getSharedSessionDetailResult('token-1', 'shared-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'shared detail unavailable',
      status: 503,
    });
  });

  it('共享会话在线状态读取失败时返回结构化结果', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'presence unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.touchSharedSessionPresenceResult('token-1', 'shared-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'presence unavailable',
      status: 503,
    });
  });

  it('共享评论会返回 comment 和 detail 预览', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          comment: {
            id: 'comment-1',
            sessionId: 'shared-1',
            content: 'hello',
            authorEmail: 'viewer@example.com',
            createdAt: '2026-05-26T00:00:00.000Z',
          },
          detail: {
            comments: [],
            pendingPermissions: [],
            pendingQuestions: [],
            presence: [],
            share: {
              sessionId: 'shared-1',
              title: 'shared',
              stateStatus: 'running',
              workspacePath: null,
              sharedByEmail: 'owner@example.com',
              permission: 'operate',
              createdAt: '2026-05-26T00:00:00.000Z',
              updatedAt: '2026-05-26T00:00:00.000Z',
              shareCreatedAt: '2026-05-26T00:00:00.000Z',
              shareUpdatedAt: '2026-05-26T00:00:00.000Z',
            },
            session: {
              id: 'shared-1',
            },
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.createSharedSessionComment('token-1', 'shared-1', {
      content: 'hello',
    });

    expect(result.comment.content).toBe('hello');
    expect(result.detail?.share.sessionId).toBe('shared-1');
  });

  it('共享权限回复会返回 detail 预览', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          detail: {
            comments: [],
            pendingPermissions: [],
            pendingQuestions: [],
            presence: [],
            share: {
              sessionId: 'shared-1',
              title: 'shared',
              stateStatus: 'running',
              workspacePath: null,
              sharedByEmail: 'owner@example.com',
              permission: 'operate',
              createdAt: '2026-05-26T00:00:00.000Z',
              updatedAt: '2026-05-26T00:00:00.000Z',
              shareCreatedAt: '2026-05-26T00:00:00.000Z',
              shareUpdatedAt: '2026-05-26T00:00:00.000Z',
            },
            session: {
              id: 'shared-1',
            },
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.replySharedSessionPermission('token-1', 'shared-1', {
      decision: 'reject',
      requestId: 'perm-1',
    });

    expect(result.ok).toBe(true);
    expect(result.detail?.pendingPermissions).toEqual([]);
  });
});

describe('createTeamClient 初始化（teamInit）方法', () => {
  it('getSessionInit 成功时返回 teamInit', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({ teamInit: { phase: 'proposed', projectKind: 'existing' } }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getSessionInit('token-1', 'session-1');

    expect(calls).toEqual(['http://localhost:3000/team/sessions/session-1/init']);
    expect(result.ok).toBe(true);
    expect(result.teamInit).toMatchObject({ phase: 'proposed', projectKind: 'existing' });
  });

  it('confirmSessionInitStep POST 到 confirm 端点并返回最新 teamInit', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: typeof input === 'string' ? input : input.toString(), method: init?.method });
      return {
        ok: true,
        json: async () => ({ teamInit: { phase: 'in_progress', projectKind: 'existing' } }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.confirmSessionInitStep('token-1', 'session-1', 'read-project-level1');

    expect(calls[0]?.url).toBe(
      'http://localhost:3000/team/sessions/session-1/init/steps/read-project-level1/confirm',
    );
    expect(calls[0]?.method).toBe('POST');
    expect(result.ok).toBe(true);
    expect(result.teamInit).toMatchObject({ phase: 'in_progress' });
  });

  it('confirmSessionInitStep 失败时携带后端 error 与 teamInit（失败态可展示）', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          code: 'team_init_step_failed',
          error: '初始化步骤执行失败。',
          teamInit: { phase: 'in_progress', projectKind: 'existing' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.confirmSessionInitStep('token-1', 'session-1', 'understand-architecture');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.errorMessage).toBe('初始化步骤执行失败。');
    expect(result.teamInit).toMatchObject({ phase: 'in_progress' });
  });

  it('skipSessionInit POST 到 skip 端点', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        json: async () => ({ teamInit: { phase: 'skipped', projectKind: 'existing' } }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.skipSessionInit('token-1', 'session-1');

    expect(calls).toEqual(['http://localhost:3000/team/sessions/session-1/init/skip']);
    expect(result.teamInit).toMatchObject({ phase: 'skipped' });
  });

  it('网络异常时返回 ok=false + 错误文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket reset');
    }) as typeof fetch;

    const client = createTeamClient('http://localhost:3000');
    const result = await client.getSessionInit('token-1', 'session-1');

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe('socket reset');
  });
});
