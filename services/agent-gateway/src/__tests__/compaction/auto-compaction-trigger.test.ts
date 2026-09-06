import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@openAwork/shared';
import type { CompactionSettings } from '../../compaction/compaction-policy.js';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  aggressiveTruncateToolOutputs: vi.fn(),
  executeSessionCompaction: vi.fn(),
  getCompactionProviderConfig: vi.fn(),
  isAutoCompactCircuitBreakerTripped: vi.fn(),
  listSessionMessagesV2: vi.fn(),
  parseContextLimitError: vi.fn(),
  persistCompactionProjection: vi.fn(),
  publishSessionRunEvent: vi.fn(),
  reactiveCompactByTokenGap: vi.fn(),
  recordDiscoveredContextWindow: vi.fn(),
  resolveCompactionRoute: vi.fn(),
  resolveEffectiveContextWindow: vi.fn(),
  trySessionMemoryCompaction: vi.fn(),
}));

vi.mock('../../compaction/context-window-resolver.js', () => ({
  AGGRESSIVE_TRUNCATION_CONFIG: {
    targetTokenRatio: 0.8,
  },
  aggressiveTruncateToolOutputs: mocks.aggressiveTruncateToolOutputs,
  parseContextLimitError: mocks.parseContextLimitError,
  recordDiscoveredContextWindow: mocks.recordDiscoveredContextWindow,
  resolveEffectiveContextWindow: mocks.resolveEffectiveContextWindow,
}));

vi.mock('../../compaction/reactive-compact.js', () => ({
  reactiveCompactByTokenGap: mocks.reactiveCompactByTokenGap,
}));

vi.mock('../../compaction/compaction-projection.js', () => ({
  persistCompactionProjection: mocks.persistCompactionProjection,
}));

vi.mock('../../compaction/session-memory-compact.js', () => ({
  trySessionMemoryCompaction: mocks.trySessionMemoryCompaction,
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: vi.fn(),
  sqliteTransaction: vi.fn(<T>(fn: () => T): T => fn()),
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  listSessionMessagesV2: mocks.listSessionMessagesV2,
}));

vi.mock('../../provider/model-router.js', () => ({
  resolveCompactionRoute: mocks.resolveCompactionRoute,
}));

vi.mock('../../provider/provider-config.js', () => ({
  getCompactionProviderConfig: mocks.getCompactionProviderConfig,
}));

vi.mock('../../session/session-compaction.js', () => ({
  executeSessionCompaction: mocks.executeSessionCompaction,
  isAutoCompactCircuitBreakerTripped: mocks.isAutoCompactCircuitBreakerTripped,
}));

vi.mock('../../session/session-message-store.js', () => ({
  isContextNearOverflow: vi.fn(() => true),
  isContextOverflow: vi.fn(() => true),
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEvent,
}));

import {
  triggerOverflowCompaction,
  triggerProactiveCompaction,
} from '../../compaction/auto-compaction-trigger.js';

const ROUTE: ModelRouteConfig = {
  model: 'mock-model',
  apiBaseUrl: 'http://localhost:0',
  apiKey: 'mock-key',
  contextWindow: 100_000,
  maxTokens: 2_000,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  supportsThinking: false,
};

const COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  prune: true,
  recentMessagesKept: 2,
};

function textMessage(id: string, role: Message['role'], text: string): Message {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    createdAt: 1,
  };
}

function baseContext() {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    metadataJson: '{}',
    clientRequestId: 'request-1',
    runId: 'run-1',
    route: ROUTE,
    compactionSettings: COMPACTION_SETTINGS,
    signal: new AbortController().signal,
  };
}

beforeEach(() => {
  mocks.aggressiveTruncateToolOutputs.mockReset();
  mocks.aggressiveTruncateToolOutputs.mockReturnValue({
    success: false,
    sufficient: false,
    truncatedCount: 0,
    totalCharsRemoved: 0,
  });
  mocks.executeSessionCompaction.mockReset();
  mocks.executeSessionCompaction.mockResolvedValue({
    durableSummary: {
      newlySummarizedMessages: 2,
      persistedMemory: null,
      signature: 'summary-1',
      structuredSummary: '结构化摘要',
      totalRepresentedMessages: 4,
    },
    metadata: { lastCompactionLlmSummary: '最新摘要' },
    metadataJson: '{"lastCompactionLlmSummary":"最新摘要"}',
    summary: '最新摘要',
  });
  mocks.getCompactionProviderConfig.mockReset();
  mocks.getCompactionProviderConfig.mockResolvedValue(null);
  mocks.isAutoCompactCircuitBreakerTripped.mockReset();
  mocks.isAutoCompactCircuitBreakerTripped.mockReturnValue(false);
  mocks.listSessionMessagesV2.mockReset();
  mocks.listSessionMessagesV2.mockReturnValue([]);
  mocks.parseContextLimitError.mockReset();
  mocks.parseContextLimitError.mockReturnValue(null);
  mocks.persistCompactionProjection.mockReset();
  mocks.publishSessionRunEvent.mockReset();
  mocks.reactiveCompactByTokenGap.mockReset();
  mocks.reactiveCompactByTokenGap.mockReturnValue(null);
  mocks.recordDiscoveredContextWindow.mockReset();
  mocks.resolveCompactionRoute.mockReset();
  mocks.resolveEffectiveContextWindow.mockReset();
  mocks.resolveEffectiveContextWindow.mockReturnValue(100_000);
  mocks.trySessionMemoryCompaction.mockReset();
  mocks.trySessionMemoryCompaction.mockResolvedValue(null);
});

