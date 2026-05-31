import { useCallback, useEffect, useRef, useState } from 'react';
import { createTeamClient, type TeamWorkspaceDetail } from '@openAwork/web-client';
import { useTeamEventsConnectionStore } from '../../../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from '../../../hooks/recoverable-read-model.js';
import { useRecoverableRetryController } from '../../../hooks/use-recoverable-retry.js';

const TEAM_DEFAULT_ROSTER_RETRY_BASE_MS = 2_000;
const TEAM_DEFAULT_ROSTER_RETRY_MAX_MS = 30_000;

export function computeTeamDefaultRosterRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_DEFAULT_ROSTER_RETRY_BASE_MS,
    maxMs: TEAM_DEFAULT_ROSTER_RETRY_MAX_MS,
  });
}

export function formatTeamDefaultRosterLoadError(input: {
  hasCachedWorkspace: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载默认固定团队失败。',
    hasRetainedData: input.hasCachedWorkspace,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '默认固定团队',
    retryable: input.result.retryable,
  });
}

interface UseTeamDefaultRosterStateOptions {
  gatewayUrl: string;
  teamWorkspaceId: string | null;
  token: string;
}

interface UseTeamDefaultRosterStateResult {
  applyWorkspace: (workspace: TeamWorkspaceDetail) => void;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  workspace: TeamWorkspaceDetail | null;
}

export function useTeamDefaultRosterState(
  options: UseTeamDefaultRosterStateOptions,
): UseTeamDefaultRosterStateResult {
  const [workspace, setWorkspace] = useState<TeamWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const workspaceRef = useRef<TeamWorkspaceDetail | null>(null);
  const currentWorkspaceIdRef = useRef<string | null>(null);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const refresh = useCallback(() => {
    resetRetry();
    setRefreshTick((current) => current + 1);
  }, [resetRetry]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    if (!options.teamWorkspaceId) {
      currentWorkspaceIdRef.current = null;
      resetRetry();
      setWorkspace(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const isWorkspaceChanged = currentWorkspaceIdRef.current !== options.teamWorkspaceId;
    currentWorkspaceIdRef.current = options.teamWorkspaceId;
    if (isWorkspaceChanged && workspaceRef.current?.id !== options.teamWorkspaceId) {
      setWorkspace(null);
    }

    const hasCachedWorkspace = workspaceRef.current?.id === options.teamWorkspaceId;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamDefaultRosterLoadError({
          hasCachedWorkspace,
          result: {
            errorMessage: '当前网络离线，默认固定团队暂时不可用。',
            retryable: true,
          },
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasCachedWorkspace);
    setError(null);

    const client = createTeamClient(options.gatewayUrl);
    void client.getWorkspaceResult(options.token, options.teamWorkspaceId).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok || !result.workspace) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamDefaultRosterRetryDelay,
          onRetry: () => {
            setRefreshTick((current) => current + 1);
          },
          retryable: result.retryable,
        });
        setLoading(false);
        setError(
          formatTeamDefaultRosterLoadError({
            hasCachedWorkspace,
            nextRetryAtMs,
            result,
          }),
        );
        return;
      }

      resetRetry();
      setWorkspace(result.workspace);
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
    };
  }, [
    clearRetry,
    options.gatewayUrl,
    options.teamWorkspaceId,
    options.token,
    refreshTick,
    resetRetry,
    scheduleRetry,
  ]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!options.teamWorkspaceId || typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => {
      refresh();
    };
    const handleOffline = () => {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamDefaultRosterLoadError({
          hasCachedWorkspace: workspaceRef.current?.id === options.teamWorkspaceId,
          result: {
            errorMessage: '当前网络离线，默认固定团队暂时不可用。',
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
  }, [options.teamWorkspaceId, refresh, resetRetry]);

  useEffect(() => {
    if (!options.teamWorkspaceId || !teamEventsRecoveredAt) {
      return;
    }
    refresh();
  }, [options.teamWorkspaceId, refresh, teamEventsRecoveredAt]);

  return {
    applyWorkspace: (nextWorkspace) => {
      setWorkspace(nextWorkspace);
    },
    error,
    loading,
    refresh,
    workspace,
  };
}
