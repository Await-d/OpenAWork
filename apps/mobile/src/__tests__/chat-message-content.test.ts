import { describe, expect, it } from 'vitest';
import {
  extractRuntimeTextDelta,
  extractRuntimeThinkingDelta,
  normalizeMobileChatMessages,
} from '../chat-message-content.js';

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

  it('preserves structured reasoning blocks separately from assistant text', () => {
    const messages = normalizeMobileChatMessages([
      {
        id: 'assistant-2',
        role: 'assistant',
        content: [
          { type: 'reasoning', text: '## 先比较方案\n- 保持流式' },
          { type: 'output_text', text: '这是最终正文。' },
        ],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.reasoningBlocks).toEqual(['## 先比较方案\n- 保持流式']);
    expect(messages[0]?.content).toBe('这是最终正文。');
  });

  it('parses assistant_trace json content from other clients into mobile message parts', () => {
    const messages = normalizeMobileChatMessages([
      {
        id: 'assistant-trace',
        role: 'assistant',
        content: JSON.stringify({
          type: 'assistant_trace',
          payload: {
            reasoningBlocks: ['# 判断路径\n先确认结构'],
            text: '最终答复。',
            toolCalls: [{ toolName: 'grep' }],
          },
        }),
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.reasoningBlocks).toEqual(['# 判断路径\n先确认结构']);
    expect(messages[0]?.content).toContain('最终答复。');
    expect(messages[0]?.content).toContain('工具：grep');
  });

  it('extracts runtime thinking deltas from structured reasoning payloads', () => {
    const delta = extractRuntimeThinkingDelta([
      { type: 'reasoning', text: '先比较\n' },
      { field: 'reasoning_details', markdown: '再确认边界' },
    ]);

    expect(delta).toBe('先比较\n再确认边界');
  });
});
