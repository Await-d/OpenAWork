import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordChannelService } from '../../channels/discord.js';
import type { ChannelInstance } from '../../channels/types.js';

const OriginalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = OriginalFetch;
  vi.restoreAllMocks();
});

function instance(): ChannelInstance {
  return {
    id: 'discord-1',
    type: 'discord',
    name: 'discord',
    enabled: true,
    config: { token: 'bot-token' } as unknown as ChannelInstance['config'],
    ownerUserId: 'u1',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('DiscordChannelService list parsing resilience', () => {
  it('getGroupMessages 在错误对象响应（非数组）时返回空列表而不抛', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized', code: 0 }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;

    const svc = new DiscordChannelService(instance(), () => undefined);
    await expect(svc.getGroupMessages('chan-1')).resolves.toEqual([]);
  });

  it('getGroupMessages 对缺 author 的条目防御式解析', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify([{ id: 'm1', content: 'hi' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;

    const svc = new DiscordChannelService(instance(), () => undefined);
    const msgs = await svc.getGroupMessages('chan-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.senderId).toBe('unknown');
    expect(msgs[0]?.content).toBe('hi');
  });

  it('listGroups 在错误对象响应时返回空列表', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: '401: Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;

    const svc = new DiscordChannelService(instance(), () => undefined);
    await expect(svc.listGroups()).resolves.toEqual([]);
  });

  it('listGroups 拉取各 guild 的 text channels 并过滤非文本频道', async () => {
    const calls: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/users/@me/guilds')) {
        return Promise.resolve(
          jsonResponse([
            { id: 'g1', name: 'Guild One' },
            { id: 'g2', name: 'Guild Two' },
          ]),
        );
      }
      if (url.endsWith('/guilds/g1/channels')) {
        return Promise.resolve(
          jsonResponse([
            { id: 'c-text-1', name: 'general', type: 0 },
            { id: 'c-voice', name: 'Voice', type: 2 },
            { id: 'c-category', name: 'Category', type: 4 },
            { id: 'c-announcement', name: 'Announcements', type: 5 },
          ]),
        );
      }
      if (url.endsWith('/guilds/g2/channels')) {
        return Promise.resolve(jsonResponse([{ id: 'c-text-2', name: 'random', type: 0 }]));
      }
      throw new Error(`unexpected Discord URL: ${url}`);
    }) as typeof fetch;

    const svc = new DiscordChannelService(instance(), () => undefined);
    await expect(svc.listGroups()).resolves.toEqual([
      { id: 'c-text-1', name: 'general' },
      { id: 'c-text-2', name: 'random' },
    ]);
    expect(calls).toEqual([
      'https://discord.com/api/v10/users/@me/guilds',
      'https://discord.com/api/v10/guilds/g1/channels',
      'https://discord.com/api/v10/guilds/g2/channels',
    ]);
  });

  it('listGroups 在单个 guild 频道请求失败时跳过该 guild，其余仍返回', async () => {
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/users/@me/guilds')) {
        return Promise.resolve(
          jsonResponse([
            { id: 'g-broken', name: 'Broken' },
            { id: 'g-ok', name: 'OK' },
          ]),
        );
      }
      if (url.endsWith('/guilds/g-broken/channels')) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'Missing Access', code: 50001 }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.endsWith('/guilds/g-ok/channels')) {
        return Promise.resolve(jsonResponse([{ id: 'c-ok', name: 'chat', type: 0 }]));
      }
      throw new Error(`unexpected Discord URL: ${url}`);
    }) as typeof fetch;

    const svc = new DiscordChannelService(instance(), () => undefined);
    await expect(svc.listGroups()).resolves.toEqual([{ id: 'c-ok', name: 'chat' }]);
  });

  it('listGroups 在 guilds 超过 10 个时只请求前 10 个', async () => {
    const channelRequests: string[] = [];
    const guilds = Array.from({ length: 12 }, (_value, index) => ({
      id: `g${index + 1}`,
      name: `Guild ${index + 1}`,
    }));
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/users/@me/guilds')) {
        return Promise.resolve(jsonResponse(guilds));
      }
      channelRequests.push(url);
      const guildId = url.split('/guilds/')[1]?.split('/')[0] ?? '';
      return Promise.resolve(
        jsonResponse([{ id: `c-${guildId}`, name: `text-${guildId}`, type: 0 }]),
      );
    }) as typeof fetch;

    const svc = new DiscordChannelService(instance(), () => undefined);
    const groups = await svc.listGroups();
    expect(channelRequests).toHaveLength(10);
    expect(channelRequests[0]).toBe('https://discord.com/api/v10/guilds/g1/channels');
    expect(channelRequests[9]).toBe('https://discord.com/api/v10/guilds/g10/channels');
    expect(groups).toHaveLength(10);
    expect(groups[0]).toEqual({ id: 'c-g1', name: 'text-g1' });
    expect(groups[9]).toEqual({ id: 'c-g10', name: 'text-g10' });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
