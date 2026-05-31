import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTeamUsageStore } from './team-usage.js';
import { dispatchTeamEvent, useLayerStore, type HandoffEvent } from './team-events.js';

beforeEach(() => {
  useTeamUsageStore.getState().clear();
  useLayerStore.getState().clear();
});

afterEach(() => {
  useTeamUsageStore.getState().clear();
  useLayerStore.getState().clear();
});

describe('useTeamUsageStore · byLayer', () => {
  it('按 layer 聚合 token 与成本', () => {
    const { applyUsageEvent } = useTeamUsageStore.getState();
    applyUsageEvent({
      layer: 'pm1',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.1,
      timestamp: 1,
    });
    applyUsageEvent({
      layer: 'pm1',
      inputTokens: 50,
      outputTokens: 10,
      costUsd: 0.05,
      timestamp: 2,
    });
    applyUsageEvent({
      layer: 'executor',
      inputTokens: 200,
      outputTokens: 40,
      costUsd: 0.2,
      timestamp: 3,
    });

    const byLayer = useTeamUsageStore.getState().byLayer;
    expect(byLayer.get('pm1')).toMatchObject({
      inputTokens: 150,
      outputTokens: 30,
      count: 2,
    });
    expect(byLayer.get('pm1')?.costUsd).toBeCloseTo(0.15);
    expect(byLayer.get('executor')).toMatchObject({ inputTokens: 200, count: 1 });
  });

  it('无 layer 的事件不进入 byLayer，但计入 total', () => {
    useTeamUsageStore.getState().applyUsageEvent({
      inputTokens: 10,
      outputTokens: 5,
      timestamp: 1,
    });
    expect(useTeamUsageStore.getState().byLayer.size).toBe(0);
    expect(useTeamUsageStore.getState().total.count).toBe(1);
  });

  it('recent 保留 layer 字段（供 UsageView 单层下钻按 layer 过滤）', () => {
    const { applyUsageEvent } = useTeamUsageStore.getState();
    applyUsageEvent({ layer: 'pm1', provider: 'anthropic', inputTokens: 1, outputTokens: 1, timestamp: 1 });
    applyUsageEvent({ layer: 'executor', provider: 'openai', inputTokens: 1, outputTokens: 1, timestamp: 2 });
    const recent = useTeamUsageStore.getState().recent;
    expect(recent.filter((e) => e.layer === 'pm1')).toHaveLength(1);
    expect(recent.filter((e) => e.layer === 'pm1')[0]?.provider).toBe('anthropic');
  });
});

describe('dispatchTeamEvent · team_usage layer 派生', () => {
  it('显式 payload.layer 优先', () => {
    const event: HandoffEvent = {
      type: 'session.usage',
      timestamp: 100,
      payload: {
        __teamEventKind: 'team_usage',
        layer: 'reviewer',
        sessionId: 'sess-x',
        inputTokens: 10,
        outputTokens: 2,
      },
    };
    dispatchTeamEvent(event);
    expect(useTeamUsageStore.getState().byLayer.get('reviewer')?.count).toBe(1);
  });

  it('无显式 layer 时由 session→roleLayer 映射推导', () => {
    useLayerStore.getState().addNode({
      sessionId: 'sess-pm2',
      roleLayer: 'pm2',
      parentSessionId: null,
      state: 'running',
    });
    const event: HandoffEvent = {
      type: 'session.usage',
      timestamp: 101,
      payload: {
        __teamEventKind: 'team_usage',
        sessionId: 'sess-pm2',
        inputTokens: 30,
        outputTokens: 6,
      },
    };
    dispatchTeamEvent(event);
    expect(useTeamUsageStore.getState().byLayer.get('pm2')?.inputTokens).toBe(30);
  });
});
