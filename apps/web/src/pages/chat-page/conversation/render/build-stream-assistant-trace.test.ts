import { describe, expect, it } from 'vitest';
import { buildStreamAssistantTrace } from './build-stream-assistant-trace.js';

describe('buildStreamAssistantTrace', () => {
  it('会生成基础文本 trace', () => {
    const result = buildStreamAssistantTrace({
      accumulatedThinkingBlocks: [],
      messageId: 'm1',
      resolveAssistantCapabilityKind: () => 'tool',
      textContent: 'hello',
      toolCalls: new Map(),
    });

    expect(result.content).toBe('hello');
    expect(result.parts.length).toBeGreaterThan(0);
  });

  it('会把运行中的工具调用按 finalStatus 归一化', () => {
    const result = buildStreamAssistantTrace({
      accumulatedThinkingBlocks: [],
      finalStatus: 'completed',
      messageId: 'm1',
      resolveAssistantCapabilityKind: () => 'tool',
      textContent: 'hello',
      toolCalls: new Map([
        [
          't1',
          {
            createdAt: 1,
            inputText: '{"a":1}',
            status: 'streaming',
            toolCallId: 't1',
            toolName: 'tool-a',
          },
        ],
      ]),
    });

    expect(JSON.stringify(result.parts)).toContain('completed');
  });
});
