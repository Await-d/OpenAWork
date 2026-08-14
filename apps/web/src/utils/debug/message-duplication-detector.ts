/**
 * 消息重复检测工具
 * 用于诊断聊天会话中的重复消息渲染问题
 */

import type { ChatMessage } from '../../components/conversation-runtime/messages/support.js';
import type { ChatRenderEntry } from '../../components/chat/message/chat-message-group-list.js';

export interface DuplicationReport {
  hasDuplicates: boolean;
  duplicateIds: string[];
  duplicateDetails: Array<{
    id: string;
    count: number;
    indices: number[];
  }>;
  totalMessages: number;
}

/**
 * 检测消息列表中是否有重复的 message.id
 */
export function detectDuplicateMessages(messages: ChatMessage[]): DuplicationReport {
  const idCount = new Map<string, number[]>();

  messages.forEach((message, index) => {
    const existing = idCount.get(message.id) ?? [];
    existing.push(index);
    idCount.set(message.id, existing);
  });

  const duplicates = Array.from(idCount.entries())
    .filter(([, indices]) => indices.length > 1)
    .map(([id, indices]) => ({
      id,
      count: indices.length,
      indices,
    }));

  return {
    hasDuplicates: duplicates.length > 0,
    duplicateIds: duplicates.map((d) => d.id),
    duplicateDetails: duplicates,
    totalMessages: messages.length,
  };
}

/**
 * 检测渲染条目中是否有重复的 message.id
 */
export function detectDuplicateRenderEntries(entries: ChatRenderEntry[]): DuplicationReport {
  const messages = entries.map((entry) => entry.message);
  return detectDuplicateMessages(messages);
}

/**
 * 移除重复的消息，保留第一次出现的消息
 */
export function deduplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];

  for (const message of messages) {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      result.push(message);
    }
  }

  return result;
}

/**
 * 移除重复的渲染条目，保留第一次出现的条目
 */
export function deduplicateRenderEntries(entries: ChatRenderEntry[]): ChatRenderEntry[] {
  const seen = new Set<string>();
  const result: ChatRenderEntry[] = [];

  for (const entry of entries) {
    if (!seen.has(entry.message.id)) {
      seen.add(entry.message.id);
      result.push(entry);
    }
  }

  return result;
}
