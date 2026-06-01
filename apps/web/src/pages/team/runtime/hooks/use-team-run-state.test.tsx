// @vitest-environment jsdom
/**
 * use-team-run-state · 运行状态聚合逻辑测试
 *
 * 覆盖 phase 派生的关键分支：working / stalled / failed / completed / idle /
 * disconnected。通过真实 zustand store（直接 setState）驱动，断言聚合结果。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import {
  useHandoffStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
  type HandoffEntry,
} from '../../../../stores/team/team-events.js';
import { useTeamRunState } from './use-team-run-state.js';

function entry(overrides: Partial<HandoffEntry>): HandoffEntry {
  return {
    id: overrides.id ?? 'h1',
    state: overrides.state ?? 'running',
    fromRoleLayer: overrides.fromRoleLayer ?? 'reception',
    toRoleLayer: overrides.toRoleLayer ?? 'pm1',
    updatedAt: overrides.updatedAt ?? Date.now(),
    ...overrides,
  } as HandoffEntry;
}

function setHandoffs(entries: HandoffEntry[]): void {
  useHandoffStore.setState({ handoffs: new Map(entries.map((e) => [e.id, e])) });
}

function setConnection(state: string): void {
  useTeamEventsConnectionStore.setState({ state: state as never });
}

afterEach(() => {
  cleanup();
  setHandoffs([]);
  setConnection('connected');
  useTeamNotificationStore.setState({ events: [] });
  vi.restoreAllMocks();
});

describe('useTeamRunState', () => {
  it('无 handoff + connected → idle', () => {
    setConnection('connected');
    setHandoffs([]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('idle');
  });

  it('有活跃 handoff + 近期活动 → working', () => {
    setConnection('connected');
    setHandoffs([entry({ id: 'a', state: 'running', updatedAt: Date.now() })]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('working');
    expect(result.current.activeCount).toBe(1);
  });

  it('有活跃 handoff 但长时间无活动 → stalled', () => {
    setConnection('connected');
    setHandoffs([entry({ id: 'a', state: 'running', updatedAt: Date.now() - 5 * 60_000 })]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('stalled');
  });

  it('有失败且无完成 → failed', () => {
    setConnection('connected');
    setHandoffs([entry({ id: 'a', state: 'failed', updatedAt: Date.now() })]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('failed');
    expect(result.current.failedCount).toBe(1);
  });

  it('全部完成 → completed', () => {
    setConnection('connected');
    setHandoffs([
      entry({ id: 'a', state: 'completed', updatedAt: Date.now() }),
      entry({ id: 'b', state: 'completed', updatedAt: Date.now() }),
    ]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('completed');
    expect(result.current.completedCount).toBe(2);
  });

  it('全部取消 → 无活跃任务，cancelledCount 反映取消数', () => {
    setConnection('connected');
    setHandoffs([
      entry({ id: 'a', state: 'cancelled', updatedAt: Date.now() }),
      entry({ id: 'b', state: 'cancelled', updatedAt: Date.now() }),
    ]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.activeCount).toBe(0);
    expect(result.current.cancelledCount).toBe(2);
    // 无 active、无 failed-only、有 total → completed 态（横幅会附「N 个已取消」）。
    expect(result.current.phase).toBe('completed');
  });

  it('WS 断开 → disconnected（优先于其它）', () => {
    setConnection('offline');
    setHandoffs([entry({ id: 'a', state: 'running', updatedAt: Date.now() })]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('disconnected');
  });
});
