import { describe, expect, it } from 'vitest';
import { microcompactMessages } from '../../compaction/microcompact.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';

describe('工具附件结构化关联', () => {
  it('不依赖展示文案或紧邻位置清除来源工具的附件', () => {
    const messages: UnifiedMessage[] = [
      { role: 'tool', toolCallId: 'old', toolName: 'desktop', content: 'x'.repeat(30_000) },
      { role: 'assistant', content: '中间消息' },
      {
        role: 'user',
        content: '可本地化的附件提示',
        syntheticKind: 'tool-attachments',
        sourceToolCallId: 'old',
        images: [{ imageUrl: 'https://example.com/a.png' }],
      },
      { role: 'tool', toolCallId: 'new', toolName: 'desktop', content: 'y'.repeat(30_000) },
    ];

    const result = microcompactMessages(messages);
    expect(result.messages.some((message) => message.role === 'user' && message.images)).toBe(
      false,
    );
  });
});
