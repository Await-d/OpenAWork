import { useCallback, useEffect, useRef, useState } from 'react';
import { createTeamClient } from '@openAwork/web-client';
import type { TeamRuntimeSessionRecord, TeamWorkspaceSummary } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { subscribeSessionListRefresh } from '../../utils/session/session-list-events.js';

export interface TeamSidebarSession {
  id: string;
  title: string;
  updatedAt: string;
  stateStatus: string;
  workspacePath: string | null;
  teamWorkspaceId: string | null;
}

export interface TeamWorkspaceGroup {
  id: string;
  label: string;
  sessions: TeamSidebarSession[];
}

export interface UseTeamSidebarSessionsResult {
  sessions: TeamSidebarSession[];
  workspaceGroups: TeamWorkspaceGroup[];
  workspaces: TeamWorkspaceSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const UNBOUND_GROUP_ID = '__unbound__';
const UNBOUND_GROUP_LABEL = '未绑定工作区';

export function parseTeamWorkspaceIdFromMetadata(metadataJson?: string | null): string | null {
  if (!metadataJson?.trim()) {
    return null;
  }

  try {
    const meta: unknown = JSON.parse(metadataJson);
    if (typeof meta !== 'object' || meta === null || !('teamWorkspaceId' in meta)) {
      return null;
    }
    const rawTeamWorkspaceId = meta.teamWorkspaceId;
    return typeof rawTeamWorkspaceId === 'string' && rawTeamWorkspaceId.trim()
      ? rawTeamWorkspaceId.trim()
      : null;
  } catch (caught: unknown) {
    if (caught instanceof SyntaxError) {
      return null;
    }
    throw caught;
  }
}

function buildWorkspaceGroups(
  sessions: readonly TeamSidebarSession[],
  workspaces: readonly TeamWorkspaceSummary[],
): TeamWorkspaceGroup[] {
  const groupsById = new Map<string, TeamSidebarSession[]>();
  for (const session of sessions) {
    const groupId = session.teamWorkspaceId ?? UNBOUND_GROUP_ID;
    groupsById.set(groupId, [...(groupsById.get(groupId) ?? []), session]);
  }

  const groups: TeamWorkspaceGroup[] = workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.name,
    sessions: groupsById.get(workspace.id) ?? [],
  }));

  for (const workspace of workspaces) {
    groupsById.delete(workspace.id);
  }

  const unboundSessions = groupsById.get(UNBOUND_GROUP_ID);
  if (unboundSessions?.length) {
    groups.push({ id: UNBOUND_GROUP_ID, label: UNBOUND_GROUP_LABEL, sessions: unboundSessions });
    groupsById.delete(UNBOUND_GROUP_ID);
  }

  for (const [groupId, groupSessions] of groupsById) {
    groups.push({
      id: groupId,
      label: `工作区 ${groupId.slice(0, 8)}`,
      sessions: groupSessions,
    });
  }

  return groups;
}

function buildTeamSidebarSignature(
  sessions: readonly TeamSidebarSession[],
  workspaces: readonly TeamWorkspaceSummary[],
): string {
  const sessionParts = sessions.map((session) =>
    [
      session.id,
      session.title,
      session.updatedAt,
      session.stateStatus,
      session.workspacePath ?? '',
      session.teamWorkspaceId ?? '',
    ].join('\u0001'),
  );
  const workspaceParts = workspaces.map((workspace) =>
    [
      workspace.id,
      workspace.name,
      workspace.description ?? '',
      workspace.visibility,
      workspace.defaultWorkingRoot ?? '',
      workspace.updatedAt,
    ].join('\u0001'),
  );
  return `${sessionParts.join('\u0002')}\u0003${workspaceParts.join('\u0002')}`;
}

export function useTeamSidebarSessions(): UseTeamSidebarSessionsResult {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [sessions, setSessions] = useState<TeamSidebarSession[]>([]);
  const [workspaceGroups, setWorkspaceGroups] = useState<TeamWorkspaceGroup[]>([]);
  const [workspaces, setWorkspaces] = useState<TeamWorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const mountedRef = useRef(false);
  const listSignatureRef = useRef('');
  const listScopeRef = useRef('');

  const listScope = `${accessToken ?? ''}:${gatewayUrl}`;
  if (listScopeRef.current !== listScope) {
    listScopeRef.current = listScope;
    listSignatureRef.current = '';
  }

  const refresh = useCallback(() => {
    setRefreshTick((value) => value + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!accessToken || !gatewayUrl) {
      listSignatureRef.current = '';
      setSessions([]);
      setWorkspaceGroups([]);
      setWorkspaces([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const client = createTeamClient(gatewayUrl);
    if (listSignatureRef.current === '') {
      setLoading(true);
    }
    setError(null);

    void Promise.all([
      client.getRuntimeResult(accessToken),
      client.listWorkspacesResult(accessToken),
    ])
      .then(([runtimeResult, workspaceResult]) => {
        if (cancelled || !mountedRef.current) {
          return;
        }

        const nextWorkspaces =
          workspaceResult.ok && workspaceResult.workspaces ? workspaceResult.workspaces : [];

        if (!runtimeResult.ok || !runtimeResult.runtime) {
          listSignatureRef.current = '';
          setWorkspaces(nextWorkspaces);
          setError(runtimeResult.errorMessage ?? '加载团队会话失败');
          setSessions([]);
          setWorkspaceGroups(buildWorkspaceGroups([], nextWorkspaces));
          setLoading(false);
          return;
        }

        const nextSessions = runtimeResult.runtime.sessions
          .filter((session: TeamRuntimeSessionRecord) => session.parentSessionId === null)
          .map((session: TeamRuntimeSessionRecord) => ({
            id: session.id,
            title: session.title ?? '未命名团队会话',
            updatedAt: session.updatedAt,
            stateStatus: session.stateStatus,
            workspacePath: session.workspacePath,
            teamWorkspaceId: parseTeamWorkspaceIdFromMetadata(session.metadataJson),
          }))
          .sort((left, right) => {
            const leftTime = new Date(left.updatedAt).getTime() || 0;
            const rightTime = new Date(right.updatedAt).getTime() || 0;
            return rightTime - leftTime;
          });

        const nextSignature = buildTeamSidebarSignature(nextSessions, nextWorkspaces);
        if (nextSignature !== listSignatureRef.current) {
          listSignatureRef.current = nextSignature;
          setWorkspaces(nextWorkspaces);
          setSessions(nextSessions);
          setWorkspaceGroups(buildWorkspaceGroups(nextSessions, nextWorkspaces));
        }
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled || !mountedRef.current) {
          return;
        }
        listSignatureRef.current = '';
        setError(caught instanceof Error ? caught.message : '网络异常，加载团队会话失败。');
        setSessions([]);
        setWorkspaceGroups([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gatewayUrl, refreshTick]);

  useEffect(() => subscribeSessionListRefresh(refresh), [refresh]);

  return { sessions, workspaceGroups, workspaces, loading, error, refresh };
}
