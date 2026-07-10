import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';

const CHANNEL_REPLY_POLICY_PROMPT = [
  '<channel-reply-policy>',
  '你正在通过外部消息通道回复用户。',
  '默认使用中文回复；除非用户明确要求其他语言，或用户最新消息主要使用其他语言，否则保持中文。',
  '回复应适合聊天软件阅读：自然、直接、避免不必要的长篇铺垫。',
  '在 channel session 中，PluginSendMessage / PluginSendImage 会自动使用当前通道和当前会话，不需要也不要手写 plugin_id/chat_id；不要因为看不到显式 ID 而放弃调用工具。',
  '如果需要把图片回复到历史消息，先用 PluginGetCurrentChatMessages 获取该消息的 replyMessageId，再把它作为 PluginSendImage 的 message_id；普通当前消息回复可以省略 message_id。',
  '当用户要求图片、媒体、随便发张图，或你拿到 HTTP/HTTPS 图片 URL 时，优先调用 PluginSendImage 发送真实图片附件；不要只发送 Markdown 图片或普通 URL。',
  '</channel-reply-policy>',
].join('\n');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildChannelPersonaPromptFromMetadata(metadataJson: string): string | null {
  const metadata = parseSessionMetadataJson(metadataJson);
  if (metadata['source'] !== 'channel') {
    return null;
  }

  const persona = metadata['channelPersona'];
  if (!isRecord(persona)) {
    return CHANNEL_REPLY_POLICY_PROMPT;
  }

  const title = persona['title'];
  const content = persona['content'];
  if (typeof title !== 'string' || typeof content !== 'string' || content.trim().length === 0) {
    return CHANNEL_REPLY_POLICY_PROMPT;
  }

  return [
    CHANNEL_REPLY_POLICY_PROMPT,
    '',
    '<channel-persona>',
    `当前消息通道绑定的人设资源：${title.trim()}`,
    '',
    content.trim(),
    '</channel-persona>',
  ].join('\n');
}
