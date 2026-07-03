// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useSessionSnapshotLoader,
  type SessionSnapshotLoaderSetters,
} from './use-session-snapshot-loader.js';

function createSetters(): SessionSnapshotLoaderSetters {
  const setMessages: SessionSnapshotLoaderSetters['setMessages'] = () => undefined;
  const setMessageRatings: SessionSnapshotLoaderSetters['setMessageRatings'] = () => undefined;
  const setRightPanelState: SessionSnapshotLoaderSetters['setRightPanelState'] = () => undefined;
  const setSessionTodos: SessionSnapshotLoaderSetters['setSessionTodos'] = () => undefined;
  const setChildSessions: SessionSnapshotLoaderSetters['setChildSessions'] = () => undefined;
  const setSessionTasks: SessionSnapshotLoaderSetters['setSessionTasks'] = () => undefined;
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
});
