import { SUPPORTED_CHANNEL_PLATFORMS, type ChannelPlatform } from './types.js';
import { buildChannelCommandPrompt } from './channel-localization.js';
import {
  isEnglishChannelReplyLanguage,
  normalizeChannelReplyLanguage,
  type ChannelReplyLanguage,
} from './channel-reply-language.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveChannelPlatform(metadata: Record<string, unknown>): ChannelPlatform | null {
  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return null;
  }
  const type = channel['type'];
  return typeof type === 'string' &&
    (SUPPORTED_CHANNEL_PLATFORMS as readonly string[]).includes(type)
    ? (type as ChannelPlatform)
    : null;
}

function resolveReplyLanguage(metadata: Record<string, unknown>): ChannelReplyLanguage {
  const topLevel = metadata['replyLanguage'];
  if (typeof topLevel === 'string') {
    return normalizeChannelReplyLanguage(topLevel);
  }

  const channel = metadata['channel'];
  if (!isRecord(channel)) {
    return normalizeChannelReplyLanguage(undefined);
  }

  return normalizeChannelReplyLanguage(channel['replyLanguage']);
}

function buildChannelReplyPolicyPrompt(language: ChannelReplyLanguage): string {
  if (isEnglishChannelReplyLanguage(language)) {
    return [
      '<channel-reply-policy>',
      'You are replying to the user through an external messaging channel.',
      'Default to English unless the user clearly asks for another language.',
      'Replies should fit chat apps: natural, direct, and without unnecessary preamble.',
      'Inside a channel session, PluginSendMessage / PluginSendImage automatically use the current channel and current conversation. Do not manually fill plugin_id/chat_id, and do not give up just because you cannot see explicit IDs.',
      'If you need to reply with an image to an older message, call PluginGetCurrentChatMessages first, get its replyMessageId, and pass that as PluginSendImage.message_id. For a normal reply to the current message, message_id can be omitted.',
      'When the user wants an image or media, or you receive an HTTP/HTTPS image URL, prefer PluginSendImage so the channel gets a real image attachment rather than only Markdown image syntax or a plain URL.',
      '</channel-reply-policy>',
    ].join('\n');
  }

  return [
    '<channel-reply-policy>',
    '你正在通过外部消息通道回复用户。',
    '默认使用中文回复；除非用户明确要求其他语言，或用户最新消息主要使用其他语言，否则保持中文。',
    '回复应适合聊天软件阅读：自然、直接、避免不必要的长篇铺垫。',
    '在 channel session 中，PluginSendMessage / PluginSendImage 会自动使用当前通道和当前会话，不需要也不要手写 plugin_id/chat_id；不要因为看不到显式 ID 而放弃调用工具。',
    '如果需要把图片回复到历史消息，先用 PluginGetCurrentChatMessages 获取该消息的 replyMessageId，再把它作为 PluginSendImage 的 message_id；普通当前消息回复可以省略 message_id。',
    '当用户要求图片、媒体、随便发张图，或你拿到 HTTP/HTTPS 图片 URL 时，优先调用 PluginSendImage 发送真实图片附件；不要只发送 Markdown 图片或普通 URL。',
    '</channel-reply-policy>',
  ].join('\n');
}

export function buildChannelPersonaPromptFromMetadata(metadataJson: string): string | null {
  const metadata = parseSessionMetadataJson(metadataJson);
  if (metadata['source'] !== 'channel') {
    return null;
  }

  const replyLanguage = resolveReplyLanguage(metadata);
  const replyPolicyPrompt = buildChannelReplyPolicyPrompt(replyLanguage);
  const commandPrompt = buildChannelCommandPrompt(resolveChannelPlatform(metadata), replyLanguage);

  const persona = metadata['channelPersona'];
  if (!isRecord(persona)) {
    return [replyPolicyPrompt, '', commandPrompt].join('\n');
  }

  const title = persona['title'];
  const content = persona['content'];
  if (typeof title !== 'string' || typeof content !== 'string' || content.trim().length === 0) {
    return [replyPolicyPrompt, '', commandPrompt].join('\n');
  }

  return [
    replyPolicyPrompt,
    '',
    commandPrompt,
    '',
    '<channel-persona>',
    isEnglishChannelReplyLanguage(replyLanguage)
      ? `Persona resource bound to this channel: ${title.trim()}`
      : `当前消息通道绑定的人设资源：${title.trim()}`,
    '',
    content.trim(),
    '</channel-persona>',
  ].join('\n');
}
