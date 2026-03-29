import { describe, expect, it } from 'vitest';
import { extractRuntimeTextDelta, normalizeMobileChatMessages } from '../chat-message-content.js';

describe('chat-message-content', () => {
  it('normalizes structured remote messages into readable assistant text', () => {
    const messages = normalizeMobileChatMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'output_text', text: '# 文档标题' },
          { markdown: '第一段' },
          { path: '/home/await/project/OpenAWork' },
          { command: 'pnpm dev' },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain('# 文档标题');
    expect(messages[0]?.content).toContain('第一段');
    expect(messages[0]?.content).toContain('/home/await/project/OpenAWork');
    expect(messages[0]?.content).toContain('pnpm dev');
    expect(messages[0]?.content).not.toContain('[object Object]');
  });

  it('extracts runtime text deltas from nested structured payloads', () => {
    const delta = extractRuntimeTextDelta([
      { type: 'output_text', text: 'Web\n' },
      { value: 'Desktop\n' },
      { content: 'Mobile' },
    ]);

    expect(delta).toBe('Web\nDesktop\nMobile');
    expect(delta).not.toContain('[object Object]');
  });
});
