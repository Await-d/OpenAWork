import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuChannelService } from '../../channels/feishu.js';
import {
  parseFeishuGatewayEvent,
  type FeishuGatewayFactory,
  type FeishuGatewayFactoryOptions,
} from '../../channels/feishu-gateway.js';
import type { ChannelInstance } from '../../channels/types.js';

const originalFetch = globalThis.fetch;

function makeFeishuChannel(): ChannelInstance {
  return {
    id: 'feishu-gateway-1',
    type: 'feishu',
    name: 'Feishu Gateway',
    enabled: true,
    config: {
      appId: 'app-id',
      appSecret: 'app-secret',
      verificationToken: 'verification-token',
      botOpenId: 'ou-bot',
    },
    features: { autoReply: true, streamingReply: true, autoStart: false },
    ownerUserId: 'u-feishu',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ code: 0, tenant_access_token: 't-abc', expire: 7200 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Feishu Gateway 入站', () => {
  it('解析官方 WSClient 的 im.message.receive_v1 事件为统一 channel message', async () => {
    const event = await parseFeishuGatewayEvent(
      { pluginId: 'feishu-gateway-1', botOpenId: 'ou-bot', botName: 'Feishu Gateway' },
      {
        message: {
          message_id: 'om-feishu-1',
          chat_id: 'oc-chat-1',
          chat_type: 'p2p',
          content: JSON.stringify({ text: '飞书消息' }),
          create_time: '1788000000',
        },
        sender: { sender_id: { open_id: 'ou-user-1' } },
      },
    );

    expect(event).toEqual({
      type: 'message',
      pluginId: 'feishu-gateway-1',
      message: expect.objectContaining({
        id: 'om-feishu-1',
        chatId: 'oc-chat-1',
        senderId: 'ou-user-1',
        content: '飞书消息',
      }),
    });
  });

  it('群聊中未 @ 当前机器人时跳过消息', async () => {
    const event = await parseFeishuGatewayEvent(
      { pluginId: 'feishu-gateway-1', botOpenId: 'ou-bot', botName: 'Feishu Gateway' },
      {
        message: {
          message_id: 'om-feishu-group',
          chat_id: 'oc-chat-1',
          chat_type: 'group',
          content: JSON.stringify({ text: '普通群聊消息' }),
          mentions: [{ key: '@_user_1', id: { open_id: 'ou-other-bot' }, name: 'Other Bot' }],
        },
        sender: { sender_id: { open_id: 'ou-user-1' } },
      },
    );

    expect(event).toBeNull();
  });

  it('群聊 @ 当前机器人时剥离 mention placeholder 并转为消息', async () => {
    const event = await parseFeishuGatewayEvent(
      { pluginId: 'feishu-gateway-1', botOpenId: 'ou-bot', botName: 'Feishu Gateway' },
      {
        message: {
          message_id: 'om-feishu-mentioned',
          chat_id: 'oc-chat-1',
          chat_type: 'group',
          content: JSON.stringify({ text: '@_user_1 帮我总结' }),
          mentions: [{ key: '@_user_1', id: { open_id: 'ou-bot' }, name: 'Feishu Gateway' }],
        },
        sender: { sender_id: { open_id: 'ou-user-1' } },
      },
    );

    if (event?.type !== 'message') {
      throw new Error('expected a Feishu message event');
    }
    expect(event.message.content).toBe('帮我总结');
  });

  it('重复 message_id 只派发一次', async () => {
    const parse = () =>
      parseFeishuGatewayEvent(
        { pluginId: 'feishu-gateway-1', botOpenId: 'ou-bot', botName: 'Feishu Gateway' },
        {
          message: {
            message_id: 'om-duplicated',
            chat_id: 'oc-chat-1',
            chat_type: 'p2p',
            content: JSON.stringify({ text: '只处理一次' }),
          },
          sender: { sender_id: { open_id: 'ou-user-1' } },
        },
      );

    await expect(parse()).resolves.not.toBeNull();
    await expect(parse()).resolves.toBeNull();
  });

  it('图片消息会下载为 channel image 附件', async () => {
    const downloadImage = vi.fn(async () => ({
      base64: Buffer.from('image').toString('base64'),
      mediaType: 'image/png',
    }));

    const event = await parseFeishuGatewayEvent(
      { pluginId: 'feishu-gateway-image', botOpenId: 'ou-bot', botName: 'Feishu Gateway' },
      {
        message: {
          message_id: 'om-feishu-image',
          chat_id: 'oc-chat-1',
          chat_type: 'p2p',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img-key-1' }),
        },
        sender: { sender_id: { open_id: 'ou-user-1' } },
      },
      downloadImage,
    );

    expect(downloadImage).toHaveBeenCalledWith('om-feishu-image', 'img-key-1');
    expect(event).toMatchObject({
      type: 'message',
      message: {
        images: [{ mediaType: 'image/png' }],
      },
    });
  });

  it('启动和停止 service 时管理 Feishu Gateway 生命周期', async () => {
    let capturedOptions: FeishuGatewayFactoryOptions | null = null;
    let startCount = 0;
    let stopCount = 0;
    const gatewayFactory: FeishuGatewayFactory = (options) => {
      capturedOptions = options;
      return {
        start: async () => {
          startCount += 1;
        },
        stop: () => {
          stopCount += 1;
        },
      };
    };
    globalThis.fetch = (() => Promise.resolve(tokenResponse())) as typeof fetch;

    const service = new FeishuChannelService(makeFeishuChannel(), () => undefined, gatewayFactory);

    await service.start();
    await service.stop();

    expect(capturedOptions).toMatchObject({
      pluginId: 'feishu-gateway-1',
      appId: 'app-id',
      appSecret: 'app-secret',
      botName: 'Feishu Gateway',
      botOpenId: 'ou-bot',
    });
    expect(startCount).toBe(1);
    expect(stopCount).toBe(1);
  });
});
