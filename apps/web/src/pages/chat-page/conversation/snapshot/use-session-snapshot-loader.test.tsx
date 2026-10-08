// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import type { WorkflowRuntimeState } from '@openAwork/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useSessionSnapshotLoader,
  type SessionSnapshotLoaderSetters,
} from './use-session-snapshot-loader.js';

const clientMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createSessionsClient: () => ({
      getStatus: clientMocks.getStatus,
    }),
  };
});

function createSetters(): SessionSnapshotLoaderSetters {
  const setMessages: SessionSnapshotLoaderSetters['setMessages'] = () => undefined;
  const setMessageRatings: SessionSnapshotLoaderSetters['setMessageRatings'] = () => undefined;
  const setRightPanelState: SessionSnapshotLoaderSetters['setRightPanelState'] = () => undefined;
  const setSessionTodos: SessionSnapshotLoaderSetters['setSessionTodos'] = () => undefined;
  const setChildSessions: SessionSnapshotLoaderSetters['setChildSessions'] = () => undefined;
  const setSessionTasks: SessionSnapshotLoaderSetters['setSessionTasks'] = () => undefined;
  const setWorkflowRuntime: SessionSnapshotLoaderSetters['setWorkflowRuntime'] = () => undefined;
  const setPendingPermissions: SessionSnapshotLoaderSetters['setPendingPermissions'] = () =>
    undefined;
  const setPendingQuestions: SessionSnapshotLoaderSetters['setPendingQuestions'] = () => undefined;
  const setSessionStateStatus: SessionSnapshotLoaderSetters['setSessionStateStatus'] = () =>
    undefined;
  const setRecoveryActiveStream: SessionSnapshotLoaderSetters['setRecoveryActiveStream'] = () =>
    undefined;
  const setLatestUpstreamSummary: SessionSnapshotLoaderSetters['setLatestUpstreamSummary'] = () =>
    undefined;
  const setRecoveredStreamSnapshot: SessionSnapshotLoaderSetters['setRecoveredStreamSnapshot'] =
    () => undefined;
  const setIsSessionSnapshotReady: SessionSnapshotLoaderSetters['setIsSessionSnapshotReady'] = () =>
    undefined;
  const setSubagentNotices: SessionSnapshotLoaderSetters['setSubagentNotices'] = () => undefined;

  return {
    setMessages,
    setMessageRatings,
    setRightPanelState,
    setSessionTodos,
    setChildSessions,
    setSessionTasks,
    setWorkflowRuntime,
    setPendingPermissions,
    setPendingQuestions,
    setSessionStateStatus,
    setRecoveryActiveStream,
    setLatestUpstreamSummary,
    setRecoveredStreamSnapshot,
    setIsSessionSnapshotReady,
    setSubagentNotices,
  };
}

