/**
 * useSidebarTeamActions — 侧边栏「团队」区域的菜单与操作状态。
 *
 * 经典布局（AppSidebar）与融合布局（FusionSidebar）共用：
 * 收敛团队会话 / 团队工作空间的右键菜单、重命名、暂停恢复、复制 ID 与删除。
 */

import { useCallback, useState } from 'react';
import { createTeamClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { requestSessionListRefresh } from '../../../utils/session/session-list-events.js';

export interface SidebarTeamSessionMenuTarget {
  id: string;
  title: string;
  stateStatus: string;
  teamWorkspaceId: string | null;
}

export interface SidebarTeamWorkspaceMenuTarget {
  id: string;
  name: string;
}

interface SessionMenuState {
  session: SidebarTeamSessionMenuTarget;
  x: number;
  y: number;
}

interface WorkspaceMenuState {
  workspace: SidebarTeamWorkspaceMenuTarget;
  x: number;
  y: number;
}

export function useSidebarTeamActions() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceMenuState | null>(null);

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const [workspaceRenamingId, setWorkspaceRenamingId] = useState<string | null>(null);
  const [workspaceRenameValue, setWorkspaceRenameValue] = useState('');
  const [workspaceDeletingId, setWorkspaceDeletingId] = useState<string | null>(null);

  const openSessionMenu = useCallback(
    (session: SidebarTeamSessionMenuTarget, x: number, y: number) => {
      setSessionMenu({ session, x, y });
    },
    [],
  );
  const closeSessionMenu = useCallback(() => setSessionMenu(null), []);

  const startSessionRename = useCallback((session: { id: string; title: string }) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
  }, []);

  const commitSessionRename = useCallback(
    async (sessionId: string) => {
      if (!accessToken || !gatewayUrl) {
        setRenamingSessionId(null);
        return;
      }
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenamingSessionId(null);
        return;
      }
      try {
        await createTeamClient(gatewayUrl).updateSessionState(accessToken, sessionId, {
          title: trimmed,
        });
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamSession] 重命名失败:', err);
      }
      setRenamingSessionId(null);
    },
    [accessToken, gatewayUrl, renameValue],
  );

  const toggleSessionPause = useCallback(
    async (sessionId: string, stateStatus: string) => {
      if (!accessToken || !gatewayUrl) return;
      const nextState = stateStatus === 'running' ? 'paused' : 'running';
      try {
        await createTeamClient(gatewayUrl).updateSessionState(accessToken, sessionId, {
          stateStatus: nextState,
        });
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamSession] 切换暂停/恢复失败:', err);
      }
    },
    [accessToken, gatewayUrl],
  );

  const copySessionId = useCallback((sessionId: string) => {
    void navigator.clipboard?.writeText(sessionId);
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!accessToken || !gatewayUrl) return;
      if (deletingSessionId === sessionId) return;
      setDeletingSessionId(sessionId);
      try {
        await createTeamClient(gatewayUrl).deleteSession(accessToken, sessionId);
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamSession] 删除失败:', err);
      }
      setDeletingSessionId(null);
    },
    [accessToken, deletingSessionId, gatewayUrl],
  );

  const openWorkspaceMenu = useCallback(
    (workspace: SidebarTeamWorkspaceMenuTarget, x: number, y: number) => {
      setWorkspaceMenu({ workspace, x, y });
    },
    [],
  );
  const closeWorkspaceMenu = useCallback(() => setWorkspaceMenu(null), []);

  const startWorkspaceRename = useCallback((workspace: SidebarTeamWorkspaceMenuTarget) => {
    setWorkspaceRenamingId(workspace.id);
    setWorkspaceRenameValue(workspace.name);
  }, []);

  const commitWorkspaceRename = useCallback(
    async (workspaceId: string) => {
      if (!accessToken || !gatewayUrl) {
        setWorkspaceRenamingId(null);
        return;
      }
      const trimmed = workspaceRenameValue.trim();
      if (!trimmed) {
        setWorkspaceRenamingId(null);
        return;
      }
      try {
        await createTeamClient(gatewayUrl).updateWorkspace(accessToken, workspaceId, {
          name: trimmed,
        });
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamWorkspace] 重命名失败:', err);
      }
      setWorkspaceRenamingId(null);
    },
    [accessToken, gatewayUrl, workspaceRenameValue],
  );

  const copyWorkspaceId = useCallback((workspaceId: string) => {
    void navigator.clipboard?.writeText(workspaceId);
  }, []);

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!accessToken || !gatewayUrl) return;
      if (workspaceDeletingId === workspaceId) return;
      setWorkspaceDeletingId(workspaceId);
      try {
        await createTeamClient(gatewayUrl).deleteWorkspace(accessToken, workspaceId);
        requestSessionListRefresh();
      } catch (err) {
        console.error('[TeamWorkspace] 删除失败:', err);
      }
      setWorkspaceDeletingId(null);
    },
    [accessToken, gatewayUrl, workspaceDeletingId],
  );

  return {
    sessionMenu,
    workspaceMenu,
    renamingSessionId,
    renameValue,
    setRenameValue,
    deletingSessionId,
    workspaceRenamingId,
    workspaceRenameValue,
    setWorkspaceRenameValue,
    workspaceDeletingId,
    openSessionMenu,
    closeSessionMenu,
    startSessionRename,
    commitSessionRename,
    toggleSessionPause,
    copySessionId,
    deleteSession,
    openWorkspaceMenu,
    closeWorkspaceMenu,
    startWorkspaceRename,
    commitWorkspaceRename,
    copyWorkspaceId,
    deleteWorkspace,
  };
}
