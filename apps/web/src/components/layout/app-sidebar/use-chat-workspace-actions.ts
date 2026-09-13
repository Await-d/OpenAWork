/**
 * useChatWorkspaceActions — 经典侧栏「对话工作区」的菜单状态与操作。
 */

import { useCallback, useState } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

export interface ChatWorkspaceMenuState {
  workspacePath: string;
  workspaceLabel: string;
  x: number;
  y: number;
}

export function useChatWorkspaceActions() {
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const removeSavedWorkspacePath = useUIStateStore((s) => s.removeSavedWorkspacePath);

  const [chatWorkspaceContextMenu, setChatWorkspaceContextMenu] =
    useState<ChatWorkspaceMenuState | null>(null);

  const openChatWorkspaceMenu = useCallback(
    (workspacePath: string, workspaceLabel: string, x: number, y: number) => {
      setChatWorkspaceContextMenu({ workspacePath, workspaceLabel, x, y });
    },
    [],
  );

  const closeChatWorkspaceMenu = useCallback(() => setChatWorkspaceContextMenu(null), []);

  const activateChatWorkspace = useCallback(
    (workspacePath: string) => {
      setSelectedWorkspacePath(workspacePath);
      setFileTreeRootPath(workspacePath);
    },
    [setFileTreeRootPath, setSelectedWorkspacePath],
  );

  const copyChatWorkspacePath = useCallback((workspacePath: string) => {
    void navigator.clipboard?.writeText(workspacePath);
  }, []);

  const removeChatWorkspace = useCallback(
    (workspacePath: string) => {
      removeSavedWorkspacePath(workspacePath);
    },
    [removeSavedWorkspacePath],
  );

  return {
    chatWorkspaceContextMenu,
    openChatWorkspaceMenu,
    closeChatWorkspaceMenu,
    activateChatWorkspace,
    copyChatWorkspacePath,
    removeChatWorkspace,
  };
}
