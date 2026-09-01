import { describe, expect, it } from 'vitest';
import { normalizeMobileChatMessages } from './chat-message-content.js';

describe('normalizeMobileChatMessages', () => {
  it('按首次出现顺序去除重复消息 id，避免 FlatList key 冲突', () => {
    const messages = normalizeMobileChatMessages([
      { id: 'same-id', role: 'user', content: '第一次' },
      { id: 'same-id', role: 'user', content: '重复项' },
      { id: 'next-id', role: 'assistant', content: '下一条' },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.id)).toEqual(['same-id', 'next-id']);
    expect(messages[0]?.content).toBe('第一次');
  });
});
