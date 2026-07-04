import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../gateway/http.js';
import { createChannelsClient } from './channels.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('createChannelsClient', () => {
  it('list 成功时返回 channels 列表', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          channels: [{ id: 'channel-1', name: 'Telegram' }],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createChannelsClient('http://localhost:3000');
    const result = await client.list('token-1');

    expect(result[0]).toMatchObject({ id: 'channel-1' });
  });

  it('create 会保留后端 error 文案', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'channel already exists' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createChannelsClient('http://localhost:3000');

    await expect(client.create('token-1', { type: 'telegram' })).rejects.toThrow(
      'channel already exists',
    );
  });

  it('start 网络异常时会转换成中文网络错误', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Failed to fetch');
    }) as typeof fetch;

    const client = createChannelsClient('http://localhost:3000');

    await expect(client.start('token-1', 'channel-1')).rejects.toThrow(
      '网络异常，启动消息渠道失败。',
    );
  });

  it('listTargets 404 时会保留 HttpError 状态码', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'channel not found' }),
      } as unknown as Response;
    }) as typeof fetch;

    const client = createChannelsClient('http://localhost:3000');

    try {
      await client.listTargets('token-1', 'channel-1');
      throw new Error('expected listTargets to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
      expect((error as Error).message).toContain('channel not found');
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

    const client = createChannelsClient('http://localhost:3000');

    await expect(client.create('token-1', { type: 'telegram' })).rejects.toThrow(
      '请求体参数无效。',
    );
  });

  it('listConversations 会请求渠道对话历史并返回摘要', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:3000/channels/channel-1/conversations?limit=50&offset=10',
      );
      return new Response(
        JSON.stringify({
          conversations: [
            {
              id: 'session-channel-1',
              chatId: 'chat-1',
              chatName: '工程群',
              title: 'channel:channel-1:chat:chat-1',
              stateStatus: 'idle',
              messageCount: 2,
              lastMessagePreview: '已整理最近的渠道对话。',
              createdAt: '2026-07-04 10:01:00',
              updatedAt: '2026-07-04 10:02:00',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    globalThis.fetch = fetchMock;

    const client = createChannelsClient('http://localhost:3000');
    const result = await client.listConversations('token-1', 'channel-1', {
      limit: 50,
      offset: 10,
    });

    const [firstConversation] = result;
    expect(firstConversation).toMatchObject({
      id: 'session-channel-1',
      chatId: 'chat-1',
      chatName: '工程群',
      messageCount: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/channels/channel-1/conversations?limit=50&offset=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
        }),
      }),
    );
  });
});
