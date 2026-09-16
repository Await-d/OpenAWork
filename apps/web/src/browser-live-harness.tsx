/**
 * 临时验收 harness（非产品代码，验证完即删）。
 * panel=dock        → FusionBrowserTab 真实流程（空态 → 填地址 → 打开 → 实时画面）
 * panel=mutex       → FusionBrowserTab + EditorBrowserWorkspace 同时挂载（互斥：只允许一个浏览器）
 * panel=solo-editor → 仅 EditorBrowserWorkspace 的对照组（证明门控确实在起作用）
 * panel=autorefresh → BuiltInBrowser 直挂，用于验证「文件变化 → 自动重载」
 */
import { createRoot } from 'react-dom/client';
import { useAuthStore } from './stores/auth/auth.js';
import { useUIStateStore } from './stores/ui/uiState.js';
import { FusionBrowserTab } from './pages/chat-page/panels/FusionBrowserTab.js';
import { EditorBrowserWorkspace } from './components/file-editor/EditorBrowserWorkspace.js';
import { BuiltInBrowser } from './components/chat/misc/BuiltInBrowser.js';

const params = new URLSearchParams(window.location.search);

useAuthStore.setState({
  accessToken: params.get('token') ?? '',
  gatewayUrl: params.get('gateway') ?? 'http://127.0.0.1:3099',
});
useUIStateStore.setState({ browserPreviewSurface: 'editor' });

const WORKSPACE = params.get('workspace') ?? '/tmp/opencode';
const SESSION_ID = params.get('sessionId') ?? 'harness-session';
const PREVIEW_URL = params.get('url') ?? '';
const PANEL = params.get('panel') ?? 'dock';

const FILE_EDITOR_STUB = {
  openFiles: [],
  activeFile: null,
  activeFilePath: null,
  isDirty: () => false,
  saveError: null,
  setActiveFilePath: () => {},
  closeFile: () => {},
  updateContent: () => {},
};

function UseBrowserSurfaceProbe() {
  const surface = useUIStateStore((s) => s.browserPreviewSurface);
  return <div data-testid="harness-surface-flag">{surface}</div>;
}

function Harness() {
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
      <UseBrowserSurfaceProbe />
      <div data-testid="harness-panel">{PANEL}</div>
      <div style={{ width: 1280, height: 780, display: 'flex' }}>
        {PANEL === 'dock' ? (
          <div style={{ width: 520 }}>
            <FusionBrowserTab currentSessionId={SESSION_ID} effectiveWorkingDirectory={WORKSPACE} />
          </div>
        ) : null}

        {PANEL === 'mutex' ? (
          <>
            <div style={{ width: 520 }}>
              <FusionBrowserTab currentSessionId={SESSION_ID} effectiveWorkingDirectory={WORKSPACE} />
            </div>
            <div style={{ width: 720, display: 'flex', flexDirection: 'column' }}>
              <EditorBrowserWorkspace
                fileEditor={FILE_EDITOR_STUB}
                saving={false}
                handleSaveFile={async () => {}}
                browserPreviewUrl={PREVIEW_URL}
                workspacePath={WORKSPACE}
                activeTab="browser"
              />
            </div>
          </>
        ) : null}

        {PANEL === 'solo-editor' ? (
          <div style={{ width: 900, display: 'flex', flexDirection: 'column' }}>
            <EditorBrowserWorkspace
              fileEditor={FILE_EDITOR_STUB}
              saving={false}
              handleSaveFile={async () => {}}
              browserPreviewUrl={PREVIEW_URL}
              workspacePath={WORKSPACE}
              activeTab="browser"
            />
          </div>
        ) : null}

        {PANEL === 'autorefresh' ? (
          <div style={{ width: 900, height: 700 }}>
            <BuiltInBrowser previewUrl={PREVIEW_URL} workspacePath={WORKSPACE} hidden={false} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<Harness />);
}
