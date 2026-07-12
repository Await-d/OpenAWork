export type ChannelReplyLanguage = 'zh-CN' | 'en-US';

export const DEFAULT_CHANNEL_REPLY_LANGUAGE: ChannelReplyLanguage = 'zh-CN';

export function normalizeChannelReplyLanguage(value: unknown): ChannelReplyLanguage {
  return value === 'en-US' ? 'en-US' : DEFAULT_CHANNEL_REPLY_LANGUAGE;
}

export function isEnglishChannelReplyLanguage(
  value: ChannelReplyLanguage | null | undefined,
): boolean {
  return normalizeChannelReplyLanguage(value) === 'en-US';
}
