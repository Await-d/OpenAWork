import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTeamHandoffsClient } from './team-handoffs.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createTeamHandoffsClient.listHandoffsBySessionResult', () => {
  it('成功时返回 handoff 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          handoffs: [{ id: 'handoff-1', state: 'running' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.listHandoffsBySessionResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      handoffs: [{ id: 'handoff-1', state: 'running' }],
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'gateway unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.listHandoffsBySessionResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'gateway unavailable',
      status: 503,
      handoffs: [],
    });
  });

  it('listHandoffsBySessionResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.listHandoffsBySessionResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '查询参数无效。',
      status: 400,
      handoffs: [],
    });
  });

  it('网络异常时标记为可重试', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.listHandoffsBySessionResult('token-1', 'session-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'socket hang up',
      handoffs: [],
    });
  });
});

describe('createTeamHandoffsClient.runReviewAction', () => {
  it('成功时返回 handoff preview', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          action: 'redispatch',
          handoffId: 'handoff-1',
          handoffs: [{ id: 'handoff-1', state: 'pending', retryCount: 3 }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.runReviewAction('token-1', 'handoff-1', 'redispatch');

    expect(result).toMatchObject({
      action: 'redispatch',
      handoffId: 'handoff-1',
      handoffs: [{ id: 'handoff-1', state: 'pending', retryCount: 3 }],
      ok: true,
      retryable: false,
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'cannot-redispatch' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.runReviewAction('token-1', 'handoff-1', 'redispatch');

    expect(result).toMatchObject({
      action: 'redispatch',
      handoffId: 'handoff-1',
      handoffs: [],
      ok: false,
      retryable: false,
      errorMessage: '当前 handoff 无法重派，可能已被其他流程接管。',
      status: 409,
    });
  });

  it('网络异常时标记为可重试', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.runReviewAction('token-1', 'handoff-1', 'redispatch');

    expect(result).toMatchObject({
      action: 'redispatch',
      handoffId: 'handoff-1',
      handoffs: [],
      ok: false,
      retryable: true,
      errorMessage: 'socket hang up',
    });
  });
});

describe('createTeamHandoffsClient.handoff controls', () => {
  it('cancelHandoff 成功时返回 handoff 快照', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          handoff: { id: 'handoff-1', state: 'cancelled', paused: false },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.cancelHandoff('token-1', 'handoff-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      handoff: { id: 'handoff-1', state: 'cancelled', paused: false },
    });
  });

  it('pauseHandoff 在 409 时保留状态并给出中文文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          code: 'team_handoff_cannot_pause',
          error: '当前状态不允许暂停该 handoff。',
          state: 'pending',
          paused: true,
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.pauseHandoff('token-1', 'handoff-1', { reason: 'manual' });

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      status: 409,
      state: 'pending',
      paused: true,
      errorMessage: '当前状态不允许暂停该 handoff。',
    });
  });

  it('resumeHandoff 在网络异常时返回中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createTeamHandoffsClient('http://localhost:3000');
    const result = await client.resumeHandoff('token-1', 'handoff-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: '网络异常，恢复派发任务失败。',
    });
  });
});
