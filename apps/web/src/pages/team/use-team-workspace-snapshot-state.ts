import { createTeamClient, type TeamWorkspaceSnapshot } from '@openAwork/web-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';

interface TeamWorkspaceSnapshotState {
  error: string | null;
  loading: boolean;
  refresh: () => void;
  snapshot: TeamWorkspaceSnapshot | null;
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

  const refresh = useCallback(() => {
    setRefreshTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshTick;

    if (!accessToken || !teamWorkspaceId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const nextSnapshot = await client.getWorkspaceSnapshot(accessToken, teamWorkspaceId);
        if (cancelled) {
          return;
        }
        setSnapshot(nextSnapshot);
        setLoading(false);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setSnapshot(null);
        setError(
          nextError instanceof Error ? nextError.message : '加载 TeamWorkspaceSnapshot 失败',
        );
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, client, teamWorkspaceId, refreshTick]);

  return {
    error,
    loading,
    refresh,
    snapshot,
  };
}
