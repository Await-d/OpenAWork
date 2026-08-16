import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@openAwork/shared';

const mocks = vi.hoisted(() => ({
  executeSessionCompaction: vi.fn(),
  listSessionMessagesV2: vi.fn(),
  publishSessionRunEvent: vi.fn(),
  trySessionMemoryCompaction: vi.fn(),
  reactiveCompactByTokenGap: vi.fn(),
  aggressiveTruncateToolOutputs: vi.fn(),
  parseContextLimitError: vi.fn(),
  resolveEffectiveContextWindow: vi.fn(),
  isAutoCompactCircuitBreakerTripped: vi.fn(),
  getCompactionProviderConfig: vi.fn(),
  resolveCompactionRoute: vi.fn(),
  sqliteGet: vi.fn(),
  recordDiscoveredContextWindow: vi.fn(),
  persistCompactionProjection: vi.fn(),
}));

vi.mock('../../session/session-compaction.js', () => ({
  executeSessionCompaction: mocks.executeSessionCompaction,
  isAutoCompactCircuitBreakerTripped: mocks.isAutoCompactCircuitBreakerTripped,
}));
vi.mock('../../message/message-v2-adapter.js', () => ({
  listSessionMessagesV2: mocks.listSessionMessagesV2,
}));
vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: mocks.publishSessionRunEvent,
}));
vi.mock('../../compaction/session-memory-compact.js', () => ({
  trySessionMemoryCompaction: mocks.trySessionMemoryCompaction,
}));
vi.mock('../../compaction/reactive-compact.js', () => ({
  reactiveCompactByTokenGap: mocks.reactiveCompactByTokenGap,
}));
vi.mock('../../compaction/context-window-resolver.js', () => ({
  aggressiveTruncateToolOutputs: mocks.aggressiveTruncateToolOutputs,
  parseContextLimitError: mocks.parseContextLimitError,
  resolveEffectiveContextWindow: mocks.resolveEffectiveContextWindow,
  recordDiscoveredContextWindow: mocks.recordDiscoveredContextWindow,
}));
vi.mock('../../compaction/compaction-projection.js', () => ({
  persistCompactionProjection: mocks.persistCompactionProjection,
}));
vi.mock('../../infra/db.js', () => ({ sqliteGet: mocks.sqliteGet }));
vi.mock('../../provider/provider-config.js', () => ({
  getCompactionProviderConfig: mocks.getCompactionProviderConfig,
}));
vi.mock('../../provider/model-router.js', () => ({
  resolveCompactionRoute: mocks.resolveCompactionRoute,
}));

import { orchestrateAutomaticCompaction } from '../../compaction/automatic-compaction-orchestrator.js';

const route = {
  model: 'model',
  apiBaseUrl: 'http://localhost',
  apiKey: 'key',
  contextWindow: 100_000,
  maxTokens: 2_000,
  temperature: 0,
  upstreamProtocol: 'chat_completions' as const,
  requestOverrides: {},
  supportsThinking: false,
};
const settings = { auto: true, prune: true, recentMessagesKept: 2 };
const message = (id: string, role: Message['role']): Message => ({
  id,
  role,
  content: [{ type: 'text', text: id }],
  createdAt: 1,
});
const context = () => ({
  userId: 'u',
  sessionId: 's',
  metadataJson: '{}',
  clientRequestId: 'c',
  runId: 'r',
  route,
  compactionSettings: settings,
  signal: new AbortController().signal,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEffectiveContextWindow.mockReturnValue(100_000);
  mocks.isAutoCompactCircuitBreakerTripped.mockReturnValue(false);
  mocks.listSessionMessagesV2.mockReturnValue([message('u1', 'user'), message('a1', 'assistant')]);
  mocks.getCompactionProviderConfig.mockResolvedValue(null);
  mocks.executeSessionCompaction.mockResolvedValue({
    durableSummary: { newlySummarizedMessages: 1, totalRepresentedMessages: 1, signature: 'sig' },
    metadataJson: '{"compacted":true}',
    metadata: {},
    summary: '结构化摘要',
  });
  mocks.reactiveCompactByTokenGap.mockReturnValue(null);
  mocks.aggressiveTruncateToolOutputs.mockReturnValue({ success: false, sufficient: false });
  mocks.trySessionMemoryCompaction.mockResolvedValue(null);
  mocks.parseContextLimitError.mockReturnValue(null);
});

