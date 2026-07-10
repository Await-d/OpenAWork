import type { ChannelEvent, ChannelInstance, ChannelMessage } from './types.js';

const CONTENT_PREVIEW_LIMIT = 120;

export function channelLogInfo(message: string, details: Record<string, unknown>): void {
  console.info(`[channels] ${message}`, details);
}

export function channelLogWarn(message: string, details: Record<string, unknown>): void {
  console.warn(`[channels] ${message}`, details);
}

export function summarizeChannelInstance(channel: ChannelInstance): Record<string, unknown> {
  return {
    pluginId: channel.id,
    pluginType: channel.type,
    name: channel.name,
    enabled: channel.enabled,
    autoReply: channel.features?.autoReply ?? true,
    streamingReply: channel.features?.streamingReply ?? false,
    autoStart: channel.features?.autoStart ?? true,
    ownerUserId: channel.ownerUserId,
  };
}

export function summarizeChannelMessage(message: ChannelMessage): Record<string, unknown> {
  return {
    messageId: message.id,
    chatId: message.chatId,
    chatName: message.chatName,
    senderId: message.senderId,
    senderName: message.senderName,
    contentLength: message.content.length,
    contentPreview: previewText(message.content),
    timestamp: message.timestamp,
    rawEventType: readRawEventType(message.raw),
    attachmentSummary: summarizeRawAttachments(message.raw),
  };
}

export function summarizeChannelEvent(event: ChannelEvent): Record<string, unknown> {
  switch (event.type) {
    case 'message':
      return {
        pluginId: event.pluginId,
        eventType: event.type,
        ...summarizeChannelMessage(event.message),
      };
    case 'error':
      return { pluginId: event.pluginId, eventType: event.type, error: event.error };
    case 'status':
      return { pluginId: event.pluginId, eventType: event.type, status: event.status };
  }
}

export function previewText(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= CONTENT_PREVIEW_LIMIT) {
    return compact;
  }
  return `${compact.slice(0, CONTENT_PREVIEW_LIMIT)}...`;
}

function readRawEventType(raw: unknown): string | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const eventType = raw['t'];
  return typeof eventType === 'string' ? eventType : undefined;
}

function summarizeRawAttachments(raw: unknown): string | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const data = isRecord(raw['d']) ? raw['d'] : raw;
  const attachments = data['attachments'];
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }
  const first = attachments[0];
  const contentType =
    isRecord(first) && typeof first['content_type'] === 'string'
      ? first['content_type']
      : 'unknown';
  return `${attachments.length} attachment(s), first=${contentType}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
