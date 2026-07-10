export type QQChatTargetType = 'c2c' | 'group' | 'channel';

export interface QQChatTarget {
  readonly type: QQChatTargetType;
  readonly id: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
}

function parsePrefixedQQChatId(
  type: QQChatTargetType,
  rawId: string,
  originalChatId: string,
): QQChatTarget {
  const id = rawId.trim();
  if (!id) {
    throw new Error(`Invalid QQ ${type} chat ID: ${originalChatId}`);
  }
  return { type, id };
}

export function parseQQChatId(chatId: string): QQChatTarget {
  const normalized = chatId.replace(/^qqbot:/i, '').trim();

  if (normalized.startsWith('c2c:')) {
    return parsePrefixedQQChatId('c2c', normalized.slice(4), chatId);
  }

  if (normalized.startsWith('group:')) {
    return parsePrefixedQQChatId('group', normalized.slice(6), chatId);
  }

  if (normalized.startsWith('channel:')) {
    return parsePrefixedQQChatId('channel', normalized.slice(8), chatId);
  }

  if (/^[0-9a-fA-F]{32}$/.test(normalized) || isUuid(normalized)) {
    return { type: 'c2c', id: normalized };
  }

  throw new Error(`Unsupported QQ chat ID format: ${chatId}`);
}
