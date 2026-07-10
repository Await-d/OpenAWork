import { afterEach, describe, expect, it, vi } from 'vitest';
import { QQChannelService, parseQQChatId } from '../../channels/qq.js';
import type { ChannelInstance } from '../../channels/types.js';

const originalFetch = globalThis.fetch;

function makeQQChannel(config: Record<string, string> = {}): ChannelInstance {
  return {
    id: 'qq-channel-test',
    type: 'qq',
    name: 'QQ Test',
    enabled: true,
    config: {
      appId: 'app-id',
      clientSecret: 'client-secret',
      markdownSupport: 'false',
      ...config,
    },
    ownerUserId: 'user-qq-test',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function mockFetchSequence(...responses: readonly Response[]): ReturnType<typeof vi.fn> {
  const queue = [...responses];
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) {
      return Promise.reject(new Error('unexpected fetch call'));
    }
    return Promise.resolve(next);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

describe('parseQQChatId', () => {
  it('识别 OpenCowork 的 c2c/group/channel 三类 chatId', () => {
    expect(parseQQChatId('qqbot:c2c:user-open-id')).toEqual({
      type: 'c2c',
      id: 'user-open-id',
    });
    expect(parseQQChatId('group:group-open-id')).toEqual({
      type: 'group',
      id: 'group-open-id',
    });
    expect(parseQQChatId('channel:channel-id')).toEqual({
      type: 'channel',
      id: 'channel-id',
    });
  });
});

describe('QQChannelService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('向 C2C 私聊发送到 v2 user endpoint，并带 msg_seq', async () => {
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ id: 'sent-c2c' }),
    );
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    const result = await service.sendMessage('c2c:user-open-id', 'hello');

    expect(result).toEqual({ messageId: 'sent-c2c' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/users/user-open-id/messages',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      content: 'hello',
      msg_type: 0,
      msg_seq: 1,
    });
  });

  it('向群聊发送到 v2 group endpoint', async () => {
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ id: 'sent-group' }),
    );
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    await service.sendMessage('group:group-open-id', 'group hello');

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/groups/group-open-id/messages',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      content: 'group hello',
      msg_type: 0,
      msg_seq: 1,
    });
  });

  it('向频道消息沿用 channel endpoint，并支持 sandbox 域名', async () => {
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ id: 'sent-channel' }),
    );
    const service = new QQChannelService(makeQQChannel({ useSandbox: 'true' }), () => undefined);

    await service.sendMessage('channel:channel-id', 'channel hello');

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://sandbox.api.sgroup.qq.com/channels/channel-id/messages',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      content: 'channel hello',
    });
  });

  it('使用入站消息引用回复 QQ 群消息时带原始 msg_id', async () => {
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ id: 'sent-reply' }),
    );
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    const result = await service.replyMessage('group:group-open-id|incoming-msg-id', '收到');

    expect(result).toEqual({ messageId: 'sent-reply' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/groups/group-open-id/messages',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      content: '收到',
      msg_id: 'incoming-msg-id',
      msg_type: 0,
    });
  });

  it('向 QQ 私聊发送图片时先上传富媒体再发送 media 消息', async () => {
    const imageBuffer = Buffer.from('fake image');
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ file_uuid: 'file-uuid', file_info: 'file-info', ttl: 60 }),
      jsonResponse({ id: 'sent-image' }),
    );
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    const result = await service.sendImage('c2c:user-open-id', {
      buffer: imageBuffer,
      fileName: 'demo.png',
      text: '配图',
    });

    expect(result).toEqual({ messageId: 'sent-image' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/users/user-open-id/files',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      file_type: 1,
      file_data: imageBuffer.toString('base64'),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/users/user-open-id/messages',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      content: '配图',
      media: { file_info: 'file-info' },
      msg_type: 7,
      msg_seq: 1,
    });
  });

  it('向 QQ 私聊发送网络图片时上传富媒体优先传官方 url 字段', async () => {
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ file_uuid: 'file-uuid', file_info: 'file-info', ttl: 60 }),
      jsonResponse({ id: 'sent-url-image' }),
    );
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    await service.sendImage('c2c:user-open-id', {
      buffer: Buffer.from('downloaded image'),
      fileName: 'remote.png',
      sourceUrl: 'https://example.com/remote.png',
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      file_type: 1,
      url: 'https://example.com/remote.png',
    });
  });

  it('回复 QQ 群图片时在 media 消息中带原始 msg_id 与递增 msg_seq', async () => {
    const fetchMock = mockFetchSequence(
      jsonResponse({ access_token: 'token', expires_in: 7200 }),
      jsonResponse({ file_uuid: 'file-uuid', file_info: 'file-info', ttl: 60 }),
      jsonResponse({ id: 'sent-image-reply' }),
    );
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    await service.replyImage('group:group-open-id|incoming-msg-id', {
      buffer: Buffer.from('fake image'),
      fileName: 'reply.png',
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/groups/group-open-id/files',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.sgroup.qq.com/v2/groups/group-open-id/messages',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      media: { file_info: 'file-info' },
      msg_id: 'incoming-msg-id',
      msg_type: 7,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).msg_seq).toBeGreaterThan(1);
  });
});
