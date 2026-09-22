/**
 * ChatPage 的派生数据与融合上下文 handler（P4 原样搬家）。
 *
 * 由 `ChatPage` 原位调用；依赖对象在同一位置构造（依赖均在其之前声明，无 TDZ）。
 */
import type { ComposerStatsData } from '../../../components/chat/composer/ComposerStatsBar.js';
import { downloadExport, exportMessages } from '../../../components/chat/message/message-export.js';
import type { UseMessageMultiSelectReturn } from '../../../components/chat/message/message-multi-select.js';
import type { CommandPaletteItem } from '../../../components/chat/misc/command-palette.js';
import { useChatSearch } from '../../../components/chat/search/chat-search-overlay.js';
import { toast } from '../../../components/common/feedback/ToastNotification.js';
import type { FileTreeNode } from '../../../components/common/modal/WorkspacePickerModal.js';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type { ChatUsageDetails } from '../../../components/conversation-runtime/messages/message-model.js';
import type {
  ChatMessage,
  WorkspaceFileMentionItem,
} from '../../../components/conversation-runtime/messages/support.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import { WorkspaceFileTreePanel } from '../../../components/layout/sidebar/WorkspaceFileTreePanel.js';
import type {
  OpenFile,
  OpenFileOptions,
  RevealTarget,
} from '../../../hooks/editor/useFileEditor.js';

import { useBookmarkStore } from '../../../stores/chat/bookmarks.js';
import type { ChatEditorPaneTab } from '.././hooks/use-chat-ui-state.js';
import type { FusionChatLayoutState } from '.././layout/use-fusion-chat-layout.js';
import type { DialogueMode } from '.././mode/dialogue-mode.js';
import type { FusionContextOverviewProps } from '.././panels/FusionContextTab.js';
import type { ChatRightPanelState } from '.././state/chat-stream-state.js';
import type { PendingPermissionRequest, SessionPermissionMode } from '@openAwork/shared';
import type {
  PendingQuestionRequest,
  Session,
  SessionTask,
  SessionTodo,
} from '@openAwork/web-client';
import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction, TransitionStartFunction } from 'react';
import type { NavigateFunction } from 'react-router';

