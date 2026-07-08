import type { ChannelMessage } from '../types.js';
import {
  normalizeInboundRaw,
  parseSimpleEnvelope,
  readRecord,
  readRecordArray,
  readString,
  readTimestamp,
} from '../inbound-utils.js';

export function parseWhatsAppInboundMessage(raw: unknown): ChannelMessage | null {
  const envelope = parseSimpleEnvelope(raw);
  if (envelope) {
    return envelope;
  }

  const data = normalizeInboundRaw(raw);
  const entry = readRecordArray(data, 'entry')[0];
  const change = readRecordArray(entry, 'changes')[0];
  const value = readRecord(change, 'value');
  const message = readRecordArray(value, 'messages')[0];
  const contact = readRecordArray(value, 'contacts')[0];
  const profile = readRecord(contact, 'profile');
  const text = readRecord(message, 'text');
  const from = readString(message, 'from');
  const content = readString(text, 'body');
  if (!from || !content) {
    return null;
  }

  return {
    id: readString(message, 'id') || `${Date.now()}`,
    senderId: from,
    senderName: readString(profile, 'name') || from,
    chatId: from,
    content,
    timestamp: readTimestamp(readString(message, 'timestamp')),
    raw: data,
  };
}
