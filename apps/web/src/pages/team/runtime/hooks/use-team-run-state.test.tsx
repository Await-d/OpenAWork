// @vitest-environment jsdom
/**
 * use-team-run-state · 运行状态聚合逻辑测试
 *
 * 覆盖 phase 派生的关键分支：working / failed / completed / idle /
 * disconnected。通过真实 zustand store（直接 setState）驱动，断言聚合结果。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import {
  useClarificationStore,
  useHandoffStore,
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
  type HandoffEntry,
} from '../../../../stores/team/team-events.js';
import { publishSessionPendingQuestion } from '../../../../utils/session/session-list-events.js';
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
  useLayerStore.setState({ nodes: new Map() });
  useClarificationStore.setState({ items: [], pendingCount: 0 });
  publishSessionPendingQuestion('session-working', null);
  publishSessionPendingQuestion('session-stalled', null);
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

  it('有活跃 handoff 但长时间无活动时，前端仍按运行中展示', () => {
    setConnection('connected');
    setHandoffs([
      entry({
        id: 'a',
        sessionId: 'session-stalled',
        toSessionId: 'session-stalled',
        state: 'running',
        updatedAt: Date.now() - (5 * 60_000 + 1_000),
      }),
    ]);
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.phase).toBe('working');
  });

  it('有活跃 handoff 且处于允许等待态（clarifying）→ 仍视为 working', () => {
    setConnection('connected');
    setHandoffs([
      entry({
        id: 'a',
        sessionId: 'session-1',
        toSessionId: 'session-1',
        state: 'running',
        updatedAt: Date.now() - 5 * 60_000,
      }),
    ]);
    useLayerStore.setState({
      nodes: new Map([
        [
          'session-1',
          {
            sessionId: 'session-1',
            parentSessionId: null,
            roleLayer: 'pm1',
            state: 'running',
            substate: 'clarifying',
            substateUpdatedAt: Date.now(),
          },
        ],
      ]),
    });
    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.waitingAllowed).toBe(true);
    expect(result.current.phase).toBe('working');
  });

  it('允许等待链路与长耗时链路并存时，整体仍按运行中展示', () => {
    setConnection('connected');
    setHandoffs([
      entry({
        id: 'working',
        sessionId: 'session-working',
        toSessionId: 'session-working',
        state: 'running',
        updatedAt: Date.now() - 60_000,
      }),
      entry({
        id: 'stalled',
        sessionId: 'session-stalled',
        toSessionId: 'session-stalled',
        state: 'running',
        updatedAt: Date.now() - (5 * 60_000 + 1_000),
      }),
    ]);
    useLayerStore.setState({
      nodes: new Map([
        [
          'session-working',
          {
            sessionId: 'session-working',
            parentSessionId: null,
            roleLayer: 'pm1',
            state: 'running',
            substate: 'clarifying',
            substateUpdatedAt: Date.now(),
          },
        ],
        [
          'session-stalled',
          {
            sessionId: 'session-stalled',
            parentSessionId: null,
            roleLayer: 'executor',
            state: 'running',
            substate: 'implementing',
            substateUpdatedAt: Date.now() - (5 * 60_000 + 1_000),
          },
        ],
      ]),
    });
    publishSessionPendingQuestion('session-working', {
      requestId: 'q-1',
      sessionId: 'session-working',
      status: 'pending',
      createdAt: new Date().toISOString(),
      title: '需要确认方案',
      toolName: 'ask_followup_question',
      questions: [],
    });

    const { result } = renderHook(() => useTeamRunState());
    expect(result.current.waitingAllowed).toBe(true);
    expect(result.current.phase).toBe('working');
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
