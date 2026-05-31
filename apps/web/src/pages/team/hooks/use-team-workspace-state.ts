import {
  createTeamClient,
  type TeamWorkspaceDetail,
  type TeamWorkspaceSummary,
} from '@openAwork/web-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useTeamEventsConnectionStore } from '../../../stores/team/team-events.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from './recoverable-read-model.js';
import { useRecoverableRetryController } from './use-recoverable-retry.js';

interface TeamWorkspaceState {
  activeWorkspace: TeamWorkspaceDetail | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  workspaces: TeamWorkspaceSummary[];
}

const TEAM_WORKSPACE_STATE_RETRY_BASE_MS = 2_000;
const TEAM_WORKSPACE_STATE_RETRY_MAX_MS = 30_000;

export function computeTeamWorkspaceStateRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_WORKSPACE_STATE_RETRY_BASE_MS,
    maxMs: TEAM_WORKSPACE_STATE_RETRY_MAX_MS,
  });
}

export function formatTeamWorkspaceStateLoadError(input: {
  hasCachedWorkspaceData: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队工作区失败。',
    hasRetainedData: input.hasCachedWorkspaceData,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '工作区数据',
    retryable: input.result.retryable,
  });
}

export function useTeamWorkspaceState(teamWorkspaceId?: string): TeamWorkspaceState {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const [workspaces, setWorkspaces] = useState<TeamWorkspaceSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<TeamWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const workspacesRef = useRef<TeamWorkspaceSummary[]>([]);
  const activeWorkspaceRef = useRef<TeamWorkspaceDetail | null>(null);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const {
    clearRetry,
    resetRetry,
    scheduleRetry,
  } = useRecoverableRetryController();

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  useEffect(() => {
    let cancelled = false;
    clearRetry();

    if (!accessToken) {
      resetRetry();
      setWorkspaces([]);
      setActiveWorkspace(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    const hasCachedWorkspaceData =
      workspacesRef.current.length > 0 ||
      (teamWorkspaceId ? activeWorkspaceRef.current?.id === teamWorkspaceId : false);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      resetRetry();
      setLoading(false);
      setError(
        formatTeamWorkspaceStateLoadError({
          hasCachedWorkspaceData,
          result: {
            errorMessage: '当前网络离线，团队工作区暂时不可用。',
            retryable: true,
          },
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setLoading(!hasCachedWorkspaceData);
    setError(null);

    void (async () => {
      const listResult = await client.listWorkspacesResult(accessToken);
      if (cancelled) {
        return;
      }
      if (!listResult.ok || !listResult.workspaces) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamWorkspaceStateRetryDelay,
          onRetry: refresh,
          retryable: listResult.retryable,
        });
        setLoading(false);
        setError(
          formatTeamWorkspaceStateLoadError({
            hasCachedWorkspaceData,
            nextRetryAtMs,
            result: listResult,
          }),
        );
        return;
      }

      setWorkspaces(listResult.workspaces);

      if (!teamWorkspaceId) {
        resetRetry();
        setActiveWorkspace(null);
        setLoading(false);
        setError(null);
        return;
      }

      const workspaceSummary =
        listResult.workspaces.find((workspace) => workspace.id === teamWorkspaceId) ?? null;
      const retainedWorkspace =
        activeWorkspaceRef.current?.id === teamWorkspaceId ? activeWorkspaceRef.current : null;
      const fallbackWorkspace = retainedWorkspace ?? workspaceSummary;
      setActiveWorkspace(fallbackWorkspace);

      const detailResult = await client.getWorkspaceResult(accessToken, teamWorkspaceId);
      if (cancelled) {
        return;
      }
      if (!detailResult.ok || !detailResult.workspace) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamWorkspaceStateRetryDelay,
          onRetry: refresh,
          retryable: detailResult.retryable,
        });
        setLoading(false);
        setError(
          formatTeamWorkspaceStateLoadError({
            hasCachedWorkspaceData:
              listResult.workspaces.length > 0 || fallbackWorkspace !== null,
            nextRetryAtMs,
            result: detailResult,
          }),
        );
        return;
      }

      resetRetry();
      setActiveWorkspace(detailResult.workspace);
      setLoading(false);
      setError(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, clearRetry, client, refresh, resetRetry, scheduleRetry, teamWorkspaceId, refreshTick]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!accessToken || typeof window === 'undefined') {
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
        formatTeamWorkspaceStateLoadError({
          hasCachedWorkspaceData:
            workspacesRef.current.length > 0 ||
            (teamWorkspaceId ? activeWorkspaceRef.current?.id === teamWorkspaceId : false),
          result: {
            errorMessage: '当前网络离线，团队工作区暂时不可用。',
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
    if (!accessToken || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    refresh();
  }, [accessToken, refresh, resetRetry, teamEventsRecoveredAt]);

  return {
    activeWorkspace,
    error,
    loading,
    refresh,
    workspaces,
  };
}
