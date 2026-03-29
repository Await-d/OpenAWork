import { describe, expect, it, vi } from 'vitest';
import { WeComChannelService } from '../channels/wecom.js';
import { WhatsAppChannelService } from '../channels/whatsapp.js';
import { QQChannelService } from '../channels/qq.js';
import type { ChannelInstance, ChannelEvent } from '../channels/types.js';

function makeInstance(
  type: 'wecom' | 'whatsapp' | 'qq',
  config: Record<string, string>,
): ChannelInstance {
  return {
    id: `${type}-test-1`,
    type,
    name: `Test ${type}`,
    enabled: true,
    config,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('WeCom channel adapter', () => {
  it('raises when corpId and webhookUrl are both missing', async () => {
    const svc = new WeComChannelService(makeInstance('wecom', {}), vi.fn());
    await expect(svc.start()).rejects.toThrow();
  });

  it('starts when webhook config is provided (stub scenario)', async () => {
    const notify = vi.fn<(event: ChannelEvent) => void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'mock-token', expires_in: 7200, errcode: 0 }),
      })),
    );
    const svc = new WeComChannelService(
      makeInstance('wecom', {
        corpId: 'corp-test',
        corpSecret: 'secret-test',
        agentId: '1000001',
      }),
      notify,
    );
    await svc.start();
    expect(svc.isRunning()).toBe(true);
    await svc.stop();
    expect(svc.isRunning()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('WhatsApp channel adapter', () => {
  it('raises when phoneNumberId or accessToken are missing', async () => {
    const svc = new WhatsAppChannelService(makeInstance('whatsapp', {}), vi.fn());
    await expect(svc.start()).rejects.toThrow();
  });

  it('starts and stops correctly when required config is present', async () => {
    const svc = new WhatsAppChannelService(
      makeInstance('whatsapp', {
        phoneNumberId: '12345678901234',
        accessToken: 'EAAXXX',
        verifyToken: 'secret',
      }),
      vi.fn(),
    );
    await svc.start();
    expect(svc.isRunning()).toBe(true);
    await svc.stop();
    expect(svc.isRunning()).toBe(false);
  });
});

describe('QQ channel adapter', () => {
  it('raises when appId or clientSecret are missing', async () => {
    const svc = new QQChannelService(makeInstance('qq', {}), vi.fn());
    await expect(svc.start()).rejects.toThrow();
  });

  it('starts and stops correctly when required config is present', async () => {
    const svc = new QQChannelService(
      makeInstance('qq', {
        appId: 'app-123',
        clientSecret: 'secret-123',
      }),
      vi.fn(),
    );
    await svc.start();
    expect(svc.isRunning()).toBe(true);
    await svc.stop();
    expect(svc.isRunning()).toBe(false);
  });
});
