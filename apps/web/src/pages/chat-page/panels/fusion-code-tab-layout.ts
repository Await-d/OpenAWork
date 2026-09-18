import type { FileTreeWidthBounds } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import {
  FILE_TREE_WIDTH_DEFAULT,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_MIN,
} from '../../../components/file-editor/workspace-resize.js';

export interface DockFileTreeLayout {
  readonly initialWidth: number;
  readonly bounds: FileTreeWidthBounds;
}

/** 低于该宽度视为窄停靠：文件树不再享有全局默认宽度，改为按比例让位给编辑器。 */
export const DOCK_FILE_TREE_NARROW_MAX_PX = 520;

/** 窄停靠下文件树最多占用宿主宽度的 45%，其余留给编辑器列。 */
export const DOCK_FILE_TREE_MAX_WIDTH_RATIO = 0.45;

export const DOCK_FILE_TREE_MIN_WIDTH_PX = 96;

/**
 * 停靠面板「代码」tab 的文件树宽度决策。
 *
 * 宽停靠沿用全局默认（220 / [140,480]）；窄停靠按宿主宽度收敛上限与初始值，
 * 保证文件树 + 编辑器并排时编辑器不会先被压到不可用宽度。
 */
export function resolveDockFileTreeLayout(hostWidth: number): DockFileTreeLayout {
  if (!Number.isFinite(hostWidth) || hostWidth <= 0 || hostWidth >= DOCK_FILE_TREE_NARROW_MAX_PX) {
    return {
      initialWidth: FILE_TREE_WIDTH_DEFAULT,
      bounds: { min: FILE_TREE_WIDTH_MIN, max: FILE_TREE_WIDTH_MAX },
    };
  }

  const max = Math.max(
    DOCK_FILE_TREE_MIN_WIDTH_PX,
    Math.floor(hostWidth * DOCK_FILE_TREE_MAX_WIDTH_RATIO),
  );
  const min = Math.min(FILE_TREE_WIDTH_MIN, max);
  const initialWidth = Math.min(max, Math.max(min, Math.round(hostWidth * 0.36)));

  return { initialWidth, bounds: { min, max } };
}
