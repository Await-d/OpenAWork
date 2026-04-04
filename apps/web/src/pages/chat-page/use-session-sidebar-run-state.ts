import { useEffect } from 'react';
import { publishSessionRunState } from '../../utils/session-list-events.js';
import type { SessionStateStatus } from './session-runtime.js';

function resolveSessionRunState(
  streaming: boolean,
  sessionStateStatus: SessionStateStatus | null,
): 'idle' | 'running' | 'paused' {
  if (streaming || sessionStateStatus === 'running') {
    return 'running';
  }

  if (sessionStateStatus === 'paused') {
    return 'paused';
  }

  return 'idle';
}

function isSessionBusy(streaming: boolean, sessionStateStatus: SessionStateStatus | null): boolean {
  return streaming || sessionStateStatus === 'running' || sessionStateStatus === 'paused';
}

export function useSessionSidebarRunState(options: {
  activeStreamSessionId: string | null;
  currentSessionId: string | null;
  sessionStateStatus: SessionStateStatus | null;
  streaming: boolean;
}): void {
  const { activeStreamSessionId, currentSessionId, sessionStateStatus, streaming } = options;

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    publishSessionRunState(currentSessionId, resolveSessionRunState(streaming, sessionStateStatus));

    return () => {
      if (
        isSessionBusy(streaming, sessionStateStatus) ||
        activeStreamSessionId === currentSessionId
      ) {
        return;
      }

      publishSessionRunState(currentSessionId, 'idle');
    };
  }, [activeStreamSessionId, currentSessionId, sessionStateStatus, streaming]);
}
