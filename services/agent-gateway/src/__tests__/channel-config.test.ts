import { describe, expect, it } from 'vitest';
import {
  channelCreateSchema,
  createChannelInstance,
  materializeStoredChannels,
} from '../channel-config.js';

describe('channelCreateSchema', () => {
  it('accepts supported slack channel payloads', () => {
    const result = channelCreateSchema.safeParse({
      type: 'slack',
      name: 'Slack Bot',
      enabled: true,
      config: {
        botToken: 'xoxb-123',
        signingSecret: 'secret',
      },
    });

    expect(result.success).toBe(true);
  });
});

describe('createChannelInstance', () => {
  it('normalizes config values and subscriptions', () => {
    const instance = createChannelInstance(
      {
        type: 'feishu',
        name: ' 飞书通知 ',
        enabled: true,
        config: {
          appId: ' cli_123 ',
          appSecret: ' secret ',
          encryptKey: '',
        },
        subscriptions: [
          { chatId: 'oc_1', name: '研发群', enabled: true },
          { chatId: 'oc_1', name: '研发群重复', enabled: true },
        ],
      },
      'user-1',
    );

    expect(instance.name).toBe('飞书通知');
    expect(instance.config).toEqual({ appId: 'cli_123', appSecret: 'secret' });
    expect(instance.subscriptions).toEqual([{ chatId: 'oc_1', name: '研发群重复', enabled: true }]);
    expect(instance.ownerUserId).toBe('user-1');
  });
});

describe('materializeStoredChannels', () => {
  it('filters malformed entries and preserves valid channels', () => {
    const channels = materializeStoredChannels(
      [
        {
          id: 'discord-1',
          type: 'discord',
          name: 'Discord Bot',
          enabled: true,
          config: { token: 'discord-token' },
          subscriptions: [{ chatId: 'guild-1', name: 'Guild 1', enabled: true }],
        },
        {
          id: '',
          type: 'discord',
          name: 'Broken',
          enabled: true,
          config: {},
        },
      ],
      'user-2',
    );

    expect(channels).toHaveLength(1);
    expect(channels[0]?.id).toBe('discord-1');
    expect(channels[0]?.subscriptions).toEqual([
      { chatId: 'guild-1', name: 'Guild 1', enabled: true },
    ]);
  });
});
