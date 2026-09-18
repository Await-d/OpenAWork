/** 经典布局 / 移动端在无地址时填入的兜底地址，保持既有行为不变。 */
export const DEFAULT_BROWSER_PREVIEW_URL = 'http://localhost:3000';

export type FusionBrowserPreviewRoute =
  | { readonly kind: 'dock'; readonly returnToPanel: boolean }
  | { readonly kind: 'main-area'; readonly fillDefaultUrl: boolean };

export interface FusionBrowserPreviewRouteOptions {
  /** Fusion 桌面（非移动端）：统一面板工作区是浏览器的唯一入口。 */
  readonly dockOwnsWorkspacePanels: boolean;
  /** 主内容区工作区是否处于提升 / 分屏态。 */
  readonly workspacePromoted: boolean;
  readonly hasPreviewUrl: boolean;
}

/**
 * 「打开浏览器预览」的路由决策（纯函数，便于锁定回归）：
 *   - 桌面 Fusion：只路由到面板的「预览」一级 tab，**绝不伪造默认地址**——
 *     空态由工作区提供地址输入，地址只从用户输入 / dev-server 检测 / `/open` 进来。
 *     提升态下面板被外壳隐藏，先收回面板，保证命令一定落到可见的预览视图。
 *   - 经典布局 / 移动端：主内容区分屏工作区 + 浏览器 tab（无地址时才填兜底地址）。
 */
export function resolveFusionBrowserPreviewRoute(
  options: FusionBrowserPreviewRouteOptions,
): FusionBrowserPreviewRoute {
  if (options.dockOwnsWorkspacePanels) {
    return { kind: 'dock', returnToPanel: options.workspacePromoted };
  }
  return { kind: 'main-area', fillDefaultUrl: !options.hasPreviewUrl };
}

export interface OpenFusionBrowserPreviewOptions {
  readonly browserPreviewUrl: string | null;
  readonly collapseWorkspaceToPanel: () => void;
  readonly dockOwnsWorkspacePanels: boolean;
  readonly editorMode: boolean;
  /** 打开停靠面板并切到「预览」一级 tab。 */
  readonly openPreviewPanel: () => void;
  readonly setBrowserPreviewUrl: (url: string | null) => void;
  readonly setEditorMode: (value: boolean) => void;
  readonly setEditorPaneTab: (tab: 'code' | 'browser') => void;
}

/**
 * 命令面板 / `/browser` 事件共用的「打开浏览器预览」编排：按
 * {@link resolveFusionBrowserPreviewRoute} 的决策落地到面板预览 tab 或主内容区。
 */
export function useOpenFusionBrowserPreview(options: OpenFusionBrowserPreviewOptions): () => void {
  return () => {
    const route = resolveFusionBrowserPreviewRoute({
      dockOwnsWorkspacePanels: options.dockOwnsWorkspacePanels,
      hasPreviewUrl: options.browserPreviewUrl !== null,
      workspacePromoted: options.editorMode,
    });

    if (route.kind === 'dock') {
      if (route.returnToPanel) {
        options.collapseWorkspaceToPanel();
      }
      options.openPreviewPanel();
      return;
    }

    if (route.fillDefaultUrl) {
      options.setBrowserPreviewUrl(DEFAULT_BROWSER_PREVIEW_URL);
    }
    options.setEditorMode(true);
    options.setEditorPaneTab('browser');
  };
}
