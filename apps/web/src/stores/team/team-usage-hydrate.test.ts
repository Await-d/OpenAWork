import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hydrateTeamToolCallStore,
  hydrateTeamUsageStore,
  useTeamToolCallStore,
  useTeamUsageStore,
  type TeamToolCallRecordSeed,
  type TeamUsageRecordSeed,
} from './team-usage.js';

beforeEach(() => {
  useTeamUsageStore.getState().clear();
  useTeamToolCallStore.getState().clear();
});

afterEach(() => {
  useTeamUsageStore.getState().clear();
  useTeamToolCallStore.getState().clear();
});

function seed(partial: Partial<TeamUsageRecordSeed>): TeamUsageRecordSeed {
  return {
    sessionId: partial.sessionId ?? 's-1',
    layer: partial.layer ?? null,
    agentId: partial.agentId ?? null,
    provider: partial.provider ?? null,
    model: partial.model ?? null,
    inputTokens: partial.inputTokens ?? 0,
    outputTokens: partial.outputTokens ?? 0,
    reasoningTokens: partial.reasoningTokens ?? 0,
    cacheReadTokens: partial.cacheReadTokens ?? 0,
    cacheWriteTokens: partial.cacheWriteTokens ?? 0,
    costUsd: partial.costUsd ?? 0,
    callCount: partial.callCount ?? 1,
    totalDurationMs: partial.totalDurationMs ?? 0,
    toolCallCount: partial.toolCallCount ?? 0,
    toolErrorCount: partial.toolErrorCount ?? 0,
  };
}

function toolCallSeed(partial: Partial<TeamToolCallRecordSeed>): TeamToolCallRecordSeed {
  return {
    sessionId: partial.sessionId ?? 's-1',
    layer: partial.layer ?? null,
    agentId: partial.agentId ?? null,
    toolName: partial.toolName ?? 'read',
    invocations: partial.invocations ?? 1,
    successes: partial.successes ?? 1,
    failures: partial.failures ?? 0,
    totalDurationMs: partial.totalDurationMs ?? 0,
    durations: partial.durations ?? [],
    errorSamples: partial.errorSamples ?? [],
  };
}

describe('hydrateTeamUsageStore', () => {
  it('用持久化聚合回灌 byLayer / bySession / byProvider / total', () => {
    hydrateTeamUsageStore([
      seed({
        sessionId: 's-pm1',
        layer: 'pm1',
        provider: 'anthropic',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.1,
        callCount: 2,
      }),
      seed({
        sessionId: 's-exec',
        layer: 'executor',
        provider: 'openai',
        inputTokens: 200,
        outputTokens: 40,
        costUsd: 0.2,
        callCount: 1,
      }),
    ]);

    const state = useTeamUsageStore.getState();
    expect(state.byLayer.get('pm1')).toMatchObject({ inputTokens: 100, count: 2 });
    expect(state.byLayer.get('executor')).toMatchObject({ inputTokens: 200, count: 1 });
    expect(state.bySession.get('s-pm1')?.outputTokens).toBe(20);
    expect(state.byProvider.get('anthropic')?.inputTokens).toBe(100);
    expect(state.total.inputTokens).toBe(300);
    expect(state.total.count).toBe(3);
    expect(state.total.costUsd).toBeCloseTo(0.3);
  });

  it('替换语义：再次 hydrate 用权威快照覆盖，不累加旧值', () => {
    hydrateTeamUsageStore([
      seed({ sessionId: 's-1', layer: 'pm1', inputTokens: 100, callCount: 1 }),
    ]);
    expect(useTeamUsageStore.getState().total.inputTokens).toBe(100);

    // 第二次回灌（后端权威总量）应替换而非叠加，避免每次刷新重复计数。
    hydrateTeamUsageStore([
      seed({ sessionId: 's-1', layer: 'pm1', inputTokens: 250, callCount: 3 }),
    ]);
    const state = useTeamUsageStore.getState();
    expect(state.total.inputTokens).toBe(250);
    expect(state.byLayer.get('pm1')?.inputTokens).toBe(250);
    expect(state.byLayer.get('pm1')?.count).toBe(3);
  });

  it('空数组清空聚合（无会话 / 登出时归零）', () => {
    hydrateTeamUsageStore([seed({ sessionId: 's-1', layer: 'pm1', inputTokens: 100 })]);
    hydrateTeamUsageStore([]);
    const state = useTeamUsageStore.getState();
    expect(state.total.inputTokens).toBe(0);
    expect(state.byLayer.size).toBe(0);
    expect(state.bySession.size).toBe(0);
  });

  it('layer/provider 为 null 的记录不进入 byLayer/byProvider，但计入 total 与 bySession', () => {
    hydrateTeamUsageStore([
      seed({ sessionId: 's-1', layer: null, provider: null, inputTokens: 30, callCount: 1 }),
    ]);
    const state = useTeamUsageStore.getState();
    expect(state.byLayer.size).toBe(0);
    expect(state.byProvider.size).toBe(0);
    expect(state.bySession.get('s-1')?.inputTokens).toBe(30);
    expect(state.total.inputTokens).toBe(30);
  });

  it('hydrate 不清空 recent 调用日志（实时事件在轮询刷新间存活）', () => {
    // 模拟一条实时事件进入 recent
    useTeamUsageStore.getState().applyUsageEvent({
      layer: 'pm1',
      provider: 'anthropic',
      inputTokens: 10,
      outputTokens: 2,
      timestamp: 123,
    });
    expect(useTeamUsageStore.getState().recent).toHaveLength(1);

    // 轮询刷新触发的 hydrate 不应清掉 recent（否则"最近调用"列表会反复闪烁）
    hydrateTeamUsageStore([
      seed({ sessionId: 's-1', layer: 'pm1', inputTokens: 500, callCount: 5 }),
    ]);
    expect(useTeamUsageStore.getState().recent).toHaveLength(1);
    // 但聚合桶被权威值替换
    expect(useTeamUsageStore.getState().byLayer.get('pm1')?.inputTokens).toBe(500);
  });
});

