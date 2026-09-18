import { describe, expect, it, vi } from 'vitest';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  collapseFusionWorkspaceToPanel,
  promoteFusionWorkspaceTab,
} from './fusion-workspace-promotion.js';

function createApi() {
  return {
    setEditorFullScreen: vi.fn(),
    setEditorMode: vi.fn(),
    setEditorPaneTab: vi.fn(),
    setReviewPanelOpened: vi.fn(),
  };
}

describe('fusion-workspace-promotion', () => {
  it('放大设置目标 tab + editorMode + editorFullScreen，且不声明浏览器所有权', () => {
    const api = createApi();
    const surfaceBefore = useUIStateStore.getState().browserPreviewSurface;

    promoteFusionWorkspaceTab(api, 'browser');

    expect(api.setEditorPaneTab).toHaveBeenCalledWith('browser');
    expect(api.setEditorMode).toHaveBeenCalledWith(true);
    expect(api.setEditorFullScreen).toHaveBeenCalledWith(true);
    expect(api.setReviewPanelOpened).not.toHaveBeenCalled();
    // 浏览器互斥标记只能由挂载中的浏览器宿主改写——放大本身绝不碰它，
    // 否则主编辑器面板与停靠面板可能同时挂载两个 BuiltInBrowser。
    expect(useUIStateStore.getState().browserPreviewSurface).toBe(surfaceBefore);
  });

  it('放大代码 tab 时目标 tab 为 code', () => {
    const api = createApi();

    promoteFusionWorkspaceTab(api, 'code');

    expect(api.setEditorPaneTab).toHaveBeenCalledWith('code');
  });

  it('收回关闭全屏与编辑器模式，并确保会话面板展开', () => {
    const api = createApi();

    collapseFusionWorkspaceToPanel(api);

    expect(api.setEditorFullScreen).toHaveBeenCalledWith(false);
    expect(api.setEditorMode).toHaveBeenCalledWith(false);
    expect(api.setReviewPanelOpened).toHaveBeenCalledWith(true);
    expect(api.setEditorPaneTab).not.toHaveBeenCalled();
  });
});
