import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuChannelService } from '../../channels/feishu.js';
import type { FeishuGatewayFactory } from '../../channels/feishu-gateway.js';
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
  return jsonResponse({ code: 0, tenant_access_token: 't-abc', expire: 7200 });
}

const noopGatewayFactory: FeishuGatewayFactory = () => ({
  start: async () => undefined,
  stop: () => undefined,
});

describe('FeishuChannelService extra APIs', () => {
  it('发送文件时先上传文件再发送 file 消息', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = init?.body instanceof FormData ? init.body : parseJsonBody(init?.body);
      calls.push({ url, body });
      if (calls.length === 1) return Promise.resolve(tokenResponse());
      if (url.endsWith('/im/v1/files')) {
        return Promise.resolve(jsonResponse({ code: 0, data: { file_key: 'file-key-1' } }));
      }
      return Promise.resolve(jsonResponse({ code: 0, data: { message_id: 'om-file' } }));
    };

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(
      svc.sendFile('chat-1', {
        buffer: Buffer.from([1, 2, 3]),
        fileName: 'report.pdf',
      }),
    ).resolves.toEqual({ messageId: 'om-file' });

    expect(calls[1]?.url).toBe('https://open.feishu.cn/open-apis/im/v1/files');
    if (!(calls[1]?.body instanceof FormData)) {
      throw new Error('Expected Feishu file upload body to be FormData');
    }
    expect(calls[1].body.get('file_type')).toBe('pdf');
    expect(calls[1].body.get('file_name')).toBe('report.pdf');
    expect(calls[2]?.body).toMatchObject({
      receive_id: 'chat-1',
      msg_type: 'file',
      content: JSON.stringify({ file_key: 'file-key-1' }),
    });
  });

  it('列出群成员时使用 chat members endpoint 和 open_id 默认类型', async () => {
    const calls: string[] = [];
    globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
      calls.push(String(input));
      if (calls.length === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(
        jsonResponse({
          code: 0,
          data: {
            items: [{ member_id: 'ou_1' }],
            page_token: 'next',
            has_more: true,
          },
        }),
      );
    };

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(svc.listChatMembers('chat-1', { pageSize: 20 })).resolves.toEqual({
      items: [{ member_id: 'ou_1' }],
      pageToken: 'next',
      hasMore: true,
    });
    expect(calls[1]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/chats/chat-1/members?member_id_type=open_id&page_size=20',
    );
  });

  it('发送 @成员消息前校验群聊并发送 post 消息', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, body: parseJsonBody(init?.body) });
      if (calls.length === 1) return Promise.resolve(tokenResponse());
      if (url.endsWith('/im/v1/chats/chat-1')) {
        return Promise.resolve(jsonResponse({ code: 0, data: { chat_type: 'group' } }));
      }
      return Promise.resolve(jsonResponse({ code: 0, data: { message_id: 'om-mention' } }));
    };

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(
      svc.sendMention('chat-1', { userIds: ['ou_1'], text: '请看一下' }),
    ).resolves.toEqual({ messageId: 'om-mention' });

    expect(calls[1]?.url).toBe('https://open.feishu.cn/open-apis/im/v1/chats/chat-1');
    expect(calls[2]?.body).toMatchObject({
      receive_id: 'chat-1',
      msg_type: 'post',
      content: JSON.stringify({
        zh_cn: {
          content: [
            [
              { tag: 'at', user_id: 'ou_1' },
              { tag: 'text', text: ' 请看一下' },
            ],
          ],
        },
      }),
    });
  });

  it('发送 urgent 时按 urgent_types 逐个调用加急 endpoint', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), body: parseJsonBody(init?.body) });
      if (calls.length === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse({ code: 0 }));
    };

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(
      svc.sendUrgent('om-1', { userIds: ['user-1'], urgentTypes: ['app', 'sms'] }),
    ).resolves.toEqual({ ok: true });

    expect(calls.slice(1).map((call) => call.url)).toEqual([
      'https://open.feishu.cn/open-apis/im/v1/messages/om-1/urgent?user_id_type=user_id',
      'https://open.feishu.cn/open-apis/im/v1/messages/om-1/urgent?user_id_type=user_id',
    ]);
    expect(calls[1]?.body).toEqual({ user_id_list: ['user-1'], urgent_type: 'app' });
    expect(calls[2]?.body).toEqual({ user_id_list: ['user-1'], urgent_type: 'sms' });
  });

  it('读取多维表格记录时拼接 app/table/filter/page 参数', async () => {
    const calls: string[] = [];
    globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
      calls.push(String(input));
      if (calls.length === 1) return Promise.resolve(tokenResponse());
      return Promise.resolve(jsonResponse({ code: 0, data: { items: [{ record_id: 'rec-1' }] } }));
    };

    const svc = new FeishuChannelService(instance(), () => undefined, noopGatewayFactory);
    await svc.start();
    await expect(
      svc.getBitableRecords({
        appToken: 'app token',
        tableId: 'tbl-1',
        filter: 'CurrentValue.[状态]="open"',
      }),
    ).resolves.toEqual({ items: [{ record_id: 'rec-1' }] });

    expect(calls[1]).toBe(
      'https://open.feishu.cn/open-apis/bitable/v1/apps/app%20token/tables/tbl-1/records?page_size=50&filter=CurrentValue.%5B%E7%8A%B6%E6%80%81%5D%3D%22open%22',
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
  return typeof body === 'string' ? JSON.parse(body) : null;
}
