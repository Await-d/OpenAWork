import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingTalkChannelService } from '../../channels/dingtalk.js';
import type { DingTalkGatewayFactory } from '../../channels/dingtalk-gateway.js';
import type { ChannelEvent, ChannelInstance } from '../../channels/types.js';

function makeDingTalkChannel(configOverride: Record<string, string> = {}): ChannelInstance {
  return {
    id: 'dingtalk-service-1',
    type: 'dingtalk',
    name: 'DingTalk Service',
    enabled: true,
    config: {
      appKey: 'app-key',
      appSecret: 'app-secret',
      robotCode: 'robot-code',
      ...configOverride,
    },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'u-dingtalk',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DingTalkChannelService Stream 会话回复', () => {
  it('处理 Stream 消息时缓存 sessionWebhook，并优先用它回复同一会话', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: ChannelEvent[] = [];
    const service = new DingTalkChannelService(makeDingTalkChannel(), (event) => {
      events.push(event);
    });

    service.handleStreamEvent({
      headers: { topic: '/v1.0/im/bot/messages/get' },
      data: JSON.stringify({
        conversationId: 'cid-1',
        senderStaffId: 'staff-1',
        senderNick: 'Ding User',
        msgId: 'msg-1',
        msgCreateTime: '1788000000000',
        text: { content: JSON.stringify({ content: '钉钉消息' }) },
        sessionWebhook: 'https://session-webhook.example/send',
        sessionWebhookExpiredTime: String(Date.now() + 60_000),
      }),
    });

    expect(events).toContainEqual({
      type: 'message',
      pluginId: 'dingtalk-service-1',
      message: expect.objectContaining({
        id: 'msg-1',
        chatId: 'cid-1',
        content: '钉钉消息',
      }),
    });

    const result = await service.sendMessage('cid-1', '机器人回复');

    expect(result.messageId).toMatch(/^session-webhook-/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://session-webhook.example/send');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      msgtype: 'text',
      text: { content: '机器人回复' },
    });
  });

  it('配置 cardTemplateId 后使用钉钉 AI Card 进行流式回复', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes('/gettoken')) {
        return Promise.resolve(
          new Response(JSON.stringify({ errcode: 0, access_token: 'token-1', expires_in: 7200 })),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new DingTalkChannelService(
      makeDingTalkChannel({ cardTemplateId: 'tpl-1' }),
      () => {},
    );

    service.handleStreamEvent({
      headers: { topic: '/v1.0/im/bot/messages/get' },
      data: JSON.stringify({
        conversationId: 'cid-card',
        conversationType: '1',
        senderStaffId: 'staff-card',
        senderNick: 'Ding Card',
        msgId: 'msg-card',
        msgCreateTime: '1788000000000',
        text: { content: JSON.stringify({ content: '开始流式' }) },
      }),
    });

    expect(service.supportsStreaming).toBe(true);
    expect(service.sendStreamingMessage).toBeTypeOf('function');
    if (!service.sendStreamingMessage) {
      throw new Error('DingTalk streaming method is missing');
    }
    const handle = await service.sendStreamingMessage('cid-card', '初始');
    await handle.update('中间');
    await handle.finish('最终');

    const createCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/v1.0/card/instances/createAndDeliver'),
    );
    const updateCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/v1.0/card/streaming'),
    );
    expect(createCall).toBeTruthy();
    if (!createCall) {
      throw new Error('DingTalk createAndDeliver call is missing');
    }
    expect(updateCalls).toHaveLength(2);

    expect(JSON.parse(String(createCall[1]?.body))).toEqual(
      expect.objectContaining({
        cardTemplateId: 'tpl-1',
        openSpaceId: 'dtv1.card//IM_ROBOT.staff-card',
        callbackType: 'STREAM',
        cardData: { cardParamMap: { content: '初始' } },
      }),
    );
    expect(JSON.parse(String(updateCalls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        key: 'content',
        content: '中间',
        isFull: true,
        isFinalize: false,
      }),
    );
    expect(JSON.parse(String(updateCalls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({
        key: 'content',
        content: '最终',
        isFull: true,
        isFinalize: true,
      }),
    );
  });

  it('启动时接入 Stream gateway，并把机器人消息派发到统一 channel message', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ errcode: 0, access_token: 'token-1', expires_in: 7200 })),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: ChannelEvent[] = [];
    let stopCount = 0;
    const gatewayFactory: DingTalkGatewayFactory = (options) => ({
      start: async () => {
        options.handleStreamEvent({
          headers: { topic: '/v1.0/im/bot/messages/get' },
          data: JSON.stringify({
            conversationId: 'cid-start',
            senderStaffId: 'staff-start',
            senderNick: 'Ding Starter',
            msgId: 'msg-start',
            createAt: 1_788_000_000_000,
            text: { content: JSON.stringify({ content: '启动后消息' }) },
            sessionWebhook: 'https://session-webhook.example/start',
            sessionWebhookExpiredTime: String(Date.now() + 60_000),
          }),
        });
      },
      stop: () => {
        stopCount += 1;
      },
    });
    const service = new DingTalkChannelService(
      makeDingTalkChannel(),
      (event) => {
        events.push(event);
      },
      gatewayFactory,
    );

    await service.start();
    await service.stop();

    expect(events).toContainEqual({
      type: 'message',
      pluginId: 'dingtalk-service-1',
      message: expect.objectContaining({
        id: 'msg-start',
        chatId: 'cid-start',
        senderId: 'staff-start',
        content: '启动后消息',
      }),
    });
    expect(events).toContainEqual({
      type: 'status',
      pluginId: 'dingtalk-service-1',
      status: 'running',
    });
    expect(stopCount).toBe(1);
  });
});
