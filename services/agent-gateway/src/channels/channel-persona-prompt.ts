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
      'Inside a channel session, PluginSendMessage / PluginSendImage / PluginSendFile automatically use the current channel and current conversation. Do not manually fill plugin_id/chat_id, and do not give up just because you cannot see explicit IDs.',
      'When the user asks for a file, or you need to deliver a document/archive, prefer PluginSendFile (file_path supports workspace paths and HTTP/HTTPS URLs).',
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
    '在 channel session 中，PluginSendMessage / PluginSendImage / PluginSendFile 会自动使用当前通道和当前会话，不需要也不要手写 plugin_id/chat_id；不要因为看不到显式 ID 而放弃调用工具。',
    '当用户要求文件，或你需要交付文档、压缩包等非图片附件时，优先调用 PluginSendFile（file_path 支持工作区路径与 HTTP/HTTPS URL）。',
    '如果需要把图片回复到历史消息，先用 PluginGetCurrentChatMessages 获取该消息的 replyMessageId，再把它作为 PluginSendImage 的 message_id；普通当前消息回复可以省略 message_id。',
    '当用户要求图片、媒体、随便发张图，或你拿到 HTTP/HTTPS 图片 URL 时，优先调用 PluginSendImage 发送真实图片附件；不要只发送 Markdown 图片或普通 URL。',
    '</channel-reply-policy>',
  ].join('\n');
}

function readChannelPersona(
  metadata: Record<string, unknown>,
): { readonly content: string; readonly title: string } | null {
  const persona = metadata['channelPersona'];
  if (!isRecord(persona)) {
    return null;
  }

  const content = persona['content'];
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  const rawTitle = persona['title'];
  return {
    content: content.trim(),
    title: typeof rawTitle === 'string' ? rawTitle.trim() : '',
  };
}

/**
 * 渠道人设（SOUL 正文）走 **stable** 段的 `route-system-prompt` 槽位。
 *
 * 人设只在渠道配置变更时变化，属于「路由级长期角色」——放进 stable 前缀既让
 * 空槽位拿到真正的角色提示词，也不会随每轮对话打断 prompt cache。回复策略与
 * 本地命令提示仍留在动态尾段（见 `buildChannelRuntimePromptFromMetadata`）。
 */
export function resolveChannelPersonaSystemPrompt(metadataJson: string): string | null {
  const metadata = parseSessionMetadataJson(metadataJson);
  if (metadata['source'] !== 'channel') {
    return null;
  }

  const persona = readChannelPersona(metadata);
  if (!persona) {
    return null;
  }

  const replyLanguage = resolveReplyLanguage(metadata);
  const title =
    persona.title || (isEnglishChannelReplyLanguage(replyLanguage) ? 'Default' : '默认');
  return [
    '<channel-persona>',
    isEnglishChannelReplyLanguage(replyLanguage)
      ? `Persona resource bound to this channel: ${title}`
      : `当前消息通道绑定的人设资源：${title}`,
    '',
    persona.content,
    '</channel-persona>',
  ].join('\n');
}

/**
 * 渠道会话的动态尾段提示：回复策略 + 本地命令入口。
 *
 * 人设正文已提升到 stable 段（`resolveChannelPersonaSystemPrompt`），此处刻意
 * 不再重复，避免同一段 SOUL 在两条 system 消息里各出现一次。
 */
export function buildChannelRuntimePromptFromMetadata(metadataJson: string): string | null {
  const metadata = parseSessionMetadataJson(metadataJson);
  if (metadata['source'] !== 'channel') {
    return null;
  }

  const replyLanguage = resolveReplyLanguage(metadata);
  return [
    buildChannelReplyPolicyPrompt(replyLanguage),
    '',
    buildChannelCommandPrompt(resolveChannelPlatform(metadata), replyLanguage),
  ].join('\n');
}
