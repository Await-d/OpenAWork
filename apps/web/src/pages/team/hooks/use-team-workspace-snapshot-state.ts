import { createTeamClient, type TeamWorkspaceSnapshot } from '@openAwork/web-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from './recoverable-read-model.js';
import { useRecoverableRetryController } from './use-recoverable-retry.js';

interface TeamWorkspaceSnapshotState {
  error: string | null;
  loading: boolean;
  refresh: () => void;
  snapshot: TeamWorkspaceSnapshot | null;
}

const TEAM_WORKSPACE_SNAPSHOT_RETRY_BASE_MS = 2_000;
const TEAM_WORKSPACE_SNAPSHOT_RETRY_MAX_MS = 30_000;

export function computeTeamWorkspaceSnapshotRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_WORKSPACE_SNAPSHOT_RETRY_BASE_MS,
    maxMs: TEAM_WORKSPACE_SNAPSHOT_RETRY_MAX_MS,
  });
}

export function formatTeamWorkspaceSnapshotLoadError(input: {
  hasCachedSnapshot: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队工作区快照失败。',
    hasRetainedData: input.hasCachedSnapshot,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '工作区快照',
    retryable: input.result.retryable,
  });
}

export function useTeamWorkspaceSnapshotState(
  teamWorkspaceId?: string,
): TeamWorkspaceSnapshotState {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const [snapshot, setSnapshot] = useState<TeamWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const snapshotRef = useRef<TeamWorkspaceSnapshot | null>(null);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  const refresh = useCallback(() => {
    setRefreshTick((value) => value + 1);
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    void refreshTick;
    clearRetry();

    if (!accessToken || !teamWorkspaceId) {
      resetRetry();
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const hasCachedSnapshot = snapshotRef.current !== null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamWorkspaceSnapshotLoadError({
          hasCachedSnapshot,
          result: {
            errorMessage: '当前网络离线，团队工作区快照暂时不可用。',
            retryable: true,
          },
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasCachedSnapshot);
    setError(null);

    void (async () => {
      const result = await client.getWorkspaceSnapshotResult(accessToken, teamWorkspaceId);
      if (cancelled) {
        return;
      }
      if (!result.ok || !result.snapshot) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamWorkspaceSnapshotRetryDelay,
          onRetry: refresh,
          retryable: result.retryable,
        });
        setLoading(false);
        setError(
          formatTeamWorkspaceSnapshotLoadError({
            hasCachedSnapshot,
            nextRetryAtMs,
            result,
          }),
        );
        return;
      }
      resetRetry();
      setSnapshot(result.snapshot);
      setLoading(false);
      setError(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    clearRetry,
    client,
    refresh,
    resetRetry,
    scheduleRetry,
    teamWorkspaceId,
    refreshTick,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!accessToken || !teamWorkspaceId || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      resetRetry();
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamWorkspaceSnapshotLoadError({
          hasCachedSnapshot: snapshotRef.current !== null,
          result: {
            errorMessage: '当前网络离线，团队工作区快照暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [accessToken, refresh, resetRetry, teamWorkspaceId]);

  useEffect(() => {
    if (!accessToken || !teamWorkspaceId || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    refresh();
  }, [accessToken, refresh, resetRetry, teamWorkspaceId, teamEventsRecoveredAt]);

  return {
    error,
    loading,
    refresh,
    snapshot,
  };
}
