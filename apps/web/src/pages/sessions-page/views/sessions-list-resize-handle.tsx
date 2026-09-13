import {
  SESSIONS_LIST_PANE_WIDTH_BOUNDS,
  clampSessionsListPaneWidth,
} from '../../../stores/ui/uiState.js';
import { ResizeHandle } from '../../../components/layout/shared/resize-handle.js';

interface SessionsListResizeHandleProps {
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}

/**
 * `/sessions` 页会话列表右边缘的宽度拖拽手柄。
 *
 * 行为（拖拽实时更新、松手持久化、键盘微调、双击复位）统一由
 * `ResizeHandle` 提供，这里只绑定该页面的宽度边界。
 */
export function SessionsListResizeHandle({
  width,
  onWidthChange,
  onWidthCommit,
}: SessionsListResizeHandleProps) {
  return (
    <ResizeHandle
      width={width}
      onWidthChange={onWidthChange}
      onWidthCommit={onWidthCommit}
      bounds={SESSIONS_LIST_PANE_WIDTH_BOUNDS}
      clamp={clampSessionsListPaneWidth}
      ariaLabel="调整会话列表宽度"
    />
  );
}