describe('自动压缩续跑', () => {
  it('reactive 快速路径必须持久化投影，reload 后完整压缩不得继续读取原始历史', async () => {
    const originalMessages = [
      textMessage('user-old', 'user', '旧问题'),
      textMessage('assistant-old', 'assistant', '旧回答'),
      textMessage('user-recent', 'user', '近期问题'),
      textMessage('assistant-recent', 'assistant', '近期回答'),
    ];
    const projectedMessages = originalMessages.slice(2);
    let reloadedModelInput = originalMessages;

    mocks.listSessionMessagesV2.mockReturnValue(originalMessages);
    mocks.parseContextLimitError.mockReturnValue({
      currentTokens: 120_000,
      maxTokens: 100_000,
    });
    mocks.reactiveCompactByTokenGap.mockReturnValue({
      recovered: true,
      droppedMessages: 2,
      droppedGroups: 1,
      tokensFreed: 20_000,
      remainingMessages: projectedMessages,
    });
    mocks.persistCompactionProjection.mockImplementation(
      (input: { projectedMessages: Message[] }) => {
        reloadedModelInput = input.projectedMessages;
        return {
          metadataJson: '{}',
          projectedMessages: input.projectedMessages,
          summary: '快速投影',
        };
      },
    );

    await triggerOverflowCompaction({
      ...baseContext(),
      round: 2,
      roundResult: {
        overflow: true,
        stopReason: 'error',
        upstreamError: { message: 'context_length_exceeded' },
      },
    });

    expect(reloadedModelInput).toEqual(projectedMessages);
  });

  it('aggressive 工具输出快速路径必须把截断后的投影交给持久化 reload 输入', async () => {
    const originalMessages = [
      textMessage('user-old', 'user', '旧问题'),
      textMessage('assistant-old', 'assistant', '旧回答'),
    ];
    const projectedMessages = [textMessage('user-projected', 'user', '截断后的问题')];
    let reloadedModelInput = originalMessages;

    mocks.listSessionMessagesV2.mockReturnValue(originalMessages);
    mocks.parseContextLimitError.mockReturnValue({
      currentTokens: 120_000,
      maxTokens: 100_000,
    });
    mocks.aggressiveTruncateToolOutputs.mockReturnValue({
      success: true,
      sufficient: true,
      truncatedCount: 1,
      totalCharsRemoved: 4_000,
      messages: projectedMessages,
    });
    mocks.persistCompactionProjection.mockImplementation(
      (input: { projectedMessages: Message[] }) => {
        reloadedModelInput = input.projectedMessages;
        return {
          metadataJson: '{}',
          projectedMessages: input.projectedMessages,
          summary: '快速投影',
        };
      },
    );

    await triggerOverflowCompaction({
      ...baseContext(),
      round: 2,
      roundResult: {
        overflow: true,
        stopReason: 'error',
        upstreamError: { message: 'context_length_exceeded' },
      },
    });

    expect(reloadedModelInput).toEqual(projectedMessages);
  });

  it('provider 在发送当前用户请求前报上下文溢出时，会排除压缩标记后的当前请求并重放', async () => {
    const previousMessages = [
      textMessage('user-old', 'user', '旧问题'),
      textMessage('assistant-old', 'assistant', '旧回答'),
      textMessage('user-current', 'user', '当前问题'),
    ];
    mocks.listSessionMessagesV2.mockReturnValue(previousMessages);

    const result = await triggerOverflowCompaction({
      ...baseContext(),
      round: 2,
      roundResult: {
        overflow: true,
        stopReason: 'error',
        upstreamError: { message: 'context_length_exceeded' },
      },
    });

    expect(result).toMatchObject({
      triggered: true,
      recovered: true,
      metadataJson: '{"lastCompactionLlmSummary":"最新摘要"}',
    });
    expect(result.syntheticContinuationPrompt).toBeUndefined();
    expect(mocks.executeSessionCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: previousMessages.slice(0, -1),
        trigger: 'automatic',
      }),
    );

    const completedEvent = mocks.publishSessionRunEvent.mock.calls
      .map((call) => call[1] as { phase?: string; summary?: string })
      .find((event) => event.phase === 'completed');
    expect(completedEvent?.summary).toContain('保留当前用户请求继续执行');
  });

  it('已有一轮用量但上下文超限时，会压缩完整历史并注入继续提示', async () => {
    const messages = [
      textMessage('user-old', 'user', '旧问题'),
      textMessage('assistant-old', 'assistant', '旧回答'),
      textMessage('assistant-current', 'assistant', '当前轮输出'),
    ];
    mocks.listSessionMessagesV2.mockReturnValue(messages);

    const result = await triggerOverflowCompaction({
      ...baseContext(),
      round: 3,
      roundResult: {
        overflow: true,
        stopReason: 'end_turn',
        usage: {
          inputTokens: 95_000,
          outputTokens: 3_000,
          totalTokens: 98_000,
        },
      },
    });

    expect(result.triggered).toBe(true);
    expect(result.recovered).toBe(false);
    expect(result.syntheticContinuationPrompt).toContain('conversation was compacted');
    expect(mocks.executeSessionCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        trigger: 'automatic',
      }),
    );

    const completedEvent = mocks.publishSessionRunEvent.mock.calls
      .map((call) => call[1] as { phase?: string; summary?: string })
      .find((event) => event.phase === 'completed');
    expect(completedEvent?.summary).toContain('注入继续执行提示');
  });

  it('上一轮接近上下文阈值时会在下一轮发送前主动压缩并返回新 metadata', async () => {
    const result = await triggerProactiveCompaction({
      ...baseContext(),
      round: 2,
      lastRoundUsage: {
        inputTokens: 80_000,
        outputTokens: 5_000,
      },
    });

    expect(result).toEqual({
      triggered: true,
      metadataJson: '{"lastCompactionLlmSummary":"最新摘要"}',
    });
    expect(mocks.executeSessionCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: '{}',
        trigger: 'automatic',
      }),
    );
  });

  it('自动压缩阈值不受旧 reserved 设置改写', async () => {
    // Given
    const input = {
      ...baseContext(),
      compactionSettings: { ...COMPACTION_SETTINGS, reserved: 50_000 },
      round: 2,
      lastRoundUsage: {
        inputTokens: 60_000,
        outputTokens: 5_000,
      },
    };

    // When
    const result = await triggerProactiveCompaction(input);

    // Then
    expect(result).toEqual({ triggered: false, metadataJson: '{}' });
    expect(mocks.executeSessionCompaction).not.toHaveBeenCalled();
  });

  it('V2 round 的 108K 用量会进入 triggerOverflowCompaction seam', async () => {
    // Given
    mocks.resolveEffectiveContextWindow.mockReturnValue(128_000);
    mocks.listSessionMessagesV2.mockReturnValue([
      textMessage('user-old', 'user', '旧问题'),
      textMessage('assistant-old', 'assistant', '旧回答'),
    ]);

    // When
    const result = await triggerOverflowCompaction({
      ...baseContext(),
      route: { ...ROUTE, contextWindow: 128_000, maxTokens: 32_000 },
      compactionSettings: { ...COMPACTION_SETTINGS, reserved: 50_000 },
      round: 2,
      roundResult: {
        overflow: true,
        stopReason: 'end_turn',
        usage: {
          inputTokens: 108_000,
          outputTokens: 0,
          totalTokens: 95_000,
        },
      },
    });

    // Then
    expect(result.triggered).toBe(true);
    expect(mocks.executeSessionCompaction).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'automatic' }),
    );
  });

  it('压缩熔断后不再继续触发自动恢复，避免无限重试', async () => {
    mocks.isAutoCompactCircuitBreakerTripped.mockReturnValue(true);

    const result = await triggerOverflowCompaction({
      ...baseContext(),
      round: 4,
      roundResult: {
        overflow: true,
        stopReason: 'error',
        upstreamError: { message: 'context_length_exceeded' },
      },
    });

    expect(result).toEqual({
      triggered: false,
      recovered: false,
      metadataJson: '{}',
    });
    expect(mocks.executeSessionCompaction).not.toHaveBeenCalled();
  });
});
