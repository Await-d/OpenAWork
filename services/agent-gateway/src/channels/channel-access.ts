import type { ChannelInstance } from './types.js';

export function resolveSendableChannel(
  storedChannels: ChannelInstance[],
  channelId: string,
  hasRunningService: boolean,
): { ok: true; channel: ChannelInstance } | { ok: false; statusCode: 404 | 409; error: string } {
  const channel = storedChannels.find((entry) => entry.id === channelId);
  if (!channel) {
    return { ok: false, statusCode: 404, error: 'Channel not found' };
  }

  if (!hasRunningService) {
    return { ok: false, statusCode: 409, error: 'Channel service not running' };
  }

  return { ok: true, channel };
}
