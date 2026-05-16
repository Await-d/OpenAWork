import { useCallback, useRef } from 'react';

export interface SessionViewGuardRefs {
  activeSessionRef: React.MutableRefObject<string | null>;
  sessionViewEpochRef: React.MutableRefObject<number>;
  currentSessionViewRef: React.MutableRefObject<{ epoch: number; sessionId: string | null }>;
}

export interface SessionViewGuardReturn {
  activateSessionView: (
    nextSessionId: string | null,
    options?: { incrementEpoch?: boolean },
  ) => number;
  isCurrentSessionView: (targetSessionId: string, expectedEpoch: number) => boolean;
  isCurrentSessionRequest: (targetSessionId: string, expectedEpoch: number) => boolean;
}

export function useSessionViewGuard(refs: SessionViewGuardRefs): SessionViewGuardReturn {
  const { activeSessionRef, sessionViewEpochRef, currentSessionViewRef } = refs;

  const activateSessionView = useCallback(
    (nextSessionId: string | null, options?: { incrementEpoch?: boolean }) => {
      if (options?.incrementEpoch !== false) {
        sessionViewEpochRef.current += 1;
      }

      currentSessionViewRef.current = {
        epoch: sessionViewEpochRef.current,
        sessionId: nextSessionId,
      };
      activeSessionRef.current = nextSessionId;
      return sessionViewEpochRef.current;
    },
    [activeSessionRef, sessionViewEpochRef, currentSessionViewRef],
  );

  const isCurrentSessionView = useCallback(
    (targetSessionId: string, expectedEpoch: number) => {
      const current = currentSessionViewRef.current;
      return current.sessionId === targetSessionId && current.epoch === expectedEpoch;
    },
    [currentSessionViewRef],
  );

  const isCurrentSessionRequest = useCallback(
    (targetSessionId: string, expectedEpoch: number) =>
      activeSessionRef.current === targetSessionId &&
      isCurrentSessionView(targetSessionId, expectedEpoch),
    [activeSessionRef, isCurrentSessionView],
  );

  return { activateSessionView, isCurrentSessionView, isCurrentSessionRequest };
}
