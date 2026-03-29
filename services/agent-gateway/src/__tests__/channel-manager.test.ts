import { describe, expect, it, vi } from 'vitest';
import { ChannelManager } from '../channels/manager.js';
import type { ChannelEvent, ChannelInstance, MessagingChannelService } from '../channels/types.js';

function createInstance(): ChannelInstance {
  return {
    id: 'slack-1',
    type: 'slack',
    name: 'Slack',
    enabled: true,
    config: { botToken: 'xoxb-1', signingSecret: 'secret' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('ChannelManager', () => {
  it('removes failed services from runtime map when start throws', async () => {
    const manager = new ChannelManager();
    const stop = vi.fn(async () => undefined);
    const service: MessagingChannelService = {
      pluginId: 'slack-1',
      pluginType: 'slack',
      start: vi.fn(async () => {
        throw new Error('boom');
      }),
      stop,
      isRunning: () => false,
      sendMessage: vi.fn(),
      replyMessage: vi.fn(),
      getGroupMessages: vi.fn(),
      listGroups: vi.fn(),
    };

    manager.registerFactory('slack', () => service);

    await expect(
      manager.startPlugin(createInstance(), (_event: ChannelEvent) => undefined),
    ).rejects.toThrow('boom');
    expect(manager.getService('slack-1')).toBeUndefined();
    expect(manager.getStatus('slack-1')).toBe('error');
    expect(stop).not.toHaveBeenCalled();
  });

  it('cleans runtime state when stop throws', async () => {
    const manager = new ChannelManager();
    const service: MessagingChannelService = {
      pluginId: 'slack-1',
      pluginType: 'slack',
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        throw new Error('stop failed');
      }),
      isRunning: () => true,
      sendMessage: vi.fn(),
      replyMessage: vi.fn(),
      getGroupMessages: vi.fn(),
      listGroups: vi.fn(),
    };

    manager.registerFactory('slack', () => service);
    await manager.startPlugin(createInstance(), (_event: ChannelEvent) => undefined);

    await expect(manager.stopPlugin('slack-1')).rejects.toThrow('stop failed');
    expect(manager.getService('slack-1')).toBe(service);
    expect(manager.getStatus('slack-1')).toBe('error');
  });

  it('fails cleanly when replacing a running service whose stop throws', async () => {
    const manager = new ChannelManager();
    const firstStart = vi.fn(async () => undefined);
    const firstStop = vi.fn(async () => {
      throw new Error('handoff stop failed');
    });
    const firstService: MessagingChannelService = {
      pluginId: 'slack-1',
      pluginType: 'slack',
      start: firstStart,
      stop: firstStop,
      isRunning: () => true,
      sendMessage: vi.fn(),
      replyMessage: vi.fn(),
      getGroupMessages: vi.fn(),
      listGroups: vi.fn(),
    };

    const secondStart = vi.fn(async () => undefined);
    const secondStop = vi.fn(async () => undefined);
    const secondService: MessagingChannelService = {
      pluginId: 'slack-1',
      pluginType: 'slack',
      start: secondStart,
      stop: secondStop,
      isRunning: () => false,
      sendMessage: vi.fn(),
      replyMessage: vi.fn(),
      getGroupMessages: vi.fn(),
      listGroups: vi.fn(),
    };

    let callCount = 0;
    manager.registerFactory('slack', () => {
      callCount += 1;
      return callCount === 1 ? firstService : secondService;
    });

    await manager.startPlugin(createInstance(), (_event: ChannelEvent) => undefined);

    await expect(
      manager.startPlugin(createInstance(), (_event: ChannelEvent) => undefined),
    ).rejects.toThrow('handoff stop failed');

    expect(secondStart).not.toHaveBeenCalled();
    expect(manager.getService('slack-1')).toBe(firstService);
    expect(manager.getStatus('slack-1')).toBe('error');
  });

  it('serializes concurrent starts for the same channel id', async () => {
    const manager = new ChannelManager();
    let firstRunning = false;
    let secondRunning = false;

    const firstStart = vi.fn(async () => {
      firstRunning = true;
    });
    const firstStop = vi.fn(async () => {
      firstRunning = false;
    });
    const firstService: MessagingChannelService = {
      pluginId: 'slack-1',
      pluginType: 'slack',
      start: firstStart,
      stop: firstStop,
      isRunning: () => firstRunning,
      sendMessage: vi.fn(),
      replyMessage: vi.fn(),
      getGroupMessages: vi.fn(),
      listGroups: vi.fn(),
    };

    const secondStart = vi.fn(async () => {
      secondRunning = true;
    });
    const secondStop = vi.fn(async () => {
      secondRunning = false;
    });
    const secondService: MessagingChannelService = {
      pluginId: 'slack-1',
      pluginType: 'slack',
      start: secondStart,
      stop: secondStop,
      isRunning: () => secondRunning,
      sendMessage: vi.fn(),
      replyMessage: vi.fn(),
      getGroupMessages: vi.fn(),
      listGroups: vi.fn(),
    };

    let factoryCallCount = 0;
    manager.registerFactory('slack', () => {
      factoryCallCount += 1;
      return factoryCallCount === 1 ? firstService : secondService;
    });

    await Promise.all([
      manager.startPlugin(createInstance(), (_event: ChannelEvent) => undefined),
      manager.startPlugin(createInstance(), (_event: ChannelEvent) => undefined),
    ]);

    expect(firstStart).toHaveBeenCalledTimes(1);
    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStart).toHaveBeenCalledTimes(1);
    expect(manager.getService('slack-1')).toBe(secondService);
    expect(manager.getStatus('slack-1')).toBe('running');

    await manager.stopPlugin('slack-1');

    expect(secondStop).toHaveBeenCalledTimes(1);
    expect(manager.getService('slack-1')).toBeUndefined();
    expect(manager.getStatus('slack-1')).toBe('stopped');
  });
});
