import { useCallback, useRef } from 'react';
import { writeRefCurrent } from '../../../../utils/ref/ref-current.js';

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
      // 三个 ref 都是调用方（ChatPage 侧共享 ref 池）持有后传入的参数，写 .current
      // 属「修改 hook 参数」，会让本 hook 退出 React Compiler 优化——写入统一走
      // 收敛函数（见 utils/ref/ref-current.ts）。
      if (options?.incrementEpoch !== false) {
        writeRefCurrent(sessionViewEpochRef, sessionViewEpochRef.current + 1);
      }

      writeRefCurrent(currentSessionViewRef, {
        epoch: sessionViewEpochRef.current,
        sessionId: nextSessionId,
      });
      writeRefCurrent(activeSessionRef, nextSessionId);
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
