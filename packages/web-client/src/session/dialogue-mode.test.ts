import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDialogueModeClient } from './dialogue-mode.js';
import { HttpError } from './sessions.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createDialogueModeClient', () => {
  it('confirmClarifySwitch 成功后回传切换结果', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, switched: true, dialogueMode: 'coding' }),
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createDialogueModeClient('http://localhost:3000');
    const result = await client.confirmClarifySwitch('token-1', 'session-1');

    expect(result).toEqual({ switched: true, dialogueMode: 'coding' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/sessions/session-1/clarify/confirm');
    expect(init.method).toBe('POST');
  });

  it('幂等分支（switched=false）回传服务端当前模式', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, switched: false, dialogueMode: 'programmer' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createDialogueModeClient('http://localhost:3000');
    const result = await client.confirmClarifySwitch('token-1', 'session-1');

    expect(result).toEqual({ switched: false, dialogueMode: 'programmer' });
  });

  it('非法 dialogueMode 被过滤，switched 缺省为 false', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, switched: 'yes', dialogueMode: 'unsupported' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createDialogueModeClient('http://localhost:3000');
    await expect(client.confirmClarifySwitch('token-1', 'session-1')).resolves.toEqual({
      switched: false,
    });
  });

  it('失败时保留后端错误文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: '目标会话不存在。' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createDialogueModeClient('http://localhost:3000');

    await expect(client.confirmClarifySwitch('token-1', 'session-1')).rejects.toThrow(
      '目标会话不存在。',
    );
  });

  it('404 无文案时回落中文提示并保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createDialogueModeClient('http://localhost:3000');

    try {
      await client.confirmClarifySwitch('token-1', 'session-1');
      throw new Error('expected confirmClarifySwitch to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('目标会话不存在');
    }
  });

  it('网络异常转换为中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as unknown as typeof fetch;

    const client = createDialogueModeClient('http://localhost:3000');

    await expect(client.confirmClarifySwitch('token-1', 'session-1')).rejects.toThrow(
      '网络异常，确认切换到编程模式失败。',
    );
  });
});
