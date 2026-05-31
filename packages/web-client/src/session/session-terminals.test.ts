import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createSessionTerminalsClient } from './session-terminals.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createSessionTerminalsClient', () => {
  it('list 成功时返回 terminals 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          terminals: [
            {
              terminalId: 'term-1',
              sessionId: 'session-1',
              toolName: 'bash',
              kind: 'foreground',
              command: 'echo hi',
              cwd: '/workspace/demo',
              status: 'running',
              startedAtMs: 1,
              lastActivityMs: 1,
              outputBytesTotal: 0,
              outputTail: '',
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');
    const result = await client.list('token-1', 'session-1');

    expect(result.terminals[0]?.terminalId).toBe('term-1');
  });

  it('list 在 session_not_found 时给出中文文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'session_not_found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.list('token-1', 'session-1')).rejects.toThrow(
      '目标会话不存在，无法读取终端列表。',
    );
  });

  it('remove 在 terminal_running 时保留冲突语义', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'terminal_running',
          message: 'Kill the terminal before deleting the record.',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.remove('token-1', 'session-1', 'term-1')).rejects.toThrow(
      '终端仍在运行，请先终止后再清理。',
    );
  });

  it('writeStdin 在 terminal_not_persistent 时返回明确错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'terminal_not_persistent',
          message: '该终端是 agent 的一次性命令，不支持继续输入。',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(
      client.writeStdin('token-1', 'session-1', 'term-1', { data: 'ls\n' }),
    ).rejects.toThrow('该终端是一次性命令，不支持继续输入。');
  });

  it('create 在 spawn_failed 时保留后端 message', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: 'spawn_failed',
          message: 'pty binary missing',
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.create('token-1', 'session-1')).rejects.toThrow(
      '创建终端失败：pty binary missing',
    );
  });

  it('rename 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(
      client.rename('token-1', 'session-1', 'term-1', { name: 'build logs' }),
    ).rejects.toThrow('网络异常，重命名终端失败。');
  });

  it('kill 失败时会抛 HttpError 并保留状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'terminal_not_found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createSessionTerminalsClient('http://localhost:3000');

    try {
      await client.kill('token-1', 'session-1', 'term-1');
      throw new Error('expected kill to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('目标终端不存在');
    }
  });

  it('create 会读取 ApiErrorResponse.data.message', async () => {
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

    const client = createSessionTerminalsClient('http://localhost:3000');

    await expect(client.create('token-1', 'session-1')).rejects.toThrow('请求体参数无效。');
  });
});
