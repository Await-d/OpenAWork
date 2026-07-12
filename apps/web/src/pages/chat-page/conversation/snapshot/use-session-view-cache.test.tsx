// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useSessionViewCache } from './use-session-view-cache.js';

describe('useSessionViewCache', () => {
  it('round-trip 保留 streamingSnapshot 里的 upstreamSummary', () => {
    const { result } = renderHook(() => useSessionViewCache());

    result.current.save('session-1', [], null, {
      recoveredStream: {
        messageId: 'm-1',
        startedAt: 100,
        text: 'hello',
        thinkingBlocks: [],
        toolCalls: [],
        upstreamRoute: {
          modelId: 'gpt-5.4',
          providerId: 'openai-fast',
        },
        usage: null,
        upstreamSummary: {
          stopReason: 'cancelled',
          textDeltaCount: 4,
          reasoningDeltaCount: 1,
          toolCallDeltaCount: 0,
          sawDone: false,
          sawError: false,
          stalled: false,
        },
      },
      rightPanelState: {
        planTasks: [],
        agentEvents: [],
        planHistory: [],
        dagNodes: [],
        dagEdges: [],
        toolCalls: [],
        upstreamSummaries: [],
        compactions: [],
        currentGoal: '',
      },
    });

    const restored = result.current.restore('session-1');
    expect(restored?.streamingSnapshot?.recoveredStream.upstreamSummary).toEqual({
      stopReason: 'cancelled',
      textDeltaCount: 4,
      reasoningDeltaCount: 1,
      toolCallDeltaCount: 0,
      sawDone: false,
      sawError: false,
      stalled: false,
    });
    expect(restored?.streamingSnapshot?.recoveredStream.upstreamRoute).toEqual({
      modelId: 'gpt-5.4',
      providerId: 'openai-fast',
    });
  });
});
