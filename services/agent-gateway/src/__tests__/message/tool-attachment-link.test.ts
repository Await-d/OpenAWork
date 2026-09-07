import { describe, expect, it } from 'vitest';
import { microcompactMessages } from '../../compaction/microcompact.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';

describe('工具附件结构化关联', () => {
  it('不依赖展示文案或紧邻位置清除来源工具的附件', () => {
    const messages: UnifiedMessage[] = [
      { role: 'user', content: '最旧轮次' },
      { role: 'tool', toolCallId: 'old', toolName: 'desktop_control', content: 'x'.repeat(84_000) },
      {
        role: 'user',
        content: '可本地化的附件提示',
        syntheticKind: 'tool-attachments',
        sourceToolCallId: 'old',
        images: [{ imageUrl: 'https://example.com/a.png' }],
      },
      { role: 'user', content: '较新轮次' },
      {
        role: 'tool',
        toolCallId: 'new',
        toolName: 'desktop_control',
        content: 'y'.repeat(160_000),
      },
      { role: 'user', content: '上一轮' },
      { role: 'tool', toolCallId: 'keep', toolName: 'desktop_control', content: 'z'.repeat(8_000) },
      { role: 'user', content: '当前轮次' },
      {
        role: 'tool',
        toolCallId: 'current',
        toolName: 'desktop_control',
        content: 'q'.repeat(8_000),
      },
    ];

    const result = microcompactMessages(messages);
    expect(result.messages.some((message) => message.role === 'user' && message.images)).toBe(
      false,
    );
  });
});