describe('useSessionSnapshotLoader', () => {
  beforeEach(() => {
    clientMocks.getStatus.mockReset();
  });

  it('当 setters 对象重建但函数引用不变时，syncRecoveredStreamSnapshot 保持稳定', () => {
    const refs = {
      currentSessionViewRef: { current: { epoch: 1, sessionId: 'session-1' } },
      streamingRef: { current: false },
    };
    const isCurrentSessionView = () => true;
    const setters = createSetters();

    const { result, rerender } = renderHook(
      ({ currentSetters }: { currentSetters: SessionSnapshotLoaderSetters }) =>
        useSessionSnapshotLoader(
          'https://gateway.test',
          'token',
          isCurrentSessionView,
          refs,
          currentSetters,
        ),
      {
        initialProps: {
          currentSetters: { ...setters },
        },
      },
    );

    const firstReference = result.current.syncRecoveredStreamSnapshot;

    rerender({ currentSetters: { ...setters } });

    expect(result.current.syncRecoveredStreamSnapshot).toBe(firstReference);
  });

  it('父组件在 effect 里依赖 syncRecoveredStreamSnapshot 时不会陷入重复更新', () => {
    const refs = {
      currentSessionViewRef: { current: { epoch: 1, sessionId: 'session-1' } },
      streamingRef: { current: false },
    };
    const isCurrentSessionView = () => true;
    const setters = createSetters();

    const { result } = renderHook(() => {
      const [effectRuns, setEffectRuns] = useState(0);
      const loader = useSessionSnapshotLoader(
        'https://gateway.test',
        'token',
        isCurrentSessionView,
        refs,
        { ...setters },
      );

      useEffect(() => {
        setEffectRuns((current) => current + 1);
      }, [loader.syncRecoveredStreamSnapshot]);

      return effectRuns;
    });

    expect(result.current).toBe(1);
  });

  it('轻量状态刷新会同步 workflowRuntime', async () => {
    const workflowRuntime: WorkflowRuntimeState = {
      activePlan: {
        path: '.agentdocs/workflow/260706-lazycodex-native-workflow.md',
        progress: '2/8',
        title: 'LazyCodex/OmO 原生化接入工作流',
      },
      evidence: {
        artifactRefs: ['artifact-1'],
        status: 'available',
      },
      mode: 'execution',
    };
    clientMocks.getStatus.mockResolvedValue({
      activeStream: null,
      children: [],
      pendingPermissions: [],
      pendingQuestions: [],
      tasks: [],
      todoLanes: { main: [], temp: [] },
      workflowRuntime,
    });
    const setWorkflowRuntime = vi.fn();
    const refs = {
      currentSessionViewRef: { current: { epoch: 1, sessionId: 'session-1' } },
      streamingRef: { current: false },
    };
    const setters = {
      ...createSetters(),
      setWorkflowRuntime,
    };

    const { result } = renderHook(() =>
      useSessionSnapshotLoader('https://gateway.test', 'token', () => true, refs, setters),
    );

    await act(async () => {
      await result.current.loadSessionRuntimeSnapshot('session-1');
    });

    // 所有轮询写入都走函数式 setter，值等时沿用旧引用。
    expect(setWorkflowRuntime).toHaveBeenCalledTimes(1);
    const updater = setWorkflowRuntime.mock.calls[0]?.[0];
    expect(typeof updater).toBe('function');
    expect(updater(null)).toEqual(workflowRuntime);
  });

  it('快照未变化时轮询写入不产生新引用（避免每 3s 全量重渲染）', async () => {
    const statusPayload = {
      activeStream: { runId: 'run-1', startedAtMs: 1, clientRequestId: 'req-1' },
      children: [{ id: 'child-1', updated_at: '2026-01-01T00:00:00.000Z' }],
      pendingPermissions: [],
      pendingQuestions: [],
      tasks: [{ id: 'task-1', status: 'running', updatedAt: '2026-01-01T00:00:00.000Z' }],
      todoLanes: { main: [{ id: 'todo-1', content: 'x' }], temp: [] },
      workflowRuntime: { mode: 'execution' },
    };
    clientMocks.getStatus.mockResolvedValue(statusPayload);

    // 模拟 React state：setter 收到函数时对 previous 求值，并按 Object.is 决定是否通知。
    const state = {
      todos: [] as unknown[],
      children: [] as unknown[],
      tasks: [] as unknown[],
      activeStream: null as unknown,
      workflowRuntime: null as unknown,
    };
    const renderCounts = { activeStream: 0 };
    function apply(key: keyof typeof state, next: unknown): void {
      const resolved =
        typeof next === 'function' ? (next as (prev: unknown) => unknown)(state[key]) : next;
      if (Object.is(resolved, state[key])) {
        return;
      }
      (state as Record<string, unknown>)[key] = resolved;
      if (key === 'activeStream') {
        renderCounts.activeStream += 1;
      }
    }

    const refs = {
      currentSessionViewRef: { current: { epoch: 1, sessionId: 'session-1' } },
      streamingRef: { current: false },
    };
    const setters: SessionSnapshotLoaderSetters = {
      ...createSetters(),
      setSessionTodos: (value) => apply('todos', value),
      setChildSessions: (value) => apply('children', value),
      setSessionTasks: (value) => apply('tasks', value),
      setRecoveryActiveStream: (value) => apply('activeStream', value),
      setWorkflowRuntime: (value) => apply('workflowRuntime', value),
    };

    const { result } = renderHook(() =>
      useSessionSnapshotLoader('https://gateway.test', 'token', () => true, refs, setters),
    );

    // 第一拍：建立基线状态
    await act(async () => {
      await result.current.loadSessionRuntimeSnapshot('session-1');
    });
    expect(renderCounts.activeStream).toBe(1);
    const baselineActiveStream = state.activeStream;
    const baselineChildren = state.children;

    // 第二拍：内容完全相同 —— 不得再产生任何新引用
    await act(async () => {
      await result.current.loadSessionRuntimeSnapshot('session-1');
    });

    expect(renderCounts.activeStream).toBe(1);
    expect(state.activeStream).toBe(baselineActiveStream);
    expect(state.children).toBe(baselineChildren);
  });
});
