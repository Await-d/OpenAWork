import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeComChannelService } from '../../channels/wecom.js';
import type { ChannelInstance } from '../../channels/types.js';

function makeWeComChannel(config: Record<string, string>): ChannelInstance {
  return {
    id: 'wecom-service-1',
    type: 'wecom',
    name: 'WeCom Service',
    enabled: true,
    config,
    features: { autoReply: true, streamingReply: false, autoStart: true },
    ownerUserId: 'u-wecom',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

describe('WeComChannelService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('API 模式启动时先校验企业凭证，避免无效 corpSecret 被误标运行', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ errcode: 40014, errmsg: 'invalid secret' }))),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new WeComChannelService(
      makeWeComChannel({
        corpId: 'corp-1',
        corpSecret: 'bad-secret',
        agentId: '100001',
      }),
      () => undefined,
    );

    await expect(service.start()).rejects.toThrow('WeCom token error: invalid secret');
    expect(service.isRunning()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('webhook-only 模式启动不发探测消息', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new WeComChannelService(
      makeWeComChannel({ webhookUrl: 'https://wecom.example/webhook' }),
      () => undefined,
    );

    await service.start();

    expect(service.isRunning()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
