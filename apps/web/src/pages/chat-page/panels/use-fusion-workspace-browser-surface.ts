import { useEffect } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

export interface FusionWorkspaceBrowserSurfaceOptions {
  /** Fusion 桌面（非移动端）：统一面板与主内容区共享同一份工作区。 */
  readonly enabled: boolean;
  /** 主内容区工作区是否处于提升 / 分屏态（`editorMode`）。 */
  readonly editorMode: boolean;
}

/**
 * 桌面 Fusion 的浏览器宿主面唯一派生点。
 *
 * 面板 pane 常驻（keep-alive），所有权不能跟随挂载 / 卸载，只能跟随「谁可见」：
 * 主内容区处于提升 / 分屏态时归主内容区，否则归停靠面板。经典布局与移动端不进入
 * 本 hook，继续由 `FusionBrowserTab` 自行声明 / 归还（`enabled=false` 时不改写）。
 */
export function useFusionWorkspaceBrowserSurface({
  enabled,
  editorMode,
}: FusionWorkspaceBrowserSurfaceOptions): void {
  const setBrowserPreviewSurface = useUIStateStore((s) => s.setBrowserPreviewSurface);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setBrowserPreviewSurface(editorMode ? 'editor' : 'dock');
    return () => {
      setBrowserPreviewSurface('editor');
    };
  }, [editorMode, enabled, setBrowserPreviewSurface]);
}
