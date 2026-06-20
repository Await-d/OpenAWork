import { describe, expect, it } from 'vitest';

import { recoverActiveAssistantStream } from './stream-recovery.js';

describe('recoverActiveAssistantStream', () => {
  it('恢复活动流时保留 usage，并且允许后续附加 upstreamSummary', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'running',
      messages: [],
      runEvents: [
        {
          type: 'text_delta',
          delta: 'hello',
          runId: 'run-1',
          occurredAt: 120,
        },
        {
          type: 'usage',
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          round: 1,
          runId: 'run-1',
          occurredAt: 130,
        },
      ],
    });

    expect(recovered).toMatchObject({
      text: 'hello',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    });
    expect(recovered?.upstreamSummary).toBeUndefined();
  });
});
