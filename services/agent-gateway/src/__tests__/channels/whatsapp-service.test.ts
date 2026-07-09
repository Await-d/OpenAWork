import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppChannelService } from '../../channels/whatsapp.js';
import type { ChannelInstance } from '../../channels/types.js';

function makeWhatsAppChannel(): ChannelInstance {
  return {
    id: 'whatsapp-service-1',
    type: 'whatsapp',
    name: 'WhatsApp Service',
    enabled: true,
    config: { phoneNumberId: 'phone-1', accessToken: 'token-1', verifyToken: 'verify-1' },
    features: { autoReply: true, streamingReply: false, autoStart: true },
    ownerUserId: 'u-whatsapp',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

describe('WhatsAppChannelService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('启动时先校验 Graph API 凭证，避免无效 accessToken 被误标运行', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), {
          status: 401,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new WhatsAppChannelService(makeWhatsAppChannel(), () => undefined);

    await expect(service.start()).rejects.toThrow(
      'WhatsApp credential check failed: Invalid OAuth access token',
    );
    expect(service.isRunning()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('凭证校验通过后才进入运行态', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ id: 'phone-1' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new WhatsAppChannelService(makeWhatsAppChannel(), () => undefined);

    await service.start();

    expect(service.isRunning()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
