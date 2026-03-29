import { describe, expect, it } from 'vitest';
import { shouldHandleChannelEvent } from '../channels/subscription-filter.js';
import type { ChannelEvent, ChannelInstance } from '../channels/types.js';

const baseMessageEvent: ChannelEvent = {
  type: 'message',
  pluginId: 'slack-1',
  message: {
    id: 'msg-1',
    senderId: 'user-1',
    senderName: 'User 1',
    chatId: 'C123',
    content: 'hello',
    timestamp: Date.now(),
  },
};

describe('shouldHandleChannelEvent', () => {
  it('allows messages when no subscriptions are configured', () => {
    const instance: ChannelInstance = {
      id: 'slack-1',
      type: 'slack',
      name: 'Slack',
      enabled: true,
      config: { botToken: 'xoxb-1', signingSecret: 'secret' },
      subscriptions: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(shouldHandleChannelEvent(instance, baseMessageEvent)).toBe(true);
  });

  it('blocks messages outside enabled subscriptions', () => {
    const instance: ChannelInstance = {
      id: 'slack-1',
      type: 'slack',
      name: 'Slack',
      enabled: true,
      config: { botToken: 'xoxb-1', signingSecret: 'secret' },
      subscriptions: [{ chatId: 'C999', name: 'ops', enabled: true }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(shouldHandleChannelEvent(instance, baseMessageEvent)).toBe(false);
  });

  it('fails closed when the channel instance is missing', () => {
    expect(shouldHandleChannelEvent(undefined, baseMessageEvent)).toBe(false);
  });

  it('allows messages for matching enabled subscriptions', () => {
    const instance: ChannelInstance = {
      id: 'slack-1',
      type: 'slack',
      name: 'Slack',
      enabled: true,
      config: { botToken: 'xoxb-1', signingSecret: 'secret' },
      subscriptions: [{ chatId: 'C123', name: '研发频道', enabled: true }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(shouldHandleChannelEvent(instance, baseMessageEvent)).toBe(true);
  });
});