describe('hydrateTeamToolCallStore', () => {
  it('用持久化聚合回灌 bySession / byLayer / totals', () => {
    hydrateTeamToolCallStore([
      seed({
        sessionId: 's-pm1',
        layer: 'pm1',
        toolCallCount: 3,
        toolErrorCount: 1,
      }),
      seed({
        sessionId: 's-exec',
        layer: 'executor',
        toolCallCount: 5,
        toolErrorCount: 2,
      }),
    ]);

    const state = useTeamToolCallStore.getState();
    expect(state.bySession.get('s-pm1')).toEqual({ invocations: 3, failures: 1 });
    expect(state.byLayer.get('executor')).toEqual({ invocations: 5, failures: 2 });
    expect(state.totalInvocations).toBe(8);
    expect(state.totalFailures).toBe(3);
  });

  it('再次 hydrate 用权威快照覆盖旧总量', () => {
    hydrateTeamToolCallStore([
      seed({
        sessionId: 's-1',
        layer: 'pm1',
        toolCallCount: 2,
        toolErrorCount: 1,
      }),
    ]);
    expect(useTeamToolCallStore.getState().totalInvocations).toBe(2);

    hydrateTeamToolCallStore([
      seed({
        sessionId: 's-1',
        layer: 'pm1',
        toolCallCount: 7,
        toolErrorCount: 0,
      }),
    ]);

    const state = useTeamToolCallStore.getState();
    expect(state.bySession.get('s-1')).toEqual({ invocations: 7, failures: 0 });
    expect(state.totalInvocations).toBe(7);
    expect(state.totalFailures).toBe(0);
  });

  it('有 toolCallRecords 时恢复按工具和按 agent 明细', () => {
    hydrateTeamToolCallStore(
      [
        seed({
          sessionId: 's-1',
          layer: 'pm1',
          toolCallCount: 3,
          toolErrorCount: 1,
        }),
      ],
      [
        toolCallSeed({
          sessionId: 's-1',
          layer: 'pm1',
          agentId: 'agent-a',
          toolName: 'read',
          invocations: 2,
          successes: 1,
          failures: 1,
          totalDurationMs: 300,
          durations: [100, 200],
          errorSamples: [{ errorType: 'timeout', count: 1 }],
        }),
        toolCallSeed({
          sessionId: 's-1',
          layer: 'pm1',
          agentId: 'agent-b',
          toolName: 'write',
          invocations: 1,
          successes: 1,
          failures: 0,
          totalDurationMs: 50,
          durations: [50],
        }),
      ],
    );

    const state = useTeamToolCallStore.getState();
    expect(state.byTool.get('read')).toMatchObject({
      invocations: 2,
      failures: 1,
      totalDurationMs: 300,
      errorSamples: [{ errorType: 'timeout', count: 1 }],
    });
    expect(state.byTool.get('write')).toMatchObject({ invocations: 1, failures: 0 });
    expect(state.bySessionTool.get('s-1')?.get('read')?.durations).toEqual([100, 200]);
    expect(state.byAgent.get('agent-a')?.get('read')).toBe(2);
    expect(state.bySessionAgent.get('s-1')?.get('agent-b')?.get('write')).toBe(1);
    expect(state.totalInvocations).toBe(3);
    expect(state.totalFailures).toBe(1);
  });

  it('旧后端未返回 toolCallRecords 时回退到 usageRecords 总量恢复', () => {
    hydrateTeamToolCallStore([
      seed({
        sessionId: 's-legacy',
        layer: 'executor',
        toolCallCount: 4,
        toolErrorCount: 2,
      }),
    ]);

    const state = useTeamToolCallStore.getState();
    expect(state.bySession.get('s-legacy')).toEqual({ invocations: 4, failures: 2 });
    expect(state.byTool.size).toBe(0);
    expect(state.byAgent.size).toBe(0);
    expect(state.totalInvocations).toBe(4);
  });
});
