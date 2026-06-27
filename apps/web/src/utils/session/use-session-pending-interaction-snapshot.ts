import { useEffect, useState } from 'react';
import {
  getSessionPendingInteractionSnapshot,
  subscribeSessionPendingInteractionSnapshot,
  type SessionPendingInteractionSnapshot,
} from './session-list-events.js';

export function useSessionPendingInteractionSnapshot(): SessionPendingInteractionSnapshot {
  const [snapshot, setSnapshot] = useState<SessionPendingInteractionSnapshot>(() =>
    getSessionPendingInteractionSnapshot(),
  );

  useEffect(() => {
    setSnapshot(getSessionPendingInteractionSnapshot());
    return subscribeSessionPendingInteractionSnapshot(() => {
      setSnapshot(getSessionPendingInteractionSnapshot());
    });
  }, []);

  return snapshot;
}
