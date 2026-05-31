import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createTeamInboundClient } from './team-inbound.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createTeamInboundClient', () => {
  it('submit 成功时返回 messageId 和 createdAt', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          messageId: 'inbound-1',
          createdAt: '2026-05-26T00:00:00.000Z',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamInboundClient('http://localhost:3000');
    const result = await client.submit('token-1', 'session-1', {
      messageType: 'user_input',
      payload: { text: '继续执行' },
    });

    expect(result.messageId).toBe('inbound-1');
  });

  it('submit 失败时会保留后端 error 文案和状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'inbound window expired' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createTeamInboundClient('http://localhost:3000');

    try {
      await client.submit('token-1', 'session-1', {
        messageType: 'user_input',
        payload: { text: '继续执行' },
      });
      throw new Error('expected submit to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
      expect((error as Error).message).toContain('inbound window expired');
    }
  });

  it('dismissClarification 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createTeamInboundClient('http://localhost:3000');

    await expect(
      client.dismissClarification('token-1', 'session-1', 'question-1'),
    ).rejects.toThrow('网络异常，忽略澄清问题失败。');
  });

  it('submit 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createTeamInboundClient('http://localhost:3000');

    await expect(
      client.submit('token-1', 'session-1', {
        messageType: 'user_input',
        payload: { text: '继续执行' },
      }),
    ).rejects.toThrow('请求体参数无效。');
  });
  it('submit 在请求挂起时经墙钟超时被 abort 而非永久 pending', async () => {
    vi.useFakeTimers();
    try {
      // 半开连接：fetch 永不响应但遵守 fetchWithTimeout 注入的 abort signal。
      globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }) as unknown as typeof fetch;

      const client = createTeamInboundClient('http://localhost:3000');
      // 关键性质（§0.141）：请求不再永久挂起——墙钟到点后 reject；
      // 且 abort 错误经 isGenericFetchErrorMessage 收敛为中文网络文案（§0.141 UX 收尾）。
      const settled = client
        .submit('token-1', 'session-1', {
          messageType: 'user_input',
          payload: { text: '继续执行' },
        })
        .then(
          () => 'resolved',
          (err: unknown) => (err instanceof Error ? err.message : String(err)),
        );
      // 推进过默认 20s 墙钟 → fetchWithTimeout abort → submit reject。
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await settled).toBe('网络异常，提交团队反向消息失败。');
    } finally {
      vi.useRealTimers();
    }
  });
});
