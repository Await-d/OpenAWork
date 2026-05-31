import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuChannelService } from '../../channels/feishu.js';
import type { ChannelInstance } from '../../channels/types.js';

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
  return new Response(
    JSON.stringify({ code: 0, tenant_access_token: 't-abc', expire: 7200 }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

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

    const svc = new FeishuChannelService(instance(), () => undefined);
    await svc.start();
    await expect(svc.sendMessage('chat-1', 'hi')).rejects.toThrow(/Feishu send failed: code 230002/);
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

    const svc = new FeishuChannelService(instance(), () => undefined);
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

    const svc = new FeishuChannelService(instance(), () => undefined);
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

    const svc = new FeishuChannelService(instance(), () => undefined);
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

    const svc = new FeishuChannelService(instance(), () => undefined);
    await svc.start();
    await expect(svc.listGroups()).resolves.toEqual([]);
  });
});
