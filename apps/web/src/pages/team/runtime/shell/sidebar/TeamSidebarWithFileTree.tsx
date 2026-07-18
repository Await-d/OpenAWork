/**
 * TeamSidebarWithFileTree · 团队页文件树侧边栏
 *
 * 团队页左侧栏现已聚焦于「文件树」：会话列表由全局侧栏（AppSidebar / FusionSidebar）
 * 承载，避免在团队页内重复展示。本组件仅渲染工作区目录树与「新建会话 / 工作区」入口。
 */

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { createWorkspaceClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../../stores/auth/auth.js';
import { toast } from '../../../../../components/common/feedback/ToastNotification.js';
import {
  FileTreeView,
  type FileTreeContextTarget,
} from '../../../../../components/layout/sidebar/SidebarHelpers.js';
import FileTreeContextMenu from '../../../../../components/layout/file-tree/FileTreeContextMenu.js';
import {
  copyTextToClipboard,
  getFileTreeRelativePath,
  isValidFileTreeEntryName,
  joinFileTreePath,
} from '../../../../../components/layout/file-tree/file-tree-actions.js';
import { dispatchComposerReference } from '../../../../../utils/chat/composer-reference-events.js';
import { getParentPath } from '../../../../../utils/workspace-path.js';
import type {
  AgentTeamsSidebarTeam,
  AgentTeamsWorkspaceGroup,
} from '../../data/team-runtime-types.js';
import type { TeamSessionCreationDraft } from '../../data/team-session-creation.types.js';
import { NewTeamSessionModal } from '../modals/NewTeamSessionModal.js';

// 团队页左侧栏已不再渲染会话列表（由全局侧栏承载），以下 props 仅被接收而不使用，
// 保留类型以便 TeamPageV2 调用端无需改动。
export interface TeamSessionListSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  workspaceGroups: AgentTeamsWorkspaceGroup[];
  selectedTeamId: string;
  onSelectTeam: (teamId: string) => void;
  canManageSessionEntries?: boolean;
  workspaceLabel?: string;
  teamWorkspaceId?: string;
  defaultMemberSlots?: TeamSessionCreationDraft['memberSlots'];
  onSubmitDraft?: (draft: TeamSessionCreationDraft) => boolean | void | Promise<boolean | void>;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<boolean> | boolean;
  onToggleSessionState?: (
    sessionId: string,
    currentStatus: AgentTeamsSidebarTeam['status'],
  ) => Promise<boolean> | boolean;
  selectedWorkspacePath?: string | null;
  onWorkspaceChange?: (workspacePath: string | null) => void;
  loading?: boolean;
  chromeless?: boolean;
  controlledSearchQuery?: string;
  showNewSessionModal?: boolean;
  onCloseNewSessionModal?: () => void;
  initialTemplateId?: string | null;
  initialWorkingDirectory?: string | null;
  onOpenNewSessionModal?: (templateId?: string | null, workingDirectory?: string | null) => void;
}
import { useTeamSidebarFileTreeState } from './use-team-sidebar-file-tree-state.js';
import { useTeamFilePreview } from './use-team-file-preview.js';
import { TeamFilePreviewPanel } from './TeamFilePreviewPanel.js';

function getParentDirectory(path: string): string {
  return getParentPath(path) ?? path;
}

// ─── Styles (与 chat SessionSidebar 完全对齐) ───────────────────────────────

const TOP_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 8px 6px',
  flexShrink: 0,
  alignItems: 'center',
};

const PRIMARY_BTN_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  height: 30,
  padding: '0 10px',
  alignItems: 'center',
  gap: 6,
  borderRadius: '8px 0 0 8px',
  background: 'var(--accent)',
  color: 'var(--fg-on-accent)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  minWidth: 0,
  justifyContent: 'center',
  border: 'none',
};

