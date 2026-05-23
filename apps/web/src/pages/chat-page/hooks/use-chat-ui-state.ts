/**
 * ChatPage UI 状态域 hook（域 D · Phase D）
 *
 * 聚合 ChatPage 中所有"UI 布局 / 视图开关"类的状态、refs 与派生值：
 * - 右侧面板（rightTab / rightOpen + 镜像 ref）
 * - 工具过滤器、MCP 服务器列表
 * - 编辑器分屏（splitPos / splitDragging / 容器 ref）
 * - 编辑器模式 + saving 标志
 * - 编辑器 pane 当前 tab（按 workspace 隔离）
 * - 内置浏览器预览 URL（按 workspace 隔离）+ active 标志
 * - 快捷终端开关（按 workspace 隔离）
 * - 工作区选择器弹窗、伴侣面板触发信号
 * - 滚动相关 refs + 显示"回到底部"按钮的状态
 * - sidebar 布局（透传自 {@link useChatSidebarLayout}）
 *
 * 设计原则：
 *   1. 大部分字段都有跨域消费者（流式/会话生命周期/键盘快捷键等），
 *      hook 只做"状态容器"——声明 + 返回；写入由调用方编排。
 *   2. `splitPos` 故意绕开 zustand persist，使用 `split-pos-storage`
 *      的轻量 localStorage 键，避免拖动 commit 触发 75 字段全量序列化。
 *   3. `rightOpenRef` 与 `rightOpen` 的同步 effect 内置于此 hook，让
 *      流式回调可以直接读取最新值而不必把 `rightOpen` 加入依赖。
 *   4. `companionPanelSignal` 暴露 `bumpCompanionPanelSignal()` 而非
 *      原始 setter——它是单向触发通道，调用方不应关心数值含义。
 *   5. sidebar 子集仍由 {@link useChatSidebarLayout} 拥有；这里仅
 *      透传，让消费方从一处导入。
 *
 * @see docs/architecture/chat-page-split-plan.md 域 D
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MCPServerStatus } from '@openAwork/shared-ui';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { RightPanelTabId } from '../panels/right-panel-tabs.js';
import { readSplitPos, writeSplitPos } from '../state/split-pos-storage.js';
import { useChatSidebarLayout, type ChatSidebarLayout } from './use-chat-sidebar-layout.js';

export type ChatToolFilter = 'all' | 'lsp' | 'file' | 'network' | 'other';
export type ChatEditorPaneTab = 'code' | 'browser';

export interface UseChatUiStateOptions {
  /**
   * 当前会话的有效工作目录（已经做过 currentSessionId / selectedWorkspacePath
   * fallback）。决定 by-workspace 持久化字段的查询桶。`null` / 空字符串归入
   * `__default__` 桶，与 useFileEditor / BuiltInBrowser 的兜底一致。
   */
  effectiveWorkingDirectory: string | null;
}

export interface ChatUiState extends ChatSidebarLayout {
  // ─── 右侧面板 ───────────────────────────────────────────────────────────
  rightTab: RightPanelTabId;
  setRightTab: (value: RightPanelTabId | ((prev: RightPanelTabId) => RightPanelTabId)) => void;
  rightOpen: boolean;
  setRightOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  /** 镜像 `rightOpen` 的 ref，供流式回调在不订阅的情况下读取最新值。 */
  rightOpenRef: React.MutableRefObject<boolean>;

  // ─── 工具过滤 / MCP 列表 ────────────────────────────────────────────────
  toolFilter: ChatToolFilter;
  setToolFilter: React.Dispatch<React.SetStateAction<ChatToolFilter>>;
  mcpServers: MCPServerStatus[];
  setMcpServers: React.Dispatch<React.SetStateAction<MCPServerStatus[]>>;

  // ─── 编辑器模式 / 分屏 / 保存 ───────────────────────────────────────────
  editorMode: boolean;
  setEditorMode: (v: boolean) => void;
  /**
   * 拖动结束后的最终 split 百分比（20–80）。setter 会同步写入 localStorage，
   * 但不触发 React 重渲染——拖动期间通过 CSS 变量直接驱动样式，避免重渲染抖动。
   */
  splitPos: number;
  setSplitPos: typeof writeSplitPos;
  /** 标记当前是否处于拖动中。指针处于 splitter 上时被 `useChatUiActions` 置 true。 */
  splitDragging: React.MutableRefObject<boolean>;
  splitContainerRef: React.RefObject<HTMLDivElement | null>;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  saving: boolean;
  setSaving: React.Dispatch<React.SetStateAction<boolean>>;

