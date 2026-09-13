/**
 * AppSidebarTeamMenus — 经典侧栏「团队」右键菜单的 Portal 渲染。
 *
 * 由 AppSidebar 主文件拆出，避免菜单映射逻辑挤占主组件体积。
 */

import { createPortal } from 'react-dom';
import TeamSessionContextMenu from '../sidebar/TeamSessionContextMenu.js';
import TeamWorkspaceContextMenu from '../sidebar/TeamWorkspaceContextMenu.js';

export interface AppSidebarTeamMenuTarget {
  id: string;
  title: string;
  stateStatus: string;
  teamWorkspaceId: string | null;
}

export interface AppSidebarTeamWorkspaceMenuTarget {
  id: string;
  name: string;
}

export interface AppSidebarTeamMenusProps {
  sessionMenu: { session: AppSidebarTeamMenuTarget; x: number; y: number } | null;
  workspaceMenu: { workspace: AppSidebarTeamWorkspaceMenuTarget; x: number; y: number } | null;
  renamingSessionId: string | null;
  deletingSessionId: string | null;
  workspaceRenamingId: string | null;
  workspaceDeletingId: string | null;
  onCloseSessionMenu: () => void;
  onRenameSession: (session: { id: string; title: string }) => void;
  onToggleSessionPause: (sessionId: string, stateStatus: string) => void;
  onCopySessionId: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onCloseWorkspaceMenu: () => void;
  onRenameWorkspace: (workspace: AppSidebarTeamWorkspaceMenuTarget) => void;
  onCopyWorkspaceId: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
}

export function AppSidebarTeamMenus({
  sessionMenu,
  workspaceMenu,
  renamingSessionId,
  deletingSessionId,
  workspaceRenamingId,
  workspaceDeletingId,
  onCloseSessionMenu,
  onRenameSession,
  onToggleSessionPause,
  onCopySessionId,
  onDeleteSession,
  onCloseWorkspaceMenu,
  onRenameWorkspace,
  onCopyWorkspaceId,
  onDeleteWorkspace,
}: AppSidebarTeamMenusProps) {
  return (
    <>
      {sessionMenu
        ? createPortal(
            <TeamSessionContextMenu
              sessionId={sessionMenu.session.id}
              sessionTitle={sessionMenu.session.title}
              x={sessionMenu.x}
              y={sessionMenu.y}
              stateStatus={sessionMenu.session.stateStatus}
              isRenaming={renamingSessionId === sessionMenu.session.id}
              isDeleting={deletingSessionId === sessionMenu.session.id}
              onClose={onCloseSessionMenu}
              onRename={() => onRenameSession(sessionMenu.session)}
              onTogglePause={() =>
                onToggleSessionPause(sessionMenu.session.id, sessionMenu.session.stateStatus)
              }
              onCopyId={() => onCopySessionId(sessionMenu.session.id)}
              onDelete={() => onDeleteSession(sessionMenu.session.id)}
            />,
            document.body,
          )
        : null}

      {workspaceMenu
        ? createPortal(
            <TeamWorkspaceContextMenu
              workspaceId={workspaceMenu.workspace.id}
              workspaceName={workspaceMenu.workspace.name}
              x={workspaceMenu.x}
              y={workspaceMenu.y}
              isRenaming={workspaceRenamingId === workspaceMenu.workspace.id}
              isDeleting={workspaceDeletingId === workspaceMenu.workspace.id}
              isUnbound={workspaceMenu.workspace.id === '__unbound__'}
              onClose={onCloseWorkspaceMenu}
              onRename={() => onRenameWorkspace(workspaceMenu.workspace)}
              onCopyId={() => onCopyWorkspaceId(workspaceMenu.workspace.id)}
              onDelete={() => onDeleteWorkspace(workspaceMenu.workspace.id)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
