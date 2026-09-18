import { useEffect, useState } from 'react';
import { BuiltInBrowser } from '../../../components/chat/misc/BuiltInBrowser.js';
import { normalizeBrowserPreviewInput } from '../../../components/chat/misc/browser/browser-url.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { resolveChatUiWorkspaceScope, resolveWorkspaceKey } from '../hooks/use-chat-ui-state.js';
import './FusionSessionSidePanel.css';

export interface FusionBrowserTabProps {
  readonly currentSessionId: string | null;
  readonly effectiveWorkingDirectory: string | null;
}

/**
 * 停靠侧面板里的「浏览器预览」tab。
 *
 * 单一浏览器互斥：`BuiltInBrowser` 内部持有网关实时会话（WebSocket），同一用户
 * 同一时刻只能有一条连接，因此全应用同一时刻最多只允许挂载一个
 * `BuiltInBrowser` 实例。互斥闸门就落在本组件：挂载即通过
 * `browserPreviewSurface = 'dock'` 声明所有权，卸载（切走 tab / 关闭停靠面板 /
 * 编辑器全屏）时归还 `'editor'`；`EditorBrowserWorkspace` 读取同一标记，在停靠
 * 面板持有浏览器期间不挂载自己的浏览器实例。
 */
export function FusionBrowserTab({
  currentSessionId,
  effectiveWorkingDirectory,
}: FusionBrowserTabProps) {
  const workspaceScope = resolveChatUiWorkspaceScope(effectiveWorkingDirectory, currentSessionId);
  const browserPreviewUrlByWorkspace = useUIStateStore((s) => s.browserPreviewUrlByWorkspace);
  const setBrowserPreviewUrlForWorkspace = useUIStateStore(
    (s) => s.setBrowserPreviewUrlForWorkspace,
  );
  const browserPreviewSurface = useUIStateStore((s) => s.browserPreviewSurface);
  const setBrowserPreviewSurface = useUIStateStore((s) => s.setBrowserPreviewSurface);
  const [draftUrl, setDraftUrl] = useState('');

  useEffect(() => {
    setBrowserPreviewSurface('dock');
    return () => {
      setBrowserPreviewSurface('editor');
    };
  }, [setBrowserPreviewSurface]);

  const workspaceKey = resolveWorkspaceKey(workspaceScope);
  const browserPreviewUrl = browserPreviewUrlByWorkspace[workspaceKey] ?? null;
  const ownsBrowserSurface = browserPreviewSurface === 'dock';

  const handleOpenDraft = () => {
    const nextUrl = normalizeBrowserPreviewInput(draftUrl);
    if (nextUrl === null) {
      return;
    }
    setBrowserPreviewUrlForWorkspace(workspaceScope, nextUrl);
    setDraftUrl('');
  };

  return (
    <div className="fusion-side-panel__scroll">
      {browserPreviewUrl !== null ? (
        ownsBrowserSurface ? (
          <div className="fusion-side-panel__browser-host" data-testid="fusion-browser-tab-host">
            <BuiltInBrowser
              previewUrl={browserPreviewUrl}
              workspacePath={workspaceScope}
              hidden={false}
            />
          </div>
        ) : null
      ) : (
        <div className="fusion-side-panel__empty">
          <strong>还没有预览地址</strong>
          <span>
            在对话里执行 /open &lt;url&gt;、让 Agent 启动 dev server
            自动检测端口，或在下方直接填入地址。
          </span>
          <div className="fusion-side-panel__action-row">
            <input
              className="fusion-side-panel__browser-input"
              type="text"
              value={draftUrl}
              aria-label="预览地址"
              placeholder="http://localhost:5173"
              onChange={(event) => setDraftUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return;
                }
                event.preventDefault();
                handleOpenDraft();
              }}
            />
            <button
              type="button"
              className="fusion-side-panel__ghost-button"
              disabled={normalizeBrowserPreviewInput(draftUrl) === null}
              onClick={handleOpenDraft}
            >
              打开预览
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
