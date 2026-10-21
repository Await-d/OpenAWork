import { useEffect } from 'react';
import { BuiltInBrowser } from '../../../components/chat/misc/BuiltInBrowser.js';
import { BrowserPreviewStartPage } from '../../../components/chat/misc/browser/BrowserPreviewStartPage.js';
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
 *
 * 没有预览地址时展示与浏览器新标签页同一份开始页（`BrowserPreviewStartPage`）：
 * 输入框就是「填入地址」的入口，下面的快捷入口来自书签与该工作区上次的标签历史。
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

  useEffect(() => {
    setBrowserPreviewSurface('dock');
    return () => {
      setBrowserPreviewSurface('editor');
    };
  }, [setBrowserPreviewSurface]);

  const workspaceKey = resolveWorkspaceKey(workspaceScope);
  const browserPreviewUrl = browserPreviewUrlByWorkspace[workspaceKey] ?? null;
  const ownsBrowserSurface = browserPreviewSurface === 'dock';

  // 预览宿主是 keep-alive 的，不会因为切 tab 而卸载；没有这个出口时用户只能靠
  // 换地址绕开，清空当前预览（回到开始页）是唯一能主动收掉它的动作。
  const handleClosePreview = () => {
    setBrowserPreviewUrlForWorkspace(workspaceScope, null);
  };

  return (
    <div className="fusion-side-panel__scroll">
      {browserPreviewUrl !== null ? (
        ownsBrowserSurface ? (
          <div className="fusion-side-panel__browser-wrap">
            <div className="fusion-side-panel__browser-bar">
              <button
                type="button"
                className="fusion-side-panel__ghost-button"
                onClick={handleClosePreview}
              >
                关闭预览
              </button>
            </div>
            <div className="fusion-side-panel__browser-host" data-testid="fusion-browser-tab-host">
              <BuiltInBrowser
                previewUrl={browserPreviewUrl}
                workspacePath={workspaceScope}
                hidden={false}
              />
            </div>
          </div>
        ) : null
      ) : (
        <div className="fusion-side-panel__browser-start">
          <BrowserPreviewStartPage
            workspacePath={workspaceScope}
            onSubmit={(url) => setBrowserPreviewUrlForWorkspace(workspaceScope, url)}
          />
        </div>
      )}
    </div>
  );
}
