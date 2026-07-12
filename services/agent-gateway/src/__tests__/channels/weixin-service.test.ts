import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeixinApi } from '../../channels/weixin-api.js';
import { WeixinChannelService, type WeixinApiClient } from '../../channels/weixin.js';
import type { ChannelEvent, ChannelInstance } from '../../channels/types.js';

function makeWeixinChannel(configOverride: Record<string, string> = {}): ChannelInstance {
  return {
    id: 'weixin-service-1',
    type: 'weixin',
    name: 'Weixin Service',
    enabled: true,
    config: {
      token: 'token-1',
      accountId: 'account-1',
      ...configOverride,
    },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'u-weixin',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

describe('WeixinChannelService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('通过 iLink sendmessage 发送文本，并带上 OpenCowork 所需鉴权头和 context_token', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ret: 0 }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = new WeixinApi({
      baseUrl: 'https://weixin.example',
      token: 'token-1',
      routeTag: 'route-a',
    });

    const result = await api.sendMessage({
      toUserId: 'weixin-user',
      text: '机器人回复',
      contextToken: 'ctx-1',
    });

    expect(result.messageId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://weixin.example/ilink/bot/sendmessage');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      AuthorizationType: 'ilink_bot_token',
      SKRouteTag: 'route-a',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      msg: {
        to_user_id: 'weixin-user',
        message_type: 2,
        message_state: 2,
        context_token: 'ctx-1',
        item_list: [{ type: 1, text_item: { text: '机器人回复' } }],
      },
    });
  });

  it('长轮询收到用户消息后缓存 context_token，并用它回复同一会话', async () => {
    const sentMessages: Array<{ toUserId: string; text: string; contextToken: string }> = [];
    let getUpdatesCalls = 0;
    const api: WeixinApiClient = {
      async getUpdates(_syncBuf, _timeoutMs, signal) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return { ret: 0 };
        }
        if (getUpdatesCalls === 2) {
          return {
            ret: 0,
            get_updates_buf: 'cursor-1',
            longpolling_timeout_ms: 30_000,
            msgs: [
              {
                message_type: 1,
                from_user_id: 'weixin-user',
                message_id: 1788001,
                create_time_ms: Date.now(),
                context_token: 'ctx-1',
                item_list: [{ type: 1, text_item: { text: '微信消息' } }],
              },
            ],
          };
        }

        return new Promise((resolve, reject) => {
          const abort = (): void => {
            reject(new DOMException('Aborted', 'AbortError'));
          };
          signal?.addEventListener('abort', abort, { once: true });
        });
      },
      async sendMessage(params) {
        sentMessages.push(params);
        return { messageId: 'sent-weixin-1' };
      },
      async sendImage() {
        return { messageId: 'sent-weixin-image-1' };
      },
      async sendFile() {
        return { messageId: 'sent-weixin-file-1' };
      },
    };
    const events: ChannelEvent[] = [];
    const service = new WeixinChannelService(
      makeWeixinChannel(),
      (event) => {
        events.push(event);
      },
      () => api,
    );

    await service.start();
    await expect.poll(() => events.find((event) => event.type === 'message')?.type).toBe('message');

    const result = await service.sendMessage('weixin-user', '机器人回复');
    await service.stop();

    expect(result).toEqual({ messageId: 'sent-weixin-1' });
    expect(events).toContainEqual({
      type: 'message',
      pluginId: 'weixin-service-1',
      message: expect.objectContaining({
        id: '1788001',
        chatId: 'weixin-user',
        content: '微信消息',
      }),
    });
    expect(sentMessages).toEqual([
      { toUserId: 'weixin-user', text: '机器人回复', contextToken: 'ctx-1' },
    ]);
  });

  it('微信服务发送文件时复用已缓存的 context_token', async () => {
    const sentFiles: Array<{
      toUserId: string;
      contextToken: string;
      fileName: string;
      text?: string;
    }> = [];
    let getUpdatesCalls = 0;
    const api: WeixinApiClient = {
      async getUpdates(_syncBuf, _timeoutMs, signal) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return { ret: 0 };
        }
        if (getUpdatesCalls === 2) {
          return {
            ret: 0,
            msgs: [
              {
                message_type: 1,
                from_user_id: 'weixin-user',
                message_id: 1788002,
                create_time_ms: Date.now(),
                context_token: 'ctx-file',
                item_list: [{ type: 1, text_item: { text: '发文件' } }],
              },
            ],
          };
        }

        return new Promise((resolve, reject) => {
          const abort = (): void => {
            reject(new DOMException('Aborted', 'AbortError'));
          };
          signal?.addEventListener('abort', abort, { once: true });
        });
      },
      async sendMessage() {
        return { messageId: 'sent-weixin-1' };
      },
      async sendImage() {
        return { messageId: 'sent-weixin-image-1' };
      },
      async sendFile(params) {
        sentFiles.push({
          toUserId: params.toUserId,
          contextToken: params.contextToken,
          fileName: params.fileName,
          ...(params.text ? { text: params.text } : {}),
        });
        return { messageId: 'sent-weixin-file-1' };
      },
    };
    const service = new WeixinChannelService(
      makeWeixinChannel(),
      () => undefined,
      () => api,
    );

    await service.start();
    await expect.poll(() => sentFiles.length).toBe(0);
    await expect.poll(() => getUpdatesCalls).toBeGreaterThanOrEqual(1);

    const result = await service.sendFile('weixin-user', {
      buffer: Buffer.from('file-bytes'),
      fileName: 'report.pdf',
      text: '请查收',
    });
    await service.stop();

    expect(result).toEqual({ messageId: 'sent-weixin-file-1' });
    expect(sentFiles).toEqual([
      {
        toUserId: 'weixin-user',
        contextToken: 'ctx-file',
        fileName: 'report.pdf',
        text: '请查收',
      },
    ]);
  });

  it('群会话消息会按 chat_id 缓存 context_token，并回发到群会话', async () => {
    const sentMessages: Array<{ toUserId: string; text: string; contextToken: string }> = [];
    let getUpdatesCalls = 0;
    const api: WeixinApiClient = {
      async getUpdates(_syncBuf, _timeoutMs, signal) {
        getUpdatesCalls += 1;
        if (getUpdatesCalls === 1) {
          return { ret: 0 };
        }
        if (getUpdatesCalls === 2) {
          return {
            ret: 0,
            msgs: [
              {
                message_type: 1,
                chat_id: 'weixin-group-1',
                chat_name: '产品群',
                from_user_id: 'weixin-user',
                sender_name: 'Alice',
                message_id: 1788004,
                create_time_ms: Date.now(),
                context_token: 'ctx-group',
                item_list: [{ type: 1, text_item: { text: '群里问一句' } }],
              },
            ],
          };
        }

        return new Promise((resolve, reject) => {
          const abort = (): void => {
            reject(new DOMException('Aborted', 'AbortError'));
          };
          signal?.addEventListener('abort', abort, { once: true });
        });
      },
      async sendMessage(params) {
        sentMessages.push(params);
        return { messageId: 'sent-weixin-group-1' };
      },
      async sendImage() {
        return { messageId: 'sent-weixin-image-1' };
      },
      async sendFile() {
        return { messageId: 'sent-weixin-file-1' };
      },
    };
    const events: ChannelEvent[] = [];
    const service = new WeixinChannelService(
      makeWeixinChannel(),
      (event) => {
        events.push(event);
      },
      () => api,
    );

    await service.start();
    await expect.poll(() => events.find((event) => event.type === 'message')?.type).toBe('message');

    const result = await service.sendMessage('weixin-group-1', '群里回一句');
    await service.stop();

    expect(result).toEqual({ messageId: 'sent-weixin-group-1' });
    expect(events).toContainEqual({
      type: 'message',
      pluginId: 'weixin-service-1',
      message: expect.objectContaining({
        chatId: 'weixin-group-1',
        chatName: '产品群',
        senderId: 'weixin-user',
        senderName: 'Alice',
      }),
    });
    expect(sentMessages).toEqual([
      { toUserId: 'weixin-group-1', text: '群里回一句', contextToken: 'ctx-group' },
    ]);
  });

  it('启动时先校验 iLink getupdates，避免凭证错误时误标运行', async () => {
    const api: WeixinApiClient = {
      async getUpdates() {
        return { ret: 40001, errmsg: 'invalid token' };
      },
      async sendMessage() {
        return { messageId: 'sent-weixin-1' };
      },
      async sendImage() {
        return { messageId: 'sent-weixin-image-1' };
      },
      async sendFile() {
        return { messageId: 'sent-weixin-file-1' };
      },
    };
    const service = new WeixinChannelService(
      makeWeixinChannel(),
      () => undefined,
      () => api,
    );

    await expect(service.start()).rejects.toThrow('Weixin startup check failed: invalid token');
    expect(service.isRunning()).toBe(false);
  });
});
