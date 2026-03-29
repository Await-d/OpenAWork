import type { ChannelEvent, ChannelInstance } from './types.js';

export function shouldHandleChannelEvent(
  instance: ChannelInstance | undefined,
  event: ChannelEvent,
): boolean {
  if (event.type !== 'message') {
    return true;
  }

  if (!instance) {
    return false;
  }

  const enabledSubscriptions =
    instance.subscriptions?.filter((subscription) => subscription.enabled) ?? [];
  if (enabledSubscriptions.length === 0) {
    return true;
  }

  return enabledSubscriptions.some((subscription) => subscription.chatId === event.message.chatId);
}
