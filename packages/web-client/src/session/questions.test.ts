import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from './sessions.js';
import { createQuestionsClient } from './questions.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createQuestionsClient', () => {
  it('listPending 成功时返回 requests 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          requests: [
            {
              requestId: 'question-1',
              sessionId: 'session-1',
              title: '需要补充',
              toolName: 'AskFollowUpQuestion',
              status: 'pending',
              createdAt: '2026-05-26T00:00:00.000Z',
              questions: [],
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');
    const result = await client.listPending('token-1', 'session-1');

    expect(result[0]?.requestId).toBe('question-1');
  });

  it('reply 失败时会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'question already answered' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');

    await expect(
      client.reply('token-1', 'session-1', {
        requestId: 'question-1',
        status: 'dismissed',
      }),
    ).rejects.toThrow('question already answered');
  });

  it('listPending 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');

    await expect(client.listPending('token-1', 'session-1')).rejects.toThrow(
      '网络异常，读取待处理问题请求失败。',
    );
  });

  it('reply 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'question request not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');

    try {
      await client.reply('token-1', 'session-1', {
        requestId: 'question-1',
        status: 'dismissed',
      });
      throw new Error('expected reply to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('question request not found');
    }
  });

  it('reply 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '提问请求已处理，无法重复提交。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');

    await expect(
      client.reply('token-1', 'session-1', {
        requestId: 'question-1',
        status: 'dismissed',
      }),
    ).rejects.toThrow('提问请求已处理，无法重复提交。');
  });
});
