import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';

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
    return null;
  }

  const title = persona['title'];
  const content = persona['content'];
  if (typeof title !== 'string' || typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  return [
    '<channel-persona>',
    `当前消息通道绑定的人设资源：${title.trim()}`,
    '',
    content.trim(),
    '</channel-persona>',
  ].join('\n');
}
