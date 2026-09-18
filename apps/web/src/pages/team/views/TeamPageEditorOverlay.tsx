/**
 * team 页编辑器浮层（纯展示组件）。
 *
 * 把 useTeamEditorOverlay 的控制结果接到通用 WorkspaceEditorOverlay 上；
 * TeamPageV2 只负责在树中摆放，不持有文件 / 浮层接线细节。
 */

import { WorkspaceEditorOverlay } from '../../../components/file-editor/WorkspaceEditorOverlay.js';
import type { TeamEditorOverlayControls } from '../hooks/use-team-editor-overlay.js';

export interface TeamPageEditorOverlayProps {
  /** useTeamEditorOverlay 的返回值（文件状态 / 浮层开关 / pane / 预览地址 / 布局模式）。 */
  readonly controls: TeamEditorOverlayControls;
}

export function TeamPageEditorOverlay({ controls }: TeamPageEditorOverlayProps) {
  return (
    <WorkspaceEditorOverlay
      open={controls.open}
      onClose={controls.closeOverlay}
      workspacePath={controls.workspacePath}
      fileEditor={controls.fileEditor}
      saving={controls.savingFile}
      onSave={controls.saveFile}
      browserPreviewUrl={controls.browserPreviewUrl}
      activeTab={controls.paneTab}
      onTabChange={controls.setPaneTab}
      mode={controls.mode}
      splitPos={controls.splitPos}
      onSplitPosChange={controls.setSplitPos}
      onModeChange={controls.setMode}
    />
  );
}
