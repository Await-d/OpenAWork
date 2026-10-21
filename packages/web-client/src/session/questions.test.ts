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

  it('listPending 把工具入参的 multiSelect 归一化成 multiple', async () => {
    // 实测本地库里 `questions_json` 只有 question/header/options，多选标记来自工具
    // 入参的 `multiSelect`；字段名不匹配时前端会一律按单选处理——题干写着「可多选」，
    // 但勾第二个会把第一个顶掉，提交后只回显一项。
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          requests: [
            {
              createdAt: '2026-10-18T07:14:29.000Z',
              questions: [
                {
                  header: '清理范围',
                  multiSelect: true,
                  options: [{ label: '清空回收站', description: '最推荐' }],
                  question: '请选择要立即清理的项目（可多选）',
                },
                {
                  header: '回收站',
                  options: [{ label: '保留', description: '' }],
                  question: '回收站里的副本要删吗？',
                },
                {
                  header: '字符串布尔',
                  multiSelect: 'true',
                  options: [],
                  question: '兼容 JSON 里的字符串 true',
                },
              ],
              requestId: 'question-multi',
              sessionId: 'session-1',
              status: 'pending',
              title: '清理范围',
              toolName: 'AskUserQuestion',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');
    const result = await client.listPending('token-1', 'session-1');

    expect(result[0]?.questions[0]?.multiple).toBe(true);
    // 未声明多选的问题保持 undefined（调用方按 `=== true` 判定，等价于单选）。
    expect(result[0]?.questions[1]?.multiple).toBeUndefined();
    expect(result[0]?.questions[2]?.multiple).toBe(true);
  });

  it('listPending 同时兼容已经叫 multiple 的数据', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          requests: [
            {
              createdAt: '2026-10-18T07:14:29.000Z',
              questions: [{ header: 'H', multiple: false, options: [], question: 'Q' }],
              requestId: 'question-legacy',
              sessionId: 'session-1',
              status: 'pending',
              title: 'T',
              toolName: 'AskUserQuestion',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');
    const result = await client.listPending('token-1', 'session-1');

    expect(result[0]?.questions[0]?.multiple).toBe(false);
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

  it('reply 回传服务端自动切换后的 dialogueMode', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, dialogueMode: 'coding' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');
    const result = await client.reply('token-1', 'session-1', {
      requestId: 'question-1',
      status: 'answered',
      answers: [['确认']],
    });

    expect(result).toEqual({ dialogueMode: 'coding' });
  });

  it('reply 未自动切换时返回空结果，且忽略非法 dialogueMode', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, dialogueMode: 'unsupported' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createQuestionsClient('http://localhost:3000');
    const result = await client.reply('token-1', 'session-1', {
      requestId: 'question-1',
      status: 'dismissed',
    });

    expect(result).toEqual({});
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
