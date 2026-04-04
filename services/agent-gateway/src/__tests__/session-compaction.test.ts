import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  sqliteRun: vi.fn(),
}));

describe('session compaction helpers', () => {
  it('prunes older tool results while keeping the latest ones intact', async () => {
    const { pruneMessagesForCompaction } = await import('../session-compaction.js');

    const messages = [
      {
        id: 'user-1',
        role: 'user' as const,
        createdAt: 1,
        content: [{ type: 'text' as const, text: '先执行工具' }],
      },
      {
        id: 'tool-1',
        role: 'tool' as const,
        createdAt: 2,
        content: [
          {
            type: 'tool_result' as const,
            toolCallId: 'call-1',
            toolName: 'bash',
            output: 'old result 1',
            isError: false,
          },
        ],
      },
      {
        id: 'tool-2',
        role: 'tool' as const,
        createdAt: 3,
        content: [
          {
            type: 'tool_result' as const,
            toolCallId: 'call-2',
            toolName: 'bash',
            output: 'old result 2',
            isError: false,
          },
        ],
      },
      {
        id: 'tool-3',
        role: 'tool' as const,
        createdAt: 4,
        content: [
          {
            type: 'tool_result' as const,
            toolCallId: 'call-3',
            toolName: 'bash',
            output: 'recent result 3',
            isError: false,
          },
        ],
      },
      {
        id: 'tool-4',
        role: 'tool' as const,
        createdAt: 5,
        content: [
          {
            type: 'tool_result' as const,
            toolCallId: 'call-4',
            toolName: 'bash',
            output: 'recent result 4',
            isError: false,
          },
        ],
      },
    ];

    const pruned = pruneMessagesForCompaction(messages, { keepRecentToolResults: 2 });

    expect(pruned[1]?.content[0]).toMatchObject({
      type: 'tool_result',
      output: '[Old tool result content cleared by compaction prune]',
    });
    expect(pruned[2]?.content[0]).toMatchObject({
      type: 'tool_result',
      output: '[Old tool result content cleared by compaction prune]',
    });
    expect(pruned[3]?.content[0]).toMatchObject({
      type: 'tool_result',
      output: 'recent result 3',
    });
    expect(pruned[4]?.content[0]).toMatchObject({
      type: 'tool_result',
      output: 'recent result 4',
    });
  });

  it('falls back to structured summary when compaction llm fails', async () => {
    vi.resetModules();
    vi.doMock('../compaction-llm.js', () => ({
      callCompactionLlm: vi.fn(async () => {
        throw new Error('upstream compact failed');
      }),
    }));
    vi.doMock('../db.js', () => ({
      sqliteAll: vi.fn(() => []),
      sqliteGet: vi.fn((query: string) =>
        query.includes('COUNT(1) AS count') ? { count: 0 } : undefined,
      ),
      sqliteRun: vi.fn(),
    }));

    const { executeSessionCompaction } = await import('../session-compaction.js');

    const result = await executeSessionCompaction({
      metadataJson: '{}',
      messages: [
        {
          id: 'm1',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请继续处理这个会话。' }],
        },
        {
          id: 'm2',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '我先总结一下当前进展。' }],
        },
      ],
      route: {
        apiBaseUrl: 'https://example.invalid',
        apiKey: '',
        maxTokens: 1024,
        model: 'test-model',
        requestOverrides: {},
        supportsThinking: false,
        temperature: 0,
        upstreamProtocol: 'responses',
      },
      sessionId: 'session-1',
      trigger: 'manual',
      userId: 'user-1',
    });

    expect(result.llmErrorMessage).toContain('upstream compact failed');
    expect(result.summary).toContain('Durable session compaction memory');
  });
});