const PRIMARY_BTN_DISABLED_STYLE: CSSProperties = {
  ...PRIMARY_BTN_STYLE,
  opacity: 0.55,
  cursor: 'not-allowed',
};

const PRIMARY_SPLIT_BTN_STYLE: CSSProperties = {
  display: 'flex',
  width: 30,
  height: 30,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '0 8px 8px 0',
  background: 'var(--accent)',
  borderLeft: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
  color: 'var(--fg-on-accent)',
  cursor: 'pointer',
  flexShrink: 0,
  border: 'none',
};

const FILE_TREE_CONTAINER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '8px 0',
};

const FILE_TREE_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px 7px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'color-mix(in srgb, var(--bg-overlay) 82%, var(--bg-base))',
  margin: '0 10px 8px',
};

const FILE_TREE_TOOL_BTN_STYLE: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TeamSidebarWithFileTreeProps extends TeamSessionListSidebarProps {
  /** Workspace path for file tree operations. */
  workspacePath?: string | null;
  /** Callback when user clicks a file in the tree. */
  onOpenFile?: (path: string) => void;
  /** 点击副 split 按钮（工作区选择器入口）的回调；不传则不渲染该按钮。 */
  onOpenWorkspacePicker?: () => void;
  /** 顶层受控打开新会话弹窗（可附带模板预选）。 */
  onOpenNewSessionModal?: (templateId?: string | null, workingDirectory?: string | null) => void;
  /** 新建工作区回调（split button 副按钮）。 */
  onCreateWorkspace?: () => void;
  /** 是否有权限创建工作区。 */
  canCreateWorkspace?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TeamSidebarWithFileTree({
  workspacePath,
  onOpenFile,
  onOpenWorkspacePicker,
  onOpenNewSessionModal,
  onCreateWorkspace,
  canCreateWorkspace,
  canManageSessionEntries = true,
  onSubmitDraft,
  teamWorkspaceId,
  selectedTeamId,
  initialTemplateId,
  initialWorkingDirectory,
  showNewSessionModal: controlledShowModal,
  onCloseNewSessionModal,
  collapsed,
  onToggleCollapsed,
  ..._sidebarProps
}: TeamSidebarWithFileTreeProps) {
  const [internalShowNewSessionModal, setInternalShowNewSessionModal] = useState(false);
  const [internalInitialWorkingDirectory, setInternalInitialWorkingDirectory] = useState<
    string | null
  >(null);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const token = useAuthStore((s) => s.accessToken);
  const showNewSessionModal = controlledShowModal ?? internalShowNewSessionModal;
  const effectiveInitialWorkingDirectory =
    initialWorkingDirectory ?? internalInitialWorkingDirectory;
  const workspaceClient = useMemo(() => createWorkspaceClient(gatewayUrl), [gatewayUrl]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: FileTreeContextTarget;
  } | null>(null);
  const {
    applyCreatedEntry,
    applyDeletedEntry,
    applyRenamedEntry,
    expandedDirs,
    handleRefresh,
    handleToggleDir,
    refreshDirectory,
    treeError,
    treeLoading,
    treeNodes,
  } = useTeamSidebarFileTreeState({
    active: true,
    gatewayUrl,
    token,
    workspacePath,
  });

  // F5：单击文件树节点 → 内联预览（轻量，不进编辑器 tab）。
  const filePreview = useTeamFilePreview(workspacePath);

  const handlePreviewFile = useCallback(
    (path: string) => {
      // 当父级提供了完整编辑器入口（onOpenFile）时，单击直接在铺满内容区的
      // 编辑器中打开 —— 这是用户期望的「点击文件 = 打开真正的编辑器」体验。
      // 仅在没有编辑器入口时，才回退到轻量内联预览浮层。
      if (onOpenFile) {
        onOpenFile(path);
        return;
      }
      filePreview.preview(path);
    },
    [filePreview, onOpenFile],
  );

  const handleNodeContextMenu = useCallback((target: FileTreeContextTarget) => {
    setContextMenu({
      x: target.x,
      y: target.y,
      target,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenuOpen = useCallback(() => {
    if (contextMenu?.target.path && onOpenFile) {
      onOpenFile(contextMenu.target.path);
    }
    setContextMenu(null);
  }, [contextMenu, onOpenFile]);

  const handleCopyPath = useCallback(() => {
    if (contextMenu?.target.path) {
      void copyTextToClipboard(contextMenu.target.path)
        .then(() => {
          toast('已复制完整路径', 'success');
        })
        .catch((error: unknown) => {
          toast(error instanceof Error ? error.message : '复制失败', 'error');
        });
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCopyRelativePath = useCallback(() => {
    if (contextMenu?.target.path && workspacePath) {
      const rel = getFileTreeRelativePath(workspacePath, contextMenu.target.path);
      void copyTextToClipboard(rel ?? contextMenu.target.path)
        .then(() => {
          toast(rel ? '已复制相对路径' : '已复制完整路径', 'success');
        })
        .catch((error: unknown) => {
          toast(error instanceof Error ? error.message : '复制失败', 'error');
        });
    }
    setContextMenu(null);
  }, [contextMenu, workspacePath]);

  const handleRefreshTree = useCallback(() => {
    setContextMenu(null);
    handleRefresh();
  }, [handleRefresh]);

  const createEntryAt = useCallback(
    async (entryType: 'file' | 'directory', directoryPath: string, locationLabel: string) => {
      if (!token) {
        toast('当前未连接到网关，无法修改文件树。', 'warning');
        return false;
      }

      const defaultName = entryType === 'file' ? 'untitled.ts' : 'new-folder';
      const input = window.prompt(
        entryType === 'file'
          ? `在“${locationLabel}”中新建文件`
          : `在“${locationLabel}”中新建文件夹`,
        defaultName,
      );
      if (input == null) {
        return false;
      }

      const entryName = input.trim();
      if (!isValidFileTreeEntryName(entryName)) {
        toast('名称不能为空、不能包含 / 或 \\，且不能使用受隐藏规则影响的目录名。', 'warning');
        return false;
      }

      const nextPath = joinFileTreePath(directoryPath, entryName);

      try {
        if (entryType === 'file') {
          await workspaceClient.createFile(token, nextPath);
        } else {
          await workspaceClient.createDirectory(token, nextPath);
        }

        applyCreatedEntry({
          directoryPath,
          entry: {
            path: nextPath,
            name: entryName,
            type: entryType === 'file' ? 'file' : 'directory',
            ...(entryType === 'directory' ? { children: [] } : {}),
          },
        });

        void refreshDirectory(directoryPath);
        if (entryType === 'file') {
          onOpenFile?.(nextPath);
        }
        toast(
          entryType === 'file' ? `已创建文件：${entryName}` : `已创建文件夹：${entryName}`,
          'success',
        );
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : '创建失败', 'error');
        return false;
      }
    },
    [applyCreatedEntry, onOpenFile, refreshDirectory, token, workspaceClient],
  );

  const handleCreateEntry = useCallback(
    async (entryType: 'file' | 'directory') => {
      if (!contextMenu) {
        return;
      }

      const locationLabel =
        contextMenu.target.type === 'file'
          ? `${contextMenu.target.name} 所在目录`
          : contextMenu.target.name;
      try {
        await createEntryAt(entryType, contextMenu.target.directoryPath, locationLabel);
      } finally {
        setContextMenu(null);
      }
    },
    [contextMenu, createEntryAt],
  );

  const handleDeleteEntry = useCallback(async () => {
    if (!contextMenu || !token) {
      toast('当前未连接到网关，无法删除文件。', 'warning');
      return;
    }

    const confirmMessage =
      contextMenu.target.type === 'directory'
        ? `确定要删除文件夹「${contextMenu.target.name}」及其所有内容吗？此操作不可撤销。`
        : `确定要删除文件「${contextMenu.target.name}」吗？此操作不可撤销。`;
    if (!window.confirm(confirmMessage)) {
      setContextMenu(null);
      return;
    }

    const refreshPath =
      contextMenu.target.type === 'directory'
        ? getParentDirectory(contextMenu.target.path)
        : contextMenu.target.directoryPath;

    try {
      await workspaceClient.deleteEntry(token, contextMenu.target.path, {
        ...(selectedTeamId ? { sessionId: selectedTeamId } : {}),
        ...(workspacePath ? { workspaceRoot: workspacePath } : {}),
      });
      applyDeletedEntry(contextMenu.target.path);
      void refreshDirectory(refreshPath);
      toast(`已删除：${contextMenu.target.name}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setContextMenu(null);
    }
  }, [
    applyDeletedEntry,
    contextMenu,
    refreshDirectory,
    selectedTeamId,
    token,
    workspaceClient,
    workspacePath,
  ]);

  const handleRenameEntry = useCallback(async () => {
    if (!contextMenu || !token) {
      toast('当前未连接到网关，无法重命名文件。', 'warning');
      return;
    }

    const nextName = window.prompt(
      `重命名「${contextMenu.target.name}」为：`,
      contextMenu.target.name,
    );
    if (nextName == null) {
      setContextMenu(null);
      return;
    }

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === contextMenu.target.name) {
      setContextMenu(null);
      return;
    }
    if (!isValidFileTreeEntryName(trimmed)) {
      toast('名称无效，请检查是否包含特殊字符。', 'warning');
      setContextMenu(null);
      return;
    }

    const parentDirectory =
      contextMenu.target.directoryPath === contextMenu.target.path
        ? getParentDirectory(contextMenu.target.path)
        : contextMenu.target.directoryPath;
    const newPath = joinFileTreePath(parentDirectory, trimmed);

    try {
      await workspaceClient.renameEntry(token, contextMenu.target.path, newPath, {
        ...(selectedTeamId ? { sessionId: selectedTeamId } : {}),
        ...(workspacePath ? { workspaceRoot: workspacePath } : {}),
      });
      applyRenamedEntry({
        oldPath: contextMenu.target.path,
        newPath,
        newName: trimmed,
      });
      void refreshDirectory(parentDirectory);
      toast(`已重命名为：${trimmed}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '重命名失败', 'error');
    } finally {
      setContextMenu(null);
    }
  }, [
    applyRenamedEntry,
    contextMenu,
    refreshDirectory,
    selectedTeamId,
    token,
    workspaceClient,
    workspacePath,
  ]);

  const handleReferenceInChat = useCallback(() => {
    if (!contextMenu) {
      return;
    }

    const relativePath = workspacePath
      ? getFileTreeRelativePath(workspacePath, contextMenu.target.path)
      : null;
    const referencePath = relativePath ?? contextMenu.target.path;
    const targetKind = contextMenu.target.type === 'file' ? '文件' : '目录';

    dispatchComposerReference(`@${referencePath} `);
    toast(`已引用${targetKind}到对话输入框`, 'success');
    setContextMenu(null);
  }, [contextMenu, workspacePath]);

  const handleNewSessionClick = useCallback(() => {
    if (!canManageSessionEntries) {
      return;
    }
    if (!teamWorkspaceId) {
      console.warn('[TeamSidebarWithFileTree] 请先选择工作空间');
      return;
    }
    if (onOpenNewSessionModal) {
      onOpenNewSessionModal(null, null);
      return;
    }
    setInternalInitialWorkingDirectory(null);
    setInternalShowNewSessionModal(true);
  }, [canManageSessionEntries, onOpenNewSessionModal, teamWorkspaceId]);

  const handleCloseNewSessionModal = useCallback(() => {
    setInternalInitialWorkingDirectory(null);
    if (onCloseNewSessionModal) {
      onCloseNewSessionModal();
      return;
    }
    setInternalShowNewSessionModal(false);
  }, [onCloseNewSessionModal]);

  const handleCreateSessionFromDirectory = useCallback(() => {
    if (!contextMenu || contextMenu.target.type !== 'directory') {
      return;
    }
    if (!canManageSessionEntries) {
      setContextMenu(null);
      return;
    }
    if (!teamWorkspaceId) {
      toast('请先选择工作空间后再创建会话。', 'warning');
      setContextMenu(null);
      return;
    }

    if (onOpenNewSessionModal) {
      onOpenNewSessionModal(null, contextMenu.target.path);
      setContextMenu(null);
      return;
    }

    setInternalInitialWorkingDirectory(contextMenu.target.path);
    setInternalShowNewSessionModal(true);
    setContextMenu(null);
  }, [canManageSessionEntries, contextMenu, onOpenNewSessionModal, teamWorkspaceId]);

  const canCreateSession = Boolean(canManageSessionEntries && onSubmitDraft && teamWorkspaceId);
  const canMutateWorkspaceTree = Boolean(token && workspacePath);
  const canRefreshWorkspaceTree = Boolean(token && workspacePath);

  // 折叠态：会话列表已从本栏移除，文件树也无需在 52px 窄列中渲染，
  // 因此只展示一个「展开」入口，点击后恢复文件树全宽。
  if (collapsed) {
    return (
      <div
        className="team-v2-workspace-sidebar-collapsed"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 8,
          height: '100%',
          minHeight: 0,
        }}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="展开文件树"
          aria-label="展开文件树"
          className="icon-btn"
          style={{
            display: 'inline-flex',
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--fg-default)',
            cursor: 'pointer',
          }}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      className="team-v2-workspace-sidebar-content"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      {/* 顶部主按钮行：新建会话 + 工作区切换（split button 模式） */}
      <div className="team-v2-workspace-sidebar-actions" style={TOP_BAR_STYLE}>
        <div
          className="team-v2-workspace-sidebar-action-group"
          style={{ display: 'flex', gap: 0, flex: 1, minWidth: 0 }}
        >
          <button
            type="button"
            onClick={handleNewSessionClick}
            disabled={!canCreateSession}
            title={
              !canManageSessionEntries
                ? '当前工作区不可写'
                : canCreateSession
                  ? '新建会话'
                  : '请先选择工作空间'
            }
            className="icon-btn-accent"
            style={canCreateSession ? PRIMARY_BTN_STYLE : PRIMARY_BTN_DISABLED_STYLE}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新建会话
          </button>
          {/* 新建工作区按钮（split button 副按钮，与 chat 端布局一致） */}
          {canCreateWorkspace && onCreateWorkspace ? (
            <button
              type="button"
              onClick={onCreateWorkspace}
              title="新建工作区"
              className="team-v2-workspace-sidebar-split-action"
              style={PRIMARY_SPLIT_BTN_STYLE}
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          ) : onOpenWorkspacePicker ? (
            <button
              type="button"
              onClick={onOpenWorkspacePicker}
              title="选择工作区"
              className="team-v2-workspace-sidebar-split-action"
              style={PRIMARY_SPLIT_BTN_STYLE}
            >
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {showNewSessionModal && teamWorkspaceId && onSubmitDraft ? (
        <NewTeamSessionModal
          onClose={handleCloseNewSessionModal}
          onSubmitDraft={onSubmitDraft}
          workspaceLabel={_sidebarProps.workspaceLabel ?? '默认工作区'}
          teamWorkspaceId={teamWorkspaceId}
          defaultMemberSlots={_sidebarProps.defaultMemberSlots}
          initialTemplateId={initialTemplateId}
          initialWorkingDirectory={effectiveInitialWorkingDirectory}
        />
      ) : null}
    </div>
  );
}
