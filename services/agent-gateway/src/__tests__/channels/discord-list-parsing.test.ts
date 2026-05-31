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
});