  // ─── editor pane tab（按 workspace 持久化） ────────────────────────────
  editorPaneTab: ChatEditorPaneTab;
  setEditorPaneTab: (tab: ChatEditorPaneTab) => void;

  // ─── 浏览器预览（按 workspace 持久化） ─────────────────────────────────
  browserActive: boolean;
  setBrowserActive: (v: boolean) => void;
  browserPreviewUrl: string | null;
  /** 写入当前 workspace 下的预览 URL；非 null 时同时把 browserActive 置 true。 */
  setBrowserPreviewUrl: (url: string | null) => void;

  // ─── 快捷终端（按 workspace 持久化） ───────────────────────────────────
  quickTerminalOpen: boolean;
  quickTerminalOpenByWorkspace: Record<string, boolean>;
  setQuickTerminalOpenForWorkspace: (workspacePath: string | null, open: boolean) => void;

  // ─── 各种弹窗 / 面板信号 ──────────────────────────────────────────────
  showWorkspaceSelector: boolean;
  setShowWorkspaceSelector: React.Dispatch<React.SetStateAction<boolean>>;
  /** 自增计数器：每次 `bumpCompanionPanelSignal()` +1，订阅方据此打开伴侣面板。 */
  companionPanelSignal: number;
  bumpCompanionPanelSignal: () => void;