describe('provider 无关自动压缩统一编排', () => {
  it('按 proactive 统一入口执行，并在持久化返回后才发布 completed', async () => {
    const order: string[] = [];
    mocks.executeSessionCompaction.mockImplementation(async () => {
      order.push('persisted');
      return {
        durableSummary: {
          newlySummarizedMessages: 1,
          totalRepresentedMessages: 1,
          signature: 'sig',
        },
        metadataJson: '{"ok":1}',
        metadata: {},
        summary: '摘要',
      };
    });
    mocks.publishSessionRunEvent.mockImplementation((_id: string, event: { phase?: string }) =>
      order.push(event.phase ?? 'unknown'),
    );

    const result = await orchestrateAutomaticCompaction({
      kind: 'proactive',
      input: { ...context(), round: 1, lastRoundUsage: { inputTokens: 80_000 } },
    });

    expect(result).toEqual({ triggered: true, metadataJson: '{"ok":1}' });
    expect(order).toEqual(['started', 'persisted', 'completed']);
  });

  it('overflow 使用 reactive → aggressive → session-memory → full 的固定顺序', async () => {
    const calls: string[] = [];
    mocks.parseContextLimitError.mockReturnValue({ currentTokens: 120_000, maxTokens: 100_000 });
    mocks.reactiveCompactByTokenGap.mockImplementation(() => {
      calls.push('reactive');
      return null;
    });
    mocks.aggressiveTruncateToolOutputs.mockImplementation(() => {
      calls.push('aggressive');
      return { success: false, sufficient: false };
    });
    mocks.trySessionMemoryCompaction.mockImplementation(async () => {
      calls.push('session-memory');
      return null;
    });
    mocks.executeSessionCompaction.mockImplementation(async () => {
      calls.push('full');
      return { durableSummary: null, metadataJson: '{"full":1}', metadata: {}, summary: '摘要' };
    });

    await orchestrateAutomaticCompaction({
      kind: 'overflow',
      input: {
        ...context(),
        round: 1,
        roundResult: { overflow: true, stopReason: 'error', upstreamError: new Error('context') },
      },
    });
    expect(calls).toEqual(['reactive', 'aggressive', 'session-memory', 'full']);
  });

  it('session-memory 的同一持久化 reservation 只发布一次完成事件', async () => {
    const sessionMemoryResult = {
      success: true,
      committed: true,
      signature: 'session-memory-signature',
      summary: '会话记忆摘要',
      messagesToKeep: [message('recent-user', 'user')],
      metadataJson: '{"sessionMemory":true}',
      preCompactTokenEstimate: 100_000,
      postCompactTokenEstimate: 10_000,
    };
    mocks.trySessionMemoryCompaction
      .mockResolvedValueOnce(sessionMemoryResult)
      .mockResolvedValueOnce({ ...sessionMemoryResult, committed: false });

    const overflow = {
      ...context(),
      round: 3,
      roundResult: { overflow: true, stopReason: 'error' },
    };
    await orchestrateAutomaticCompaction({ kind: 'overflow', input: overflow });
    await orchestrateAutomaticCompaction({ kind: 'overflow', input: overflow });

    expect(mocks.trySessionMemoryCompaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ clientRequestId: 'c', round: 3 }),
    );
    const compactionPhases = mocks.publishSessionRunEvent.mock.calls
      .map((call) => call[1].phase)
      .filter((phase) => phase === 'started' || phase === 'completed');
    expect(compactionPhases).toEqual(['started', 'completed']);
  });

  it('压缩子请求被统一入口拒绝重入，辅助模型失败返回 failed 并保留结构化回退', async () => {
    const input = {
      ...context(),
      requestKind: 'compaction' as const,
      round: 1,
      lastRoundUsage: { inputTokens: 100_000 },
    };
    const result = await orchestrateAutomaticCompaction({ kind: 'proactive', input });
    expect(result).toEqual({ triggered: false, metadataJson: '{}' });

    mocks.executeSessionCompaction.mockResolvedValue({
      durableSummary: {
        newlySummarizedMessages: 1,
        totalRepresentedMessages: 1,
        signature: 'fallback',
      },
      llmErrorMessage: 'upstream unavailable',
      metadataJson: '{"fallback":true}',
      metadata: {},
      summary: '结构化回退',
    });
    const failed = await orchestrateAutomaticCompaction({
      kind: 'proactive',
      input: { ...context(), round: 2, lastRoundUsage: { inputTokens: 80_000 } },
    });
    expect(failed).toEqual({ triggered: true, metadataJson: '{"fallback":true}' });
    const phases = mocks.publishSessionRunEvent.mock.calls.map((call) => call[1].phase);
    expect(phases).toContain('failed');
    expect(phases).not.toContain('completed');
  });

  it('session-memory 子请求在编排入口前被拒绝，且不读取会话消息', async () => {
    const result = await orchestrateAutomaticCompaction({
      kind: 'overflow',
      input: {
        ...context(),
        requestKind: 'session_memory',
        round: 9,
        roundResult: { overflow: true, stopReason: 'error' },
      },
    });

    expect(result).toEqual({ triggered: false, recovered: false, metadataJson: '{}' });
    expect(mocks.listSessionMessagesV2).not.toHaveBeenCalled();
    expect(mocks.trySessionMemoryCompaction).not.toHaveBeenCalled();
  });
});