export interface ChatPageDerivationsDeps {
  readonly artifactsWorkspaceHref: string | null;
  readonly assistantUsageDetails: Map<string, ChatUsageDetails>;
  readonly bookmarkStore: ReturnType<typeof useBookmarkStore.getState>;
  readonly browserPreviewUrl: string | null;
  readonly canAdjustWorkspaceBinding: boolean;
  readonly chatSearch: ReturnType<typeof useChatSearch>;
  readonly childSessions: Session[];
  readonly collapseWorkspaceToPanel: () => void;
  readonly compactions: {
    id: string;
    summary: string;
    trigger: 'manual' | 'automatic';
    phase?: 'started' | 'completed' | 'failed' | undefined;
    occurredAt: number;
    compactedMessages?: number | undefined;
    representedMessages?: number | undefined;
    cause?:
      'manual' | 'usage_overflow' | 'provider_overflow' | 'proactive_near_overflow' | undefined;
    strategy?: 'runtime_replace' | 'summary_only' | 'replay' | 'synthetic_continue' | undefined;
  }[];
  readonly contentArtifactCount: number;
  readonly contentArtifactCountStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly currentSessionId: string | null;
  readonly dialogueMode: DialogueMode;
  readonly dockOwnsWorkspacePanels: boolean;
  readonly editorFullScreen: boolean;
  readonly editorPaneTab: ChatEditorPaneTab;
  readonly effectiveContextMessageCount: number;
  readonly effectiveReportedStreamUsage: ChatBackendUsageSnapshot | undefined;
  readonly effectiveWorkingDirectory: string | null;
  readonly fileEditor: {
    openFiles: OpenFile[];
    activeFile: OpenFile | null;
    activeFilePath: string | null;
    loading: boolean;
    saveError: string | null;
    openFile: (path: string, options?: OpenFileOptions | undefined) => Promise<void>;
    closeFile: (path: string) => void;
    updateContent: (path: string, content: string) => void;
    saveFile: (path: string) => Promise<void>;
    reorderFiles: (fromIndex: number, toIndex: number) => void;
    setActiveFilePath: (path: string | null) => void;
    isDirty: (path: string) => boolean;
    revealTarget: RevealTarget | null;
    clearRevealTarget: () => void;
  };
  readonly fusionChatLayout: FusionChatLayoutState;
  readonly handleCompactCurrentSession: () => Promise<void>;
  readonly handleCopyMessage: (message: ChatMessage) => void;
  readonly handleToggleYolo: () => void;
  readonly hiddenMessageCount: number;
  readonly isFusionLayout: boolean;
  readonly messages: ChatMessage[];
  readonly multiSelect: UseMessageMultiSelectReturn;
  readonly navigate: NavigateFunction;
  readonly navigateToHome: () => void;
  readonly openBrowserPreview: () => void;
  readonly openWorkspacePanelTab: (tab: 'code' | 'preview') => void;
  readonly pendingPermissions: PendingPermissionRequest[];
  readonly pendingQuestions: PendingQuestionRequest[];
  readonly permissionMode: SessionPermissionMode;
  readonly promoteWorkspaceTab: (tab: 'code' | 'browser') => void;
  readonly requestWorkspaceBindingChange: () => void;
  readonly reviewPanelOpened: boolean;
  readonly rightOpen: boolean;
  readonly rightPanelState: ChatRightPanelState;
  readonly serverTotalTurnCount: number | null;
  readonly sessionStateStatus: 'idle' | 'running' | 'paused' | null | undefined;
  readonly sessionTasks: SessionTask[];
  readonly sessionTodos: SessionTodo[];
  readonly setEditorMode: (v: boolean) => void;
  readonly setEditorPaneTab: (tab: ChatEditorPaneTab) => void;
  readonly setRightOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  readonly setRightTab: (
    value:
      | 'agent'
      | 'overview'
      | 'mcp'
      | 'bookmarks'
      | 'plan'
      | 'tools'
      | 'terminals'
      | 'skills'
      | 'snapshots'
      | 'history'
      | 'viz'
      | ((
          prev:
            | 'agent'
            | 'overview'
            | 'mcp'
            | 'bookmarks'
            | 'plan'
            | 'tools'
            | 'terminals'
            | 'skills'
            | 'snapshots'
            | 'history'
            | 'viz',
        ) =>
          | 'agent'
          | 'overview'
          | 'mcp'
          | 'bookmarks'
          | 'plan'
          | 'tools'
          | 'terminals'
          | 'skills'
          | 'snapshots'
          | 'history'
          | 'viz'),
  ) => void;
  readonly setShowTemplatePanel: Dispatch<SetStateAction<boolean>>;
  readonly startSessionSwitchTransition: TransitionStartFunction;
  readonly streamingUsageDetails: ChatUsageDetails | undefined;
  readonly visibleStreaming: boolean;
  readonly workspace: {
    workingDirectory: string | null;
    sshConnectionId: string | null;
    loading: boolean;
    error: string | null;
    setWorkspace: (path: string) => Promise<void>;
    clearWorkspace: () => Promise<void>;
    validatePath: (
      path: string,
    ) => Promise<{ valid: boolean; error?: string | undefined; path?: string | undefined }>;
    fetchRootPath: () => Promise<string>;
    fetchWorkspaceRoots: () => Promise<string[]>;
    fetchTree: (path: string, depth?: number) => Promise<FileTreeNode[]>;
    fetchSshTree: (connectionId: string, path: string) => Promise<FileTreeNode[]>;
    createSshDirectory: (connectionId: string, path: string) => Promise<void>;
    searchFileIndex: (
      path: string,
      options: {
        query: string;
        limit?: number | undefined;
        signal?: AbortSignal | undefined;
        sessionId?: string | null | undefined;
        sshConnectionId?: string | null | undefined;
      },
    ) => Promise<{ files: string[]; directories: string[] }>;
    createDirectory: (path: string) => Promise<void>;
    fetchFile: (path: string) => Promise<{ content: string; truncated: boolean }>;
    searchFiles: (
      q: string,
      rootPath: string,
      maxResults?: number,
    ) => Promise<{ path: string; line: number; text: string }[]>;
  };
  readonly workspaceFileItems: WorkspaceFileMentionItem[];
  readonly yoloMode: boolean;
}