  // ─── 滚动相关 refs + 状态 ───────────────────────────────────────────────
  bottomRef: React.RefObject<HTMLDivElement | null>;
  contentColumnRef: React.RefObject<HTMLDivElement | null>;
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  pendingScrollFrameRef: React.MutableRefObject<number | null>;
  showScrollToBottom: boolean;
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * 解析 by-workspace 字段的查询桶 key，保持与 useFileEditor /
 * BuiltInBrowser / quickTerminal 的兜底一致。
 */
function resolveWorkspaceKey(effectiveWorkingDirectory: string | null): string {
  return effectiveWorkingDirectory && effectiveWorkingDirectory.trim().length > 0
    ? effectiveWorkingDirectory
    : '__default__';
}

export function useChatUiState(options: UseChatUiStateOptions): ChatUiState {
  const { effectiveWorkingDirectory } = options;

  // ── 右侧面板 ────────────────────────────────────────────────────────────
  // zustand 接口只接受具体值；这里用 useCallback 包一层，让消费方可以
  // 同时使用 `setRightTab(value)` 与 `setRightTab(prev => next)` 两种形式。
  const rightTabRaw = useUIStateStore((s) => s.rightTab);
  const setRightTabStore = useUIStateStore((s) => s.setRightTab);
  const rightTab = (rightTabRaw as RightPanelTabId) ?? 'overview';
  const setRightTab = useCallback(
    (value: RightPanelTabId | ((prev: RightPanelTabId) => RightPanelTabId)) => {
      const next =
        typeof value === 'function'
          ? (value as (p: RightPanelTabId) => RightPanelTabId)(rightTab)
          : value;
      setRightTabStore(next);
    },
    [rightTab, setRightTabStore],
  );

  const rightOpen = useUIStateStore((s) => s.rightOpen);
  const setRightOpenStore = useUIStateStore((s) => s.setRightOpen);
  const setRightOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof value === 'function' ? (value as (p: boolean) => boolean)(rightOpen) : value;
      setRightOpenStore(next);
    },
    [rightOpen, setRightOpenStore],
  );

  // 把 rightOpen 镜像到 ref：流式 onToolCall 等回调需在不重新捕获闭包的前提下
  // 读取最新开闭状态（决定是否切到 tools tab）。
  const rightOpenRef = useRef(rightOpen);
  useEffect(() => {
    rightOpenRef.current = rightOpen;
  }, [rightOpen]);

  // ── 工具过滤 / MCP ──────────────────────────────────────────────────────
  const [toolFilter, setToolFilter] = useState<ChatToolFilter>('all');
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);

  // ── 编辑器模式 / 分屏 / 保存 ────────────────────────────────────────────
  const editorMode = useUIStateStore((s) => s.editorMode);
  const setEditorMode = useUIStateStore((s) => s.setEditorMode);
  // splitPos 故意绕开 zustand UI state：见 split-pos-storage.ts 的注释。
  const [splitPos] = useState(() => readSplitPos());
  const setSplitPos = writeSplitPos;
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  // ── editor pane tab（workspace-keyed） ─────────────────────────────────
  const editorPaneTabByWorkspace = useUIStateStore((s) => s.editorPaneTabByWorkspace);
  const setEditorPaneTabForWorkspace = useUIStateStore((s) => s.setEditorPaneTabForWorkspace);
  const editorPaneWorkspaceKey = resolveWorkspaceKey(effectiveWorkingDirectory);
  const editorPaneTab = editorPaneTabByWorkspace[editorPaneWorkspaceKey] ?? 'code';
  const setEditorPaneTab = useCallback(
    (tab: ChatEditorPaneTab) => {
      setEditorPaneTabForWorkspace(effectiveWorkingDirectory, tab);
    },
    [effectiveWorkingDirectory, setEditorPaneTabForWorkspace],
  );

  // ── 浏览器预览（workspace-keyed） ──────────────────────────────────────
  const browserActive = useUIStateStore((s) => s.browserActive);
  const setBrowserActive = useUIStateStore((s) => s.setBrowserActive);
  const browserPreviewUrlByWorkspace = useUIStateStore((s) => s.browserPreviewUrlByWorkspace);
  const setBrowserPreviewUrlForWorkspace = useUIStateStore(
    (s) => s.setBrowserPreviewUrlForWorkspace,
  );
  const browserWorkspaceKey = editorPaneWorkspaceKey; // 同一桶语义
  const browserPreviewUrl = browserPreviewUrlByWorkspace[browserWorkspaceKey] ?? null;
  const setBrowserPreviewUrl = useCallback(
    (url: string | null) => {
      setBrowserPreviewUrlForWorkspace(effectiveWorkingDirectory, url);
      if (url) setBrowserActive(true);
    },
    [effectiveWorkingDirectory, setBrowserActive, setBrowserPreviewUrlForWorkspace],
  );

  // ── 快捷终端（workspace-keyed） ────────────────────────────────────────
  const quickTerminalOpenByWorkspace = useUIStateStore((s) => s.quickTerminalOpenByWorkspace);
  const setQuickTerminalOpenForWorkspace = useUIStateStore(
    (s) => s.setQuickTerminalOpenForWorkspace,
  );
  const quickTerminalOpen = quickTerminalOpenByWorkspace[browserWorkspaceKey] ?? false;

  // ── 弹窗 / 面板信号 ─────────────────────────────────────────────────────
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  const [companionPanelSignal, setCompanionPanelSignal] = useState(0);
  const bumpCompanionPanelSignal = useCallback(() => {
    setCompanionPanelSignal((v) => v + 1);
  }, []);

  // ── 滚动 ────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const contentColumnRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // ── sidebar 布局（透传） ───────────────────────────────────────────────
  const sidebar = useChatSidebarLayout();

  return {
    ...sidebar,

    rightTab,
    setRightTab,
    rightOpen,
    setRightOpen,
    rightOpenRef,

    toolFilter,
    setToolFilter,
    mcpServers,
    setMcpServers,

    editorMode,
    setEditorMode,
    splitPos,
    setSplitPos,
    splitDragging,
    splitContainerRef,
    editorPaneRef,
    saving,
    setSaving,

    editorPaneTab,
    setEditorPaneTab,

    browserActive,
    setBrowserActive,
    browserPreviewUrl,
    setBrowserPreviewUrl,

    quickTerminalOpen,
    quickTerminalOpenByWorkspace,
    setQuickTerminalOpenForWorkspace,

    showWorkspaceSelector,
    setShowWorkspaceSelector,
    companionPanelSignal,
    bumpCompanionPanelSignal,

    bottomRef,
    contentColumnRef,
    scrollRegionRef,
    textareaRef,
    pendingScrollFrameRef,
    showScrollToBottom,
    setShowScrollToBottom,
  };
}
