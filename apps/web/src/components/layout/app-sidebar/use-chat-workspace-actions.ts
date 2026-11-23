/**
 * useChatWorkspaceActions — 经典侧栏「对话工作区」的菜单状态与操作。
 */

import { useCallback, useState } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { copyTextToClipboard } from '../file-tree/file-tree-actions.js';

export interface ChatWorkspaceMenuState {
  workspacePath: string;
  workspaceLabel: string;
  x: number;
  y: number;
}

export function useChatWorkspaceActions() {
  const setSelectedWorkspacePath = useUIStateStore((s) => s.setSelectedWorkspacePath);
  const setFileTreeRootPath = useUIStateStore((s) => s.setFileTreeRootPath);
  const removeSavedWorkspace = useUIStateStore((s) => s.removeSavedWorkspace);

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
    void copyTextToClipboard(workspacePath).catch((copyError: unknown) => {
      console.warn('复制工作区路径失败', copyError);
    });
  }, []);

  const removeChatWorkspace = useCallback(
    (workspacePath: string) => {
      // 经典侧栏的对话工作区只来自本地目录，连接维度恒为 null。
      removeSavedWorkspace({ workspacePath, sshConnectionId: null });
    },
    [removeSavedWorkspace],
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