export function useChatPageDerivations(deps: ChatPageDerivationsDeps) {
  const {
    artifactsWorkspaceHref,
    assistantUsageDetails,
    bookmarkStore,
    browserPreviewUrl,
    canAdjustWorkspaceBinding,
    chatSearch,
    childSessions,
    collapseWorkspaceToPanel,
    compactions,
    contentArtifactCount,
    contentArtifactCountStatus,
    contextUsageSnapshot,
    currentSessionId,
    dialogueMode,
    dockOwnsWorkspacePanels,
    editorFullScreen,
    editorPaneTab,
    effectiveContextMessageCount,
    effectiveReportedStreamUsage,
    effectiveWorkingDirectory,
    fileEditor,
    fusionChatLayout,
    handleCompactCurrentSession,
    handleCopyMessage,
    handleToggleYolo,
    hiddenMessageCount,
    isFusionLayout,
    messages,
    multiSelect,
    navigate,
    navigateToHome,
    openBrowserPreview,
    openWorkspacePanelTab,
    pendingPermissions,
    pendingQuestions,
    permissionMode,
    promoteWorkspaceTab,
    requestWorkspaceBindingChange,
    reviewPanelOpened,
    rightOpen,
    rightPanelState,
    serverTotalTurnCount,
    sessionStateStatus,
    sessionTasks,
    sessionTodos,
    setEditorMode,
    setEditorPaneTab,
    setRightOpen,
    setRightTab,
    setShowTemplatePanel,
    startSessionSwitchTransition,
    streamingUsageDetails,
    visibleStreaming,
    workspace,
    workspaceFileItems,
    yoloMode,
  } = deps;

  const composerStatsData = useMemo<ComposerStatsData | null>(() => {
    const usageDetails = assistantUsageDetails;
    if (usageDetails.size === 0 && !visibleStreaming) {
      return null;
    }

    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalDurationMs = 0;

    for (const details of usageDetails.values()) {
      totalCostUsd += details.estimatedCostUsd ?? 0;
      totalInputTokens += details.inputTokens;
      totalOutputTokens += details.outputTokens;
      totalDurationMs += details.durationMs ?? 0;
    }

    // 流式中的实时数据叠加
    let currentRoundCostUsd = 0;
    if (streamingUsageDetails) {
      const streamingNotCounted = streamingUsageDetails.requestIndex > usageDetails.size;
      if (streamingNotCounted) {
        totalCostUsd += streamingUsageDetails.estimatedCostUsd ?? 0;
        totalInputTokens += streamingUsageDetails.inputTokens;
        totalOutputTokens += streamingUsageDetails.outputTokens;
      }
      currentRoundCostUsd = streamingUsageDetails.estimatedCostUsd ?? 0;
    } else {
      // 非流式时，取最后一轮的费用作为"本轮"
      const lastDetails = Array.from(usageDetails.values()).pop();
      currentRoundCostUsd = lastDetails?.estimatedCostUsd ?? 0;
    }

    const contextUsedTokens = contextUsageSnapshot?.usedTokens ?? 0;
    const contextMaxTokens = contextUsageSnapshot?.maxTokens ?? 0;
    const contextIsEstimated = contextUsageSnapshot?.estimated ?? false;
    const latestCompaction = compactions[0];

    return {
      totalCostUsd,
      currentRoundCostUsd,
      totalInputTokens,
      totalOutputTokens,
      reasoningTokens: effectiveReportedStreamUsage?.reasoningTokens,
      cacheReadTokens: effectiveReportedStreamUsage?.cacheReadTokens,
      cacheWriteTokens: effectiveReportedStreamUsage?.cacheWriteTokens,
      contextUsedTokens,
      contextMaxTokens,
      contextIsEstimated,
      messageTurns: usageDetails.size,
      hiddenMessageCount: hiddenMessageCount ?? 0,
      serverTotalTurnCount: serverTotalTurnCount ?? null,
      compactionCount: compactions.length,
      latestCompactionTrigger: latestCompaction?.trigger,
      latestCompactionRepresentedMessages: latestCompaction?.representedMessages,
      latestCompactionCompactedMessages: latestCompaction?.compactedMessages,
      childSessionCount: childSessions.length,
      sessionTaskCount: sessionTasks.length,
      tokensPerSecond: streamingUsageDetails?.tokensPerSecond,
      firstTokenLatencyMs: streamingUsageDetails?.firstTokenLatencyMs,
      currentRoundDurationMs: streamingUsageDetails?.durationMs,
      totalDurationMs,
      streaming: visibleStreaming,
    };
  }, [
    assistantUsageDetails,
    contextUsageSnapshot,
    streamingUsageDetails,
    effectiveReportedStreamUsage,
    visibleStreaming,
    hiddenMessageCount,
    serverTotalTurnCount,
    compactions,
    childSessions.length,
    sessionTasks.length,
  ]);
  const handleFusionContextCompactSession = useCallback(() => {
    void handleCompactCurrentSession();
  }, [handleCompactCurrentSession]);
  const handleFusionContextOpenRecoveryStrategy = useCallback(() => {
    setRightOpen(true);
    setRightTab('history');
  }, [setRightOpen, setRightTab]);
  const fusionContextSessionStateStatus: FusionContextOverviewProps['sessionStateStatus'] =
    sessionStateStatus === undefined ? null : sessionStateStatus;
  const fusionContextOverview = useMemo<FusionContextOverviewProps>(
    () => ({
      attachmentItems: [],
      artifactsWorkspaceHref,
      childSessions,
      compactions,
      contextUsageSnapshot,
      contentArtifactCount,
      contentArtifactCountStatus,
      currentSessionId,
      dialogueMode,
      effectiveWorkingDirectory,
      messages,
      effectiveContextMessageCount,
      onCompactSession: handleFusionContextCompactSession,
      onOpenRecoveryStrategy: handleFusionContextOpenRecoveryStrategy,
      pendingPermissions,
      pendingQuestionsCount: pendingQuestions.length,
      permissionMode,
      sessionStateStatus: fusionContextSessionStateStatus,
      sessionTasks,
      sessionTodos,
      upstreamSummaries: rightPanelState.upstreamSummaries,
      workspaceFileItems,
      yoloMode,
    }),
    [
      artifactsWorkspaceHref,
      childSessions,
      compactions,
      contextUsageSnapshot,
      contentArtifactCount,
      contentArtifactCountStatus,
      currentSessionId,
      dialogueMode,
      effectiveWorkingDirectory,
      handleFusionContextCompactSession,
      handleFusionContextOpenRecoveryStrategy,
      messages,
      pendingPermissions,
      pendingQuestions.length,
      permissionMode,
      rightPanelState.upstreamSummaries,
      fusionContextSessionStateStatus,
      sessionTasks,
      sessionTodos,
      workspaceFileItems,
      yoloMode,
    ],
  );
  const handleOpenFusionEditorFile = useCallback(
    (path: string) => {
      void fileEditor.openFile(path);
    },
    [fileEditor],
  );
  const handleShowFusionEditor = useCallback(() => {
    startSessionSwitchTransition(() => {
      setEditorMode(true);
      setEditorPaneTab('code');
    });
  }, [setEditorMode, setEditorPaneTab]);

  // 主编辑器面板与停靠面板「代码」tab 共用同一份文件树配置，避免两处漂移；
  // 只有当前可见的那份 active=true，避免两份树同时拉取数据。
  const renderWorkspaceFileTree = (active: boolean) => (
    <WorkspaceFileTreePanel
      workspacePath={effectiveWorkingDirectory}
      sessionId={currentSessionId}
      onOpenFile={(path) => void fileEditor.openFile(path)}
      fetchTree={workspace.fetchTree}
      active={active}
      variant="embedded"
      onSwitchWorkspace={canAdjustWorkspaceBinding ? requestWorkspaceBindingChange : undefined}
      style={{
        flex: 1,
        minHeight: 0,
        background: 'var(--bg-surface)',
        overflow: 'hidden',
      }}
    />
  );

  // ─── Command Palette items ──────────────────────────────────────────────
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: 'search',
        label: '在对话中查找',
        description: '搜索当前会话的消息内容',
        category: '导航',
        shortcut: '⌘F',
        icon: '🔍',
        onExecute: () => chatSearch.open(),
      },
      {
        id: 'templates',
        label: '提示词模板',
        description: '打开模板库，快速插入常用提示词',
        category: '输入',
        shortcut: '⌘⇧T',
        icon: '📋',
        onExecute: () => setShowTemplatePanel(true),
      },
      {
        id: 'multi-select',
        label: multiSelect.multiSelect.enabled ? '退出多选模式' : '多选消息',
        description: '批量选择消息进行复制、导出或收藏',
        category: '操作',
        shortcut: '⌘⇧M',
        icon: '☑',
        onExecute: () => {
          if (multiSelect.multiSelect.enabled) {
            multiSelect.disableMultiSelect();
          } else {
            multiSelect.enableMultiSelect();
            // 默认全选,避免空选导致用户以为操作失效。
            // 用户随后用 toolbar 的"全选/取消"或单条菜单的"☐ 选择"调整。
            requestAnimationFrame(() => multiSelect.selectAll(messages));
          }
        },
      },
      {
        id: 'export-markdown',
        label: '导出对话为 Markdown',
        description: '将当前会话导出为 Markdown 文件',
        category: '导出',
        icon: '📤',
        onExecute: () => {
          const content = exportMessages(messages, 'markdown');
          downloadExport(content, `chat-export-${Date.now()}.md`, 'text/markdown');
        },
      },
      {
        id: 'export-json',
        label: '导出对话为 JSON',
        description: '将当前会话导出为 JSON 文件',
        category: '导出',
        icon: '📦',
        onExecute: () => {
          const content = exportMessages(messages, 'json');
          downloadExport(content, `chat-export-${Date.now()}.json`, 'application/json');
        },
      },
      {
        id: 'copy-last-assistant',
        label: '复制最后一条助手消息',
        description: '将最近的助手回复复制到剪贴板',
        category: '操作',
        shortcut: '⌘⇧C',
        icon: '📋',
        onExecute: () => {
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant) {
            handleCopyMessage(lastAssistant);
            toast('已复制最后一条助手消息', 'success');
          }
        },
      },
      {
        id: 'open-workspace-code-panel',
        label: '打开代码面板',
        description: '在会话面板中打开文件代码编辑器',
        category: '视图',
        icon: '💻',
        onExecute: () => openWorkspacePanelTab('code'),
      },
      {
        id: 'promote-workspace-panel',
        label: editorFullScreen ? '退出放大（回到会话面板）' : '放大代码 / 预览面板',
        description: '让代码编辑器或浏览器预览占据整个内容区；再次执行收回到会话面板',
        category: '视图',
        icon: '🖥',
        onExecute: () => {
          if (editorFullScreen) {
            collapseWorkspaceToPanel();
            return;
          }
          promoteWorkspaceTab(editorPaneTab);
        },
      },
      {
        id: 'open-browser-preview',
        label: '打开浏览器预览',
        description: '在会话面板中打开内置浏览器预览（输入 URL 或自动检测 dev server）',
        category: '视图',
        icon: '🌐',
        onExecute: () => openBrowserPreview(),
      },
      {
        id: 'toggle-right-panel',
        label: isFusionLayout
          ? fusionChatLayout.rightPanelCommandLabel
          : rightOpen
            ? '收起右侧面板'
            : '展开右侧面板',
        description: isFusionLayout
          ? fusionChatLayout.rightPanelCommandDescription
          : '切换计划/工具/概览面板',
        category: '视图',
        shortcut: '⌘\\',
        icon: '📊',
        onExecute: () => {
          if (isFusionLayout) {
            fusionChatLayout.toggleReviewPanel();
            return;
          }
          setRightOpen((v) => !v);
        },
      },
      {
        id: 'compact-session',
        label: '压缩当前会话',
        description: '压缩对话历史以释放上下文空间',
        category: '会话',
        icon: '🗜',
        onExecute: () => void handleCompactCurrentSession(),
      },
      {
        id: 'new-session',
        label: '新建会话',
        description: '创建一个新的对话会话',
        category: '会话',
        shortcut: '⌘N',
        icon: '✨',
        onExecute: () => {
          navigate('/chat');
          navigateToHome();
        },
      },
      {
        id: 'toggle-yolo',
        label: yoloMode ? '关闭 YOLO 模式' : '开启 YOLO 模式',
        description: '切换自动审批模式',
        category: '设置',
        icon: '⚡',
        onExecute: () => handleToggleYolo(),
      },
      {
        id: 'view-bookmarks',
        label: '查看收藏消息',
        description: `当前会话有 ${bookmarkStore.getSessionBookmarks(currentSessionId ?? '').length} 条收藏`,
        category: '操作',
        icon: '⭐',
        onExecute: () => {
          setRightOpen(true);
          setRightTab('overview');
        },
      },
    ],
    [
      chatSearch,
      messages,
      multiSelect,
      editorPaneTab,
      editorFullScreen,
      browserPreviewUrl,
      dockOwnsWorkspacePanels,
      reviewPanelOpened,
      rightOpen,
      yoloMode,
      currentSessionId,
      bookmarkStore,
      handleCopyMessage,
      handleCompactCurrentSession,
      fusionChatLayout.rightPanelCommandDescription,
      fusionChatLayout.rightPanelCommandLabel,
      fusionChatLayout.toggleReviewPanel,
      isFusionLayout,
      navigate,
      navigateToHome,
      setRightOpen,
      setRightTab,
      handleToggleYolo,
    ],
  );
  return {
    composerStatsData,
    handleFusionContextCompactSession,
    handleFusionContextOpenRecoveryStrategy,
    fusionContextSessionStateStatus,
    fusionContextOverview,
    handleOpenFusionEditorFile,
    handleShowFusionEditor,
    renderWorkspaceFileTree,
    commandPaletteItems,
  };
}
