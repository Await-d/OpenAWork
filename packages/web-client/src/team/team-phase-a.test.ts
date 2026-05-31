import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createTeamPhaseAClient } from './team-phase-a.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createTeamPhaseAClient.listTeamArtifactsResult', () => {
  it('成功时返回 artifacts 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          artifacts: [{ id: 'artifact-1', content: 'spec', phase: 'spec', title: 'Spec' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');
    const result = await client.listTeamArtifactsResult('token-1', {
      phase: 'spec',
      sessionId: 'session-1',
    });

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      artifacts: [{ id: 'artifact-1', title: 'Spec' }],
    });
  });

  it('HTTP 错误时返回结构化失败信息', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'artifacts unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');
    const result = await client.listTeamArtifactsResult('token-1', {
      phase: 'spec',
      sessionId: 'session-1',
    });

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'artifacts unavailable',
      status: 503,
      artifacts: [],
    });
  });

  it('getConstitutionResult 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createTeamPhaseAClient('http://localhost:3000');
    const result = await client.getConstitutionResult('token-1', 'tw-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      errorMessage: '请求体参数无效。',
      status: 400,
    });
  });
});

describe('createTeamPhaseAClient recoverable readers', () => {
  it('getConstitutionResult 失败时返回结构化错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'constitution unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');
    const result = await client.getConstitutionResult('token-1', 'tw-1');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'constitution unavailable',
      status: 503,
    });
  });

  it('getUserMemoryResult 成功时返回 memory', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ body: 'memory body' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');
    const result = await client.getUserMemoryResult('token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      memory: { body: 'memory body' },
    });
  });

  it('getPersonaResult 网络异常时标记为可重试', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket reset');
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');
    const result = await client.getPersonaResult('token-1', 'reception');

    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      errorMessage: 'socket reset',
    });
  });
});

describe('createTeamPhaseAClient mutation error handling', () => {
  it('putConstitution 遇到 version conflict 时保留 HttpError 状态和 payload', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'version-conflict', currentVersion: 7 }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');

    try {
      await client.putConstitution('token-1', 'tw-1', {
        body: 'next constitution',
        expectedVersion: 6,
      });
      throw new Error('expected putConstitution to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError<{ currentVersion?: number }>).status).toBe(409);
      expect((error as HttpError<{ currentVersion?: number }>).data?.currentVersion).toBe(7);
      expect((error as Error).message).toContain('当前内容已发生变化');
    }
  });

  it('putUserMemory 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');

    await expect(client.putUserMemory('token-1', 'memory body')).rejects.toThrow(
      '网络异常，保存个人长期记忆失败。',
    );
  });

  it('forceApply 限流时会保留 HttpError payload', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: 'rate-limited',
          retryHintHours: 24,
          state: {
            usedInWindow: 5,
            maxInWindow: 5,
            lastAppliedAt: '2026-05-26T00:00:00.000Z',
          },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamPhaseAClient('http://localhost:3000');

    try {
      await client.forceApply('token-1');
      throw new Error('expected forceApply to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError<{ state?: { usedInWindow?: number } }>).status).toBe(429);
      expect(
        (error as HttpError<{ state?: { usedInWindow?: number } }>).data?.state?.usedInWindow,
      ).toBe(5);
      expect((error as Error).message).toContain('24 小时后重试');
    }
  });
});
