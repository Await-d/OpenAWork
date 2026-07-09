import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuChannelService } from '../../channels/feishu.js';
import type { ChannelInstance } from '../../channels/types.js';
import type { FeishuGatewayFactory } from '../../channels/feishu-gateway.js';

const OriginalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
});

function instance(): ChannelInstance {
  return {
    id: 'feishu-1',
    type: 'feishu',
    name: 'feishu',
    enabled: true,
    config: {
      appId: 'app',
      appSecret: 'secret',
      verificationToken: 'vtoken',
    } as unknown as ChannelInstance['config'],
    ownerUserId: 'u1',
    createdAt: 0,
    updatedAt: 0,
  };
}

function tokenResponse(): Response {
  return new Response(JSON.stringify({ code: 0, tenant_access_token: 't-abc', expire: 7200 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const noopGatewayFactory: FeishuGatewayFactory = () => ({
  start: async () => undefined,
  stop: () => undefined,
});

describe('FeishuChannelService send error handling', () => {
  it('上游返回非零 code 时抛出清晰错误，而不是读 undefined.message_id 崩溃', async () => {
    let call = 0;
    globalThis.fetch = ((): Promise<Response> => {
      call += 1;
      if (call === 1) return Promise.resolve(tokenResponse()); // refreshToken on start
      // send response: application error envelope, no `data`
      return Promise.resolve(
        new Response(JSON.stringify({ code: 230002, msg: 'invalid token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(svc.sendMessage('chat-1', 'hi')).rejects.toThrow(
      /Feishu send failed: code 230002/,
    );
  });

  it('code 0 且有 message_id 时正常返回', async () => {
    let call = 0;
    globalThis.fetch = ((): Promise<Response> => {
      call += 1;
      if (call === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(
        new Response(JSON.stringify({ code: 0, data: { message_id: 'om-123' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(svc.sendMessage('chat-1', 'hi')).resolves.toEqual({ messageId: 'om-123' });
  });

  it('code 0 但缺 message_id 时抛出明确错误', async () => {
    let call = 0;
    globalThis.fetch = ((): Promise<Response> => {
      call += 1;
      if (call === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(
        new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(svc.sendMessage('chat-1', 'hi')).rejects.toThrow(/no message_id/);
  });

  it('getGroupMessages 在错误信封（无 data）时返回空列表而不抛', async () => {
    let call = 0;
    globalThis.fetch = ((): Promise<Response> => {
      call += 1;
      if (call === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(
        new Response(JSON.stringify({ code: 99991663, msg: 'token invalid' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(svc.getGroupMessages('chat-1')).resolves.toEqual([]);
  });

  it('listGroups 在错误信封时返回空列表', async () => {
    let call = 0;
    globalThis.fetch = ((): Promise<Response> => {
      call += 1;
      if (call === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(
        new Response(JSON.stringify({ code: 99991663 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(svc.listGroups()).resolves.toEqual([]);
  });

  it('流式回复带原消息 id 时首条卡片使用 reply endpoint', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = ((url: string, init?: RequestInit): Promise<Response> => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (calls.length === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(
        new Response(JSON.stringify({ code: 0, data: { message_id: `om-${calls.length}` } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();

    await svc.sendStreamingMessage('chat-1', 'thinking', 'original-message-id');

    expect(calls[1]?.url).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/original-message-id/reply',
    );
    expect(calls[1]?.body).toMatchObject({
      msg_type: 'interactive',
    });
  });
});
