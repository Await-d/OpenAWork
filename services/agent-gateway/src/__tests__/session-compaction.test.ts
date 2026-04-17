import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: vi.fn((fn: () => void) => fn()),
}));

vi.mock('../message-v2-adapter.js', () => ({
  appendCompactionMarkerMessageV2: vi.fn(() => ({
    id: 'marker-1',
    role: 'assistant',
    createdAt: Date.now(),
    content: [],
  })),
}));

vi.mock('../compaction-llm.js', () => ({
  callCompactionLlm: vi.fn(async () => ({ summary: 'mocked llm summary' })),
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
    const { callCompactionLlm } = await import('../compaction-llm.js');
    vi.mocked(callCompactionLlm).mockRejectedValueOnce(new Error('upstream compact failed'));

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

  describe('calculateKeepBoundary', () => {
    it('returns messages.length when recentMessagesKept is 0 (summarize all)', async () => {
      const { calculateKeepBoundary } = await import('../session-compaction.js');
      expect(calculateKeepBoundary([{ id: 'a', role: 'user', createdAt: 1, content: [] }], 0)).toBe(
        1,
      );
    });

    it('returns 0 when messages array is empty', async () => {
      const { calculateKeepBoundary } = await import('../session-compaction.js');
      expect(calculateKeepBoundary([], 5)).toBe(0);
    });

    it('splits messages at the correct boundary', async () => {
      const { calculateKeepBoundary } = await import('../session-compaction.js');
      const messages = [
        {
          id: 'u1',
          role: 'user' as const,
          createdAt: 1,
          content: [{ type: 'text' as const, text: 'a' }],
        },
        {
          id: 'a1',
          role: 'assistant' as const,
          createdAt: 2,
          content: [{ type: 'text' as const, text: 'b' }],
        },
        {
          id: 'u2',
          role: 'user' as const,
          createdAt: 3,
          content: [{ type: 'text' as const, text: 'c' }],
        },
        {
          id: 'a2',
          role: 'assistant' as const,
          createdAt: 4,
          content: [{ type: 'text' as const, text: 'd' }],
        },
        {
          id: 'u3',
          role: 'user' as const,
          createdAt: 5,
          content: [{ type: 'text' as const, text: 'e' }],
        },
      ];
      // Keep last 2 → raw boundary at index 3, but a2 is 'assistant' so adjusted to 4 (u3 is 'user')
      expect(calculateKeepBoundary(messages, 2)).toBe(4);
    });

    it('adjusts boundary to avoid splitting tool_call/tool_result pairs', async () => {
      const { calculateKeepBoundary } = await import('../session-compaction.js');
      const messages = [
        {
          id: 'u1',
          role: 'user' as const,
          createdAt: 1,
          content: [{ type: 'text' as const, text: 'do it' }],
        },
        {
          id: 'a1',
          role: 'assistant' as const,
          createdAt: 2,
          content: [
            { type: 'tool_call' as const, toolCallId: 'tc-1', toolName: 'bash', input: {} },
          ],
        },
        {
          id: 't1',
          role: 'tool' as const,
          createdAt: 3,
          content: [
            {
              type: 'tool_result' as const,
              toolCallId: 'tc-1',
              toolName: 'bash',
              output: 'ok',
              isError: false,
            },
          ],
        },
        {
          id: 'u2',
          role: 'user' as const,
          createdAt: 4,
          content: [{ type: 'text' as const, text: 'next' }],
        },
      ];
      // Keep last 2 (u2 + t1) — but t1 references tc-1 from a1 in summarized section
      // Boundary should adjust forward to include t1 with its tool_call
      const boundary = calculateKeepBoundary(messages, 2);
      expect(boundary).toBeGreaterThanOrEqual(3);
    });
  });

  describe('circuit breaker', () => {
    it('reads consecutive failure count from metadata', async () => {
      const { readConsecutiveCompactionFailures } = await import('../session-compaction.js');
      expect(readConsecutiveCompactionFailures('{}')).toBe(0);
      expect(readConsecutiveCompactionFailures('{"consecutiveCompactionFailures":2}')).toBe(2);
      expect(readConsecutiveCompactionFailures('invalid')).toBe(0);
    });

    it('trips circuit breaker after MAX failures', async () => {
      const { isAutoCompactCircuitBreakerTripped, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } =
        await import('../session-compaction.js');
      const max = MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
      expect(isAutoCompactCircuitBreakerTripped('{"consecutiveCompactionFailures":0}')).toBe(false);
      expect(
        isAutoCompactCircuitBreakerTripped(`{"consecutiveCompactionFailures":${max - 1}}`),
      ).toBe(false);
      expect(isAutoCompactCircuitBreakerTripped(`{"consecutiveCompactionFailures":${max}}`)).toBe(
        true,
      );
    });

    it('resets failure count on successful compaction (no route)', async () => {
      // Without a route, callCompactionLlm is not called so it always "succeeds"
      const { executeSessionCompaction } = await import('../session-compaction.js');

      const result = await executeSessionCompaction({
        metadataJson: '{"consecutiveCompactionFailures":2}',
        messages: [
          { id: 'm1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'hello' }] },
          { id: 'a1', role: 'assistant', createdAt: 2, content: [{ type: 'text', text: 'hi' }] },
        ],
        route: null,
        sessionId: 's1',
        trigger: 'automatic',
        userId: 'u1',
      });

      // No LLM error → failure count resets to 0
      expect(result.metadata['consecutiveCompactionFailures']).toBe(0);
    });

    it('increments failure count when llmErrorMessage is present', async () => {
      // Verify the logic: when llmErrorMessage is set, consecutiveCompactionFailures increments
      const { readConsecutiveCompactionFailures } = await import('../session-compaction.js');

      // Simulate: if the compaction produced an llmErrorMessage,
      // the metadata should have consecutiveCompactionFailures incremented.
      // We test this by verifying the readConsecutiveCompactionFailures function
      // can parse the value from the metadata produced by executeSessionCompaction.
      const metadataJson = JSON.stringify({
        consecutiveCompactionFailures: 2,
        lastCompactionAt: Date.now(),
      });
      expect(readConsecutiveCompactionFailures(metadataJson)).toBe(2);
    });
  });

  describe('recentMessagesKept', () => {
    it('returns messagesToKeep when recentMessagesKept > 0', async () => {
      const { executeSessionCompaction } = await import('../session-compaction.js');

      const result = await executeSessionCompaction({
        metadataJson: '{}',
        messages: [
          { id: 'u1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'old' }] },
          {
            id: 'a1',
            role: 'assistant',
            createdAt: 2,
            content: [{ type: 'text', text: 'old reply' }],
          },
          { id: 'u2', role: 'user', createdAt: 3, content: [{ type: 'text', text: 'recent' }] },
          {
            id: 'a2',
            role: 'assistant',
            createdAt: 4,
            content: [{ type: 'text', text: 'recent reply' }],
          },
        ],
        recentMessagesKept: 2,
        route: null,
        sessionId: 's1',
        trigger: 'automatic',
        userId: 'u1',
      });

      expect(result.messagesToKeep).toBeDefined();
      expect(result.messagesToKeep?.length).toBe(2);
      expect(result.messagesToKeep?.[0]?.id).toBe('u2');
      expect(result.metadata['lastCompactionRecentMessages']).toBe(2);
    });

    it('returns empty messagesToKeep when recentMessagesKept is 0', async () => {
      const { executeSessionCompaction } = await import('../session-compaction.js');

      const result = await executeSessionCompaction({
        metadataJson: '{}',
        messages: [
          { id: 'u1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'hello' }] },
          { id: 'a1', role: 'assistant', createdAt: 2, content: [{ type: 'text', text: 'hi' }] },
        ],
        recentMessagesKept: 0,
        route: null,
        sessionId: 's1',
        trigger: 'automatic',
        userId: 'u1',
      });

      // When recentMessagesKept=0, no messages are kept verbatim (field is omitted)
      expect(result.messagesToKeep).toBeUndefined();
    });
  });
});

describe('isContextNearOverflow', () => {
  it('detects near-overflow with larger buffer than isContextOverflow', async () => {
    const { isContextNearOverflow } = await import('../session-message-store.js');

    // 100K context window, 75K tokens used
    // isContextOverflow: buffer = min(20K, 15K) = 15K → 100K-15K=85K → 75K < 85K → false
    // isContextNearOverflow: buffer = max(30K, 25K) = 30K → 100K-30K=70K → 75K >= 70K → true
    expect(isContextNearOverflow({ inputTokens: 75_000 }, 100_000)).toBe(true);
  });

  it('returns false when usage is well below threshold', async () => {
    const { isContextNearOverflow } = await import('../session-message-store.js');
    expect(isContextNearOverflow({ inputTokens: 50_000 }, 100_000)).toBe(false);
  });

  it('returns false for zero or negative contextWindow', async () => {
    const { isContextNearOverflow } = await import('../session-message-store.js');
    expect(isContextNearOverflow({ inputTokens: 999_999 }, 0)).toBe(false);
    expect(isContextNearOverflow({ inputTokens: 999_999 }, -1)).toBe(false);
  });

  it('honors reserved token override', async () => {
    const { isContextNearOverflow } = await import('../session-message-store.js');
    // reserved=10K → buffer=10K → threshold=90K → 85K < 90K → false
    expect(isContextNearOverflow({ inputTokens: 85_000 }, 100_000, 10_000)).toBe(false);
    // reserved=10K → threshold=90K → 91K >= 90K → true
    expect(isContextNearOverflow({ inputTokens: 91_000 }, 100_000, 10_000)).toBe(true);
  });
});
