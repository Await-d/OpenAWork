/**
 * 团队页编辑器浮层控制 hook。
 *
 * 文件目录 / 对话内文件引用点击后打开的编辑器浮层（全屏 overlay / split 两种模式）
 * 需要一套跨组件共享的控制面：文件状态（useFileEditor）、保存中的反馈、ESC 关闭、
 * 内置浏览器预览入口。TeamPageV2 只负责在布局里摆放浮层，接线细节全部收敛在这里。
 *
 * 状态来源：浮层开关 / pane tab / 预览地址属于「按会话记忆」，由
 * TeamSessionViewStateControls（useTeamSessionViewState + 本目录 context）持有，
 * 本 hook 不直接读写 localStorage。TeamPageV2 自己渲染
 * <TeamSessionViewStateProvider>，其组件体不在该 Provider 内（React context 只向下
 * 流动），因此调用方需显式注入同一个 viewState 实例；能读到 context 的场景优先用
 * context，保证这两条路径始终只有一份来源。
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useFileEditor } from '../../../hooks/editor/useFileEditor.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { useTeamSessionViewStateContextOptional } from './team-session-view-state-context.js';
import type { TeamSessionViewStateControls } from './use-team-session-view-state.js';

/** 未指定 URL 时内置浏览器预览的默认地址（本地网关）。 */
const DEFAULT_BROWSER_PREVIEW_URL = 'http://localhost:3000';

function normalizeBrowserPreviewUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

export interface TeamEditorOverlayControls {
  /** 编辑器工作区根路径（activeWorkspace.defaultWorkingRoot）。 */
  workspacePath: string | null;
  /** 浮层是否打开（按会话记忆）。 */
  open: boolean;
  /** 关闭浮层（ESC / 关闭按钮）。 */
  closeOverlay: () => void;
  /** 当前激活 pane（code / browser，按会话记忆）。 */
  paneTab: EditorPaneTab;
  /** 切换 pane（用户点击 tab）。 */
  setPaneTab: Dispatch<SetStateAction<EditorPaneTab>>;
  /** 内置浏览器预览地址（按会话记忆）。 */
  browserPreviewUrl: string | null;
  /** 浮层渲染模式（overlay / split，全局工作台设置）。 */
  mode: 'overlay' | 'split';
  /** split 模式宽度百分比（全局工作台设置）。 */
  splitPos: number;
  setSplitPos: (pos: number) => void;
  setMode: (mode: 'overlay' | 'split') => void;
  fileEditor: ReturnType<typeof useFileEditor>;
  savingFile: boolean;
  /** 文件树 / 对话内文件引用点击：切换 pane 到 code 并打开浮层。 */
  openFile: (path: string) => void;
  /** 保存文件；保存期间 savingFile 为 true。 */
  saveFile: (path: string) => Promise<void>;
  /** 打开内置浏览器预览；不传 URL 时用默认预览地址。 */
  openBrowserPreview: (url?: string | null) => void;
}

export function useTeamEditorOverlay(input: {
  readonly workspacePath: string | null;
  readonly isMobile: boolean;
  /** 打开浮层前收起移动端侧栏，避免抽屉压住浮层。 */
  readonly setMobileSidebarOpen: Dispatch<SetStateAction<boolean>>;
  /** Provider 外调用（TeamPageV2 自身渲染 Provider）时注入同一 viewState 实例。 */
  readonly viewState?: TeamSessionViewStateControls;
}): TeamEditorOverlayControls {
  const contextViewState = useTeamSessionViewStateContextOptional();
  const viewState = contextViewState ?? input.viewState;
  if (!viewState) {
    throw new Error(
      'useTeamEditorOverlay 必须在 TeamSessionViewStateProvider 内使用，或显式传入 viewState',
    );
  }
  const {
    editorOverlayOpen,
    setEditorOverlayOpen,
    editorPaneTab,
    setEditorPaneTab,
    browserPreviewUrl,
    setBrowserPreviewUrl,
  } = viewState;
  const { isMobile, setMobileSidebarOpen } = input;

  // team 页没有内置分屏编辑器，这里自己持有一份 useFileEditor 状态；不能依赖只有
  // ChatPage 才会填充的全局 FileEditorContext（/team 路由下那个 ref 永远是 null）。
  const fileEditor = useFileEditor(input.workspacePath);
  const [savingFile, setSavingFile] = useState(false);

  // 浮层布局模式 / split 宽度是全局工作台设置（非按会话记忆），只服务本浮层。
  const mode = useUIStateStore((s) => s.teamEditorMode);
  const splitPos = useUIStateStore((s) => s.teamSplitPos);
  const setSplitPos = useUIStateStore((s) => s.setTeamSplitPos);
  const setMode = useUIStateStore((s) => s.setTeamEditorMode);

  const openFile = useCallback(
    (path: string) => {
      if (isMobile) {
        setMobileSidebarOpen(false);
      }
      // 先切 pane 再打开浮层：默认落到 code，避免上次停留在浏览器 tab。
      setEditorPaneTab('code');
      setEditorOverlayOpen(true);
      void fileEditor.openFile(path);
    },
    [fileEditor, isMobile, setMobileSidebarOpen, setEditorOverlayOpen, setEditorPaneTab],
  );

  const saveFile = useCallback(
    async (path: string) => {
      setSavingFile(true);
      try {
        await fileEditor.saveFile(path);
      } finally {
        setSavingFile(false);
      }
    },
    [fileEditor],
  );

  const closeOverlay = useCallback(() => {
    setEditorOverlayOpen(false);
  }, [setEditorOverlayOpen]);

  // 编辑器浮层打开时按 ESC 关闭（浮层关闭时不下发监听）。
  useEffect(() => {
    if (!editorOverlayOpen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOverlayOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [editorOverlayOpen, setEditorOverlayOpen]);

  const openBrowserPreview = useCallback(
    (rawUrl?: string | null) => {
      const nextUrl = normalizeBrowserPreviewUrl(rawUrl?.trim() || DEFAULT_BROWSER_PREVIEW_URL);
      if (isMobile) {
        setMobileSidebarOpen(false);
      }
      setBrowserPreviewUrl(nextUrl);
      setEditorPaneTab('browser');
      setEditorOverlayOpen(true);
    },
    [isMobile, setMobileSidebarOpen, setBrowserPreviewUrl, setEditorOverlayOpen, setEditorPaneTab],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOpenBrowser = () => {
      openBrowserPreview(DEFAULT_BROWSER_PREVIEW_URL);
    };
    const handleOpenBrowserUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      openBrowserPreview(detail?.url ?? DEFAULT_BROWSER_PREVIEW_URL);
    };

    window.addEventListener('openAwork:open-browser', handleOpenBrowser);
    window.addEventListener('openawork:browser:open-url', handleOpenBrowserUrl as EventListener);
    return () => {
      window.removeEventListener('openAwork:open-browser', handleOpenBrowser);
      window.removeEventListener(
        'openawork:browser:open-url',
        handleOpenBrowserUrl as EventListener,
      );
    };
  }, [openBrowserPreview]);

  return {
    workspacePath: input.workspacePath,
    open: editorOverlayOpen,
    closeOverlay,
    paneTab: editorPaneTab,
    setPaneTab: setEditorPaneTab,
    browserPreviewUrl,
    mode,
    splitPos,
    setSplitPos,
    setMode,
    fileEditor,
    savingFile,
    openFile,
    saveFile,
    openBrowserPreview,
  };
}
