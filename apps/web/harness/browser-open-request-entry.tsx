import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BuiltInBrowser } from '../src/components/chat/misc/BuiltInBrowser.js';
import { useOpenFusionBrowserPreview } from '../src/pages/chat-page/hooks/use-fusion-browser-preview.js';
import {
  EditorBrowserWorkspace,
  type EditorBrowserWorkspaceProps,
  type EditorPaneTab,
} from '../src/components/file-editor/EditorBrowserWorkspace.js';
import { FusionWorkspaceTab } from '../src/pages/chat-page/panels/FusionWorkspaceTab.js';
import { useFusionWorkspaceBrowserSurface } from '../src/pages/chat-page/panels/use-fusion-workspace-browser-surface.js';
import { requestBrowserOpen } from '../src/components/chat/misc/browser/browser-open-request.js';
import '../src/index.css';

const workspace = '/browser-open-request';
const target = 'https://example.test/requested';
const fileEditor: EditorBrowserWorkspaceProps['fileEditor'] = {
  openFiles: [],
  activeFile: null,
  activeFilePath: null,
  saveError: null,
  isDirty: () => false,
  setActiveFilePath: () => undefined,
  closeFile: () => undefined,
  updateContent: () => undefined,
};
const saveFile = async () => undefined;

/** 真实宿主与浏览器；仅替代 ChatPage 的外层布局状态，保留生产所有权 hook。 */
function HostHarness() {
  const [workspacePath, setWorkspacePath] = useState('/browser-host-a');
  const [promoted, setPromoted] = useState(false);
  const [tab, setTab] = useState<EditorPaneTab>('code');
  const [previewUrl, setPreviewUrl] = useState<string | null>(target);
  useFusionWorkspaceBrowserSurface({ enabled: true, editorMode: promoted });
  const open = useOpenFusionBrowserPreview({
    workspacePath,
    browserPreviewUrl: previewUrl,
    dockOwnsWorkspacePanels: true,
    editorMode: promoted,
    collapseWorkspaceToPanel: () => setPromoted(false),
    openPreviewPanel: () => setTab('browser'),
    setBrowserPreviewUrl: setPreviewUrl,
    setEditorMode: setPromoted,
    setEditorPaneTab: setTab,
  });
  return (
    <>
      <button onClick={() => open(target)}>当前标签打开</button>
      <button onClick={() => open(target, 'newTab')}>新标签打开</button>
      <button onClick={() => open()}>仅打开面板</button>
      <button onClick={() => setTab('code')}>隐藏预览</button>
      <button onClick={() => requestBrowserOpen(workspacePath, target, 'newTab')}>
        隐藏时请求
      </button>
      <button onClick={() => setPromoted(true)}>提升</button>
      <button
        onClick={() => {
          requestBrowserOpen('/browser-host-b', 'https://example.test/workspace-b', 'newTab');
          setWorkspacePath('/browser-host-b');
          setPreviewUrl('https://example.test/workspace-b');
          setTab('browser');
        }}
      >
        切换工作区并打开
      </button>
      <button onClick={() => setWorkspacePath('/browser-host-a')}>返回工作区</button>
      <div data-testid="main-host" style={{ display: promoted ? 'flex' : 'none', height: 600 }}>
        <EditorBrowserWorkspace
          fileEditor={fileEditor}
          saving={false}
          handleSaveFile={saveFile}
          workspacePath={workspacePath}
          browserPreviewUrl={previewUrl}
          activeTab={tab}
          onTabChange={setTab}
        />
      </div>
      <div data-testid="dock-host" style={{ display: promoted ? 'none' : 'flex', height: 600 }}>
        <FusionWorkspaceTab
          fileEditor={fileEditor}
          fileTree={null}
          saving={false}
          handleSaveFile={saveFile}
          workspacePath={workspacePath}
          browserPreviewUrl={previewUrl}
          activeTab={tab}
          onTabChange={setTab}
          onBrowserPreviewUrlChange={setPreviewUrl}
        />
      </div>
    </>
  );
}
function Harness() {
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(target);
  const open = useOpenFusionBrowserPreview({
    workspacePath: workspace,
    browserPreviewUrl: previewUrl,
    dockOwnsWorkspacePanels: true,
    editorMode: false,
    collapseWorkspaceToPanel: () => setMounted(true),
    openPreviewPanel: () => setMounted(true),
    setBrowserPreviewUrl: setPreviewUrl,
    setEditorMode: () => setMounted(true),
    setEditorPaneTab: () => setMounted(true),
  });
  return (
    <>
      <button onClick={() => open(target)}>当前标签打开</button>
      <button onClick={() => open(target, 'newTab')}>新标签打开</button>
      <button onClick={() => open('https://example.test/another', 'newTab')}>新地址新标签</button>
      <button onClick={() => open()}>仅打开面板</button>
      <button onClick={() => setReady(true)}>恢复工作区</button>
      <button onClick={() => setMounted(false)}>卸载</button>
      {mounted && (
        <BuiltInBrowser workspacePath={ready ? workspace : null} previewUrl={previewUrl} />
      )}
      <div data-testid="other-workspace">
        <BuiltInBrowser workspacePath="/other-browser" />
      </div>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('hosts') ? <HostHarness /> : <Harness />}
  </StrictMode>,
);
