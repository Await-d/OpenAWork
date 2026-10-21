import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPOSER_INPUT_HISTORY_MAX_ENTRIES,
  COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH,
  createComposerInputHistoryClient,
} from './composer-input-history.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createComposerInputHistoryClient', () => {
  it('list 走 GET、带认证头，并过滤非字符串脏数据', async () => {
    let calledUrl = '';
    let calledMethod = '';
    let calledAuth = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledMethod = init?.method ?? 'GET';
      calledAuth = (init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: ['历史一', 42, '历史二'] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerInputHistoryClient('http://localhost:3000');
    const entries = await client.list('token-1', 'session/1');

    expect(entries).toEqual(['历史一', '历史二']);
    expect(calledUrl).toBe('http://localhost:3000/sessions/session%2F1/composer-input-history');
    expect(calledMethod).toBe('GET');
    expect(calledAuth).toBe('Bearer token-1');
  });

  it('append 走 POST 并返回服务端全量列表', async () => {
    let calledUrl = '';
    let calledMethod = '';
    let calledBody = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      calledMethod = init?.method ?? 'GET';
      calledBody = typeof init?.body === 'string' ? init.body : '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: ['旧', '新'] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerInputHistoryClient('http://localhost:3000');
    const entries = await client.append('token-1', 'session-1', ['新']);

    expect(calledUrl).toBe('http://localhost:3000/sessions/session-1/composer-input-history');
    expect(calledMethod).toBe('POST');
    expect(JSON.parse(calledBody)).toEqual({ entries: ['新'] });
    expect(entries).toEqual(['旧', '新']);
  });

  it('单条超长文本按服务端上限截断后再提交', async () => {
    let calledBody = '';
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledBody = typeof init?.body === 'string' ? init.body : '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: [] }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerInputHistoryClient('http://localhost:3000');
    await client.append('token-1', 'session-1', [
      'x'.repeat(COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH + 10),
    ]);

    const parsed = JSON.parse(calledBody) as { entries: string[] };
    expect(parsed.entries[0]).toHaveLength(COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH);
  });

  it('批量追加超过上限时只提交最后五十条', async () => {
    let calledBody = '';
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledBody = typeof init?.body === 'string' ? init.body : '';
      return {
        ok: true,
        status: 200,
        json: async () => ({ entries: [] }),
      } as unknown as Response;
    }) as typeof fetch;

    const entries = Array.from(
      { length: COMPOSER_INPUT_HISTORY_MAX_ENTRIES + 5 },
      (_, index) => `entry-${index + 1}`,
    );
    const client = createComposerInputHistoryClient('http://localhost:3000');
    await client.append('token-1', 'session-1', entries);

    const parsed = JSON.parse(calledBody) as { entries: string[] };
    expect(parsed.entries).toHaveLength(COMPOSER_INPUT_HISTORY_MAX_ENTRIES);
    expect(parsed.entries[0]).toBe('entry-6');
  });

  it('响应缺少 entries 数组时抛错，避免调用方误以为服务端确认「没有历史」', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerInputHistoryClient('http://localhost:3000');

    await expect(client.list('token-1', 'session-1')).rejects.toThrow(
      '读取输入历史失败：网关未返回可识别的历史列表。',
    );
  });

  it('404 时抛出可读错误，交给调用方按「水合失败」降级', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => null,
      } as unknown as Response;
    }) as typeof fetch;

    const client = createComposerInputHistoryClient('http://localhost:3000');

    await expect(client.list('token-1', 'missing-session')).rejects.toThrow(
      '目标会话不存在，无法读取输入历史。',
    );
  });
});
