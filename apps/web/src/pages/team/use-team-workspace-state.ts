import {
  createTeamClient,
  type TeamWorkspaceDetail,
  type TeamWorkspaceSummary,
} from '@openAwork/web-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/auth.js';

interface TeamWorkspaceState {
  activeWorkspace: TeamWorkspaceDetail | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  workspaces: TeamWorkspaceSummary[];
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

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!accessToken) {
      setWorkspaces([]);
      setActiveWorkspace(null);
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
        const nextWorkspaces = await client.listWorkspaces(accessToken);
        if (cancelled) {
          return;
        }

        setWorkspaces(nextWorkspaces);

        if (!teamWorkspaceId) {
          setActiveWorkspace(null);
          setLoading(false);
          return;
        }

        const nextWorkspace = await client.getWorkspace(accessToken, teamWorkspaceId);
        if (cancelled) {
          return;
        }

        setActiveWorkspace(nextWorkspace);
        setLoading(false);
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        setActiveWorkspace(null);
        setError(nextError instanceof Error ? nextError.message : '加载 TeamWorkspace 失败');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, client, teamWorkspaceId, refreshTick]);

  return {
    activeWorkspace,
    error,
    loading,
    refresh,
    workspaces,
  };
}
