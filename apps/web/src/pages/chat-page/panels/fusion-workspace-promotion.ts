export interface FusionWorkspacePromotionApi {
  readonly setEditorFullScreen: (value: boolean) => void;
  readonly setEditorMode: (value: boolean) => void;
  readonly setEditorPaneTab: (tab: 'code' | 'browser') => void;
  readonly setReviewPanelOpened: (open: boolean) => void;
}

/**
 * 面板「放大」：把停靠面板的代码 / 预览内容提升到主内容区，复用既有
 * `editorMode + editorFullScreen + editorPaneTab` 机制。不触碰浏览器所有权标记
 * （`browserPreviewSurface`）——宿主面由 `ChatPage` 按可见性派生
 * （见 `useFusionWorkspaceBrowserSurface`）。
 */
export function promoteFusionWorkspaceTab(
  api: FusionWorkspacePromotionApi,
  tab: 'code' | 'browser',
): void {
  api.setEditorPaneTab(tab);
  api.setEditorMode(true);
  api.setEditorFullScreen(true);
}

/**
 * 放大态的回到面板路径：退出全屏并收起主区分屏编辑器，让内容重新由停靠
 * 面板承载（面板保持展开）。
 */
export function collapseFusionWorkspaceToPanel(api: FusionWorkspacePromotionApi): void {
  api.setEditorFullScreen(false);
  api.setEditorMode(false);
  api.setReviewPanelOpened(true);
}
