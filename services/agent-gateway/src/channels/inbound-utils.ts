import type { ChannelMessage } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const child = value[key];
  return isRecord(child) ? child : null;
}

export function readString(value: unknown, key: string): string {
  if (!isRecord(value)) {
    return '';
  }
  const child = value[key];
  if (typeof child === 'string') {
    return child;
  }
  if (typeof child === 'number' || typeof child === 'boolean') {
    return String(child);
  }
  return '';
}

export function readRecordArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!isRecord(value)) {
    return [];
  }
  const child = value[key];
  if (!Array.isArray(child)) {
    return [];
  }
  return child.filter(isRecord);
}

export function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeInboundRaw(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  const parsed = parseJsonRecord(raw);
  return parsed ?? raw;
}

export function readTimestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function parseSimpleEnvelope(raw: unknown): ChannelMessage | null {
  const data = normalizeInboundRaw(raw);
  if (!isRecord(data)) {
    return null;
  }

  const chatId = readString(data, 'chatId');
  const content = readString(data, 'content');
  if (!chatId || !content) {
    return null;
  }

  return {
    id: readString(data, 'messageId') || readString(data, 'id') || `${Date.now()}`,
    senderId: readString(data, 'senderId') || 'unknown',
    senderName: readString(data, 'senderName') || readString(data, 'senderId') || 'unknown',
    chatId,
    chatName: readString(data, 'chatName') || undefined,
    content,
    timestamp: readTimestamp(data['timestamp']),
    raw: data,
  };
}

export function stripLeadingMentions(content: string): string {
  return content
    .replace(/^(?:<@!?[^>]+>\s*)+/, '')
    .replace(/^(?:@\S+\s*)+/, '')
    .trim();
}
