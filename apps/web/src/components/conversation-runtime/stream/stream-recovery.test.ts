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

  it('恢复活动流时保留最早解析到的上游路由信息', () => {
    const recovered = recoverActiveAssistantStream({
      hasActiveStream: true,
      activeStreamStartedAt: 100,
      sessionStateStatus: 'running',
      messages: [],
      runEvents: [
        {
          type: 'upstream_route',
          modelId: 'gpt-5.4',
          providerId: 'openai-fast',
          runId: 'run-1',
          occurredAt: 110,
        },
        {
          type: 'text_delta',
          delta: 'hello',
          runId: 'run-1',
          occurredAt: 120,
        },
      ],
    });

    expect(recovered?.upstreamRoute).toEqual({
      modelId: 'gpt-5.4',
      providerId: 'openai-fast',
    });
  });
});
