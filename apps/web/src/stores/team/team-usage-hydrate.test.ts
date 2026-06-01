import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hydrateTeamUsageStore,
  useTeamUsageStore,
  type TeamUsageRecordSeed,
} from './team-usage.js';

beforeEach(() => {
  useTeamUsageStore.getState().clear();
});

afterEach(() => {
  useTeamUsageStore.getState().clear();
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
    hydrateTeamUsageStore([seed({ sessionId: 's-1', layer: 'pm1', inputTokens: 100, callCount: 1 })]);
    expect(useTeamUsageStore.getState().total.inputTokens).toBe(100);

    // 第二次回灌（后端权威总量）应替换而非叠加，避免每次刷新重复计数。
    hydrateTeamUsageStore([seed({ sessionId: 's-1', layer: 'pm1', inputTokens: 250, callCount: 3 })]);
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
});
