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

    expect(setWorkflowRuntime).toHaveBeenCalledWith(workflowRuntime);
  });
});
