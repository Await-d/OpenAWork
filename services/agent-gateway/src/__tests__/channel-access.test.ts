import { describe, expect, it } from 'vitest';
import { resolveSendableChannel } from '../channels/channel-access.js';
import type { ChannelInstance } from '../channels/types.js';

const baseChannel: ChannelInstance = {
  id: 'slack-1',
  type: 'slack',
  name: 'Slack',
  enabled: true,
  config: { botToken: 'xoxb-1', signingSecret: 'secret' },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('resolveSendableChannel', () => {
  it('rejects non-owned or deleted channels', () => {
    const result = resolveSendableChannel([], 'slack-1', true);
    expect(result).toEqual({ ok: false, statusCode: 404, error: 'Channel not found' });
  });

  it('rejects owned channels without running service', () => {
    const result = resolveSendableChannel([baseChannel], 'slack-1', false);
    expect(result).toEqual({ ok: false, statusCode: 409, error: 'Channel service not running' });
  });

  it('allows owned running channels', () => {
    const result = resolveSendableChannel([baseChannel], 'slack-1', true);
    expect(result).toEqual({ ok: true, channel: baseChannel });
  });
});
