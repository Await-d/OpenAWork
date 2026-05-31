import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from './sessions.js';
import { createCommandsClient } from './commands.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createCommandsClient', () => {
  it('list 成功时返回 commands 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          commands: [
            {
              id: 'summarize',
              label: '总结',
              description: '总结当前上下文',
              contexts: ['composer'],
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCommandsClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result[0]?.id).toBe('summarize');
  });

  it('list 失败时会抛出后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: 'commands unavailable' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCommandsClient('http://localhost:3000');

    await expect(client.list('token-1')).rejects.toThrow('commands unavailable');
  });

  it('execute 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createCommandsClient('http://localhost:3000');

    await expect(client.execute('token-1', 'session-1', 'summarize')).rejects.toThrow(
      '网络异常，执行命令失败。',
    );
  });

  it('execute 在 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'command not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCommandsClient('http://localhost:3000');

    try {
      await client.execute('token-1', 'session-1', 'summarize');
      throw new Error('expected execute to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('command not found');
    }
  });

  it('execute 会读取 ApiErrorResponse.data.message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          name: 'BadRequest',
          data: { message: '不支持的命令。', kind: 'Body' },
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createCommandsClient('http://localhost:3000');

    await expect(client.execute('token-1', 'session-1', 'summarize')).rejects.toThrow(
      '不支持的命令。',
    );
  });
});
