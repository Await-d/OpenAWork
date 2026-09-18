import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  EditorBrowserWorkspace,
  type EditorBrowserWorkspaceProps,
  type EditorPaneTab,
} from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { resolveDockFileTreeLayout } from './fusion-code-tab-layout.js';
import './FusionSessionSidePanel.css';

export interface FusionWorkspaceTabProps {
  readonly activeTab: EditorPaneTab;
  readonly onTabChange: (tab: EditorPaneTab) => void;
  readonly browserPreviewUrl: string | null;
  readonly fileEditor: EditorBrowserWorkspaceProps['fileEditor'];
  readonly fileTree: ReactNode;
  readonly handleSaveFile: (path: string) => Promise<void>;
  /** 空态提交预览地址后写回当前 workspace 的预览 URL（含 scheme 补全）。 */
  readonly onBrowserPreviewUrlChange: (url: string | null) => void;
  readonly saving: boolean;
  readonly workspacePath: string | null;
}

/**
 * 停靠面板工作区 pane：在面板内复用完整 {@link EditorBrowserWorkspace}
 * （文件树 + 编辑器 + 浏览器），文件树宽度随面板宽度自适应。
 *
 * 一级 tab 扁平化：面板的 `代码` / `预览` 两个一级 tab 共享本组件，切换由外部传入的
 * `activeTab` 控制；`hidePaneTabs` 让本组件不渲染任何内部工具条（子 tab 与全屏入口都
 * 归面板一级 tab 条）。
 *
 * 浏览器互斥：宿主面（`browserPreviewSurface`）由 `ChatPage` 按「是否处于提升 /
 * 分屏态」单一派生 —— 未提升时本实例拥有浏览器面。本组件只声明
 * `browserSurface="dock"` 并据此挂载 `BuiltInBrowser`，不再自行改写共享标记；
 * 切走面板 tab 时本组件保持挂载（见 `FusionSessionSidePanel` 的 pane 常驻策略），
 * 浏览器实时会话因此不会随 tab 切换断开。
 */
export function FusionWorkspaceTab({
  activeTab,
  onTabChange,
  browserPreviewUrl,
  fileEditor,
  fileTree,
  handleSaveFile,
  onBrowserPreviewUrlChange,
  saving,
  workspacePath,
}: FusionWorkspaceTabProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(0);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      setHostWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const treeLayout = resolveDockFileTreeLayout(hostWidth);

  return (
    <div
      className="fusion-side-panel__workspace-host"
      data-testid="fusion-workspace-tab-host"
      ref={hostRef}
    >
      <EditorBrowserWorkspace
        activeTab={activeTab}
        alwaysShowBrowserTab
        browserPreviewUrl={browserPreviewUrl}
        browserSurface="dock"
        fileEditor={fileEditor}
        fileTree={fileTree}
        fileTreeInitialWidth={treeLayout.initialWidth}
        fileTreeWidthBounds={treeLayout.bounds}
        handleSaveFile={handleSaveFile}
        hidePaneTabs
        onBrowserPreviewUrlChange={onBrowserPreviewUrlChange}
        onTabChange={onTabChange}
        saving={saving}
        workspacePath={workspacePath}
      />
    </div>
  );
}
